import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { buildPlaySessionReadProjection, getPlayWindowRange } from './play-session-read-model.js';
import type { PlaySessionSelectedDetail, PlaySessionSummary, ProjectPlaySessionSelectedDetailOptions } from './play-session-read-model.js';
import type { PlaySession } from './play-session.js';
import { syncPlaySnapshotDirectory, syncPlaySnapshotTree } from './play-session-durability.js';

export const PLAY_READ_MODEL_METADATA_KEY = 'storageReadModel';
const DIRECTORY = '.read-model';
const PAGE_SIZE = 32;
const FANOUT = 32;
const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_FILES = new Set([
  'play-local-state.yaml', 'activated-sources.yaml', 'events.yaml',
  'event-schedule.yaml', 'observations.yaml', 'adoption-candidates.yaml',
  'scene-rehearsal.yaml',
]);
type Source = { path: string; sha256: string };
type Fingerprint = { device: string; inode: string; size: string; mtime: string; ctime: string };
interface Head {
  version: 1;
  metadataHash: string;
  summary: PlaySessionSummary;
  snapshot: string;
  selectedArtifactPresentation?: PlaySessionSelectedDetail['selectedArtifactPresentation'];
  sources: Source[];
  inventory: { count: number; root?: string; level: number };
  transcript: { count: number; root?: string; level: number };
  events: { count: number; root?: string; level: number };
}
interface Page { kind: 'page'; items: unknown[]; sources: Source[] }
interface Node { kind: 'node'; children: string[] }
// File identity is a process-local optimization, never part of the portable
// content root. A new process/path or changed identity must validate facts once.
const witnesses = new Map<string, Map<string, Fingerprint>>();

export function playStorageHash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A private COW clone is safe to modify independently of the prior snapshot. */
export async function copyPlaySnapshotFile(source: string, target: string): Promise<void> {
  await copyFile(source, target, constants.COPYFILE_FICLONE);
}

export async function buildPlayStorageReadModel(input: {
  sessionRoot: string;
  session: PlaySession;
  metadata: Record<string, unknown>;
  sourceHashes: ReadonlyMap<string, string>;
  outputRoot?: string;
  previousRoot?: string;
}): Promise<string> {
  const output = input.outputRoot ?? join(input.sessionRoot, DIRECTORY);
  await mkdir(output, { recursive: true });
  const write = async (value: unknown): Promise<string> => {
    const bytes = `${stableJson(value)}\n`;
    const hash = playStorageHash(bytes);
    const path = join(output, `${hash}.json`);
    if (input.previousRoot) {
      const old = join(input.previousRoot, DIRECTORY, `${hash}.json`);
      try {
        const existing = await readSafeFile(old, 32 * 1024 * 1024);
        if (playStorageHash(existing) !== hash) throw invalid('Existing derived page is corrupt.');
        await copyPlaySnapshotFile(old, path);
        return hash;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    await writeFile(path, bytes, 'utf8');
    return hash;
  };
  const projection = buildPlaySessionReadProjection(input.session);
  const messageOwners = new Map<string, string>();
  const eventOwners = new Map<string, string>();
  for (const artifact of input.session.turnArtifacts) {
    for (const message of artifact.messages) if (message.id) messageOwners.set(message.id, artifact.id);
    for (const id of artifact.eventIds) eventOwners.set(id, artifact.id);
  }
  const source = (id: string): Source => {
    const path = `turns/${id}.yaml`;
    const sha256 = input.sourceHashes.get(path);
    if (!sha256) throw invalid(`Missing source evidence: ${path}.`);
    return { path, sha256 };
  };
  const tree = async (items: unknown[], owners: Array<string | undefined>) => {
    let nodes: string[] = [];
    for (let start = 0; start < items.length; start += PAGE_SIZE) {
      const ids = [...new Set(owners.slice(start, start + PAGE_SIZE).filter((id): id is string => id !== undefined))];
      nodes.push(await write({ kind: 'page', items: items.slice(start, start + PAGE_SIZE), sources: ids.map(source) } satisfies Page));
    }
    let level = 0;
    while (nodes.length > 1) {
      const parent: string[] = [];
      for (let start = 0; start < nodes.length; start += FANOUT) {
        parent.push(await write({ kind: 'node', children: nodes.slice(start, start + FANOUT) } satisfies Node));
      }
      nodes = parent;
      level += 1;
    }
    return { count: items.length, ...(nodes[0] ? { root: nodes[0] } : {}), level };
  };
  const sources: Head['sources'] = [];
  const witness = new Map<string, Fingerprint>();
  const scenePaths = new Set(projection.snapshot.rehearsalScenes?.map((scene) => `scenes/${scene.sceneId}.yaml`) ?? []);
  const selectedHeadPath = input.session.selectedTurnIds.at(-1)
    ? `turns/${input.session.selectedTurnIds.at(-1)}.yaml` : undefined;
  for (const [path, sha256] of [...input.sourceHashes].sort(([a], [b]) => a.localeCompare(b))) {
    if (!SOURCE_FILES.has(path) && !scenePaths.has(path) && path !== selectedHeadPath) continue;
    sources.push({ path, sha256 });
    witness.set(path, await fingerprint(join(input.sessionRoot, path)));
  }
  const head: Head = {
    version: 1,
    metadataHash: playStorageHash(stringify(input.metadata)),
    summary: projection.summary,
    snapshot: await write(projection.snapshot),
    ...(projection.selectedArtifactPresentation ? { selectedArtifactPresentation: projection.selectedArtifactPresentation } : {}),
    sources,
    inventory: await tree(
      [...input.sourceHashes].filter(([path]) => path !== 'session.yaml' && path !== 'transcript.md')
        .sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })),
      [],
    ),
    transcript: await tree(projection.transcript, projection.transcript.map((item) => item.id ? messageOwners.get(item.id) : undefined)),
    events: await tree(projection.events.map((event, index) => ({ event, presentation: projection.eventPresentation[index] })), projection.events.map((event) => eventOwners.get(event.id))),
  };
  const root = await write(head);
  rememberWitness(input.previousRoot ?? input.sessionRoot, root, witness);
  return root;
}

export function readPlayStorageAnchor(metadata: Record<string, unknown>): string | undefined {
  const value = metadata[PLAY_READ_MODEL_METADATA_KEY];
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'root,version'
    || (value as { version?: unknown }).version !== 1
    || typeof (value as { root?: unknown }).root !== 'string'
    || !HASH.test((value as { root: string }).root)) throw invalid('Invalid storage read-model anchor.');
  return (value as { root: string }).root;
}

export async function readPlayStorageHead(sessionRoot: string, metadata: Record<string, unknown>): Promise<Head | undefined> {
  const anchor = readPlayStorageAnchor(metadata);
  if (!anchor) return undefined;
  const head = await readObject<Head>(sessionRoot, anchor, 2 * 1024 * 1024);
  const { [PLAY_READ_MODEL_METADATA_KEY]: _anchor, ...base } = metadata;
  if (head.version !== 1 || head.metadataHash !== playStorageHash(stringify(base))
    || head.summary.id !== metadata.id || head.summary.revision !== metadata.revision) {
    throw invalid('Play storage read model does not match session metadata.');
  }
  const witness = witnesses.get(witnessKey(sessionRoot, anchor));
  let changed = witness === undefined;
  for (const source of head.sources) {
    assertSourcePath(source.path);
    await assertSourceParent(sessionRoot, source.path);
    if (stableJson(await fingerprint(join(sessionRoot, source.path))) !== stableJson(witness?.get(source.path))) changed = true;
  }
  if (changed) throw Object.assign(new Error('Play read-model source identities require validation.'), { code: 'PLAY_READ_MODEL_REBIND_REQUIRED' });
  return head;
}

export async function readPlayStorageDetail(
  sessionRoot: string,
  head: Head,
  options: ProjectPlaySessionSelectedDetailOptions,
): Promise<PlaySessionSelectedDetail> {
  const snapshot = await readObject<PlaySessionSelectedDetail['snapshot']>(sessionRoot, head.snapshot, 32 * 1024 * 1024);
  const selectedHead = snapshot.selectedTurnIds.at(-1) ?? 'initial-world';
  const verified = new Set<string>();
  const readWindow = async <T>(tree: Head['transcript'], kind: 'transcript' | 'event', cursor?: string) => {
    const range = getPlayWindowRange({ kind, sessionId: head.summary.id, revision: head.summary.revision, selectedHead, itemCount: tree.count }, options.limit, cursor);
    const items: T[] = [];
    if (!Number.isSafeInteger(tree.level) || tree.level < 0 || tree.level > 8) throw invalid('Invalid read-model tree depth.');
    for (let pageIndex = Math.floor(range.start / PAGE_SIZE); pageIndex < Math.ceil(range.end / PAGE_SIZE); pageIndex += 1) {
      if (!tree.root) throw invalid('Missing read-model tree root.');
      let hash = tree.root;
      for (let level = tree.level; level > 0; level -= 1) {
        const node = await readObject<Node>(sessionRoot, hash);
        if (node.kind !== 'node' || !Array.isArray(node.children) || node.children.length > FANOUT) throw invalid('Invalid read-model node.');
        hash = node.children[Math.floor(pageIndex / FANOUT ** (level - 1)) % FANOUT]!;
      }
      const page = await readObject<Page>(sessionRoot, hash);
      if (page.kind !== 'page' || !Array.isArray(page.items) || page.items.length > PAGE_SIZE || !Array.isArray(page.sources)) throw invalid('Invalid read-model page.');
      for (const source of page.sources) {
        assertSourcePath(source.path);
        await assertSourceParent(sessionRoot, source.path);
        if (verified.has(source.path)) continue;
        if (playStorageHash(await readSafeFile(join(sessionRoot, source.path), 16 * 1024 * 1024)) !== source.sha256) {
          throw invalid(`Play window source hash changed: ${source.path}.`);
        }
        verified.add(source.path);
      }
      const start = Math.max(0, range.start - pageIndex * PAGE_SIZE);
      const end = Math.min(PAGE_SIZE, range.end - pageIndex * PAGE_SIZE);
      items.push(...page.items.slice(start, end) as T[]);
    }
    return { items, totalCount: tree.count, hasMoreBefore: range.start > 0, ...(range.nextCursor ? { nextCursor: range.nextCursor } : {}) };
  };
  const transcript = await readWindow<PlaySessionSelectedDetail['transcript']['items'][number]>(head.transcript, 'transcript', options.transcriptCursor);
  const eventRows = await readWindow<{ event: PlaySessionSelectedDetail['events']['items'][number]; presentation: PlaySessionSelectedDetail['eventPresentation'][number] }>(head.events, 'event', options.eventCursor);
  return {
    summary: head.summary, snapshot, transcript,
    events: { ...eventRows, items: eventRows.items.map((row) => row.event) },
    eventPresentation: eventRows.items.map((row) => row.presentation),
    ...(head.selectedArtifactPresentation ? { selectedArtifactPresentation: head.selectedArtifactPresentation } : {}),
  };
}

/** Rebuild only after the full canonical reader has validated all graph facts. */
export async function rebuildPlayStorageReadModel(input: {
  sessionRoot: string; session: PlaySession; metadata: Record<string, unknown>; sourceHashes: ReadonlyMap<string, string>;
}): Promise<void> {
  const anchor = readPlayStorageAnchor(input.metadata);
  if (!anchor) return;
  const temporary = join(input.sessionRoot, `.read-model-stage-${randomUUID()}`);
  const { [PLAY_READ_MODEL_METADATA_KEY]: _anchor, ...base } = input.metadata;
  try {
    const root = await buildPlayStorageReadModel({ ...input, metadata: base, outputRoot: temporary });
    if (root !== anchor) throw invalid('Rebuilt read model differs from the committed anchor.');
    await syncPlaySnapshotTree(temporary);
    await rm(join(input.sessionRoot, DIRECTORY), { recursive: true, force: true });
    await rename(temporary, join(input.sessionRoot, DIRECTORY));
    await syncPlaySnapshotDirectory(input.sessionRoot);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function readObject<T>(sessionRoot: string, hash: string, limit = 4 * 1024 * 1024): Promise<T> {
  if (typeof hash !== 'string' || !HASH.test(hash)) throw invalid('Invalid read-model object hash.');
  const directory = await lstat(join(sessionRoot, DIRECTORY));
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw invalid('Unsafe Play read-model directory.');
  const bytes = await readSafeFile(join(sessionRoot, DIRECTORY, `${hash}.json`), limit);
  if (playStorageHash(bytes) !== hash) throw invalid('Play storage read-model hash mismatch.');
  try { return JSON.parse(bytes.toString('utf8')) as T; }
  catch { throw invalid('Invalid read-model JSON.'); }
}

async function readSafeFile(path: string, limit: number): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit) throw invalid('Unsafe Play storage file.');
  return readFile(path);
}
async function fingerprint(path: string): Promise<Fingerprint> {
  const stat = await lstat(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw invalid('Unsafe Play source file.');
  return { device: String(stat.dev), inode: String(stat.ino), size: String(stat.size), mtime: String(stat.mtimeNs), ctime: String(stat.ctimeNs) };
}
function assertSourcePath(path: string): void {
  if (!SOURCE_FILES.has(path) && !/^(?:turns|scenes)\/[A-Za-z0-9][A-Za-z0-9._-]*\.yaml$/u.test(path)) throw invalid('Invalid read-model source path.');
}
async function assertSourceParent(sessionRoot: string, path: string): Promise<void> {
  const directory = path.includes('/') ? join(sessionRoot, path.split('/')[0]!) : sessionRoot;
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid('Unsafe Play source directory.');
}
function invalid(message: string): Error { return Object.assign(new Error(message), { code: 'PLAY_READ_MODEL_INVALID' }); }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}
function witnessKey(sessionRoot: string, root: string): string { return `${sessionRoot}\0${root}`; }
function rememberWitness(sessionRoot: string, root: string, witness: Map<string, Fingerprint>): void {
  const key = witnessKey(sessionRoot, root);
  witnesses.delete(key);
  witnesses.set(key, witness);
  if (witnesses.size > 256) witnesses.delete(witnesses.keys().next().value!);
}
