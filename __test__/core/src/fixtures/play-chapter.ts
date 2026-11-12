import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaySessionDraft, settlePlayWorldRefereeResponse, restorePlaySessionCheckpoint, writePlaySessionFiles, writePlayOutcomeReport, createPlayWritingReferenceAttachment } from '@oh-awesome-novel/core';

export const chapterIntent = { mustKeep: '保留送伞', mayChange: '调整表达', pov: '第三人称', goal: '两人建立信任', length: '短章' };
export async function playChapterFixture(autoCommit = false, existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-chapter-')); const git = promisify(execFile);
  await mkdir(join(root, '.oan'), { recursive: true }); await mkdir(join(root, 'world'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), `version: 1\nnovelName: Play Chapter\ngit:\n  autoCommitOnAccept: ${autoCommit}\n`);
  await writeFile(join(root, '.gitignore'), '.workspace/\n.oan/sessions/\nglobal/\n');
  const rules = '# 世界规则\n雨夜的车站。'; await writeFile(join(root, 'world/rules.md'), rules);
  if (existing) { await mkdir(join(root, 'chapters/0001'), { recursive: true }); await writeFile(join(root, 'chapters/0001/0001.md'), '# 前一章\n\n她来到车站。\n'); }
  await git('git', ['init', '-b', 'main', root]);
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false']]) await git('git', ['-C', root, 'config', key!, value!]);
  await git('git', ['-C', root, 'add', '.']); await git('git', ['-C', root, 'commit', '-m', 'baseline']);
  const initial = createPlaySessionDraft({ id: 'play-chapter', title: '雨夜', sceneStart: '车站', characters: [], activatedSources: [{ sourceId: 'rules', path: 'world/rules.md', contentHash: createHash('sha256').update(rules).digest('hex'), role: 'world', objectId: 'rules', trust: 'canonical', budgetLayer: 'L1', semanticBoundary: 'protected', reason: '世界规则' }] });
  const settle = (session: typeof initial, text: string, events: unknown[]) => settlePlayWorldRefereeResponse({ session, userText: text, actionKind: 'do', refereeResponse: `私有原始叙述 RAW_TRANSCRIPT_ONLY\n\`\`\`oan-play-settlement\n${JSON.stringify({ events, stateDelta: {}, observations: [], suggestedActions: [] })}\n\`\`\`` });
  const event = (title: string, visibility = 'playerVisible') => ({ kind: 'relationshipChanged', origin: 'npc', title, summary: title, visibility, cause: { reason: 'DIRECTOR_REASON_ONLY' } });
  const abandoned = settle(initial, '走另一条路', [event('SIBLING_ONLY')]);
  const session = settle(restorePlaySessionCheckpoint(abandoned, 'initial-world'), '递伞', [event('送伞并建立信任'), event('HIDDEN_ONLY', 'playerUnknown')]);
  await writePlaySessionFiles(root, session, { expectedAbsent: true });
  const report = await writePlayOutcomeReport(root, session.id);
  const selected = report.items.find(item => item.visibility === 'playerVisible' && item.summary.includes('送伞'))!;
  if (!selected) throw new Error('Missing public fixture evidence');
  const attachment = await createPlayWritingReferenceAttachment(root, { id: 'chapter-ref', sessionId: session.id, selectedOutcomeItemRefs: [selected.id] });
  return { root, git, session, report, selected, attachment };
}
