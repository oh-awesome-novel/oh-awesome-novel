import { createHash } from 'node:crypto';

export const MAX_MANUSCRIPT_IMPORT_BYTES = 512 * 1024;
export const MAX_MANUSCRIPT_IMPORT_CHAPTERS = 64;
export class ManuscriptImportValidationError extends Error {}

export interface ManuscriptImportMapping {
  index: number;
  volume: number;
  chapter: number;
  title: string;
}
export interface ManuscriptImportChapter extends ManuscriptImportMapping {
  path: string;
  sourceStartLine: number;
  sourceEndLine: number;
  sourceBytes: number;
}
export interface ManuscriptImportPlan {
  sourceName: string;
  sourceHash: string;
  sourceBytes: number;
  mappingHash: string;
  chapters: ManuscriptImportChapter[];
  /** Private producer input. Never include this in a public preview DTO. */
  files: Array<{ path: string; content: string }>;
  warnings: string[];
}

/** Split only at explicit chapter headings, outside fenced code/frontmatter.
 * Every original character belongs to exactly one consecutive source slice. */
export function prepareManuscriptImport(input: {
  sourceName: string;
  text: string;
  mappings?: readonly ManuscriptImportMapping[];
}): ManuscriptImportPlan {
  const { text, sourceName } = input;
  if (typeof sourceName !== 'string' || !sourceName.trim() || sourceName.length > 255
    || !/\.md$/iu.test(sourceName) || /[\/\\\x00-\x1f\x7f]/u.test(sourceName)) throw new ManuscriptImportValidationError('Use a .md source filename without directories (maximum 255 characters).');
  if (typeof text !== 'string' || !text.trim() || text.includes('\0') || Buffer.from(text, 'utf8').toString('utf8') !== text) {
    throw new ManuscriptImportValidationError('The manuscript must be non-empty valid UTF-8 text without NUL characters.');
  }
  const sourceBytes = Buffer.byteLength(text, 'utf8');
  if (sourceBytes > MAX_MANUSCRIPT_IMPORT_BYTES) throw new ManuscriptImportValidationError('Import at most 512 KiB of Markdown at a time; split this manuscript into smaller batches.');
  const lines = text.match(/[^\n]*(?:\n|$)/gu)!.filter((line, index, all) => index < all.length - 1 || line !== '');
  const headings: Array<{ offset: number; line: number; title: string; level: number; chinese: boolean }> = [];
  let offset = 0;
  let fence: { marker: string; length: number } | undefined;
  let frontmatter = /^\uFEFF?---\s*$/u.test(lines[0]?.replace(/\r?\n$/u, '') ?? '');
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]!.replace(/\r?\n$/u, '');
    const line = index === 0 ? rawLine.replace(/^\uFEFF/u, '') : rawLine;
    const at = offset; offset += lines[index]!.length;
    if (frontmatter) {
      if (index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line)) frontmatter = false;
      continue;
    }
    const fenced = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (fenced && fenced[1]![0] === fence.marker && fenced[1]!.length >= fence.length && !fenced[2]!.trim()) fence = undefined;
      continue;
    }
    if (fenced) { fence = { marker: fenced[1]![0]!, length: fenced[1]!.length }; continue; }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u.exec(line);
    const title = (heading?.[2] ?? line.trim()).trim();
    const chinese = /^第[零〇一二三四五六七八九十百千万两\d]+[章节回](?:\s|[：:、.．]|$|[^零〇一二三四五六七八九十百千万两\d])/u.test(title);
    if (heading || chinese) headings.push({ offset: at, line: index + 1, title, level: heading?.[1]?.length ?? 1, chinese });
  }
  const chinese = headings.filter((heading) => heading.chinese);
  let boundaries = chinese;
  if (!boundaries.length && headings.length) {
    let level = Math.min(...headings.map((heading) => heading.level));
    const shallow = headings.filter((heading) => heading.level === level);
    // A single book heading followed by chapter subheadings is a common flat manuscript.
    if (shallow.length === 1 && shallow[0] === headings[0] && headings.filter((heading) => heading.level === level + 1).length > 1) level++;
    boundaries = headings.filter((heading) => heading.level === level);
  }
  if (!boundaries.length) boundaries = [{ offset: 0, line: 1, level: 1, chinese: false, title: sourceName.replace(/\.md(?:own)?$/iu, '') || '导入章节' }];
  if (boundaries.length > MAX_MANUSCRIPT_IMPORT_CHAPTERS) throw new ManuscriptImportValidationError('Import at most 64 chapters at a time; split this manuscript into smaller batches.');
  const pieces = boundaries.map((boundary, index) => text.slice(index === 0 ? 0 : boundary.offset, boundaries[index + 1]?.offset ?? text.length));
  if (pieces.join('') !== text) throw new Error('The chapter split would lose manuscript text.');
  const defaults = boundaries.map((boundary, index) => ({ index, volume: 1, chapter: index + 1, title: boundary.title }));
  const mappings = input.mappings === undefined ? defaults : input.mappings;
  if (!Array.isArray(mappings) || mappings.length !== boundaries.length) throw new ManuscriptImportValidationError('Mappings must cover every chapter exactly once.');
  const normalized = mappings.map((value) => {
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'chapter,index,title,volume'
      || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= boundaries.length
      || !Number.isSafeInteger(value.volume) || value.volume < 1 || value.volume > 9999
      || !Number.isSafeInteger(value.chapter) || value.chapter < 1 || value.chapter > 9999
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 || /[\x00-\x1f\x7f]/u.test(value.title)) {
      throw new ManuscriptImportValidationError('Each mapping requires index, volume/chapter from 1 to 9999, and a single-line title of at most 200 characters.');
    }
    return { index: value.index, volume: value.volume, chapter: value.chapter, title: value.title.trim() };
  }).sort((a, b) => a.index - b.index);
  if (normalized.some((value, index) => value.index !== index)) throw new ManuscriptImportValidationError('Mappings must cover every chapter exactly once.');
  const chapters = normalized.map((mapping) => ({
    ...mapping,
    path: `chapters/${String(mapping.volume).padStart(4, '0')}/${String(mapping.chapter).padStart(4, '0')}.md`,
    sourceStartLine: mapping.index === 0 ? 1 : boundaries[mapping.index]!.line,
    sourceEndLine: boundaries[mapping.index + 1] ? boundaries[mapping.index + 1]!.line - 1 : lines.length,
    sourceBytes: Buffer.byteLength(pieces[mapping.index]!, 'utf8'),
  }));
  return {
    sourceName, sourceHash: hash(text), sourceBytes, mappingHash: hash(JSON.stringify(normalized)), chapters,
    files: chapters.map((chapter) => ({ path: chapter.path,
      content: `---\nid: "${String(chapter.volume).padStart(4, '0')}/${String(chapter.chapter).padStart(4, '0')}"\ntitle: ${JSON.stringify(chapter.title)}\nvolume: ${chapter.volume}\nchapter: ${chapter.chapter}\n---\n\n# ${chapter.title}\n\n${pieces[chapter.index]}`,
    })),
    warnings: ['原稿全部文字（包括原有标题、前言和元数据）按顺序保留；每章额外添加 OAN 元数据及映射标题。',
      ...(/(?:^|\n)[ \t]*(?:#{1,6}[ \t]+)?第[零〇一二三四五六七八九十百千万两\d]+卷/u.test(text)
        ? ['卷标题保留在原稿位置，不会自动分卷；请核对章节内容并手动调整目标卷号。'] : []),
      ...(!headings.length ? ['未识别到章标题，原稿作为单章导入。'] : []),
      ...(boundaries[0]!.offset > 0 ? ['首个章标题前的文字保留在第一章内。'] : []),
      ...(fence ? ['原稿存在未闭合代码围栏，其后内容保持在同一章内。'] : []),
    ],
  };
}

function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
