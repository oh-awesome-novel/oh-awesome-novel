import { describe, expect, it } from 'vite-plus/test';
import { createPlaySessionDraft, settlePlayWorldRefereeResponse, getPlayFrozenSystemPrompt, formatPlayTurnTail, formatPlayWorldRefereePrompt, createPlayCompactionPreview, createCompactedPlaySession, parsePlayCompaction, auditPlayCompaction, buildPlayCompactionPrompt, writePlaySessionFiles, readPlaySessionFiles } from '@oh-awesome-novel/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function session() {
  let s = createPlaySessionDraft({ id: 'archive-test', title: 'Archive', sceneStart: 'Gate', characters: [] });
  for (let n = 0; n < 5; n++) s = settlePlayWorldRefereeResponse({ session: s, actionKind: 'do', userText: `action ${n}`, refereeResponse: `At gate ${n}.\n\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [], stateDelta: { medicine: 0, injury: 'lost arm' }, observations: [], suggestedActions: [] })}\n\`\`\`` });
  return s;
}
function data(s: ReturnType<typeof session>) { return { version: 1, turnsCovered: 5, characters: [], chronicle: ['At gate 0.'], unresolvedThreads: [], currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' }, voiceAndStyle: { pov: 'Third person', rhythm: 'Slow', tonePoints: ['Quiet'] }, resourceState: s.playLocalState }; }
describe('Play frozen prefix and five-dimension archive', () => {
  it('retains identical system bytes for five changing turns and moves requirements to tail', () => {
    const s = session(); const prefix = getPlayFrozenSystemPrompt(s);
    for (let n = 0; n < 5; n++) { const changed = { ...s, revision: n, playLocalState: { medicine: n } }; expect(getPlayFrozenSystemPrompt(changed)).toBe(prefix); expect(formatPlayTurnTail(changed, `state ${n}`, `move ${n}`)).toContain(`move ${n}`); }
  });
  it('parses wrapper/fence tolerance and rejects missing dimensions and fabricated costs/quotes', () => {
    const s = session(); const d = data(s);
    expect(parsePlayCompaction(`<剧情存档>\n\`\`\`json\n${JSON.stringify(d)}\n\`\`\``)).toEqual({ ...d, chronicle: [{ fact: 'At gate 0.', quote: 'At gate 0.' }] });
    expect(() => parsePlayCompaction('{}')).toThrow();
    expect(auditPlayCompaction(s, { ...d, version: 1, resourceState: {} })).toContain('Resource/state ledger changed or omitted facts.');
    expect(() => createPlayCompactionPreview(s, JSON.stringify({ ...d, chronicle: ['He healed.'] }))).toThrow('Unverified');
    s.transcript.at(-1)!.content += ' 他没有服下毒药。He never betrayed the gate.';
    expect(auditPlayCompaction(s, { ...d, chronicle: ['服下毒药'] })).toContain('Unverified historical quote: 服下毒药');
    expect(auditPlayCompaction(s, { ...d, chronicle: ['betrayed the gate.'] })).toContain('Unverified historical quote: betrayed the gate.');
    expect(auditPlayCompaction(s, { ...d, chronicle: ['他没有服下毒药。'] })).toEqual([]);
    expect(() => createPlayCompactionPreview(s, JSON.stringify({ ...d, characters: [{ name: '未记录', identity: '未记录', relationshipChange: '未记录', currentSituation: 'His arm healed.' }] }))).toThrow('Unverified current fact');
  });
  it('rejects superseded resource, injury, relationship and scene quotes despite an unchanged current ledger', () => {
    let s = createPlaySessionDraft({ id: 'superseded', title: 'Audit', sceneStart: '城门', characters: ['阿明'] });
    const advance = (narrative: string, stateDelta: Record<string, unknown>) => {
      s = settlePlayWorldRefereeResponse({ session: s, actionKind: 'do', userText: '继续', refereeResponse: `${narrative}\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [], stateDelta, observations: [], suggestedActions: [] })}\n\`\`\`` });
    };
    advance('阿明身体健康，还有三瓶药。他们是盟友。城门平静，危机已解除，明天赴约。', {
      characters: { 阿明: { identity: '药师', relationshipChange: '盟友', currentSituation: '身体健康，还有三瓶药', medicine: 3, injury: '无' } },
      currentScene: { timeAndPlace: '城门', atmosphere: '平静', immediateCrisis: '危机已解除', presentCharacters: ['阿明'] }, unresolvedThreads: ['明天赴约'],
    });
    advance('阿明断臂，药已耗尽。盟友背叛了他。医馆里失血未止，约定作废。', {
      characters: { 阿明: { identity: '伤员', relationshipChange: '敌人', currentSituation: '断臂，药已耗尽', medicine: 0, injury: '断臂' } },
      currentScene: { timeAndPlace: '医馆', atmosphere: '紧张', immediateCrisis: '失血未止', presentCharacters: [] }, unresolvedThreads: [],
    });
    const valid = { ...data(s), version: 1 as const, turnsCovered: 2, chronicle: ['身体健康，还有三瓶药'], characters: [{ name: '阿明', identity: '伤员', relationshipChange: '敌人', currentSituation: '断臂，药已耗尽' }], currentScene: { timeAndPlace: '医馆', atmosphere: '紧张', immediateCrisis: '失血未止', presentCharacters: [] } };
    expect(auditPlayCompaction(s, valid)).toEqual([]);
    const stale = { ...valid, characters: [{ name: '阿明', identity: '药师', relationshipChange: '盟友', currentSituation: '身体健康，还有三瓶药' }], currentScene: { timeAndPlace: '城门', atmosphere: '平静', immediateCrisis: '危机已解除', presentCharacters: ['阿明'] }, unresolvedThreads: ['明天赴约'] };
    const errors = auditPlayCompaction(s, stale);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('characters.阿明.currentSituation'), expect.stringContaining('characters.阿明.relationshipChange'), expect.stringContaining('currentScene.immediateCrisis'), expect.stringContaining('currentScene.timeAndPlace'), expect.stringContaining('currentScene.presentCharacters'), expect.stringContaining('current unresolved thread'),
    ]));
    expect(() => createPlayCompactionPreview(s, JSON.stringify(stale))).toThrow('Unverified current fact');
    expect(buildPlayCompactionPrompt(s)).toContain('对应字段的当前证据白名单');
    // Known current evidence cannot be silently replaced by unknown markers or omitted.
    expect(auditPlayCompaction(s, { ...valid, characters: [{ name: '阿明', identity: '未记录', relationshipChange: '未记录', currentSituation: '未记录' }] })).toContain('Unverified current fact (characters.阿明.currentSituation): 未记录');
    expect(auditPlayCompaction(s, { ...valid, characters: [] })).toContain('Missing current character ledger: 阿明');
  });
  it('does not reuse the opening as current place and requires historical evidence for current unresolved threads', () => {
    const s = session();
    const d = { ...data(s), version: 1 as const };
    // Opening remains Gate, but the latest prose may have moved without a structured location update.
    s.transcript.at(-1)!.content = 'They reached the hospital.';
    expect(auditPlayCompaction(s, { ...d, currentScene: { ...d.currentScene, timeAndPlace: 'Gate' } })).toContain('Unverified current fact (currentScene.timeAndPlace): Gate');
    expect(auditPlayCompaction(s, d)).toEqual([]);
    s.playLocalState.unresolvedThreads = ['Unspoken promise'];
    expect(auditPlayCompaction(s, { ...d, resourceState: s.playLocalState, unresolvedThreads: ['Unspoken promise'] })).toContain('Unverified historical unresolved thread: Unspoken promise');
    expect(auditPlayCompaction(s, { ...d, resourceState: s.playLocalState, unresolvedThreads: [] })).toContain('Missing current unresolved thread: Unspoken promise');
    s.transcript.at(-1)!.content += ' Unspoken promise';
    expect(auditPlayCompaction(s, { ...d, resourceState: s.playLocalState, unresolvedThreads: ['Unspoken promise'] })).toEqual([]);
  });
  it('rejects stale previews and persists a branch-isolated continuation with exact prefix and two recent turns', async () => {
    const s = session(); const preview = createPlayCompactionPreview(s, JSON.stringify(data(s)));
    expect(() => createCompactedPlaySession({ ...s, revision: 6 }, preview, 'continued')).toThrow('stale');
    const next = createCompactedPlaySession(s, preview, 'continued');
    expect(getPlayFrozenSystemPrompt(next)).toBe(getPlayFrozenSystemPrompt(s));
    // The continuation is sent once as a prior message, never duplicated into the first tail.
    expect(formatPlayTurnTail(next, '', 'go')).not.toContain('<前情提要>');
    expect(next.metadataExtensions.playContinuation).toContain('<前情提要>');
    expect(preview.recentText).toContain('At gate 4.'); expect(preview.recentText).not.toContain('At gate 2.');
    expect(formatPlayWorldRefereePrompt(next)).not.toContain('At gate 0.');
    next.playLocalState.injury = 'changed'; expect(s.playLocalState.injury).toBe('lost arm');
    const root = await mkdtemp(join(tmpdir(), 'oan-archive-'));
    try { const saved = createCompactedPlaySession(s, preview, 'continued'); await writePlaySessionFiles(root, saved, { expectedAbsent: true }); const restored = await readPlaySessionFiles(root, saved.id); expect(restored.metadataExtensions.playContinuation).toBe(saved.metadataExtensions.playContinuation); expect(restored.playLocalState).toEqual(s.playLocalState); } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('accepts distilled facts backed by verbatim quotes and rejects unbacked summaries', () => {
    const s = session(); const d = data(s);
    expect(auditPlayCompaction(s, { ...d, chronicle: [{ fact: '主角在城门前守了五轮', quote: 'At gate 3.' }] })).toEqual([]);
    expect(auditPlayCompaction(s, { ...d, chronicle: [{ fact: '主角离开了城门', quote: 'He left the gate.' }] })).toContain('Unverified historical quote: He left the gate.');
    // No host record for this character: a distilled value needs a verbatim quote.
    const hero = { name: '未记录', identity: '守门人', relationshipChange: '未记录', currentSituation: '仍在城门前' };
    expect(auditPlayCompaction(s, { ...d, characters: [hero] })).toContain('Unverified current fact (characters.未记录.identity): 守门人');
    expect(auditPlayCompaction(s, { ...d, characters: [{ ...hero, quote: 'At gate 4.' }] })).toEqual([]);
    expect(auditPlayCompaction(s, { ...d, currentScene: { ...d.currentScene, atmosphere: '安静', quote: 'At gate 4.' } })).toEqual([]);
    expect(buildPlayCompactionPrompt(s)).not.toContain('At gate 2.');
  });
});
