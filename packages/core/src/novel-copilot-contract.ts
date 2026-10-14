/** Browser-safe product contracts shared by the host and renderer. */
export const NOVEL_COPILOT_CAPABILITY_IDS = [
  'novel.generate_character_card',
  'novel.plan_outline',
  'novel.plan_volume',
  'novel.plan_chapter',
  'novel.write_chapter',
  'novel.review_chapter',
  'novel.revise_chapter',
  'novel.settle_chapter',
  'novel.summarize_volume',
  'novel.summarize_global',
  'novel.update_state',
  'novel.plan_foreshadow',
  'novel.de_ai',
  'novel.play_scene',
  'novel.import_tavern_character',
  'novel.deconstruct_reference',
] as const;

export type NovelCopilotCapabilityId = typeof NOVEL_COPILOT_CAPABILITY_IDS[number];

/** Selection is host-owned. Renderer use is only an early interaction hint. */
export function resolveSummarySelection(scope: 'volume' | 'global', paths: readonly string[]): string {
  if (scope === 'global') return 'summaries/global.md';
  if (paths.length !== 1) throw new Error('整理本卷需要先打开一个已编号的章节、卷信息或卷摘要文件。');
  const volume = /^(?:chapters|summaries\/chapter)\/((?!0000)\d{4})\/\d{4}\.md$/u.exec(paths[0]!)?.[1]
    ?? /^summaries\/volume\/((?!0000)\d{4})\.md$/u.exec(paths[0]!)?.[1];
  if (!volume) throw new Error('整理本卷需要先打开一个已编号的章节、卷信息或卷摘要文件。');
  return `summaries/volume/${volume}.md`;
}
