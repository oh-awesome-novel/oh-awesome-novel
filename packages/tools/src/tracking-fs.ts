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
  createCandidateChangeSet,
  normalizeWorkspaceRelativePath,
} from './candidate-change-set';
import type {
  CandidateChangeSet,
  CandidateFileSnapshot,
  CreateCandidateChangeSetInput,
} from './candidate-change-set';
import {
  decodeWorkspaceText,
  VIRTUAL_WORKSPACE_ROOT,
} from './workspace-projection';

type ReadFileOptions = Parameters<IFileSystem['readFile']>[1];
type WriteFileOptions = Parameters<IFileSystem['writeFile']>[2];
type DirentEntries = Awaited<ReturnType<NonNullable<IFileSystem['readdirWithFileTypes']>>>;

interface SyncBootstrapFileSystem {
  mkdirSync(path: string, options?: MkdirOptions): void;
  writeFileSync(path: string, content: FileContent, options?: WriteFileOptions): void;
}

export type TrackingMutationOperation =
  | 'writeFile'
  | 'appendFile'
  | 'rm'
  | 'cp'
  | 'mv'
  | 'mkdir'
  | 'chmod'
  | 'symlink'
  | 'link'
  | 'utimes';

export interface TrackingMutation {
  sequence: number;
  operation: TrackingMutationOperation;
  paths: readonly string[];
}

export interface TrackingFsOptions {
  workspaceRoot?: string;
  baselineFiles?: readonly CandidateFileSnapshot[];
}

export interface WorkspaceReconciliation {
  baselineFiles: readonly CandidateFileSnapshot[];
  finalFiles: readonly CandidateFileSnapshot[];
  /** The authoritative changed path set, derived from baseline/final bytes. */
  candidatePaths: readonly string[];
}

export type FinalizeTrackedWorkspaceInput = Omit<
  CreateCandidateChangeSetInput,
  'baselineFiles' | 'finalFiles' | 'candidatePaths'
>;

/**
 * An exhaustive IFileSystem decorator. Its log is audit/diagnostic data only;
 * reconciliation always scans the final workspace and compares actual bytes.
 */
export class TrackingFs implements IFileSystem {
  readonly inner: IFileSystem;
  readonly workspaceRoot: string;

  #active = false;
  #sequence = 0;
  #mutations: TrackingMutation[] = [];
  #baselineFiles: readonly CandidateFileSnapshot[];

  constructor(inner: IFileSystem, options: TrackingFsOptions = {}) {
    this.inner = inner;
    this.workspaceRoot = normalizeVirtualRoot(
      options.workspaceRoot ?? VIRTUAL_WORKSPACE_ROOT,
    );
    this.#baselineFiles = freezeSnapshots(options.baselineFiles ?? []);
  }

  get active(): boolean {
    return this.#active;
  }

  activate(): void {
    this.#active = true;
  }

  getMutationLog(): readonly TrackingMutation[] {
    return Object.freeze(this.#mutations.map((mutation) => Object.freeze({
      ...mutation,
      paths: Object.freeze([...mutation.paths]),
    })));
  }

  getCandidatePaths(): readonly string[] {
    const paths = new Set<string>();
    for (const mutation of this.#mutations) {
      for (const path of mutation.paths) {
        const relative = tryFromWorkspacePath(path, this.workspaceRoot);
        if (relative) paths.add(relative);
      }
    }
    return Object.freeze([...paths].sort(comparePaths));
  }

  setBaselineFiles(files: readonly CandidateFileSnapshot[]): void {
    if (this.#mutations.length > 0) {
      throw new Error('TrackingFs baseline cannot change after a mutation.');
    }
    this.#baselineFiles = freezeSnapshots(files);
  }

  async reconcileWorkspace(): Promise<WorkspaceReconciliation> {
    const baselineFiles = freezeSnapshots(this.#baselineFiles);
    const finalFiles = freezeSnapshots(await scanWorkspaceFiles(
      this.inner,
      this.workspaceRoot,
    ));
    const baseline = new Map(baselineFiles.map((file) => [file.path, file]));
    const final = new Map(finalFiles.map((file) => [file.path, file]));
    const paths = new Set([...baseline.keys(), ...final.keys()]);
    const candidatePaths = [...paths].filter((path) => {
      const before = baseline.get(path);
      const after = final.get(path);
      return before?.content !== after?.content || before?.mode !== after?.mode;
    }).sort(comparePaths);

    return Object.freeze({
      baselineFiles,
      finalFiles,
      candidatePaths: Object.freeze(candidatePaths),
    });
  }

  async finalize(
    input: FinalizeTrackedWorkspaceInput,
  ): Promise<CandidateChangeSet | undefined> {
    const reconciliation = await this.reconcileWorkspace();
    return createCandidateChangeSet({
      ...input,
      baselineFiles: reconciliation.baselineFiles,
      finalFiles: reconciliation.finalFiles,
      candidatePaths: reconciliation.candidatePaths,
    });
  }

  readFile(path: string, options?: ReadFileOptions): Promise<string> {
    return this.inner.readFile(path, options);
  }

  async readFileBytes(path: string): Promise<ByteString> {
    if (this.inner.readFileBytes) return this.inner.readFileBytes(path);
    const bytes = await this.inner.readFileBuffer(path);
    return Buffer.from(bytes).toString('latin1') as ByteString;
  }

  readFileBuffer(path: string): Promise<Uint8Array> {
    return this.inner.readFileBuffer(path);
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions,
  ): Promise<void> {
    const existingMode = await this.inner.exists(path)
      ? (await this.inner.stat(path)).mode & 0o777
      : undefined;
    await this.inner.writeFile(path, content, options);
    // InMemoryFs resets overwritten files to 0o644. Content writes must retain
    // the projected mode, including Windows' 0o666 and private POSIX files.
    if (existingMode !== undefined) {
      await this.inner.chmod(path, existingMode);
    }
    this.#record('writeFile', path);
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions,
  ): Promise<void> {
    await this.inner.appendFile(path, content, options);
    this.#record('appendFile', path);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  stat(path: string): Promise<FsStat> {
    return this.inner.stat(path);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.inner.mkdir(path, options);
    this.#record('mkdir', path);
  }

  readdir(path: string): Promise<string[]> {
    return this.inner.readdir(path);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntries> {
    if (this.inner.readdirWithFileTypes) {
      return this.inner.readdirWithFileTypes(path);
    }
    const names = await this.inner.readdir(path);
    return Promise.all(names.map(async (name) => {
      const child = joinVirtualPath(path, name);
      const stat = await this.inner.lstat(child);
      return {
        name,
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
        isSymbolicLink: stat.isSymbolicLink,
      };
    }));
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    await this.inner.rm(path, options);
    this.#record('rm', path);
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.inner.cp(src, dest, options);
    this.#record('cp', src, dest);
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.inner.mv(src, dest);
    this.#record('mv', src, dest);
  }

  resolvePath(base: string, path: string): string {
    return this.inner.resolvePath(base, path);
  }

  getAllPaths(): string[] {
    return [...this.inner.getAllPaths()];
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.inner.chmod(path, mode);
    this.#record('chmod', path);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    await this.inner.symlink(target, linkPath);
    this.#record('symlink', target, linkPath);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.inner.link(existingPath, newPath);
    this.#record('link', existingPath, newPath);
  }

  readlink(path: string): Promise<string> {
    return this.inner.readlink(path);
  }

  lstat(path: string): Promise<FsStat> {
    return this.inner.lstat(path);
  }

  realpath(path: string): Promise<string> {
    return this.inner.realpath(path);
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    await this.inner.utimes(path, atime, mtime);
    this.#record('utimes', path);
  }

  /** just-bash constructor bootstrap extension; intentionally outside IFileSystem. */
  mkdirSync(path: string, options?: MkdirOptions): void {
    if (this.#active) throw syncMutationDenied(path);
    const sync = requireSyncBootstrapFs(this.inner);
    sync.mkdirSync(path, options);
  }

  /** just-bash constructor bootstrap extension; intentionally outside IFileSystem. */
  writeFileSync(
    path: string,
    content: FileContent,
    options?: WriteFileOptions,
  ): void {
    if (this.#active) throw syncMutationDenied(path);
    const sync = requireSyncBootstrapFs(this.inner);
    sync.writeFileSync(path, content, options);
  }

  #record(operation: TrackingMutationOperation, ...paths: string[]): void {
    if (!this.#active) return;
    this.#mutations.push(Object.freeze({
      sequence: ++this.#sequence,
      operation,
      paths: Object.freeze([...paths]),
    }));
  }
}

async function scanWorkspaceFiles(
  fs: IFileSystem,
  workspaceRoot: string,
): Promise<CandidateFileSnapshot[]> {
  if (!await fs.exists(workspaceRoot)) return [];
  const result: CandidateFileSnapshot[] = [];
  const pending = [workspaceRoot];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) throw new Error(`VFS traversal cycle detected: ${path}`);
    seen.add(path);
    const stat = await fs.lstat(path);
    if (stat.isSymbolicLink) {
      throw new Error(`Final workspace contains a symbolic link: ${path}`);
    }
    if (stat.isDirectory) {
      const children = await fs.readdir(path);
      children.sort(comparePaths).reverse();
      for (const child of children) pending.push(joinVirtualPath(path, child));
      continue;
    }
    if (!stat.isFile) {
      throw new Error(`Final workspace contains a non-regular file: ${path}`);
    }
    const relative = fromWorkspacePath(path, workspaceRoot);
    const bytes = await fs.readFileBuffer(path);
    const content = decodeWorkspaceText(bytes, `Final candidate ${relative}`);
    result.push({
      path: relative,
      content,
      mode: stat.mode & 0o777,
    });
  }

  return result.sort((left, right) => comparePaths(left.path, right.path));
}

function freezeSnapshots(
  files: readonly CandidateFileSnapshot[],
): readonly CandidateFileSnapshot[] {
  const seen = new Set<string>();
  const snapshots = files.map((file) => {
    const path = normalizeWorkspaceRelativePath(file.path);
    if (seen.has(path)) throw new Error(`Duplicate tracking baseline path: ${path}`);
    seen.add(path);
    return Object.freeze({
      path,
      content: file.content,
      mode: file.mode ?? 0o644,
    });
  }).sort((left, right) => comparePaths(left.path, right.path));
  return Object.freeze(snapshots);
}

function normalizeVirtualRoot(path: string): string {
  if (!path.startsWith('/') || path.length < 2 || path.endsWith('/') || path.includes('\0')) {
    throw new Error(`TrackingFs workspace root is invalid: ${path}`);
  }
  const segments = path.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`TrackingFs workspace root is invalid: ${path}`);
  }
  return path;
}

function fromWorkspacePath(path: string, root: string): string {
  const relative = tryFromWorkspacePath(path, root);
  if (!relative) throw new Error(`Path is outside tracked workspace: ${path}`);
  return relative;
}

function tryFromWorkspacePath(path: string, root: string): string | undefined {
  if (!path.startsWith(`${root}/`)) return undefined;
  return normalizeWorkspaceRelativePath(path.slice(root.length + 1));
}

function joinVirtualPath(parent: string, child: string): string {
  return parent === '/' ? `/${child}` : `${parent}/${child}`;
}

function requireSyncBootstrapFs(fs: IFileSystem): SyncBootstrapFileSystem {
  const candidate = fs as IFileSystem & Partial<SyncBootstrapFileSystem>;
  if (typeof candidate.mkdirSync !== 'function' || typeof candidate.writeFileSync !== 'function') {
    throw new Error('Underlying filesystem does not support just-bash bootstrap methods.');
  }
  return candidate as IFileSystem & SyncBootstrapFileSystem;
}

function syncMutationDenied(path: string): Error {
  return new Error(`EACCES: synchronous filesystem mutation is frozen, '${path}'`);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
