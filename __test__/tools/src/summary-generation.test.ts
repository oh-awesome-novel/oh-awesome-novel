import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateAggregateSummaries } from '@oh-awesome-novel/core';
import { createSummaryGenerationChangeProposal, createChangeMaterializer, createPendingActionStore, createWorkspaceProjection,
  readRepositoryBaseline, parsePendingAction, parsePendingActionOrigin, validateFinalDocument, summaryGenerationProjectionRules } from '@oh-awesome-novel/tools';
import { settledSummaryFiles, summaryDraft, appendSummary } from '../../fixtures/summary-generation';

const git = promisify(execFile); const roots: string[] = [];
const volumePath = 'summaries/volume/0001.md'; const globalPath = 'summaries/global.md';
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(global = false, existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-summary-tools-')); roots.push(root);
  const files = settledSummaryFiles();
  if (global) appendSummary(files, volumePath);
  const targetPath = global ? globalPath : volumePath;
  if (existing) files.push({ path: targetPath, content: '# 作者手工摘要\n保留我的笔记。\n' });
  for (const file of files) { await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), file.content); }
  await git('git', ['init', '-b', 'main', root]); await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  const projection = await createWorkspaceProjection({ workspaceRoot: root, rules: summaryGenerationProjectionRules(targetPath) });
  const input = { targetPath, draft: summaryDraft(files, targetPath), sessionId: 'summary-tools', repository: await readRepositoryBaseline(root),
    projectionFingerprint: projection.fingerprint, baselineFiles: projection.baselineFiles };
  const store = await createPendingActionStore({ workspaceRoot: root });
  const materializer = createChangeMaterializer({ store, assertOriginFresh: async () => {} });
  return { root, files, input, store, materializer, targetPath };
}
async function propose(f: Awaited<ReturnType<typeof fixture>>) {
  const result = createSummaryGenerationChangeProposal(f.input);
  return f.store.proposeCandidate({ ...result.proposal!, title: '摘要审批', description: '审阅全部来源' });
}

describe('aggregate summary approval and immutable origin', () => {
  it.each([false, true])('preserves author content until Accept and supports volume/global %s', async (global) => {
    const f = await fixture(global, true); const before = await readFile(join(f.root, f.targetPath), 'utf8');
    const action = await propose(f);
    expect(await readFile(join(f.root, f.targetPath), 'utf8')).toBe(before);
    expect(action.origin).toEqual({ kind: 'summaryGeneration', targetPath: f.targetPath, sourceFingerprint: f.input.draft.sourceFingerprint });
    const accepted = await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false });
    expect(accepted.appliedFiles).toEqual([f.targetPath]); expect(accepted.receipt.git).toMatchObject({ status: 'not-requested' });
    const content = await readFile(join(f.root, f.targetPath), 'utf8'); expect(content.startsWith(before)).toBe(true);
    const files = [...f.files.filter((file) => file.path !== f.targetPath), { path: f.targetPath, content }];
    expect(evaluateAggregateSummaries({ files }).find((item) => item.path === f.targetPath)?.status).toBe('current');
    const projection = await createWorkspaceProjection({ workspaceRoot: f.root, rules: summaryGenerationProjectionRules(f.targetPath) });
    expect(createSummaryGenerationChangeProposal({ ...f.input, baselineFiles: projection.baselineFiles }).proposal).toBeUndefined();
  });
  it('Reject never creates a canonical summary', async () => {
    const f = await fixture(); const action = await propose(f); await f.materializer.reject({ actionId: action.id });
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['body', 'added chapter', 'deleted chapter', 'chapter evidence', 'volume source', 'symlink', 'duplicate state'])('rejects %s drift for a global proposal even with a permissive origin hook', async (change) => {
    const f = await fixture(true); const action = await propose(f);
    if (change === 'body') await writeFile(join(f.root, 'chapters/0001/0001.md'), '改变正文');
    if (change === 'added chapter') await writeFile(join(f.root, 'chapters/0001/0002.md'), '新增正文');
    if (change === 'deleted chapter') await rm(join(f.root, 'chapters/0001/0001.md'));
    if (change === 'chapter evidence') await writeFile(join(f.root, 'state/chapters/0001/0001.yaml'), '损坏来源');
    if (change === 'volume source') await writeFile(join(f.root, volumePath), '新的手工卷摘要');
    if (change === 'duplicate state') await writeFile(join(f.root, 'state/chapters/0001/0001.yml'), '重复来源');
    if (change === 'symlink') { await rm(join(f.root, 'chapters/0001/0001.md')); await symlink(join(f.root, volumePath), join(f.root, 'chapters/0001/0001.md')); }
    // Recreate the materializer to prove the guard needs no in-memory producer state.
    const materializer = createChangeMaterializer({ store: await createPendingActionStore({ workspaceRoot: f.root }), assertOriginFresh: async () => {} });
    await expect(materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    expect((await f.store.readRecord(action.id)).status).toBe('pending');
    await expect(readFile(join(f.root, f.targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects target changes but accepts mere source touch', async () => {
    const f = await fixture(false, true); const action = await propose(f);
    await writeFile(join(f.root, f.targetPath), '作者新改动');
    await expect(f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    expect(await readFile(join(f.root, f.targetPath), 'utf8')).toBe('作者新改动');
    const clean = await fixture(); const candidate = await propose(clean);
    await utimes(join(clean.root, 'chapters/0001/0001.md'), new Date('2030-01-01'), new Date('2030-01-01'));
    expect((await clean.materializer.accept({ actionId: candidate.id, autoCommitOnAccept: false })).appliedFiles).toEqual([volumePath]);
  });
  it('rejects unknown origin/producer/targets, deletion, malformed metadata and stripped evidence', async () => {
    const f = await fixture(); const view = await propose(f); const action = await f.store.readAction(view.id);
    const { origin, ...stripped } = action;
    for (const value of [stripped, { ...action, origin: { ...origin, extra: true } },
      { ...action, source: { ...action.source, producer: 'other' } },
      { ...action, source: { ...action.source, capability: 'novel.multi-file-edit' } },
      { ...action, allowedTargets: [volumePath, globalPath] },
      { ...action, origin: { ...origin, targetPath: globalPath } },
      { ...action, changes: [{ ...action.changes[0], operation: 'delete', draft: null }] }]) expect(() => parsePendingAction(value)).toThrow();
    for (const targetPath of ['summaries/volume/0000.md', 'chapters/0001/0001.md', '../summaries/global.md']) expect(() => parsePendingActionOrigin({ ...origin, targetPath })).toThrow();
    expect(() => parsePendingActionOrigin({ ...origin, sourceFingerprint: 'bad' })).toThrow();
    expect(() => validateFinalDocument({ path: volumePath, content: '<!-- oan:summary:v2\n{}\n-->' })).toThrow();
    const generated = createSummaryGenerationChangeProposal(f.input).proposal!.candidate.changes[0]!.draft!.content;
    expect(() => validateFinalDocument({ path: globalPath, content: generated })).toThrow();
  });
  it('commits only the accepted summary when autoCommitOnAccept is enabled', async () => {
    const f = await fixture(); await git('git', ['-C', f.root, 'config', 'user.name', 'Test']); await git('git', ['-C', f.root, 'config', 'user.email', 'test@example.invalid']);
    const action = await propose(f);
    const result = await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: true });
    expect(result.receipt.git.status).toBe('committed');
    expect((await git('git', ['-C', f.root, 'show', '--format=', '--name-only', 'HEAD'])).stdout.trim()).toBe(volumePath);
  });
});
