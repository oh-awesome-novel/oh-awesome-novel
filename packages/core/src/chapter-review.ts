import { createHash } from 'node:crypto';
import { scanNovelLint } from './novel-lint.js';
import { REVIEW_DIMENSIONS } from './writing-review.js';
import type { ReviewCategory } from './writing-review.js';
import type { ChapterReviewAnchor, ChapterReviewCitation, ChapterReviewDecisions, ChapterReviewEditProof, ChapterReviewFinding, ChapterReviewReport } from './chapter-review-contract.js';

export function chapterReviewSource(path: string, content: string) {
  if (!/^chapters\/(?!0000)\d{4}\/(?!0000)\d{4}\.md$/u.test(path) || content.length > 120_000) throw new Error('请选择 12 万字符以内的正文章节。');
  const scan = scanNovelLint(content);
  return { path, sourceHash: scan.sourceHash, anchors: scan.anchors.map(anchor => ({ id: anchor.anchorId, start: anchor.start, end: anchor.end,
    line: content.slice(0, anchor.start).split('\n').length, text: anchor.text })) };
}
export function chapterReviewBasis(files: readonly { path: string; content: string }[]) {
  return files.map(file => ({ path: file.path, sourceHash: reviewHash(file.content), anchors: scanNovelLint(file.content).anchors.map(anchor => ({
    id: anchor.anchorId, start: anchor.start, end: anchor.end, line: file.content.slice(0, anchor.start).split('\n').length, text: anchor.text,
  })) }));
}
export function buildChapterReviewReport(input: {
  id: string; createdAt: string; path: string; content: string; basisPaths: string[]; files: readonly { path: string; content: string }[]; contextFingerprint: string; response: unknown;
}): ChapterReviewReport {
  const response = record(input.response, ['dimensions', 'findings']);
  if (!Array.isArray(response.dimensions) || response.dimensions.length > 8 || !Array.isArray(response.findings) || response.findings.length > 60) throw new Error('审稿报告超过本次范围。');
  const rawDimensions: unknown[] = response.dimensions;
  const source = chapterReviewSource(input.path, input.content); const basis = chapterReviewBasis(input.files);
  const findings: ChapterReviewFinding[] = []; let discardedCount = 0;
  const discardedCategories = new Set<ReviewCategory>();
  for (const raw of response.findings) {
    try {
      const v = record(raw, ['category', 'severity', 'anchorId', 'quote', 'offset', 'issue', 'suggestedFix', 'evidence'], ['blocking']);
      const category = categoryOf(v.category);
      const anchor = source.anchors.find(anchor => anchor.id === v.anchorId);
      if (!anchor) throw new Error('Unknown chapter anchor.');
      const quote = bounded(v.quote, 4000); const offset = integer(v.offset);
      if (anchor.text.slice(offset, offset + quote.length) !== quote) throw new Error('Invalid chapter quote.');
      if (!Array.isArray(v.evidence) || v.evidence.length > 8) throw new Error('Invalid citations.');
      const evidence = v.evidence.map(raw => {
        const citation = record(raw, ['path', 'anchorId', 'quote', 'offset', 'role']);
        const file = basis.find(file => file.path === citation.path); const location = file?.anchors.find(anchor => anchor.id === citation.anchorId);
        const quote = bounded(citation.quote, 4000); const offset = integer(citation.offset);
        if (!file || !location || location.text.slice(offset, offset + quote.length) !== quote || !['rule', 'fact'].includes(String(citation.role))) throw new Error('Invalid evidence quote.');
        return { path: file.path, sourceHash: file.sourceHash, start: location.start + offset, end: location.start + offset + quote.length, line: location.line, quote, role: citation.role } as ChapterReviewCitation;
      });
      const issue = bounded(v.issue, 2000); const suggestedFix = bounded(v.suggestedFix, 2000);
      if (!['blocking', 'high', 'medium', 'low'].includes(String(v.severity))) throw new Error('Invalid severity.');
      const id = `finding-${reviewHash(JSON.stringify([source.sourceHash, category, anchor.id, offset, quote, issue])).slice(0, 24)}`;
      if (findings.some(finding => finding.id === id)) throw new Error('Duplicate finding.');
      findings.push({ id, category, severity: v.severity === 'blocking' ? 'high' : v.severity as 'high' | 'medium' | 'low', anchor,
        quote, quoteStart: anchor.start + offset, issue, suggestedFix, evidence, confidence: evidence.length ? 'source-backed' : 'inference', blocking: false });
    } catch {
      discardedCount++;
      if (isRecord(raw) && REVIEW_DIMENSIONS.includes(raw.category as ReviewCategory)) discardedCategories.add(raw.category as ReviewCategory);
    }
  }
  const dimensions = REVIEW_DIMENSIONS.map(category => {
    const matching = rawDimensions.filter(value => isRecord(value) && value.category === category);
    if (findings.some(finding => finding.category === category)) return { category, status: 'issues' as const, summary: '有待作者判断的问题。' };
    if (matching.length !== 1 || discardedCategories.has(category)) return { category, status: 'notChecked' as const, summary: discardedCategories.has(category) ? '部分意见的引文无法核对，需重新检查。' : '本次未检查。' };
    const v = record(matching[0], ['category', 'status', 'summary']);
    if (!['pass', 'issues', 'notChecked'].includes(String(v.status))) throw new Error('审稿维度状态无效。');
    return { category, status: v.status as 'pass' | 'issues' | 'notChecked', summary: bounded(v.summary, 1000) };
  });
  return { schemaVersion: 1, id: input.id, createdAt: input.createdAt, path: input.path, sourceHash: source.sourceHash, contextFingerprint: input.contextFingerprint,
    basisPaths: [...input.basisPaths], sourceFiles: basis.map(({ path, sourceHash }) => ({ path, sourceHash })),
    metrics: { characters: [...input.content.replace(/\s/gu, '')].length, lines: input.content.split('\n').length, paragraphs: source.anchors.length }, dimensions, findings, discardedCount };
}

export function normalizeChapterReviewDecisions(report: ChapterReviewReport, value: unknown): ChapterReviewDecisions['choices'] {
  if (!isRecord(value) || Object.keys(value).some(id => !report.findings.some(finding => finding.id === id))) throw new Error('裁决引用了其他报告的问题。');
  return Object.fromEntries(report.findings.map(finding => {
    const choice = value[finding.id] ?? 'defer';
    if (choice !== 'process' && choice !== 'keep' && choice !== 'defer') throw new Error('裁决必须是处理、保留或待定。');
    return [finding.id, choice];
  }));
}
export function selectedChapterReviewAnchors(report: ChapterReviewReport, ids: readonly string[]): ChapterReviewAnchor[] {
  if (!ids.length || new Set(ids).size !== ids.length || ids.length > 60) throw new Error('请明确选择要处理的问题。');
  const selected = ids.map(id => { const finding = report.findings.find(finding => finding.id === id); if (!finding) throw new Error('所选问题不属于这份报告。'); return finding.anchor; });
  const anchors = [...new Map(selected.map(anchor => [anchor.id, anchor])).values()].sort((a, b) => a.start - b.start);
  if (anchors.some((anchor, i) => i > 0 && anchor.start < anchors[i - 1]!.end)) throw new Error('修订范围交错，请重新选择。');
  return anchors;
}
export function selectedChapterReviewFindingIds(report: ChapterReviewReport, decisions: ChapterReviewDecisions): string[] {
  const ids = report.findings.filter(finding => decisions.choices[finding.id] === 'process').map(finding => finding.id);
  const anchors = selectedChapterReviewAnchors(report, ids);
  if (report.findings.some(finding => decisions.choices[finding.id] === 'keep' && anchors.some(anchor => finding.anchor.start < anchor.end && finding.anchor.end > anchor.start))) throw new Error('同一修订行内有“保留原文”的裁决，请先明确本行要处理的范围。');
  return ids;
}
export function applyChapterReviewReplacements(source: string, report: ChapterReviewReport, ids: readonly string[], value: unknown): { content: string; edits: ChapterReviewEditProof[] } {
  if (reviewHash(source) !== report.sourceHash) throw new Error('正文已变化，请重新审稿。');
  const anchors = selectedChapterReviewAnchors(report, ids);
  if (!Array.isArray(value) || value.length !== anchors.length) throw new Error('修订必须逐一覆盖选中段落。');
  const replacements = new Map<string, string>();
  for (const raw of value) {
    const v = record(raw, ['anchorId', 'text']);
    if (typeof v.anchorId !== 'string' || replacements.has(v.anchorId) || !anchors.some(anchor => anchor.id === v.anchorId) || typeof v.text !== 'string' || v.text.length > 30_000 || v.text.includes('\0')) throw new Error('修订超出选中范围或重复。');
    replacements.set(v.anchorId, v.text);
  }
  const edits: ChapterReviewEditProof[] = []; let cursor = 0; const chunks: string[] = [];
  for (const anchor of anchors) {
    if (source.slice(anchor.start, anchor.end) !== anchor.text) throw new Error('段落锚点已失效。');
    const replacement = replacements.get(anchor.id)!;
    chunks.push(source.slice(cursor, anchor.start), replacement); cursor = anchor.end;
    edits.push({ anchorId: anchor.id, start: anchor.start, end: anchor.end, length: replacement.length, hash: reviewHash(replacement) });
  }
  chunks.push(source.slice(cursor)); const content = chunks.join('');
  if (content.length > 240_000) throw new Error('修订候选超过上限。');
  assertChapterReviewCandidate(source, content, edits);
  return { content, edits };
}
export function assertChapterReviewCandidate(source: string, candidate: string, edits: readonly ChapterReviewEditProof[]): void {
  let sourceCursor = 0; let candidateCursor = 0;
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || !Number.isSafeInteger(edit.length) || edit.start < sourceCursor || edit.end <= edit.start || edit.end > source.length || edit.length < 0 || edit.length > 30_000) throw new Error('修订范围无效或交错。');
    const unchanged = source.slice(sourceCursor, edit.start);
    if (candidate.slice(candidateCursor, candidateCursor + unchanged.length) !== unchanged) throw new Error('候选修改了未选范围。');
    candidateCursor += unchanged.length;
    if (reviewHash(candidate.slice(candidateCursor, candidateCursor + edit.length)) !== edit.hash) throw new Error('选中范围的候选内容已变化。');
    candidateCursor += edit.length; sourceCursor = edit.end;
  }
  if (candidate.slice(candidateCursor) !== source.slice(sourceCursor)) throw new Error('候选修改了未选范围。');
}
export function reviewHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function categoryOf(value: unknown): ReviewCategory { if (!REVIEW_DIMENSIONS.includes(value as ReviewCategory)) throw new Error('Invalid review category'); return value as ReviewCategory; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid quote offset'); return value; }
function bounded(value: unknown, max: number): string { if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error('Invalid review text'); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function record(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!isRecord(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) throw new Error('审稿响应含未知或缺失字段。');
  return value;
}
