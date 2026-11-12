import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeChapterReviewDecisions, reviewHash } from './chapter-review.js';
import type { ChapterReviewDecisions, ChapterReviewReport } from './chapter-review-contract.js';
const writers = new Map<string, Promise<unknown>>();
const MAX_BYTES = 2 * 1024 * 1024;
export function newChapterReviewId(): string { return `review-${Date.now()}-${randomUUID()}`; }
export async function saveChapterReviewReport(root: string, report: ChapterReviewReport): Promise<void> {
  const path = await reportPath(root, report.id, false, true);
  const content = JSON.stringify(report);
  await atomic(path, JSON.stringify({ report, hash: reviewHash(content) }), true);
}
export async function readChapterReviewReport(root: string, id: string): Promise<ChapterReviewReport> {
  const value = await readJson(await reportPath(root, id));
  if (!record(value) || Object.keys(value).some(key => !['report', 'hash'].includes(key)) || !record(value.report) || reviewHash(JSON.stringify(value.report)) !== value.hash) throw new Error('审稿报告损坏，请重新审稿。');
  const report = value.report;
  if (report.schemaVersion !== 1 || report.id !== id || typeof report.path !== 'string' || !/^chapters\/(?!0000)\d{4}\/(?!0000)\d{4}\.md$/u.test(report.path) ||
    typeof report.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(report.sourceHash) || !Array.isArray(report.findings) || report.findings.length > 60 || !Array.isArray(report.dimensions) || report.dimensions.length !== 8 ||
    !Array.isArray(report.basisPaths) || report.basisPaths.length > 16 || !Array.isArray(report.sourceFiles) || report.sourceFiles.length > 48) throw new Error('审稿报告合同无效。');
  return report as unknown as ChapterReviewReport;
}
export async function listChapterReviewReports(root: string, path?: string, options: { scanLimit?: number } = {}): Promise<{ reports: ChapterReviewReport[]; omittedCount: number }> {
  const limit = options.scanLimit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('审稿报告扫描上限无效。');
  let directory: string;
  try { directory = await reportDirectory(root, false); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reports: [], omittedCount: 0 }; throw error; }
  const entries = (await readdir(directory)).filter(name => /^review-[A-Za-z0-9-]+\.json$/u.test(name)).sort().reverse();
  const reports: ChapterReviewReport[] = []; let omittedCount = Math.max(0, entries.length - limit);
  for (const name of entries.slice(0, limit)) {
    try { const report = await readChapterReviewReport(root, name.slice(0, -5)); if (path === undefined || report.path === path) reports.push(report); }
    catch { omittedCount++; }
  }
  omittedCount += Math.max(0, reports.length - 20);
  return { reports: reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20), omittedCount };
}
export async function readChapterReviewDecisions(root: string, report: ChapterReviewReport): Promise<ChapterReviewDecisions> {
  try {
    const value = await readJson(await reportPath(root, report.id, true));
    if (!record(value) || Object.keys(value).some(key => !['reportId', 'revision', 'choices'].includes(key)) || value.reportId !== report.id || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new Error('审稿裁决数据无效。');
    return { reportId: report.id, revision: value.revision as number, choices: normalizeChapterReviewDecisions(report, value.choices) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reportId: report.id, revision: 0, choices: normalizeChapterReviewDecisions(report, {}) };
    throw error;
  }
}
export async function saveChapterReviewDecisions(root: string, report: ChapterReviewReport, expectedRevision: number, choices: unknown): Promise<ChapterReviewDecisions> {
  const path = await reportPath(root, report.id, true, true);
  const previous = writers.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const current = await readChapterReviewDecisions(root, report);
    if (current.revision !== expectedRevision) throw new Error('作者裁决已变化，请重新打开报告。');
    const result = { reportId: report.id, revision: current.revision + 1, choices: normalizeChapterReviewDecisions(report, choices) };
    await atomic(path, JSON.stringify(result), false); return result;
  });
  writers.set(path, operation);
  try { return await operation; } finally { if (writers.get(path) === operation) writers.delete(path); }
}
async function reportPath(root: string, id: string, decisions = false, create = false): Promise<string> {
  if (!/^review-[A-Za-z0-9-]{1,100}$/u.test(id)) throw new Error('审稿报告标识无效。');
  return join(await reportDirectory(root, create), `${id}${decisions ? '.decisions' : ''}.json`);
}
async function reportDirectory(root: string, create: boolean): Promise<string> {
  let path = await realpath(root);
  for (const part of ['.workspace', 'chapter-reviews']) {
    path = join(path, part);
    if (create) await mkdir(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('审稿记录目录无效。');
  }
  return path;
}
async function readJson(path: string): Promise<unknown> {
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES) throw new Error('审稿记录超限或无效。');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function atomic(path: string, content: string, create: boolean): Promise<void> {
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('审稿记录超过存储上限。');
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try { if (create) await link(temporary, path); else await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
