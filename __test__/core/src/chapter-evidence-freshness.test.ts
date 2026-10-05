import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateChapterEvidence, evaluateProjectHealth, formatChapterEvidenceCoverage, readProjectHealth } from '@oh-awesome-novel/core';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
function fixture(chapter = '# 第一章\r\n他走进院子。\r\n') {
  const sourceHash = hash(chapter);
  const observation = { id: 'arrive', category: 'location', subject: '主角', observation: '走进院子', confidence: 'high', evidence: { startLine: 2, endLine: 2, quote: '他走进院子。' } };
  const current = { version: 1, chapterRef: '0001/0001', sourceHash, observations: [observation] };
  const block = `<!-- oan:settlement:summary-${sourceHash} -->\n## Evidence snapshot ${sourceHash.slice(0, 12)}\n\nSource SHA-256: ${sourceHash}\n\n- 主角: 走进院子 (lines 2-2)\n<!-- /oan:settlement:summary-${sourceHash} -->`;
  const pointer = `<!-- oan:settlement:summary-current-0001-0001 -->\nCurrent evidence source SHA-256: ${sourceHash}\nEvidence snapshots preserve accepted history. Only the snapshot matching this hash describes the current settled chapter; other snapshots are historical.\n<!-- /oan:settlement:summary-current-0001-0001 -->`;
  const files = [{ path: 'chapters/0001/0001.md', content: chapter }, { path: 'state/chapters/0001/0001.yaml', content: JSON.stringify(current) }, { path: 'summaries/chapter/0001/0001.md', content: `${block}\n${pointer}\n作者保留的批注` }];
  return { files, current, sourceHash, observation };
}
describe('chapter evidence freshness from frozen bytes', () => {
  it('checks current chapter bytes and evidence, preserves author text and leaves frozen files untouched', () => {
    const { files } = fixture(); Object.freeze(files); files.forEach(Object.freeze);
    const [result] = evaluateChapterEvidence({ files });
    expect(result.summary.status).toBe('current'); expect(result.state.status).toBe('current');
    expect(result.summary.context).toContain('Author text (unverified reference');
    expect(result.summary.context).toContain('作者保留的批注');
    expect(result.state.context).toContain('not the complete canonical file');
    expect(result.chapterHash).toBe(hash(files[0].content));
  });
  it('detects source edits including newline-byte changes, independently of mtime', () => {
    const { files } = fixture(); files[0].content = files[0].content.replaceAll('\r\n', '\n');
    const [result] = evaluateChapterEvidence({ files });
    expect(result.summary.status).toBe('stale'); expect(result.state.status).toBe('stale');
    expect(result.summary.context).toBeUndefined(); expect(result.state.context).toBeUndefined();
    expect(evaluateProjectHealth({ files }).latestStateStale).toBe(true);
  });
  it('distinguishes missing and unverified author sources without blocking them', () => {
    const { files } = fixture(); files[2].content = '# 手写摘要\n作者自己的总结。';
    const [manual] = evaluateChapterEvidence({ files: [files[0], files[2]] });
    expect(manual.summary.status).toBe('unverified'); expect(manual.summary.context).toContain('作者自己的总结');
    expect(manual.state.status).toBe('missing');
    const [missing] = evaluateChapterEvidence({ files: [files[0]] }); expect(missing.summary.status).toBe('missing');
    const [orphan] = evaluateChapterEvidence({ files: fixture().files.slice(1) });
    expect(orphan.summary.status).toBe('unverified'); expect(orphan.state.status).toBe('unverified');
  });
  it.each(['pointer', 'snapshot', 'state-hash', 'quote', 'identity', 'frontmatter', 'duplicate'])('never treats edited %s metadata as current', (mutation) => {
    const { files, current } = fixture();
    if (mutation === 'pointer') files[2].content = files[2].content.replace('Current evidence source SHA-256:', 'Current source:');
    if (mutation === 'snapshot') files[2].content = files[2].content.replace('走进院子 (lines', '离开院子 (lines');
    if (mutation === 'state-hash') files[1].content = JSON.stringify({ ...current, sourceHash: 'b'.repeat(64) });
    if (mutation === 'quote') files[1].content = JSON.stringify({ ...current, observations: [{ ...current.observations[0], evidence: { startLine: 2, endLine: 2, quote: '他离开院子。' } }] });
    if (mutation === 'identity') files[1].content = JSON.stringify({ ...current, chapterRef: '0001/0002' });
    if (mutation === 'frontmatter') files[2].content = `---\nid: 0001/0002\n---\n${files[2].content}`;
    if (mutation === 'duplicate') files[2].content += `\n${files[2].content}`;
    expect(evaluateChapterEvidence({ files })[0].summary.status).not.toBe('current');
  });
  it('preserves author-owned state fields and extracts current evidence without revision history', () => {
    const { files, current } = fixture();
    files[1].content = JSON.stringify({ version: 1, notes: '作者备注', settlementCurrent: current, settlementRecords: [{ ...current, sourceHash: 'a'.repeat(64), observations: ['HISTORICAL_ONLY'] }] });
    const [result] = evaluateChapterEvidence({ files });
    expect(result.state.status).toBe('current'); expect(result.summary.status).toBe('current');
    expect(result.state.context).toContain('作者备注'); expect(result.state.context).not.toContain('HISTORICAL_ONLY');
    expect(files[1].content).toContain('HISTORICAL_ONLY');
  });
  it('reports conflicting .yaml/.yml evidence and malformed histories as unverified', () => {
    const { files, current } = fixture();
    expect(evaluateChapterEvidence({ files: [...files, { ...files[1], path: files[1].path.replace('.yaml', '.yml') }] })[0].state.status).toBe('unverified');
    files[1].content = JSON.stringify({ ...current, settlementRecords: [current] });
    expect(evaluateChapterEvidence({ files })[0].state.status).toBe('unverified');
  });
  it('bounds coverage text independently of chapter count', () => {
    const files = Array.from({ length: 500 }, (_, index) => ({ path: `chapters/0001/${String(index + 1).padStart(4, '0')}.md`, content: '# 正文' }));
    const report = formatChapterEvidenceCoverage(evaluateChapterEvidence({ files }), ['0001/0001']);
    expect(report).toContain('Chapters: 500'); expect(report).toContain('488 other chapter statuses omitted');
    expect(report).toContain('0001/0001'); expect(report.length).toBeLessThan(2200);
  });
  it('host capture agrees with the pure evaluator and touch cannot make evidence stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-evidence-health-')); roots.push(root);
    const { files } = fixture('\uFEFF# 第一章\r\n他走进院子。\r\n');
    for (const file of files) { await mkdir(join(root, file.path, '..'), { recursive: true }); await writeFile(join(root, file.path), file.content); }
    const options = { generatedAt: '2026-10-05T00:00:00.000Z' };
    expect(await readProjectHealth(root, options)).toEqual(evaluateProjectHealth({ files }, options));
    await utimes(join(root, files[0].path), new Date('2030-01-01'), new Date('2030-01-01'));
    expect(await readProjectHealth(root, options)).toEqual(evaluateProjectHealth({ files }, options));
    await writeFile(join(root, files[0].path), '# 正文改了');
    expect((await readProjectHealth(root)).latestStateStale).toBe(true);
  });
  it('never reads hidden or linked roots, and rejects oversized public files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-evidence-health-')); roots.push(root);
    await mkdir(join(root, '.workspace/private'), { recursive: true });
    await writeFile(join(root, '.workspace/private/0001.md'), 'PRIVATE');
    await symlink(join(root, '.workspace/private'), join(root, 'chapters'));
    expect((await readProjectHealth(root)).chaptersWithoutSummaries).toEqual([]);
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state/large.yaml'), 'x'.repeat(2 * 1024 * 1024 + 1));
    await expect(readProjectHealth(root)).rejects.toThrow('2 MiB');
  });
});
