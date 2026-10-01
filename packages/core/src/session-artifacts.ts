import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

export const SESSION_ARTIFACT_FILES = [
  'run.yaml',
  'context-package.yaml',
  'outputs.yaml',
  'proposed-changes.yaml',
  'unresolved.md',
] as const;

export type SessionArtifactFile = typeof SESSION_ARTIFACT_FILES[number];

export type SessionRunStatus = 'running' | 'completed' | 'blocked' | 'failed';

export interface SessionInputSource {
  sourceId: string;
  path?: string;
  hash?: string;
}

export interface SessionRunMetadata {
  sessionId: string;
  capability?: string;
  status: SessionRunStatus;
  startedAt: string;
  updatedAt: string;
  inputSources: SessionInputSource[];
  touchedFiles: string[];
  resumeBoundary?: SessionResumeBoundary;
}

export interface SessionOutputArtifact {
  id: string;
  type: 'assistantText' | 'contextPackage' | 'chapterDraft' | 'reviewReport' | 'settlementBundle' | 'playTranscript' | 'importPreview';
  title: string;
  path?: string;
  summary: string;
}

export const SESSION_PROPOSED_CHANGES_SCHEMA_VERSION = 1 as const;
export const UNSUPPORTED_SESSION_PROPOSED_CHANGES_SCHEMA =
  'UNSUPPORTED_SESSION_PROPOSED_CHANGES_SCHEMA' as const;

export type SessionProposedChangeStatus = 'pending' | 'accepted' | 'rejected';
export type SessionProposedFileOperation = 'create' | 'update' | 'delete';

export interface SessionProposedFileChange {
  operation: SessionProposedFileOperation;
  path: string;
  oldHash?: string;
  newHash?: string;
}

export interface SessionProposedChange {
  id: string;
  title: string;
  status: SessionProposedChangeStatus;
  createdAt: string;
  decidedAt?: string;
  changes: SessionProposedFileChange[];
}

export interface SessionProposedChangesDocument {
  schemaVersion: typeof SESSION_PROPOSED_CHANGES_SCHEMA_VERSION;
  kind: 'session-proposed-changes';
  sessionId: string;
  proposedChanges: SessionProposedChange[];
}

export interface AgentSessionArtifact {
  run: SessionRunMetadata;
  outputs: SessionOutputArtifact[];
  proposedChanges: SessionProposedChange[];
  unresolved: string[];
}

export class SessionProposedChangesSchemaError extends Error {
  readonly code: typeof UNSUPPORTED_SESSION_PROPOSED_CHANGES_SCHEMA;

  constructor(message: string) {
    super(message);
    this.name = 'SessionProposedChangesSchemaError';
    this.code = UNSUPPORTED_SESSION_PROPOSED_CHANGES_SCHEMA;
  }
}

export interface SessionResumeFileSnapshot {
  path: string;
  hash?: string;
  mtimeMs?: number;
  missing: boolean;
}

export interface SessionResumeBoundary {
  sessionId: string;
  capturedAt: string;
  touchedFiles: SessionResumeFileSnapshot[];
}

export interface SessionResumeCheck {
  sessionId: string;
  changedFiles: string[];
  missingFiles: string[];
  prompt: string;
}

export interface AuthorReport {
  status: string;
  candidateOutputs: string[];
  acceptedActions: string[];
  rejectedActions: string[];
  pendingActions: string[];
  unresolvedDecisions: string[];
  nextSuggestedAction: string;
}

export const resolveSessionArtifactPath = (
  workspaceRoot: string,
  sessionId: string,
  file: SessionArtifactFile,
): string => {
  assertSafeSessionId(sessionId);
  assertSessionArtifactFile(file);

  const workspace = resolve(workspaceRoot);
  const artifactPath = resolve(workspace, '.workspace', 'sessions', sessionId, file);
  const artifactRelativePath = relative(workspace, artifactPath);

  if (
    artifactRelativePath.startsWith('..') ||
    artifactRelativePath === '' ||
    artifactRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Session artifact path must stay inside workspace.');
  }

  return artifactPath;
};

export const writeSessionRunMetadata = async (
  workspaceRoot: string,
  metadata: SessionRunMetadata,
): Promise<string> => writeSessionYaml(workspaceRoot, metadata.sessionId, 'run.yaml', metadata);

export const writeSessionOutputs = async (
  workspaceRoot: string,
  sessionId: string,
  outputs: SessionOutputArtifact[],
): Promise<string> => writeSessionYaml(workspaceRoot, sessionId, 'outputs.yaml', { outputs });

export const writeSessionProposedChanges = async (
  workspaceRoot: string,
  sessionId: string,
  proposedChanges: SessionProposedChange[],
): Promise<string> => {
  const document = parseSessionProposedChanges({
    schemaVersion: SESSION_PROPOSED_CHANGES_SCHEMA_VERSION,
    kind: 'session-proposed-changes',
    sessionId,
    proposedChanges,
  });

  return writeSessionYaml(
    workspaceRoot,
    sessionId,
    'proposed-changes.yaml',
    document,
  );
};

export const readSessionProposedChanges = async (
  workspaceRoot: string,
  sessionId: string,
): Promise<SessionProposedChangesDocument> => {
  const filePath = resolveSessionArtifactPath(
    workspaceRoot,
    sessionId,
    'proposed-changes.yaml',
  );
  const value = parse(await readFile(filePath, 'utf-8'));
  const document = parseSessionProposedChanges(value);
  if (document.sessionId !== sessionId) {
    throw new Error('Session proposed changes sessionId does not match its artifact path.');
  }
  return document;
};

export function parseSessionProposedChanges(
  value: unknown,
): SessionProposedChangesDocument {
  if (!isRecord(value)) {
    throwUnsupportedSessionProposedChanges('Session proposed changes must be an object.');
  }
  if (
    value.schemaVersion !== SESSION_PROPOSED_CHANGES_SCHEMA_VERSION
    || value.kind !== 'session-proposed-changes'
  ) {
    throwUnsupportedSessionProposedChanges(
      'Unsupported session proposed changes schemaVersion or kind.',
    );
  }

  assertExactKeys(value, [
    'schemaVersion',
    'kind',
    'sessionId',
    'proposedChanges',
  ], 'Session proposed changes');
  const sessionId = requireSafeSessionId(value.sessionId);
  if (!Array.isArray(value.proposedChanges)) {
    throw new Error('Session proposed changes proposedChanges must be an array.');
  }

  const proposedChanges = value.proposedChanges.map((change, index) =>
    parseSessionProposedChange(change, index));
  assertUnique(
    proposedChanges.map((change) => change.id),
    'Session proposed change id',
  );

  return {
    schemaVersion: SESSION_PROPOSED_CHANGES_SCHEMA_VERSION,
    kind: 'session-proposed-changes',
    sessionId,
    proposedChanges,
  };
}

export const writeSessionUnresolved = async (
  workspaceRoot: string,
  sessionId: string,
  unresolved: string[],
): Promise<string> => {
  const filePath = resolveSessionArtifactPath(workspaceRoot, sessionId, 'unresolved.md');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    ['# Unresolved Decisions', '', ...unresolved.map((item) => `- ${item}`), ''].join('\n'),
    'utf-8',
  );

  return filePath;
};

export const writeAgentSessionArtifact = async (
  workspaceRoot: string,
  artifact: AgentSessionArtifact,
): Promise<string[]> => Promise.all([
  writeSessionRunMetadata(workspaceRoot, artifact.run),
  writeSessionOutputs(workspaceRoot, artifact.run.sessionId, artifact.outputs),
  writeSessionProposedChanges(
    workspaceRoot,
    artifact.run.sessionId,
    artifact.proposedChanges,
  ),
  writeSessionUnresolved(workspaceRoot, artifact.run.sessionId, artifact.unresolved),
]);

export const createSessionResumeBoundary = async (
  workspaceRoot: string,
  sessionId: string,
  touchedFiles: string[],
  capturedAt = new Date().toISOString(),
): Promise<SessionResumeBoundary> => ({
  sessionId,
  capturedAt,
  touchedFiles: await Promise.all(
    touchedFiles.map((file) => snapshotWorkspaceFile(workspaceRoot, file)),
  ),
});

export const createSessionResumeBoundaryFromProposedChanges = async (
  workspaceRoot: string,
  sessionId: string,
  proposedChanges: SessionProposedChange[],
  capturedAt = new Date().toISOString(),
): Promise<SessionResumeBoundary> => createSessionResumeBoundary(
  workspaceRoot,
  sessionId,
  [...new Set(
    proposedChanges.flatMap((proposal) =>
      proposal.changes.map((change) => normalizeSessionChangePath(change.path))),
  )].toSorted(),
  capturedAt,
);

export const checkSessionResumeBoundary = async (
  workspaceRoot: string,
  boundary: SessionResumeBoundary,
  fixedFiles?: ReadonlyArray<{ path: string; hash: string }>,
): Promise<SessionResumeCheck> => {
  const current = fixedFiles ? boundary.touchedFiles.map((file) => {
    const next = fixedFiles.find((entry) => entry.path === file.path);
    return { path: file.path, hash: next?.hash, missing: !next };
  }) : await Promise.all(
    boundary.touchedFiles.map((file) => snapshotWorkspaceFile(workspaceRoot, file.path)),
  );
  const changedFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const snapshot of boundary.touchedFiles) {
    const next = current.find((file) => file.path === snapshot.path);

    if (!next || next.missing) {
      if (!snapshot.missing) missingFiles.push(snapshot.path);
      continue;
    }

    if (snapshot.hash !== next.hash) {
      changedFiles.push(snapshot.path);
    }
  }

  return {
    sessionId: boundary.sessionId,
    changedFiles,
    missingFiles,
    prompt: formatResumePrompt(changedFiles, missingFiles),
  };
};

/** Bounded host-only metadata read; rejects unsafe internal paths and file swaps. */
export async function readSessionResumeBoundary(
  workspaceRoot: string,
  sessionId: string,
): Promise<SessionResumeBoundary | undefined> {
  const path = resolveSessionArtifactPath(workspaceRoot, sessionId, 'run.yaml');
  try {
    let cursor = resolve(workspaceRoot);
    for (const segment of ['.workspace', 'sessions', sessionId, 'run.yaml']) {
      cursor = join(cursor, segment);
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || (segment === 'run.yaml'
        ? !info.isFile() || info.nlink !== 1 || info.size > 1_048_576
        : !info.isDirectory())) throw new Error('Unsafe session resume artifact.');
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let content: string;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > 1_048_576) {
        throw new Error('Unsafe session resume artifact.');
      }
      const buffer = Buffer.alloc(1_048_577);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      const current = await lstat(path);
      if (offset > 1_048_576 || before.size !== offset || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ino !== current.ino
        || before.dev !== current.dev || current.isSymbolicLink()) {
        throw new Error('Session resume artifact changed during read.');
      }
      content = buffer.subarray(0, offset).toString('utf8');
    } finally { await handle.close(); }
    const document = parse(content) as SessionRunMetadata;
    const boundary = document?.resumeBoundary;
    if (!boundary) return undefined;
    if (document.sessionId !== sessionId || boundary.sessionId !== sessionId
      || !Array.isArray(boundary.touchedFiles) || boundary.touchedFiles.length > 10_000) {
      throw new Error('Invalid session resume boundary.');
    }
    for (const file of boundary.touchedFiles) {
      if (!file || typeof file.path !== 'string' || typeof file.missing !== 'boolean'
        || (file.hash !== undefined && !/^[a-f0-9]{64}$/u.test(file.hash))) {
        throw new Error('Invalid session resume file.');
      }
      normalizeSessionChangePath(file.path);
      if (/[\x00-\x1f\x7f]/u.test(file.path)) throw new Error('Unsafe session resume path.');
    }
    return boundary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export const formatAuthorReportMarkdown = (report: AuthorReport): string => [
  '## Author Report',
  '',
  `Status: ${report.status}`,
  '',
  '### Candidate Outputs',
  formatList(report.candidateOutputs),
  '',
  '### Actions',
  `- accepted: ${report.acceptedActions.length}`,
  `- rejected: ${report.rejectedActions.length}`,
  `- pending: ${report.pendingActions.length}`,
  '',
  '### Unresolved Decisions',
  formatList(report.unresolvedDecisions),
  '',
  `Next: ${report.nextSuggestedAction}`,
].join('\n');

async function writeSessionYaml(
  workspaceRoot: string,
  sessionId: string,
  file: SessionArtifactFile,
  value: unknown,
): Promise<string> {
  const filePath = resolveSessionArtifactPath(workspaceRoot, sessionId, file);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, stringify(value), 'utf-8');

  return filePath;
}

async function snapshotWorkspaceFile(
  workspaceRoot: string,
  file: string,
): Promise<SessionResumeFileSnapshot> {
  const filePath = resolveWorkspaceFile(workspaceRoot, file);

  try {
    const [fileStat, content] = await Promise.all([
      stat(filePath),
      readFile(filePath),
    ]);

    return {
      path: file,
      hash: createHash('sha256').update(content).digest('hex'),
      mtimeMs: fileStat.mtimeMs,
      missing: false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path: file,
        missing: true,
      };
    }

    throw error;
  }
}

function resolveWorkspaceFile(workspaceRoot: string, file: string): string {
  const workspace = resolve(workspaceRoot);
  const absoluteFile = resolve(workspace, file);
  const fileRelativePath = relative(workspace, absoluteFile);

  if (
    fileRelativePath.startsWith('..') ||
    fileRelativePath === '' ||
    fileRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Session resume file must stay inside workspace.');
  }

  return absoluteFile;
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }

  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    throw new Error('Invalid session id.');
  }
}

function requireSafeSessionId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Session proposed changes sessionId must be a string.');
  }
  assertSafeSessionId(value);
  return value;
}

function assertSessionArtifactFile(file: SessionArtifactFile): void {
  if (!SESSION_ARTIFACT_FILES.includes(file)) {
    throw new Error('Unsupported session artifact file.');
  }
}

function formatResumePrompt(changedFiles: string[], missingFiles: string[]): string {
  if (!changedFiles.length && !missingFiles.length) {
    return 'No manual file changes detected. Continue from the recorded artifact.';
  }

  return [
    'Manual file changes were detected before resume.',
    'Choose one path: use manual changes, continue from manual changes, or abandon the stale artifact.',
    changedFiles.length ? `Changed: ${changedFiles.join(', ')}` : '',
    missingFiles.length ? `Missing: ${missingFiles.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function parseSessionProposedChange(
  value: unknown,
  index: number,
): SessionProposedChange {
  const label = `Session proposed change ${index}`;
  const record = requireRecord(value, label);
  assertExactKeys(
    record,
    ['id', 'title', 'status', 'createdAt', 'changes'],
    label,
    ['decidedAt'],
  );
  const id = requireOpaqueId(record.id, `${label} id`);
  const title = requireNonEmptyString(record.title, `${label} title`);
  const status = requireEnum(
    record.status,
    ['pending', 'accepted', 'rejected'],
    `${label} status`,
  );
  const createdAt = requireIsoTimestamp(record.createdAt, `${label} createdAt`);
  const decidedAt = record.decidedAt === undefined
    ? undefined
    : requireIsoTimestamp(record.decidedAt, `${label} decidedAt`);
  if (status === 'pending' && decidedAt !== undefined) {
    throw new Error(`${label} pending status must not have decidedAt.`);
  }
  if (status !== 'pending' && decidedAt === undefined) {
    throw new Error(`${label} terminal status requires decidedAt.`);
  }
  if (!Array.isArray(record.changes) || record.changes.length === 0) {
    throw new Error(`${label} changes must be a non-empty array.`);
  }
  const changes = record.changes.map((change, changeIndex) =>
    parseSessionProposedFileChange(change, `${label} file change ${changeIndex}`));
  assertUnique(changes.map((change) => change.path), `${label} path`);

  return {
    id,
    title,
    status,
    createdAt,
    ...(decidedAt ? { decidedAt } : {}),
    changes,
  };
}

function parseSessionProposedFileChange(
  value: unknown,
  label: string,
): SessionProposedFileChange {
  const record = requireRecord(value, label);
  assertExactKeys(record, ['operation', 'path'], label, ['oldHash', 'newHash']);
  const operation = requireEnum(
    record.operation,
    ['create', 'update', 'delete'],
    `${label} operation`,
  );
  const path = normalizeSessionChangePath(
    requireNonEmptyString(record.path, `${label} path`),
  );
  const oldHash = record.oldHash === undefined
    ? undefined
    : requireSha256(record.oldHash, `${label} oldHash`);
  const newHash = record.newHash === undefined
    ? undefined
    : requireSha256(record.newHash, `${label} newHash`);

  if (
    (operation === 'create' && (oldHash !== undefined || newHash === undefined))
    || (operation === 'update' && (oldHash === undefined || newHash === undefined))
    || (operation === 'delete' && (oldHash === undefined || newHash !== undefined))
  ) {
    throw new Error(`${label} hashes do not match ${operation} semantics.`);
  }

  return {
    operation,
    path,
    ...(oldHash ? { oldHash } : {}),
    ...(newHash ? { newHash } : {}),
  };
}

function normalizeSessionChangePath(value: string): string {
  const normalized = value.normalize('NFC');
  const segments = normalized.split('/');
  if (
    value !== normalized
    || normalized.startsWith('/')
    || normalized.endsWith('/')
    || normalized.includes('\\')
    || normalized.includes('\0')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Session proposed change path must be a canonical workspace-relative POSIX path.');
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireOpaqueId(value: unknown, label: string): string {
  const id = requireNonEmptyString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id) || id.includes('..')) {
    throw new Error(`${label} must be a safe opaque id.`);
  }
  return id;
}

function requireEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} is unsupported.`);
  }
  return value as T;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requireNonEmptyString(value, label);
  if (Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return timestamp;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} values must be unique.`);
  }
}

function throwUnsupportedSessionProposedChanges(message: string): never {
  throw new SessionProposedChangesSchemaError(
    `${UNSUPPORTED_SESSION_PROPOSED_CHANGES_SCHEMA}: ${message}`,
  );
}
