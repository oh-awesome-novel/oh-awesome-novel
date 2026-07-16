import { link, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import type { ContextSourceRef } from './agent-context-package.js';
import {
  fingerprintPlayOutcomeReport,
  readPlayOutcomeReport,
} from './play-outcome.js';
import type {
  PlayOutcomeItem,
  PlayOutcomeReport,
  PlayOutcomeSourceSnapshot,
} from './play-outcome.js';

export const PLAY_WRITING_REFERENCE_SCHEMA_VERSION = 1 as const;
export const PLAY_WRITING_REFERENCES_DIRECTORY = 'writing-references' as const;
export const MAX_PLAY_WRITING_REFERENCE_ITEMS = 24 as const;
export const MAX_PLAY_WRITING_REFERENCE_CONTEXT_CHARS = 64 * 1024;

export type PlayWritingReferenceStatus = 'active' | 'detached' | 'stale';

export interface PlayWritingReferenceAttachment {
  schemaVersion: typeof PLAY_WRITING_REFERENCE_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  reportRef: string;
  reportFingerprint: string;
  selectedOutcomeItemRefs: string[];
  selectedArtifactTurnRefs: string[];
  evidenceClosureRefs: string[];
  sourceSnapshots: PlayOutcomeSourceSnapshot[];
  status: PlayWritingReferenceStatus;
  createdAt: string;
  detachedAt?: string;
}

export interface CreatePlayWritingReferenceAttachmentInput {
  id: string;
  sessionId: string;
  selectedOutcomeItemRefs: string[];
  createdAt?: string;
}

export interface DetachPlayWritingReferenceAttachmentOptions {
  detachedAt?: string;
}

export interface ValidatedPlayWritingReferenceAttachment {
  attachment: PlayWritingReferenceAttachment;
  report: PlayOutcomeReport;
  items: PlayOutcomeItem[];
}

export interface PlayWritingReferenceContext
  extends ValidatedPlayWritingReferenceAttachment {
  content: string;
  sourceRef: ContextSourceRef;
}

export function resolvePlayWritingReferenceAttachmentPath(
  workspaceRoot: string,
  attachmentIdValue: string,
): string {
  const attachmentId = assertSafeId(
    attachmentIdValue,
    'Play writing reference attachment id',
  );
  const workspace = resolve(workspaceRoot);
  const path = resolve(
    workspace,
    '.workspace',
    PLAY_WRITING_REFERENCES_DIRECTORY,
    `${attachmentId}.yaml`,
  );
  assertPathInside(workspace, path, 'Play writing reference attachment');
  return path;
}

export async function createPlayWritingReferenceAttachment(
  workspaceRoot: string,
  input: CreatePlayWritingReferenceAttachmentInput,
): Promise<PlayWritingReferenceAttachment> {
  const id = assertSafeId(input.id, 'Play writing reference attachment id');
  const sessionId = assertSafeId(input.sessionId, 'Play writing reference sessionId');
  const selectedOutcomeItemRefs = normalizeIdList(
    input.selectedOutcomeItemRefs,
    'Play writing reference selectedOutcomeItemRefs',
  );
  if (!selectedOutcomeItemRefs.length) {
    throw new Error('Play writing reference requires at least one outcome item.');
  }
  if (selectedOutcomeItemRefs.length > MAX_PLAY_WRITING_REFERENCE_ITEMS) {
    throw new Error(
      `Play writing reference can select at most ${MAX_PLAY_WRITING_REFERENCE_ITEMS} outcome items.`,
    );
  }
  const outcome = await readPlayOutcomeReport(workspaceRoot, sessionId);
  if (outcome.status !== 'current') {
    throw new Error(
      `Play writing reference cannot attach a stale outcome report: ${outcome.staleReasons.join(', ')}.`,
    );
  }
  const itemById = new Map(outcome.report.items.map((item) => [item.id, item]));
  const items = selectedOutcomeItemRefs.map((itemRef) => {
    const item = itemById.get(itemRef);
    if (!item) {
      throw new Error(`Play writing reference references unknown outcome item: ${itemRef}.`);
    }
    return item;
  });
  const attachment = normalizePlayWritingReferenceAttachment({
    schemaVersion: PLAY_WRITING_REFERENCE_SCHEMA_VERSION,
    id,
    sessionId,
    reportRef: createOutcomeReportRef(sessionId),
    reportFingerprint: fingerprintPlayOutcomeReport(outcome.report),
    selectedOutcomeItemRefs,
    selectedArtifactTurnRefs: [...outcome.report.selectedArtifactTurnRefs],
    evidenceClosureRefs: createEvidenceClosureRefs(items),
    sourceSnapshots: structuredClone(outcome.report.sourceSnapshots),
    status: 'active',
    createdAt: normalizeTimestamp(
      input.createdAt ?? new Date().toISOString(),
      'Play writing reference createdAt',
    ),
  });
  await ensurePlayWritingReferencesRoot(workspaceRoot, true);
  await writeCreateOnlyAttachmentAtomically(
    resolvePlayWritingReferenceAttachmentPath(workspaceRoot, id),
    stringify(attachment),
  );
  return attachment;
}

export async function readPlayWritingReferenceAttachment(
  workspaceRoot: string,
  attachmentId: string,
): Promise<PlayWritingReferenceAttachment> {
  const attachment = await readStoredAttachment(workspaceRoot, attachmentId);
  if (attachment.status === 'detached' || attachment.status === 'stale') {
    return attachment;
  }
  try {
    const outcome = await readPlayOutcomeReport(workspaceRoot, attachment.sessionId);
    const itemRefs = new Set(outcome.report.items.map((item) => item.id));
    const stale = outcome.status === 'stale' ||
      attachment.reportRef !== createOutcomeReportRef(attachment.sessionId) ||
      attachment.reportFingerprint !== fingerprintPlayOutcomeReport(outcome.report) ||
      !isDeepStrictEqual(
        attachment.selectedArtifactTurnRefs,
        outcome.report.selectedArtifactTurnRefs,
      ) ||
      !isDeepStrictEqual(attachment.sourceSnapshots, outcome.report.sourceSnapshots) ||
      attachment.selectedOutcomeItemRefs.some((itemRef) => !itemRefs.has(itemRef)) ||
      !isDeepStrictEqual(
        attachment.evidenceClosureRefs,
        createEvidenceClosureRefs(attachment.selectedOutcomeItemRefs.map((itemRef) =>
          outcome.report.items.find((item) => item.id === itemRef)!)),
      );
    return stale ? { ...attachment, status: 'stale' } : attachment;
  } catch {
    return { ...attachment, status: 'stale' };
  }
}

export async function listPlayWritingReferenceAttachments(
  workspaceRoot: string,
): Promise<PlayWritingReferenceAttachment[]> {
  const root = await ensurePlayWritingReferencesRoot(workspaceRoot, false);
  if (!root) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const ids = entries.flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) return [];
    const id = entry.name.slice(0, -'.yaml'.length);
    try {
      assertSafeId(id, 'Play writing reference attachment id');
      return [id];
    } catch {
      return [];
    }
  });
  const attachments = await Promise.all(ids.map((id) =>
    readPlayWritingReferenceAttachment(workspaceRoot, id)));
  return attachments.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

export async function detachPlayWritingReferenceAttachment(
  workspaceRoot: string,
  attachmentId: string,
  options: DetachPlayWritingReferenceAttachmentOptions = {},
): Promise<PlayWritingReferenceAttachment> {
  const stored = await readStoredAttachment(workspaceRoot, attachmentId);
  if (stored.status === 'detached') return stored;
  const detached = normalizePlayWritingReferenceAttachment({
    ...stored,
    status: 'detached',
    detachedAt: normalizeTimestamp(
      options.detachedAt ?? new Date().toISOString(),
      'Play writing reference detachedAt',
    ),
  });
  await writeReplaceAtomically(
    resolvePlayWritingReferenceAttachmentPath(workspaceRoot, attachmentId),
    stringify(detached),
  );
  return detached;
}

export async function validatePlayWritingReferenceAttachment(
  workspaceRoot: string,
  attachmentId: string,
): Promise<ValidatedPlayWritingReferenceAttachment> {
  const attachment = await readPlayWritingReferenceAttachment(
    workspaceRoot,
    attachmentId,
  );
  if (attachment.status !== 'active') {
    throw new Error(
      `Play writing reference attachment ${attachment.id} is ${attachment.status}.`,
    );
  }
  const outcome = await readPlayOutcomeReport(workspaceRoot, attachment.sessionId);
  if (outcome.status !== 'current') {
    throw new Error(`Play writing reference attachment ${attachment.id} is stale.`);
  }
  const itemById = new Map(outcome.report.items.map((item) => [item.id, item]));
  const items = attachment.selectedOutcomeItemRefs.map((itemRef) => {
    const item = itemById.get(itemRef);
    if (!item) {
      throw new Error(
        `Play writing reference attachment ${attachment.id} is missing item ${itemRef}.`,
      );
    }
    return structuredClone(item);
  });
  return {
    attachment,
    report: outcome.report,
    items,
  };
}

export async function formatPlayWritingReferenceContext(
  workspaceRoot: string,
  attachmentId: string,
): Promise<PlayWritingReferenceContext> {
  const validated = await validatePlayWritingReferenceAttachment(
    workspaceRoot,
    attachmentId,
  );
  const header = [
    '# Explicit Play Writing Reference',
    '',
    `Attachment: ${validated.attachment.id}`,
    `Play session: ${validated.attachment.sessionId}`,
    `Selected committed branch: ${formatContextRefs(validated.attachment.selectedArtifactTurnRefs, ' -> ')}`,
    '',
    'Use only the selected evidence-backed outcome items below. This attachment is noncanonical; any target-file edit still requires PendingAction approval.',
    '',
  ].join('\n');
  const itemBlocks = validated.items.map((item) => boundContextBlock([
      `## ${item.id} [${item.kind}/${item.visibility}/${item.confidence}]`,
      item.summary,
      `Tags: ${item.tags.join(', ')}`,
      `Artifact turns: ${formatRefs(item.artifactTurnRefs)}`,
      `Messages: ${formatRefs(item.messageRefs)}`,
      `Events: ${formatRefs(item.eventRefs)}`,
      `Observations: ${formatRefs(item.observationRefs)}`,
      `Evidence: ${formatRefs(item.evidenceRefs)}`,
      `Sources: ${formatRefs(item.sourceRefs)}`,
      `Participants: ${formatRefs(item.participantRefs)}`,
      '',
    ].join('\n')));
  const selectedBlocks: string[] = [];
  let usedChars = header.length;
  for (const block of itemBlocks) {
    if (usedChars + block.length + 1 > MAX_PLAY_WRITING_REFERENCE_CONTEXT_CHARS) {
      break;
    }
    selectedBlocks.push(block);
    usedChars += block.length + 1;
  }
  let omittedCount = itemBlocks.length - selectedBlocks.length;
  let omission = omittedCount
    ? `\n[Context budget omitted ${omittedCount} selected Play outcome item(s); the attachment remains the audit source.]\n`
    : '';
  while (
    omission &&
    header.length + selectedBlocks.join('\n').length + omission.length >
      MAX_PLAY_WRITING_REFERENCE_CONTEXT_CHARS
  ) {
    selectedBlocks.pop();
    omittedCount = itemBlocks.length - selectedBlocks.length;
    omission = `\n[Context budget omitted ${omittedCount} selected Play outcome item(s); the attachment remains the audit source.]\n`;
  }
  const content = `${header}${selectedBlocks.join('\n')}${omission}`;
  const sourceRef: ContextSourceRef = {
    sourceId: `playWritingReference:${validated.attachment.id}`,
    reason: `Explicit Play outcome attachment ${validated.attachment.id} selected for this writing request.`,
    budgetLayer: 'L2',
    semanticBoundary: 'compressible',
    path: validated.attachment.reportRef,
    title: `Play Writing Reference: ${validated.attachment.id}`,
  };
  return { ...validated, content, sourceRef };
}

export function normalizePlayWritingReferenceAttachment(
  value: unknown,
): PlayWritingReferenceAttachment {
  const record = requireRecord(value, 'Play writing reference attachment');
  assertOnlyKnownFields(record, [
    'schemaVersion',
    'id',
    'sessionId',
    'reportRef',
    'reportFingerprint',
    'selectedOutcomeItemRefs',
    'selectedArtifactTurnRefs',
    'evidenceClosureRefs',
    'sourceSnapshots',
    'status',
    'createdAt',
    'detachedAt',
  ]);
  if (record.schemaVersion !== PLAY_WRITING_REFERENCE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Play writing reference schemaVersion: ${String(record.schemaVersion)}.`,
    );
  }
  if (
    record.status !== 'active' &&
    record.status !== 'detached' &&
    record.status !== 'stale'
  ) {
    throw new Error('Play writing reference attachment has invalid status.');
  }
  if (
    (record.status === 'detached') !== (record.detachedAt !== undefined)
  ) {
    throw new Error(
      'A detached Play writing reference must have detachedAt, and active/stale references must not.',
    );
  }
  const sourceSnapshots = requireArray(
    record.sourceSnapshots,
    'Play writing reference sourceSnapshots',
  ).map(normalizeSourceSnapshot);
  assertUnique(sourceSnapshots.map((source) => source.sourceId), 'source id');
  const selectedOutcomeItemRefs = normalizeIdList(
    record.selectedOutcomeItemRefs,
    'Play writing reference selectedOutcomeItemRefs',
  );
  if (!selectedOutcomeItemRefs.length) {
    throw new Error('Play writing reference requires selected outcome items.');
  }
  if (selectedOutcomeItemRefs.length > MAX_PLAY_WRITING_REFERENCE_ITEMS) {
    throw new Error(
      `Play writing reference can select at most ${MAX_PLAY_WRITING_REFERENCE_ITEMS} outcome items.`,
    );
  }
  const sessionId = assertSafeId(
    record.sessionId,
    'Play writing reference sessionId',
  );
  const reportRef = normalizeReportRef(record.reportRef);
  if (reportRef !== createOutcomeReportRef(sessionId)) {
    throw new Error(
      'Play writing reference reportRef must belong to its attachment session.',
    );
  }
  const selectedArtifactTurnRefs = normalizeIdList(
    record.selectedArtifactTurnRefs,
    'Play writing reference selectedArtifactTurnRefs',
  );
  if (!selectedArtifactTurnRefs.length) {
    throw new Error(
      'Play writing reference requires a non-empty selected artifact branch.',
    );
  }
  const evidenceClosureRefs = normalizeEvidenceClosureRefs(
    record.evidenceClosureRefs,
  );
  const artifactClosureRefs = evidenceClosureRefs
    .filter((ref) => ref.startsWith('artifact:'))
    .map((ref) => ref.slice('artifact:'.length));
  if (!artifactClosureRefs.length) {
    throw new Error(
      'Play writing reference evidence closure requires artifact evidence.',
    );
  }
  const selectedArtifactRefSet = new Set(selectedArtifactTurnRefs);
  const foreignArtifactRef = artifactClosureRefs.find((ref) =>
    !selectedArtifactRefSet.has(ref));
  if (foreignArtifactRef) {
    throw new Error(
      `Play writing reference evidence closure contains an out-of-branch artifact: ${foreignArtifactRef}.`,
    );
  }
  return {
    schemaVersion: PLAY_WRITING_REFERENCE_SCHEMA_VERSION,
    id: assertSafeId(record.id, 'Play writing reference attachment id'),
    sessionId,
    reportRef,
    reportFingerprint: normalizeHash(record.reportFingerprint),
    selectedOutcomeItemRefs,
    selectedArtifactTurnRefs,
    evidenceClosureRefs,
    sourceSnapshots,
    status: record.status,
    createdAt: normalizeTimestamp(
      record.createdAt,
      'Play writing reference createdAt',
    ),
    ...(record.detachedAt === undefined
      ? {}
      : {
          detachedAt: normalizeTimestamp(
            record.detachedAt,
            'Play writing reference detachedAt',
          ),
        }),
  };
}

async function readStoredAttachment(
  workspaceRoot: string,
  attachmentId: string,
): Promise<PlayWritingReferenceAttachment> {
  await ensurePlayWritingReferencesRoot(workspaceRoot, false);
  const path = resolvePlayWritingReferenceAttachmentPath(workspaceRoot, attachmentId);
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Play writing reference attachment must be a regular file.');
  }
  const attachment = normalizePlayWritingReferenceAttachment(
    parse(await readFile(path, 'utf-8')),
  );
  if (attachment.id !== attachmentId) {
    throw new Error(
      `Play writing reference filename/id mismatch: expected ${attachmentId}.`,
    );
  }
  return attachment;
}

async function ensurePlayWritingReferencesRoot(
  workspaceRoot: string,
  create: boolean,
): Promise<string | undefined> {
  const workspace = resolve(workspaceRoot);
  const root = resolve(
    workspace,
    '.workspace',
    PLAY_WRITING_REFERENCES_DIRECTORY,
  );
  assertPathInside(workspace, root, 'Play writing references');
  if (create) await mkdir(root, { recursive: true });
  let stats;
  try {
    stats = await lstat(root);
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Play writing references root must be a real directory.');
  }
  const [realWorkspace, realRoot] = await Promise.all([
    realpath(workspace),
    realpath(root),
  ]);
  assertPathInside(realWorkspace, realRoot, 'Play writing references');
  return root;
}

function createEvidenceClosureRefs(items: readonly PlayOutcomeItem[]): string[] {
  return dedupe(items.flatMap((item) => [
    ...item.artifactTurnRefs.map((ref) => `artifact:${ref}`),
    ...item.messageRefs.map((ref) => `message:${ref}`),
    ...item.eventRefs.map((ref) => `event:${ref}`),
    ...item.observationRefs.map((ref) => `observation:${ref}`),
    ...item.evidenceRefs.map((ref) => `evidence:${ref}`),
    ...item.sourceRefs.map((ref) => `source:${ref}`),
    ...item.participantRefs.map((ref) => `participant:${ref}`),
  ]));
}

function createOutcomeReportRef(sessionId: string): string {
  assertSafeId(sessionId, 'Play writing reference sessionId');
  return `.workspace/play-sessions/${sessionId}/reports/outcome.yaml`;
}

function normalizeReportRef(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\.workspace\/play-sessions\/[A-Za-z0-9][A-Za-z0-9._-]*\/reports\/outcome\.yaml$/u
      .test(value) ||
    value.includes('..') ||
    value.includes('\\')
  ) {
    throw new Error('Play writing reference reportRef is invalid.');
  }
  return value;
}

async function writeCreateOnlyAttachmentAtomically(
  path: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, ensureNewline(content), {
      encoding: 'utf-8',
      flag: 'wx',
    });
    await link(tempPath, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Play writing reference attachment already exists: ${basename(path, '.yaml')}.`);
    }
    throw error;
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function writeReplaceAtomically(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, ensureNewline(content), {
      encoding: 'utf-8',
      flag: 'wx',
    });
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function normalizeSourceSnapshot(value: unknown): PlayOutcomeSourceSnapshot {
  const record = requireRecord(value, 'Play writing reference source snapshot');
  assertOnlyKnownFields(record, ['sourceId', 'path', 'contentHash']);
  const path = record.path === undefined
    ? undefined
    : normalizeText(record.path, 'Play writing reference source path', 4_096);
  const contentHash = record.contentHash === undefined
    ? undefined
    : normalizeHash(record.contentHash);
  return {
    sourceId: normalizeText(record.sourceId, 'Play writing reference sourceId', 512),
    ...(path ? { path } : {}),
    ...(contentHash ? { contentHash } : {}),
  };
}

function normalizeEvidenceClosureRefs(value: unknown): string[] {
  const refs = requireArray(
    value,
    'Play writing reference evidenceClosureRefs',
  ).map((item) => {
    if (
      typeof item !== 'string' ||
      !/^(artifact|message|event|observation|evidence|source|participant):[A-Za-z0-9][A-Za-z0-9._-]*$/u
        .test(item) ||
      item.includes('..')
    ) {
      throw new Error(`Invalid Play writing reference evidence closure ref: ${String(item)}.`);
    }
    return item;
  });
  assertUnique(refs, 'evidence closure ref');
  return refs;
}

function normalizeIdList(value: unknown, label: string): string[] {
  const ids = requireArray(value, label).map((item) => assertSafeId(item, label));
  assertUnique(ids, `${label} ref`);
  return ids;
}

function normalizeTimestamp(value: unknown, label: string): string {
  const timestamp = normalizeText(value, label, 128);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO-compatible timestamp.`);
  }
  return timestamp;
}

function normalizeHash(value: unknown): string {
  const hash = normalizeText(value, 'Play writing reference contentHash', 64);
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error('Play writing reference contentHash must be a SHA-256 digest.');
  }
  return hash;
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be non-empty text up to ${maxLength} characters.`);
  }
  return value.trim();
}

function assertSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.length > 180
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function assertPathInside(root: string, path: string, label: string): void {
  const pathRelative = relative(root, path);
  if (
    pathRelative.startsWith('..') ||
    pathRelative === '' ||
    pathRelative.includes(`..${sep}`)
  ) {
    throw new Error(`${label} path must stay inside workspace.`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const known = new Set(fields);
  const unknown = Object.keys(value).find((field) => !known.has(field));
  if (unknown) {
    throw new Error(`Play writing reference contains unknown field: ${unknown}.`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Play writing reference contains duplicate ${label}.`);
  }
}

function ensureNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function formatRefs(refs: readonly string[]): string {
  return refs.length ? refs.join(', ') : 'none';
}

function boundContextBlock(value: string): string {
  const maxLength = 12_000;
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 31)}… [item truncated for context budget]\n`;
}

function formatContextRefs(refs: readonly string[], separator: string): string {
  if (!refs.length) return '(initial world)';
  const rendered = refs.join(separator);
  return rendered.length <= 4_000
    ? rendered
    : `${rendered.slice(0, 3_969)}… [reference list truncated]`;
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
