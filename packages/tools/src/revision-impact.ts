import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, readFile, readdir, realpath, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeRevisionImpact, listAgentUsageSessions, readAgentGovernanceHistory, listChapterReviewReports } from '@oh-awesome-novel/core';
import type { RevisionImpactFrozenComparison, RevisionImpactReadEvidence, RevisionImpactReport, RevisionImpactSource, RevisionImpactView } from '@oh-awesome-novel/core';
import { normalizeWorkspaceRelativePath } from './candidate-change-set';
import { createPendingActionStore } from './pending-action-store';
import { inspectNovelObjectEvidence } from './final-object-tree-validator';
import { readGitFileVersion } from './git-integration';

const ROOTS = ['chapters', 'characters', 'world', 'outline', 'state', 'timeline', 'foreshadow', 'summaries'];
const MAX_BYTES = 8 * 1024 * 1024;
export function assertRevisionImpactPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('请选择章稿或设定文件。');
  const path = normalizeWorkspaceRelativePath(value);
  if (!/^(?:chapters|characters|world|outline|state|timeline|foreshadow|summaries)\/.+\.(?:md|ya?ml)$/u.test(path) || path.length > 1000) throw new Error('影响分析仅支持小说对象文件。');
  return path;
}
export function normalizeRevisionImpactSource(value: unknown): RevisionImpactSource {
  if (!record(value)) throw new Error('比较来源无效。');
  if (value.kind === 'git' && Object.keys(value).every(key => ['kind', 'path', 'ref'].includes(key)) && typeof value.ref === 'string' && value.ref.length <= 120) return { kind: 'git', path: assertRevisionImpactPath(value.path), ref: value.ref };
  if (value.kind === 'acceptedAction' && Object.keys(value).every(key => ['kind', 'actionId'].includes(key)) && typeof value.actionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.actionId) && !value.actionId.includes('..')) return { kind: 'acceptedAction', actionId: value.actionId };
  throw new Error('请选择 Git 版本或已接受的修改。');
}

/** Hash-based bounded snapshot. Nothing in this reader updates canonical files or Git. */
export async function readRevisionImpactSnapshot(root: string, required: readonly string[], limits: { files?: number; bytes?: number } = {}) {
  const workspace = await realpath(root); const maxFiles = Math.min(limits.files ?? 1000, 1000); const maxBytes = Math.min(limits.bytes ?? MAX_BYTES, MAX_BYTES);
  const files: Array<{ path: string; content: string }> = []; const manifest = new Map<string, string | null>();
  const seen = new Set<string>(); const gaps = new Set<string>(); let entries = 0; let loadedBytes = 0; let complete = true;
  const omit = (reason: string) => { complete = false; gaps.add(reason); };
  async function read(path: string, required = false) {
    if (seen.has(path)) return; seen.add(path);
    if (path.length > 1000) { omit('部分路径超过本次分析的长度上限。'); return; }
    const absolute = join(workspace, path); let stat;
    try { stat = await lstat(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { if (required) manifest.set(path, null); return; } omit('部分文件无法读取。'); return; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > (required ? 2 * 1024 * 1024 : 128 * 1024)) { manifest.set(path, null); omit('部分文件非普通文本或超过单文件读取上限。'); return; }
    if (files.length >= maxFiles || loadedBytes + stat.size > maxBytes) { manifest.set(path, null); omit('对象树超过本次文件数或字节上限。'); return; }
    try {
      // Each parent has either been walked without following links, or checked below for explicit targets.
      let cursor = workspace;
      for (const part of path.split('/').slice(0, -1)) { cursor = join(cursor, part); const parent = await lstat(cursor); if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Unsafe parent'); }
      const bytes = await readFile(absolute); if (bytes.length !== stat.size || bytes.length + loadedBytes > maxBytes) throw new Error('Changed during read');
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); if (content.includes('\0')) throw new Error('Binary');
      manifest.set(path, digest(bytes)); files.push({ path, content }); loadedBytes += bytes.length;
    } catch { manifest.set(path, null); omit('部分文件读取不完整、含非法文本或在读取时变化。'); }
  }
  for (const path of required) await read(assertRevisionImpactPath(path), true);
  async function walk(relative: string, depth: number): Promise<void> {
    if (depth > 24) { omit('部分路径超过遍历深度上限。'); return; }
    let info; try { info = await lstat(join(workspace, relative)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; omit('部分目录无法读取。'); return; }
    if (!info.isDirectory() || info.isSymbolicLink()) { omit('部分目录无法作为普通对象目录读取。'); return; }
    try {
      const directory = await opendir(join(workspace, relative));
      for await (const entry of directory) {
        if (++entries > 10_000) { omit('对象树超过 10000 个目录项的遍历上限。'); break; }
        if (entry.name.startsWith('.')) continue;
        const path = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) { omit('跳过了链接路径。'); continue; }
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile() && /\.(?:md|ya?ml)$/u.test(path)) await read(path);
      }
    } catch { omit('部分对象目录无法完整遍历。'); }
  }
  for (const family of ROOTS) { if (entries > 10_000) break; await walk(family, 0); }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const inventory = [...manifest].sort(([a], [b]) => a.localeCompare(b)).map(([path, hash]) => ({ path, hash }));
  return { files, manifest: inventory, fingerprint: hashJson({ inventory, complete }), coverage: { complete, scannedFiles: manifest.size, loadedFiles: files.length, loadedBytes, gaps: [...gaps] } };
}

async function generationEvidence(root: string) {
  const reads: RevisionImpactReadEvidence[] = []; const gaps = new Set<string>();
  try {
    const sessions = await listAgentUsageSessions(root);
    if (!sessions.length) gaps.add('没有可用的生成日志；日志可能已清理，不能据此认定从未读取。');
    if (sessions.length > 20) gaps.add('生成日志仅检查最近 20 个会话。');
    for (const session of sessions.slice(0, 20)) {
      const history = await readAgentGovernanceHistory(root, session.id, 20);
      if (history.truncated || history.diagnostics.length) gaps.add('部分生成日志被截断、缺失或不可读。');
      for (const entry of history.records) if (entry.recordType === 'request') for (const [index, source] of entry.sources.entries()) {
        if (source.path && ['selected', 'compressed'].includes(source.outcome) && source.modelVisibleChars > 0) reads.push({ path: source.path, ...(source.sourceHash ? { sourceHash: source.sourceHash } : {}), generationId: `${session.id}/${entry.turnId}`, location: `request step ${entry.stepIndex} / sources[${index}] (${source.outcome})` });
      }
    }
  } catch { gaps.add('生成日志暂不可用。'); }
  try {
    const reports = await listChapterReviewReports(root, undefined, { scanLimit: 20 });
    if (reports.omittedCount) gaps.add('审稿记录只使用仍保留且可读的最近 20 份。');
    for (const report of reports.reports) for (const source of report.sourceFiles) reads.push({ path: source.path, sourceHash: source.sourceHash, generationId: report.id, targetPath: report.path, location: '审稿报告 sourceFiles' });
  } catch { gaps.add('审稿来源记录暂不可用。'); }
  try {
    const directory = join(root, '.workspace/change-engine/v1/pending');
    const info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid proposal directory');
    const entries = (await readdir(directory)).filter(name => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(name)).sort();
    if (entries.length > 100) gaps.add('生成候选来源仅检查前 100 份保留记录。');
    const store = await createPendingActionStore({ workspaceRoot: root });
    for (const name of entries.slice(0, 100)) {
      try {
        const action = await store.readAction(name.slice(0, -5));
        if (action.origin?.kind === 'playChapterWriting') for (const source of action.origin.contextFiles) reads.push({ path: source.path, sourceHash: source.sourceHash, generationId: action.id, targetPath: action.origin.targetPath, location: '章节生成 origin.contextFiles（候选不等于已采纳事实）' });
      } catch { gaps.add('部分候选来源记录不可读。'); }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') gaps.add('候选来源历史暂不可用。'); }
  const bounded = reads.slice(0, 5000).sort((a, b) => `${a.generationId}/${a.path}/${a.location}`.localeCompare(`${b.generationId}/${b.path}/${b.location}`));
  if (reads.length > bounded.length) gaps.add('生成来源超过本次 5000 条证据上限。');
  return { reads: bounded, gaps: [...gaps], fingerprint: hashJson({ reads: bounded, gaps: [...gaps].sort() }) };
}

async function freeze(root: string, requested: RevisionImpactSource) {
  const gaps: string[] = []; let source = requested; let beforeComplete = true;
  const seeds: Array<{ path: string; beforeKnown: boolean; beforeHash: string | null; expectedAfter?: string | null; beforeRef?: string; beforeText?: string }> = [];
  if (requested.kind === 'git') {
    try {
      const old = await readGitFileVersion(root, requested.path, requested.ref);
      source = { ...requested, ref: old.ref }; seeds.push({ path: requested.path, beforeKnown: true, beforeHash: old.hash, beforeRef: old.ref, ...(old.content !== undefined ? { beforeText: old.content } : {}) });
      if (old.hash && old.content === undefined) gaps.push('变更前内容不是可读取的 UTF-8 文本，只有内容 hash 可用。');
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!['git_unavailable', 'not_git_repository', 'head_missing'].includes(code ?? '')) throw error;
      gaps.push('Git 或初始 commit 不可用，无法核对变更前版本；下列关系只用于人工复核。'); seeds.push({ path: requested.path, beforeKnown: false, beforeHash: null });
    }
  } else {
    const store = await createPendingActionStore({ workspaceRoot: root }); const record = await store.readRecord(requested.actionId);
    if (record.status !== 'accepted') throw new Error('只能分析已接受的修改。');
    const changes = record.action.changes.filter(change => { try { assertRevisionImpactPath(change.path); return true; } catch { return false; } });
    if (!changes.length) throw new Error('这个修改没有可分析的小说对象文件。');
    if (changes.length > 16) { beforeComplete = false; gaps.push(`本次仅分析前 16 个目标，另外 ${changes.length - 16} 个请按 Git 路径单独比较。`); }
    let beforeBytes = 0;
    for (const change of changes.slice(0, 16)) {
      const seed: typeof seeds[number] = { path: change.path, beforeKnown: true, beforeHash: change.baseline.exists ? change.baseline.sha256 : null, expectedAfter: change.draft?.sha256 ?? null };
      if (seed.beforeHash && beforeBytes < MAX_BYTES) {
        try { const old = await readGitFileVersion(root, change.path, record.action.repository.head); if (old.hash === seed.beforeHash) { seed.beforeRef = old.ref; if (old.content !== undefined && beforeBytes + Buffer.byteLength(old.content) <= MAX_BYTES) { seed.beforeText = old.content; beforeBytes += Buffer.byteLength(old.content); } } } catch { /* Immutable baseline hash remains useful when the old dirty body is not in Git. */ }
        if (seed.beforeText === undefined) gaps.push(`${change.path} 的变更前正文无法从 Git 还原，只保留了审批 baseline hash。`);
      }
      seeds.push(seed);
    }
  }
  const snapshot = await readRevisionImpactSnapshot(root, seeds.map(seed => seed.path));
  const files = new Map(snapshot.files.map(file => [file.path, file.content]));
  const comparisons: RevisionImpactFrozenComparison[] = [];
  const references: ReturnType<typeof inspectNovelObjectEvidence>['references'] = [];
  const inspected = new Map<string, ReturnType<typeof inspectNovelObjectEvidence>>();
  for (const file of snapshot.files) {
    try { const result = inspectNovelObjectEvidence(file.path, file.content); inspected.set(file.path, result); if (result.truncated) gaps.push('部分对象引用超出单文件上限。'); references.push(...result.references); }
    catch { gaps.push(`${file.path} 的结构引用无法解析。`); }
    if (references.length > 20_000) { gaps.push('登记引用超过本次 20000 条上限。'); break; }
  }
  for (const seed of seeds) {
    const afterText = files.get(seed.path); const afterHash = snapshot.manifest.find(file => file.path === seed.path)?.hash ?? null;
    // Distinguish absent sources from skipped/oversized sources before making a comparison.
    if (afterText === undefined) { try { await lstat(join(root, seed.path)); throw new Error('目标文件超出读取范围，请缩小文件后再比较。'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    if (seed.expectedAfter !== undefined && seed.expectedAfter !== afterHash) throw new Error('已接受的目标又发生了变化，请选择 Git 版本与当前文件重新比较。');
    let identities: RevisionImpactFrozenComparison['identities'] = []; let names: string[] = [];
    for (const content of [seed.beforeText, afterText].filter((value): value is string => value !== undefined)) {
      try { const result = inspectNovelObjectEvidence(seed.path, content); identities.push(...result.identities); names.push(...result.names); } catch { /* Coverage warning was already added for current structured input. */ }
    }
    if (!identities.length) { try { identities = inspectNovelObjectEvidence(seed.path, seed.path.endsWith('.md') ? '' : '{}').identities; } catch { /* no registered identity */ } }
    const character = /^characters\/([^/]+)\//u.exec(seed.path)?.[1];
    if (character) for (const [path, result] of inspected) if (path.startsWith(`characters/${character}/`) && /\/(?:meta\.ya?ml|summary\.md|profile\.md)$/u.test(path)) names.push(...result.names);
    comparisons.push({ path: seed.path, beforeKnown: seed.beforeKnown, beforeHash: seed.beforeHash, afterHash, ...(seed.beforeRef ? { beforeRef: seed.beforeRef } : {}),
      oldTextAvailable: seed.beforeHash === null && seed.beforeKnown || seed.beforeText !== undefined,
      change: !seed.beforeKnown ? 'unknown' : seed.beforeHash === afterHash ? 'unchanged' : 'changed',
      ...(seed.beforeText !== undefined ? { beforeText: seed.beforeText } : {}), ...(afterText !== undefined ? { afterText } : {}), identities,
      names: [...new Set(names)].slice(0, 12),
    });
  }
  const evidence = await generationEvidence(root);
  return { source, comparisons, snapshot, references: references.slice(0, 20_000), evidence, gaps, beforeComplete };
}

export async function createRevisionImpactReport(root: string, value: unknown): Promise<RevisionImpactView> {
  const frozen = await freeze(root, normalizeRevisionImpactSource(value));
  const analysis = analyzeRevisionImpact({ comparisons: frozen.comparisons, files: frozen.snapshot.files, complete: frozen.snapshot.coverage.complete,
    references: frozen.references, generations: frozen.evidence.reads, beforeComplete: frozen.beforeComplete });
  const report: RevisionImpactReport = { schemaVersion: 1, id: `impact-${Date.now()}-${randomUUID()}`, createdAt: new Date().toISOString(), source: frozen.source,
    comparisons: frozen.comparisons.map(({ beforeText: _before, afterText: _after, identities: _ids, names: _names, ...comparison }) => comparison),
    items: analysis.items, counts: analysis.counts, omittedItems: analysis.omittedItems, manifest: frozen.snapshot.manifest,
    snapshotFingerprint: frozen.snapshot.fingerprint, evidenceFingerprint: frozen.evidence.fingerprint,
    coverage: { ...frozen.snapshot.coverage, gaps: [...new Set([...frozen.snapshot.coverage.gaps, ...frozen.gaps, ...frozen.evidence.gaps, ...analysis.gaps])].slice(0, 60) } };
  await writeReport(root, report);
  return { report, stale: false };
}
export async function readRevisionImpactReport(root: string, id: string): Promise<RevisionImpactView> {
  const report = await readReport(root, id);
  try {
    const now = await freeze(root, report.source);
    const comparisons = now.comparisons.map(({ beforeText: _before, afterText: _after, identities: _ids, names: _names, ...comparison }) => comparison);
    if (now.snapshot.fingerprint !== report.snapshotFingerprint || now.evidence.fingerprint !== report.evidenceFingerprint || hashJson(comparisons) !== hashJson(report.comparisons)) return { report, stale: true, staleReason: '比较来源、文件清单或已记录证据发生变化，请重新分析。' };
    return { report, stale: false };
  } catch { return { report, stale: true, staleReason: '比较版本或证据暂不可用，请重新分析。' }; }
}
export async function listRevisionImpactReports(root: string): Promise<Array<{ id: string; createdAt: string; paths: string[] }>> {
  let directory: string; try { directory = await reportDirectory(root, false); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const names = (await readdir(directory)).filter(name => /^impact-[A-Za-z0-9-]+\.json$/u.test(name)).sort().reverse().slice(0, 20);
  const reports: Array<{ id: string; createdAt: string; paths: string[] }> = [];
  for (const name of names) { try { const report = await readReport(root, name.slice(0, -5)); reports.push({ id: report.id, createdAt: report.createdAt, paths: report.comparisons.map(source => source.path) }); } catch { /* A corrupt disposable report cannot invalidate canonical data. */ } }
  return reports;
}
async function reportDirectory(root: string, create: boolean): Promise<string> {
  let path = await realpath(root);
  for (const part of ['.workspace', 'revision-impacts']) { path = join(path, part); if (create) await mkdir(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }); const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('影响报告目录无效。'); }
  return path;
}
async function writeReport(root: string, report: RevisionImpactReport): Promise<void> {
  const directory = await reportDirectory(root, true); const text = JSON.stringify(report);
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('影响报告超过存储上限。');
  const temporary = join(directory, `${report.id}.tmp`); const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify({ hash: digest(text), report })); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, join(directory, `${report.id}.json`));
}
async function readReport(root: string, id: string): Promise<RevisionImpactReport> {
  if (!/^impact-[A-Za-z0-9-]{1,100}$/u.test(id)) throw new Error('影响报告标识无效。');
  const path = join(await reportDirectory(root, false), `${id}.json`); const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2 * 1024 * 1024) throw new Error('影响报告无效。');
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!record(value) || !record(value.report) || value.hash !== hashJson(value.report) || value.report.id !== id || value.report.schemaVersion !== 1) throw new Error('影响报告损坏。');
  return value.report as unknown as RevisionImpactReport;
}
function digest(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function hashJson(value: unknown): string { return digest(JSON.stringify(value)); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
