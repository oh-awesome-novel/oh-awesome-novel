import { REVIEW_DIMENSIONS } from '@oh-awesome-novel/core/chapter-review-contract';
import type { ChapterReviewDecision, ChapterReviewView } from '@oh-awesome-novel/core/chapter-review-contract';
import { parsePendingActionViewEnvelope } from './pending-action-view';
import type { PendingActionView } from './pending-action-view';
export * from '@oh-awesome-novel/core/chapter-review-contract';
export interface ChapterReviewClientMethods {
  listChapterReviews(input: { expectedWorkspaceRoot: string; path: string }, signal?: AbortSignal): Promise<{ reports: ChapterReviewView[]; omittedCount: number }>;
  generateChapterReview(input: { expectedWorkspaceRoot: string; path: string; basisPaths: string[] }, signal?: AbortSignal): Promise<ChapterReviewView>;
  readChapterReview(id: string, expectedWorkspaceRoot: string, signal?: AbortSignal): Promise<ChapterReviewView>;
  saveChapterReviewDecisions(id: string, input: { expectedWorkspaceRoot: string; revision: number; choices: Record<string, ChapterReviewDecision> }): Promise<ChapterReviewView>;
  reviseChapterReview(id: string, input: { expectedWorkspaceRoot: string; decisionRevision: number }, signal?: AbortSignal): Promise<{ pendingAction: PendingActionView }>;
}
type Request = <T>(path: string, options?: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }) => Promise<T>;
export function createChapterReviewClient(request: Request): ChapterReviewClientMethods {
  return {
    async listChapterReviews(input, signal) {
      const value = await request<unknown>('/api/workspace/chapter-reviews/list', { method: 'POST', body: input, signal });
      if (!record(value) || !fields(value, ['reports', 'omittedCount']) || !Array.isArray(value.reports) || value.reports.length > 20 || !integer(value.omittedCount)) throw new Error('审稿列表响应无效。');
      return { reports: value.reports.map(view => parseChapterReviewView(view, undefined, input.path)), omittedCount: value.omittedCount };
    },
    async generateChapterReview(input, signal) {
      return parseChapterReviewView(await request<unknown>('/api/workspace/chapter-reviews/generate', { method: 'POST', body: input, signal }), undefined, input.path);
    },
    async readChapterReview(id, expectedWorkspaceRoot, signal) {
      return parseChapterReviewView(await request<unknown>(url(id, 'read'), { method: 'POST', body: { expectedWorkspaceRoot }, signal }), id);
    },
    async saveChapterReviewDecisions(id, input) {
      const view = parseChapterReviewView(await request<unknown>(url(id, 'decisions'), { method: 'POST', body: input }), id);
      if (view.decisions.revision !== input.revision + 1 || Object.entries(input.choices).some(([key, value]) => view.decisions.choices[key] !== value)) throw new Error('裁决保存响应不一致。');
      return view;
    },
    async reviseChapterReview(id, input, signal) {
      const value = parsePendingActionViewEnvelope(await request<unknown>(url(id, 'revise'), { method: 'POST', body: input, signal }));
      if (value.pendingAction.origin?.kind !== 'chapterReview' || value.pendingAction.origin.reportId !== id || value.pendingAction.origin.decisionRevision !== input.decisionRevision) throw new Error('修订候选不属于这次审稿。');
      return value;
    },
  };
}
export function parseChapterReviewView(value: unknown, expectedId?: string, expectedPath?: string): ChapterReviewView {
  const fail = (): never => { throw new Error('审稿报告响应无效。'); };
  if (!record(value) || !fields(value, ['report', 'decisions', 'stale'], ['staleReason']) || typeof value.stale !== 'boolean' ||
    (value.stale ? !text(value.staleReason, 4000) : value.staleReason !== undefined) || !record(value.report) || !record(value.decisions)) return fail();
  const r = value.report; const d = value.decisions;
  if (!fields(r, ['schemaVersion', 'id', 'createdAt', 'path', 'sourceHash', 'contextFingerprint', 'basisPaths', 'sourceFiles', 'metrics', 'dimensions', 'findings', 'discardedCount']) ||
    r.schemaVersion !== 1 || !reportId(r.id) || expectedId !== undefined && r.id !== expectedId || !chapter(r.path) || expectedPath !== undefined && r.path !== expectedPath ||
    typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt)) || !hash(r.sourceHash) || !hash(r.contextFingerprint) || !integer(r.discardedCount) || r.discardedCount > 60 ||
    !Array.isArray(r.basisPaths) || r.basisPaths.length > 16 || !r.basisPaths.every(path => text(path, 1000)) || !Array.isArray(r.sourceFiles) || r.sourceFiles.length > 48 ||
    !record(r.metrics) || !fields(r.metrics, ['characters', 'lines', 'paragraphs']) || !Object.values(r.metrics).every(integer) ||
    !Array.isArray(r.dimensions) || r.dimensions.length !== 8 || !Array.isArray(r.findings) || r.findings.length > 60) return fail();
  const sources = new Map<string, string>();
  for (const source of r.sourceFiles) {
    if (!record(source) || !fields(source, ['path', 'sourceHash']) || !text(source.path, 1000) || !hash(source.sourceHash) || sources.has(source.path)) return fail();
    sources.set(source.path, source.sourceHash);
  }
  if (sources.get(r.path) !== r.sourceHash) return fail();
  for (const [i, dimension] of r.dimensions.entries()) if (!record(dimension) || !fields(dimension, ['category', 'status', 'summary']) || dimension.category !== REVIEW_DIMENSIONS[i] || !['pass', 'issues', 'notChecked'].includes(String(dimension.status)) || !text(dimension.summary, 1000)) return fail();
  const ids = new Set<string>();
  for (const finding of r.findings) {
    if (!record(finding) || !fields(finding, ['id', 'category', 'severity', 'anchor', 'quote', 'quoteStart', 'issue', 'suggestedFix', 'evidence', 'confidence', 'blocking']) ||
      typeof finding.id !== 'string' || !/^finding-[a-f0-9]{24}$/u.test(finding.id) || ids.has(finding.id) || !REVIEW_DIMENSIONS.includes(finding.category as never) ||
      !['high', 'medium', 'low'].includes(String(finding.severity)) || finding.blocking !== false || !anchor(finding.anchor) || !text(finding.quote, 4000) || !integer(finding.quoteStart) ||
      finding.quoteStart < finding.anchor.start || finding.quoteStart + finding.quote.length > finding.anchor.end || finding.anchor.text.slice(finding.quoteStart - finding.anchor.start, finding.quoteStart - finding.anchor.start + finding.quote.length) !== finding.quote ||
      !text(finding.issue, 2000) || !text(finding.suggestedFix, 2000) || !Array.isArray(finding.evidence) || finding.evidence.length > 8 || finding.confidence !== (finding.evidence.length ? 'source-backed' : 'inference')) return fail();
    ids.add(finding.id);
    for (const citation of finding.evidence) if (!record(citation) || !fields(citation, ['path', 'sourceHash', 'start', 'end', 'line', 'quote', 'role']) || !text(citation.path, 1000) || sources.get(citation.path) !== citation.sourceHash || !integer(citation.start) || !integer(citation.end) || !integer(citation.line) || citation.line < 1 || !text(citation.quote, 4000) || citation.end - citation.start !== citation.quote.length || !['rule', 'fact'].includes(String(citation.role))) return fail();
  }
  if (!fields(d, ['reportId', 'revision', 'choices']) || d.reportId !== r.id || !integer(d.revision) || !record(d.choices) || Object.keys(d.choices).length !== ids.size || Object.entries(d.choices).some(([id, value]) => !ids.has(id) || !['process', 'keep', 'defer'].includes(String(value)))) return fail();
  return value as unknown as ChapterReviewView;
}
function anchor(value: unknown): value is { id: string; start: number; end: number; line: number; text: string } {
  return record(value) && fields(value, ['id', 'start', 'end', 'line', 'text']) && text(value.id, 200) && integer(value.start) && integer(value.end) && integer(value.line) && value.line > 0 && text(value.text, 120_000) && value.end - value.start === value.text.length;
}
function url(id: string, action: string): string { if (!reportId(id)) throw new Error('审稿报告标识无效。'); return `/api/workspace/chapter-reviews/${encodeURIComponent(id)}/${action}`; }
function reportId(value: unknown): value is string { return typeof value === 'string' && /^review-[A-Za-z0-9-]{1,100}$/u.test(value); }
function chapter(value: unknown): value is string { return typeof value === 'string' && /^chapters\/(?!0000)\d{4}\/(?!0000)\d{4}\.md$/u.test(value); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fields(v: Record<string, unknown>, keys: string[], optional: string[] = []): boolean { return keys.every(key => Object.hasOwn(v, key)) && Object.keys(v).every(key => keys.includes(key) || optional.includes(key)); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
