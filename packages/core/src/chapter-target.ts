import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ChapterPosition { volume: number; chapter: number }
export class WritingCommandTargetError extends Error { readonly code = 'WRITING_COMMAND_TARGET_INVALID'; }
export async function listChapterPositions(workspaceRoot: string): Promise<ChapterPosition[]> {
  const positions: ChapterPosition[] = [];
  const volumes = await entries(join(workspaceRoot, 'chapters'));
  for (const volume of volumes) {
    if (!volume.isDirectory() || !/^\d{4}$/u.test(volume.name)) continue;
    const files = (await entries(join(workspaceRoot, 'chapters', volume.name))).filter(file => file.isFile() && /^\d{4}\.md$/u.test(file.name) && file.name !== '0000.md');
    if (!files.length) positions.push({ volume: Number(volume.name), chapter: 0 });
    for (const file of files) positions.push({ volume: Number(volume.name), chapter: Number(file.name.slice(0, 4)) });
    if (positions.length > 100_000) throw new WritingCommandTargetError('章节清单超过本次读取上限。');
  }
  return positions.sort((a, b) => a.volume - b.volume || a.chapter - b.chapter);
}
export function nextChapterPath(chapters: readonly ChapterPosition[]): string {
  const latest = chapters.at(-1);
  return !latest ? 'chapters/0001/0001.md' : `chapters/${pad(latest.volume)}/${pad(latest.chapter + 1)}.md`;
}
export async function readNextChapterTarget(workspaceRoot: string): Promise<{ path: string; inventoryHash: string; previousPath?: string }> {
  const positions = await listChapterPositions(workspaceRoot);
  const latest = positions.filter(item => item.chapter > 0).at(-1);
  return {
    path: nextChapterPath(positions), inventoryHash: createHash('sha256').update(JSON.stringify(positions)).digest('hex'),
    ...(latest ? { previousPath: `chapters/${pad(latest.volume)}/${pad(latest.chapter)}.md` } : {}),
  };
}
async function entries(path: string) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
function pad(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 9999) throw new WritingCommandTargetError('卷号或章号超出 0001–9999 范围，无法自动确定目标文件。');
  return String(value).padStart(4, '0');
}
