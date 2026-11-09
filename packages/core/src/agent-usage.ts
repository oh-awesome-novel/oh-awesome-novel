/** Pure, browser-safe usage contracts. No provider payloads or narrative content. */
export const USAGE_ESTIMATOR = 'utf8-bytes-div-3-v1' as const;
export const USAGE_MAX_RECORDS = 100;
export const USAGE_MAX_SOURCES = 10_000;
export const USAGE_TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const;
export type UsageTokenField = typeof USAGE_TOKEN_FIELDS[number];
export type NormalizedModelUsage = { availability: 'actual' | 'partial' | 'unavailable' } & Partial<Record<UsageTokenField, number>>;
export interface UsageSourceEvidence {
  sourceId: string;
  kind: string;
  path?: string;
  sourceHash?: string;
  payloadHash?: string;
  sourceRevision?: string;
  budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
  semanticBoundary: 'protected' | 'compressible' | 'excluded';
  outcome: 'selected' | 'compressed' | 'omitted' | 'excluded';
  reason: 'selected' | 'context-window' | 'budget' | 'policy' | 'tool-result' | 'declared-only';
  originalChars?: number;
  modelVisibleChars: number;
  estimatedTokens: number;
  estimator: typeof USAGE_ESTIMATOR;
  /** Tool reads may influence an excerpt/command output; not an exact byte attribution. */
  attribution?: 'exact' | 'derived';
}
export interface UsageBudget {
  status: 'unknown' | 'within' | 'overflow';
  inputTokens?: number;
  estimatedRequestTokens: number;
}
export interface ProviderEgressSummary {
  providerId: string;
  providerKind: string;
  modelId: string;
  endpointOrigin?: string;
  status: 'prepared';
}
export interface UsageMessageStats {
  index: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  chars: number;
  estimatedTokens: number;
  sourceRefs: string[];
}
export interface ModelRequestStats {
  messageCount: number;
  messages: UsageMessageStats[];
  estimatedMessageTokens: number;
  estimatedRequestTokens: number;
  toolCount: number;
  estimator: typeof USAGE_ESTIMATOR;
  estimationScope: 'messages-tools-json-with-20-percent-margin';
}
export interface UsageRequestMetadata {
  contextPackageId?: string;
  sources: UsageSourceEvidence[];
  budget: UsageBudget;
  egress?: ProviderEgressSummary;
  operation?: UsageOperation;
  fingerprint?: UsageRequestFingerprint;
}
/** Host-assigned correlation only. Never derive these ids from model output. */
export interface UsageOperation {
  domain: 'play' | 'reference';
  operationId: string;
  stage: string;
  sessionId?: string;
  referenceId?: string;
  runId?: string;
  unitId?: string;
  attemptId?: string;
  stepId?: string;
  contextTraceId?: string;
}
export interface UsageRequestFingerprint {
  prefixHash: string;
  prefixKind: 'frozen-system' | 'system-messages';
  toolSchemaHash: string;
}
export interface UsageCallTiming {
  startedAt: string;
  completedAt: string;
  /** First streaming payload observed by the adapter, not UI paint or a guessed TTFT. */
  firstResponseAt?: string;
}
interface UsageRecordBase {
  schemaVersion: 1;
  turnId: string;
  sessionId?: string;
  createdAt: string;
}
export interface ModelRequestUsageRecord extends UsageRecordBase, UsageRequestMetadata {
  recordType: 'request';
  stepIndex: number;
  request: ModelRequestStats;
}
export interface ModelStepUsageRecord extends UsageRecordBase {
  recordType: 'step';
  stepIndex: number;
  actualUsage: NormalizedModelUsage;
  outcome: 'completed' | 'failed' | 'aborted';
  finishReason?: string;
  timing?: UsageCallTiming;
}
export interface TurnUsageSummary extends UsageRecordBase {
  recordType: 'turn';
  stepCount: number;
  estimatedMessageTokens: number;
  estimatedRequestTokens: number;
  actualUsage: NormalizedModelUsage;
  actualCoverage: 'complete' | 'partial' | 'unavailable';
  fieldCoverage: Record<UsageTokenField, number>;
  outcome: 'completed' | 'failed' | 'aborted' | 'max_tool_loops';
}
export type AgentUsageRecord = ModelRequestUsageRecord | ModelStepUsageRecord | TurnUsageSummary;
export interface AgentGovernanceHistory {
  schemaVersion: 1;
  sessionId: string;
  records: AgentUsageRecord[];
  truncated: boolean;
  diagnostics: Array<'missing' | 'truncated-tail' | 'invalid-record' | 'read-failed' | 'size-limit'>;
}
export function estimateTextTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).byteLength / 3);
}
export function normalizeModelUsage(value?: Partial<Record<UsageTokenField, unknown>>): NormalizedModelUsage {
  const result: NormalizedModelUsage = { availability: 'unavailable' };
  for (const key of USAGE_TOKEN_FIELDS) {
    const count = value?.[key];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) result[key] = count;
  }
  result.availability = ['inputTokens', 'outputTokens', 'totalTokens'].every((key) => result[key as UsageTokenField] !== undefined)
    ? 'actual' : USAGE_TOKEN_FIELDS.some((key) => result[key] !== undefined) ? 'partial' : 'unavailable';
  return result;
}
export function aggregateModelUsage(usages: NormalizedModelUsage[]): {
  actualUsage: NormalizedModelUsage; actualCoverage: TurnUsageSummary['actualCoverage']; fieldCoverage: Record<UsageTokenField, number>;
} {
  const sums: Partial<Record<UsageTokenField, number>> = {};
  const fieldCoverage = Object.fromEntries(USAGE_TOKEN_FIELDS.map((key) => [key, 0])) as Record<UsageTokenField, number>;
  for (const usage of usages) for (const key of USAGE_TOKEN_FIELDS) {
    if (usage[key] !== undefined) { sums[key] = (sums[key] ?? 0) + usage[key]; fieldCoverage[key]++; }
  }
  const actualCoverage = usages.length > 0 && usages.every((usage) => usage.availability === 'actual')
    ? 'complete' : usages.some((usage) => usage.availability !== 'unavailable') ? 'partial' : 'unavailable';
  const actualUsage = normalizeModelUsage(sums);
  if (actualCoverage === 'partial') actualUsage.availability = 'partial';
  return { actualUsage, actualCoverage, fieldCoverage };
}
export function safeEndpointOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined; }
  catch { return undefined; }
}
export function assertUsageSessionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) || value.includes('..')) throw new Error('Invalid usage session id.');
}
export function isUsageSourcePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && value.normalize('NFC') === value
    && !/[\\:\x00-\x1f\x7f]/u.test(value) && !value.split('/').some((p) => !p || p === '.' || p === '..');
}
export function usageSourceKey(source: Pick<UsageSourceEvidence, 'sourceId' | 'path'>): string {
  return source.path ? `${source.sourceId}:${source.path}` : source.sourceId;
}
export function parseAgentUsageRecord(value: unknown): AgentUsageRecord {
  const v = record(value);
  const base = ['schemaVersion', 'recordType', 'turnId', 'createdAt'];
  if (v.schemaVersion !== 1) fail();
  assertUsageSessionId(v.turnId);
  if (v.sessionId !== undefined) assertUsageSessionId(v.sessionId);
  timestamp(v.createdAt);
  if (v.recordType === 'request') {
    keys(v, [...base, 'stepIndex', 'request', 'sources', 'budget'], ['sessionId', 'contextPackageId', 'egress', 'operation', 'fingerprint']);
    integer(v.stepIndex); parseRequest(v.request); array(v.sources, USAGE_MAX_SOURCES).forEach(parseSource);
    if (v.contextPackageId !== undefined) assertUsageSessionId(v.contextPackageId);
    if (v.operation !== undefined) parseUsageOperation(v.operation);
    if (v.fingerprint !== undefined) parseUsageRequestFingerprint(v.fingerprint);
    const b = record(v.budget); keys(b, ['status', 'estimatedRequestTokens'], ['inputTokens']);
    enumeration(b.status, ['unknown', 'within', 'overflow']); integer(b.estimatedRequestTokens);
    if (b.status === 'unknown') { if (b.inputTokens !== undefined) fail(); } else {
      integer(b.inputTokens);
      if ((b.status === 'overflow') !== ((b.estimatedRequestTokens as number) > (b.inputTokens as number))) fail();
    }
    if (b.estimatedRequestTokens !== record(v.request).estimatedRequestTokens) fail();
    const sourceKeys = new Set((v.sources as UsageSourceEvidence[]).map(usageSourceKey));
    if ((record(v.request).messages as UsageMessageStats[]).some((message) => message.sourceRefs.some((ref) => !sourceKeys.has(ref)))) fail();
    if (v.egress !== undefined) {
      const e = record(v.egress); keys(e, ['providerId', 'providerKind', 'modelId', 'status'], ['endpointOrigin']);
      [e.providerId, e.providerKind, e.modelId].forEach(label);
      if (e.status !== 'prepared') fail();
      if (e.endpointOrigin !== undefined && (typeof e.endpointOrigin !== 'string' || safeEndpointOrigin(e.endpointOrigin) !== e.endpointOrigin)) fail();
    }
  } else if (v.recordType === 'step') {
    keys(v, [...base, 'stepIndex', 'actualUsage', 'outcome'], ['sessionId', 'finishReason', 'timing']);
    integer(v.stepIndex); parseUsage(v.actualUsage); enumeration(v.outcome, ['completed', 'failed', 'aborted']);
    if (v.finishReason !== undefined) label(v.finishReason);
    if (v.timing !== undefined) parseUsageCallTiming(v.timing);
  } else if (v.recordType === 'turn') {
    keys(v, [...base, 'stepCount', 'estimatedMessageTokens', 'estimatedRequestTokens', 'actualUsage', 'actualCoverage', 'fieldCoverage', 'outcome'], ['sessionId']);
    integer(v.stepCount); integer(v.estimatedMessageTokens); integer(v.estimatedRequestTokens);
    parseUsage(v.actualUsage, true); enumeration(v.actualCoverage, ['complete', 'partial', 'unavailable']);
    enumeration(v.outcome, ['completed', 'failed', 'aborted', 'max_tool_loops']);
    const coverage = record(v.fieldCoverage); keys(coverage, [...USAGE_TOKEN_FIELDS]);
    for (const key of USAGE_TOKEN_FIELDS) { integer(coverage[key]); if ((coverage[key] as number) > (v.stepCount as number)) fail(); }
    const usage = v.actualUsage as NormalizedModelUsage;
    if ((v.actualCoverage === 'unavailable') !== (usage.availability === 'unavailable')
      || (v.actualCoverage === 'complete' && usage.availability !== 'actual')
      || (v.actualCoverage === 'partial' && usage.availability !== 'partial')) fail();
    for (const key of USAGE_TOKEN_FIELDS) if ((coverage[key] === 0) !== (usage[key] === undefined)) fail();
    if (v.actualCoverage === 'complete' && (!v.stepCount || ['inputTokens', 'outputTokens', 'totalTokens'].some((k) => coverage[k] !== v.stepCount))) fail();
  } else fail();
  return cloneValidatedContract(v) as AgentUsageRecord;
}
export function parseAgentGovernanceHistory(value: unknown): AgentGovernanceHistory {
  const v = record(value); keys(v, ['schemaVersion', 'sessionId', 'records', 'truncated', 'diagnostics']);
  if (v.schemaVersion !== 1 || typeof v.truncated !== 'boolean') fail();
  assertUsageSessionId(v.sessionId);
  const records = array(v.records, USAGE_MAX_RECORDS).map(parseAgentUsageRecord);
  if (records.some((r) => r.sessionId !== v.sessionId)) fail();
  array(v.diagnostics, 8).forEach((d) => enumeration(d, ['missing', 'truncated-tail', 'invalid-record', 'read-failed', 'size-limit']));
  return { schemaVersion: 1, sessionId: v.sessionId, records, truncated: v.truncated, diagnostics: v.diagnostics as AgentGovernanceHistory['diagnostics'] };
}
export function parseUsageOperation(value: unknown): UsageOperation {
  const v = record(value);
  const optional = ['sessionId', 'referenceId', 'runId', 'unitId', 'attemptId', 'stepId', 'contextTraceId'];
  keys(v, ['domain', 'operationId', 'stage'], optional);
  enumeration(v.domain, ['play', 'reference']); assertUsageSessionId(v.operationId); label(v.stage);
  for (const key of optional) if (v[key] !== undefined) assertUsageSessionId(v[key]);
  if (v.domain === 'play') {
    if (v.sessionId === undefined || v.referenceId !== undefined) fail();
  } else if (v.referenceId === undefined || v.runId === undefined || v.sessionId !== undefined) fail();
  return cloneValidatedContract(v) as UsageOperation;
}
export function parseUsageRequestFingerprint(value: unknown): UsageRequestFingerprint {
  const v = record(value); keys(v, ['prefixHash', 'prefixKind', 'toolSchemaHash']);
  for (const key of ['prefixHash', 'toolSchemaHash']) if (typeof v[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(v[key] as string)) fail();
  enumeration(v.prefixKind, ['frozen-system', 'system-messages']);
  return cloneValidatedContract(v) as UsageRequestFingerprint;
}
export function parseUsageCallTiming(value: unknown): UsageCallTiming {
  const v = record(value); keys(v, ['startedAt', 'completedAt'], ['firstResponseAt']);
  timestamp(v.startedAt); timestamp(v.completedAt);
  if (Date.parse(v.completedAt as string) < Date.parse(v.startedAt as string)) fail();
  if (v.firstResponseAt !== undefined) {
    timestamp(v.firstResponseAt);
    if (Date.parse(v.firstResponseAt as string) < Date.parse(v.startedAt as string)
      || Date.parse(v.firstResponseAt as string) > Date.parse(v.completedAt as string)) fail();
  }
  return cloneValidatedContract(v) as UsageCallTiming;
}
export function parseUsageSourceEvidence(value: unknown): UsageSourceEvidence {
  parseSource(value);
  return cloneValidatedContract(value) as UsageSourceEvidence;
}

export interface UsageInspectorCall {
  id: string;
  turnId: string;
  stepIndex: number;
  status: 'pending' | 'completed' | 'failed' | 'aborted' | 'conflict';
  request?: ModelRequestUsageRecord;
  step?: ModelStepUsageRecord;
  fingerprintChange: {
    status: 'first-observed' | 'unchanged' | 'changed' | 'unavailable';
    reasons: Array<'prefix' | 'tools' | 'prefix-kind'>;
    comparedWith?: string;
  };
}
export type UsageCallFilter = Partial<Pick<UsageOperation, 'domain' | 'operationId' | 'sessionId' | 'referenceId' | 'runId' | 'unitId' | 'attemptId' | 'stepId'>>;
export const USAGE_PROJECTION_DIAGNOSTICS = ['missing', 'truncated-tail', 'invalid-record', 'read-failed', 'size-limit', 'duplicate-records', 'conflicting-records', 'unmatched-records'] as const;
export interface UsageCallsProjection {
  schemaVersion: 1;
  calls: UsageInspectorCall[];
  totals: ReturnType<typeof aggregateModelUsage> & { callCount: number; reportedCalls: number };
  truncated: boolean;
  diagnostics: Array<typeof USAGE_PROJECTION_DIAGNOSTICS[number]>;
}

/** Sum each physical step once. Turn summaries are deliberately never added again. */
export function projectUsageCalls(value: AgentGovernanceHistory, filter: UsageCallFilter = {}): UsageCallsProjection {
  const history = parseAgentGovernanceHistory(value);
  const filterRecord = record(filter);
  keys(filterRecord, [], ['domain', 'operationId', 'sessionId', 'referenceId', 'runId', 'unitId', 'attemptId', 'stepId']);
  for (const [key, expected] of Object.entries(filterRecord)) if (expected !== undefined) {
    if (key === 'domain') enumeration(expected, ['play', 'reference']); else assertUsageSessionId(expected);
  }
  const groups = new Map<string, { requests: ModelRequestUsageRecord[]; steps: ModelStepUsageRecord[] }>();
  const diagnostics = new Set<UsageCallsProjection['diagnostics'][number]>(history.diagnostics);
  for (const item of history.records) {
    if (item.recordType === 'turn') continue;
    const id = `${item.turnId}.${item.stepIndex}`;
    const group = groups.get(id) ?? { requests: [], steps: [] };
    if (item.recordType === 'request') group.requests.push(item); else group.steps.push(item);
    groups.set(id, group);
  }
  const calls: UsageInspectorCall[] = [];
  const matchingIds = new Set<string>();
  for (const [id, group] of groups) {
    const matches = !Object.keys(filter).length || group.requests.some(request => matchesUsageOperation(request.operation, filter));
    if (!matches) {
      if (!group.requests.some(request => request.operation)) diagnostics.add('unmatched-records');
    } else matchingIds.add(id);
    const requestConflict = new Set(group.requests.map(stableUsageJson)).size > 1;
    const stepConflict = new Set(group.steps.map(stableUsageJson)).size > 1;
    const conflict = requestConflict || stepConflict;
    if (group.requests.length > 1 || group.steps.length > 1) diagnostics.add(conflict ? 'conflicting-records' : 'duplicate-records');
    const identity = group.requests[0] ?? group.steps[0]!;
    const request = requestConflict ? undefined : group.requests[0];
    const step = conflict ? undefined : group.steps[0];
    calls.push({ id, turnId: identity.turnId, stepIndex: identity.stepIndex,
      status: conflict ? 'conflict' : step?.outcome ?? 'pending',
      ...(request ? { request } : {}), ...(step ? { step } : {}),
      fingerprintChange: { status: 'unavailable', reasons: [] },
    });
  }
  calls.sort((a, b) => usageCallTime(a).localeCompare(usageCallTime(b)) || a.turnId.localeCompare(b.turnId) || a.stepIndex - b.stepIndex);
  const prior = new Map<string, UsageInspectorCall>();
  for (const call of calls) {
    const request = call.request;
    if (!request?.fingerprint || call.status === 'conflict') continue;
    const operation = request.operation;
    const scope = operation ? [operation.domain, operation.sessionId ?? operation.referenceId, operation.domain === 'reference' ? operation.runId : '', operation.stage].join(':') : history.sessionId;
    const previous = prior.get(scope);
    if (!previous?.request?.fingerprint) call.fingerprintChange = { status: 'first-observed', reasons: [] };
    else {
      const before = previous.request.fingerprint;
      const after = request.fingerprint;
      const reasons: UsageInspectorCall['fingerprintChange']['reasons'] = [];
      if (before.prefixHash !== after.prefixHash) reasons.push('prefix');
      if (before.toolSchemaHash !== after.toolSchemaHash) reasons.push('tools');
      if (before.prefixKind !== after.prefixKind) reasons.push('prefix-kind');
      call.fingerprintChange = { status: reasons.length ? 'changed' : 'unchanged', reasons, comparedWith: previous.id };
    }
    prior.set(scope, call);
  }
  const selected = calls.filter(call => matchingIds.has(call.id));
  return { schemaVersion: 1, calls: selected, totals: usageCallTotals(selected, incompleteUsageHistory(history.truncated, [...diagnostics])), truncated: history.truncated, diagnostics: [...diagnostics] };
}
/** Filter an already validated host projection without reinterpreting conflicts after Player redaction. */
export function selectUsageOperation(projection: UsageCallsProjection, history: AgentGovernanceHistory, operationId: string): UsageCallsProjection {
  const ids = new Set(history.records.flatMap(record => record.recordType === 'request' && record.operation?.operationId === operationId
    ? [`${record.turnId}.${record.stepIndex}`] : []));
  const calls = projection.calls.filter(call => ids.has(call.id));
  return { ...projection, calls, totals: usageCallTotals(calls, incompleteUsageHistory(projection.truncated, projection.diagnostics)) };
}
export function parseUsageCallsProjection(value: unknown): UsageCallsProjection {
  const v = record(value); keys(v, ['schemaVersion', 'calls', 'totals', 'truncated', 'diagnostics']);
  if (v.schemaVersion !== 1 || typeof v.truncated !== 'boolean') fail();
  const calls = array(v.calls, USAGE_MAX_RECORDS).map(raw => {
    const call = record(raw); keys(call, ['id', 'turnId', 'stepIndex', 'status', 'fingerprintChange'], ['request', 'step']);
    assertUsageSessionId(call.turnId); integer(call.stepIndex);
    if (call.id !== `${call.turnId}.${call.stepIndex}`) fail();
    enumeration(call.status, ['pending', 'completed', 'failed', 'aborted', 'conflict']);
    for (const kind of ['request', 'step'] as const) if (call[kind] !== undefined) {
      const parsed = parseAgentUsageRecord(call[kind]);
      if (parsed.recordType !== kind || parsed.turnId !== call.turnId || parsed.stepIndex !== call.stepIndex) fail();
    }
    const step = call.step as ModelStepUsageRecord | undefined;
    if (call.status === 'conflict' ? step !== undefined : call.status !== (step?.outcome ?? 'pending')) fail();
    const change = record(call.fingerprintChange); keys(change, ['status', 'reasons'], ['comparedWith']);
    enumeration(change.status, ['first-observed', 'unchanged', 'changed', 'unavailable']);
    const reasons = array(change.reasons, 3); reasons.forEach(reason => enumeration(reason, ['prefix', 'tools', 'prefix-kind']));
    if (new Set(reasons).size !== reasons.length || (change.status === 'changed') !== (reasons.length > 0)) fail();
    if (change.comparedWith !== undefined && (typeof change.comparedWith !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(change.comparedWith) || change.comparedWith.includes('..'))) fail();
    if (['changed', 'unchanged'].includes(change.status as string) !== (change.comparedWith !== undefined)) fail();
    if (!call.request && !call.step && call.status !== 'conflict') fail();
    return cloneValidatedContract(call) as UsageInspectorCall;
  });
  if (new Set(calls.map(call => call.id)).size !== calls.length) fail();
  const diagnostics = array(v.diagnostics, USAGE_PROJECTION_DIAGNOSTICS.length);
  diagnostics.forEach(d => enumeration(d, [...USAGE_PROJECTION_DIAGNOSTICS]));
  const totals = usageCallTotals(calls, incompleteUsageHistory(v.truncated, diagnostics));
  if (stableUsageJson(v.totals) !== stableUsageJson(totals)) fail();
  return { schemaVersion: 1, calls, totals, truncated: v.truncated, diagnostics: diagnostics as UsageCallsProjection['diagnostics'] };
}
function usageCallTotals(calls: UsageInspectorCall[], incomplete = false): UsageCallsProjection['totals'] {
  const usages = calls.map(call => call.status === 'conflict' ? normalizeModelUsage() : call.step?.actualUsage ?? normalizeModelUsage());
  const totals = aggregateModelUsage(usages);
  if (incomplete && totals.actualCoverage === 'complete') {
    totals.actualCoverage = 'partial'; totals.actualUsage.availability = 'partial';
  }
  return { callCount: calls.length, reportedCalls: calls.filter(call => call.step).length, ...totals };
}
function incompleteUsageHistory(truncated: boolean, diagnostics: readonly unknown[]): boolean {
  return truncated || diagnostics.some(diagnostic => ['truncated-tail', 'invalid-record', 'read-failed', 'size-limit', 'unmatched-records'].includes(diagnostic as string));
}
function matchesUsageOperation(operation: UsageOperation | undefined, filter: UsageCallFilter): boolean {
  return operation !== undefined && Object.entries(filter).every(([key, expected]) => expected === undefined || operation[key as keyof UsageOperation] === expected);
}
function usageCallTime(call: UsageInspectorCall): string { return call.step?.timing?.startedAt ?? call.request?.createdAt ?? call.step?.createdAt ?? ''; }
function stableUsageJson(value: unknown): string { return JSON.stringify(sortUsageValue(value)); }
function sortUsageValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortUsageValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortUsageValue(item)]));
  return value;
}
function parseRequest(value: unknown): void {
  const v = record(value); keys(v, ['messageCount', 'messages', 'estimatedMessageTokens', 'estimatedRequestTokens', 'toolCount', 'estimator', 'estimationScope']);
  ['messageCount', 'estimatedMessageTokens', 'estimatedRequestTokens', 'toolCount'].forEach((key) => integer(v[key]));
  if (v.estimator !== USAGE_ESTIMATOR || v.estimationScope !== 'messages-tools-json-with-20-percent-margin') fail();
  const messages = array(v.messages, 10_000); if (messages.length !== v.messageCount) fail();
  let tokens = 0;
  messages.forEach((item, index) => {
    const m = record(item); keys(m, ['index', 'role', 'chars', 'estimatedTokens', 'sourceRefs']);
    if (m.index !== index) fail(); enumeration(m.role, ['system', 'user', 'assistant', 'tool']);
    integer(m.chars); integer(m.estimatedTokens); tokens += m.estimatedTokens as number;
    array(m.sourceRefs, USAGE_MAX_SOURCES).forEach((ref) => string(ref, 1200));
  });
  if (tokens !== v.estimatedMessageTokens) fail();
}
function parseSource(value: unknown): void {
  const v = record(value);
  keys(v, ['sourceId', 'kind', 'budgetLayer', 'semanticBoundary', 'outcome', 'reason', 'modelVisibleChars', 'estimatedTokens', 'estimator'], ['path', 'sourceHash', 'payloadHash', 'sourceRevision', 'originalChars', 'attribution']);
  label(v.sourceId); label(v.kind);
  if (v.path !== undefined && !isUsageSourcePath(v.path)) fail();
  for (const key of ['sourceHash', 'payloadHash']) if (v[key] !== undefined && (typeof v[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(v[key] as string))) fail();
  if (v.sourceRevision !== undefined) label(v.sourceRevision);
  enumeration(v.budgetLayer, ['L0', 'L1', 'L2', 'L3']); enumeration(v.semanticBoundary, ['protected', 'compressible', 'excluded']);
  enumeration(v.outcome, ['selected', 'compressed', 'omitted', 'excluded']);
  enumeration(v.reason, ['selected', 'context-window', 'budget', 'policy', 'tool-result', 'declared-only']);
  if (v.estimator !== USAGE_ESTIMATOR) fail();
  integer(v.modelVisibleChars); integer(v.estimatedTokens);
  if (v.originalChars !== undefined) integer(v.originalChars);
  if (v.attribution !== undefined) enumeration(v.attribution, ['exact', 'derived']);
  if (['omitted', 'excluded'].includes(v.outcome as string) && (v.modelVisibleChars !== 0 || v.estimatedTokens !== 0 || v.payloadHash !== undefined)) fail();
  if (v.semanticBoundary === 'excluded' && v.outcome !== 'excluded') fail();
}
function parseUsage(value: unknown, aggregate = false): void {
  const v = record(value); keys(v, ['availability'], [...USAGE_TOKEN_FIELDS]);
  enumeration(v.availability, ['actual', 'partial', 'unavailable']);
  USAGE_TOKEN_FIELDS.forEach((key) => { if (v[key] !== undefined) integer(v[key]); });
  const expected = normalizeModelUsage(v);
  if (expected.availability !== v.availability && !(aggregate && expected.availability === 'actual' && v.availability === 'partial')) fail();
}
function record(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(); return v as Record<string, unknown>; }
function keys(v: Record<string, unknown>, required: string[], optional: string[] = []): void { if (required.some((k) => !Object.hasOwn(v, k)) || Object.keys(v).some((k) => !required.includes(k) && !optional.includes(k))) fail(); }
function array(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || v.length > max) return fail(); return v; }
function integer(v: unknown): void { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(); }
function enumeration(v: unknown, values: string[]): void { if (typeof v !== 'string' || !values.includes(v)) fail(); }
function string(v: unknown, max: number): void { if (typeof v !== 'string' || !v.length || v.length > max || /[\x00-\x1f\x7f]/u.test(v)) fail(); }
function label(v: unknown): void { string(v, 160); if (!/^[\p{L}\p{N}._ /:@+-]+$/u.test(v as string) || (v as string).startsWith('/') || (v as string).includes('..') || (v as string).includes('://')) fail(); }
function timestamp(v: unknown): void { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail(); }
function fail(): never { throw new Error('Invalid agent usage schema.'); }

// Vue may supply a reactive proxy. Copy only validated enumerable contract data.
function cloneValidatedContract(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValidatedContract);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValidatedContract(item)]));
  return value;
}
