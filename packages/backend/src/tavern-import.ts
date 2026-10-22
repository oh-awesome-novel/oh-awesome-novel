import { freezePlayPermanentContext } from './play-frozen-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'hono';
import {
  createOanTavernImportPreview, parseTavernCardInput, prepareTavernCardPlaySession,
  readPlaySessionFiles, TAVERN_IMPORT_LIMITS, writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlaySession, TavernImportMode } from '@oh-awesome-novel/core';
import {
  assertTavernImportPreview, createTavernImportChangeProposal, readRepositoryBaseline,
  tavernImportTargetPaths, TAVERN_IMPORT_PRODUCER,
} from '@oh-awesome-novel/tools';
import type { CandidateFileSnapshot, PendingActionStore } from '@oh-awesome-novel/tools';

const MAX_REQUEST_BYTES = 15 * 1024 * 1024;
const PLAY_PREVIEW_TTL = 15 * 60 * 1000;
const PLAY_PREVIEW_BYTES = 16 * 1024 * 1024;
interface PlayPreview { root: string; fingerprint: string; session: PlaySession; bytes: number; expires: number; committed: boolean }

export function createTavernImportHandlers(input: {
  getWorkspaceRoot(): string;
  getStore(root: string): Promise<PendingActionStore>;
  reserve(root: string, sessionId: string): (() => void) | undefined;
}) {
  const playPreviews = new Map<string, PlayPreview>();
  function assertWorkspace(root: string, expected: unknown) {
    if (expected !== root || input.getWorkspaceRoot() !== root) throw new ImportError(409, 'workspace_changed', 'The active workspace changed. Preview the card again.');
  }
  function remember(id: string, preview: PlayPreview) {
    for (const [key, entry] of playPreviews) if (entry.expires <= Date.now()) playPreviews.delete(key);
    let bytes = [...playPreviews.values()].reduce((total, entry) => total + entry.bytes, 0);
    while (playPreviews.size >= 32 || bytes + preview.bytes > PLAY_PREVIEW_BYTES) {
      const first = playPreviews.entries().next().value;
      if (!first) throw new ImportError(413, 'import_too_large', 'The Play card preview is too large.');
      bytes -= first[1].bytes; playPreviews.delete(first[0]);
    }
    playPreviews.set(id, preview);
  }
  return {
    async preview(context: Context): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        const body = await readBody(context);
        exact(body, ['sourceName', 'format', 'content', 'mode', 'expectedWorkspaceRoot'], ['characterId']);
        assertWorkspace(root, body.expectedWorkspaceRoot);
        if (typeof body.sourceName !== 'string' || !body.sourceName.trim() || body.sourceName.length > 200 || /[/\\\x00-\x1f\x7f]/u.test(body.sourceName)) throw new ImportError(400, 'invalid_import_request', 'Use a local card file name.');
        if (typeof body.content !== 'string' || !['json', 'png'].includes(String(body.format)) || !['preview', 'create', 'merge', 'playOnly'].includes(String(body.mode))) throw new ImportError(400, 'invalid_import_request', 'A JSON or PNG card and import mode are required.');
        if (body.characterId !== undefined && typeof body.characterId !== 'string') throw new ImportError(400, 'invalid_import_request', 'Character id must be text.');
        const content = body.format === 'png' ? decodePng(body.content) : body.content;
        const card = parseTavernCardInput(content);
        const mapping = createOanTavernImportPreview(card, { mode: body.mode as TavernImportMode, characterId: body.characterId as string | undefined });
        const base = { sourceName: body.sourceName, sourceHash: card.sourceHash, displayName: card.name,
          characterId: mapping.characterId, mode: mapping.mode, warnings: mapping.safety.warnings, conflicts: [] as string[] };
        assertWorkspace(root, body.expectedWorkspaceRoot);
        if (mapping.mode === 'preview') return context.json({ preview: { ...base, id: null, fingerprint: null, canPropose: false,
          files: mapping.files.map(path => ({ path, operation: 'create' })), diff: '' } });
        if (mapping.mode === 'playOnly') {
          const id = `tp_${randomUUID()}`;
          const session = prepareTavernCardPlaySession(card, { id: `play_${randomUUID()}`, characterId: mapping.characterId, sourceName: body.sourceName });
          const serialized = JSON.stringify(session);
          const fingerprint = createHash('sha256').update(serialized).digest('hex');
          remember(id, { root, session, fingerprint, bytes: Buffer.byteLength(serialized), expires: Date.now() + PLAY_PREVIEW_TTL, committed: false });
          return context.json({ preview: { ...base, id, fingerprint, canPropose: true, files: [],
            diff: [card.name, card.description, card.personality, card.scenario, card.firstMessage, card.messageExamples,
              ...card.alternateGreetings, card.systemPrompt, card.postHistoryInstructions, card.depthPrompt?.prompt,
              card.characterBook ? JSON.stringify(card.characterBook, null, 2) : ''].filter(Boolean).join('\n\n') } });
        }
        const existing = await pathInformation(root, `characters/${mapping.characterId}`);
        if (mapping.mode === 'create' && existing) return context.json({ preview: { ...base, id: null, fingerprint: null,
          files: [], diff: '', canPropose: false, conflicts: ['A character with this id already exists. Choose another id or merge.'] } });
        const baselineFiles = await readTargets(root, tavernImportTargetPaths(mapping.characterId));
        const id = `pa_${randomUUID()}`;
        const result = createTavernImportChangeProposal({ card, mode: mapping.mode, characterId: mapping.characterId,
          previewId: id, repository: await readRepositoryBaseline(root), baselineFiles });
        const summary = { ...base, warnings: [...new Set([...base.warnings, ...result.warnings])], conflicts: result.conflicts };
        if (!result.proposal) return context.json({ preview: { ...summary, id: null, fingerprint: null, files: [], diff: '', canPropose: false } });
        const store = await input.getStore(root);
        assertWorkspace(root, body.expectedWorkspaceRoot);
        const prepared = await store.prepareChangePreview({ id, candidate: result.proposal.candidate,
          origin: result.proposal.origin, allowedTargets: result.proposal.allowedTargets });
        assertWorkspace(root, body.expectedWorkspaceRoot);
        return context.json({ preview: { ...summary, id, fingerprint: prepared.candidateFingerprint, canPropose: true,
          files: prepared.changes.map(change => ({ path: change.path, operation: change.operation })), diff: prepared.preview.diff } });
      } catch (error) { return failure(context, error); }
    },
    async propose(context: Context, id: string): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot(); const body = await reviewedRequest(context);
        assertWorkspace(root, body.expectedWorkspaceRoot);
        if (!/^pa_[0-9a-f-]{36}$/u.test(id)) throw new ImportError(400, 'invalid_import_request', 'Invalid card preview id.');
        const store = await input.getStore(root); const preview = await store.readPreparedChangePreview(id);
        assertTavernImportPreview(preview);
        if (preview.candidateFingerprint !== body.fingerprint) throw new ImportError(409, 'stale_import_preview', 'Preview changed. Review the card again.');
        assertWorkspace(root, body.expectedWorkspaceRoot);
        const pendingAction = await store.promotePreparedChangePreview({ id, title: '导入角色卡',
          description: '将已预览的角色资料与不可信互动提示提交审批。',
          source: { kind: 'deterministic-builder', producer: TAVERN_IMPORT_PRODUCER, capability: 'character.edit' },
          origin: preview.origin, allowedTargets: preview.allowedTargets });
        assertWorkspace(root, body.expectedWorkspaceRoot);
        return context.json({ pendingAction });
      } catch (error) { return failure(context, error); }
    },
    async playSession(context: Context, id: string): Promise<Response> {
      let release: (() => void) | undefined;
      try {
        const root = input.getWorkspaceRoot(); const body = await reviewedRequest(context);
        assertWorkspace(root, body.expectedWorkspaceRoot);
        const preview = playPreviews.get(id);
        if (!preview || preview.root !== root || preview.expires <= Date.now() || preview.fingerprint !== body.fingerprint) throw new ImportError(409, 'stale_import_preview', 'The Play card preview expired or changed. Preview it again.');
        release = input.reserve(root, preview.session.id);
        if (!release) throw new ImportError(409, 'play_session_busy', 'This card is already being imported.');
        if (!preview.committed) {
          await freezePlayPermanentContext(root, preview.session);
          await writePlaySessionFiles(root, preview.session, { expectedAbsent: true });
          preview.committed = true;
        }
        assertWorkspace(root, body.expectedWorkspaceRoot);
        return context.json({ session: await readPlaySessionFiles(root, preview.session.id) });
      } catch (error) { return failure(context, error); }
      finally { release?.(); }
    },
  };
}

async function pathInformation(root: string, path: string) {
  let current = root;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())) throw new Error('Unsafe character destination.');
      if (index === parts.length - 1) return info;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  return undefined;
}
async function readTargets(root: string, paths: string[]): Promise<CandidateFileSnapshot[]> {
  const result: CandidateFileSnapshot[] = []; let bytes = 0;
  for (const path of paths) {
    const info = await pathInformation(root, path); if (!info) continue;
    if (!info.isFile() || info.nlink !== 1 || info.size > 2 * 1024 * 1024) throw new Error('Unsafe or oversized character file.');
    bytes += info.size; if (bytes > 8 * 1024 * 1024) throw new Error('Character files exceed the import budget.');
    const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await handle.stat();
      if (!actual.isFile() || actual.nlink !== 1 || actual.dev !== info.dev || actual.ino !== info.ino || actual.size !== info.size) throw new Error('Character changed while preparing import.');
      const buffer = Buffer.alloc(info.size + 1); let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead;
      }
      const after = await handle.stat();
      if (size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('Character changed while preparing import.');
      result.push({ path, content: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)), mode: info.mode & 0o777 });
    } finally { await handle.close(); }
  }
  return result;
}
function decodePng(content: string): Uint8Array {
  if (content.length > Math.ceil(TAVERN_IMPORT_LIMITS.fileBytes / 3) * 4 || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(content)) throw new ImportError(400, 'invalid_import_request', 'PNG upload must be bounded base64.');
  return Buffer.from(content, 'base64');
}
async function readBody(context: Context): Promise<Record<string, unknown>> {
  const reader = context.req.raw.body?.getReader(); if (!reader) throw new ImportError(400, 'invalid_import_request', 'A card request is required.');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) { await reader.cancel(); throw new ImportError(413, 'import_too_large', 'Card upload exceeds 15 MiB.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new ImportError(400, 'invalid_import_request', 'Request must be a UTF-8 JSON object.'); }
}
function exact(body: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !required.includes(key) && !optional.includes(key))) throw new ImportError(400, 'invalid_import_request', 'Import request has missing or unknown fields.');
}
async function reviewedRequest(context: Context) {
  const body = await readBody(context); exact(body, ['fingerprint', 'expectedWorkspaceRoot']);
  if (typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(body.fingerprint)) throw new ImportError(400, 'invalid_import_request', 'A reviewed preview fingerprint is required.');
  return body;
}
class ImportError extends Error {
  readonly status: 400 | 409 | 413 | 422; readonly code: string;
  constructor(status: 400 | 409 | 413 | 422, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
function failure(context: Context, error: unknown) {
  if (error instanceof ImportError) return context.json({ error: error.message, code: error.code }, error.status);
  const code = (error as { code?: string }).code;
  if (code?.includes('STALE') || code?.startsWith('PENDING_ACTION_')) return context.json({ error: 'Import preview is stale. Review the card and destination again.', code: 'stale_import_preview' }, 409);
  return context.json({ error: error instanceof Error ? error.message : 'The card could not be imported safely.', code: 'invalid_tavern_import' }, 422);
}
