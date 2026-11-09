import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import {
  assertUsageSessionId, readAgentGovernanceHistory, readPlaySessionFiles,
  readReferenceDeconstructionRun,
} from '@oh-awesome-novel/core';
import {
  parseAgentGovernanceHistory, projectUsageCalls, usageSourceKey, isUsageSourcePath, USAGE_ESTIMATOR,
} from '@oh-awesome-novel/core/agent-usage';
import type {
  AgentGovernanceHistory, ModelRequestUsageRecord, ProviderEgressSummary, UsageCallFilter, UsageSourceEvidence,
} from '@oh-awesome-novel/core/agent-usage';
import type { LlmProviderConfig, PlayContextSourceTrace } from '@oh-awesome-novel/core';
import { createProviderEgressSummary, runUsageCacheProbeCall } from '@oh-awesome-novel/agent';
import type { AiSdkProviderResolver } from '@oh-awesome-novel/agent';

type Scope = { domain: 'play'; sessionId: string }
  | { domain: 'reference'; referenceId: string; runId: string };
interface PresentationInput { operationId: string; elapsedMs: number; unitId?: string; attemptId?: string; stepId?: string }
interface Presentation extends PresentationInput { schemaVersion: 1; source: 'client-observed'; observedAt: string }
interface Probe {
  id: string; scope: Scope; provider: ProviderEgressSummary; maxCalls: 2; completedCalls: number;
  createdAt: string; status: 'ready' | 'running' | 'completed' | 'failed' | 'aborted' | 'unknown';
}
interface Options {
  getWorkspaceRoot(): string;
  getModelRuntime(): Promise<{ providerConfig: LlmProviderConfig; resolveModel: AiSdkProviderResolver }>;
}
const MAX_SMALL_FILE = 16 * 1024;
const PROBE_CALL_DEADLINE_MS = 60_000;

/** Trace evidence describes inclusion, not an exact token attribution to individual sources. */
export function playUsageSources(sources: readonly PlayContextSourceTrace[]): UsageSourceEvidence[] {
  return sources.map(source => ({
    sourceId: `play-source-${createHash('sha256').update(`${source.sourceId}\0${source.path ?? ''}`).digest('hex').slice(0, 24)}`,
    kind: 'play-context', ...(isUsageSourcePath(source.path) ? { path: source.path } : {}),
    ...(source.actualContentHash ? { sourceHash: source.actualContentHash } : {}),
    budgetLayer: source.budgetLayer, semanticBoundary: source.semanticBoundary,
    outcome: source.semanticBoundary === 'excluded' ? 'excluded' : source.outcome,
    reason: source.outcome === 'selected' ? 'selected' : ['sourceCountLimit', 'excerptCharacterLimit'].includes(source.omissionReason ?? '') ? 'context-window' : 'policy',
    modelVisibleChars: source.outcome === 'selected' && source.semanticBoundary !== 'excluded' ? source.selectedCharacterCount ?? 0 : 0,
    estimatedTokens: 0, estimator: USAGE_ESTIMATOR, attribution: 'derived',
  }));
}

class UsageRequestError extends Error {
  readonly status: 400 | 404 | 409 | 422;
  constructor(status: 400 | 404 | 409 | 422, message: string) { super(message); this.status = status; }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UsageRequestError(400, 'Expected an object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new UsageRequestError(400, 'Unknown or missing usage fields.');
}
function id(value: unknown): string { try { assertUsageSessionId(value); return value; } catch { throw new UsageRequestError(400, 'Invalid usage identity.'); } }
function scope(value: unknown): Scope {
  const v = record(value);
  if (v.domain === 'play') { keys(v, ['domain', 'sessionId']); return { domain: 'play', sessionId: id(v.sessionId) }; }
  keys(v, ['domain', 'referenceId', 'runId']);
  if (v.domain !== 'reference') throw new UsageRequestError(400, 'Unknown usage domain.');
  return { domain: 'reference', referenceId: id(v.referenceId), runId: id(v.runId) };
}
function usageSession(scope: Scope): string { return scope.domain === 'play' ? id(`play-${scope.sessionId}`) : scope.runId; }
function filterFor(scope: Scope): UsageCallFilter {
  return scope.domain === 'play' ? { domain: 'play', sessionId: scope.sessionId }
    : { domain: 'reference', referenceId: scope.referenceId, runId: scope.runId };
}
function presentationInput(value: unknown): PresentationInput {
  const v = record(value); keys(v, ['operationId', 'elapsedMs'], ['unitId', 'attemptId', 'stepId']);
  if (typeof v.elapsedMs !== 'number' || !Number.isSafeInteger(v.elapsedMs) || v.elapsedMs < 0 || v.elapsedMs > 3_600_000) throw new UsageRequestError(400, 'Invalid presentation duration.');
  return { operationId: id(v.operationId), elapsedMs: v.elapsedMs,
    ...(v.unitId === undefined ? {} : { unitId: id(v.unitId) }),
    ...(v.attemptId === undefined ? {} : { attemptId: id(v.attemptId) }),
    ...(v.stepId === undefined ? {} : { stepId: id(v.stepId) }) };
}
function parsePresentation(value: unknown): Presentation {
  const v = record(value); keys(v, ['schemaVersion', 'source', 'observedAt', 'operationId', 'elapsedMs'], ['unitId', 'attemptId', 'stepId']);
  if (v.schemaVersion !== 1 || v.source !== 'client-observed' || typeof v.observedAt !== 'string'
    || !Number.isFinite(Date.parse(v.observedAt)) || new Date(v.observedAt).toISOString() !== v.observedAt) throw new Error('Invalid presentation observation.');
  const { schemaVersion: _version, source: _source, observedAt, ...input } = v;
  return { ...presentationInput(input), schemaVersion: 1, source: 'client-observed', observedAt };
}
async function body(context: Context): Promise<unknown> {
  const reader = context.req.raw.body?.getReader();
  if (!reader) throw new UsageRequestError(400, 'A request body is required.');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_SMALL_FILE) { await reader.cancel(); throw new UsageRequestError(400, 'Usage request is too large.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new UsageRequestError(400, 'Invalid usage JSON.'); }
}
async function safeDirectory(root: string, segments: string[], create: boolean): Promise<string> {
  let path = await realpath(root);
  for (const part of ['.workspace', ...segments]) {
    if (!part || part.includes('/') || part.includes('\\') || part === '.' || part === '..') throw new Error('Unsafe telemetry directory.');
    path = join(path, part);
    if (create) try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe telemetry directory.');
  }
  return path;
}
async function readSmallJson(path: string): Promise<unknown | undefined> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_SMALL_FILE) throw new Error('Unsafe telemetry file.');
    const raw = await handle.readFile('utf8');
    if (Buffer.byteLength(raw) > MAX_SMALL_FILE) throw new Error('Oversized telemetry file.');
    return JSON.parse(raw);
  } finally { await handle.close(); }
}
async function writeNewJson(path: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw) > MAX_SMALL_FILE) throw new Error('Oversized telemetry record.');
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
}
function playerRequest(request: ModelRequestUsageRecord): ModelRequestUsageRecord {
  const refs = new Map<string, string>();
  const sources = request.sources.map((source, index) => {
    const sourceId = `context-${index + 1}`; refs.set(usageSourceKey(source), sourceId);
    const { path: _path, sourceHash: _sourceHash, payloadHash: _payloadHash, sourceRevision: _revision, ...safe } = source;
    return { ...safe, sourceId, kind: 'context' };
  });
  const { contextPackageId: _contextId, ...safe } = request;
  if (safe.operation) {
    const { contextTraceId: _trace, ...operation } = safe.operation;
    safe.operation = { ...operation, stage: ['world', 'actor', 'referee', 'compaction', 'cacheProbe'].includes(operation.stage) ? operation.stage : 'model' };
  }
  return { ...safe, sources, request: { ...request.request, messages: request.request.messages.map(message => ({ ...message, sourceRefs: message.sourceRefs.map(ref => refs.get(ref)!).filter(Boolean) })) } };
}
function internalUsagePath(value: string): boolean {
  return /(^|[:/])(?:\.workspace|\.git)(?:\/|$)|(^|[:/])\.oan\/(?:sessions|indexes)(?:\/|$)/u.test(value);
}
function inspectorRequest(request: ModelRequestUsageRecord, lens?: 'player' | 'director'): ModelRequestUsageRecord {
  const refs = new Map<string, string>();
  const sources = request.sources.map(source => {
    const safe = { ...source };
    if (safe.path && internalUsagePath(safe.path)) delete safe.path;
    if (internalUsagePath(safe.sourceId)) safe.sourceId = `source-${createHash('sha256').update(safe.sourceId).digest('hex').slice(0, 24)}`;
    if (internalUsagePath(safe.kind)) safe.kind = 'context';
    refs.set(usageSourceKey(source), usageSourceKey(safe));
    return safe;
  });
  const safe = { ...request, sources, request: { ...request.request, messages: request.request.messages.map(message => ({ ...message, sourceRefs: message.sourceRefs.map(ref => refs.get(ref)!).filter(Boolean) })) } };
  return lens === 'player' ? playerRequest(safe) : safe;
}
function scopedHistory(history: AgentGovernanceHistory, filter: UsageCallFilter, lens?: 'player' | 'director'): AgentGovernanceHistory {
  const requests = history.records.filter((item): item is ModelRequestUsageRecord => item.recordType === 'request' && !!item.operation
    && Object.entries(filter).every(([key, expected]) => expected === undefined || item.operation![key as keyof typeof item.operation] === expected));
  const identities = new Set(requests.map(item => `${item.turnId}.${item.stepIndex}`));
  return parseAgentGovernanceHistory({ ...history, records: history.records.filter(item =>
    item.recordType === 'request' ? requests.includes(item) : item.recordType === 'step' && identities.has(`${item.turnId}.${item.stepIndex}`)).map(item =>
    item.recordType === 'request' ? inspectorRequest(item, lens) : item) });
}
async function readPresentations(root: string, sessionId: string, filter: UsageCallFilter): Promise<Presentation[]> {
  let directory: string;
  try { directory = await safeDirectory(root, ['sessions', sessionId, 'presentation'], false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const entries = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).slice(0, 1000);
  const observations: Presentation[] = [];
  for (const name of entries) {
    try {
      const value = parsePresentation(await readSmallJson(join(directory, name)));
      if (['operationId', 'unitId', 'attemptId', 'stepId'].every(key => filter[key as keyof UsageCallFilter] === undefined || value[key as keyof Presentation] === filter[key as keyof UsageCallFilter])) observations.push(value);
    } catch { /* Incomplete disposable telemetry never becomes a model timing. */ }
  }
  return observations.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 100);
}

// Make room for current observations in long sessions. Only disposable,
// generated receipt filenames in this session's telemetry directory qualify.
async function retainRecentPresentations(directory: string) {
  const names = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
  if (names.length < 1000) return;
  const entries = await Promise.all(names.map(async name => {
    const path = join(directory, name);
    const file = await lstat(path).catch(() => undefined);
    return file?.isFile() && file.nlink === 1 ? { path, time: file.mtimeMs } : undefined;
  }));
  const ordered = entries.filter(entry => entry !== undefined).sort((a, b) => a.time - b.time);
  for (const entry of ordered.slice(0, Math.max(0, ordered.length - 900))) {
    try { await unlink(entry.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export function createUsageInspectorHandlers(options: Options) {
  const activeProbes = new Map<string, AbortController>();
  const probeKey = (root: string, probeId: string) => `${root}\0${probeId}`;
  function unchanged(root: string) { if (options.getWorkspaceRoot() !== root) throw new UsageRequestError(409, 'Workspace changed; reopen the inspector.'); }
  async function validateScope(root: string, selected: Scope) {
    if (selected.domain === 'play') await readPlaySessionFiles(root, selected.sessionId);
    else await readReferenceDeconstructionRun(root, selected.referenceId, selected.runId, { reconcile: false });
    unchanged(root);
  }
  const respond = async (context: Context, fn: () => Promise<unknown>) => {
    try { return context.json(await fn()); }
    catch (error) {
      const status = error instanceof UsageRequestError ? error.status : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 422;
      return context.json({ error: error instanceof UsageRequestError ? error.message : 'Usage information is unavailable.', code: 'usage_unavailable' }, status);
    }
  };
  async function envelope(root: string, selected: Scope, filter: UsageCallFilter, limit = 100, lens?: 'player' | 'director') {
    const raw = await readAgentGovernanceHistory(root, usageSession(selected), limit);
    const history = scopedHistory(raw, filter, lens);
    const projection = projectUsageCalls(raw, filter);
    projection.calls = projection.calls.map(call => ({ ...call, ...(call.request ? { request: inspectorRequest(call.request, lens) } : {}) }));
    const presentation = await readPresentations(root, usageSession(selected), filter);
    unchanged(root);
    return { schemaVersion: 1 as const, scope: selected, ...(lens ? { lens } : {}), history, projection, presentation };
  }
  async function readProbe(root: string, probeId: string): Promise<Probe> {
    if (!/^probe_[a-f0-9-]{36}$/u.test(probeId)) throw new UsageRequestError(400, 'Invalid probe id.');
    const directory = await safeDirectory(root, ['usage-probes'], false);
    const raw = await readSmallJson(join(directory, `${probeId}.json`));
    if (!raw) throw new UsageRequestError(404, 'Probe not found.');
    const value = record(raw); keys(value, ['id', 'scope', 'provider', 'maxCalls', 'completedCalls', 'createdAt', 'status']);
    if (value.id !== probeId || value.maxCalls !== 2 || value.completedCalls !== 0 || value.status !== 'ready' || typeof value.createdAt !== 'string') throw new Error('Invalid probe plan.');
    const savedScope = scope(value.scope);
    const plan = value as unknown as Probe;
    const provider = record(plan.provider); keys(provider, ['providerId', 'providerKind', 'modelId', 'status'], ['endpointOrigin']);
    if (provider.status !== 'prepared' || ['providerId', 'providerKind', 'modelId'].some(key => typeof provider[key] !== 'string')) throw new Error('Invalid probe model.');
    const receipt = await readSmallJson(join(directory, `${probeId}.result.json`));
    if (receipt !== undefined) {
      const r = record(receipt); keys(r, ['status', 'completedCalls']);
      if (!['completed', 'failed', 'aborted'].includes(String(r.status)) || typeof r.completedCalls !== 'number' || !Number.isSafeInteger(r.completedCalls) || r.completedCalls < 0 || r.completedCalls > 2 || (r.status === 'completed' && r.completedCalls !== 2)) throw new Error('Invalid probe receipt.');
      return { ...plan, scope: savedScope, status: r.status as Probe['status'], completedCalls: r.completedCalls };
    }
    const claim = await readSmallJson(join(directory, `${probeId}.claim.json`));
    return { ...plan, scope: savedScope, status: claim !== undefined ? activeProbes.has(probeKey(root, probeId)) ? 'running' : 'unknown' : 'ready' };
  }
  async function probeResult(root: string, probeId: string) {
    const probe = await readProbe(root, probeId);
    const history = await readAgentGovernanceHistory(root, probeId, 100);
    unchanged(root);
    return { probe, status: probe.status, history, projection: projectUsageCalls(history, { operationId: probeId }) };
  }
  return {
    inspect(context: Context, selectedInput: Scope) {
      return respond(context, async () => {
        const selected = scope(selectedInput); const root = options.getWorkspaceRoot();
        const query = new URL(context.req.url).searchParams;
        const allowed = selected.domain === 'play' ? ['operationId', 'attemptId', 'stepId', 'limit', 'lens'] : ['operationId', 'unitId', 'attemptId', 'limit'];
        if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) throw new UsageRequestError(400, 'Invalid usage query.');
        const limit = query.has('limit') ? Number(query.get('limit')) : 100;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new UsageRequestError(400, 'Usage limit must be 1–100.');
        const lens = selected.domain === 'play' ? query.get('lens') ?? 'player' : undefined;
        if (lens !== undefined && lens !== 'player' && lens !== 'director') throw new UsageRequestError(400, 'Invalid usage lens.');
        const filter = filterFor(selected);
        for (const key of ['operationId', 'unitId', 'attemptId', 'stepId'] as const) if (query.has(key)) filter[key] = id(query.get(key));
        await validateScope(root, selected);
        return envelope(root, selected, filter, limit, lens);
      });
    },
    presentation(context: Context, selectedInput: Scope) {
      return respond(context, async () => {
        const root = options.getWorkspaceRoot(); const selected = scope(selectedInput); const input = presentationInput(await body(context));
        await validateScope(root, selected);
        const { elapsedMs: _elapsed, ...identity } = input;
        const filter = { ...filterFor(selected), ...identity };
        const history = await readAgentGovernanceHistory(root, usageSession(selected), 100);
        if (!projectUsageCalls(history, filter).calls.length) throw new UsageRequestError(409, 'The model call is not available yet; record visibility after the operation finishes.');
        const directory = await safeDirectory(root, ['sessions', usageSession(selected), 'presentation'], true);
        const name = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
        const path = join(directory, `${name}.json`);
        const existing = await readSmallJson(path);
        if (existing) return { observation: parsePresentation(existing) };
        await retainRecentPresentations(directory);
        const observation: Presentation = { ...input, schemaVersion: 1, source: 'client-observed', observedAt: new Date().toISOString() };
        unchanged(root);
        try { await writeNewJson(path, observation); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return { observation: parsePresentation(await readSmallJson(path)) }; }
        return { observation };
      });
    },
    probeOptions(context: Context) {
      return respond(context, async () => {
        const root = options.getWorkspaceRoot();
        const { providerConfig } = await options.getModelRuntime();
        unchanged(root);
        return { provider: createProviderEgressSummary(providerConfig), maxCalls: 2, syntheticOnly: true };
      });
    },
    createProbe(context: Context) {
      return respond(context, async () => {
        const root = options.getWorkspaceRoot(); const input = record(await body(context));
        keys(input, ['scope'], ['expectedProviderId', 'expectedModelId']);
        const selected = scope(input.scope); await validateScope(root, selected);
        const { providerConfig } = await options.getModelRuntime(); unchanged(root);
        const provider = createProviderEgressSummary(providerConfig);
        if ((input.expectedProviderId !== undefined && input.expectedProviderId !== provider.providerId)
          || (input.expectedModelId !== undefined && input.expectedModelId !== provider.modelId)) throw new UsageRequestError(409, 'Model configuration changed; review it before starting.');
        const directory = await safeDirectory(root, ['usage-probes'], true);
        if ((await readdir(directory)).length >= 3000) throw new UsageRequestError(422, 'Probe history reached its limit.');
        const probe: Probe = { id: `probe_${randomUUID()}`, scope: selected, provider, maxCalls: 2, completedCalls: 0, createdAt: new Date().toISOString(), status: 'ready' };
        await writeNewJson(join(directory, `${probe.id}.json`), probe);
        return probe;
      });
    },
    getProbe(context: Context, probeId: string) { return respond(context, () => probeResult(options.getWorkspaceRoot(), id(probeId))); },
    runProbe(context: Context, probeId: string) {
      return respond(context, async () => {
        const root = options.getWorkspaceRoot(); const probe = await readProbe(root, id(probeId));
        if (['completed', 'failed', 'aborted'].includes(probe.status)) return probeResult(root, probeId);
        if (probe.status !== 'ready') throw new UsageRequestError(409, 'Probe already started; an unknown call is never replayed.');
        await validateScope(root, probe.scope);
        const runtime = await options.getModelRuntime(); unchanged(root);
        if (JSON.stringify(createProviderEgressSummary(runtime.providerConfig)) !== JSON.stringify(probe.provider)) throw new UsageRequestError(409, 'Model configuration changed; create a new reviewed probe.');
        const directory = await safeDirectory(root, ['usage-probes'], false);
        const controller = new AbortController(); const key = probeKey(root, probeId);
        if (activeProbes.has(key)) throw new UsageRequestError(409, 'Probe is already running.');
        activeProbes.set(key, controller);
        const onAbort = () => controller.abort(context.req.raw.signal.reason);
        context.req.raw.signal.addEventListener('abort', onAbort, { once: true });
        let claimed = false; let completedCalls = 0; let status: 'completed' | 'failed' | 'aborted' = 'failed';
        try {
          await writeNewJson(join(directory, `${probeId}.claim.json`), { pid: process.pid, startedAt: new Date().toISOString() });
          claimed = true;
          if (context.req.raw.signal.aborted) onAbort();
          for (let index = 0; index < 2; index++) {
            controller.signal.throwIfAborted(); unchanged(root);
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PROBE_CALL_DEADLINE_MS)]);
            const operation = probe.scope.domain === 'play'
              ? { domain: 'play' as const, sessionId: probe.scope.sessionId }
              : { domain: 'reference' as const, referenceId: probe.scope.referenceId, runId: probe.scope.runId };
            const result = await runUsageCacheProbeCall({
              ...runtime, workspaceRoot: root, usageSessionId: probeId,
              usageOperation: { ...operation, operationId: probeId, stage: 'cacheProbe', unitId: `sample-${index + 1}` }, abortSignal: signal,
            });
            if (result.outcome !== 'completed') { status = result.outcome; break; }
            completedCalls++;
          }
          if (completedCalls === 2) status = 'completed';
          else if (controller.signal.aborted) status = 'aborted';
        } catch (error) {
          if (!claimed && (error as NodeJS.ErrnoException).code === 'EEXIST') throw new UsageRequestError(409, 'Probe already started; reload its result.');
          status = controller.signal.aborted ? 'aborted' : 'failed';
        } finally {
          activeProbes.delete(key); context.req.raw.signal.removeEventListener('abort', onAbort);
          if (claimed) await writeNewJson(join(directory, `${probeId}.result.json`), { status, completedCalls });
        }
        return probeResult(root, probeId);
      });
    },
    cancelProbe(context: Context, probeId: string) {
      return respond(context, async () => {
        const root = options.getWorkspaceRoot(); const probe = await readProbe(root, id(probeId));
        const active = activeProbes.get(probeKey(root, probeId));
        if (active) { active.abort('user'); return { status: 'running' }; }
        if (probe.status === 'ready') {
          const directory = await safeDirectory(root, ['usage-probes'], false);
          try {
            await writeNewJson(join(directory, `${probeId}.claim.json`), { pid: process.pid, startedAt: new Date().toISOString() });
            await writeNewJson(join(directory, `${probeId}.result.json`), { status: 'aborted', completedCalls: 0 });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        return { status: (await readProbe(root, probeId)).status };
      });
    },
  };
}
