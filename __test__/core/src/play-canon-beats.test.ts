import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  PLAY_CANON_BEATS_PROTOCOL_MARKER,
  PLAY_CANON_BEATS_STATE_KEY,
  applyPlayCanonBeatDirectorOperation,
  auditPlayCompaction,
  buildPlayCompactionPrompt,
  createCompactedPlaySession,
  createPlayCompactionPreview,
  createPlayOutcomeReport,
  createPlaySessionDraft,
  createPlaySessionFromLaunchPackage,
  evaluatePlaySessionDueEvents,
  formatPlayWorldRefereePrompt,
  formatPlayWorldRefereeTurnContext,
  getPlayFrozenSystemPrompt,
  listPlayCanonBeatCandidates,
  listPlayLaunchCanonBeatCandidates,
  normalizePlayWorldRefereeSettlement,
  preparePlayWorldSettlementRetry,
  previewPlayLaunchPackage,
  projectPlayCanonBeats,
  projectPlayOutcomeReport,
  readPlayCanonBeatTable,
  readPlaySessionFiles,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeSettlement,
  settlePlayWorldSettlementRetry,
  summarizePlaySession,
  writePlayLaunchPackage,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type {
  PlayCanonBeatChange,
  PlayLaunchPackagePreviewInput,
  PlaySession,
  PlayWorldRefereeSettlementEvent,
} from '@oh-awesome-novel/core';

const TIMELINE = [
  'events:',
  '  - id: e001',
  '    date: 七月三日',
  '    title: 米拉收到未来来信',
  '  - id: e002',
  '    date: 七月十七日',
  '    title: 码头仓库暑期读书会',
  '  - id: e003',
  '    date: 七月十七日夜',
  '    title: 仓库起火',
  '  - id: e004',
  '    date: 七月十八日',
  '    title: 任野离开雾港',
  '',
].join('\n');

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-canon-beats-'));
  roots.push(root);
  await mkdir(join(root, 'timeline'), { recursive: true });
  await mkdir(join(root, 'chapters'), { recursive: true });
  await writeFile(join(root, 'timeline/events.yaml'), TIMELINE);
  await writeFile(join(root, 'chapters/opening.md'), '雾港的夏天。\n');
  return root;
}

function launchInput(
  overrides: Partial<PlayLaunchPackagePreviewInput> = {},
): PlayLaunchPackagePreviewInput {
  return {
    id: 'setup-canon',
    createdAt: '2026-11-10T00:00:00.000Z',
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
    canonBeats: {
      protagonistKnowsCanon: false,
      beats: [
        { label: '码头仓库暑期读书会', expectedWhen: '七月十七日', source: { kind: 'sourceBacked', sourceId: 'timeline-events', quote: '码头仓库暑期读书会' } },
        { label: '仓库起火', source: { kind: 'sourceBacked', sourceId: 'timeline-events', quote: '仓库起火' } },
        { label: '任野离开雾港', source: { kind: 'sourceBacked', sourceId: 'timeline-events', quote: '任野离开雾港' } },
        { label: '米拉向任野坦白', source: { kind: 'authorProvided' } },
        { label: '旧钟楼停摆', source: { kind: 'authorProvided' } },
      ],
    },
    ...overrides,
  };
}

async function canonSession(root: string, overrides: Partial<PlayLaunchPackagePreviewInput> = {}) {
  const launchPackage = await previewPlayLaunchPackage(root, launchInput(overrides));
  return { launchPackage, session: createPlaySessionFromLaunchPackage(launchPackage, { id: 'play-canon', createdAt: '2026-11-10T00:00:00.000Z' }) };
}

const worldEvent = (title: string, visibility: PlayWorldRefereeSettlementEvent['visibility'] = 'playerVisible'): PlayWorldRefereeSettlementEvent => ({
  kind: 'npcActed', origin: 'npc', title, summary: `${title}。`, visibility, cause: { reason: '剧情推进' },
});

function settle(
  session: PlaySession,
  events: PlayWorldRefereeSettlementEvent[],
  canonBeatChanges: unknown,
): PlaySession {
  return settlePlayWorldRefereeSettlement({
    session,
    userText: '继续。',
    actionKind: 'do',
    narrative: '故事继续。',
    createdAt: `2026-11-10T00:${String(session.revision + 1).padStart(2, '0')}:00.000Z`,
    settlement: normalizePlayWorldRefereeSettlement({ events, canonBeatChanges, stateDelta: {}, observations: [], suggestedActions: [] }),
  });
}

const beatStatuses = (session: PlaySession) =>
  readPlayCanonBeatTable(session.playLocalState)!.beats.map((beat) => beat.status);

describe('canon beats at launch', () => {
  it('freezes path, content hash and verbatim quote, and marks hand-written beats as author-provided', async () => {
    const root = await workspace();
    const { launchPackage, session } = await canonSession(root);

    expect(launchPackage.diagnostics).toEqual([]);
    const timeline = launchPackage.sourceBase.activatedSources[1]!;
    expect(launchPackage.canonBeats?.beats[0]).toEqual({
      id: 'canon-beat-1',
      label: '码头仓库暑期读书会',
      expectedWhen: '七月十七日',
      source: { kind: 'sourceBacked', sourceId: 'timeline-events', path: 'timeline/events.yaml', contentHash: timeline.contentHash, quote: '码头仓库暑期读书会' },
    });
    expect(launchPackage.canonBeats?.beats[3]?.source).toEqual({ kind: 'authorProvided', providedAt: '2026-11-10T00:00:00.000Z' });

    const table = readPlayCanonBeatTable(session.playLocalState)!;
    expect(table.beats.map((beat) => [beat.status, beat.visibility])).toEqual(Array(5).fill(['pending', 'playerUnknown']));
    expect(session.playLocalStateVisibility[PLAY_CANON_BEATS_STATE_KEY]).toBe('playerUnknown');
    expect(session.branchBaseSnapshot.playLocalState[PLAY_CANON_BEATS_STATE_KEY]).toEqual(table);
    expect(getPlayFrozenSystemPrompt(session)).toContain(PLAY_CANON_BEATS_PROTOCOL_MARKER);
    expect(getPlayFrozenSystemPrompt(session)).toContain('does not know canon');

    await writePlayLaunchPackage(root, launchPackage);
    await writePlaySessionFiles(root, session, { expectedAbsent: true });
    expect(readPlayCanonBeatTable((await readPlaySessionFiles(root, session.id)).playLocalState)).toEqual(table);
  });

  it('blocks creation when a quote is no longer in its timeline source', async () => {
    const root = await workspace();
    const input = launchInput();
    input.canonBeats!.beats[1] = { label: '仓库起火', source: { kind: 'sourceBacked', sourceId: 'timeline-events', quote: '仓库没有起火' } };

    const launchPackage = await previewPlayLaunchPackage(root, input);

    expect(launchPackage.diagnostics).toEqual([expect.objectContaining({ code: 'canonBeatQuoteMissing', severity: 'error', path: 'timeline/events.yaml' })]);
    await expect(writePlayLaunchPackage(root, launchPackage)).rejects.toThrow('missing, invalid, or stale');
    expect(() => createPlaySessionFromLaunchPackage(launchPackage, { id: 'blocked' })).toThrow('blocking diagnostics');
  });

  it('rejects canon beats outside a timeline source, beyond 24, or for a scene rehearsal', async () => {
    const root = await workspace();
    const notTimeline = launchInput();
    notTimeline.canonBeats!.beats[0] = { label: '雾港', source: { kind: 'sourceBacked', sourceId: 'chapter-opening', quote: '雾港' } };
    await expect(previewPlayLaunchPackage(root, notTimeline)).rejects.toThrow('selected timeline source');

    const tooMany = launchInput();
    tooMany.canonBeats!.beats = Array.from({ length: 25 }, (_, index) => ({ label: `节点 ${index}`, source: { kind: 'authorProvided' as const } }));
    await expect(previewPlayLaunchPackage(root, tooMany)).rejects.toThrow('1-24');

    await expect(previewPlayLaunchPackage(root, launchInput({
      purpose: 'sceneRehearsal',
      identity: { kind: 'director', directorPurpose: '试演' },
      participantRoles: [{ participantRef: 'p1', displayName: '米拉', sourceRefs: [], initialKnowledge: [] }],
    }))).rejects.toThrow('only supported for an Immersive Journey');
  });

  it('leaves a session without canon beats exactly as before', async () => {
    const root = await workspace();
    const { launchPackage, session } = await canonSession(root, { canonBeats: undefined });

    expect(Object.hasOwn(launchPackage, 'canonBeats')).toBe(false);
    expect(session.playLocalState).toEqual({});
    expect(session.playLocalStateVisibility).toEqual({});
    expect(getPlayFrozenSystemPrompt(session)).not.toContain('canon beat');
    expect(formatPlayWorldRefereePrompt(session)).not.toContain('Canon beats');
    const settled = settle(session, [worldEvent('平静的一天')], undefined);
    expect(Object.hasOwn(settled.turnArtifacts[0]!.stateDelta, PLAY_CANON_BEATS_STATE_KEY)).toBe(false);
    expect(Object.hasOwn(normalizePlayWorldRefereeSettlement({ canonBeatChanges: [] }), 'canonBeatChanges')).toBe(false);
  });

  it('lists verbatim candidates from a structured timeline and from plain lines', async () => {
    const root = await workspace();
    const structured = await listPlayLaunchCanonBeatCandidates(root, 'timeline/events.yaml');
    expect(structured.candidates).toEqual([
      { label: '米拉收到未来来信', quote: '米拉收到未来来信', expectedWhen: '七月三日' },
      { label: '码头仓库暑期读书会', quote: '码头仓库暑期读书会', expectedWhen: '七月十七日' },
      { label: '仓库起火', quote: '仓库起火', expectedWhen: '七月十七日夜' },
      { label: '任野离开雾港', quote: '任野离开雾港', expectedWhen: '七月十八日' },
    ]);
    await expect(listPlayLaunchCanonBeatCandidates(root, 'chapters/opening.md')).rejects.toThrow('timeline source');

    const plain = '# 时间线\n\n- 第一天：来信\n2. 第二天：见面\n```\ncode\n```\n第三天：火灾\n';
    const candidates = listPlayCanonBeatCandidates(plain);
    expect(candidates.map((candidate) => candidate.quote)).toEqual(['第一天：来信', '第二天：见面', '第三天：火灾']);
    expect(candidates.every((candidate) => plain.includes(candidate.quote))).toBe(true);
  });
});

describe('canon beats in turn settlement', () => {
  it('reaches all five statuses through real turns and records the causing turn and events', async () => {
    const { session } = await canonSession(await workspace());
    expect(formatPlayWorldRefereeTurnContext(session).state).toContain('- canon-beat-1 [pending] 码头仓库暑期读书会; expected: 七月十七日; canon: "码头仓库暑期读书会"');
    expect(formatPlayWorldRefereeTurnContext(session).state).not.toContain('"canonBeats"');

    let next = settle(session, [worldEvent('读书会照常举行')], [
      { beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '读书会如期举行。', eventRefs: [1] },
    ]);
    next = settle(next, [worldEvent('仓库被提前封锁'), worldEvent('任野改变主意', 'playerUnknown')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '仓库在起火前被封。', eventRefs: [1] },
      { beatId: 'canon-beat-3', status: 'obsolete', reason: '任野已无离开的理由。', eventRefs: [1, 2] },
    ]);
    next = settle(next, [worldEvent('米拉写信坦白')], [
      { beatId: 'canon-beat-4', status: 'altered', reason: '坦白改成了写信。', eventRefs: [1] },
    ]);

    expect(beatStatuses(next)).toEqual(['occurredAsCanon', 'prevented', 'obsolete', 'altered', 'pending']);
    const table = readPlayCanonBeatTable(next.playLocalState)!;
    expect(table.beats[2]).toMatchObject({ changedAtTurnId: 'turn-2-referee', causeEventIds: ['turn-2-event-1', 'turn-2-event-2'], note: '任野已无离开的理由。' });
    expect(table.changes.map((change) => [change.id, change.beatId, change.from, change.to, change.origin, change.revision])).toEqual([
      ['canon-change-1-1', 'canon-beat-1', 'pending', 'occurredAsCanon', 'referee', 1],
      ['canon-change-2-1', 'canon-beat-2', 'pending', 'prevented', 'referee', 2],
      ['canon-change-2-2', 'canon-beat-3', 'pending', 'obsolete', 'referee', 2],
      ['canon-change-3-1', 'canon-beat-4', 'pending', 'altered', 'referee', 3],
    ]);
    expect(next.playLocalStateVisibility[PLAY_CANON_BEATS_STATE_KEY]).toBe('playerUnknown');
    // The stored-history rules accept exactly what the settlement produced.
    expect(summarizePlaySession(next).revision).toBe(3);
  });

  it.each<[string, unknown, string]>([
    ['a forged beat id', [{ beatId: 'canon-beat-99', status: 'prevented', reason: 'x', eventRefs: [1] }], 'unknown beat'],
    ['an event of another turn', [{ beatId: 'canon-beat-2', status: 'prevented', reason: 'x', eventRefs: [2] }], "not one of this turn's events"],
    ['an event id instead of a position', [{ beatId: 'canon-beat-2', status: 'prevented', reason: 'x', eventRefs: ['turn-1-event-1'] }], '1-based position'],
    ['no event at all', [{ beatId: 'canon-beat-2', status: 'prevented', reason: 'x', eventRefs: [] }], '1-based position'],
    ['a return to pending', [{ beatId: 'canon-beat-1', status: 'pending', reason: 'x', eventRefs: [1] }], 'cannot return to pending'],
    ['an already settled beat', [{ beatId: 'canon-beat-1', status: 'altered', reason: 'x', eventRefs: [1] }], 'Illegal Play canon beat transition'],
    ['the same beat twice', [
      { beatId: 'canon-beat-2', status: 'prevented', reason: 'x', eventRefs: [1] },
      { beatId: 'canon-beat-2', status: 'altered', reason: 'y', eventRefs: [1] },
    ], 'duplicate'],
    ['a missing reason', [{ beatId: 'canon-beat-2', status: 'prevented', reason: ' ', eventRefs: [1] }], 'reason'],
  ])('fails the whole turn for %s', async (_label, changes, message) => {
    const { session } = await canonSession(await workspace());
    const settled = settle(session, [worldEvent('读书会照常举行')], [
      { beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] },
    ]);
    const before = structuredClone(settled);

    expect(() => settle(settled, [worldEvent('又一件事')], changes)).toThrow(message);
    // Settlement is pure: a rejected turn leaves the session value untouched.
    expect(settled).toEqual(before);
  });

  it('rejects canon changes on a session without a table and through raw stateDelta', async () => {
    const plain = createPlaySessionDraft({ id: 'plain', title: 'Plain', sceneStart: 'Start', characters: [] });
    const change: PlayCanonBeatChange = { beatId: 'canon-beat-1', status: 'prevented', reason: 'x', eventRefs: [1] };
    expect(() => settle(plain, [worldEvent('事件')], [change])).toThrow('no canon beat table');
    expect(() => normalizePlayWorldRefereeSettlement({ stateDelta: { canonBeats: {} } })).toThrow('reserved state');
  });

  it('refuses to load history that adds a table to an older session or rewrites a settled beat', async () => {
    const { session } = await canonSession(await workspace());
    const plain = settle(createPlaySessionDraft({ id: 'plain', title: 'Plain', sceneStart: 'Start', characters: [] }), [worldEvent('事件')], undefined);
    const table = readPlayCanonBeatTable(session.playLocalState)!;
    const enabledLate = structuredClone(plain);
    const artifact = enabledLate.turnArtifacts[0]!;
    artifact.stateDelta.canonBeats = table;
    artifact.playLocalStateSnapshot!.canonBeats = table;
    artifact.playLocalStateVisibilitySnapshot!.canonBeats = 'playerUnknown';
    enabledLate.playLocalState.canonBeats = table;
    enabledLate.playLocalStateVisibility.canonBeats = 'playerUnknown';
    expect(() => summarizePlaySession(enabledLate)).toThrow('cannot add or remove the canon beat table');

    const settled = settle(session, [worldEvent('读书会照常举行')], [
      { beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] },
    ]);
    const tampered = structuredClone(settled);
    for (const state of [tampered.playLocalState, tampered.turnArtifacts[0]!.playLocalStateSnapshot!, tampered.turnArtifacts[0]!.stateDelta]) {
      (state.canonBeats as { beats: Array<{ status: string }> }).beats[0]!.status = 'prevented';
    }
    expect(() => summarizePlaySession(tampered)).toThrow('does not match its recorded changes');
  });

  it('returns the table to the restored branch and to the before-state of a sibling turn', async () => {
    const { session } = await canonSession(await workspace());
    const first = settle(session, [worldEvent('读书会照常举行')], [
      { beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] },
    ]);
    const second = settle(first, [worldEvent('仓库被封')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '被封。', eventRefs: [1] },
    ]);

    const restored = restorePlaySessionCheckpoint(second, 'turn-artifact-1', { baseRevision: second.revision });
    expect(beatStatuses(restored)).toEqual(['occurredAsCanon', 'pending', 'pending', 'pending', 'pending']);
    const sibling = settle(restored, [worldEvent('仓库还是起火了')], [
      { beatId: 'canon-beat-2', status: 'occurredAsCanon', reason: '火灾照常发生。', eventRefs: [1] },
    ]);
    expect(beatStatuses(sibling)).toEqual(['occurredAsCanon', 'occurredAsCanon', 'pending', 'pending', 'pending']);
    expect(readPlayCanonBeatTable(sibling.playLocalState)!.changes.map((change) => change.to)).toEqual(['occurredAsCanon', 'occurredAsCanon']);

    const initial = restorePlaySessionCheckpoint(second, 'initial-world', { baseRevision: second.revision });
    expect(beatStatuses(initial)).toEqual(Array(5).fill('pending'));
  });

  it('retries a turn from its before-state, so the sibling may settle the beat differently', async () => {
    const { session } = await canonSession(await workspace());
    const first = settle(session, [worldEvent('读书会照常举行')], [
      { beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] },
    ]);
    const second = settle(first, [worldEvent('仓库被封')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '被封。', eventRefs: [1] },
    ]);

    const preparation = preparePlayWorldSettlementRetry(second, 'turn-artifact-2');
    expect(beatStatuses(preparation.beforeTurnSession)).toEqual(['occurredAsCanon', 'pending', 'pending', 'pending', 'pending']);
    const retried = settlePlayWorldSettlementRetry({
      session: second,
      sourceArtifactId: 'turn-artifact-2',
      expectedSessionRevision: preparation.expectedSessionRevision,
      refereeResponse: ['这一次火还是烧了起来。', '```oan-play-settlement', JSON.stringify({
        events: [worldEvent('仓库起火')],
        canonBeatChanges: [{ beatId: 'canon-beat-2', status: 'altered', reason: '火起得更早。', eventRefs: [1] }],
        stateDelta: {}, observations: [], suggestedActions: [],
      }), '```'].join('\n'),
      createdAt: '2026-11-10T05:00:00.000Z',
    }).session;

    expect(beatStatuses(retried)).toEqual(['occurredAsCanon', 'altered', 'pending', 'pending', 'pending']);
    expect(readPlayCanonBeatTable(retried.playLocalState)!.changes.map((change) => change.to)).toEqual(['occurredAsCanon', 'altered']);
    // The first verdict stays on its own branch.
    expect(readPlayCanonBeatTable(second.playLocalState)!.beats[1]!.status).toBe('prevented');
    expect(summarizePlaySession(retried).selectedTurnCount).toBe(2);
  });

  it('opens an archived next phase with the complete table and keeps settling it', async () => {
    const { session } = await canonSession(await workspace());
    const settled = settle(session, [worldEvent('读书会照常举行')], [
      { beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] },
    ]);
    const preview = createPlayCompactionPreview(settled, JSON.stringify({
      version: 1,
      turnsCovered: 1,
      characters: [],
      chronicle: [{ fact: '故事继续。', quote: '故事继续。' }],
      unresolvedThreads: [],
      currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' },
      voiceAndStyle: { pov: '第二人称', rhythm: '平缓', tonePoints: ['克制'] },
      resourceState: {},
    }));

    const next = createCompactedPlaySession(settled, preview, 'play-canon-phase-2');

    expect(readPlayCanonBeatTable(next.playLocalState)).toEqual(readPlayCanonBeatTable(settled.playLocalState));
    expect(getPlayFrozenSystemPrompt(next)).toContain(PLAY_CANON_BEATS_PROTOCOL_MARKER);
    const continued = settle(next, [worldEvent('仓库被封')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '被封。', eventRefs: [1] },
    ]);
    expect(beatStatuses(continued)).toEqual(['occurredAsCanon', 'prevented', 'pending', 'pending', 'pending']);
  });

  it('carries the table into an archived phase without asking the model to restate it', async () => {
    const { session } = await canonSession(await workspace());
    const settled = settle(session, [worldEvent('读书会照常举行')], [
      { beatId: 'canon-beat-1', status: 'occurredAsCanon', reason: '如期举行。', eventRefs: [1] },
    ]);

    expect(buildPlayCompactionPrompt(settled)).not.toContain('canon-beat-1');
    const errors = auditPlayCompaction(settled, {
      version: 1,
      turnsCovered: 1,
      characters: [],
      chronicle: [],
      unresolvedThreads: [],
      currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' },
      voiceAndStyle: { pov: '第二人称', rhythm: '平缓', tonePoints: [] },
      resourceState: {},
    });
    expect(errors).not.toContain('Resource/state ledger changed or omitted facts.');
    // The continuation is a host clone of the session, so the table travels with it.
    expect(readPlayCanonBeatTable(structuredClone(settled).playLocalState)).toEqual(readPlayCanonBeatTable(settled.playLocalState));
  });
});

describe('canon beat director operations', () => {
  it('records a manual correction, allows settled-to-settled, and never returns to pending', async () => {
    const root = await workspace();
    const { session } = await canonSession(root);
    const settled = settle(session, [worldEvent('仓库被封')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '被封。', eventRefs: [1] },
    ]);

    const corrected = applyPlayCanonBeatDirectorOperation(settled, {
      type: 'correct', beatId: 'canon-beat-2', status: 'altered', reason: '其实只是推迟了。',
    }, '2026-11-10T01:00:00.000Z');
    const direct = applyPlayCanonBeatDirectorOperation(corrected, {
      type: 'correct', beatId: 'canon-beat-5', status: 'obsolete', reason: '钟楼已拆。',
    }, '2026-11-10T01:01:00.000Z');

    const table = readPlayCanonBeatTable(direct.playLocalState)!;
    expect(table.beats[1]).toMatchObject({ status: 'altered', causeEventIds: [], note: '其实只是推迟了。' });
    expect(table.changes.slice(1).map((change) => [change.from, change.to, change.origin, change.eventIds])).toEqual([
      ['prevented', 'altered', 'manual', []],
      ['pending', 'obsolete', 'manual', []],
    ]);
    // The note is a transcriptAppend by the director; its text names no beat.
    const note = direct.turnArtifacts.at(-1)!;
    expect(note).toMatchObject({ artifactKind: 'transcriptAppend', eventIds: [], messages: [{ speaker: 'director' }] });
    expect(note.messages[0]!.content).not.toContain('钟楼');
    expect(direct.worldClock.turn).toBe(settled.worldClock.turn);

    expect(() => applyPlayCanonBeatDirectorOperation(direct, {
      type: 'correct', beatId: 'canon-beat-2', status: 'pending' as never, reason: '改回去',
    })).toThrow('cannot return to pending');
    expect(() => applyPlayCanonBeatDirectorOperation(direct, {
      type: 'correct', beatId: 'canon-beat-2', status: 'altered', reason: '没有变化',
    })).toThrow('Illegal Play canon beat transition');

    await writePlaySessionFiles(root, direct, { expectedAbsent: true });
    const reread = await readPlaySessionFiles(root, direct.id);
    expect(readPlayCanonBeatTable(reread.playLocalState)).toEqual(table);

    // Restoring before the correction brings the referee's verdict back.
    const restored = restorePlaySessionCheckpoint(direct, 'turn-artifact-1', { baseRevision: direct.revision });
    expect(beatStatuses(restored)[1]).toBe('prevented');
  });

  it('turns a pending beat into a scheduled event with an existing trigger type', async () => {
    const root = await workspace();
    const { session } = await canonSession(root);

    const scheduled = applyPlayCanonBeatDirectorOperation(session, {
      type: 'schedule', beatId: 'canon-beat-2', trigger: { type: 'nextTurn' }, visibility: 'playerVisible',
    }, '2026-11-10T01:00:00.000Z');

    const event = scheduled.scheduledEvents.at(-1)!;
    expect(event).toMatchObject({
      label: '仓库起火',
      trigger: { type: 'nextTurn' },
      status: 'scheduled',
      sourceTurnId: 'turn-artifact-1-message-1',
      template: { kind: 'manual', origin: 'manual', title: '仓库起火', summary: '仓库起火', visibility: 'playerVisible' },
    });
    expect(readPlayCanonBeatTable(scheduled.playLocalState)!.beats[1]).toMatchObject({ status: 'pending', scheduledEventId: event.id });
    expect(evaluatePlaySessionDueEvents(scheduled).dueEvents.map((due) => due.id)).toEqual([event.id]);
    // Scheduling alone settles nothing: the beat is still pending.
    expect(readPlayCanonBeatTable(scheduled.playLocalState)!.changes).toEqual([]);

    expect(() => applyPlayCanonBeatDirectorOperation(scheduled, {
      type: 'schedule', beatId: 'canon-beat-2', trigger: { type: 'nextTurn' },
    })).toThrow('already has a scheduled event');
    expect(() => applyPlayCanonBeatDirectorOperation(scheduled, {
      type: 'schedule', beatId: 'canon-beat-3', trigger: { type: 'atWorldTime', value: '明天早上', format: 'iso8601' },
    })).toThrow();

    await writePlaySessionFiles(root, scheduled, { expectedAbsent: true });
    const reread = await readPlaySessionFiles(root, scheduled.id);
    expect(reread.scheduledEvents.at(-1)).toEqual(event);

    // The due event fires through an ordinary settlement and can settle the beat.
    const fired = settlePlayWorldRefereeSettlement({
      session: reread, userText: '等待。', actionKind: 'do', narrative: '火光亮起。', createdAt: '2026-11-10T02:00:00.000Z',
      settlement: normalizePlayWorldRefereeSettlement({
        events: [{ kind: 'manual', origin: 'manual', title: '仓库起火', summary: '仓库起火', visibility: 'playerVisible', cause: { reason: '计划事件到期', triggerId: event.id } }],
        canonBeatChanges: [{ beatId: 'canon-beat-2', status: 'occurredAsCanon', reason: '火灾按原作发生。', eventRefs: [1] }],
        stateDelta: {}, observations: [], suggestedActions: [],
      }),
    });
    expect(beatStatuses(fired)[1]).toBe('occurredAsCanon');
    expect(summarizePlaySession(fired).revision).toBe(2);

    const settledFirst = settle(session, [worldEvent('仓库被封')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '被封。', eventRefs: [1] },
    ]);
    expect(() => applyPlayCanonBeatDirectorOperation(settledFirst, {
      type: 'schedule', beatId: 'canon-beat-2', trigger: { type: 'nextTurn' },
    })).toThrow('Only a pending Play canon beat');
  });
});

describe('canon beat visibility', () => {
  it('gives the Player lens nothing when the protagonist does not know canon', async () => {
    const { session } = await canonSession(await workspace());
    const settled = applyPlayCanonBeatDirectorOperation(settle(session, [worldEvent('仓库被封')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '仓库在起火前被封。', eventRefs: [1] },
    ]), { type: 'correct', beatId: 'canon-beat-4', status: 'altered', reason: '坦白改成了写信。' }, '2026-11-10T01:00:00.000Z');
    const table = readPlayCanonBeatTable(settled.playLocalState);

    const player = projectPlayCanonBeats(table, 'player')!;
    expect(player).toEqual({ contentVisible: false, beats: [], changes: [] });
    const director = projectPlayCanonBeats(table, 'director')!;
    expect(director.beats).toHaveLength(5);
    expect(director.changes).toHaveLength(2);

    const report = createPlayOutcomeReport(settled, { createdAt: '2026-11-10T03:00:00.000Z' });
    const divergence = report.items.filter((item) => item.kind === 'canonDivergence');
    expect(divergence.map((item) => [item.summary, item.confidence, item.visibility, item.eventRefs])).toEqual([
      ['已阻止「仓库起火」。原作（timeline/events.yaml）：仓库起火。本局：仓库在起火前被封。', 'confirmed', 'playerUnknown', ['turn-1-event-1']],
      ['已改写「米拉向任野坦白」。原作节点（作者提供）：米拉向任野坦白。本局：坦白改成了写信。', 'authorProvided', 'playerUnknown', []],
    ]);
    expect(divergence.every((item) => item.tags.includes('divergence'))).toBe(true);
    // The table is reported beat by beat, never dumped as one state blob.
    expect(report.items.some((item) => item.summary.startsWith('State canonBeats'))).toBe(false);

    const playerReport = JSON.stringify(projectPlayOutcomeReport(report, 'player'));
    for (const hidden of ['仓库起火', '米拉向任野坦白', '码头仓库暑期读书会', '坦白改成了写信', 'canonDivergence']) {
      expect(playerReport).not.toContain(hidden);
    }
    expect(JSON.stringify(projectPlayOutcomeReport(report, 'director'))).toContain('仓库在起火前被封');
  });

  it('shows the table to the Player when the protagonist knows canon', async () => {
    const input = launchInput();
    input.canonBeats!.protagonistKnowsCanon = true;
    const { session } = await canonSession(await workspace(), { canonBeats: input.canonBeats });
    const settled = settle(session, [worldEvent('仓库被封')], [
      { beatId: 'canon-beat-2', status: 'prevented', reason: '仓库在起火前被封。', eventRefs: [1] },
    ]);

    const player = projectPlayCanonBeats(readPlayCanonBeatTable(settled.playLocalState), 'player')!;
    expect(player.contentVisible).toBe(true);
    expect(player.beats.every((beat) => beat.visibility === 'playerVisible')).toBe(true);
    expect(getPlayFrozenSystemPrompt(session)).toContain('knows these beats');
    const playerReport = projectPlayOutcomeReport(createPlayOutcomeReport(settled), 'player');
    expect(playerReport.items.filter((item) => item.kind === 'canonDivergence')).toHaveLength(1);
  });
});
