import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { MockLanguageModelV4 } from 'ai/test';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { PlayCharacterCheckReportView } from '@oh-awesome-novel/backend';
import type { PlaySession, PlayTurnAttempt } from '@oh-awesome-novel/core';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const PROFILE = '# 沈砚\n\n沈砚说话极少，从不解释自己的决定。\n她对陌生人保持戒备，不会主动示好。\n';
const ROSTER = [
  'id: shen-yan', 'name: 沈砚', 'aliases: [阿砚]', 'genderKind: girl', 'isPlayer: false',
  'looks:', '  fixedBooruTags: ""', '  outfitDescription: 黑色斗篷，左手缠着绷带', '  outfitTags: ""', '',
].join('\n');
const FIRST = '沈砚笑着拉住你的手：“我把所有计划都告诉你吧，我们是最好的朋友！”';
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const settlement = (narrative: string) => `${narrative}\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] })}\n\`\`\``;
const findings = (list: unknown[]) => `\`\`\`oan-play-character-check\n${JSON.stringify({ findings: list })}\n\`\`\``;
const good = { character: '沈砚', quote: '我把所有计划都告诉你吧', category: 'voice', evidence: '沈砚说话极少，从不解释自己的决定。', note: '她不会主动解释计划。' };

function parseSse(body: string): Array<Record<string, unknown>> {
  return body.split(/\r?\n\r?\n/u)
    .map((block) => block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    .filter((data) => data && data !== '[DONE]')
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

type CheckReply = string | Error | ((signal?: AbortSignal) => Promise<string>);

async function setup(options: { characters?: string[]; narratives?: string[] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'oan-character-check-http-'));
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'characters/shen-yan'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
  await writeFile(join(root, 'characters/shen-yan/profile.md'), PROFILE);
  await writeFile(join(root, 'characters/shen-yan/roster-profile.yaml'), ROSTER);
  const narratives = options.narratives ?? [FIRST, '沈砚没有回头，只说了一句：“别跟着我。”', '沈砚推开了门。'];
  let turnCalls = 0;
  const checkPrompts: string[] = [];
  let checkReply: CheckReply = findings([good]);
  // Turns use the controllable stream; the check itself goes through the default SDK call.
  const model = new MockLanguageModelV4({
    doGenerate: async (input) => {
      checkPrompts.push(JSON.stringify(input.prompt));
      const text = typeof checkReply === 'function' ? await checkReply(input.abortSignal) : checkReply;
      if (text instanceof Error) throw text;
      return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
    },
  });
  const backend = await startNovelHttpBackend({
    workspaceRoot: root,
    providerConfig: { id: 'check', kind: 'custom', model: 'check-model', baseUrl: 'https://provider.example/v1', models: [{ id: 'check-model', contextWindow: 100_000 }] },
    resolveModel: () => model,
    streamPlayTurn: async function* () { yield settlement(narratives[Math.min(turnCalls++, narratives.length - 1)]!); },
    streamPlayRehearsalActor: async function* () { yield 'Alice explains every detail of her plan to the stranger.'; },
    runPlayRehearsalReferee: async () => settlement('The station responds.'),
  });
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }); });
  const base = `${backend.url}/api/workspace/play-sessions`;
  const endpoint = `${base}/check`;
  const json = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const post = (path: string, body: unknown, signal?: AbortSignal) => fetch(`${endpoint}${path}`, json(body, signal));
  const created = await fetch(base, json({ id: 'check', title: 'Check', sceneStart: '雨夜客栈', characters: options.characters ?? ['shen-yan'] }));
  expect(created.status).toBe(200);
  const read = async () => (await (await fetch(endpoint)).json() as { session: PlaySession }).session;
  const turn = async (userText: string) => {
    const response = await post('/turns/stream', { userText, actionKind: 'do', baseRevision: (await read()).revision });
    expect(parseSse(await response.text()).some((event) => event.type === 'play.turn.committed')).toBe(true);
  };
  const check = (turnId: string, lens = 'director', signal?: AbortSignal) => post('/character-checks', { target: { kind: 'turn', turnId }, lens }, signal);
  const list = async (lens: string) => (await (await fetch(`${endpoint}/character-checks?lens=${lens}`)).json() as { reports: PlayCharacterCheckReportView[] }).reports;
  const storePath = join(root, '.oan/sessions/.play-checks/check/character-checks.json');
  const stored = async () => access(storePath).then(() => true, () => false);
  return { root, base, json, post, read, turn, check, list, stored, storePath, checkPrompts, setReply: (reply: CheckReply) => { checkReply = reply; } };
}

describe('in-character check over HTTP', () => {
  it('verifies quotes, stores the report beside the session and never touches the session', async () => {
    const f = await setup();
    await f.turn('走近她，问她打算怎么办');
    await f.turn('跟上去');
    const before = await f.read();
    const turnsDir = join(f.root, '.workspace/play-sessions/check/turns');
    const filesBefore = await readdir(turnsDir);
    f.setReply(findings([
      good,
      { ...good, quote: '我把全部计划都告诉你' },
      { ...good, category: 'motivation', evidence: '沈砚热情开朗，最喜欢交朋友。' },
    ]));

    const response = await f.check('turn-artifact-1');
    expect(response.status).toBe(200);
    const { report } = await response.json() as { report: PlayCharacterCheckReportView };
    expect(report).toMatchObject({
      sessionId: 'check', lens: 'director', stale: false, discardedCount: 2,
      target: { kind: 'turn', turnId: 'turn-artifact-1' }, branchTurnIds: ['turn-artifact-1'],
      characters: [{ ref: 'shen-yan', name: '沈砚', status: 'referenced' }],
    });
    expect(report.findings).toEqual([expect.objectContaining({
      character: '沈砚', category: 'voice', quote: good.quote, evidence: good.evidence,
      evidenceSource: '角色卡（characters/shen-yan/profile.md）',
    })]);
    expect(before.turnArtifacts[0]!.messages.some((message) => message.id === report.findings[0]!.segmentId)).toBe(true);

    // The model saw the checked turn and the frozen character material, nothing else.
    expect(f.checkPrompts).toHaveLength(1);
    const prompt = f.checkPrompts[0]!;
    expect(prompt).toContain('我把所有计划都告诉你吧');
    expect(prompt).toContain('沈砚说话极少');
    expect(prompt).toContain('黑色斗篷');
    expect(prompt).not.toContain('别跟着我');
    expect(prompt).not.toContain('走近她，问她打算怎么办');
    expect(prompt).not.toContain('Play world referee');
    expect(prompt).not.toContain('.workspace');
    expect(prompt).not.toContain(f.root);

    // Session side only: revision, snapshot and turn files are unchanged.
    expect(await f.read()).toEqual(before);
    expect(await readdir(turnsDir)).toEqual(filesBefore);
    for (const file of filesBefore) expect(await readFile(join(turnsDir, file), 'utf8')).not.toContain('character-check');
    expect(JSON.parse(await readFile(f.storePath, 'utf8'))).toMatchObject({ reports: [{ id: report.id }] });
    expect(await f.list('director')).toEqual([report]);
  });

  it('leaves no report after a malformed reply, a provider failure or a cancellation', async () => {
    const f = await setup();
    await f.turn('走近她');
    const before = await f.read();

    f.setReply('我觉得她很像本人。');
    const malformed = await f.check('turn-artifact-1');
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toMatchObject({ code: 'invalidResponse' });

    f.setReply(new Error('provider unavailable'));
    expect((await f.check('turn-artifact-1')).status).toBe(422);

    const controller = new AbortController();
    f.setReply((signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')));
      setTimeout(() => controller.abort(), 20);
    }));
    await expect(f.check('turn-artifact-1', 'director', controller.signal)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await f.stored()).toBe(false);
    expect(await f.list('director')).toEqual([]);
    expect(await f.read()).toEqual(before);
    expect(f.checkPrompts).toHaveLength(3);
  });

  it('marks reports stale after Restore and Retry move the branch', async () => {
    const f = await setup();
    await f.turn('走近她');
    await f.turn('跟上去');
    expect((await f.check('turn-artifact-1')).status).toBe(200);
    f.setReply(findings([]));
    expect((await f.check('turn-artifact-2')).status).toBe(200);
    expect((await f.list('director')).map((report) => [report.target, report.stale])).toEqual([
      [{ kind: 'turn', turnId: 'turn-artifact-1' }, false],
      [{ kind: 'turn', turnId: 'turn-artifact-2' }, false],
    ]);

    // Retry the second turn: its report describes a sibling that is no longer selected.
    const retry = await f.post('/turns/turn-artifact-2/retry/stream', { baseRevision: 2 });
    expect(parseSse(await retry.text()).some((event) => event.type === 'play.turn.committed')).toBe(true);
    expect((await f.list('director')).map((report) => report.stale)).toEqual([false, true]);

    // Restore to the initial world: the first turn leaves the branch too.
    const restored = await f.post('/checkpoints/initial-world/restore', { baseRevision: (await f.read()).revision });
    expect(restored.status).toBe(200);
    expect((await f.list('director')).map((report) => report.stale)).toEqual([true, true]);
    // A stale target cannot be checked again either.
    expect((await f.check('turn-artifact-1')).status).toBe(409);
  });

  it('keeps Director-lens reports out of the Player view', async () => {
    const f = await setup();
    await f.turn('走近她');
    expect((await f.check('turn-artifact-1', 'director')).status).toBe(200);
    expect(await f.list('player')).toEqual([]);
    f.setReply(findings([]));
    // The Desktop only knows message ids; the host resolves one to its turn on the selected branch.
    const messageId = (await f.read()).turnArtifacts[0]!.messages.find((message) => message.speaker !== 'user')!.id;
    const byMessage = await f.post('/character-checks', { target: { kind: 'turnMessage', messageId }, lens: 'player' });
    expect(byMessage.status).toBe(200);
    expect((await byMessage.json() as { report: PlayCharacterCheckReportView }).report.target).toEqual({ kind: 'turn', turnId: 'turn-artifact-1' });
    expect((await f.post('/character-checks', { target: { kind: 'turnMessage', messageId: 'no-such-message' }, lens: 'player' })).status).toBe(404);
    expect((await f.list('player')).map((report) => report.lens)).toEqual(['player']);
    expect((await f.list('director')).map((report) => report.lens)).toEqual(['director']);
    expect((await fetch(`${f.base}/check/character-checks?lens=gm`)).status).toBe(400);
  });

  it('reports characters without material as such, without calling the model', async () => {
    const f = await setup({ characters: [], narratives: ['店小二说：“客官里面请。”'] });
    await f.turn('进门');
    const response = await f.check('turn-artifact-1');
    expect(response.status).toBe(200);
    const { report } = await response.json() as { report: PlayCharacterCheckReportView };
    expect(report.characters).toEqual([{ ref: 'improvised:店小二', name: '店小二', status: 'noReference' }]);
    expect(report.findings).toEqual([]);
    expect(f.checkPrompts).toHaveLength(0);
  });

  it('rejects malformed requests and unknown turns before any model call', async () => {
    const f = await setup();
    await f.turn('走近她');
    for (const body of [
      { target: { kind: 'turn', turnId: 'turn-artifact-1' } },
      { target: { kind: 'turn', turnId: 'turn-artifact-1' }, lens: 'gm' },
      { target: { kind: 'turn', turnId: 'turn-artifact-1', path: '../x' }, lens: 'player' },
      { target: { kind: 'turn', turnId: 'turn-artifact-1' }, lens: 'player', material: '自带材料' },
    ]) expect((await f.post('/character-checks', body)).status).toBe(400);
    expect((await f.check('turn-artifact-9')).status).toBe(404);
    expect(f.checkPrompts).toHaveLength(0);
    expect(await f.stored()).toBe(false);
  });

  it('checks a rehearsal step from the participant facts and hides Director-only facts from a Player-lens check', async () => {
    const f = await setup();
    const created = await fetch(f.base, f.json({
      id: 'rehearsal', title: 'Gate', sceneStart: 'The station gate is about to close.', characters: [], activatedSources: [],
      eventPolicy: 'medium', worldMomentum: { pressures: [], agendas: [] }, purpose: 'sceneRehearsal', startMode: 'guided',
      sceneContract: {
        sceneId: 'scene-gate', worldClock: { turn: 0, revision: 0 }, clockProvenance: { kind: 'newSessionInitial', sourceRefs: [] },
        participantRefs: ['participant-alice'], orderStrategy: 'directorFixed',
      },
      participants: [{ participantRef: 'participant-alice', displayName: 'Alice', initialKnowledgeEvidenceRefs: ['k-quiet', 'k-secret'] }],
      initialKnowledgeEvidence: [
        { id: 'k-quiet', participantRef: 'participant-alice', visibility: 'playerVisible', fact: 'Alice never explains herself to strangers.', provenance: { kind: 'authorProvided', providedAt: '2026-11-12T00:00:00.000Z' } },
        { id: 'k-secret', participantRef: 'participant-alice', visibility: 'playerUnknown', fact: 'Alice is secretly an inspector.', provenance: { kind: 'authorProvided', providedAt: '2026-11-12T00:00:00.000Z' } },
      ],
    }));
    expect(created.status).toBe(200);
    const rehearsal = `${f.base}/rehearsal`;
    const { attempt } = await (await fetch(`${rehearsal}/attempts`, f.json({ baseRevision: 0 }))).json() as { attempt: PlayTurnAttempt };
    await (await fetch(`${rehearsal}/attempts/${attempt.id}/steps/next/stream`, f.json({ expectedAttemptRevision: 0, idempotencyKey: 'step-1', mode: 'next' }))).text();
    const active = (await (await fetch(`${rehearsal}/attempts/active`)).json() as { attempt: PlayTurnAttempt }).attempt;
    const step = active.steps[0]!;
    const quote = step.narrativeBlocks.find((block) => block.projection === 'transcript')!.content;
    const target = { kind: 'rehearsalStep', attemptId: attempt.id, stepRef: step.id };

    f.setReply(findings([
      { character: 'Alice', quote, category: 'voice', evidence: 'Alice never explains herself to strangers.', note: 'She explains too much.' },
      { character: 'Alice', quote, category: 'knowledge', evidence: 'Alice is secretly an inspector.', note: 'Hidden fact.' },
    ]));
    const player = await fetch(`${rehearsal}/character-checks`, f.json({ target, lens: 'player' }));
    expect(player.status).toBe(200);
    const playerReport = (await player.json() as { report: PlayCharacterCheckReportView }).report;
    expect(f.checkPrompts.at(-1)).not.toContain('inspector');
    expect(playerReport.findings).toHaveLength(1);
    expect(playerReport.discardedCount).toBe(1);
    expect(JSON.stringify(playerReport)).not.toContain('inspector');

    const director = await fetch(`${rehearsal}/character-checks`, f.json({ target, lens: 'director' }));
    expect(f.checkPrompts.at(-1)).toContain('Alice is secretly an inspector.');
    expect((await director.json() as { report: PlayCharacterCheckReportView }).report.findings).toHaveLength(2);
    const playerList = (await (await fetch(`${rehearsal}/character-checks?lens=player`)).json() as { reports: PlayCharacterCheckReportView[] }).reports;
    expect(JSON.stringify(playerList)).not.toContain('inspector');
    expect(playerList.map((report) => report.stale)).toEqual([false]);

    // The attempt is unchanged, and cancelling it turns the report into history.
    expect((await (await fetch(`${rehearsal}/attempts/active`)).json() as { attempt: PlayTurnAttempt }).attempt).toEqual(active);
    const cancelled = await fetch(`${rehearsal}/attempts/${attempt.id}/cancel`, f.json({ expectedAttemptRevision: active.attemptRevision, idempotencyKey: 'cancel-1' }));
    expect(cancelled.status).toBe(200);
    const after = (await (await fetch(`${rehearsal}/character-checks?lens=player`)).json() as { reports: PlayCharacterCheckReportView[] }).reports;
    expect(after.map((report) => report.stale)).toEqual([true]);
  });
});
