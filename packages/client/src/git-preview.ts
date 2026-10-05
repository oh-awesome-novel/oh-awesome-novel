import type { GitCommitResult } from './index';
export interface GitCommitPreview { id: string; fingerprint: string; files: string[]; head: string; expiresAt: string }
export interface GitDiffPreview { diff: string; preview: GitCommitPreview | null }
export interface ReviewedGitCommitInput { files: string[]; message: string; previewId: string; previewFingerprint: string }

export function parseGitDiffPreview(value: unknown): GitDiffPreview {
  const item = exact(value, ['diff', 'preview']);
  if (typeof item.diff !== 'string' || item.diff.length > 20 * 1024 * 1024 || item.diff.includes('\0')) invalid();
  if (item.preview === null) { if (item.diff) invalid(); return value as GitDiffPreview; }
  const preview = exact(item.preview, ['id', 'fingerprint', 'files', 'head', 'expiresAt']);
  if (typeof preview.id !== 'string' || !/^git_[0-9a-f-]{36}$/u.test(preview.id)
    || typeof preview.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(preview.fingerprint)
    || typeof preview.head !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(preview.head)
    || typeof preview.expiresAt !== 'string' || !Number.isFinite(Date.parse(preview.expiresAt)) || !item.diff) invalid();
  paths(preview.files);
  return structuredClone(value) as GitDiffPreview;
}
export function assertReviewedGitCommitInput(value: unknown): asserts value is ReviewedGitCommitInput {
  const item = exact(value, ['files', 'message', 'previewId', 'previewFingerprint']); paths(item.files);
  if (typeof item.message !== 'string' || !item.message.trim() || item.message.length > 4000 || item.message.includes('\0')
    || typeof item.previewId !== 'string' || !/^git_[0-9a-f-]{36}$/u.test(item.previewId)
    || typeof item.previewFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(item.previewFingerprint)) invalid();
}
export function parseReviewedGitCommitResult(value: unknown): GitCommitResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const item = value as Record<string, unknown>;
  const fields = item.warning === undefined ? ['status', 'hash', 'message'] : ['status', 'hash', 'message', 'warning'];
  exact(item, fields);
  if (item.status !== 'committed' || typeof item.hash !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(item.hash)
    || typeof item.message !== 'string' || !item.message.trim() || item.message.length > 4000) invalid();
  if (item.warning !== undefined) {
    const warning = exact(item.warning, ['code', 'message']);
    if (warning.code !== 'index_recovery_required' || typeof warning.message !== 'string' || !warning.message.trim() || warning.message.length > 4000) invalid();
  }
  return structuredClone(value) as GitCommitResult;
}
function paths(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 256 || new Set(value).size !== value.length
    || value.some((path) => typeof path !== 'string' || !path || path.length > 4096 || path.startsWith('/') || /[\x00-\x1f\x7f\\]/u.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..'))) invalid();
}
function exact(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (fields.some((field) => !Object.hasOwn(result, field)) || Object.keys(result).some((field) => !fields.includes(field))) invalid();
  return result;
}
function invalid(): never { throw new Error('Invalid reviewed Git preview data.'); }
