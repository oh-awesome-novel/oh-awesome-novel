import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareManuscriptImport } from '@oh-awesome-novel/core';
import { createManuscriptImportChangeProposal, createPendingActionStore, assertManuscriptImportPreview, assertManuscriptImportActionFresh, parsePendingAction, parsePendingActionOrigin } from '@oh-awesome-novel/tools';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const repository = { repositoryId: 'import-test', branch: 'main', head: 'abc123' };
async function prepared() {
  const root = await mkdtemp(join(tmpdir(), 'oan-import-protocol-')); roots.push(root);
  const store = await createPendingActionStore({ workspaceRoot: root, repositoryValidator: async () => {}, assertOriginFresh: async ({ preview }) => assertManuscriptImportPreview(preview) });
  const proposal = createManuscriptImportChangeProposal({ previewId: 'pa_import-test', repository,
    plan: prepareManuscriptImport({ sourceName: '旧稿.md', text: '第一章 初见\n正文\n第二章 归途\n下一章' }) });
  const preview = await store.prepareChangePreview({ id: 'pa_import-test', candidate: proposal.candidate, origin: proposal.origin, allowedTargets: proposal.allowedTargets });
  const view = await store.promotePreparedChangePreview({ id: preview.id, title: 'Import', description: 'Review new chapters',
    source: { kind: 'deterministic-builder', producer: 'manuscript-import', capability: 'chapter.edit' }, origin: preview.origin, allowedTargets: preview.allowedTargets });
  return { root, store, preview, view };
}
describe('manuscript import deterministic producer and approval binding', () => {
  it('validates whole chapter documents and keeps the exact immutable preview binding after reopening', async () => {
    const { root, store, view } = await prepared();
    const action = await store.readAction(view.id);
    expect(action.changes).toHaveLength(2); expect(action.changes.every((change) => change.operation === 'create')).toBe(true);
    await expect(assertManuscriptImportActionFresh(root, action)).resolves.toBeUndefined();
    await expect(readFile(join(root, action.changes[0]!.path))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects forged provenance and unsupported producer/capability/target operations', async () => {
    const { root, store, view } = await prepared(); const action = await store.readAction(view.id);
    expect(() => parsePendingAction({ ...action, origin: undefined })).toThrow();
    expect(() => parsePendingAction({ ...action, source: { ...action.source, producer: 'other' } })).toThrow();
    expect(() => parsePendingAction({ ...action, source: { ...action.source, capability: 'novel.multi-file-edit' } })).toThrow();
    expect(() => parsePendingActionOrigin({ ...action.origin, extra: 'unexpected' })).toThrow();
    await expect(assertManuscriptImportActionFresh(root, { ...action, origin: { ...action.origin!, sourceHash: '0'.repeat(64) } } as typeof action)).rejects.toThrow(/immutable reviewed preview/u);
  });
  it('rejects changed immutable preview evidence without treating it as a new import', async () => {
    const { root, store, view, preview } = await prepared(); const action = await store.readAction(view.id);
    await writeFile(join(root, '.workspace/change-engine/v1/previews', preview.id, 'preview.json'), JSON.stringify({ ...preview, origin: { ...preview.origin, mappingHash: '0'.repeat(64) } }));
    await expect(assertManuscriptImportActionFresh(root, action)).rejects.toThrow(/immutable reviewed preview/u);
  });
  it('does not create a proposal for duplicate or escaped targets, or invalid final Markdown', () => {
    const plan = prepareManuscriptImport({ sourceName: 'old.md', text: '# One\nbody' });
    for (const files of [[{ ...plan.files[0]!, path: '../outside.md' }], [plan.files[0]!, plan.files[0]!], [{ ...plan.files[0]!, content: 'no heading' }]]) {
      expect(() => createManuscriptImportChangeProposal({ previewId: 'pa_import-test', repository, plan: { ...plan, files } })).toThrow();
    }
  });
});
