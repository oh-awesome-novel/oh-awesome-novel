import { describe, expect, it } from 'vite-plus/test';

import {
  PLAY_CHARACTER_CHECK_INSTRUCTION,
  PlayCharacterCheckError,
  buildPlayFrozenSystemPrompt,
  buildPlayRehearsalStepCharacterCheckMaterial,
  buildPlayTurnCharacterCheckMaterial,
  createPlayCharacterCheckReport,
  createPlaySessionDraft,
  formatPlayCharacterCheckMaterial,
  isPlayCharacterCheckReportStale,
  normalizePlayCharacterCheckReport,
  normalizePlayWorldRefereeSettlement,
  parsePlayCharacterCheckResponse,
  preparePlayWorldSettlementRetry,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeSettlement,
  settlePlayWorldSettlementRetry,
} from '@oh-awesome-novel/core';
import type { PlaySession, PlayTurnAttempt } from '@oh-awesome-novel/core';

const PROFILE = '# 沈砚\n\n沈砚说话极少，从不解释自己的决定。\n她对陌生人保持戒备，不会主动示好。\n';
const INTERACTION = '沈砚：“别跟着我。”\n沈砚只用短句回答。';
const NARRATIVE = '沈砚笑着拉住你的手：“我把所有计划都告诉你吧，我们是最好的朋友！”\n店小二说：“客官里面请。”';

function frozenSession(profile = PROFILE): PlaySession {
  const session = createPlaySessionDraft({
    id: 'check', title: '雨夜', sceneStart: '雨夜客栈', characters: ['shen-yan'],
    activatedSources: [{
      sourceId: 'source-interaction', path: 'characters/shen-yan/interaction.md', role: 'character', contentHash: 'a'.repeat(64),
      reason: 'guided', budgetLayer: 'L1', semanticBoundary: 'protected', trust: 'interactionHint',
    }, {
      sourceId: 'source-world', path: 'world/map.md', role: 'world', contentHash: 'b'.repeat(64),
      reason: 'guided', budgetLayer: 'L1', semanticBoundary: 'protected', trust: 'canonical',
    }],
  });
  session.metadataExtensions.characterRoster = [{
    id: 'shen-yan', name: '沈砚', aliases: ['阿砚'], genderKind: 'girl', isPlayer: false,
    looks: { fixedBooruTags: '', outfitDescription: '黑色斗篷，左手缠着绷带', outfitTags: '' },
  }];
  session.metadataExtensions.frozenSystemPrompt = buildPlayFrozenSystemPrompt(session, [
    '# Activated Source Contents',
    `## source-interaction\nPath: characters/shen-yan/interaction.md\nTrust: interactionHint\n\n${INTERACTION}`,
    '## source-world\nPath: world/map.md\nTrust: canonical\n\n沈砚的家乡在北境。世界设定里的秘密。',
    `## characters/shen-yan/profile.md\n${profile}`,
    '## world/rules.md\n规则：不得泄露。',
  ].join('\n\n'));
  return session;
}

function settle(session: PlaySession, narrative = NARRATIVE): PlaySession {
  return settlePlayWorldRefereeSettlement({
    session, userText: '走近她', actionKind: 'move', narrative,
    createdAt: `2026-11-12T00:0${session.revision + 1}:00.000Z`,
    settlement: normalizePlayWorldRefereeSettlement({ events: [], stateDelta: {}, observations: [], suggestedActions: [] }),
  });
}

const reply = (findings: unknown[]) => `\`\`\`oan-play-character-check\n${JSON.stringify({ findings })}\n\`\`\``;
const good = { character: '沈砚', quote: '我把所有计划都告诉你吧', category: 'voice', evidence: '沈砚说话极少，从不解释自己的决定。', note: '她不会主动解释计划。' };

describe('in-character check material', () => {
  it('uses only the checked narrative and the character blocks frozen in the session', () => {
    const session = settle(frozenSession());
    const material = buildPlayTurnCharacterCheckMaterial(session, 'turn-artifact-1', { lens: 'director' });

    expect(material.segments.map((segment) => segment.text)).toEqual([NARRATIVE]);
    expect(material.branchTurnIds).toEqual(['turn-artifact-1']);
    const shen = material.characters.find((character) => character.ref === 'shen-yan')!;
    expect(shen).toMatchObject({ name: '沈砚', status: 'referenced' });
    expect(shen.references.map((reference) => reference.label)).toEqual([
      '互动样例（characters/shen-yan/interaction.md）', '角色卡（characters/shen-yan/profile.md）', '名册档案',
    ]);
    expect(shen.references[0]!.text).toBe(INTERACTION);
    expect(shen.references[1]!.text).toBe(PROFILE.trim());

    const prompt = formatPlayCharacterCheckMaterial(material);
    // World sources, rules, the author's action and the rest of the prefix stay out.
    expect(prompt).not.toContain('世界设定里的秘密');
    expect(prompt).not.toContain('不得泄露');
    expect(prompt).not.toContain('走近她');
    expect(prompt).not.toContain('Play world referee');
    expect(prompt).not.toContain('.workspace');
    expect(PLAY_CHARACTER_CHECK_INSTRUCTION).toContain('逐字摘抄');
  });

  it('marks improvised characters as having no reference instead of clean', () => {
    const session = settle(frozenSession());
    const material = buildPlayTurnCharacterCheckMaterial(session, 'turn-artifact-1', { lens: 'player' });
    expect(material.characters.find((character) => character.name === '店小二')).toMatchObject({ status: 'noReference', references: [] });
    expect(formatPlayCharacterCheckMaterial(material)).toContain('<没有资料的角色>店小二</没有资料的角色>');
    // An opinion about a character without material is never accepted.
    const result = parsePlayCharacterCheckResponse(material, reply([{ ...good, character: '店小二', quote: '客官里面请' }]));
    expect(result).toEqual({ findings: [], discardedCount: 1 });
  });

  it('omits whole blocks that do not fit and says which, never cutting text', () => {
    const session = settle(frozenSession(`# 沈砚\n\n${'她沉默寡言。'.repeat(200)}`));
    const limit = [...NARRATIVE].length + [...INTERACTION].length + 40;
    const material = buildPlayTurnCharacterCheckMaterial(session, 'turn-artifact-1', { lens: 'director', maxCharacters: limit });
    const shen = material.characters.find((character) => character.ref === 'shen-yan')!;
    expect(shen.references.map((reference) => reference.id)).toEqual(['source-interaction', 'roster:shen-yan']);
    expect(shen.references[0]!.text).toBe(INTERACTION);
    expect(material.omissions).toEqual([expect.stringMatching(/^未纳入 沈砚 的角色卡（characters\/shen-yan\/profile\.md）（\d+ 字）/u)]);
    expect(formatPlayCharacterCheckMaterial(material)).toContain('<省略说明>');

    // Nothing fits: the character is reported as omitted, not as unreferenced or clean.
    const tight = buildPlayTurnCharacterCheckMaterial(session, 'turn-artifact-1', { lens: 'director', maxCharacters: [...NARRATIVE].length + 3 });
    expect(tight.characters.find((character) => character.ref === 'shen-yan')!.status).toBe('omitted');
    expect(() => buildPlayTurnCharacterCheckMaterial(session, 'turn-artifact-1', { lens: 'director', maxCharacters: 10 }))
      .toThrowError(expect.objectContaining({ code: 'narrativeTooLarge' }));
  });

  it('rejects turns that are missing or off the selected branch', () => {
    const first = settle(frozenSession());
    const second = settle(first, '沈砚没有回头。');
    const restored = restorePlaySessionCheckpoint(second, 'turn-artifact-1', { baseRevision: second.revision });
    expect(() => buildPlayTurnCharacterCheckMaterial(restored, 'turn-artifact-2', { lens: 'player' }))
      .toThrowError(expect.objectContaining({ code: 'targetNotOnBranch' }));
    expect(() => buildPlayTurnCharacterCheckMaterial(restored, 'nope', { lens: 'player' })).toThrowError(PlayCharacterCheckError);
  });
});

describe('in-character check verification', () => {
  const session = settle(frozenSession());
  const material = buildPlayTurnCharacterCheckMaterial(session, 'turn-artifact-1', { lens: 'director' });

  it('keeps opinions whose two quotes are verbatim and drops forged or rewritten ones', () => {
    const result = parsePlayCharacterCheckResponse(material, reply([
      good,
      { ...good, quote: '我把全部计划都告诉你吧' },                       // rewritten narrative quote
      { ...good, category: 'motivation', evidence: '沈砚热情开朗，喜欢交朋友。' }, // forged evidence
      { ...good, category: 'relationship', evidence: '沈砚的家乡在北境。' },       // real text, but not this character's material
      { ...good, category: 'tone' },                                     // unknown category
      { ...good, character: '路人甲' },                                  // unknown character
      { ...good, note: '' },
      good,                                                              // duplicate
      'not an object',
    ]));
    expect(result.discardedCount).toBe(8);
    expect(result.findings).toEqual([{
      id: 'finding-1', characterRef: 'shen-yan', character: '沈砚', category: 'voice',
      quote: good.quote, segmentId: material.segments[0]!.id, evidence: good.evidence,
      evidenceSource: '角色卡（characters/shen-yan/profile.md）', note: good.note,
    }]);
  });

  it('fails the whole check on a malformed reply', () => {
    for (const bad of ['我觉得没问题。', '```oan-play-character-check\n{"items":[]}\n```', '```oan-play-character-check\n[1]\n```']) {
      expect(() => parsePlayCharacterCheckResponse(material, bad)).toThrowError(expect.objectContaining({ code: 'invalidResponse' }));
    }
    expect(parsePlayCharacterCheckResponse(material, reply([]))).toEqual({ findings: [], discardedCount: 0 });
  });

  it('builds a report without scores and round-trips it strictly', () => {
    const report = createPlayCharacterCheckReport(material, parsePlayCharacterCheckResponse(material, reply([good, { ...good, quote: '不存在的句子' }])),
      { id: 'character-check-1', createdAt: '2026-11-12T00:00:00.000Z' });
    expect(report).toMatchObject({ lens: 'director', discardedCount: 1, branchTurnIds: ['turn-artifact-1'] });
    expect(JSON.stringify(report)).not.toMatch(/score|rating|评分/u);
    expect(normalizePlayCharacterCheckReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(() => normalizePlayCharacterCheckReport({ ...report, lens: 'gm' })).toThrow();
    expect(() => normalizePlayCharacterCheckReport({ ...report, findings: [{ ...report.findings[0], category: 'tone' }] })).toThrow();

  });
});

describe('in-character check staleness', () => {
  it('goes stale when Restore or Retry moves the branch off the checked turn', () => {
    const first = settle(frozenSession());
    const second = settle(first, '沈砚没有回头。');
    const material = buildPlayTurnCharacterCheckMaterial(second, 'turn-artifact-2', { lens: 'player' });
    const report = createPlayCharacterCheckReport(material, { findings: [], discardedCount: 0 }, { id: 'r', createdAt: '2026-11-12T00:00:00.000Z' });
    expect(isPlayCharacterCheckReportStale(report, second)).toBe(false);
    expect(isPlayCharacterCheckReportStale(report, settle(second, '沈砚推开门。'))).toBe(false);

    const restored = restorePlaySessionCheckpoint(second, 'turn-artifact-1', { baseRevision: second.revision });
    expect(isPlayCharacterCheckReportStale(report, restored)).toBe(true);

    const retry = preparePlayWorldSettlementRetry(second, 'turn-artifact-2', { baseRevision: second.revision });
    const retried = settlePlayWorldSettlementRetry({
      session: second, sourceArtifactId: 'turn-artifact-2', expectedSessionRevision: retry.expectedSessionRevision,
      refereeResponse: ['沈砚只是点了点头。', '```oan-play-settlement', JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] }), '```'].join('\n'),
      createdAt: '2026-11-12T00:09:00.000Z',
    }).session;
    expect(retried.selectedTurnIds.at(-1)).not.toBe('turn-artifact-2');
    expect(isPlayCharacterCheckReportStale(report, retried)).toBe(true);
    expect(isPlayCharacterCheckReportStale(report, { id: 'other', selectedTurnIds: second.selectedTurnIds })).toBe(true);
  });
});

describe('in-character check on a rehearsal step', () => {
  const session = {
    schemaVersion: 5, id: 'rehearsal', selectedTurnIds: [], metadataExtensions: {},
    sceneRehearsal: {
      participants: [{ participantRef: 'p-shen', displayName: '沈砚', currentGoal: '不让任何人知道她受伤', initialKnowledgeEvidenceRefs: ['k1', 'k2'] }],
      initialKnowledgeEvidence: [
        { id: 'k1', participantRef: 'p-shen', visibility: 'playerVisible', fact: '沈砚说话极少。', provenance: { kind: 'authorProvided', providedAt: 'x' } },
        { id: 'k2', participantRef: 'p-shen', visibility: 'playerUnknown', fact: '沈砚其实是密探。', provenance: { kind: 'authorProvided', providedAt: 'x' } },
      ],
    },
  } as unknown as PlaySession;
  const block = (id: string, content: string, hidden = false) => ({
    id, kind: 'characterSpeech', content, visibility: hidden ? 'playerUnknown' : 'playerVisible',
    projection: hidden ? 'directorOnly' : 'transcript', eventRefs: [], sourceRefs: [],
  });
  const attempt = {
    id: 'attempt-1', sessionId: 'rehearsal', status: 'running',
    steps: [{ id: 'step-1', participantRef: 'p-shen', status: 'draft', narrativeBlocks: [block('b1', '沈砚滔滔不绝地讲起自己的伤。'), block('b2', '她暗中记下了暗号。', true)] }],
  } as unknown as PlayTurnAttempt;

  it('keeps hidden blocks and hidden facts out of a Player-lens check', () => {
    const director = buildPlayRehearsalStepCharacterCheckMaterial(session, attempt, 'step-1', { lens: 'director' });
    const player = buildPlayRehearsalStepCharacterCheckMaterial(session, attempt, 'step-1', { lens: 'player' });
    expect(formatPlayCharacterCheckMaterial(director)).toContain('沈砚其实是密探。');
    expect(formatPlayCharacterCheckMaterial(director)).toContain('她暗中记下了暗号。');
    const text = formatPlayCharacterCheckMaterial(player);
    expect(text).toContain('沈砚说话极少。');
    expect(text).not.toContain('密探');
    expect(text).not.toContain('暗号');

    // A hidden quote or hidden evidence cannot be smuggled into a Player-lens result.
    const smuggled = parsePlayCharacterCheckResponse(player, reply([
      { character: '沈砚', quote: '她暗中记下了暗号。', category: 'knowledge', evidence: '沈砚说话极少。', note: '隐藏段落' },
      { character: '沈砚', quote: '沈砚滔滔不绝地讲起自己的伤。', category: 'knowledge', evidence: '沈砚其实是密探。', note: '隐藏事实' },
      { character: '沈砚', quote: '沈砚滔滔不绝地讲起自己的伤。', category: 'voice', evidence: '沈砚说话极少。', note: '话太多。' },
    ]));
    expect(smuggled.discardedCount).toBe(2);
    expect(smuggled.findings).toHaveLength(1);
    expect(JSON.stringify(smuggled)).not.toMatch(/密探|暗号/u);
  });

  it('goes stale once the step is superseded or the attempt ends', () => {
    const material = buildPlayRehearsalStepCharacterCheckMaterial(session, attempt, 'step-1', { lens: 'director' });
    const report = createPlayCharacterCheckReport(material, { findings: [], discardedCount: 0 }, { id: 'r', createdAt: '2026-11-12T00:00:00.000Z' });
    expect(isPlayCharacterCheckReportStale(report, session, attempt)).toBe(false);
    expect(isPlayCharacterCheckReportStale(report, session, undefined)).toBe(true);
    expect(isPlayCharacterCheckReportStale(report, session, { ...attempt, status: 'committed' })).toBe(true);
    expect(isPlayCharacterCheckReportStale(report, session, { ...attempt, steps: [{ ...attempt.steps[0]!, status: 'superseded' }] })).toBe(true);
  });
});
