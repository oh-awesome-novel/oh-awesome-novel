import { describe, expect, it } from 'vitest';
import { createStageSnapshot, normalizeStageSnapshot, parseTextBeats, inferSpeaker, carryTags, parseRosterProfile, serializeRosterProfile, findRosterCharacter, parseSceneFrame, createPlaySessionDraft, addPlayTranscriptTurn, normalizePlayTurnArtifact } from '@oh-awesome-novel/core';
const character = { id: 'nian', name: '念念', aliases: ['小念'], genderKind: 'girl' as const, isPlayer: false, looks: { fixedBooruTags: 'silver hair', outfitDescription: '白衣', outfitTags: 'white dress' }, voiceConfig: { preferredVoiceId: 'reserved', pitchOffset: 0 } };
describe('visual novel protocol', () => {
  it('infers pre/post dialogue names, aliases, trades and rejects narrative phrases', () => {
    expect(parseTextBeats('念念轻声说：“回来。”')[0]?.speaker).toBe('念念');
    expect(parseTextBeats('“回来。”林师兄苦笑道。')[0]?.speaker).toBe('林师兄');
    expect(inferSpeaker('小念低声说', [character])).toBe('nian');
    for (const role of ['掌柜', '店小二', '老伯', '侍女']) expect(inferSpeaker(`${role}说道`)).toBe(role);
    for (const phrase of ['沉默片刻', '忽然', '笑得很短']) expect(inferSpeaker(`${phrase}说`)).toBe('');
  });
  it('balances inline tags and markdown per beat without executing HTML', () => {
    expect(carryTags(['<b>a', 'b</b>'])).toEqual(['<b>a</b>', '<b>b</b>']);
    expect(carryTags(['**a', 'b**'])).toEqual(['**a**', '**b**']);
    expect(parseTextBeats('风停。雨落！')).toHaveLength(2);
  });
  it('validates roster YAML, aliases, references and scene mappings', () => {
    expect(parseRosterProfile(serializeRosterProfile(character))).toEqual(character);
    expect(findRosterCharacter([character], '小念')?.id).toBe('nian');
    expect(() => findRosterCharacter([character, { ...character, id: 'other' }], '小念')).toThrow('Ambiguous');
    expect(() => parseRosterProfile(serializeRosterProfile({ ...character, looks: { ...character.looks, refImagePath: '../secret.png' } }))).toThrow();
    expect(parseSceneFrame('场景: 客栈，深夜\n[小念] 白衣，持灯 | left', [character]).characters[0]).toMatchObject({ characterId: 'nian', fixedBooruTags: 'silver hair', position: 'left' });
    expect(() => parseSceneFrame('场景: 客栈\n[未知] 举杯 | right', [character])).toThrow();
  });
  it('freezes narrative snapshots and survives artifact normalization independently of later state', () => {
    const session = createPlaySessionDraft({ id: 'visual-test', title: 'test', sceneStart: '客栈', characters: ['念念'] });
    const next = addPlayTranscriptTurn(session, { speaker: 'narrator', content: '念念说：“回来。”', createdAt: '2026-01-01T00:00:00.000Z' });
    next.sceneStart = '山顶';
    const artifact = normalizePlayTurnArtifact(next.turnArtifacts[0]);
    expect(artifact.messages[0]?.stageSnapshot?.sceneId).toBe('客栈');
    expect(artifact.messages[0]?.stageSnapshot?.beats[0]?.speaker).toBe('念念');
    const cloned = normalizeStageSnapshot(artifact.messages[0]?.stageSnapshot);
    cloned.beats[0]!.text = 'changed';
    expect(artifact.messages[0]?.stageSnapshot?.beats[0]?.text).not.toBe('changed');
    expect(() => normalizeStageSnapshot({ sceneId: 'x', activeCharacters: [], beats: [{}] })).toThrow();
    expect(createStageSnapshot('a', '风停。').beats).toHaveLength(1);
  });
  it('bounds stage snapshots so a valid long referee turn stays readable after reload', () => {
    const scene = `${'长'.repeat(30_000)}\n第二行`;
    const longBeat = createStageSnapshot(scene, '字'.repeat(262_144));
    expect(longBeat.sceneId.length).toBeLessThanOrEqual(120);
    expect(longBeat.beats.every(beat => beat.text.length <= 200_000)).toBe(true);
    expect(longBeat.beats.map(beat => beat.text).join('')).toBe('字'.repeat(262_144));
    const manyBeats = createStageSnapshot('客栈\n其余开场', '风。'.repeat(131_072));
    expect(manyBeats.sceneId).toBe('客栈');
    expect(manyBeats.beats.length).toBeLessThanOrEqual(20_000);
    expect(manyBeats.beats.map(beat => beat.text).join('')).toBe('风。'.repeat(131_072));
    expect(() => normalizeStageSnapshot(longBeat)).not.toThrow();
    expect(() => normalizeStageSnapshot(manyBeats)).not.toThrow();
    const session = createPlaySessionDraft({ id: 'long-scene', title: 'test', sceneStart: scene, characters: [] });
    const next = addPlayTranscriptTurn(session, { speaker: 'narrator', content: '风。'.repeat(131_072), createdAt: '2026-01-01T00:00:00.000Z' });
    expect(() => normalizePlayTurnArtifact(next.turnArtifacts[0])).not.toThrow();
    expect(() => normalizeStageSnapshot({ sceneId: 'inn', activeCharacters: [], beats: [], backgroundDataUrl: 'https://external.example/image.png' })).toThrow('background');
    expect(() => normalizeStageSnapshot({ sceneId: 'inn', activeCharacters: [], beats: [], backgroundDataUrl: 'data:image/png;base64,' + 'a'.repeat(350001) })).toThrow('background');
  });
});
