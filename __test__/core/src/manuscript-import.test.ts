import { describe, expect, it } from 'vitest';
import { prepareManuscriptImport, MAX_MANUSCRIPT_IMPORT_BYTES } from '@oh-awesome-novel/core';

function originalPieces(plan: ReturnType<typeof prepareManuscriptImport>) {
  return plan.files.map((file, index) => file.content.split(`# ${plan.chapters[index]!.title}\n\n`).slice(1).join(`# ${plan.chapters[index]!.title}\n\n`));
}
describe('author manuscript splitting and mapping', () => {
  it('preserves every source character including preface, CRLF and trailing whitespace while splitting Chinese chapters', () => {
    const text = '书名\r\n前言  \r\n\r\n第一章 初遇\r\n雪落。\r\n\r\n第二章：归途\r\n归来。  \r\n';
    const plan = prepareManuscriptImport({ sourceName: '旧稿.md', text });
    expect(plan.chapters).toMatchObject([{ title: '第一章 初遇', sourceStartLine: 1, sourceEndLine: 6 }, { title: '第二章：归途', sourceStartLine: 7, sourceEndLine: 8 }]);
    expect(originalPieces(plan).join('')).toBe(text);
    expect(plan.chapters.reduce((sum, chapter) => sum + chapter.sourceBytes, 0)).toBe(Buffer.byteLength(text));
  });
  it('uses chapter subheadings under a book title and ignores frontmatter and fenced code', () => {
    const text = '---\n# metadata comment\ntitle: book\n---\n# 小说\n## 相遇\n```md\n# not a chapter\n第三章 代码\n```\n正文\n## 别离\n尾声';
    const plan = prepareManuscriptImport({ sourceName: 'old.md', text });
    expect(plan.chapters.map((chapter) => chapter.title)).toEqual(['相遇', '别离']);
    expect(originalPieces(plan).join('')).toBe(text);
  });
  it('recognizes a first heading after a UTF-8 BOM without dropping the BOM or source bytes', () => {
    const text = '\uFEFF# 第一章\n正文\n# 第二章\n尾声';
    const plan = prepareManuscriptImport({ sourceName: 'old.md', text });
    expect(plan.chapters).toHaveLength(2); expect(originalPieces(plan).join('')).toBe(text);
  });
  it('supports one untitled chapter and binds reviewed metadata without changing its text', () => {
    const text = '一段旧稿，没有标题。\n最后一行';
    const first = prepareManuscriptImport({ sourceName: '原稿.md', text });
    const mapped = prepareManuscriptImport({ sourceName: '原稿.md', text, mappings: [{ index: 0, title: '序幕', volume: 2, chapter: 3 }] });
    expect(mapped.files[0]!.path).toBe('chapters/0002/0003.md');
    expect(mapped.files[0]!.content).toContain('id: "0002/0003"');
    expect(mapped.sourceHash).toBe(first.sourceHash); expect(mapped.mappingHash).not.toBe(first.mappingHash);
    expect(originalPieces(mapped).join('')).toBe(text);
  });
  it('rejects incomplete, duplicate-index, unknown-field and unsafe mappings', () => {
    const base = { sourceName: 'old.md', text: '# A\na\n# B\nb' };
    for (const mappings of [[], [{ index: 0, volume: 1, chapter: 1, title: 'A' }, { index: 0, volume: 1, chapter: 2, title: 'B' }],
      [{ index: 0, volume: 0, chapter: 1, title: 'A' }, { index: 1, volume: 1, chapter: 2, title: 'B' }],
      [{ index: 0, volume: 1, chapter: 1, title: 'A', path: '../secret' }, { index: 1, volume: 1, chapter: 2, title: 'B' }]]) {
      expect(() => prepareManuscriptImport({ ...base, mappings })).toThrow();
    }
  });
  it('bounds text, chapters, encoding, filename and title before producing files', () => {
    for (const text of ['', '\0', '\ud800', 'x'.repeat(MAX_MANUSCRIPT_IMPORT_BYTES + 1), Array.from({ length: 65 }, (_, i) => `# ${i}\ntext\n`).join('')]) {
      expect(() => prepareManuscriptImport({ sourceName: 'old.md', text })).toThrow();
    }
    for (const sourceName of ['../book.md', 'book.txt', 'a\\book.md']) expect(() => prepareManuscriptImport({ sourceName, text: '正文' })).toThrow();
    expect(() => prepareManuscriptImport({ sourceName: 'book.md', text: '正文', mappings: [{ index: 0, volume: 1, chapter: 1, title: 'bad\ntitle' }] })).toThrow();
  });
});
