import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { createChapterSettlementSource } from '@oh-awesome-novel/core';
import { createChapterSettlementChangeProposal, createChangeMaterializer, createPendingActionStore,
  createWorkspaceProjection, readRepositoryBaseline, parsePendingAction } from '@oh-awesome-novel/tools';

const git = promisify(execFile);
const roots: string[] = [];
const content = '---\nchapterId: "0001"\n---\n林安拿起钥匙。\n';
const source = createChapterSettlementSource('0001/0001', content);
const observations = { schemaVersion: 1, chapterId: source.chapterId, sourceHash: source.sourceHash,
  observations: [{ id: 'key', category: 'item', subject: '林安', observation: '持有钥匙', confidence: 'high',
    evidence: { startLine: 4, endLine: 4, quote: '林安拿起钥匙。' } },
  { id: 'owner', category: 'item', subject: '钥匙', observation: '可能属于林安', confidence: 'low',
    evidence: { startLine: 4, endLine: 4, quote: '林安拿起钥匙。' } }], unresolvedAmbiguities: ['钥匙所有权未说明'] };
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-settlement-')); roots.push(root);
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(join(root, 'chapters/0001/0001.md'), content);
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '.']);
  await git('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  const projection = await createWorkspaceProjection({ workspaceRoot: root, rules: [{ kind: 'prefix', path: 'chapters' }, { kind: 'prefix', path: 'summaries' }, { kind: 'prefix', path: 'state' }] });
  const input = { source, observations, sessionId: 'settlement-test', repository: await readRepositoryBaseline(root),
    projectionFingerprint: projection.fingerprint, baselineFiles: projection.baselineFiles };
  const store = await createPendingActionStore({ workspaceRoot: root });
  return { root, input, store, materializer: createChangeMaterializer({ store, assertOriginFresh: async () => {} }) };
}

describe('chapter settlement approval', () => {
  it('creates one two-file candidate, persists no canonical bytes until Accept and validates its final references', async () => {
    const f = await fixture(); const result = createChapterSettlementChangeProposal(f.input);
    expect(result.report).toContain('钥匙所有权未说明');
    expect(result.report).toContain('可能属于林安');
    expect(result.proposal!.candidate.changes.map((c) => c.path)).toEqual(['state/chapters/0001/0001.yaml', 'summaries/chapter/0001/0001.md']);
    const action = await f.store.proposeCandidate({ ...result.proposal!, title: 'Settlement', description: 'Review evidence' });
    expect(action.diff).not.toContain('可能属于林安');
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    const accepted = await f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false });
    expect(accepted.appliedFiles).toHaveLength(2);
    const state = parse(await readFile(join(f.root, 'state/chapters/0001/0001.yaml'), 'utf8'));
    expect(state.chapterRef).toBe('0001/0001'); expect(state.sourceHash).toBe(source.sourceHash);
    expect(state.observations).toHaveLength(1);
    expect(await readFile(join(f.root, 'chapters/0001/0001.md'), 'utf8')).toBe(content);
  });
  it('keeps low-confidence and ambiguity-only settlement report-only', async () => {
    const f = await fixture();
    const result = createChapterSettlementChangeProposal({ ...f.input, observations: { ...observations,
      observations: observations.observations.filter((item) => item.confidence === 'low') } });
    expect(result.proposal).toBeUndefined(); expect(await f.store.listViews()).toEqual([]);
  });
  it('refuses a stale source at Accept even when the host origin callback is permissive', async () => {
    const f = await fixture();
    const proposal = createChapterSettlementChangeProposal(f.input).proposal!;
    const action = await f.store.proposeCandidate({ ...proposal, title: 'Settlement', description: 'Review evidence' });
    await writeFile(join(f.root, 'chapters/0001/0001.md'), `${content}后续正文\n`);
    await expect(f.materializer.accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.store.readRecord(action.id)).status).toBe('pending');
  });
  it('rejects unknown origin fields, stripped origin and source/producer mismatch', async () => {
    const f = await fixture(); const proposal = createChapterSettlementChangeProposal(f.input).proposal!;
    const action = await f.store.proposeCandidate({ ...proposal, title: 'Settlement', description: 'Review evidence' });
    const stored = await f.store.readAction(action.id);
    expect(() => parsePendingAction({ ...stored, origin: { ...stored.origin, extra: true } })).toThrow();
    const { origin, ...stripped } = stored;
    expect(() => parsePendingAction(stripped)).toThrow();
    expect(() => parsePendingAction({ ...stored, source: { ...stored.source, producer: 'unrelated' } })).toThrow();
    await f.materializer.reject({ actionId: action.id });
    await expect(readFile(join(f.root, 'state/chapters/0001/0001.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
