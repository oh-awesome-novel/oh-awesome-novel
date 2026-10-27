import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { evaluateAggregateSummaries, evaluateProjectHealth, readProjectHealth, prepareSummaryGeneration, formatSummaryGenerationCoverage,
  mergeSummaryDocument, parseSummaryDocument, parseSummaryGenerationDraft, resolveSummarySelection, SUMMARY_LIMITS } from '@oh-awesome-novel/core';

type File = { path: string; content: string };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
function chapter(id: string): File[] {
  const content = `# 正文\r\n林安到达城门。\r\n`; const sourceHash = hash(content);
  const observation = { id: 'arrival', category: 'location', subject: '林安', observation: '到达城门', confidence: 'high', evidence: { startLine: 2, endLine: 2, quote: '林安到达城门。' } };
  return [
    { path: `chapters/${id}.md`, content },
    { path: `state/chapters/${id}.yaml`, content: JSON.stringify({ version: 1, chapterRef: id, sourceHash, observations: [observation] }) },
    { path: `summaries/chapter/${id}.md`, content: `作者批注 AUTHOR_ONLY\n<!-- oan:settlement:summary-${sourceHash} -->\n## Evidence snapshot ${sourceHash.slice(0, 12)}\n\nSource SHA-256: ${sourceHash}\n\n- 林安: 到达城门 (lines 2-2)\n<!-- /oan:settlement:summary-${sourceHash} -->\n<!-- oan:settlement:summary-current-${id.replace('/', '-')} -->\nCurrent evidence source SHA-256: ${sourceHash}\nEvidence snapshots preserve accepted history. Only the snapshot matching this hash describes the current settled chapter; other snapshots are historical.\n<!-- /oan:settlement:summary-current-${id.replace('/', '-')} -->\n` },
  ];
}
function summarize(files: File[], path: string) {
  const source = prepareSummaryGeneration({ files }, path); expect(source.ready).toBe(true);
  const paragraphs = [{ text: '林安到达城门。', sourcePaths: source.sources.map((file) => file.path) }];
  const existing = files.find((file) => file.path === path);
  const content = mergeSummaryDocument(existing?.content, { schemaVersion: 1, targetPath: path, chapterIds: source.chapterIds,
    sources: source.sources.map(({ path, sourceHash, payloadHash }) => ({ path, sourceHash, payloadHash })), sourceFingerprint: source.sourceFingerprint, paragraphs });
  if (existing) existing.content = content; else files.push({ path, content });
  return source;
}
function fixture() {
  const files = [...chapter('0001/0001'), ...chapter('0001/0002'), ...chapter('0002/0001')];
  summarize(files, 'summaries/volume/0001.md'); summarize(files, 'summaries/volume/0002.md'); summarize(files, 'summaries/global.md');
  return files;
}
const statuses = (files: File[]) => Object.fromEntries(evaluateAggregateSummaries({ files }).map((item) => [item.path, item.status]));

describe('volume/global evidence provenance', () => {
  it('generates complete sources, separates byte/payload hashes and excludes author text', () => {
    const files = fixture(); const source = prepareSummaryGeneration({ files }, 'summaries/volume/0001.md');
    expect(source.chapterIds).toEqual(['0001/0001', '0001/0002']); expect(source.sources).toHaveLength(2);
    expect(source.sources.every((file) => file.sourceHash !== file.payloadHash && !file.payload.includes('AUTHOR_ONLY'))).toBe(true);
    expect(Object.values(statuses(files))).toEqual(['current', 'current', 'current']);
    const global = prepareSummaryGeneration({ files }, 'summaries/global.md');
    expect(global.sources.map((file) => file.path)).toEqual(['summaries/volume/0001.md', 'summaries/volume/0002.md']);
    expect(global.chapterIds).toHaveLength(3);
  });
  it.each(['body', 'new chapter', 'deleted chapter', 'moved chapter', 'state', 'summary', 'new volume'])('propagates %s without regenerating any intermediate summary', (change) => {
    const files = fixture();
    if (change === 'body') files[0].content += '他离开了。';
    if (change === 'new chapter') files.push(...chapter('0001/0003'));
    if (change === 'deleted chapter') files.splice(0, 1);
    if (change === 'moved chapter') files[0].path = 'chapters/0002/0002.md';
    if (change === 'state') files[1].content += '\n# 外部修改';
    if (change === 'summary') files[2].content += '\n作者改了来源摘要';
    if (change === 'new volume') files.push(...chapter('0003/0001'));
    const result = statuses(files); expect(result['summaries/global.md']).toBe('stale');
    if (change !== 'new volume') expect(result['summaries/volume/0001.md']).toBe('stale');
    if (change !== 'moved chapter') expect(result['summaries/volume/0002.md']).toBe('current');
    expect(prepareSummaryGeneration({ files }, 'summaries/global.md').ready).toBe(false);
    expect(evaluateAggregateSummaries({ files }).find((item) => item.path === 'summaries/global.md')!.context).toBeUndefined();
  });
  it('requires reaccepting the affected volume before the global summary can be regenerated', () => {
    const files = fixture(); files.push(...chapter('0001/0003'));
    summarize(files, 'summaries/volume/0001.md');
    expect(statuses(files)['summaries/global.md']).toBe('stale');
    summarize(files, 'summaries/global.md'); expect(Object.values(statuses(files))).toEqual(['current', 'current', 'current']);
  });
  it('reports incomplete/unverified evidence without allowing partial generation', () => {
    const files = chapter('0001/0001'); files.push(...chapter('0001/0002')); files.pop();
    let source = prepareSummaryGeneration({ files }, 'summaries/volume/0001.md');
    expect(source.ready).toBe(false); expect(source.problems[0]).toMatchObject({ status: 'missing' });
    files.push({ path: 'summaries/chapter/0001/0002.md', content: '手工未验证' });
    source = prepareSummaryGeneration({ files }, 'summaries/volume/0001.md');
    expect(source.ready).toBe(false); expect(source.problems[0]).toMatchObject({ status: 'unverified' });
    expect(formatSummaryGenerationCoverage(source)).toContain('未生成候选');
    const empty = prepareSummaryGeneration({ files: [{ path: 'chapters/0001/0000.md', content: '卷信息' }] }, 'summaries/volume/0001.md');
    expect(empty.ready).toBe(false); expect(empty.chapterIds).toEqual([]);
  });
  it.each(['body', 'metadata', 'duplicate', 'unknown version', 'wrong identity', 'frontmatter'])('refuses edited managed %s and preserves manual content', (change) => {
    const files = fixture(); const file = files.find((file) => file.path === 'summaries/volume/0001.md')!;
    if (change === 'body') file.content = file.content.replace('\n林安到达城门。\n', '\n伪造的结果\n');
    if (change === 'metadata') file.content = file.content.replace('"schemaVersion":1', '"schemaVersion":2');
    if (change === 'duplicate') file.content += file.content;
    if (change === 'unknown version') file.content = file.content.replaceAll('oan:summary:v1', 'oan:summary:v2');
    if (change === 'wrong identity') file.content = file.content.replace('"targetPath":"summaries/volume/0001.md"', '"targetPath":"summaries/volume/0002.md"');
    if (change === 'frontmatter') file.content = `---\nid: 0002\n---\n${file.content}`;
    expect(statuses(files)[file.path]).toBe('unverified');
    expect(prepareSummaryGeneration({ files }, 'summaries/global.md').ready).toBe(false);
    expect(() => summarize(files, file.path)).toThrow();
  });
  it('preserves author prefix/suffix exactly, supports idempotence and marks unowned prose as reference', () => {
    const files = chapter('0001/0001'); const manual = '# 作者总结\r\n\r\n保留空白与作者内容。\r\n';
    files.push({ path: 'summaries/volume/0001.md', content: manual });
    expect(evaluateAggregateSummaries({ files })[0]).toMatchObject({ status: 'unverified' });
    summarize(files, 'summaries/volume/0001.md'); const file = files.at(-1)!;
    expect(file.content.startsWith(manual)).toBe(true); file.content += '\n作者后记\n'; const before = file.content;
    summarize(files, file.path); expect(file.content).toBe(before);
    expect(prepareSummaryGeneration({ files }, 'summaries/global.md').sources[0].payload).not.toContain('作者后记');
  });
  it('validates draft references, full coverage, version, limits and host selection', () => {
    const source = prepareSummaryGeneration({ files: [...chapter('0001/0001'), ...chapter('0001/0002')] }, 'summaries/volume/0001.md');
    const paths = source.sources.map((file) => file.path);
    const valid = { schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, paragraphs: [{ text: '摘要', sourcePaths: paths }] };
    expect(parseSummaryGenerationDraft(valid, source.sourceFingerprint, paths)).toEqual(valid);
    for (const draft of [{ ...valid, extra: true }, { ...valid, schemaVersion: 2 }, { ...valid, sourceFingerprint: 'a'.repeat(64) },
      ...[[], [{ text: '', sourcePaths: paths }], [{ text: '遗漏', sourcePaths: [paths[0]] }], [{ text: '伪造', sourcePaths: ['outline/main.md'] }],
        [{ text: 'x'.repeat(SUMMARY_LIMITS.paragraphChars + 1), sourcePaths: paths }]].map((paragraphs) => ({ ...valid, paragraphs }))]) {
      expect(() => parseSummaryGenerationDraft(draft, source.sourceFingerprint, paths)).toThrow();
    }
    expect(resolveSummarySelection('volume', ['chapters/0002/0000.md'])).toBe('summaries/volume/0002.md');
    expect(resolveSummarySelection('global', [])).toBe('summaries/global.md');
    for (const paths of [[], ['.oan/config.yaml'], ['chapters/0001/0001.md', 'chapters/0002/0001.md']]) expect(() => resolveSummarySelection('volume', paths)).toThrow();
  });
  it.each([100, 500])('covers %i chapters with bounded reports and validates every leaf', (count) => {
    const files = Array.from({ length: count }, (_, index) => chapter(`0001/${String(index + 1).padStart(4, '0')}`)).flat();
    const source = summarize(files, 'summaries/volume/0001.md'); expect(source.chapterIds).toHaveLength(count);
    summarize(files, 'summaries/global.md'); expect(statuses(files)['summaries/global.md']).toBe('current');
    const volume = evaluateAggregateSummaries({ files }).find((item) => item.path === 'summaries/volume/0001.md')!;
    expect(volume.verifiedContent).toBe('林安到达城门。');
    expect(volume.context!.length).toBeLessThan(600);
    expect(files.find((file) => file.path === 'summaries/volume/0001.md')!.content).toContain(`summaries/chapter/0001/${String(count).padStart(4, '0')}.md`);
    files[0].content += '变化'; expect(statuses(files)['summaries/global.md']).toBe('stale');
    const broken = files.filter((file) => file.path.startsWith('chapters/'));
    expect(formatSummaryGenerationCoverage(prepareSummaryGeneration({ files: broken }, 'summaries/volume/0001.md')).length).toBeLessThan(2500);
  });
  it('refuses oversized verified inputs explicitly, without trimming the coverage', () => {
    const files = Array.from({ length: 200 }, (_, index) => chapter(`0001/${String(index + 1).padStart(4, '0')}`)).flat();
    const observation = '到达城门'.repeat(128);
    for (let index = 0; index < files.length; index += 3) {
      const state = JSON.parse(files[index + 1].content); state.observations[0].observation = observation;
      files[index + 1].content = JSON.stringify(state);
      files[index + 2].content = files[index + 2].content.replace('- 林安: 到达城门 (lines', `- 林安: ${observation} (lines`);
    }
    const source = prepareSummaryGeneration({ files }, 'summaries/volume/0001.md');
    expect(source.sources).toHaveLength(0); expect(source.verifiedSourceCount).toBe(200); expect(source.chapterIds).toHaveLength(200);
    expect(source.ready).toBe(false); expect(source.problems).toMatchObject([{ status: 'limit' }]);
    expect(formatSummaryGenerationCoverage(source)).toContain('不会静默截断');
  });
  it('host health and frozen evaluator agree; touch and unrelated-volume changes do not invalidate a volume', async () => {
    const files = fixture(); const root = await mkdtemp(join(tmpdir(), 'oan-summary-health-')); roots.push(root);
    for (const file of files) { await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), file.content); }
    const options = { generatedAt: '2026-10-14T00:00:00.000Z' };
    await utimes(join(root, files[0].path), new Date('2030-01-01'), new Date('2030-01-01'));
    expect(await readProjectHealth(root, options)).toEqual(evaluateProjectHealth({ files }, options));
    files.find((file) => file.path === 'chapters/0002/0001.md')!.content += '变化';
    expect(statuses(files)['summaries/volume/0001.md']).toBe('current');
    const file = files.find((file) => file.path === 'summaries/global.md')!;
    expect(parseSummaryDocument(file.content, file.path)?.document.chapterIds).toHaveLength(3);
  });

  it('preflights a damaged target and manual frontmatter without blocking regeneration of stale summaries', () => {
    const files = fixture(); const target = files.find((file) => file.path === 'summaries/volume/0001.md')!;
    target.content = target.content.replace('\n林安到达城门。\n', '\n修改受管正文。\n');
    let source = prepareSummaryGeneration({ files }, target.path);
    expect(source.ready).toBe(false); expect(source.problems).toContainEqual(expect.objectContaining({ path: target.path, status: 'target-invalid' }));
    expect(formatSummaryGenerationCoverage(source)).toContain('不会自动补写来源或覆盖损坏目标');
    target.content = '---\nid: 0002\n---\n# 手工卷摘要\n';
    expect(prepareSummaryGeneration({ files }, target.path).ready).toBe(false);
    target.content = '# 手工卷摘要\n'; summarize(files, target.path);
    files.push(...chapter('0001/0003'));
    expect(statuses(files)[target.path]).toBe('stale');
    expect(prepareSummaryGeneration({ files }, target.path).ready).toBe(true);
  });

  it('allows marker names and safely rendered literal comments while rejecting real unknown or duplicate blocks', () => {
    const files = chapter('0001/0001'); const path = 'summaries/volume/0001.md';
    const author = '# 作者笔记\n提到 `oan:summary:v1` 与 oan:summary: 字面量。\n';
    files.push({ path, content: author }); summarize(files, path);
    const file = files.at(-1)!; const parsed = parseSummaryDocument(file.content, path)!;
    expect(parsed.authorContent).toContain(author);
    const text = '提到 oan:summary: 与 <!-- 注释 -->，A&B <门>。';
    file.content = mergeSummaryDocument(file.content, { ...parsed.document, paragraphs: [{ text, sourcePaths: parsed.document.sources.map((item) => item.path) }] });
    expect(parseSummaryDocument(file.content, path)!.document.paragraphs[0].text).toBe(text);
    expect(prepareSummaryGeneration({ files }, 'summaries/global.md').sources[0].payload).toBe(text);
    for (const suffix of ['\n<!-- oan:summary:v2\n{}\n-->', '\n<!-- oan:summary:v1\n', '\n<!-- /oan:summary:v1 -->']) {
      expect(() => parseSummaryDocument(file.content + suffix, path)).toThrow();
    }
  });

  it('preserves CRLF author bytes and raw offsets through no-op and changed managed updates', () => {
    const files = fixture(); const path = 'summaries/volume/0001.md';
    const generated = files.find((file) => file.path === path)!.content;
    const prefix = '---\r\nid: "0001"\r\n---\r\n# 作者标题\r\n\r\n批注 oan:summary:。\r\n';
    const suffix = '\r\n作者后记\r\n';
    const existing = prefix + parseSummaryDocument(generated, path)!.block.replaceAll('\n', '\r\n') + suffix;
    const parsed = parseSummaryDocument(existing, path)!;
    expect(existing.slice(parsed.start, parsed.end)).toBe(parsed.block);
    expect(mergeSummaryDocument(existing, parsed.document)).toBe(existing);
    files.find((file) => file.path === path)!.content = existing;
    expect(statuses(files)[path]).toBe('current');
    expect(statuses(files)['summaries/global.md']).toBe('stale');
    const next = mergeSummaryDocument(existing, { ...parsed.document, paragraphs: [{ text: '林安抵达城门。', sourcePaths: parsed.document.sources.map((source) => source.path) }] });
    expect(next.startsWith(prefix)).toBe(true); expect(next.endsWith(suffix)).toBe(true);
    expect(parseSummaryDocument(next, path)!.document.paragraphs[0].text).toBe('林安抵达城门。');
    expect(() => parseSummaryDocument(existing.replace('林安到达城门。\r\n', '被改坏。\r\n'), path)).toThrow();
  });

  it('keeps book scope complete and discards oversized payloads with an actionable book-specific report', () => {
    const files = fixture();
    for (const file of files.filter((file) => file.path.startsWith('summaries/volume/'))) {
      const parsed = parseSummaryDocument(file.content, file.path)!;
      file.content = mergeSummaryDocument(file.content, { ...parsed.document, paragraphs: Array.from({ length: 32 }, () => ({ text: '文'.repeat(2048), sourcePaths: parsed.document.sources.map((source) => source.path) })) });
    }
    const source = prepareSummaryGeneration({ files }, 'summaries/global.md');
    expect(source.ready).toBe(false); expect(source.chapterIds).toHaveLength(3);
    expect(source.sources).toEqual([]); expect(source.verifiedSourceCount).toBe(2);
    expect(formatSummaryGenerationCoverage(source)).toContain('不能选择卷子集');
    expect(formatSummaryGenerationCoverage(source)).not.toContain('请缩小卷范围');
  });

  it('supports more than 32 volumes with grouped references and preserves raw text through both summary levels', () => {
    const files = Array.from({ length: 33 }, (_, index) => chapter(`${String(index + 1).padStart(4, '0')}/0001`)).flat();
    for (let volume = 1; volume <= 33; volume++) summarize(files, `summaries/volume/${String(volume).padStart(4, '0')}.md`);
    const volume = files.find((file) => file.path === 'summaries/volume/0001.md')!;
    const parsed = parseSummaryDocument(volume.content, volume.path)!;
    volume.content = mergeSummaryDocument(volume.content, { ...parsed.document, paragraphs: [{ text: '<门> 与 A&B。', sourcePaths: parsed.document.sources.map((source) => source.path) }] });
    const source = prepareSummaryGeneration({ files }, 'summaries/global.md');
    expect(source.ready).toBe(true); expect(source.sources).toHaveLength(33);
    expect(source.sources[0].payload).toBe('<门> 与 A&B。');
    const draft = parseSummaryGenerationDraft({ schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, paragraphs: [{ text: source.sources[0].payload, sourcePaths: source.sources.map((file) => file.path) }] }, source.sourceFingerprint, source.sources.map((file) => file.path));
    const book = mergeSummaryDocument(undefined, { schemaVersion: 1, targetPath: 'summaries/global.md', chapterIds: source.chapterIds,
      sources: source.sources.map(({ path, sourceHash, payloadHash }) => ({ path, sourceHash, payloadHash })), sourceFingerprint: draft.sourceFingerprint, paragraphs: draft.paragraphs });
    expect(book).toContain('\n&lt;门&gt; 与 A&amp;B。\n'); expect(book).not.toContain('&amp;lt;');
  });

  it('uses raw chapter observations and requires regenerating summaries bound to an escaped payload', () => {
    const files = chapter('0001/0001'); const path = 'summaries/volume/0001.md';
    const state = JSON.parse(files[1].content); state.observations[0].subject = 'A&B'; state.observations[0].observation = '看见 <门>';
    files[1].content = JSON.stringify(state);
    files[2].content = files[2].content.replace('- 林安: 到达城门 (lines', '- A&amp;B: 看见 &lt;门&gt; (lines');
    const source = prepareSummaryGeneration({ files }, path);
    expect(source.ready).toBe(true); expect(source.sources[0].payload).toBe('- A&B: 看见 <门> (lines 2-2)');
    files.push({ path, content: mergeSummaryDocument(undefined, { schemaVersion: 1, targetPath: path, chapterIds: source.chapterIds,
      sources: source.sources.map(({ path, sourceHash }) => ({ path, sourceHash, payloadHash: hash('- A&amp;B: 看见 &lt;门&gt; (lines 2-2)') })),
      sourceFingerprint: source.sourceFingerprint, paragraphs: [{ text: '旧摘要', sourcePaths: source.sources.map((file) => file.path) }] }) });
    expect(statuses(files)[path]).toBe('unverified');
    expect(prepareSummaryGeneration({ files }, path).ready).toBe(true);
    summarize(files, path); expect(statuses(files)[path]).toBe('current');
  });
});
