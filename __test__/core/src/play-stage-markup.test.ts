import { describe, expect, it } from 'vite-plus/test';
import {
  PLAY_STAGE_MARKUP_METADATA_KEY,
  PLAY_STAGE_MARKUP_PROTOCOL_MARKER,
  buildPlayFrozenSystemPrompt,
  createCompactedPlaySession,
  createPlayCompactionPreview,
  getPlayFrozenSystemPrompt,
  createPlaySessionDraft,
  createPlayStageMarkupDraftReader,
  createPlayTurnContextTrace,
  normalizePlayTurnArtifact,
  normalizePlayTurnContextTrace,
  normalizeStageSnapshot,
  parsePlayStageMarkup,
  preparePlayWorldSettlementRetry,
  readPlayStageCast,
  readPlayStageMarkup,
  restorePlayStageMarkup,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeResponse,
  settlePlayWorldSettlementRetry,
} from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';

const looks = { fixedBooruTags: '', outfitDescription: '', outfitTags: '' };
const roster = [
  { id: 'nian', name: '念念', aliases: ['小念'], genderKind: 'girl', isPlayer: false, looks },
  { id: 'lin', name: '林师兄', aliases: [], genderKind: 'boy', isPlayer: false, looks },
  { id: 'gui', name: '阿鬼', aliases: [], genderKind: 'other', isPlayer: false, looks },
];
const portraitSets = {
  nian: {
    default: 'calm',
    skipped: [],
    items: [
      { id: 'calm', label: '平静', description: '垂着眼，神色平静。' },
      { id: 'angry', label: '生气', description: '皱眉瞪人。', usage: '被冒犯或着急时' },
    ],
  },
  lin: { default: 'smile', skipped: [], items: [{ id: 'smile', label: '苦笑', description: '无奈地笑。' }] },
};

const reply = (narrative: string): string => [
  narrative,
  '```oan-play-settlement',
  JSON.stringify({ events: [], pressureChanges: [], agendaChanges: [], scheduledEventChanges: [], stateDelta: {}, observations: [], suggestedActions: [] }),
  '```',
].join('\n');

function session(enabled: boolean): PlaySession {
  const draft = createPlaySessionDraft({ id: enabled ? 'markup-on' : 'markup-off', title: 'Stage', sceneStart: '客栈', characters: ['念念', '林师兄', '阿鬼'] });
  draft.metadataExtensions.characterRoster = structuredClone(roster);
  draft.metadataExtensions.characterPortraitSets = structuredClone(portraitSets);
  if (enabled) draft.metadataExtensions[PLAY_STAGE_MARKUP_METADATA_KEY] = { version: 1 };
  draft.metadataExtensions.frozenSystemPrompt = buildPlayFrozenSystemPrompt(draft);
  return draft;
}
const cast = () => readPlayStageCast(session(true).metadataExtensions);
const settle = (target: PlaySession, narrative: string, userText = '看着他们') => settlePlayWorldRefereeResponse({
  session: target, userText, actionKind: 'do', refereeResponse: reply(narrative), createdAt: '2026-11-13T00:00:00.000Z',
});
const refereeMessage = (target: PlaySession, turn = -1) => target.turnArtifacts.at(turn)!.messages[1]!;

describe('Play stage markup', () => {
  it('adds the cast and portraits to the frozen prefix only when the session enabled it', () => {
    const off = session(false);
    const baseline = createPlaySessionDraft({ id: 'markup-off', title: 'Stage', sceneStart: '客栈', characters: ['念念', '林师兄', '阿鬼'] });
    // The roster and portraits a session records do not reach the prefix on their own.
    expect(off.metadataExtensions.frozenSystemPrompt).toBe(baseline.metadataExtensions.frozenSystemPrompt);
    expect(readPlayStageMarkup(off.metadataExtensions)).toBeUndefined();

    const prefix = String(session(true).metadataExtensions.frozenSystemPrompt);
    expect(prefix.startsWith(String(baseline.metadataExtensions.frozenSystemPrompt))).toBe(true);
    expect(prefix).toContain(PLAY_STAGE_MARKUP_PROTOCOL_MARKER);
    expect(prefix).toContain('- @nian — 念念（小念）; default portrait: calm');
    expect(prefix).toContain('  - [angry] 生气: 皱眉瞪人。 (use: 被冒犯或着急时)');
    expect(prefix).toContain('- @gui — 阿鬼; no prepared portraits');
    expect(() => readPlayStageMarkup({ vnStageMarkup: { version: 2 } })).toThrow('Unsupported');
  });

  it('resolves three speakers, including pronoun openings and back-to-back quotes, and saves tag-free text', () => {
    const narrative = [
      '念念把灯放在桌上。',
      '@nian[angry] “你又迟到了！”“我等了一个时辰。”',
      '@林师兄 “她说得对，我认。”',
      '@阿鬼 “他来晚是因为我。”',
      '@小念 “……那就算了。”',
      '窗外的雨还没停。',
    ].join('\n');
    const next = settle(session(true), narrative);
    const message = refereeMessage(next);

    expect(message.content).toBe([
      '念念把灯放在桌上。',
      '“你又迟到了！”“我等了一个时辰。”',
      '“她说得对，我认。”',
      '“他来晚是因为我。”',
      '“……那就算了。”',
      '窗外的雨还没停。',
    ].join('\n'));
    expect(next.transcript.at(-1)?.content).not.toMatch(/[@＠]/u);
    const spoken = message.stageSnapshot!.beats.filter(beat => beat.isDialogue);
    expect(spoken.map(beat => [beat.speakerId, beat.speaker, beat.portraitId, beat.source])).toEqual([
      ['nian', '念念', 'angry', 'markup'],
      ['nian', '念念', 'angry', 'markup'],
      ['lin', '林师兄', undefined, 'markup'],
      ['gui', '阿鬼', undefined, 'markup'],
      ['nian', '念念', undefined, 'markup'],
      ['nian', '念念', undefined, 'markup'],
    ]);
    expect(message.stageSnapshot!.beats.filter(beat => !beat.isDialogue).every(beat => beat.source === undefined)).toBe(true);
    expect(message.stageSnapshot!.activeCharacters.map(character => character.characterId)).toEqual(['nian', 'lin', 'gui']);
    // The stored artifact keeps the new fields and still validates.
    expect(normalizePlayTurnArtifact(next.turnArtifacts.at(-1)).messages[1]?.stageSnapshot).toEqual(message.stageSnapshot);
  });

  it('falls back without failing the turn and reports one notice per kind', () => {
    const narrative = [
      '@店小二 “客官里边请。”',
      '@路人甲 “让一让。”',
      '@nian[smirk] “随你。”',
      '@lin[oops “我来说。”',
      '@ “谁在说话？”',
      '念念轻声说：“走吧。”',
    ].join('\n');
    const parsed = parsePlayStageMarkup(narrative, cast());
    expect(parsed.text).toBe(['“客官里边请。”', '“让一让。”', '“随你。”', '“我来说。”', '“谁在说话？”', '念念轻声说：“走吧。”'].join('\n'));
    expect(parsed.notices).toEqual([
      { kind: 'unknownCharacter', count: 2, sample: '店小二' },
      { kind: 'unknownPortrait', count: 1, sample: 'nian[smirk]' },
      { kind: 'malformed', count: 2, sample: '@lin[oops “我来说。”' },
    ]);

    const next = settle(session(true), narrative);
    const beats = refereeMessage(next).stageSnapshot!.beats;
    expect(refereeMessage(next).content).toBe(parsed.text);
    // Unknown portrait: the character's default. Broken tag: narration without a speaker id.
    expect(beats.find(beat => beat.text === '“随你。”')).toMatchObject({ speakerId: 'nian', portraitId: 'calm', source: 'markup' });
    expect(beats.find(beat => beat.text === '“我来说。”')).not.toHaveProperty('speakerId');
    expect(beats.find(beat => beat.text === '“客官里边请。”')?.source).not.toBe('markup');
    expect(beats.find(beat => beat.text.includes('走吧'))).toMatchObject({ speaker: '念念', speakerId: 'nian', source: 'inferred' });

    const trace = createPlayTurnContextTrace({
      session: next, artifactId: next.selectedTurnIds.at(-1)!, sessionRevision: next.revision,
      transcriptLimit: 12, eventLimit: 8, sources: [], stageMarkupNotices: parsed.notices,
    });
    expect(normalizePlayTurnContextTrace(structuredClone(trace)).stageMarkupNotices).toEqual(parsed.notices);
    expect(createPlayTurnContextTrace({
      session: next, artifactId: next.selectedTurnIds.at(-1)!, sessionRevision: next.revision,
      transcriptLimit: 12, eventLimit: 8, sources: [], stageMarkupNotices: [],
    })).not.toHaveProperty('stageMarkupNotices');
  });

  it('leaves a session without stage markup stored exactly as before', () => {
    const narrative = '@nian[angry] “你又迟到了！”\n窗外的雨还没停。';
    const next = settle(session(false), narrative);
    const message = refereeMessage(next);
    // Not enabled: the text is not interpreted, and beats carry only the baseline fields.
    expect(message.content).toBe(narrative);
    expect(message.stageSnapshot!.beats.every(beat => Object.keys(beat).sort().join() === 'isDialogue,speaker,text')).toBe(true);
    expect(restorePlayStageMarkup(message.content, message.stageSnapshot)).toBe(narrative);
  });

  it('puts the tags back for the model history from the saved snapshot alone', () => {
    const narrative = [
      '念念把灯放在桌上。',
      '@nian[angry] “你又迟到了！”“我等了一个时辰。”',
      '',
      '@lin “她说得对。”',
      '@nian[smirk] “哼。”',
      '念念轻声说：“走吧。”',
    ].join('\n');
    const message = refereeMessage(settle(session(true), narrative));
    expect(restorePlayStageMarkup(message.content, message.stageSnapshot)).toBe([
      '念念把灯放在桌上。',
      '@nian[angry] “你又迟到了！”“我等了一个时辰。”',
      '',
      '@lin “她说得对。”',
      // The fallback portrait is what was saved, so the history teaches a valid id.
      '@nian[calm] “哼。”',
      '念念轻声说：“走吧。”',
    ].join('\n'));
    // Restoring is stable: the same committed turn always yields the same bytes.
    expect(restorePlayStageMarkup(message.content, message.stageSnapshot)).toBe(restorePlayStageMarkup(message.content, structuredClone(message.stageSnapshot)));
    expect(restorePlayStageMarkup('别的正文。', message.stageSnapshot)).toBe('别的正文。');
    expect(restorePlayStageMarkup(message.content, undefined)).toBe(message.content);
  });

  it('keeps each turn\'s tagged fields through Retry, Restore and a phase archive', () => {
    const first = settle(session(true), '@nian[angry] “你又迟到了！”');
    const second = settle(first, '@lin[smile] “下次不会了。”', '替他解释');
    const firstSnapshot = structuredClone(refereeMessage(second, 0).stageSnapshot);
    const secondSnapshot = structuredClone(refereeMessage(second, 1).stageSnapshot);

    const preparation = preparePlayWorldSettlementRetry(second, second.selectedTurnIds.at(-1)!);
    const retried = settlePlayWorldSettlementRetry({
      session: second, sourceArtifactId: preparation.sourceArtifactId,
      expectedSessionRevision: preparation.expectedSessionRevision, refereeResponse: reply('@nian “算了，不说这个。”'),
    }).session;
    const retryMessage = retried.turnArtifacts.find(artifact => artifact.id === retried.selectedTurnIds.at(-1))!.messages[1]!;
    expect(retryMessage.content).toBe('“算了，不说这个。”');
    expect(retryMessage.stageSnapshot!.beats[0]).toMatchObject({ speakerId: 'nian', source: 'markup' });
    // The replaced turn and the earlier turn are untouched.
    expect(retried.turnArtifacts.find(artifact => artifact.id === second.selectedTurnIds.at(-1))!.messages[1]!.stageSnapshot).toEqual(secondSnapshot);
    expect(retried.turnArtifacts.find(artifact => artifact.id === second.selectedTurnIds[0])!.messages[1]!.stageSnapshot).toEqual(firstSnapshot);

    const restored = restorePlaySessionCheckpoint(retried, second.selectedTurnIds.at(-1)!);
    expect(restored.transcript.at(-1)?.stageSnapshot).toEqual(secondSnapshot);
    expect(readPlayStageMarkup(restored.metadataExtensions)).toEqual({ version: 1 });

    // A phase archive quotes tag-free text and carries the committed snapshots and the opt-in unchanged.
    const preview = createPlayCompactionPreview(second, JSON.stringify({
      version: 1,
      turnsCovered: 2,
      characters: [],
      chronicle: [{ fact: '林师兄道歉。', quote: '下次不会了。' }],
      unresolvedThreads: [],
      currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' },
      voiceAndStyle: { pov: '第二人称', rhythm: '平缓', tonePoints: ['克制'] },
      resourceState: {},
    }));
    expect(preview.recentText).not.toMatch(/[@＠]/u);
    const phase = createCompactedPlaySession(second, preview, 'markup-phase-2');
    expect(phase.turnArtifacts.map(artifact => artifact.messages[1]?.stageSnapshot)).toEqual([firstSnapshot, secondSnapshot]);
    expect(getPlayFrozenSystemPrompt(phase)).toContain(PLAY_STAGE_MARKUP_PROTOCOL_MARKER);
    expect(refereeMessage(settle(phase, '@gui “我也在。”')).stageSnapshot!.beats[0]).toMatchObject({ speakerId: 'gui', source: 'markup' });
  });

  it('strips tags from draft text as it is released, whole or sentence by sentence', () => {
    const whole = createPlayStageMarkupDraftReader(cast());
    expect(whole.push('念念把灯放下。\n@nian[angry] “你又迟到了！”\n@路人 “让一让。”\n@lin “抱歉。”')).toEqual({
      text: '念念把灯放下。\n“你又迟到了！”\n“让一让。”\n“抱歉。”',
      lines: [
        { line: 1, speakerId: 'nian', speaker: '念念', portraitId: 'angry' },
        { line: 3, speakerId: 'lin', speaker: '林师兄' },
      ],
    });

    const pieces = createPlayStageMarkupDraftReader(cast());
    const out = [
      pieces.push('念念把灯放下。'),
      // The rest of an untagged line is never read as a tag.
      pieces.push('@不是标注。\n'),
      pieces.push('@nian “来了。”\n'),
      pieces.push('@lin[smile] “嗯。”'),
    ];
    expect(out.map(item => item.text).join('')).toBe('念念把灯放下。@不是标注。\n“来了。”\n“嗯。”');
    expect(out.flatMap(item => item.lines)).toEqual([
      { line: 1, speakerId: 'nian', speaker: '念念' },
      { line: 2, speakerId: 'lin', speaker: '林师兄', portraitId: 'smile' },
    ]);
    pieces.reset();
    expect(pieces.push('@lin “重新开始。”').lines).toEqual([{ line: 0, speakerId: 'lin', speaker: '林师兄' }]);
  });

  it('accepts the new snapshot fields and rejects malformed ones', () => {
    const base = { sceneId: '客栈', activeCharacters: [], beats: [{ speaker: '念念', text: '“走。”', isDialogue: true, speakerId: 'nian', portraitId: 'angry', source: 'markup' }] };
    expect(normalizeStageSnapshot(base).beats[0]).toMatchObject({ speakerId: 'nian', portraitId: 'angry', source: 'markup' });
    expect(() => normalizeStageSnapshot({ ...base, beats: [{ ...base.beats[0], portraitId: '../x' }] })).toThrow();
    expect(() => normalizeStageSnapshot({ ...base, beats: [{ ...base.beats[0], source: 'guess' }] })).toThrow();
    // Snapshots written before stage markup still read.
    expect(normalizeStageSnapshot({ sceneId: '客栈', activeCharacters: [], beats: [{ speaker: '', text: '风停。', isDialogue: false }] }).beats).toHaveLength(1);
  });
});
