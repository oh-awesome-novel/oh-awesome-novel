import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import {
  lstat,
  open,
  readdir,
  realpath,
} from 'node:fs/promises';
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { InMemoryFs } from 'just-bash';

import {
  normalizeWorkspaceRelativePath,
  sha256Text,
} from './candidate-change-set';
import type { CandidateFileSnapshot } from './candidate-change-set';

export const VIRTUAL_WORKSPACE_ROOT = '/workspace' as const;
export const VIRTUAL_SCRATCH_ROOT = '/tmp' as const;
export const WORKSPACE_PROJECTION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAX_PROJECTION_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_PROJECTION_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_IN_MEMORY_FS_BYTES = 64 * 1024 * 1024;

export interface WorkspaceProjectionPathRule {
  kind: 'exact' | 'prefix';
  path: string;
}

export interface WorkspaceProjectionPolicyLike {
  readable: readonly WorkspaceProjectionPathRule[];
  writable?: readonly WorkspaceProjectionPathRule[];
}

export interface CreateWorkspaceProjectionOptions {
  workspaceRoot: string;
  /**
   * The trusted host-selected projection. `policy` is a convenience for the
   * WorkspaceChangePolicy produced by Task 2; callers must provide exactly one
   * of `rules` or `policy`.
   */
  rules?: readonly WorkspaceProjectionPathRule[];
  policy?: WorkspaceProjectionPolicyLike;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxInMemoryBytes?: number;
}

export interface WorkspaceProjectionManifestFile {
  path: string;
  sha256: string;
  byteLength: number;
  mode: number;
  mtimeMs: number;
}

export interface WorkspaceProjectionManifest {
  schemaVersion: typeof WORKSPACE_PROJECTION_SCHEMA_VERSION;
  rules: readonly WorkspaceProjectionPathRule[];
  files: readonly WorkspaceProjectionManifestFile[];
  directories: readonly string[];
  totalBytes: number;
  fingerprint: string;
}

export interface ProjectionFreshnessResult {
  fresh: boolean;
  expectedFingerprint: string;
  actualFingerprint?: string;
  driftedPaths: readonly string[];
  errorCode?: 'UNSAFE_HOST_PROJECTION';
  reason?: string;
}

export interface WorkspaceProjection {
  workspaceRoot: string;
  fs: InMemoryFs;
  baselineFiles: readonly CandidateFileSnapshot[];
  manifest: WorkspaceProjectionManifest;
  fingerprint: string;
  recheck(): Promise<ProjectionFreshnessResult>;
  assertFresh(): Promise<void>;
}

interface ScannedProjection {
  manifest: WorkspaceProjectionManifest;
  files: Array<WorkspaceProjectionManifestFile & { content: string }>;
  directories: string[];
}

export class WorkspaceProjectionDriftError extends Error {
  readonly code = 'WORKSPACE_PROJECTION_STALE' as const;
  readonly result: ProjectionFreshnessResult;

  constructor(result: ProjectionFreshnessResult) {
    const detail = result.reason
      ?? (result.driftedPaths.length > 0
        ? `host projection drifted at ${result.driftedPaths.join(', ')}`
        : 'host projection fingerprint changed');
    super(`Workspace projection is stale: ${detail}.`);
    this.name = 'WorkspaceProjectionDriftError';
    this.result = result;
  }
}

/**
 * Build one immutable host snapshot. The returned filesystem has no host-backed
 * fallback: all later edits happen only in the InMemoryFs.
 */
export async function createWorkspaceProjection(
  options: CreateWorkspaceProjectionOptions,
): Promise<WorkspaceProjection> {
  const workspaceRoot = await resolveWorkspaceRoot(options.workspaceRoot);
  const rules = normalizeProjectionRules(resolveInputRules(options));
  const limits = normalizeProjectionLimits(options);
  const scanned = await scanHostProjection(workspaceRoot, rules, limits);

  if (limits.maxInMemoryBytes < scanned.manifest.totalBytes) {
    throw new Error(
      `Projection exceeds in-memory filesystem limit (${limits.maxInMemoryBytes} bytes).`,
    );
  }

  const initialFiles = Object.fromEntries(scanned.files.map((file) => [
    toVirtualWorkspacePath(file.path),
    {
      content: file.content,
      mode: file.mode,
    },
  ]));
  const fs = new InMemoryFs(initialFiles, {
    maxTotalBytes: limits.maxInMemoryBytes,
  });

  fs.mkdirSync(VIRTUAL_WORKSPACE_ROOT, { recursive: true });
  fs.mkdirSync(VIRTUAL_SCRATCH_ROOT, { recursive: true });
  for (const directory of virtualProjectionDirectories(scanned, rules)) {
    fs.mkdirSync(toVirtualWorkspacePath(directory), { recursive: true });
  }

  const baselineFiles = Object.freeze(scanned.files.map((file) => Object.freeze({
    path: file.path,
    content: file.content,
    mode: file.mode,
  })));
  const manifest = freezeManifest(scanned.manifest);

  const recheck = async (): Promise<ProjectionFreshnessResult> => {
    let current: ScannedProjection;
    try {
      current = await scanHostProjection(workspaceRoot, rules, limits);
    } catch (error) {
      return {
        fresh: false,
        expectedFingerprint: manifest.fingerprint,
        driftedPaths: [],
        errorCode: 'UNSAFE_HOST_PROJECTION',
        reason: errorMessage(error),
      };
    }

    const driftedPaths = diffManifests(manifest, current.manifest);
    return {
      fresh: current.manifest.fingerprint === manifest.fingerprint,
      expectedFingerprint: manifest.fingerprint,
      actualFingerprint: current.manifest.fingerprint,
      driftedPaths,
    };
  };

  return Object.freeze({
    workspaceRoot,
    fs,
    baselineFiles,
    manifest,
    fingerprint: manifest.fingerprint,
    recheck,
    async assertFresh() {
      const result = await recheck();
      if (!result.fresh) throw new WorkspaceProjectionDriftError(result);
    },
  });
}

/** Strict, byte-preserving UTF-8 decoder used for both host and final VFS files. */
export function decodeWorkspaceText(bytes: Uint8Array, label: string): string {
  let content: string;
  try {
    content = new TextDecoder('utf-8', {
      fatal: true,
      // Preserve an actual UTF-8 BOM so encoding the returned string recreates
      // exactly the bytes that were fingerprinted.
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8 text.`);
  }
  if (content.includes('\0')) {
    throw new Error(`${label} contains a NUL byte.`);
  }
  const encoded = Buffer.from(content, 'utf8');
  if (!encoded.equals(Buffer.from(bytes))) {
    throw new Error(`${label} cannot be represented losslessly as UTF-8 text.`);
  }
  return content;
}

export function toVirtualWorkspacePath(path: string): string {
  return `${VIRTUAL_WORKSPACE_ROOT}/${normalizeWorkspaceRelativePath(path)}`;
}

export function fromVirtualWorkspacePath(path: string): string {
  if (!path.startsWith(`${VIRTUAL_WORKSPACE_ROOT}/`)) {
    throw new Error(`Path is outside ${VIRTUAL_WORKSPACE_ROOT}: ${path}`);
  }
  return normalizeWorkspaceRelativePath(path.slice(VIRTUAL_WORKSPACE_ROOT.length + 1));
}

function resolveInputRules(
  options: CreateWorkspaceProjectionOptions,
): readonly WorkspaceProjectionPathRule[] {
  if ((options.rules === undefined) === (options.policy === undefined)) {
    throw new Error('Provide exactly one of projection rules or a workspace policy.');
  }
  if (options.rules) return options.rules;
  return [
    ...(options.policy?.readable ?? []),
    ...(options.policy?.writable ?? []),
  ];
}

function normalizeProjectionRules(
  input: readonly WorkspaceProjectionPathRule[],
): readonly WorkspaceProjectionPathRule[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Workspace projection requires at least one path rule.');
  }
  const byKey = new Map<string, WorkspaceProjectionPathRule>();
  for (const value of input) {
    if (!value || (value.kind !== 'exact' && value.kind !== 'prefix')) {
      throw new Error('Workspace projection path rule is invalid.');
    }
    const path = normalizeWorkspaceRelativePath(value.path);
    assertProjectionPathMayBeExposed(path);
    byKey.set(`${value.kind}:${path}`, { kind: value.kind, path });
  }
  return Object.freeze([...byKey.values()].sort((left, right) => (
    left.path.localeCompare(right.path, 'en') || left.kind.localeCompare(right.kind, 'en')
  )).map(Object.freeze));
}

function normalizeProjectionLimits(options: CreateWorkspaceProjectionOptions) {
  const maxFileBytes = positiveLimit(
    options.maxFileBytes ?? DEFAULT_MAX_PROJECTION_FILE_BYTES,
    'maxFileBytes',
  );
  const maxTotalBytes = positiveLimit(
    options.maxTotalBytes ?? DEFAULT_MAX_PROJECTION_BYTES,
    'maxTotalBytes',
  );
  const maxInMemoryBytes = positiveLimit(
    options.maxInMemoryBytes ?? DEFAULT_MAX_IN_MEMORY_FS_BYTES,
    'maxInMemoryBytes',
  );
  if (maxFileBytes > maxTotalBytes) {
    throw new Error('Projection maxFileBytes must not exceed maxTotalBytes.');
  }
  return { maxFileBytes, maxTotalBytes, maxInMemoryBytes };
}

async function resolveWorkspaceRoot(input: string): Promise<string> {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new Error('Workspace root is required.');
  }
  const root = await realpath(resolve(input));
  const stat = await lstat(root);
  if (!stat.isDirectory()) throw new Error('Workspace root must be a directory.');
  return root;
}

async function scanHostProjection(
  workspaceRoot: string,
  rules: readonly WorkspaceProjectionPathRule[],
  limits: { maxFileBytes: number; maxTotalBytes: number },
): Promise<ScannedProjection> {
  const discovered = new Map<string, 'file' | 'directory'>();

  for (const rule of rules) {
    const absolute = hostPath(workspaceRoot, rule.path);
    await assertExistingAncestorsAreDirectories(workspaceRoot, absolute, rule.path);
    const stat = await lstatIfExists(absolute);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`Projected source is a symbolic link: ${rule.path}`);
    }
    if (stat.isFile()) {
      discovered.set(rule.path, 'file');
      continue;
    }
    if (!stat.isDirectory()) {
      throw new Error(`Projected source is not a regular file or directory: ${rule.path}`);
    }
    discovered.set(rule.path, 'directory');
    if (rule.kind === 'prefix') {
      await discoverDirectory(workspaceRoot, rule.path, discovered);
    }
  }

  assertNoNfcCollisions(discovered.keys());
  const files: Array<WorkspaceProjectionManifestFile & { content: string }> = [];
  const directories: string[] = [];
  let totalBytes = 0;

  for (const [rawPath, type] of [...discovered].sort(([left], [right]) => comparePaths(left, right))) {
    const path = normalizeWorkspaceRelativePath(rawPath);
    if (type === 'directory') {
      directories.push(path);
      continue;
    }
    const loaded = await readRegularHostFile(
      workspaceRoot,
      path,
      limits.maxFileBytes,
    );
    totalBytes += loaded.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error(
        `Workspace projection exceeds total size limit (${limits.maxTotalBytes} bytes).`,
      );
    }
    files.push(loaded);
  }

  const manifestBase = {
    schemaVersion: WORKSPACE_PROJECTION_SCHEMA_VERSION,
    rules,
    files: files.map(({ content: _content, ...file }) => file),
    directories,
    totalBytes,
  };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(manifestBase))
    .digest('hex');

  return {
    manifest: { ...manifestBase, fingerprint },
    files,
    directories,
  };
}

async function discoverDirectory(
  workspaceRoot: string,
  relativeDirectory: string,
  discovered: Map<string, 'file' | 'directory'>,
): Promise<void> {
  const absoluteDirectory = hostPath(workspaceRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));

  for (const entry of entries) {
    // Hidden data is never implicitly included by a prefix rule. Safe .oan
    // roots have to be named explicitly by the host policy.
    if (entry.name.startsWith('.')) continue;
    const rawPath = `${relativeDirectory}/${entry.name}`;
    const absolute = hostPath(workspaceRoot, rawPath);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`Projected source is a symbolic link: ${rawPath}`);
    }
    if (stat.isFile()) {
      discovered.set(rawPath, 'file');
      continue;
    }
    if (stat.isDirectory()) {
      discovered.set(rawPath, 'directory');
      await discoverDirectory(workspaceRoot, rawPath, discovered);
      continue;
    }
    throw new Error(`Projected source is not a regular file or directory: ${rawPath}`);
  }
}

async function readRegularHostFile(
  workspaceRoot: string,
  path: string,
  maxFileBytes: number,
): Promise<WorkspaceProjectionManifestFile & { content: string }> {
  const absolute = hostPath(workspaceRoot, path);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assertRegularSingleLink(before, path);
    if (before.size > maxFileBytes) {
      throw new Error(
        `Projected source exceeds file size limit (${maxFileBytes} bytes): ${path}`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assertRegularSingleLink(after, path);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || bytes.byteLength !== after.size
    ) {
      throw new Error(`Projected source changed while being read: ${path}`);
    }
    const content = decodeWorkspaceText(bytes, `Projected source ${path}`);
    return {
      path,
      content,
      sha256: sha256Text(content),
      byteLength: bytes.byteLength,
      mode: after.mode & 0o777,
      mtimeMs: after.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

function assertRegularSingleLink(
  stat: Stats,
  path: string,
): void {
  if (!stat.isFile()) {
    throw new Error(`Projected source is not a regular file: ${path}`);
  }
  if (stat.nlink !== 1) {
    throw new Error(`Projected source is a hard-linked file: ${path}`);
  }
}

async function assertExistingAncestorsAreDirectories(
  workspaceRoot: string,
  absolute: string,
  displayPath: string,
): Promise<void> {
  const relativePath = relative(workspaceRoot, absolute);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Projected path escapes the workspace: ${displayPath}`);
  }
  const segments = relativePath.split(sep).filter(Boolean);
  let cursor = workspaceRoot;
  for (let index = 0; index < Math.max(0, segments.length - 1); index += 1) {
    cursor = join(cursor, segments[index]!);
    const stat = await lstatIfExists(cursor);
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      throw new Error(`Projected source has a symbolic-link ancestor: ${displayPath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Projected source has a non-directory ancestor: ${displayPath}`);
    }
  }
}

function assertNoNfcCollisions(paths: Iterable<string>): void {
  const rawByNormalized = new Map<string, string>();
  for (const raw of paths) {
    const normalized = raw.normalize('NFC');
    const existing = rawByNormalized.get(normalized);
    if (existing !== undefined && existing !== raw) {
      throw new Error(`Workspace projection has an NFC path collision: ${existing}, ${raw}`);
    }
    rawByNormalized.set(normalized, raw);
  }
}

function assertProjectionPathMayBeExposed(path: string): void {
  const segments = path.split('/');
  if (segments.includes('.git') || segments.includes('.workspace')) {
    throw new Error(`Internal path cannot be projected: ${path}`);
  }
  if (segments[0] === '.oan') {
    const safe = path === '.oan/workflow.yaml'
      || path === '.oan/constitution'
      || path.startsWith('.oan/constitution/')
      || path === '.oan/skills'
      || path.startsWith('.oan/skills/');
    if (!safe) throw new Error(`Private .oan path cannot be projected: ${path}`);
    return;
  }
  if (segments.some((segment) => segment.startsWith('.'))) {
    throw new Error(`Hidden path cannot be projected: ${path}`);
  }
}

function virtualProjectionDirectories(
  scanned: ScannedProjection,
  rules: readonly WorkspaceProjectionPathRule[],
): string[] {
  const directories = new Set(scanned.directories);
  for (const rule of rules) {
    if (rule.kind === 'prefix') directories.add(rule.path);
    let parent = dirname(rule.path).split(sep).join('/');
    while (parent !== '.' && parent !== '/') {
      directories.add(parent);
      parent = dirname(parent).split(sep).join('/');
    }
  }
  return [...directories].sort(comparePaths);
}

function diffManifests(
  expected: WorkspaceProjectionManifest,
  actual: WorkspaceProjectionManifest,
): string[] {
  const expectedEntries = manifestEntries(expected);
  const actualEntries = manifestEntries(actual);
  const paths = new Set([...expectedEntries.keys(), ...actualEntries.keys()]);
  return [...paths].filter((path) => (
    expectedEntries.get(path) !== actualEntries.get(path)
  )).sort(comparePaths);
}

function manifestEntries(manifest: WorkspaceProjectionManifest): Map<string, string> {
  const result = new Map<string, string>();
  for (const directory of manifest.directories) result.set(directory, 'directory');
  for (const file of manifest.files) {
    result.set(file.path, JSON.stringify(file));
  }
  return result;
}

function freezeManifest(manifest: WorkspaceProjectionManifest): WorkspaceProjectionManifest {
  return Object.freeze({
    ...manifest,
    rules: Object.freeze(manifest.rules.map((rule) => Object.freeze({ ...rule }))),
    files: Object.freeze(manifest.files.map((file) => Object.freeze({ ...file }))),
    directories: Object.freeze([...manifest.directories]),
  });
}

function hostPath(workspaceRoot: string, relativePath: string): string {
  const absolute = resolve(workspaceRoot, ...relativePath.split('/'));
  const hostRelative = relative(workspaceRoot, absolute);
  if (
    hostRelative === ''
    || hostRelative === '..'
    || hostRelative.startsWith(`..${sep}`)
  ) {
    throw new Error(`Projected path escapes the workspace: ${relativePath}`);
  }
  return absolute;
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Workspace projection ${label} must be a positive integer.`);
  }
  return value;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
