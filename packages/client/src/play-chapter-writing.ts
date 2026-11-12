import { normalizePlayChapterIntent } from '@oh-awesome-novel/core/play-chapter-writing-contract';
import type { PlayChapterIntent } from '@oh-awesome-novel/core/play-chapter-writing-contract';
import { parsePendingActionViewEnvelope } from './pending-action-view';
import type { PendingActionView } from './pending-action-view';
export type { PlayChapterIntent } from '@oh-awesome-novel/core/play-chapter-writing-contract';
export interface PlayChapterWritingRequest { expectedWorkspaceRoot: string; attachmentId: string; lens: 'player' | 'director'; intent: PlayChapterIntent }
export interface PlayChapterTarget { targetPath: string; chapterInventoryHash: string; reportFingerprint: string; items: Array<{ id: string; kind: string; summary: string }>; range: { first: string; last: string; turnCount: number } }
export interface PlayChapterPreview { id: string; fingerprint: string; targetPath: string; attachmentId: string; reportFingerprint: string; intent: PlayChapterIntent; diff: string; citedItemIds: string[] }
export type PlayChapterStreamEvent = { type: 'progress'; characters: number } | { type: 'preview'; preview: PlayChapterPreview };
export interface PlayChapterWritingClientMethods {
  getPlayChapterTarget(input: PlayChapterWritingRequest, signal?: AbortSignal): Promise<PlayChapterTarget>;
  generatePlayChapter(input: PlayChapterWritingRequest & Pick<PlayChapterTarget, 'targetPath' | 'chapterInventoryHash' | 'reportFingerprint'>, signal?: AbortSignal): AsyncIterable<PlayChapterStreamEvent>;
  proposePlayChapter(id: string, input: { expectedWorkspaceRoot: string; fingerprint: string; intent: PlayChapterIntent }): Promise<{ pendingAction: PendingActionView }>;
}
type Request = <T>(path: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }) => Promise<T>;
export function createPlayChapterWritingClient(request: Request, fetcher: typeof fetch, baseUrl: string): PlayChapterWritingClientMethods {
  return {
    async getPlayChapterTarget(input, signal) {
      validateInput(input);
      const value = await request<unknown>('/api/workspace/play-chapter/target', { method: 'POST', body: input, signal });
      if (!record(value) || !fields(value, ['targetPath', 'chapterInventoryHash', 'reportFingerprint', 'items', 'range']) || !chapter(value.targetPath) || !hash(value.chapterInventoryHash) || !hash(value.reportFingerprint) ||
        !Array.isArray(value.items) || !value.items.length || value.items.length > 24 || value.items.some(item => !record(item) || !fields(item, ['id', 'kind', 'summary']) || !id(item.id) || !text(item.kind, 128) || !text(item.summary, 12_000)) ||
        !record(value.range) || !fields(value.range, ['first', 'last', 'turnCount']) || !id(value.range.first) || !id(value.range.last) || !Number.isSafeInteger(value.range.turnCount) || (value.range.turnCount as number) < 1) throw new Error('转写目标响应无效。');
      return value as unknown as PlayChapterTarget;
    },
    async *generatePlayChapter(input, signal) {
      validateInput(input);
      if (!chapter(input.targetPath) || !hash(input.chapterInventoryHash) || !hash(input.reportFingerprint)) throw new Error('请先查看当前章节目标。');
      const response = await fetcher(`${baseUrl}/api/workspace/play-chapter/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal });
      if (!response.ok || !response.body) {
        const value: unknown = await response.json().catch(() => ({}));
        throw new Error(record(value) && text(value.error, 4000) ? value.error : '转写请求失败。');
      }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let done = false; let characters = 0;
      try {
        for (;;) {
          const part = await reader.read(); buffer += decoder.decode(part.value, { stream: !part.done });
          if (buffer.length > 2_000_000) throw new Error('转写响应超过上限。');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const value: unknown = JSON.parse(data);
            if (!record(value) || done) throw new Error('转写事件顺序无效。');
            if (value.type === 'error' && fields(value, ['type', 'message']) && text(value.message, 8000)) throw new Error(value.message);
            if (value.type === 'progress' && fields(value, ['type', 'characters']) && Number.isSafeInteger(value.characters) && (value.characters as number) >= characters && (value.characters as number) <= 300_000) {
              characters = value.characters as number; yield { type: 'progress', characters }; continue;
            }
            if (value.type !== 'preview' || !fields(value, ['type', 'preview']) || !validPreview(value.preview, input)) throw new Error('转写预览与本次要求不一致。');
            done = true; yield { type: 'preview', preview: value.preview };
          }
          if (part.done) break;
        }
        if (!done || buffer.trim()) throw new Error('转写流未完整结束。');
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    },
    async proposePlayChapter(previewId, input) {
      if (!id(previewId) || !hash(input.fingerprint)) throw new Error('转写预览标识无效。');
      const value = parsePendingActionViewEnvelope(await request<unknown>(`/api/workspace/play-chapter/${encodeURIComponent(previewId)}/propose`, { method: 'POST', body: { ...input, intent: normalizePlayChapterIntent(input.intent) } }));
      if (value.pendingAction.id !== previewId || value.pendingAction.origin?.kind !== 'playChapterWriting' || JSON.stringify(value.pendingAction.origin.intent) !== JSON.stringify(normalizePlayChapterIntent(input.intent))) throw new Error('转写审批响应不匹配。');
      return value;
    },
  };
}
function validPreview(value: unknown, input: PlayChapterWritingRequest & Pick<PlayChapterTarget, 'targetPath' | 'reportFingerprint'>): value is PlayChapterPreview {
  if (!record(value) || !fields(value, ['id', 'fingerprint', 'targetPath', 'attachmentId', 'reportFingerprint', 'intent', 'diff', 'citedItemIds']) || !id(value.id) || !hash(value.fingerprint) || value.targetPath !== input.targetPath || value.attachmentId !== input.attachmentId || value.reportFingerprint !== input.reportFingerprint || typeof value.diff !== 'string' || value.diff.length > 1_000_000 || !Array.isArray(value.citedItemIds) || value.citedItemIds.length < 1 || value.citedItemIds.length > 24 || !value.citedItemIds.every(id)) return false;
  try { return JSON.stringify(normalizePlayChapterIntent(value.intent)) === JSON.stringify(normalizePlayChapterIntent(input.intent)); } catch { return false; }
}
function validateInput(input: PlayChapterWritingRequest): void {
  if (!id(input.attachmentId) || !text(input.expectedWorkspaceRoot, 4096) || !['player', 'director'].includes(input.lens)) throw new Error('转写请求无效。');
  normalizePlayChapterIntent(input.intent);
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fields(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)); }
function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/u.test(value) && !value.includes('..'); }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function chapter(value: unknown): value is string { return typeof value === 'string' && /^chapters\/(?!0000)\d{4}\/(?!0000)\d{4}\.md$/u.test(value); }
