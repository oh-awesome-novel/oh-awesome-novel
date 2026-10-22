import { describe, expect, it } from 'vitest';
import { createPlaySessionDraft, settlePlayWorldRefereeResponse, getPlayFrozenSystemPrompt, formatPlayTurnTail, formatPlayWorldRefereePrompt, createPlayCompactionPreview, createCompactedPlaySession, parsePlayCompaction, auditPlayCompaction, writePlaySessionFiles, readPlaySessionFiles } from '@oh-awesome-novel/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function session() {
  let s = createPlaySessionDraft({ id: 'archive-test', title: 'Archive', sceneStart: 'Gate', characters: [] });
  for (let n = 0; n < 5; n++) s = settlePlayWorldRefereeResponse({ session: s, actionKind: 'do', userText: `action ${n}`, refereeResponse: `At gate ${n}.\n\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [], stateDelta: { medicine: 0, injury: 'lost arm' }, observations: [], suggestedActions: [] })}\n\`\`\`` });
  return s;
}
function data(s: ReturnType<typeof session>) { return { version: 1, turnsCovered: 5, characters: [], chronicle: ['At gate 0.'], unresolvedThreads: [], currentScene: { timeAndPlace: 'Gate', presentCharacters: [], atmosphere: 'Quiet', immediateCrisis: '未记录' }, voiceAndStyle: { pov: 'Third person', rhythm: 'Slow', tonePoints: ['Quiet'] }, resourceState: s.playLocalState }; }
describe('Play frozen prefix and five-dimension archive', () => {
  it('retains identical system bytes for five changing turns and moves requirements to tail', () => {
    const s = session(); const prefix = getPlayFrozenSystemPrompt(s);
    for (let n = 0; n < 5; n++) { const changed = { ...s, revision: n, playLocalState: { medicine: n } }; expect(getPlayFrozenSystemPrompt(changed)).toBe(prefix); expect(formatPlayTurnTail(changed, `state ${n}`, `move ${n}`)).toContain(`move ${n}`); }
  });
  it('parses wrapper/fence tolerance and rejects missing dimensions and fabricated costs/quotes', () => {
    const s = session(); const d = data(s);
    expect(parsePlayCompaction(`<剧情存档>\n\`\`\`json\n${JSON.stringify(d)}\n\`\`\``)).toEqual(d);
    expect(() => parsePlayCompaction('{}')).toThrow();
    expect(auditPlayCompaction(s, { ...d, version: 1, resourceState: {} })).toContain('Resource/state ledger changed or omitted facts.');
    expect(() => createPlayCompactionPreview(s, JSON.stringify({ ...d, chronicle: ['He healed.'] }))).toThrow('Unverified');
    expect(() => createPlayCompactionPreview(s, JSON.stringify({ ...d, characters: [{ name: '未记录', identity: '未记录', relationshipChange: '未记录', currentSituation: 'His arm healed.' }] }))).toThrow('Unverified character/scene fact');
  });
  it('rejects stale previews and persists a branch-isolated continuation with exact prefix and two recent turns', async () => {
    const s = session(); const preview = createPlayCompactionPreview(s, JSON.stringify(data(s)));
    expect(() => createCompactedPlaySession({ ...s, revision: 6 }, preview, 'continued')).toThrow('stale');
    const next = createCompactedPlaySession(s, preview, 'continued');
    expect(getPlayFrozenSystemPrompt(next)).toBe(getPlayFrozenSystemPrompt(s));
    expect(formatPlayTurnTail(next, '', 'go')).toContain('<前情提要>');
    expect(preview.recentText).toContain('At gate 4.'); expect(preview.recentText).not.toContain('At gate 2.');
    expect(formatPlayWorldRefereePrompt(next)).not.toContain('At gate 0.');
    next.playLocalState.injury = 'changed'; expect(s.playLocalState.injury).toBe('lost arm');
    const root = await mkdtemp(join(tmpdir(), 'oan-archive-'));
    try { const saved = createCompactedPlaySession(s, preview, 'continued'); await writePlaySessionFiles(root, saved, { expectedAbsent: true }); const restored = await readPlaySessionFiles(root, saved.id); expect(restored.metadataExtensions.playContinuation).toBe(saved.metadataExtensions.playContinuation); expect(restored.playLocalState).toEqual(s.playLocalState); } finally { await rm(root, { recursive: true, force: true }); }
  });
});
