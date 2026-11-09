import {
  assertUsageSessionId, parseAgentGovernanceHistory, parseUsageCallsProjection,
} from '@oh-awesome-novel/core/agent-usage';
import type {
  AgentGovernanceHistory, ProviderEgressSummary, UsageCallsProjection,
} from '@oh-awesome-novel/core/agent-usage';

export { projectUsageCalls, parseUsageCallsProjection, selectUsageOperation } from '@oh-awesome-novel/core/agent-usage';
export type { UsageInspectorCall, UsageCallsProjection, UsageOperation } from '@oh-awesome-novel/core/agent-usage';

export type UsageInspectorScope = { domain: 'play'; sessionId: string }
  | { domain: 'reference'; referenceId: string; runId: string };
export interface UsagePresentationInput {
  operationId: string; elapsedMs: number; unitId?: string; attemptId?: string; stepId?: string;
}
export interface UsagePresentationObservation extends UsagePresentationInput {
  schemaVersion: 1; source: 'client-observed'; observedAt: string;
}
export interface UsageInspectorEnvelope {
  schemaVersion: 1; scope: UsageInspectorScope; lens?: 'player' | 'director';
  history: AgentGovernanceHistory; projection: UsageCallsProjection;
  presentation: UsagePresentationObservation[];
}
export interface PlayUsageInspectorOptions {
  operationId?: string; attemptId?: string; stepId?: string;
  limit?: number; lens?: 'player' | 'director'; signal?: AbortSignal;
}
export interface ReferenceUsageInspectorOptions {
  operationId?: string; unitId?: string; attemptId?: string; limit?: number; signal?: AbortSignal;
}
export interface UsageProbeOptions {
  provider: ProviderEgressSummary; maxCalls: 2; syntheticOnly: true;
}
export interface UsageProbe {
  id: string; scope: UsageInspectorScope; provider: ProviderEgressSummary;
  maxCalls: 2; completedCalls: number; createdAt: string;
  status: 'ready' | 'running' | 'completed' | 'failed' | 'aborted' | 'unknown';
}
export interface UsageProbeResult {
  probe: UsageProbe; status: UsageProbe['status']; history: AgentGovernanceHistory; projection: UsageCallsProjection;
}
export interface UsageInspectorClientMethods {
  getPlayUsageInspector(sessionId: string, options?: PlayUsageInspectorOptions): Promise<UsageInspectorEnvelope>;
  getReferenceUsageInspector(referenceId: string, runId: string, options?: ReferenceUsageInspectorOptions): Promise<UsageInspectorEnvelope>;
  recordPlayUsagePresentation(sessionId: string, input: UsagePresentationInput): Promise<{ observation: UsagePresentationObservation }>;
  recordReferenceUsagePresentation(referenceId: string, runId: string, input: UsagePresentationInput): Promise<{ observation: UsagePresentationObservation }>;
  getUsageProbeOptions(): Promise<UsageProbeOptions>;
  createUsageProbe(scope: UsageInspectorScope, expected?: { expectedProviderId: string; expectedModelId: string }): Promise<UsageProbe>;
  runUsageProbe(id: string, options?: { signal?: AbortSignal }): Promise<UsageProbeResult>;
  getUsageProbe(id: string): Promise<UsageProbeResult>;
  cancelUsageProbe(id: string): Promise<{ status: UsageProbe['status'] }>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid usage inspector payload.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('Invalid usage inspector fields.');
}
function time(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid usage time.');
}
export function parseUsageInspectorScope(value: unknown): UsageInspectorScope {
  const v = record(value);
  if (v.domain === 'play') {
    keys(v, ['domain', 'sessionId']); assertUsageSessionId(v.sessionId);
    return { domain: 'play', sessionId: v.sessionId };
  }
  keys(v, ['domain', 'referenceId', 'runId']);
  if (v.domain !== 'reference') throw new Error('Unknown usage domain.');
  assertUsageSessionId(v.referenceId); assertUsageSessionId(v.runId);
  return { domain: 'reference', referenceId: v.referenceId, runId: v.runId };
}
export function parseUsagePresentationInput(value: unknown): UsagePresentationInput {
  const v = record(value); keys(v, ['operationId', 'elapsedMs'], ['unitId', 'attemptId', 'stepId']);
  for (const key of ['operationId', 'unitId', 'attemptId', 'stepId']) if (v[key] !== undefined) assertUsageSessionId(v[key]);
  if (typeof v.elapsedMs !== 'number' || !Number.isSafeInteger(v.elapsedMs) || v.elapsedMs < 0 || v.elapsedMs > 3_600_000) throw new Error('Invalid presentation duration.');
  return { operationId: v.operationId as string, elapsedMs: v.elapsedMs,
    ...(v.unitId === undefined ? {} : { unitId: v.unitId as string }),
    ...(v.attemptId === undefined ? {} : { attemptId: v.attemptId as string }),
    ...(v.stepId === undefined ? {} : { stepId: v.stepId as string }) };
}
export function parseUsagePresentation(value: unknown): UsagePresentationObservation {
  const v = record(value); keys(v, ['schemaVersion', 'source', 'observedAt', 'operationId', 'elapsedMs'], ['unitId', 'attemptId', 'stepId']);
  if (v.schemaVersion !== 1 || v.source !== 'client-observed') throw new Error('Invalid presentation source.');
  time(v.observedAt);
  const { schemaVersion: _version, source: _source, observedAt, ...input } = v;
  return { ...parseUsagePresentationInput(input), schemaVersion: 1, source: 'client-observed', observedAt };
}
function stable(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : item;
  return JSON.stringify(sort(value));
}
export function parseUsageInspectorEnvelope(value: unknown, expectedScope?: UsageInspectorScope, expected: Omit<PlayUsageInspectorOptions & ReferenceUsageInspectorOptions, 'signal'> = {}): UsageInspectorEnvelope {
  const v = record(value); keys(v, ['schemaVersion', 'scope', 'history', 'projection', 'presentation'], ['lens']);
  if (v.schemaVersion !== 1) throw new Error('Invalid usage inspector version.');
  const scope = parseUsageInspectorScope(v.scope);
  if (expectedScope && JSON.stringify(scope) !== JSON.stringify(parseUsageInspectorScope(expectedScope))) throw new Error('Usage scope mismatch.');
  if (scope.domain === 'play' ? !['player', 'director'].includes(String(v.lens)) : v.lens !== undefined) throw new Error('Invalid usage lens.');
  if (expected.lens !== undefined && v.lens !== expected.lens) throw new Error('Usage lens mismatch.');
  const history = parseAgentGovernanceHistory(v.history);
  if (history.sessionId !== (scope.domain === 'play' ? `play-${scope.sessionId}` : scope.runId)) throw new Error('Usage history identity mismatch.');
  const projection = parseUsageCallsProjection(v.projection);
  const assertRequest = (request: Extract<AgentGovernanceHistory['records'][number], { recordType: 'request' }>) => {
    const op = request.operation;
    if (!op || op.domain !== scope.domain || (scope.domain === 'play'
      ? op.sessionId !== scope.sessionId : op.referenceId !== scope.referenceId || op.runId !== scope.runId)) throw new Error('Usage call identity mismatch.');
    for (const key of ['operationId', 'attemptId', 'unitId', 'stepId'] as const) if (expected[key] !== undefined && op[key] !== expected[key]) throw new Error('Usage filter mismatch.');
    const internal = /(^|[:/])(?:\.workspace|\.git)(?:\/|$)|(^|[:/])\.oan\/(?:sessions|indexes)(?:\/|$)/u;
    if (request.sources.some(source => [source.path, source.sourceId, source.kind].some(value => value !== undefined && internal.test(value)))) throw new Error('Usage contains internal paths.');
    if (scope.domain === 'play' && v.lens === 'player' && (request.contextPackageId !== undefined || op.contextTraceId !== undefined || request.sources.some(source =>
      !/^context-\d+$/u.test(source.sourceId) || source.kind !== 'context'
      || source.path !== undefined || source.sourceHash !== undefined || source.payloadHash !== undefined || source.sourceRevision !== undefined))) throw new Error('Player usage contains source details.');
  };
  const requests = history.records.filter((item): item is Extract<AgentGovernanceHistory['records'][number], { recordType: 'request' }> => item.recordType === 'request');
  requests.forEach(assertRequest);
  for (const call of projection.calls) {
    if (!requests.some(request => call.turnId === request.turnId && call.stepIndex === request.stepIndex)) throw new Error('Usage projection has no matching request.');
    if (call.request) {
      assertRequest(call.request);
      if (!requests.some(request => stable(request) === stable(call.request))) throw new Error('Usage projection request mismatch.');
    } else if (call.status !== 'conflict') throw new Error('Usage projection is unassociated.');
    if (call.step && !history.records.some(item => item.recordType === 'step' && stable(item) === stable(call.step))) throw new Error('Usage projection step mismatch.');
  }
  if (projection.truncated !== history.truncated) throw new Error('Usage projection coverage mismatch.');
  if (!Array.isArray(v.presentation) || v.presentation.length > 100) throw new Error('Invalid presentation history.');
  const presentation = v.presentation.map(parseUsagePresentation);
  for (const observation of presentation) for (const key of ['operationId', 'unitId', 'attemptId', 'stepId'] as const) {
    if (expected[key] !== undefined && observation[key] !== expected[key]) throw new Error('Presentation filter mismatch.');
  }
  return { schemaVersion: 1, scope, history, projection, presentation,
    ...(scope.domain === 'play' ? { lens: v.lens as 'player' | 'director' } : {}) };
}
function parseProvider(value: unknown): ProviderEgressSummary {
  const v = record(value); keys(v, ['providerId', 'providerKind', 'modelId', 'status'], ['endpointOrigin']);
  for (const key of ['providerId', 'providerKind', 'modelId']) if (typeof v[key] !== 'string' || !(v[key] as string).length || (v[key] as string).length > 160 || /[\x00-\x1f\x7f]/u.test(v[key] as string)) throw new Error('Invalid probe provider.');
  if (v.status !== 'prepared') throw new Error('Invalid probe provider status.');
  if (v.endpointOrigin !== undefined) {
    if (typeof v.endpointOrigin !== 'string') throw new Error('Invalid probe endpoint.');
    const url = new URL(v.endpointOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== v.endpointOrigin) throw new Error('Invalid probe endpoint.');
  }
  return { providerId: v.providerId as string, providerKind: v.providerKind as string, modelId: v.modelId as string,
    status: 'prepared', ...(v.endpointOrigin === undefined ? {} : { endpointOrigin: v.endpointOrigin as string }) };
}
const probeStatuses = ['ready', 'running', 'completed', 'failed', 'aborted', 'unknown'];
export function parseUsageProbe(value: unknown): UsageProbe {
  const v = record(value); keys(v, ['id', 'scope', 'provider', 'maxCalls', 'completedCalls', 'createdAt', 'status']);
  assertUsageSessionId(v.id); time(v.createdAt);
  if (!v.id.startsWith('probe_') || v.maxCalls !== 2 || typeof v.completedCalls !== 'number' || !Number.isSafeInteger(v.completedCalls) || v.completedCalls < 0 || v.completedCalls > 2 || !probeStatuses.includes(String(v.status))) throw new Error('Invalid usage probe.');
  if (v.status === 'completed' && v.completedCalls !== 2) throw new Error('Incomplete probe marked completed.');
  return { id: v.id, scope: parseUsageInspectorScope(v.scope), provider: parseProvider(v.provider), maxCalls: 2,
    completedCalls: v.completedCalls, createdAt: v.createdAt, status: v.status as UsageProbe['status'] };
}
export function parseUsageProbeResult(value: unknown, id?: string): UsageProbeResult {
  const v = record(value); keys(v, ['probe', 'status', 'history', 'projection']);
  const probe = parseUsageProbe(v.probe);
  if ((id && probe.id !== id) || v.status !== probe.status) throw new Error('Usage probe identity mismatch.');
  const history = parseAgentGovernanceHistory(v.history);
  if (history.sessionId !== probe.id) throw new Error('Usage probe history mismatch.');
  const projection = parseUsageCallsProjection(v.projection);
  for (const request of [...history.records.filter(item => item.recordType === 'request'), ...projection.calls.flatMap(call => call.request ? [call.request] : [])]) {
    const operation = request.operation;
    if (!operation || operation.operationId !== probe.id || operation.stage !== 'cacheProbe' || operation.domain !== probe.scope.domain
      || (probe.scope.domain === 'play' ? operation.sessionId !== probe.scope.sessionId : operation.referenceId !== probe.scope.referenceId || operation.runId !== probe.scope.runId)) throw new Error('Probe operation mismatch.');
  }
  return { probe, status: probe.status, history, projection };
}

export function createUsageInspectorClientMethods(request: <T>(path: string, options?: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }) => Promise<T>): UsageInspectorClientMethods {
  const play = (sessionId: string) => { assertUsageSessionId(sessionId); return `/api/workspace/play-sessions/${encodeURIComponent(sessionId)}/usage`; };
  const reference = (referenceId: string, runId: string) => { assertUsageSessionId(referenceId); assertUsageSessionId(runId); return `/api/workspace/references/${encodeURIComponent(referenceId)}/deconstruction-runs/${encodeURIComponent(runId)}/usage`; };
  const query = (options: Record<string, unknown>, allowed: string[]) => {
    const params = new URLSearchParams();
    for (const key of allowed) if (options[key] !== undefined) {
      if (key === 'limit') {
        if (!Number.isSafeInteger(options[key]) || Number(options[key]) < 1 || Number(options[key]) > 100) throw new Error('Invalid usage limit.');
      } else if (key === 'lens') {
        if (!['player', 'director'].includes(String(options[key]))) throw new Error('Invalid usage lens.');
      } else assertUsageSessionId(options[key]);
      params.set(key, String(options[key]));
    }
    return params.size ? `?${params}` : '';
  };
  const probePath = (id: string) => { assertUsageSessionId(id); if (!id.startsWith('probe_')) throw new Error('Invalid probe id.'); return `/api/workspace/usage-probes/${encodeURIComponent(id)}`; };
  const presentation = async (path: string, input: UsagePresentationInput) => {
    const v = record(await request(path, { method: 'POST', body: parseUsagePresentationInput(input) })); keys(v, ['observation']);
    const observation = parseUsagePresentation(v.observation);
    for (const key of ['operationId', 'unitId', 'attemptId', 'stepId'] as const) if (observation[key] !== input[key]) throw new Error('Presentation identity mismatch.');
    return { observation };
  };
  return {
    getPlayUsageInspector: async (sessionId, options = {}) => parseUsageInspectorEnvelope(await request(play(sessionId) + query(options as Record<string, unknown>, ['operationId', 'attemptId', 'stepId', 'limit', 'lens']), { signal: options.signal }), { domain: 'play', sessionId }, { ...options, lens: options.lens ?? 'player' }),
    getReferenceUsageInspector: async (referenceId, runId, options = {}) => parseUsageInspectorEnvelope(await request(reference(referenceId, runId) + query(options as Record<string, unknown>, ['operationId', 'unitId', 'attemptId', 'limit']), { signal: options.signal }), { domain: 'reference', referenceId, runId }, options),
    recordPlayUsagePresentation: (sessionId, input) => presentation(play(sessionId) + '/presentation', input),
    recordReferenceUsagePresentation: (referenceId, runId, input) => presentation(reference(referenceId, runId) + '/presentation', input),
    getUsageProbeOptions: async () => {
      const v = record(await request('/api/workspace/usage-probes/options')); keys(v, ['provider', 'maxCalls', 'syntheticOnly']);
      if (v.maxCalls !== 2 || v.syntheticOnly !== true) throw new Error('Invalid probe bounds.');
      return { provider: parseProvider(v.provider), maxCalls: 2, syntheticOnly: true };
    },
    createUsageProbe: async (scope, expected) => {
      const selected = parseUsageInspectorScope(scope);
      const probe = parseUsageProbe(await request('/api/workspace/usage-probes', { method: 'POST', body: { scope: selected, ...expected } }));
      if (stable(probe.scope) !== stable(selected)) throw new Error('Probe scope mismatch.');
      return probe;
    },
    runUsageProbe: async (id, options = {}) => parseUsageProbeResult(await request(probePath(id) + '/run', { method: 'POST', signal: options.signal }), id),
    getUsageProbe: async id => parseUsageProbeResult(await request(probePath(id)), id),
    cancelUsageProbe: async id => {
      const v = record(await request(probePath(id) + '/cancel', { method: 'POST' })); keys(v, ['status']);
      if (!probeStatuses.includes(String(v.status))) throw new Error('Invalid probe cancellation.');
      return { status: v.status as UsageProbe['status'] };
    },
  };
}
