import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { applyChapterReviewReplacements, assertChapterReviewCandidate, buildChapterReviewReport, newChapterReviewId, readChapterReviewDecisions, readChapterReviewReport, saveChapterReviewDecisions, saveChapterReviewReport, selectedChapterReviewAnchors, selectedChapterReviewFindingIds } from '@oh-awesome-novel/core';
import { chapterReviewFixture, reviewFiles, reviewPath, reviewResponse, reviewText } from './fixtures/chapter-review';
export function report() { return buildChapterReviewReport({ id: newChapterReviewId(), createdAt: '2026-11-12T00:00:00.000Z', path: reviewPath, content: reviewText, basisPaths: [], files: reviewFiles, contextFingerprint: 'a'.repeat(64), response: reviewResponse() }); }
it('verifies exact quotes, marks missing dimensions unchecked and never elevates model blocking to authority', () => {
  const result = report(); expect(result.findings).toHaveLength(2);
  expect(result.findings[0]).toMatchObject({ severity: 'high', blocking: false, confidence: 'source-backed' });
  expect(result.findings[1]).toMatchObject({ blocking: false, confidence: 'inference' });
  expect(result.dimensions.filter(d => d.status === 'notChecked')).toHaveLength(7);
  const broken = reviewResponse(); broken.findings[0]!.evidence[0]!.quote = '编造依据';
  const invalid = buildChapterReviewReport({ ...result, content: reviewText, files: reviewFiles, response: broken });
  expect(invalid.discardedCount).toBe(1); expect(invalid.findings).toHaveLength(1);
  expect(result.findings.map(f => f.id)).toEqual(report().findings.map(f => f.id));
});
it('revises the selected duplicate occurrence only, retaining unselected bytes and CRLF', () => {
  const r = report(); const second = r.findings[1]!;
  const revised = applyChapterReviewReplacements(reviewText, r, [second.id], [{ anchorId: second.anchor.id, text: '她犹豫片刻，才露出微笑。' }]);
  expect(revised.content).toBe('# 雨夜\r\n\r\n她笑了。\r\n\r\n她犹豫片刻，才露出微笑。\r\n\r\n最后一句必须保留。\r\n');
  expect(() => assertChapterReviewCandidate(reviewText, revised.content.replace('最后一句必须保留', '偷偷改动结尾'), revised.edits)).toThrow('未选');
  expect(() => applyChapterReviewReplacements(`${reviewText}漂移`, r, [second.id], [])).toThrow('变化');
  expect(() => applyChapterReviewReplacements(reviewText, r, [second.id], [{ anchorId: r.findings[0]!.anchor.id, text: '扩大范围' }])).toThrow('范围');
});
it('merges multiple selected findings on one line and rejects crossed or duplicate anchors', () => {
  const r = report(); const duplicate = { ...r.findings[0]!, id: `finding-${'f'.repeat(24)}` }; r.findings.push(duplicate);
  expect(selectedChapterReviewAnchors(r, [r.findings[0]!.id, duplicate.id])).toHaveLength(1);
  expect(() => selectedChapterReviewFindingIds(r, { reportId: r.id, revision: 1, choices: { [r.findings[0]!.id]: 'process', [duplicate.id]: 'keep' } })).toThrow('保留原文');
  expect(() => selectedChapterReviewAnchors(r, [duplicate.id, duplicate.id])).toThrow();
  r.findings[1]!.anchor.start = r.findings[0]!.anchor.start + 1;
  expect(() => selectedChapterReviewAnchors(r, r.findings.slice(0, 2).map(f => f.id))).toThrow('交错');
});
it('reopens immutable reports and versioned author decisions without touching canonical text', async () => {
  const { root } = await chapterReviewFixture();
  try {
    const r = report(); await saveChapterReviewReport(root, r);
    const initial = await readChapterReviewDecisions(root, r);
    const saved = await saveChapterReviewDecisions(root, r, 0, { ...initial.choices, [r.findings[0]!.id]: 'keep', [r.findings[1]!.id]: 'process' });
    expect(await readChapterReviewReport(root, r.id)).toEqual(r);
    expect(await readChapterReviewDecisions(root, r)).toEqual(saved);
    await expect(saveChapterReviewDecisions(root, r, 0, initial.choices)).rejects.toThrow('裁决已变化');
    expect(await readFile(join(root, reviewPath), 'utf8')).toBe(reviewText);
  } finally { await rm(root, { recursive: true, force: true }); }
});
