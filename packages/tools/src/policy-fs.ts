import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import type {
  ByteString,
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  RmOptions,
} from 'just-bash';

import {
  normalizeWorkspaceRelativePath,
  sha256Text,
} from './candidate-change-set';
import type { CandidateFileSnapshot } from './candidate-change-set';
import {
  normalizeHostSelectedCapability,
  normalizePathRule,
  pathMatchesAnyRule,
} from './workspace-change-policy';
import type {
  PathRule,
  WorkspaceChangePolicy,
} from './workspace-change-policy';
import {
  VIRTUAL_SCRATCH_ROOT,
  VIRTUAL_WORKSPACE_ROOT,
} from './workspace-projection';

type ReadFileOptions = Parameters<IFileSystem['readFile']>[1];
type WriteFileOptions = Parameters<IFileSystem['writeFile']>[2];
type DirentEntries = Awaited<ReturnType<NonNullable<IFileSystem['readdirWithFileTypes']>>>;

interface SyncBootstrapFileSystem {
  mkdirSync(path: string, options?: MkdirOptions): void;
  writeFileSync(path: string, content: FileContent, options?: WriteFileOptions): void;
}

interface ActivatableFileSystem {
  activate(): void;
}

export interface PolicyFsOptions {
  /** Trusted, content-free provenance observer; never exposed to model tools. */
  onRead?: (path: string, bytes: Uint8Array) => void;
  policy: WorkspaceChangePolicy;
  baselineFiles?: readonly CandidateFileSnapshot[];
  /** Existing projected directories/files, expressed as workspace-relative paths. */
  projectedPaths?: readonly string[];
  workspaceRoot?: string;
  scratchRoot?: string;
  maxScratchBytes?: number;
  maxPathLength?: number;
}

export interface PolicyFsUsage {
  changedFiles: number;
  candidateBytes: number;
  scratchBytes: number;
}

interface FileRecord {
  path: string;
  byteLength: number;
  sha256: string;
  mode: number;
}

const BOOTSTRAP_ROOTS = ['/bin', '/usr/bin', '/dev', '/proc'] as const;
const DEFAULT_MAX_SCRATCH_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PATH_LENGTH = 1_024;

/**
 * Capability and secrecy enforcement for every public just-bash IFileSystem
 * operation. It deliberately does not expose the underlying filesystem.
 */
export class PolicyFs implements IFileSystem {
  readonly workspaceRoot: string;
  readonly scratchRoot: string;
  readonly policy: WorkspaceChangePolicy;
  readonly maxScratchBytes: number;
  readonly maxPathLength: number;

  #inner: IFileSystem;
  #onRead?: PolicyFsOptions['onRead'];
  #active = false;
  #readable: readonly PathRule[];
  #writable: readonly PathRule[];
  #baseline = new Map<string, FileRecord>();
  #baselineInitialized: boolean;
  #visibleWorkspacePaths = new Set<string>();
  #dynamicWorkspacePaths = new Set<string>();
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(inner: IFileSystem, options: PolicyFsOptions) {
    if (!options?.policy) throw new Error('PolicyFs requires a host-selected policy.');
    this.#inner = inner;
    this.#onRead = options.onRead;
    this.workspaceRoot = normalizeAbsoluteRoot(
      options.workspaceRoot ?? VIRTUAL_WORKSPACE_ROOT,
      'workspaceRoot',
    );
    this.scratchRoot = normalizeAbsoluteRoot(
      options.scratchRoot ?? VIRTUAL_SCRATCH_ROOT,
      'scratchRoot',
    );
    if (rootsOverlap(this.workspaceRoot, this.scratchRoot)) {
      throw new Error('PolicyFs workspace and scratch roots must not overlap.');
    }
    this.maxScratchBytes = positiveInteger(
      options.maxScratchBytes ?? DEFAULT_MAX_SCRATCH_BYTES,
      'maxScratchBytes',
    );
    this.maxPathLength = positiveInteger(
      options.maxPathLength ?? DEFAULT_MAX_PATH_LENGTH,
      'maxPathLength',
    );

    const capability = normalizeHostSelectedCapability(
      (options.policy as { capability?: unknown }).capability,
    );
    this.#readable = freezeRules(options.policy.readable, 'read');
    this.#writable = capability === 'read-only'
      ? Object.freeze([])
      : freezeRules(options.policy.writable, 'write');
    this.policy = Object.freeze({
      ...options.policy,
      capability,
      readable: this.#readable,
      writable: this.#writable,
    });
    assertPolicyLimits(this.policy);

    this.#baselineInitialized = options.baselineFiles !== undefined;
    for (const file of options.baselineFiles ?? []) {
      const relative = normalizeWorkspaceRelativePath(file.path);
      const path = this.#workspacePath(relative);
      if (this.#baseline.has(path)) {
        throw new Error(`Duplicate PolicyFs baseline path: ${relative}`);
      }
      this.#baseline.set(path, {
        path,
        byteLength: Buffer.byteLength(file.content, 'utf8'),
        sha256: sha256Text(file.content),
        mode: file.mode ?? 0o644,
      });
      this.#addVisibleWorkspacePath(relative);
    }
    for (const path of options.projectedPaths ?? []) {
      this.#addVisibleWorkspacePath(normalizeWorkspaceRelativePath(path));
    }
    // Writable roots and exact-target parents are projected as empty virtual
    // directories even when the canonical host directory does not exist yet.
    for (const rule of this.#writable) {
      if (rule.kind === 'prefix') this.#addVisibleWorkspacePath(rule.path);
      this.#addVisibleWorkspaceParents(rule.path);
    }
    for (const rule of this.#readable) this.#addVisibleWorkspaceParents(rule.path);
  }

  get active(): boolean {
    return this.#active;
  }

  activate(): void {
    if (this.#active) return;
    this.#active = true;
    const activatable = this.#inner as IFileSystem & Partial<ActivatableFileSystem>;
    activatable.activate?.();
  }

  async getUsage(): Promise<PolicyFsUsage> {
    await this.#ensureBaseline();
    const files = await this.#snapshotCandidateAndScratch();
    return this.#calculateUsage(files);
  }

  async readFile(path: string, options?: ReadFileOptions): Promise<string> {
    const normalized = this.#assertReadable(path, 'open');
    await this.#assertRegularFile(normalized, 'open');
    const content = await this.#inner.readFile(normalized, options);
    // Hash actual VFS bytes, even when the consumer requested ASCII/base64 text.
    if (this.#onRead) this.#onRead(normalized, await this.#inner.readFileBuffer(normalized));
    return content;
  }

  async readFileBytes(path: string): Promise<ByteString> {
    const normalized = this.#assertReadable(path, 'open');
    await this.#assertRegularFile(normalized, 'open');
    if (this.#inner.readFileBytes) {
      const content = await this.#inner.readFileBytes(normalized);
      this.#onRead?.(normalized, Buffer.from(content, 'latin1'));
      return content;
    }
    const bytes = await this.#inner.readFileBuffer(normalized);
    this.#onRead?.(normalized, bytes);
    return Buffer.from(bytes).toString('latin1') as ByteString;
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const normalized = this.#assertReadable(path, 'open');
    await this.#assertRegularFile(normalized, 'open');
    const bytes = await this.#inner.readFileBuffer(normalized);
    this.#onRead?.(normalized, bytes);
    return bytes;
  }

  writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions,
  ): Promise<void> {
    return this.#serializeMutation(async () => {
      const normalized = this.#assertWritableFile(path, 'write');
      const bytes = encodeFileContent(content, options);
      await this.#preflightFiles((files) => {
        const existing = files.get(normalized);
        files.set(normalized, recordFromBytes(
          normalized,
          bytes,
          existing?.mode ?? 0o644,
        ));
      });
      await this.#inner.writeFile(normalized, content, options);
      this.#markDynamic(normalized);
    });
  }

  appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions,
  ): Promise<void> {
    return this.#serializeMutation(async () => {
      const normalized = this.#assertWritableFile(path, 'append');
      const appended = encodeFileContent(content, options);
      await this.#preflightFiles(async (files) => {
        const existing = files.get(normalized);
        let bytes = appended;
        if (existing) {
          const current = await this.#inner.readFileBuffer(normalized);
          bytes = Buffer.concat([Buffer.from(current), Buffer.from(appended)]);
        }
        files.set(normalized, recordFromBytes(
          normalized,
          bytes,
          existing?.mode ?? 0o644,
        ));
      });
      await this.#inner.appendFile(normalized, content, options);
      this.#markDynamic(normalized);
    });
  }

  async exists(path: string): Promise<boolean> {
    let normalized: string;
    try {
      normalized = this.#assertReadable(path, 'stat');
    } catch {
      return false;
    }
    try {
      const stat = await this.#inner.lstat(normalized);
      return !stat.isSymbolicLink && (stat.isFile || stat.isDirectory);
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FsStat> {
    const normalized = this.#assertReadable(path, 'stat');
    assertSafeStat(await this.#inner.lstat(normalized), normalized, 'stat');
    const stat = await this.#inner.stat(normalized);
    return assertSafeStat(stat, normalized, 'stat');
  }

  mkdir(path: string, options?: MkdirOptions): Promise<void> {
    return this.#serializeMutation(async () => {
      this.#assertActive();
      const normalized = this.#normalizeAbsolute(path);
      if (!this.#mayCreateDirectory(normalized)) throw permissionDenied('mkdir', normalized);
      await this.#inner.mkdir(normalized, options);
      this.#markDynamic(normalized);
    });
  }

  async readdir(path: string): Promise<string[]> {
    return (await this.readdirWithFileTypes(path)).map((entry) => entry.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntries> {
    const normalized = this.#assertReadable(path, 'scandir');
    const stat = await this.#inner.lstat(normalized);
    assertSafeStat(stat, normalized, 'scandir');
    if (!stat.isDirectory) throw new Error(`ENOTDIR: not a directory, scandir '${normalized}'`);
    const entries = this.#inner.readdirWithFileTypes
      ? await this.#inner.readdirWithFileTypes(normalized)
      : await fallbackDirents(this.#inner, normalized);
    return entries.filter((entry) => {
      if (entry.isSymbolicLink) return false;
      const child = joinAbsolute(normalized, entry.name);
      return this.#isVisible(child);
    });
  }

  rm(path: string, options?: RmOptions): Promise<void> {
    return this.#serializeMutation(async () => {
      const normalized = this.#assertMutableSource(path, 'rm');
      const stat = await this.#lstatForMutation(normalized, 'rm', options?.force);
      if (!stat) return;
      if (stat.isDirectory && !options?.recursive) {
        // Preserve the underlying filesystem's ENOTEMPTY/EISDIR behavior.
        await this.#inner.rm(normalized, options);
        return;
      }
      await this.#assertTreeMutable(normalized, 'rm');
      await this.#preflightFiles((files) => {
        removeTreeRecords(files, normalized);
      });
      await this.#inner.rm(normalized, options);
      this.#removeDynamicTree(normalized);
    });
  }

  cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    return this.#serializeMutation(async () => {
      this.#assertActive();
      const source = this.#assertReadable(src, 'cp');
      const destination = this.#assertWritableFile(dest, 'cp');
      const sourceTree = await this.#snapshotReadableTree(source, 'cp');
      const sourceStat = await this.#inner.lstat(source);
      if (sourceStat.isDirectory && !options?.recursive) {
        await this.#inner.cp(source, destination, options);
        return;
      }
      for (const item of sourceTree) {
        const target = mapTreePath(source, destination, item.path);
        if (item.kind === 'directory') {
          if (!this.#mayCreateDirectory(target)) throw permissionDenied('cp', target);
        } else {
          this.#assertWritableFile(target, 'cp');
        }
      }
      await this.#preflightFiles((files) => {
        for (const item of sourceTree) {
          if (item.kind !== 'file') continue;
          const target = mapTreePath(source, destination, item.path);
          files.set(target, { ...item.record, path: target });
        }
      });
      await this.#inner.cp(source, destination, options);
      for (const item of sourceTree) {
        this.#markDynamic(mapTreePath(source, destination, item.path));
      }
    });
  }

  mv(src: string, dest: string): Promise<void> {
    return this.#serializeMutation(async () => {
      const source = this.#assertMutableSource(src, 'mv');
      const destination = this.#assertWritableFile(dest, 'mv');
      const sourceTree = await this.#snapshotReadableTree(source, 'mv');
      await this.#assertTreeMutable(source, 'mv');
      for (const item of sourceTree) {
        const target = mapTreePath(source, destination, item.path);
        if (item.kind === 'directory') {
          if (!this.#mayCreateDirectory(target)) throw permissionDenied('mv', target);
        } else {
          this.#assertWritableFile(target, 'mv');
        }
      }
      await this.#preflightFiles((files) => {
        removeTreeRecords(files, source);
        for (const item of sourceTree) {
          if (item.kind !== 'file') continue;
          const target = mapTreePath(source, destination, item.path);
          files.set(target, { ...item.record, path: target });
        }
      });
      await this.#inner.mv(source, destination);
      this.#removeDynamicTree(source);
      for (const item of sourceTree) {
        this.#markDynamic(mapTreePath(source, destination, item.path));
      }
    });
  }

  resolvePath(base: string, path: string): string {
    const normalizedBase = this.#normalizeAbsolute(base);
    if (typeof path !== 'string' || path.length === 0 || path.includes('\0') || path.includes('\\')) {
      throw new Error('EACCES: invalid virtual path');
    }
    let resolved: string;
    if (path.startsWith('/')) {
      resolved = this.#normalizeAbsolute(path);
    } else {
      const segments = path.split('/');
      if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw new Error(`EACCES: non-canonical virtual path '${path}'`);
      }
      resolved = this.#normalizeAbsolute(posix.join(normalizedBase, path));
    }
    if (!this.#isKnownNamespace(resolved)) throw permissionDenied('resolve', resolved);
    return resolved;
  }

  getAllPaths(): string[] {
    return this.#inner.getAllPaths()
      .filter((path) => {
        try {
          const normalized = this.#normalizeAbsolute(path);
          return this.#isVisible(normalized);
        } catch {
          return false;
        }
      })
      .sort(comparePaths);
  }

  chmod(path: string, _mode: number): Promise<void> {
    return Promise.reject(unsupportedMutation('chmod', path));
  }

  symlink(_target: string, linkPath: string): Promise<void> {
    return Promise.reject(unsupportedMutation('symlink', linkPath));
  }

  link(_existingPath: string, newPath: string): Promise<void> {
    return Promise.reject(unsupportedMutation('link', newPath));
  }

  readlink(path: string): Promise<string> {
    try {
      this.#assertReadable(path, 'readlink');
    } catch {
      return Promise.reject(notFound('readlink', path));
    }
    // Symlinks are absent by construction and cannot be created via PolicyFs.
    return Promise.reject(new Error(`EINVAL: invalid argument, readlink '${path}'`));
  }

  async lstat(path: string): Promise<FsStat> {
    const normalized = this.#assertReadable(path, 'lstat');
    const stat = await this.#inner.lstat(normalized);
    return assertSafeStat(stat, normalized, 'lstat');
  }

  async realpath(path: string): Promise<string> {
    const normalized = this.#assertReadable(path, 'realpath');
    assertSafeStat(await this.#inner.lstat(normalized), normalized, 'realpath');
    const resolved = this.#normalizeAbsolute(await this.#inner.realpath(normalized));
    if (resolved !== normalized || !this.#isVisible(resolved)) {
      throw notFound('realpath', normalized);
    }
    return resolved;
  }

  utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
    return Promise.reject(unsupportedMutation('utimes', path));
  }

  /** just-bash-only bootstrap extension, unavailable after activate(). */
  mkdirSync(path: string, options?: MkdirOptions): void {
    this.#assertBootstrapSystemPath(path, 'mkdir');
    requireSyncBootstrapFs(this.#inner).mkdirSync(path, options);
  }

  /** just-bash-only bootstrap extension, unavailable after activate(). */
  writeFileSync(
    path: string,
    content: FileContent,
    options?: WriteFileOptions,
  ): void {
    this.#assertBootstrapSystemPath(path, 'write');
    requireSyncBootstrapFs(this.#inner).writeFileSync(path, content, options);
  }

  #serializeMutation(operation: () => Promise<void>): Promise<void> {
    // Check synchronously so a queued call made during bootstrap cannot become
    // authorized merely because activate() runs before its microtask.
    if (!this.#active) {
      return Promise.reject(new Error('EACCES: PolicyFs is in bootstrap mode'));
    }
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.catch(() => undefined);
    return result;
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new Error('EACCES: PolicyFs is in bootstrap mode');
    }
  }

  #normalizeAbsolute(value: string): string {
    if (
      typeof value !== 'string'
      || value.length === 0
      || value.length > this.maxPathLength
      || !value.startsWith('/')
      || value.includes('\0')
      || value.includes('\\')
      || (value.length > 1 && value.endsWith('/'))
      || posix.normalize(value) !== value
    ) {
      throw new Error(`EACCES: invalid or non-canonical virtual path '${String(value)}'`);
    }
    if (value === '/') return value;
    const segments = value.slice(1).split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`EACCES: invalid or non-canonical virtual path '${value}'`);
    }
    if (value.normalize('NFC') !== value) {
      throw new Error(`EACCES: virtual path is not NFC-normalized '${value}'`);
    }
    return value;
  }

  #assertReadable(path: string, operation: string): string {
    const normalized = this.#normalizeAbsolute(path);
    if (!this.#isVisible(normalized)) throw notFound(operation, normalized);
    return normalized;
  }

  #assertWritableFile(path: string, operation: string): string {
    this.#assertActive();
    const normalized = this.#normalizeAbsolute(path);
    if (isAtOrBelow(normalized, this.scratchRoot) && normalized !== this.scratchRoot) {
      this.#assertPathDepth(normalized, this.scratchRoot);
      return normalized;
    }
    const relative = this.#workspaceRelative(normalized);
    this.#assertPathDepth(normalized, this.workspaceRoot);
    if (!relative || !pathMatchesAnyRule(relative, this.#writable)) {
      throw permissionDenied(operation, normalized);
    }
    return normalized;
  }

  #assertMutableSource(path: string, operation: string): string {
    const normalized = this.#assertWritableFile(path, operation);
    if (!this.#isVisible(normalized)) throw notFound(operation, normalized);
    return normalized;
  }

  #assertPathDepth(path: string, root: string): void {
    const relative = path.slice(root.length + 1);
    if (relative.split('/').length > this.policy.maxPathDepth) {
      throw new Error(`ENAMETOOLONG: policy path depth exceeded, '${path}'`);
    }
  }

  #isKnownNamespace(path: string): boolean {
    return path === '/'
      || isAtOrBelow(path, this.workspaceRoot)
      || isAtOrBelow(path, this.scratchRoot)
      || BOOTSTRAP_ROOTS.some((root) => isAtOrBelow(path, root))
      || BOOTSTRAP_ROOTS.some((root) => isStrictAncestor(path, root));
  }

  #isVisible(path: string): boolean {
    if (path === '/') return true;
    if (isAtOrBelow(path, this.scratchRoot)) return true;
    if (
      BOOTSTRAP_ROOTS.some((root) => isAtOrBelow(path, root))
      || BOOTSTRAP_ROOTS.some((root) => isStrictAncestor(path, root))
    ) return true;
    if (path === this.workspaceRoot) return true;
    const relative = this.#workspaceRelative(path);
    if (!relative || !this.#safeReadableRelative(relative)) return false;
    return this.#visibleWorkspacePaths.has(relative)
      || this.#dynamicWorkspacePaths.has(relative);
  }

  #safeReadableRelative(relative: string): boolean {
    try {
      const path = normalizeWorkspaceRelativePath(relative);
      return pathMatchesAnyRule(path, this.#readable)
        || this.#isRuleAncestor(path, this.#readable)
        || pathMatchesAnyRule(path, this.#writable)
        || this.#isRuleAncestor(path, this.#writable);
    } catch {
      return false;
    }
  }

  #isRuleAncestor(path: string, rules: readonly PathRule[]): boolean {
    return rules.some((rule) => rule.path.startsWith(`${path}/`));
  }

  #mayCreateDirectory(path: string): boolean {
    if (isAtOrBelow(path, this.scratchRoot)) return path !== this.scratchRoot;
    const relative = this.#workspaceRelative(path);
    if (!relative) return false;
    return this.#writable.some((rule) => (
      rule.path.startsWith(`${relative}/`)
      || (rule.kind === 'prefix'
        && (relative === rule.path || relative.startsWith(`${rule.path}/`)))
    ));
  }

  #workspaceRelative(path: string): string | undefined {
    if (!path.startsWith(`${this.workspaceRoot}/`)) return undefined;
    const relative = path.slice(this.workspaceRoot.length + 1);
    try {
      return normalizeWorkspaceRelativePath(relative);
    } catch {
      return undefined;
    }
  }

  #workspacePath(relative: string): string {
    return `${this.workspaceRoot}/${relative}`;
  }

  #addVisibleWorkspacePath(relative: string): void {
    this.#visibleWorkspacePaths.add(relative);
    this.#addVisibleWorkspaceParents(relative);
  }

  #addVisibleWorkspaceParents(relative: string): void {
    const parts = relative.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      this.#visibleWorkspacePaths.add(parts.slice(0, index).join('/'));
    }
  }

  #markDynamic(path: string): void {
    const relative = this.#workspaceRelative(path);
    if (!relative) return;
    this.#dynamicWorkspacePaths.add(relative);
    const parts = relative.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      this.#dynamicWorkspacePaths.add(parts.slice(0, index).join('/'));
    }
  }

  #removeDynamicTree(path: string): void {
    const relative = this.#workspaceRelative(path);
    if (!relative) return;
    for (const candidate of [...this.#dynamicWorkspacePaths]) {
      if (candidate === relative || candidate.startsWith(`${relative}/`)) {
        this.#dynamicWorkspacePaths.delete(candidate);
      }
    }
  }

  #assertBootstrapSystemPath(path: string, operation: string): void {
    if (this.#active) throw permissionDenied(operation, path);
    const normalized = this.#normalizeAbsolute(path);
    if (!BOOTSTRAP_ROOTS.some((root) => isAtOrBelow(normalized, root))) {
      throw permissionDenied(operation, normalized);
    }
  }

  async #assertRegularFile(path: string, operation: string): Promise<void> {
    const stat = await this.#inner.lstat(path);
    assertSafeStat(stat, path, operation);
    if (!stat.isFile) throw new Error(`EISDIR: illegal operation on a directory, ${operation} '${path}'`);
  }

  async #lstatForMutation(
    path: string,
    operation: string,
    missingAllowed = false,
  ): Promise<FsStat | undefined> {
    try {
      const stat = await this.#inner.lstat(path);
      return assertSafeStat(stat, path, operation);
    } catch (error) {
      if (missingAllowed && isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  async #assertTreeMutable(root: string, operation: string): Promise<void> {
    const pending = [root];
    while (pending.length > 0) {
      const path = pending.pop()!;
      this.#assertWritableFile(path, operation);
      const stat = assertSafeStat(await this.#inner.lstat(path), path, operation);
      if (!stat.isDirectory) continue;
      const names = await this.#inner.readdir(path);
      for (const name of names) pending.push(joinAbsolute(path, name));
    }
  }

  async #snapshotReadableTree(
    root: string,
    operation: string,
  ): Promise<Array<
    | { kind: 'directory'; path: string }
    | { kind: 'file'; path: string; record: FileRecord }
  >> {
    const result: Array<
      | { kind: 'directory'; path: string }
      | { kind: 'file'; path: string; record: FileRecord }
    > = [];
    const pending = [root];
    while (pending.length > 0) {
      const path = pending.pop()!;
      this.#assertReadable(path, operation);
      const stat = assertSafeStat(await this.#inner.lstat(path), path, operation);
      if (stat.isDirectory) {
        result.push({ kind: 'directory', path });
        const names = await this.#inner.readdir(path);
        names.sort(comparePaths).reverse();
        for (const name of names) pending.push(joinAbsolute(path, name));
      } else {
        const bytes = await this.#inner.readFileBuffer(path);
        result.push({ kind: 'file', path, record: recordFromBytes(path, bytes, stat.mode & 0o777) });
      }
    }
    return result;
  }

  async #preflightFiles(
    mutate: (files: Map<string, FileRecord>) => void | Promise<void>,
  ): Promise<void> {
    await this.#ensureBaseline();
    const files = await this.#snapshotCandidateAndScratch();
    await mutate(files);
    this.#assertUsage(files);
  }

  async #ensureBaseline(): Promise<void> {
    if (this.#baselineInitialized) return;
    const files = await this.#snapshotCandidateAndScratch();
    this.#baseline = new Map([...files]
      .filter(([path]) => isAtOrBelow(path, this.workspaceRoot))
      .map(([path, record]) => [path, { ...record }]));
    this.#baselineInitialized = true;
  }

  async #snapshotCandidateAndScratch(): Promise<Map<string, FileRecord>> {
    const result = new Map<string, FileRecord>();
    for (const path of this.#inner.getAllPaths()) {
      let normalized: string;
      try {
        normalized = this.#normalizeAbsolute(path);
      } catch {
        continue;
      }
      if (
        !isAtOrBelow(normalized, this.workspaceRoot)
        && !isAtOrBelow(normalized, this.scratchRoot)
      ) continue;
      const stat = assertSafeStat(await this.#inner.lstat(normalized), normalized, 'quota');
      if (!stat.isFile) continue;
      const bytes = await this.#inner.readFileBuffer(normalized);
      result.set(normalized, recordFromBytes(normalized, bytes, stat.mode & 0o777));
    }
    return result;
  }

  #calculateUsage(files: Map<string, FileRecord>): PolicyFsUsage {
    let scratchBytes = 0;
    let candidateBytes = 0;
    let changedFiles = 0;

    for (const record of files.values()) {
      if (isAtOrBelow(record.path, this.scratchRoot)) {
        scratchBytes += record.byteLength;
      }
      if (
        (isAtOrBelow(record.path, this.workspaceRoot)
          || isAtOrBelow(record.path, this.scratchRoot))
        && record.byteLength > this.policy.maxFileBytes
      ) {
        throw new Error(
          `EFBIG: file exceeds ${this.policy.maxFileBytes}-byte policy limit, '${record.path}'`,
        );
      }
    }

    const paths = new Set([
      ...this.#baseline.keys(),
      ...[...files.keys()].filter((path) => isAtOrBelow(path, this.workspaceRoot)),
    ]);
    for (const path of paths) {
      const before = this.#baseline.get(path);
      const after = files.get(path);
      if (before?.sha256 === after?.sha256 && before?.mode === after?.mode) continue;
      changedFiles += 1;
      if (after) candidateBytes += after.byteLength;
    }
    return { changedFiles, candidateBytes, scratchBytes };
  }

  #assertUsage(files: Map<string, FileRecord>): void {
    const usage = this.#calculateUsage(files);
    if (usage.changedFiles > this.policy.maxChangedFiles) {
      throw new Error(
        `ENOSPC: candidate exceeds ${this.policy.maxChangedFiles}-file policy limit`,
      );
    }
    if (usage.candidateBytes > this.policy.maxCandidateBytes) {
      throw new Error(
        `ENOSPC: candidate exceeds ${this.policy.maxCandidateBytes}-byte policy limit`,
      );
    }
    if (usage.scratchBytes > this.maxScratchBytes) {
      throw new Error(
        `ENOSPC: scratch exceeds ${this.maxScratchBytes}-byte policy limit`,
      );
    }
  }
}

function freezeRules(
  input: readonly PathRule[],
  access: 'read' | 'write',
): readonly PathRule[] {
  if (!Array.isArray(input)) throw new Error(`PolicyFs ${access} rules must be an array.`);
  return Object.freeze(input.map((rule) => normalizePathRule(rule, access)));
}

function assertPolicyLimits(policy: WorkspaceChangePolicy): void {
  positiveInteger(policy.maxChangedFiles, 'policy.maxChangedFiles');
  positiveInteger(policy.maxCandidateBytes, 'policy.maxCandidateBytes');
  positiveInteger(policy.maxFileBytes, 'policy.maxFileBytes');
  positiveInteger(policy.maxPathDepth, 'policy.maxPathDepth');
  if (policy.maxFileBytes > policy.maxCandidateBytes) {
    throw new Error('PolicyFs maxFileBytes must not exceed maxCandidateBytes.');
  }
}

function normalizeAbsoluteRoot(path: string, label: string): string {
  if (
    typeof path !== 'string'
    || path.length < 2
    || !path.startsWith('/')
    || path.endsWith('/')
    || path.includes('\0')
    || path.includes('\\')
    || posix.normalize(path) !== path
  ) throw new Error(`PolicyFs ${label} is invalid.`);
  return path;
}

function rootsOverlap(left: string, right: string): boolean {
  return isAtOrBelow(left, right) || isAtOrBelow(right, left);
}

function isAtOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isStrictAncestor(path: string, child: string): boolean {
  return child.startsWith(`${path === '/' ? '' : path}/`);
}

function joinAbsolute(parent: string, child: string): string {
  return parent === '/' ? `/${child}` : `${parent}/${child}`;
}

function mapTreePath(source: string, destination: string, item: string): string {
  return item === source ? destination : `${destination}${item.slice(source.length)}`;
}

function removeTreeRecords(files: Map<string, FileRecord>, root: string): void {
  for (const path of [...files.keys()]) {
    if (isAtOrBelow(path, root)) files.delete(path);
  }
}

function recordFromBytes(
  path: string,
  bytes: Uint8Array,
  mode: number,
): FileRecord {
  return {
    path,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mode,
  };
}

function encodeFileContent(content: FileContent, options?: WriteFileOptions): Uint8Array {
  if (content instanceof Uint8Array) return new Uint8Array(content);
  const encoding = typeof options === 'string' ? options : options?.encoding ?? 'utf8';
  const nodeEncoding = encoding === 'binary' ? 'latin1' : encoding;
  return Buffer.from(content, nodeEncoding);
}

function assertSafeStat(
  stat: FsStat,
  path: string,
  operation: string,
): FsStat {
  if (stat.isSymbolicLink || (!stat.isFile && !stat.isDirectory)) {
    throw notFound(operation, path);
  }
  return stat;
}

async function fallbackDirents(fs: IFileSystem, path: string): Promise<DirentEntries> {
  const names = await fs.readdir(path);
  return Promise.all(names.map(async (name) => {
    const stat = await fs.lstat(joinAbsolute(path, name));
    return {
      name,
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymbolicLink: stat.isSymbolicLink,
    };
  }));
}

function requireSyncBootstrapFs(fs: IFileSystem): SyncBootstrapFileSystem {
  const candidate = fs as IFileSystem & Partial<SyncBootstrapFileSystem>;
  if (typeof candidate.mkdirSync !== 'function' || typeof candidate.writeFileSync !== 'function') {
    throw new Error('Underlying filesystem does not support just-bash bootstrap methods.');
  }
  return candidate as IFileSystem & SyncBootstrapFileSystem;
}

function permissionDenied(operation: string, path: string): Error {
  return new Error(`EACCES: policy denied ${operation}, '${path}'`);
}

function notFound(operation: string, path: string): Error {
  return new Error(`ENOENT: no such projected file or directory, ${operation} '${path}'`);
}

function unsupportedMutation(operation: string, path: string): Error {
  return new Error(`EPERM: unsupported sandbox mutation ${operation}, '${path}'`);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`PolicyFs ${label} must be a positive integer.`);
  }
  return value;
}

function isNotFoundError(error: unknown): boolean {
  return (typeof error === 'object'
      && error !== null
      && (error as { code?: unknown }).code === 'ENOENT')
    || (error instanceof Error && error.message.startsWith('ENOENT:'));
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
