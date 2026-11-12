import type { RevisionImpactSource, RevisionImpactView } from '@oh-awesome-novel/core/revision-impact-contract';
export * from '@oh-awesome-novel/core/revision-impact-contract';
export interface RevisionImpactClientMethods {
  createRevisionImpact(input: { expectedWorkspaceRoot: string; source: RevisionImpactSource }, signal?: AbortSignal): Promise<RevisionImpactView>;
  readRevisionImpact(id: string, expectedWorkspaceRoot: string, signal?: AbortSignal): Promise<RevisionImpactView>;
  listRevisionImpacts(expectedWorkspaceRoot: string, signal?: AbortSignal): Promise<{ reports: Array<{ id: string; createdAt: string; paths: string[] }> }>;
}
type Request = <T>(path: string, options?: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }) => Promise<T>;
export function createRevisionImpactClient(request: Request): RevisionImpactClientMethods {
  return {
    async createRevisionImpact(input, signal) {
      const view = parseRevisionImpactView(await request('/api/workspace/revision-impacts/create', { method: 'POST', body: input, signal }));
      const source = view.report.source;
      if (source.kind !== input.source.kind || source.kind === 'git' && input.source.kind === 'git' && source.path !== input.source.path || source.kind === 'acceptedAction' && input.source.kind === 'acceptedAction' && source.actionId !== input.source.actionId) throw new Error('比较来源响应不一致。');
      return view;
    },
    async readRevisionImpact(id, expectedWorkspaceRoot, signal) {
      if (!reportId(id)) throw new Error('影响报告标识无效。');
      const view = parseRevisionImpactView(await request(`/api/workspace/revision-impacts/${encodeURIComponent(id)}/read`, { method: 'POST', body: { expectedWorkspaceRoot }, signal }));
      if (view.report.id !== id) throw new Error('影响报告响应不一致。'); return view;
    },
    async listRevisionImpacts(expectedWorkspaceRoot, signal) {
      const value = await request<unknown>('/api/workspace/revision-impacts/list', { method: 'POST', body: { expectedWorkspaceRoot }, signal });
      if (!record(value) || !Array.isArray(value.reports) || value.reports.length > 20 || !value.reports.every(r => record(r) && reportId(r.id) && date(r.createdAt) && Array.isArray(r.paths) && r.paths.length <= 16 && r.paths.every(path))) throw new Error('影响报告列表无效。');
      return value as Awaited<ReturnType<RevisionImpactClientMethods['listRevisionImpacts']>>;
    },
  };
}
export function parseRevisionImpactView(value: unknown): RevisionImpactView {
  const fail = (): never => { throw new Error('影响报告响应无效。'); };
  if (!record(value) || typeof value.stale !== 'boolean' || value.stale && !text(value.staleReason, 4000) || !record(value.report)) return fail();
  const r = value.report;
  if (r.schemaVersion !== 1 || !reportId(r.id) || !date(r.createdAt) || !record(r.source) || !hash(r.snapshotFingerprint) || !hash(r.evidenceFingerprint) || !Array.isArray(r.comparisons) || !r.comparisons.length || r.comparisons.length > 16 || !Array.isArray(r.items) || r.items.length > 300 || !record(r.counts) || !integer(r.omittedItems) || !Array.isArray(r.manifest) || r.manifest.length > 10016 || !record(r.coverage)) return fail();
  if (r.source.kind === 'git' ? !path(r.source.path) || !text(r.source.ref, 120) : r.source.kind !== 'acceptedAction' || !text(r.source.actionId, 128)) return fail();
  const sources = new Set<string>();
  for (const c of r.comparisons) {
    if (!record(c) || !path(c.path) || sources.has(c.path) || typeof c.beforeKnown !== 'boolean' || typeof c.oldTextAvailable !== 'boolean' || !nullableHash(c.beforeHash) || !nullableHash(c.afterHash) || !['changed', 'unchanged', 'unknown'].includes(String(c.change))) return fail();
    if (c.change !== (c.beforeKnown ? c.beforeHash === c.afterHash ? 'unchanged' : 'changed' : 'unknown')) return fail();
    sources.add(c.path);
  }
  const kinds = ['derived', 'reference', 'generationRead', 'mention']; const counts = Object.fromEntries(kinds.map(kind => [kind, 0])); const ids = new Set<string>();
  for (const i of r.items) {
    if (!record(i) || !text(i.id, 80) || ids.has(i.id) || !kinds.includes(String(i.kind)) || !path(i.path) || !sources.has(String(i.sourcePath)) || !text(i.reason, 600) || !text(i.location, 500) || !text(i.evidence, 600) || i.evidenceHash !== undefined && !hash(i.evidenceHash) || i.line !== undefined && (!integer(i.line) || i.line < 1) || i.targetKnown !== undefined && typeof i.targetKnown !== 'boolean') return fail();
    ids.add(i.id); counts[i.kind as string]!++;
  }
  const totals = r.counts;
  if (kinds.some(kind => !integer(totals[kind]) || (totals[kind] as number) < counts[kind]!) || kinds.reduce((sum, kind) => sum + (totals[kind] as number), 0) !== r.items.length + r.omittedItems) return fail();
  if (!r.manifest.every(f => record(f) && path(f.path) && nullableHash(f.hash))) return fail();
  const c = r.coverage;
  if (typeof c.complete !== 'boolean' || !integer(c.scannedFiles) || !integer(c.loadedFiles) || c.loadedFiles > 1000 || !integer(c.loadedBytes) || c.loadedBytes > 8 * 1024 * 1024 || !Array.isArray(c.gaps) || c.gaps.length > 60 || !c.gaps.every(g => text(g, 2000))) return fail();
  return value as unknown as RevisionImpactView;
}
function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function text(v: unknown, max: number): v is string { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function path(v: unknown): v is string { return text(v, 1000) && /^(?:chapters|characters|world|outline|state|timeline|foreshadow|summaries)\/.+\.(?:md|ya?ml)$/u.test(v) && !v.split('/').some(p => !p || p === '.' || p === '..') && !/[\\\0\r\n]/u.test(v); }
function hash(v: unknown): boolean { return typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v); }
function nullableHash(v: unknown): boolean { return v === null || hash(v); }
function reportId(v: unknown): v is string { return typeof v === 'string' && /^impact-[A-Za-z0-9-]{1,100}$/u.test(v); }
function integer(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
function date(v: unknown): boolean { return typeof v === 'string' && Number.isFinite(Date.parse(v)); }
