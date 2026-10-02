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
    keys(v, [...base, 'stepIndex', 'request', 'sources', 'budget'], ['sessionId', 'contextPackageId', 'egress']);
    integer(v.stepIndex); parseRequest(v.request); array(v.sources, USAGE_MAX_SOURCES).forEach(parseSource);
    if (v.contextPackageId !== undefined) assertUsageSessionId(v.contextPackageId);
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
    keys(v, [...base, 'stepIndex', 'actualUsage', 'outcome'], ['sessionId', 'finishReason']);
    integer(v.stepIndex); parseUsage(v.actualUsage); enumeration(v.outcome, ['completed', 'failed', 'aborted']);
    if (v.finishReason !== undefined) label(v.finishReason);
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
