export interface PlayChapterIntent { mustKeep: string; mayChange: string; pov: string; goal: string; length: string }
export interface PlayChapterParagraph { text: string; sourceItemIds: string[] }
export interface PlayChapterDraft { title: string; paragraphs: PlayChapterParagraph[] }
export interface PlayChapterWritingBinding {
  attachmentId: string;
  reportFingerprint: string;
  selectionHash: string;
  lens: 'player' | 'director';
  targetPath: string;
  chapterInventoryHash: string;
  contextFingerprint: string;
  contextFiles: readonly { readonly path: string; readonly sourceHash: string }[];
  intent: PlayChapterIntent;
}
export function normalizePlayChapterIntent(value: unknown): PlayChapterIntent {
  const v = record(value, ['mustKeep', 'mayChange', 'pov', 'goal', 'length']);
  const result = {} as PlayChapterIntent;
  for (const key of ['mustKeep', 'mayChange', 'pov', 'goal', 'length'] as const) {
    if (typeof v[key] !== 'string' || v[key].length > 2000 || v[key].includes('\0')) throw new Error('转写要求每项最多 2000 字。');
    result[key] = v[key].trim();
  }
  return result;
}
export function parsePlayChapterDraft(value: unknown, selectedIds: readonly string[]): PlayChapterDraft {
  const v = record(value, ['title', 'paragraphs']);
  if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 200 || /[\r\n\0]/u.test(v.title)) throw new Error('章节标题无效。');
  if (!Array.isArray(v.paragraphs) || v.paragraphs.length < 1 || v.paragraphs.length > 300) throw new Error('章节需包含 1–300 段正文。');
  let characters = 0;
  const paragraphs = v.paragraphs.map(item => {
    const p = record(item, ['text', 'sourceItemIds']);
    if (typeof p.text !== 'string' || !p.text.trim() || p.text.includes('\0') || p.text.length > 20_000) throw new Error('章节段落无效或过长。');
    characters += p.text.length;
    if (!Array.isArray(p.sourceItemIds) || p.sourceItemIds.length > 24 || new Set(p.sourceItemIds).size !== p.sourceItemIds.length || p.sourceItemIds.some(id => typeof id !== 'string' || !selectedIds.includes(id))) throw new Error('正文引用了未选的推演素材。');
    return { text: p.text.trim(), sourceItemIds: p.sourceItemIds as string[] };
  });
  if (characters > 200_000 || !paragraphs.some(p => p.sourceItemIds.length)) throw new Error('章节过长或没有引用任何选中素材。');
  return { title: v.title.trim(), paragraphs };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error('转写数据含未知或缺失字段。');
  return value as Record<string, unknown>;
}
