import type { ReviewCategory, ReviewDimensionResult } from './writing-review.js';
export { REVIEW_DIMENSIONS } from './writing-review.js';
export const CHAPTER_REVIEW_LABELS: Record<ReviewCategory, string> = { continuity: '连贯性', character: '人物', world: '世界', plot: '剧情', hook: '伏笔', pacing: '节奏', style: '文风', evidence: '证据' };
export type ChapterReviewDecision = 'process' | 'keep' | 'defer';
export interface ChapterReviewAnchor { id: string; start: number; end: number; line: number; text: string }
export interface ChapterReviewCitation { path: string; sourceHash: string; start: number; end: number; line: number; quote: string; role: 'rule' | 'fact' }
export interface ChapterReviewFinding {
  id: string; category: ReviewCategory; severity: 'high' | 'medium' | 'low'; anchor: ChapterReviewAnchor;
  quote: string; quoteStart: number; issue: string; suggestedFix: string; evidence: ChapterReviewCitation[];
  confidence: 'source-backed' | 'inference'; blocking: false;
}
export interface ChapterReviewReport {
  schemaVersion: 1; id: string; createdAt: string; path: string; sourceHash: string; contextFingerprint: string;
  basisPaths: string[]; sourceFiles: Array<{ path: string; sourceHash: string }>;
  metrics: { characters: number; lines: number; paragraphs: number };
  dimensions: ReviewDimensionResult[]; findings: ChapterReviewFinding[]; discardedCount: number;
}
export interface ChapterReviewDecisions { reportId: string; revision: number; choices: Record<string, ChapterReviewDecision> }
export interface ChapterReviewView { report: ChapterReviewReport; decisions: ChapterReviewDecisions; stale: boolean; staleReason?: string }
export interface ChapterReviewReplacement { anchorId: string; text: string }
export interface ChapterReviewEditProof { readonly anchorId: string; readonly start: number; readonly end: number; readonly length: number; readonly hash: string }
export interface ChapterReviewOrigin {
  readonly kind: 'chapterReview'; readonly reportId: string; readonly decisionRevision: number; readonly targetPath: string;
  readonly sourceHash: string; readonly contextFingerprint: string; readonly findingIds: readonly string[]; readonly edits: readonly ChapterReviewEditProof[];
}
