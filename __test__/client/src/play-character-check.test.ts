import { expect, it, vi } from 'vite-plus/test';
import { createOanClient, formatPlayCharacterCheckGuidance } from '@oh-awesome-novel/client';

const finding = {
  id: 'finding-1', characterRef: 'shen-yan', character: '沈砚', category: 'voice', quote: '我把所有计划都告诉你吧',
  segmentId: 'message-1', evidence: '沈砚说话极少，从不解释自己的决定。', evidenceSource: '角色卡', note: '她不会主动解释计划。',
};
const report = {
  schemaVersion: 1, id: 'character-check-1', sessionId: 'check', target: { kind: 'turn', turnId: 'turn-artifact-1' }, lens: 'player',
  branchTurnIds: ['turn-artifact-1'], narrativeHash: 'a'.repeat(64), createdAt: '2026-11-12T00:00:00.000Z',
  characters: [{ ref: 'shen-yan', name: '沈砚', status: 'referenced' }], findings: [finding], discardedCount: 1, omissions: [], stale: false,
};
const client = (body: unknown) => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  return { fetcher, api: createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher }) };
};
const input = { target: { kind: 'turn' as const, turnId: 'turn-artifact-1' }, lens: 'player' as const };

it('posts only target and lens and returns the verified report', async () => {
  const { api, fetcher } = client({ report });
  await expect(api.requestPlayCharacterCheck('check', input)).resolves.toEqual(report);
  expect(fetcher.mock.calls[0]?.[0]).toBe('http://test/api/workspace/play-sessions/check/character-checks');
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(input);
});

it('rejects reports for another session, target or lens, and anything carrying extra fields', async () => {
  for (const changed of [
    { sessionId: 'other' }, { lens: 'director' }, { target: { kind: 'turn', turnId: 'turn-artifact-2' } },
    { score: 80 }, { stale: 'no' }, { discardedCount: -1 },
    { findings: [{ ...finding, category: 'tone' }] }, { findings: [{ ...finding, hiddenFact: '密探' }] },
    { characters: [{ ref: 'x', name: 'x', status: 'clean' }] },
  ]) {
    await expect(client({ report: { ...report, ...changed } }).api.requestPlayCharacterCheck('check', input)).rejects.toThrow('角色贴合度检查响应无效');
  }
});

it('lists one lens only: a Director-lens report in a Player listing is a protocol error', async () => {
  const ok = client({ reports: [report] });
  await expect(ok.api.listPlayCharacterChecks('check', 'player')).resolves.toEqual([report]);
  expect(ok.fetcher.mock.calls[0]?.[0]).toBe('http://test/api/workspace/play-sessions/check/character-checks?lens=player');
  await expect(client({ reports: [{ ...report, lens: 'director' }] }).api.listPlayCharacterChecks('check', 'player')).rejects.toThrow();
});

it('formats editable retry guidance within the 500 character limit', () => {
  expect(formatPlayCharacterCheckGuidance(finding as never)).toContain(finding.quote);
  expect(formatPlayCharacterCheckGuidance(finding as never)).toContain('声线');
  expect([...formatPlayCharacterCheckGuidance({ ...finding, note: '注'.repeat(900), quote: '句'.repeat(900) } as never)].length).toBeLessThanOrEqual(500);
});
