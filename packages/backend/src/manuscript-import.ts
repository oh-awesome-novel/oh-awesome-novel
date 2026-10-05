import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from 'hono';
import { prepareManuscriptImport, ManuscriptImportValidationError } from '@oh-awesome-novel/core';
import type { ManuscriptImportMapping } from '@oh-awesome-novel/core';
import { assertManuscriptImportPreview, createManuscriptImportChangeProposal, MANUSCRIPT_IMPORT_PRODUCER, readRepositoryBaseline } from '@oh-awesome-novel/tools';
import type { PendingActionStore } from '@oh-awesome-novel/tools';

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export function createManuscriptImportHandlers(input: {
  getWorkspaceRoot(): string;
  getStore(root: string): Promise<PendingActionStore>;
}) {
  function assertWorkspace(root: string, expected: unknown) {
    if (typeof expected !== 'string' || expected !== root || input.getWorkspaceRoot() !== root) {
      throw new ImportRequestError(409, 'workspace_changed', 'The active workspace changed. Reopen import from the intended workspace.');
    }
  }
  return {
    async preview(context: Context): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        const body = await readBoundedJson(context);
        exactFields(body, ['sourceName', 'text', 'expectedWorkspaceRoot'], ['mappings']);
        assertWorkspace(root, body.expectedWorkspaceRoot);
        const plan = prepareManuscriptImport({ sourceName: body.sourceName as string, text: body.text as string,
          ...(body.mappings === undefined ? {} : { mappings: body.mappings as ManuscriptImportMapping[] }) });
        const paths = new Map<string, number>();
        const conflicts: Array<{ index: number; path: string; reason: 'exists' | 'duplicate' }> = [];
        for (const chapter of plan.chapters) {
          if (paths.has(chapter.path)) conflicts.push({ index: chapter.index, path: chapter.path, reason: 'duplicate' });
          else {
            paths.set(chapter.path, chapter.index);
            if (await targetExists(root, chapter.path)) conflicts.push({ index: chapter.index, path: chapter.path, reason: 'exists' });
          }
        }
        assertWorkspace(root, body.expectedWorkspaceRoot);
        const base = { sourceName: plan.sourceName, sourceHash: plan.sourceHash, sourceBytes: plan.sourceBytes,
          chapters: plan.chapters, conflicts, warnings: plan.warnings };
        if (conflicts.length) return context.json({ preview: { ...base, id: null, fingerprint: null, canPropose: false, diff: '' } });
        const id = `pa_${randomUUID()}`;
        const proposal = createManuscriptImportChangeProposal({ plan, previewId: id, repository: await readRepositoryBaseline(root) });
        const store = await input.getStore(root);
        assertWorkspace(root, body.expectedWorkspaceRoot);
        const prepared = await store.prepareChangePreview({ id, candidate: proposal.candidate, origin: proposal.origin, allowedTargets: proposal.allowedTargets });
        assertWorkspace(root, body.expectedWorkspaceRoot);
        return context.json({ preview: { ...base, id, fingerprint: prepared.candidateFingerprint, canPropose: true, diff: prepared.preview.diff } });
      } catch (error) { return errorResponse(context, error); }
    },
    async propose(context: Context, previewId: string): Promise<Response> {
      try {
        const root = input.getWorkspaceRoot();
        const body = await readBoundedJson(context);
        exactFields(body, ['fingerprint', 'expectedWorkspaceRoot']);
        assertWorkspace(root, body.expectedWorkspaceRoot);
        if (!/^pa_[0-9a-f-]{36}$/u.test(previewId) || typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(body.fingerprint)) {
          throw new ImportRequestError(400, 'invalid_import_request', 'A valid reviewed preview id and fingerprint are required.');
        }
        const store = await input.getStore(root);
        const preview = await store.readPreparedChangePreview(previewId);
        assertManuscriptImportPreview(preview);
        if (preview.candidateFingerprint !== body.fingerprint) throw new ImportRequestError(409, 'stale_import_preview', 'The manuscript preview changed. Prepare and review it again.');
        assertWorkspace(root, body.expectedWorkspaceRoot);
        const pendingAction = await store.promotePreparedChangePreview({ id: previewId,
          title: `导入旧稿（${preview.changes.length} 章）`, description: '创建预览中的新章节；原稿文字保留，不覆盖任何已有章节。',
          source: { kind: 'deterministic-builder', producer: MANUSCRIPT_IMPORT_PRODUCER, capability: 'chapter.edit' },
          origin: preview.origin, allowedTargets: preview.allowedTargets });
        assertWorkspace(root, body.expectedWorkspaceRoot);
        return context.json({ pendingAction });
      } catch (error) { return errorResponse(context, error); }
    },
  };
}

/** Check path components without reading existing manuscripts or following links. */
async function targetExists(root: string, path: string): Promise<boolean> {
  let current = root;
  const segments = path.split('/');
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]!);
    let info;
    try { info = await lstat(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) {
      throw new ImportRequestError(422, 'unsafe_import_target', 'An import destination contains an unsafe link or non-directory. Choose another volume.');
    }
  }
  return true;
}

async function readBoundedJson(context: Context): Promise<Record<string, unknown>> {
  const reader = context.req.raw.body?.getReader();
  if (!reader) throw new ImportRequestError(400, 'invalid_import_request', 'A JSON request body is required.');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel(); throw new ImportRequestError(413, 'import_too_large', 'The import request is too large. Use a smaller manuscript batch.');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new ImportRequestError(400, 'invalid_import_request', 'The request must be valid UTF-8 JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ImportRequestError(400, 'invalid_import_request', 'A JSON object is required.');
  return parsed as Record<string, unknown>;
}
function exactFields(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new ImportRequestError(400, 'invalid_import_request', 'Import request contains missing or unknown fields.');
  }
}
class ImportRequestError extends Error {
  readonly status: 400 | 409 | 413 | 422;
  readonly code: string;
  constructor(status: 400 | 409 | 413 | 422, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}
function errorResponse(context: Context, error: unknown): Response {
  if (error instanceof ImportRequestError) return context.json({ error: error.message, code: error.code }, error.status);
  const code = (error as { code?: string }).code;
  if (code?.includes('STALE') || code?.startsWith('PENDING_ACTION_')) return context.json({ error: 'The import preview is no longer valid. Prepare it again after checking the destination.', code: 'stale_import_preview' }, 409);
  return context.json({ error: error instanceof ManuscriptImportValidationError ? error.message : 'The manuscript could not be previewed safely. Check the Git repository, chapter format and destination files, then prepare it again.', code: 'invalid_manuscript_import' }, 422);
}
