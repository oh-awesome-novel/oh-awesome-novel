import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const CANDIDATE_CHANGE_SET_SCHEMA_VERSION = 1 as const;
export const DEFAULT_CREATED_FILE_MODE = 0o644;

export type WorkspaceEditCapability =
  | 'read-only'
  | 'chapter.edit'
  | 'character.edit'
  | 'world.edit'
  | 'state.edit'
  | 'timeline.edit'
  | 'foreshadow.edit'
  | 'summary.edit'
  | 'outline.edit'
  | 'novel.multi-file-edit'
  | 'reference.publish'
  | 'reference.adopt'
  | 'play.adopt';

export interface CandidateChangeSet {
  schemaVersion: typeof CANDIDATE_CHANGE_SET_SCHEMA_VERSION;
  sessionId: string;
  createdAt: string;
  finalizedAt: string;
  projectionFingerprint: string;
  repository: RepositoryBaseline;
  source: CandidateChangeSource;
  /** Immutable trusted-host exact targets used for proposal and Accept validation. */
  allowedTargets: string[];
  changes: CandidateFileChange[];
  stats: {
    created: number;
    updated: number;
    deleted: number;
    changedBytes: number;
  };
}

export type CandidateChangeSource =
  | {
      kind: 'bash-session';
      capability: WorkspaceEditCapability;
      commandLogHash: string;
      commandCount: number;
      finalization: 'explicit-tool' | 'runtime-fallback';
    }
  | {
      kind: 'deterministic-builder';
      producer: string;
      capability: WorkspaceEditCapability;
    };

export type CandidateFileChange =
  | {
      operation: 'create';
      path: string;
      baseline: { exists: false };
      draft: CandidateContent;
    }
  | {
      operation: 'update';
      path: string;
      baseline: ExistingContent;
      draft: CandidateContent;
    }
  | {
      operation: 'delete';
      path: string;
      baseline: ExistingContent;
      draft: null;
    };

export interface ExistingContent {
  exists: true;
  sha256: string;
  byteLength: number;
  mode: number;
}

export interface CandidateContent {
  sha256: string;
  byteLength: number;
  content: string;
}

export interface RepositoryBaseline {
  repositoryId: string;
  branch: string;
  head: string;
}

export interface CandidateFileSnapshot {
  path: string;
  content: string;
  mode?: number;
}

export interface CreateCandidateChangeSetInput {
  sessionId: string;
  createdAt?: string;
  finalizedAt?: string;
  projectionFingerprint: string;
  repository: RepositoryBaseline;
  source: CandidateChangeSource;
  allowedTargets?: readonly string[];
  baselineFiles: readonly CandidateFileSnapshot[];
  finalFiles: readonly CandidateFileSnapshot[];
  candidatePaths?: readonly string[];
}

export function createCandidateChangeSet(
  input: CreateCandidateChangeSetInput,
): CandidateChangeSet | undefined {
  const sessionId = normalizeOpaqueId(input.sessionId, 'Candidate session id');
  const createdAt = normalizeIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'createdAt');
  const finalizedAt = normalizeIsoTimestamp(
    input.finalizedAt ?? new Date().toISOString(),
    'finalizedAt',
  );
  if (Date.parse(finalizedAt) < Date.parse(createdAt)) {
    throw new Error('Candidate finalizedAt must not precede createdAt.');
  }

  const baselineFiles = snapshotsByPath(input.baselineFiles, 'baseline');
  const finalFiles = snapshotsByPath(input.finalFiles, 'final');
  const candidatePaths = input.candidatePaths === undefined
    ? new Set([...baselineFiles.keys(), ...finalFiles.keys()])
    : normalizedUniquePaths(input.candidatePaths, 'candidate');

  const changes: CandidateFileChange[] = [];
  for (const path of [...candidatePaths].sort(comparePaths)) {
    const baseline = baselineFiles.get(path);
    const final = finalFiles.get(path);

    if (!baseline && !final) continue;

    if (!baseline && final) {
      if (final.mode !== DEFAULT_CREATED_FILE_MODE) {
        throw new Error(
          `Created file mode must be ${formatMode(DEFAULT_CREATED_FILE_MODE)}: ${path}`,
        );
      }
      changes.push({
        operation: 'create',
        path,
        baseline: { exists: false },
        draft: candidateContent(final.content),
      });
      continue;
    }

    if (baseline && !final) {
      changes.push({
        operation: 'delete',
        path,
        baseline: existingContent(baseline),
        draft: null,
      });
      continue;
    }

    if (!baseline || !final) {
      throw new Error(`Candidate reconciliation failed for ${path}.`);
    }

    if (baseline.mode !== final.mode) {
      throw new Error(`File mode changes are unsupported: ${path}`);
    }
    if (baseline.content === final.content) continue;

    changes.push({
      operation: 'update',
      path,
      baseline: existingContent(baseline),
      draft: candidateContent(final.content),
    });
  }

  if (changes.length === 0) return undefined;

  const source = normalizeCandidateSource(input.source);
  const allowedTargets = [...normalizedUniquePaths(
    input.allowedTargets ?? changes.map((change) => change.path),
    'allowed target',
  )].sort(comparePaths);
  const allowed = new Set(allowedTargets);
  if (changes.some((change) => !allowed.has(change.path))) {
    throw new Error('Candidate contains a change outside its trusted allowed targets.');
  }
  const repository = normalizeRepositoryBaseline(input.repository);
  const projectionFingerprint = normalizeSha256(
    input.projectionFingerprint,
    'Projection fingerprint',
  );

  return {
    schemaVersion: CANDIDATE_CHANGE_SET_SCHEMA_VERSION,
    sessionId,
    createdAt,
    finalizedAt,
    projectionFingerprint,
    repository,
    source,
    allowedTargets,
    changes,
    stats: {
      created: changes.filter((change) => change.operation === 'create').length,
      updated: changes.filter((change) => change.operation === 'update').length,
      deleted: changes.filter((change) => change.operation === 'delete').length,
      changedBytes: changes.reduce((total, change) => (
        total + (change.operation === 'delete' ? change.baseline.byteLength : change.draft.byteLength)
      ), 0),
    },
  };
}

export function normalizeWorkspaceRelativePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Workspace-relative path is required.');
  }
  assertValidUnicode(value, 'Workspace-relative path');
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`Workspace-relative path contains a control character: ${JSON.stringify(value)}`);
  }
  if (value.includes('\\')) {
    throw new Error(`Workspace-relative path must use POSIX separators: ${value}`);
  }

  const nfc = value.normalize('NFC');
  if (nfc !== value) {
    throw new Error(`Workspace-relative path must be NFC-normalized: ${value}`);
  }
  if (posix.isAbsolute(value) || value.endsWith('/')) {
    throw new Error(`Invalid workspace-relative path: ${value}`);
  }

  const segments = value.split('/');
  if (
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    || posix.normalize(value) !== value
  ) {
    throw new Error(`Invalid workspace-relative path: ${value}`);
  }
  return value;
}

export function assertValidTextContent(content: string, label = 'Candidate content'): void {
  if (typeof content !== 'string') {
    throw new Error(`${label} must be UTF-8 text.`);
  }
  assertValidUnicode(content, label);
  if (content.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes.`);
  }
}

export function sha256Text(content: string): string {
  assertValidTextContent(content, 'Hashed content');
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function fingerprintCandidateChanges(changes: readonly CandidateFileChange[]): string {
  return createHash('sha256')
    .update(JSON.stringify(changes.map((change) => ({
      operation: change.operation,
      path: change.path,
      baseline: change.baseline,
      draft: change.draft && {
        sha256: change.draft.sha256,
        byteLength: change.draft.byteLength,
      },
    }))))
    .digest('hex');
}

export function fingerprintFileSnapshots(
  snapshots: readonly CandidateFileSnapshot[],
): string {
  const normalized = snapshotsByPath(snapshots, 'projection');
  return createHash('sha256')
    .update(JSON.stringify([...normalized.values()]
      .sort((left, right) => comparePaths(left.path, right.path))
      .map((snapshot) => ({
        path: snapshot.path,
        sha256: sha256Text(snapshot.content),
        byteLength: Buffer.byteLength(snapshot.content, 'utf8'),
        mode: snapshot.mode,
      }))))
    .digest('hex');
}

function snapshotsByPath(
  snapshots: readonly CandidateFileSnapshot[],
  label: string,
): Map<string, Required<CandidateFileSnapshot>> {
  if (!Array.isArray(snapshots)) {
    throw new Error(`Candidate ${label} files must be an array.`);
  }

  const result = new Map<string, Required<CandidateFileSnapshot>>();
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error(`Candidate ${label} snapshot must be an object.`);
    }
    const path = normalizeWorkspaceRelativePath(snapshot.path);
    if (result.has(path)) {
      throw new Error(`Duplicate ${label} candidate path: ${path}`);
    }
    assertValidTextContent(snapshot.content, `Candidate ${label} content for ${path}`);
    const mode = normalizeMode(snapshot.mode ?? DEFAULT_CREATED_FILE_MODE, path);
    result.set(path, { path, content: snapshot.content, mode });
  }
  return result;
}

function normalizedUniquePaths(paths: readonly string[], label: string): Set<string> {
  if (!Array.isArray(paths)) {
    throw new Error(`Candidate ${label} paths must be an array.`);
  }
  const result = new Set<string>();
  for (const value of paths) {
    const path = normalizeWorkspaceRelativePath(value);
    if (result.has(path)) {
      throw new Error(`Duplicate ${label} candidate path: ${path}`);
    }
    result.add(path);
  }
  return result;
}

function existingContent(snapshot: Required<CandidateFileSnapshot>): ExistingContent {
  return {
    exists: true,
    sha256: sha256Text(snapshot.content),
    byteLength: Buffer.byteLength(snapshot.content, 'utf8'),
    mode: snapshot.mode,
  };
}

function candidateContent(content: string): CandidateContent {
  return {
    sha256: sha256Text(content),
    byteLength: Buffer.byteLength(content, 'utf8'),
    content,
  };
}

function normalizeMode(mode: number, path: string): number {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o777) {
    throw new Error(`Invalid normalized file mode for ${path}: ${String(mode)}`);
  }
  return mode;
}

function normalizeCandidateSource(source: CandidateChangeSource): CandidateChangeSource {
  if (!source || typeof source !== 'object') {
    throw new Error('Candidate source is required.');
  }
  if (source.kind === 'bash-session') {
    if (!Number.isSafeInteger(source.commandCount) || source.commandCount < 0) {
      throw new Error('Candidate commandCount must be a non-negative integer.');
    }
    if (!['explicit-tool', 'runtime-fallback'].includes(source.finalization)) {
      throw new Error('Candidate bash finalization is invalid.');
    }
    return {
      kind: 'bash-session',
      capability: normalizeCapability(source.capability),
      commandLogHash: normalizeSha256(source.commandLogHash, 'Command log hash'),
      commandCount: source.commandCount,
      finalization: source.finalization,
    };
  }
  if (source.kind === 'deterministic-builder') {
    return {
      kind: 'deterministic-builder',
      producer: normalizeOpaqueId(source.producer, 'Candidate producer'),
      capability: normalizeCapability(source.capability),
    };
  }
  throw new Error('Candidate source kind is invalid.');
}

function normalizeCapability(capability: WorkspaceEditCapability): WorkspaceEditCapability {
  const capabilities: readonly WorkspaceEditCapability[] = [
    'read-only',
    'chapter.edit',
    'character.edit',
    'world.edit',
    'state.edit',
    'timeline.edit',
    'foreshadow.edit',
    'summary.edit',
    'outline.edit',
    'novel.multi-file-edit',
    'reference.publish',
    'reference.adopt',
    'play.adopt',
  ];
  if (!capabilities.includes(capability)) {
    throw new Error(`Unknown workspace edit capability: ${String(capability)}`);
  }
  return capability;
}

function normalizeRepositoryBaseline(repository: RepositoryBaseline): RepositoryBaseline {
  if (!repository || typeof repository !== 'object') {
    throw new Error('Repository baseline is required.');
  }
  return {
    repositoryId: normalizeOpaqueId(repository.repositoryId, 'Repository id'),
    branch: normalizeNonEmpty(repository.branch, 'Repository branch'),
    head: normalizeNonEmpty(repository.head, 'Repository HEAD'),
  };
}

function normalizeOpaqueId(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function normalizeNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  assertValidUnicode(value, label);
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${label} contains a control character.`);
  }
  return value;
}

function normalizeIsoTimestamp(value: string, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Candidate ${label} must be an ISO timestamp.`);
  }
  return new Date(value).toISOString();
}

function normalizeSha256(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function assertValidUnicode(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${label} contains an unpaired UTF-16 surrogate.`);
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${label} contains an unpaired UTF-16 surrogate.`);
    }
  }
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatMode(mode: number): string {
  return `0o${mode.toString(8)}`;
}
