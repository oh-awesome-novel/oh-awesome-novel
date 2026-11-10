import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

import {
  MAX_PLAY_RETRY_GUIDANCE_LENGTH,
  PlayWorldSettlementRetryError,
  buildPlayExtraSuggestionsInstruction,
  createPlaySessionDraft,
  formatPlayTurnTail,
  formatPlayWorldRefereeTurnContext,
  getPlayFrozenSystemPrompt,
  listPlaySessionCheckpoints,
  normalizePlayTurnArtifact,
  parsePlayExtraSuggestionsResponse,
  preparePlayWorldSettlementRetry,
  readPlaySessionFiles,
  settlePlayWorldRefereeResponse,
  settlePlayWorldSettlementRetry,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';

const reply = (narrative: string, scene: string, extra: Record<string, unknown> = {}): string => [
  narrative,
  '```oan-play-settlement',
  JSON.stringify({ stateDelta: { scene }, suggestedActions: [`[look] ${scene}`], ...extra }),
  '```',
].join('\n');

const twoTurns = (): PlaySession => {
  const draft = createPlaySessionDraft({
    id: 'play-guided-retry',
    title: 'Guided retry',
    createdAt: '2026-11-10T00:00:00.000Z',
    sceneStart: '雨夜的车站',
    characters: ['她'],
  });
  const first = settlePlayWorldRefereeResponse({
    session: draft,
    userText: '请她留下来。',
    actionKind: 'say',
    createdAt: '2026-11-10T00:01:00.000Z',
    refereeResponse: reply('她犹豫片刻，点了点头。', 'stay'),
  });
  return settlePlayWorldRefereeResponse({
    session: first,
    userText: '递给她一把伞。',
    actionKind: 'do',
    createdAt: '2026-11-10T00:02:00.000Z',
    refereeResponse: reply('她接过伞。', 'umbrella'),
  });
};

describe('Play guided retry', () => {
  it('records guidance only on the new sibling and keeps the source byte-identical', () => {
    const session = twoTurns();
    const source = session.turnArtifacts[1]!;
    const sourceBefore = structuredClone(source);
    const result = settlePlayWorldSettlementRetry({
      session,
      sourceArtifactId: source.id,
      expectedSessionRevision: session.revision,
      guidance: '  别让她这么快接受。  ',
      createdAt: '2026-11-10T00:03:00.000Z',
      refereeResponse: reply('她没有伸手。', 'refused'),
    });
    const retry = result.session.turnArtifacts.find((artifact) => artifact.id === result.retryArtifactId)!;

    expect(retry).toMatchObject({
      parentTurnId: source.parentTurnId,
      input: { raw: '递给她一把伞。', kind: 'do' },
      retryGuidance: { sourceArtifactId: source.id, text: '别让她这么快接受。' },
    });
    expect(result.session.turnArtifacts.find((artifact) => artifact.id === source.id)).toEqual(sourceBefore);
    expect(result.session.revision).toBe(session.revision + 1);
    // The checkpoint summary carries it for the Director view only.
    expect(listPlaySessionCheckpoints(result.session).find((item) => item.artifactId === retry.id)?.retryGuidance)
      .toBe('别让她这么快接受。');
    expect(listPlaySessionCheckpoints(result.session).find((item) => item.artifactId === source.id)?.retryGuidance)
      .toBeUndefined();
  });

  it('guides a first-turn retry as a second root and an ancestor retry from its own parent', () => {
    const session = twoTurns();
    const root = settlePlayWorldSettlementRetry({
      session,
      sourceArtifactId: session.turnArtifacts[0]!.id,
      expectedSessionRevision: session.revision,
      guidance: '让她更坚决地拒绝。',
      refereeResponse: reply('她摇头。', 'leave'),
    });
    const rootRetry = root.session.turnArtifacts.at(-1)!;
    expect(rootRetry.parentTurnId).toBeUndefined();
    expect(rootRetry.retryGuidance?.sourceArtifactId).toBe(session.turnArtifacts[0]!.id);
    expect(root.session.selectedTurnIds).toEqual([rootRetry.id]);
    // The old turn 2 descends from the source and is retained.
    expect(root.session.turnArtifacts).toHaveLength(3);
  });

  it('guides a retry whose turn had a hard-due scheduled event', () => {
    const base = createPlaySessionDraft({
      id: 'play-guided-due',
      title: 'Guided due',
      sceneStart: 'Station',
      characters: [],
      scheduledEvents: [{
        id: 'due-alarm',
        label: 'Alarm',
        trigger: { type: 'nextTurn' },
        template: { kind: 'environmentChanged', origin: 'environment', title: 'Alarm rings', summary: 'The alarm starts.', visibility: 'playerVisible' },
        status: 'scheduled',
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      }],
    });
    const dueEvent = { kind: 'environmentChanged', origin: 'environment', title: 'Alarm rings', summary: 'The alarm starts.', visibility: 'playerVisible', cause: { reason: 'Deadline.', triggerId: 'due-alarm' } };
    const source = settlePlayWorldRefereeResponse({
      session: base,
      userText: 'Wait.',
      actionKind: 'wait',
      refereeResponse: ['The alarm sounds.', '```oan-play-settlement', JSON.stringify({ events: [dueEvent] }), '```'].join('\n'),
    });
    const result = settlePlayWorldSettlementRetry({
      session: source,
      sourceArtifactId: source.turnArtifacts[0]!.id,
      expectedSessionRevision: 1,
      guidance: '警报声更刺耳。',
      refereeResponse: ['A shrill alarm.', '```oan-play-settlement', JSON.stringify({ events: [dueEvent] }), '```'].join('\n'),
    });
    expect(result.session.turnArtifacts.at(-1)).toMatchObject({
      dueScheduledEventIds: ['due-alarm'],
      retryGuidance: { text: '警报声更刺耳。' },
    });
  });

  it('keeps an unguided retry field-for-field identical to the previous behaviour', () => {
    const session = twoTurns();
    const input = {
      session,
      sourceArtifactId: session.turnArtifacts[1]!.id,
      expectedSessionRevision: session.revision,
      createdAt: '2026-11-10T00:03:00.000Z',
      refereeResponse: reply('她接过伞，道谢。', 'thanks'),
    };
    const plain = settlePlayWorldSettlementRetry(input);
    const blank = settlePlayWorldSettlementRetry({ ...input, guidance: '   ' });
    expect(blank).toEqual(plain);
    expect(plain.session.turnArtifacts.at(-1)).not.toHaveProperty('retryGuidance');
    expect(preparePlayWorldSettlementRetry(session, session.turnArtifacts[1]!.id)).not.toHaveProperty('guidance');
  });

  it('rejects oversized or non-string guidance with zero writes', () => {
    const session = twoTurns();
    const snapshot = structuredClone(session);
    const attempt = (guidance: unknown) => () => preparePlayWorldSettlementRetry(session, session.turnArtifacts[1]!.id, { guidance });
    expect(attempt('字'.repeat(MAX_PLAY_RETRY_GUIDANCE_LENGTH))).not.toThrow();
    expect(attempt('字'.repeat(MAX_PLAY_RETRY_GUIDANCE_LENGTH + 1))).toThrow(PlayWorldSettlementRetryError);
    expect(attempt(42)).toThrow(expect.objectContaining({ code: 'invalidGuidance' }));
    expect(() => settlePlayWorldSettlementRetry({
      session,
      sourceArtifactId: session.turnArtifacts[1]!.id,
      expectedSessionRevision: session.revision,
      guidance: '好',
      refereeResponse: 'no settlement block',
    })).toThrow();
    expect(session).toEqual(snapshot);
  });

  it('puts guidance only in this retry tail, never in the frozen prefix or the next turn', () => {
    const session = twoTurns();
    const preparation = preparePlayWorldSettlementRetry(session, session.turnArtifacts[1]!.id, { guidance: '别让她这么快接受。' });
    const frozenBefore = getPlayFrozenSystemPrompt(preparation.beforeTurnSession);
    const context = formatPlayWorldRefereeTurnContext(preparation.beforeTurnSession, { actionKind: 'do', userText: preparation.userText });
    const tail = formatPlayTurnTail(preparation.beforeTurnSession, { ...context, retryGuidance: preparation.guidance }, preparation.userText);
    expect(tail).toContain('<本次重演要求>');
    expect(tail).toContain('别让她这么快接受。');
    expect(tail.indexOf('<本次重演要求>')).toBeLessThan(tail.indexOf('<玩家输入>'));

    const result = settlePlayWorldSettlementRetry({
      session,
      sourceArtifactId: session.turnArtifacts[1]!.id,
      expectedSessionRevision: session.revision,
      guidance: preparation.guidance!,
      refereeResponse: reply('她没有伸手。', 'refused'),
    });
    expect(getPlayFrozenSystemPrompt(result.session)).toBe(frozenBefore);
    const nextContext = formatPlayWorldRefereeTurnContext(result.session, { actionKind: 'say', userText: '再问一次。' });
    const nextTail = formatPlayTurnTail(result.session, nextContext, '再问一次。');
    expect(nextTail).not.toContain('别让她这么快接受。');
    expect(nextTail).not.toContain('本次重演要求');
    expect(JSON.stringify(nextContext)).not.toContain('别让她这么快接受。');
  });

  it('round-trips guidance through files and fails closed on tampered guidance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-guided-retry-'));
    try {
      const session = twoTurns();
      const result = settlePlayWorldSettlementRetry({
        session,
        sourceArtifactId: session.turnArtifacts[1]!.id,
        expectedSessionRevision: session.revision,
        guidance: '多一点沉默。',
        refereeResponse: reply('她沉默着。', 'silent'),
      });
      await writePlaySessionFiles(root, result.session);
      const reread = await readPlaySessionFiles(root, session.id);
      expect(reread.turnArtifacts.at(-1)?.retryGuidance).toEqual({
        sourceArtifactId: session.turnArtifacts[1]!.id,
        text: '多一点沉默。',
      });

      const retryId = result.retryArtifactId;
      const path = join(root, '.workspace', 'play-sessions', session.id, 'turns', `${retryId}.yaml`);
      const bytes = await readFile(path, 'utf8');
      const tampered = bytes.replace(`sourceArtifactId: ${session.turnArtifacts[1]!.id}`, `sourceArtifactId: ${session.turnArtifacts[0]!.id}`);
      expect(tampered).not.toBe(bytes);
      await writeFile(path, tampered);
      await expect(readPlaySessionFiles(root, session.id)).rejects.toThrow(/retryGuidance/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts old artifacts without the field and rejects guidance on the wrong artifact shape', () => {
    const session = twoTurns();
    const artifact = structuredClone(session.turnArtifacts[0]!);
    expect(normalizePlayTurnArtifact(artifact)).not.toHaveProperty('retryGuidance');
    expect(() => normalizePlayTurnArtifact({ ...artifact, retryGuidance: { sourceArtifactId: artifact.id, text: 'x' } }))
      .toThrow(/cannot retry itself/u);
    expect(() => normalizePlayTurnArtifact({ ...artifact, retryGuidance: { sourceArtifactId: 'other', text: ' ' } }))
      .toThrow(/retryGuidance\.text/u);
    expect(() => normalizePlayTurnArtifact({ ...artifact, retryGuidance: { sourceArtifactId: 'other', text: 'x', extra: 1 } }))
      .toThrow(/unknown fields/u);
    expect(() => normalizePlayTurnArtifact({ ...artifact, artifactKind: 'transcriptAppend', input: undefined, retryGuidance: { sourceArtifactId: 'other', text: 'x' } }))
      .toThrow();
  });
});

describe('Play extra suggestions', () => {
  it('asks for a read-only batch that differs from what is on screen', () => {
    const instruction = buildPlayExtraSuggestionsInstruction(['[look] 环顾四周']);
    expect(instruction).toContain('只读');
    expect(instruction).toContain('不要输出 oan-play-settlement');
    expect(instruction).toContain('[look] 环顾四周');
    expect(instruction).toContain('oan-play-suggestions');
  });

  it('parses, de-duplicates and caps the reply', () => {
    const response = '```oan-play-suggestions\n' + JSON.stringify({ suggestedActions: ['[say] 问她名字', '[look] 环顾四周', '[say] 问她名字', '', 3, '[do] 递伞', '[move] 走开', '[wait 5m] 等雨停'] }) + '\n```';
    expect(parsePlayExtraSuggestionsResponse(response, ['[look] 环顾四周'])).toEqual(['[say] 问她名字', '[do] 递伞', '[move] 走开', '[wait 5m] 等雨停']);
    expect(() => parsePlayExtraSuggestionsResponse('nope')).toThrow();
    expect(() => parsePlayExtraSuggestionsResponse('```oan-play-suggestions\n{"suggestedActions":["[look] 环顾四周"]}\n```', ['[look] 环顾四周'])).toThrow();
    expect(() => parsePlayExtraSuggestionsResponse('{"other":[]}')).toThrow();
  });
});
