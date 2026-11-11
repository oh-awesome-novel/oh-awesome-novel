import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient, projectPlayCanonBeatTable } from '@oh-awesome-novel/client';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const TIMELINE = 'events:\n  - id: e1\n    date: 七月十七日\n    title: 码头仓库暑期读书会\n  - id: e2\n    title: 仓库起火\n  - id: e3\n    title: 任野离开雾港\n';

const settlement = (narrative: string, body: Record<string, unknown>) => [
  narrative,
  '```oan-play-settlement',
  JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [], ...body }),
  '```',
].join('\n');
const event = (title: string) => ({ kind: 'npcActed', origin: 'npc', title, summary: `${title}。`, visibility: 'playerVisible', cause: { reason: '推进' } });

function parseSse(body: string): Array<Record<string, unknown>> {
  return body.split(/\r?\n\r?\n/u)
    .map((block) => block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    .filter((data) => data && data !== '[DONE]')
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

async function setup(replies: string[], withBeats = true) {
  const root = await mkdtemp(join(tmpdir(), 'oan-canon-beats-http-'));
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'timeline'), { recursive: true });
  await mkdir(join(root, 'chapters'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
  await writeFile(join(root, 'timeline/events.yaml'), TIMELINE);
  await writeFile(join(root, 'chapters/opening.md'), '雾港的夏天。\n');
  const requests: Array<{ request: string; system: string }> = [];
  const backend = await startNovelHttpBackend({
    workspaceRoot: root,
    streamPlayTurn: async function* (input) {
      requests.push({ request: input.request, system: JSON.stringify(input) });
      yield replies[requests.length - 1] ?? settlement('无事发生。', {});
    },
  });
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }); });
  const client = createOanClient({ backendBaseUrl: backend.url });
  const candidates = await client.listPlayCanonBeatCandidates('timeline/events.yaml');
  const { launchPackage } = await client.previewPlayLaunchPackage({
    title: '雾港',
    purpose: 'immersiveJourney',
    startMode: 'guided',
    simulationMode: 'activeWorld',
    density: 'volatile',
    sources: [
      { sourceId: 'chapter-opening', path: 'chapters/opening.md', role: 'chapter' },
      { sourceId: 'timeline-events', path: 'timeline/events.yaml', role: 'timeline' },
    ],
    entryPoint: { id: 'entry-1', label: '七月三日', opening: '来信刚到。', sourceRefs: ['chapter-opening'] },
    identity: { kind: 'player', persona: '穿越者' },
    participantRoles: [],
    ...(withBeats
      ? {
          canonBeats: {
            protagonistKnowsCanon: false,
            beats: [
              ...candidates.candidates.map((candidate) => ({
                label: candidate.label,
                ...(candidate.expectedWhen ? { expectedWhen: candidate.expectedWhen } : {}),
                source: { kind: 'sourceBacked' as const, sourceId: 'timeline-events', quote: candidate.quote },
              })),
              { label: '米拉向任野坦白', source: { kind: 'authorProvided' as const } },
              { label: '旧钟楼停摆', source: { kind: 'authorProvided' as const } },
            ],
          },
        }
      : {}),
  });
  await client.createPlayLaunchPackage(launchPackage);
  const { session } = await client.startPlaySessionFromLaunchPackage({ launchPackageId: launchPackage.id, id: 'canon' });
  const turn = async (baseRevision: number) => parseSse(await (await fetch(
    `${backend.url}/api/workspace/play-sessions/canon/turns/stream`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userText: '继续。', actionKind: 'do', baseRevision }) },
  )).text());
  const read = async () => (await client.getPlaySession('canon')).session;
  return { root, client, session, launchPackage, candidates, requests, turn, read };
}

const statuses = (session: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['read']>>) =>
  projectPlayCanonBeatTable(session.playLocalState, 'director')!.beats.map((beat) => beat.status);

describe('canon beats over SDK and HTTP/SSE', () => {
  it('picks beats, plays turns into all five statuses, and reports the divergence', async () => {
    const f = await setup([
      settlement('读书会如期举行。', { events: [event('读书会举行')], canonBeatChanges: [{ beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] }] }),
      settlement('仓库被封。', { events: [event('仓库被封'), event('任野留下')], canonBeatChanges: [
        { beatId: 'canon-beat-2', status: 'prevented', reason: '仓库在起火前被封。', eventRefs: [1] },
        { beatId: 'canon-beat-3', status: 'obsolete', reason: '任野已无离开的理由。', eventRefs: [2] },
      ] }),
      settlement('米拉写了信。', { events: [event('米拉写信')], canonBeatChanges: [{ beatId: 'canon-beat-4', status: 'altered', reason: '坦白改成了写信。', eventRefs: [1] }] }),
    ]);
    expect(f.candidates.candidates.map((candidate) => candidate.label)).toEqual(['码头仓库暑期读书会', '仓库起火', '任野离开雾港']);
    expect(f.launchPackage.canonBeats?.beats[0]?.source).toMatchObject({ kind: 'sourceBacked', path: 'timeline/events.yaml', quote: '码头仓库暑期读书会' });
    expect(statuses(f.session)).toEqual(Array(5).fill('pending'));

    for (const revision of [0, 1, 2]) {
      expect(await f.turn(revision)).toContainEqual(expect.objectContaining({ type: 'play.turn.committed', revision: revision + 1 }));
    }
    // The frozen prefix carries the canon protocol; each turn's tail lists the beats.
    expect(f.requests[0]!.system).toContain('canon beats protocol');
    expect(f.requests[0]!.request).toContain('- canon-beat-2 [pending] 仓库起火');
    expect(f.requests[2]!.request).toContain('- canon-beat-2 [prevented] 仓库起火');

    const session = await f.read();
    expect(statuses(session)).toEqual(['occurredAsCanon', 'prevented', 'obsolete', 'altered', 'pending']);
    expect(projectPlayCanonBeatTable(session.playLocalState, 'player')).toBeUndefined();

    const director = await f.client.generatePlayOutcomeReport('canon', { baseRevision: 3, projection: 'director' });
    expect(director.report.items.filter((item) => item.kind === 'canonDivergence').map((item) => item.summary)).toEqual([
      '已阻止「仓库起火」。原作（timeline/events.yaml）：仓库起火。本局：仓库在起火前被封。',
      '不再适用「任野离开雾港」。原作（timeline/events.yaml）：任野离开雾港。本局：任野已无离开的理由。',
      '已改写「米拉向任野坦白」。原作节点（作者提供）：米拉向任野坦白。本局：坦白改成了写信。',
    ]);
    const player = await f.client.getPlayOutcomeReport('canon', { baseRevision: 3, projection: 'player' });
    expect(JSON.stringify(player)).not.toContain('仓库起火');
    expect(JSON.stringify(player)).not.toContain('canonDivergence');
  });

  it.each([
    ['a forged beat id', { beatId: 'canon-beat-9', status: 'prevented', reason: 'x', eventRefs: [1] }],
    ['an event of another turn', { beatId: 'canon-beat-2', status: 'prevented', reason: 'x', eventRefs: [3] }],
    ['a settled beat', { beatId: 'canon-beat-1', status: 'altered', reason: 'x', eventRefs: [1] }],
    ['a return to pending', { beatId: 'canon-beat-1', status: 'pending', reason: 'x', eventRefs: [1] }],
  ])('fails the turn with zero writes for %s', async (_label, change) => {
    const f = await setup([
      settlement('读书会如期举行。', { events: [event('读书会举行')], canonBeatChanges: [{ beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] }] }),
      settlement('出错的一回合。', { events: [event('某事')], stateDelta: { leaked: true }, canonBeatChanges: [change] }),
    ]);
    await f.turn(0);
    const before = await f.read();
    const turnFiles = await readdir(join(f.root, '.workspace/play-sessions/canon/turns'));

    const events = await f.turn(1);

    expect(events.some((item) => item.type === 'play.turn.failed')).toBe(true);
    expect(events.some((item) => item.type === 'play.turn.committed')).toBe(false);
    const after = await f.read();
    expect(after.revision).toBe(before.revision);
    expect(after.playLocalState).toEqual(before.playLocalState);
    expect(after.events).toEqual(before.events);
    expect(await readdir(join(f.root, '.workspace/play-sessions/canon/turns'))).toEqual(turnFiles);
  });

  it('applies director corrections and scheduling with revision checks, and follows Restore', async () => {
    const f = await setup([
      settlement('仓库被封。', { events: [event('仓库被封')], canonBeatChanges: [{ beatId: 'canon-beat-2', status: 'prevented', reason: '被封。', eventRefs: [1] }] }),
    ]);
    await f.turn(0);

    await expect(f.client.applyPlayCanonBeatOperation('canon', {
      baseRevision: 0,
      operation: { type: 'correct', beatId: 'canon-beat-2', status: 'altered', reason: '只是推迟。' },
    })).rejects.toThrow();
    const corrected = (await f.client.applyPlayCanonBeatOperation('canon', {
      baseRevision: 1,
      operation: { type: 'correct', beatId: 'canon-beat-2', status: 'altered', reason: '只是推迟。' },
    })).session;
    expect(statuses(corrected)[1]).toBe('altered');
    expect(projectPlayCanonBeatTable(corrected.playLocalState, 'director')!.changes.at(-1)).toMatchObject({ origin: 'manual', from: 'prevented', to: 'altered' });

    const scheduled = (await f.client.applyPlayCanonBeatOperation('canon', {
      baseRevision: 2,
      operation: { type: 'schedule', beatId: 'canon-beat-3', trigger: { type: 'afterTurns', turns: 2 }, visibility: 'playerVisible' },
    })).session;
    expect(scheduled.scheduledEvents.at(-1)).toMatchObject({ label: '任野离开雾港', status: 'scheduled', trigger: { type: 'afterTurns', turns: 2 } });
    // The full session, replayed by the SDK's own validation, still loads.
    expect((await f.read()).revision).toBe(3);

    await expect(f.client.applyPlayCanonBeatOperation('canon', {
      baseRevision: 3,
      operation: { type: 'correct', beatId: 'canon-beat-2', status: 'pending' as never, reason: '改回去' },
    })).rejects.toThrow();
    await expect(f.client.applyPlayCanonBeatOperation('canon', {
      baseRevision: 3,
      operation: { type: 'schedule', beatId: 'canon-beat-2', trigger: { type: 'nextTurn' } },
    })).rejects.toThrow();
    expect((await f.read()).revision).toBe(3);

    await f.client.restorePlayCheckpoint('canon', 'turn-artifact-1', { baseRevision: 3 });
    const restored = await f.read();
    expect(statuses(restored)[1]).toBe('prevented');
    expect(restored.scheduledEvents.filter((item) => item.status === 'scheduled' && restored.selectedTurnIds.length === 1)).toBeDefined();
    expect(projectPlayCanonBeatTable(restored.playLocalState, 'director')!.beats[2]!.scheduledEventId).toBeUndefined();
  });

  it('keeps a session without canon beats free of the protocol and rejects canon changes', async () => {
    const f = await setup([
      settlement('平静的一天。', { events: [event('日常')] }),
      settlement('越界的一回合。', { events: [event('某事')], canonBeatChanges: [{ beatId: 'canon-beat-1', status: 'prevented', reason: 'x', eventRefs: [1] }] }),
    ], false);
    expect(Object.hasOwn(f.launchPackage, 'canonBeats')).toBe(false);
    expect(f.session.playLocalState).toEqual({});

    await f.turn(0);
    expect(f.requests[0]!.system).not.toContain('canon beat');
    expect(f.requests[0]!.request).not.toContain('Canon beats');
    expect((await f.turn(1)).some((item) => item.type === 'play.turn.failed')).toBe(true);
    expect((await f.read()).revision).toBe(1);
    await expect(f.client.applyPlayCanonBeatOperation('canon', {
      baseRevision: 1,
      operation: { type: 'correct', beatId: 'canon-beat-1', status: 'altered', reason: 'x' },
    })).rejects.toThrow();
  });
});
