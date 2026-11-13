import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { MockLanguageModelV4 } from 'ai/test';

import { playContextHistory, startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { PlayCharacterCheckReportView } from '@oh-awesome-novel/backend';
import { PLAY_STAGE_MARKUP_PROTOCOL_MARKER } from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const roster = (id: string, name: string, portraits = '') => [
  `id: ${id}`, `name: ${name}`, 'aliases: []', 'genderKind: girl', 'isPlayer: false',
  'looks:', '  fixedBooruTags: ""', '  outfitDescription: ""', '  outfitTags: ""', portraits, '',
].join('\n');
const NIAN_PORTRAITS = [
  'portraits:', '  default: calm', '  items:',
  '    - id: calm', '      label: 平静', '      description: 垂着眼，神色平静。',
  '    - id: angry', '      label: 生气', '      description: 皱眉瞪人。', '      usage: 着急或被冒犯时',
].join('\n');
const PROFILE = '# 念念\n\n念念说话极少，从不解释自己的决定。\n';
const SETTLEMENT = `\`\`\`oan-play-settlement\n${JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] })}\n\`\`\``;
const reply = (narrative: string) => `${narrative}\n${SETTLEMENT}`;
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type SseEvent = Record<string, unknown> & { type: string };
function parseSse(body: string): SseEvent[] {
  return body.split(/\r?\n\r?\n/u)
    .map((block) => block.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    .filter((data) => data && data !== '[DONE]')
    .map((data) => JSON.parse(data) as SseEvent);
}
const draftOf = (events: SseEvent[]) => events.filter(event => event.type === 'play.narrative.delta');

async function setup(chunks: () => string[], checkReply = '') {
  const root = await mkdtemp(join(tmpdir(), 'oan-stage-markup-http-'));
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'characters/nian'), { recursive: true });
  await mkdir(join(root, 'characters/lin'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
  await writeFile(join(root, 'characters/nian/profile.md'), PROFILE);
  await writeFile(join(root, 'characters/nian/roster-profile.yaml'), roster('nian', '念念', NIAN_PORTRAITS));
  await writeFile(join(root, 'characters/lin/roster-profile.yaml'), roster('lin', '林师兄'));
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: checkReply }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
  });
  const backend = await startNovelHttpBackend({
    workspaceRoot: root,
    providerConfig: { id: 'check', kind: 'custom', model: 'check-model', baseUrl: 'https://provider.example/v1', models: [{ id: 'check-model', contextWindow: 100_000 }] },
    resolveModel: () => model,
    streamPlayTurn: async function* () { for (const chunk of chunks()) yield chunk; },
  });
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }); });
  const base = `${backend.url}/api/workspace/play-sessions`;
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const create = (id: string, extra: Record<string, unknown> = {}) =>
    fetch(base, json({ id, title: 'Stage', sceneStart: '雨夜客栈', characters: ['nian', 'lin'], ...extra }));
  const read = async (id: string) => (await (await fetch(`${base}/${id}`)).json() as { session: PlaySession }).session;
  const turn = async (id: string, userText: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${base}/${id}/turns/stream`, json({ userText, actionKind: 'do', baseRevision: (await read(id)).revision, ...extra }));
    return { status: response.status, events: response.ok ? parseSse(await response.text()) : [], response };
  };
  return { root, base, json, create, read, turn };
}

describe('Play stage markup over HTTP', () => {
  it('is chosen at creation, and a session that leaves it off is stored exactly as before', async () => {
    const f = await setup(() => [reply('风停了。')]);
    expect((await f.create('plain')).status).toBe(200);
    expect((await f.create('off', { stageMarkup: false })).status).toBe(200);
    expect((await f.create('on', { stageMarkup: true })).status).toBe(200);
    const [plain, off, on] = await Promise.all([f.read('plain'), f.read('off'), f.read('on')]);

    expect(off.metadataExtensions).toEqual(plain.metadataExtensions);
    expect(plain.metadataExtensions).not.toHaveProperty('vnStageMarkup');
    expect(String(plain.metadataExtensions.frozenSystemPrompt)).not.toContain(PLAY_STAGE_MARKUP_PROTOCOL_MARKER);

    expect(on.metadataExtensions.vnStageMarkup).toEqual({ version: 1 });
    const prefix = String(on.metadataExtensions.frozenSystemPrompt);
    // The block is appended; everything before it is the baseline prefix.
    expect(prefix.startsWith(String(plain.metadataExtensions.frozenSystemPrompt))).toBe(true);
    expect(prefix).toContain('- @nian — 念念; default portrait: calm');
    expect(prefix).toContain('  - [angry] 生气: 皱眉瞪人。 (use: 着急或被冒犯时)');
    expect(prefix).toContain('- @lin — 林师兄; no prepared portraits');

    expect((await f.create('bad', { stageMarkup: 'yes' })).status).toBe(400);
    expect((await f.create('rehearsal', { stageMarkup: true, purpose: 'sceneRehearsal' })).status).toBe(400);
  });

  it('never shows or saves a raw tag, records fallbacks, and shows the model its own tags again', async () => {
    const narratives = [
      ['念念把灯放在桌上。', '@nian[angry] “你又迟到了！”', '@lin “抱歉。”', '@路人 “让一让。”', '@nian[smirk] “哼。”'].join('\n'),
      '@lin “下次不会了。”',
    ];
    let call = 0;
    const f = await setup(() => [reply(narratives[call++]!)]);
    await f.create('on', { stageMarkup: true });

    const first = await f.turn('on', '看着他们');
    expect(first.events.map(event => event.type)).toEqual([
      'play.turn.started', 'play.context.ready', 'play.narrative.delta', 'play.turn.prepared', 'play.turn.committed',
    ]);
    // The workbench draft arrives after the fence, already without tags.
    const draft = draftOf(first.events);
    expect(draft[0]!.delta).toBe('念念把灯放在桌上。\n“你又迟到了！”\n“抱歉。”\n“让一让。”\n“哼。”\n');
    expect(draft[0]!.markup).toEqual([
      { line: 1, speakerId: 'nian', speaker: '念念', portraitId: 'angry' },
      { line: 2, speakerId: 'lin', speaker: '林师兄' },
      { line: 4, speakerId: 'nian', speaker: '念念', portraitId: 'calm' },
    ]);

    const session = await f.read('on');
    const saved = session.transcript.at(-1)!;
    expect(saved.content).toBe('念念把灯放在桌上。\n“你又迟到了！”\n“抱歉。”\n“让一让。”\n“哼。”');
    expect(saved.stageSnapshot!.beats.filter(beat => beat.source === 'markup').map(beat => [beat.speakerId, beat.portraitId])).toEqual([
      ['nian', 'angry'], ['lin', undefined], ['nian', 'calm'],
    ]);
    expect(JSON.stringify(session.turnArtifacts)).not.toMatch(/@nian|@lin|@路人/u);
    expect(await readFile(join(f.root, '.workspace/play-sessions/on/turns/turn-artifact-1.yaml'), 'utf8')).not.toMatch(/@nian|@lin|@路人/u);

    const traces = await (await fetch(`${f.base}/on/context-traces`)).json() as { traces: Array<{ stageMarkupNotices?: unknown }> };
    expect(traces.traces[0]!.stageMarkupNotices).toEqual([
      { kind: 'unknownCharacter', count: 1, sample: '路人' },
      { kind: 'unknownPortrait', count: 1, sample: 'nian[smirk]' },
    ]);

    // From the second turn on, the history sent to the model carries the tags again.
    const history = playContextHistory(session);
    expect(history.at(-1)).toEqual({
      role: 'assistant',
      content: '念念把灯放在桌上。\n@nian[angry] “你又迟到了！”\n@lin “抱歉。”\n“让一让。”\n@nian[calm] “哼。”',
    });
    await f.turn('on', '替他解释');
    const later = playContextHistory(await f.read('on'));
    // Earlier messages are byte-identical in the next request, so the cached prefix still matches.
    expect(later.slice(0, history.length)).toEqual(history);
    expect(later.at(-1)!.content).toBe('@lin “下次不会了。”');
  });

  it('passes an in-character check whose quote comes from a tagged line', async () => {
    const quote = '我把所有计划都告诉你吧';
    const finding = { character: '念念', quote, category: 'voice', evidence: '念念说话极少，从不解释自己的决定。', note: '她不会主动解释计划。' };
    const f = await setup(
      () => [reply(`@nian[angry] “${quote}，我们是最好的朋友！”`)],
      `\`\`\`oan-play-character-check\n${JSON.stringify({ findings: [finding] })}\n\`\`\``,
    );
    await f.create('on', { stageMarkup: true });
    await f.turn('on', '问她打算怎么办');
    const response = await fetch(`${f.base}/on/character-checks`, f.json({ target: { kind: 'turn', turnId: 'turn-artifact-1' }, lens: 'director' }));
    expect(response.status).toBe(200);
    const { report } = await response.json() as { report: PlayCharacterCheckReportView };
    // The tagged speaker is found although her name is not in the saved text.
    expect(report.characters).toEqual([expect.objectContaining({ ref: 'nian', name: '念念' })]);
    expect(report.discardedCount).toBe(0);
    expect(report.findings).toEqual([expect.objectContaining({ character: '念念', quote })]);
  });
});

describe('Play stage sentence streaming over HTTP', () => {
  it('releases sentences before the settlement for a stage turn and keeps the workbench fail-closed', async () => {
    const chunks = ['远处的铁门开始落锁。', '有人在门后咳嗽。', '然后一切安静\n', SETTLEMENT];
    const f = await setup(() => chunks);
    await f.create('plain');

    const workbench = await f.turn('plain', '等待');
    expect(draftOf(workbench.events).map(event => event.delta)).toEqual(['远处的铁门开始落锁。有人在门后咳嗽。然后一切安静\n']);
    // Naming the default changes nothing.
    const named = await f.turn('plain', '再等', { presentation: 'workbench' });
    expect(named.events.map(event => event.type)).toEqual(workbench.events.map(event => event.type));
    expect(draftOf(named.events).map(event => event.delta)).toEqual(draftOf(workbench.events).map(event => event.delta));

    const stage = await f.turn('plain', '继续等', { presentation: 'stage' });
    // The first sentence is out as soon as the next one starts, long before the settlement.
    expect(draftOf(stage.events).map(event => event.delta)).toEqual(['远处的铁门开始落锁。', '有人在门后咳嗽。然后一切安静\n']);
    expect(stage.events.every(event => event.type !== 'play.narrative.delta' || event.provisional === true)).toBe(true);
    expect(stage.events.at(-1)!.type).toBe('play.turn.committed');
    expect((await f.read('plain')).transcript.at(-1)!.content).toBe('远处的铁门开始落锁。有人在门后咳嗽。然后一切安静');

    expect((await f.turn('plain', '无效', { presentation: 'cinema' })).status).toBe(400);
  });

  it('shows sentences before a structured piece, hides the piece, and commits nothing when the reply is rejected', async () => {
    const f = await setup(() => ['走廊安静。', '灯灭了。', '{"events":[{"summary":"刺客在阁楼"}]}', '她没有察觉。\n', SETTLEMENT]);
    await f.create('plain');
    const stage = await f.turn('plain', '听', { presentation: 'stage' });
    expect(draftOf(stage.events).map(event => event.delta).join('')).toBe('走廊安静。灯灭了。');
    expect(JSON.stringify(draftOf(stage.events))).not.toMatch(/events|刺客|没有察觉/u);
    // The final parser rejects the reply; the client withdraws the draft on this event.
    expect(stage.events.at(-1)!.type).toBe('play.turn.failed');
    expect((await f.read('plain')).revision).toBe(0);
  });

  it('releases tagged lines whole and tag-free on a stage turn, and accepts the presentation on Retry', async () => {
    let call = 0;
    const replies = [
      ['念念放下灯。她抬头。\n@nian[an', 'gry] “你又迟到了！”“我等了很久。”\n@lin “抱', '歉。”\n', SETTLEMENT],
      ['@lin “这次是我不对。”\n', SETTLEMENT],
    ];
    const f = await setup(() => replies[call++]!);
    await f.create('on', { stageMarkup: true });
    const stage = await f.turn('on', '看着他们', { presentation: 'stage' });
    const draft = draftOf(stage.events);
    expect(draft.map(event => event.delta)).toEqual(['念念放下灯。她抬头。\n', '“你又迟到了！”“我等了很久。”\n', '“抱歉。”\n']);
    expect(draft.map(event => event.markup)).toEqual([
      undefined,
      [{ line: 1, speakerId: 'nian', speaker: '念念', portraitId: 'angry' }],
      [{ line: 2, speakerId: 'lin', speaker: '林师兄' }],
    ]);
    expect((await f.read('on')).transcript.at(-1)!.content).toBe('念念放下灯。她抬头。\n“你又迟到了！”“我等了很久。”\n“抱歉。”');

    const retry = await fetch(`${f.base}/on/turns/turn-artifact-1/retry/stream`, f.json({ baseRevision: 1, presentation: 'stage' }));
    expect(retry.status).toBe(200);
    const events = parseSse(await retry.text());
    expect(draftOf(events).map(event => event.delta)).toEqual(['“这次是我不对。”\n']);
    expect(events.at(-1)!.type).toBe('play.turn.committed');
    const bad = await fetch(`${f.base}/on/turns/turn-artifact-1/retry/stream`, f.json({ baseRevision: 2, presentation: 'cinema' }));
    expect(bad.status).toBe(400);
  });
});
