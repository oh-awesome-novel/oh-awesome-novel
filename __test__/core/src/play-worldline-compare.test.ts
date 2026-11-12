import { describe, expect, it } from 'vite-plus/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addPlayTranscriptTurn, comparePlayWorldlines, createLegacyPlayTurnArtifacts, createPlaySessionDraft,
  createPlaySessionFromLaunchPackage, previewPlayLaunchPackage, restorePlaySessionCheckpoint,
  settlePlayWorldRefereeResponse,
} from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';
import { longSession } from './fixtures/long-play-phase';

const draft = () => createPlaySessionDraft({ id: 'compare', title: '两条路', sceneStart: '岔路', characters: [] });
function turn(session: PlaySession, action: string, extra: Record<string, unknown> = {}) {
  return settlePlayWorldRefereeResponse({ session, actionKind: 'do', userText: action,
    refereeResponse: `不会出现在比较中的正文\n\`\`\`oan-play-settlement\n${JSON.stringify({
      events: [{ kind: 'npcActed', origin: 'npc', title: action, summary: action, visibility: 'playerVisible', cause: { reason: 'SECRET_REASON' } }],
      stateDelta: { scene: { location: action } }, observations: [], suggestedActions: [], ...extra,
    })}\n\`\`\``,
  });
}
const section = (result: ReturnType<typeof comparePlayWorldlines>, kind: string) => result.sections.find(s => s.kind === kind)!;

describe('read-only worldline comparison', () => {
  it('compares branches that split on their first turn and does not mutate the input', () => {
    const first = turn(draft(), '往左');
    const fork = turn(restorePlaySessionCheckpoint(first, 'initial-world'), '往右');
    const before = JSON.stringify(fork);
    const result = comparePlayWorldlines(fork, { left: 'turn-artifact-1', right: 'turn-artifact-3', lens: 'player' });
    expect(result.commonAncestor).toBe('initial-world');
    expect(result.left).toMatchObject({ turnCount: 1, divergentTurnCount: 1, clock: { turn: 1 } });
    expect(section(result, 'actions').items).toEqual([{ key: '0', label: '分叉后第 1 步', left: '往左', right: '往右' }]);
    expect(section(result, 'state').items).toEqual([expect.objectContaining({ label: 'scene/location', left: '往左', right: '往右' })]);
    expect(section(result, 'events').total).toBe(2);
    expect(JSON.stringify(result)).not.toContain('SECRET_REASON');
    expect(JSON.stringify(result)).not.toContain('不会出现在比较中的正文');
    expect(JSON.stringify(fork)).toBe(before);
    expect(JSON.stringify(comparePlayWorldlines(fork, { left: 'turn-artifact-1', right: 'turn-artifact-3', lens: 'director' }))).toContain('SECRET_REASON');
  });

  it('compares ancestor/descendant and identical nodes without claiming shared events are unique', () => {
    const second = turn(turn(draft(), '入门'), '上楼');
    const q = { left: 'turn-artifact-1', right: 'turn-artifact-2', lens: 'player' as const };
    const result = comparePlayWorldlines(second, q);
    expect(result.commonAncestor).toBe(q.left);
    expect(result.left.divergentTurnCount).toBe(0);
    expect(section(result, 'actions').items).toEqual([expect.objectContaining({ right: '上楼' })]);
    expect(section(result, 'events').total).toBe(1);
    expect(comparePlayWorldlines(second, { ...q, right: q.left }).sections.every(s => s.total === 0)).toBe(true);
    expect(comparePlayWorldlines(second, { ...q, left: 'initial-world' }).left.turnCount).toBe(0);
    expect(() => comparePlayWorldlines(second, { ...q, left: 'missing' })).toThrow('Unknown');
    expect(() => comparePlayWorldlines(second, { ...q, page: -1 })).toThrow('page');
  });

  it('filters hidden state, events, schedules and reveal subjects before deriving counts', () => {
    const hidden = turn(draft(), '等候', {
      events: [{ kind: 'npcActed', origin: 'npc', title: 'HIDDEN_EVENT', summary: 'HIDDEN_SUMMARY', visibility: 'playerUnknown', cause: { reason: 'HIDDEN_REASON' } }],
      stateDelta: { secret: 'HIDDEN_STATE' },
      scheduledEventChanges: [{ type: 'schedule', label: 'HIDDEN_SCHEDULE', trigger: { type: 'afterTurns', turns: 5 }, template: {
        kind: 'npcActed', origin: 'npc', title: 'HIDDEN_TITLE', summary: 'HIDDEN_SCHEDULE_SUMMARY', visibility: 'playerUnknown',
      }, reason: 'HIDDEN_TRIGGER_REASON' }],
    });
    const revealed = turn(hidden, '听见传闻', {
      events: [{ kind: 'informationSpread', origin: 'npc', title: '听见脚步', summary: '有人来过', visibility: 'rumor', cause: { reason: 'HIDDEN_REASON', sourceEventIds: [hidden.events[0]!.id] } }],
      stateDelta: {}, knowledgeChanges: [{ type: 'revealEvent', subjectEventId: hidden.events[0]!.id, playerProjection: 'rumor' }],
    });
    const q = { left: 'initial-world', right: 'turn-artifact-2', lens: 'player' as const };
    const player = comparePlayWorldlines(revealed, q);
    expect(JSON.stringify(player)).not.toContain('HIDDEN_');
    expect(section(player, 'state').total).toBe(0);
    expect(section(player, 'scheduled').total).toBe(0);
    expect(section(player, 'events').total).toBe(1);
    expect(section(player, 'knowledge').items).toHaveLength(1);
    expect(JSON.stringify(section(player, 'knowledge'))).not.toContain('subjectEventId');
    const director = comparePlayWorldlines(revealed, { ...q, lens: 'director' });
    expect(section(director, 'events').total).toBe(2);
    expect(section(director, 'scheduled').total).toBe(1);
    expect(JSON.stringify(director)).toContain('HIDDEN_STATE');
  });

  it('compares scheduled event status changes without leaking trigger reasons to Player', () => {
    const first = turn(draft(), '等待', { scheduledEventChanges: [{ type: 'schedule', label: '列车', trigger: { type: 'afterTurns', turns: 5 },
      template: { kind: 'arrival', origin: 'clock', title: '列车到站', summary: '列车到了', visibility: 'playerVisible' }, reason: 'SECRET_TRIGGER' }] });
    const next = turn(first, '离开', { scheduledEventChanges: [{ type: 'cancel', scheduledEventId: first.scheduledEvents[0]!.id, reason: 'SECRET_CANCEL' }] });
    const result = comparePlayWorldlines(next, { left: 'turn-artifact-1', right: 'turn-artifact-2', lens: 'player' });
    expect(section(result, 'scheduled').items[0]).toMatchObject({ left: expect.stringContaining('scheduled'), right: expect.stringContaining('cancelled') });
    expect(JSON.stringify(result)).not.toContain('SECRET_');
  });

  it('compares canon statuses and drops the entire table for an unaware Player', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compare-canon-'));
    try {
    await mkdir(join(root, 'chapters')); await writeFile(join(root, 'chapters/01.md'), '入场。');
    const pkg = await previewPlayLaunchPackage(root, {
      title: '原作', purpose: 'immersiveJourney', startMode: 'guided', simulationMode: 'reactiveWorld', density: 'balanced', sources: [{ sourceId: 'opening', path: 'chapters/01.md', role: 'chapter' }],
      entryPoint: { id: 'entry', label: '起点', opening: '入场', sourceRefs: ['opening'] }, identity: { kind: 'player', persona: '来客' }, participantRoles: [],
      canonBeats: { protagonistKnowsCanon: false, beats: [{ label: 'HIDDEN_CANON', source: { kind: 'authorProvided' } }] },
    });
    const initial = createPlaySessionFromLaunchPackage(pkg, { id: 'canon-compare' });
    const beatId = (initial.playLocalState.canonBeats as { beats: { id: string }[] }).beats[0]!.id;
    const next = turn(initial, '行动', { canonBeatChanges: [{ beatId, status: 'prevented', eventRefs: [1], reason: '改变' }] });
    const q = { left: 'initial-world', right: next.selectedTurnIds.at(-1)!, lens: 'player' as const };
    expect(section(comparePlayWorldlines(next, q), 'canon').total).toBe(0);
    expect(JSON.stringify(comparePlayWorldlines(next, q))).not.toContain('HIDDEN_CANON');
    expect(section(comparePlayWorldlines(next, { ...q, lens: 'director' }), 'canon').items[0]).toMatchObject({ left: expect.stringContaining('pending'), right: expect.stringContaining('prevented') });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('explains old artifacts without complete snapshots; descendants of a known base still compare', () => {
    const artifacts = createLegacyPlayTurnArtifacts({ transcript: [
      { id: 'old-root', speaker: 'user', content: '旧起点', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'old-head', speaker: 'user', content: '旧结束', createdAt: '2026-07-01T00:01:00.000Z' },
    ], events: [], observations: [] });
    const initial = draft();
    const legacy: PlaySession = { ...initial, revision: 1, worldClock: { turn: 0, revision: 1 },
      turnArtifacts: artifacts, selectedTurnIds: artifacts.map(a => a.id), transcript: artifacts.flatMap(a => a.messages),
      branchSnapshotRequiredFromRevision: 1,
      branchBaseSnapshot: { ...initial.branchBaseSnapshot, parentTurnId: artifacts.at(-1)!.id, worldClock: { turn: 0, revision: 1 } },
    };
    const next = addPlayTranscriptTurn(legacy, { speaker: 'narrator', content: '新节点', createdAt: '2026-07-01T00:02:00.000Z' });
    const result = comparePlayWorldlines(next, { left: artifacts[0]!.id, right: next.selectedTurnIds.at(-1)!, lens: 'player' });
    expect(result.unavailableReason).toContain('缺少完整'); expect(result.sections).toEqual([]);
    expect(comparePlayWorldlines(next, { left: artifacts.at(-1)!.id, right: next.selectedTurnIds.at(-1)!, lens: 'player' }).unavailableReason).toBeUndefined();
  });

  it('bounds a 1000-turn projection, pages actions without sending narrative, and ignores unselected siblings', () => {
    const session = longSession(1000);
    const before = JSON.stringify(session);
    const query = { left: 'initial-world', right: 'turn-artifact-1000', lens: 'player' as const };
    const first = comparePlayWorldlines(session, query);
    expect(section(first, 'actions').total).toBe(1000);
    expect(section(first, 'actions').items).toHaveLength(40);
    const last = comparePlayWorldlines(session, { ...query, page: 24 });
    expect(section(last, 'actions').items).toHaveLength(40);
    expect(section(last, 'actions').items[0]!.key).toBe('960');
    expect(JSON.stringify(first).length).toBeLessThan(15_000);
    expect(JSON.stringify(first)).not.toContain('SIBLING_ONLY');
    expect(JSON.stringify(session)).toBe(before);
  });
});
