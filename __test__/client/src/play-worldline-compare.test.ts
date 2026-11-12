import { expect, it, vi } from 'vite-plus/test';
import { createOanClient } from '@oh-awesome-novel/client';

const query = { left: 'initial-world', right: 'turn-artifact-1', lens: 'player' as const };
const result = {
  sessionId: 'compare', revision: 1, lens: 'player', page: 0, pageSize: 40, canonical: false,
  left: { checkpointId: query.left, turnCount: 0, divergentTurnCount: 0, clock: { turn: 0, revision: 0 } },
  right: { checkpointId: query.right, turnCount: 1, divergentTurnCount: 1, clock: { turn: 1, revision: 1, elapsed: '1 minute' } },
  commonAncestor: 'initial-world',
  sections: ['actions', 'state', 'events', 'scheduled', 'knowledge', 'canon'].map(kind => ({ kind, total: 0, items: [] })),
};
function client(body: unknown) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  return { fetcher, api: createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher }) };
}
it('uses a bound GET query and abort signal without mutating the session', async () => {
  const { api, fetcher } = client(result);
  const signal = new AbortController().signal;
  await expect(api.comparePlayWorldlines('compare', query, signal)).resolves.toEqual(result);
  expect(fetcher.mock.calls[0]?.[0]).toBe('http://test/api/workspace/play-sessions/compare/worldline-comparison?left=initial-world&right=turn-artifact-1&lens=player&page=0');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ signal });
});
it('rejects swapped targets, lens drift, oversized rows and extra payloads', async () => {
  for (const change of [
    { sessionId: 'other' }, { lens: 'director' }, { page: 1 }, { pageSize: 400 }, { left: result.right },
    { sections: [] }, { transcript: ['secret'] },
    { right: { ...result.right, clock: { turn: 1, revision: 1, hidden: true } } },
    { sections: [{ kind: 'actions', total: 1, items: [{ key: '0', label: '行动', right: 'x'.repeat(641) }] }, ...result.sections.slice(1)] },
    { sections: [{ kind: 'actions', total: 41, items: [] }, ...result.sections.slice(1)] },
    { sections: [{ kind: 'actions', total: 1, items: [{ key: '0', label: '行动', right: 'one', rawArtifact: {} }] }, ...result.sections.slice(1)] },
  ]) await expect(client({ ...result, ...change }).api.comparePlayWorldlines('compare', query)).rejects.toThrow('Invalid');
});
it('accepts an explicit unavailable result and rejects malformed requests locally', async () => {
  const { api, fetcher } = client({ ...result, sections: [], unavailableReason: '旧节点无快照' });
  await expect(api.comparePlayWorldlines('compare', query)).resolves.toMatchObject({ unavailableReason: '旧节点无快照' });
  const calls = fetcher.mock.calls.length;
  for (const change of [{ left: '../escape' }, { lens: 'author' }, { page: -1 }, { page: 100001 }, { page: 0.1 }]) {
    expect(() => api.comparePlayWorldlines('compare', { ...query, ...change } as never)).toThrow();
  }
  expect(fetcher.mock.calls).toHaveLength(calls);
});
