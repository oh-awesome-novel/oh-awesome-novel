import { createHash, randomUUID } from 'node:crypto';
import { appendAgentUsageRecord, formatContextPackageSummary } from '@oh-awesome-novel/core';
import type { ContextPackage, ContextSourceRef, LlmProviderConfig } from '@oh-awesome-novel/core';
import { aggregateModelUsage, assertUsageSessionId, estimateTextTokens, isUsageSourcePath, normalizeModelUsage, safeEndpointOrigin, USAGE_ESTIMATOR, usageSourceKey } from '@oh-awesome-novel/core/agent-usage';
import type { ModelRequestStats, ModelRequestUsageRecord, ModelStepUsageRecord, NormalizedModelUsage, ProviderEgressSummary, TurnUsageSummary, UsageBudget, UsageMessageStats, UsageSourceEvidence, UsageRequestMetadata, UsageTokenField } from '@oh-awesome-novel/core/agent-usage';
import { estimateRuntimeModelRequest } from '@oh-awesome-novel/runtime';
import type { CopilotRuntimeOptions, RuntimeMessage } from '@oh-awesome-novel/runtime';
import { resolveContextBudget } from './context-budget';
import type { ContextBudgetOptions } from './context-budget';

export function createContextEvidence(input: {
  sourceId: string; kind: string; path?: string; sourceHash?: string;
  originalChars?: number; budgetLayer?: UsageSourceEvidence['budgetLayer'];
  semanticBoundary?: UsageSourceEvidence['semanticBoundary'];
}): UsageSourceEvidence {
  return {
    sourceId: safeLabel(input.sourceId), kind: safeLabel(input.kind),
    ...(isUsageSourcePath(input.path) ? { path: input.path } : {}),
    ...(input.sourceHash && /^[a-f0-9]{64}$/u.test(input.sourceHash) ? { sourceHash: input.sourceHash } : {}),
    ...(input.originalChars !== undefined ? { originalChars: input.originalChars } : {}),
    budgetLayer: input.budgetLayer ?? 'L0', semanticBoundary: input.semanticBoundary ?? 'protected',
    outcome: 'selected', reason: 'selected', modelVisibleChars: 0, estimatedTokens: 0,
    estimator: USAGE_ESTIMATOR, attribution: 'exact',
  };
}

const PROVIDER_ORIGIN_DEFAULTS: Record<string, string> = {
  openai: 'https://api.openai.com', deepseek: 'https://api.deepseek.com',
  ollama: 'http://127.0.0.1:11434', 'opencode-go': 'https://api.opencodego.com', 'xiaomi-mimo': 'https://api.mimo.mi.com',
};

export function createProviderEgressSummary(provider: LlmProviderConfig): ProviderEgressSummary {
  const endpointOrigin = safeEndpointOrigin(provider.baseUrl ?? PROVIDER_ORIGIN_DEFAULTS[provider.kind]);
  return {
    providerId: safeLabel(provider.id),
    providerKind: safeLabel(provider.kind),
    modelId: safeLabel(provider.model),
    ...(endpointOrigin ? { endpointOrigin } : {}),
    status: 'prepared',
  };
}

export function extractAiSdkUsageFields(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
    outputTokenDetails?: { reasoningTokens?: number };
  } | undefined,
): Partial<Record<UsageTokenField, unknown>> {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
  };
}

export interface RecordSpecializedModelUsageTurnInput {
  workspaceRoot?: string;
  sessionId?: string;
  turnId?: string;
  provider: LlmProviderConfig;
  systemPrompt: string;
  userPrompt: string;
  sourceId?: string;
  sourceKind?: string;
  sourcePath?: string;
  sourceHash?: string;
  budgetOptions?: ContextBudgetOptions;
  rawUsage?: Partial<Record<UsageTokenField, unknown>>;
  finishReason?: string;
  outcome: 'completed' | 'failed' | 'aborted';
  createdAt?: string;
}

export async function recordSpecializedModelUsageTurn(
  input: RecordSpecializedModelUsageTurnInput,
): Promise<{
  actualUsage: NormalizedModelUsage;
  egress: ProviderEgressSummary;
  requestStats: ModelRequestStats;
}> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const rawTurnId = input.turnId ?? `turn_${randomUUID()}`;
  const turnId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(rawTurnId) && !rawTurnId.includes('..')
    ? rawTurnId
    : `turn_${randomUUID()}`;
  const egress = createProviderEgressSummary(input.provider);
  const systemTokens = estimateTextTokens(input.systemPrompt);
  const userTokens = estimateTextTokens(input.userPrompt);
  const systemSource: UsageSourceEvidence = {
    sourceId: 'systemInstructions',
    kind: safeLabel(input.sourceKind ?? 'specializedSystem'),
    payloadHash: hash(input.systemPrompt),
    originalChars: input.systemPrompt.length,
    modelVisibleChars: input.systemPrompt.length,
    estimatedTokens: systemTokens,
    budgetLayer: 'L0',
    semanticBoundary: 'protected',
    outcome: 'selected',
    reason: 'selected',
    estimator: USAGE_ESTIMATOR,
    attribution: 'exact',
  };
  const userSource: UsageSourceEvidence = {
    sourceId: safeLabel(input.sourceId ?? 'specializedInput'),
    kind: safeLabel(input.sourceKind ?? 'specializedPrompt'),
    ...(isUsageSourcePath(input.sourcePath) ? { path: input.sourcePath } : {}),
    ...(input.sourceHash && /^[a-f0-9]{64}$/u.test(input.sourceHash) ? { sourceHash: input.sourceHash } : {}),
    payloadHash: hash(input.userPrompt),
    originalChars: input.userPrompt.length,
    modelVisibleChars: input.userPrompt.length,
    estimatedTokens: userTokens,
    budgetLayer: 'L1',
    semanticBoundary: 'protected',
    outcome: 'selected',
    reason: 'selected',
    estimator: USAGE_ESTIMATOR,
    attribution: 'exact',
  };
  const messages: UsageMessageStats[] = [
    { index: 0, role: 'system', chars: input.systemPrompt.length, estimatedTokens: systemTokens, sourceRefs: [usageSourceKey(systemSource)] },
    { index: 1, role: 'user', chars: input.userPrompt.length, estimatedTokens: userTokens, sourceRefs: [usageSourceKey(userSource)] },
  ];
  const estimatedMessageTokens = systemTokens + userTokens;
  const estimatedRequestTokens = Math.ceil(estimatedMessageTokens * 1.2);
  const requestStats: ModelRequestStats = {
    messageCount: 2,
    messages,
    estimatedMessageTokens,
    estimatedRequestTokens,
    toolCount: 0,
    estimator: USAGE_ESTIMATOR,
    estimationScope: 'messages-tools-json-with-20-percent-margin',
  };
  const resolvedBudget = resolveContextBudget(input.provider, input.budgetOptions);
  const budget: UsageBudget = resolvedBudget.inputTokens === undefined
    ? { status: 'unknown', estimatedRequestTokens }
    : {
        status: estimatedRequestTokens > resolvedBudget.inputTokens ? 'overflow' : 'within',
        inputTokens: resolvedBudget.inputTokens,
        estimatedRequestTokens,
      };
  const actualUsage = normalizeModelUsage(input.rawUsage);
  const aggregated = aggregateModelUsage([actualUsage]);

  if (input.workspaceRoot && input.sessionId) {
    try {
      assertUsageSessionId(input.sessionId);
      const requestRecord: ModelRequestUsageRecord = {
        schemaVersion: 1,
        recordType: 'request',
        sessionId: input.sessionId,
        turnId,
        stepIndex: 0,
        createdAt,
        request: requestStats,
        sources: [systemSource, userSource],
        budget,
        egress,
      };
      const stepRecord: ModelStepUsageRecord = {
        schemaVersion: 1,
        recordType: 'step',
        sessionId: input.sessionId,
        turnId,
        stepIndex: 0,
        createdAt,
        actualUsage,
        outcome: input.outcome,
        ...(input.finishReason ? { finishReason: safeLabel(input.finishReason) } : {}),
      };
      const turnRecord: TurnUsageSummary = {
        schemaVersion: 1,
        recordType: 'turn',
        sessionId: input.sessionId,
        turnId,
        createdAt,
        stepCount: 1,
        estimatedMessageTokens,
        estimatedRequestTokens,
        actualUsage: aggregated.actualUsage,
        actualCoverage: aggregated.actualCoverage,
        fieldCoverage: aggregated.fieldCoverage,
        outcome: input.outcome,
      };
      await appendAgentUsageRecord(input.workspaceRoot, input.sessionId, requestRecord);
      await appendAgentUsageRecord(input.workspaceRoot, input.sessionId, stepRecord);
      await appendAgentUsageRecord(input.workspaceRoot, input.sessionId, turnRecord);
    } catch {
      // Disposable telemetry must never fail a specialized Reference or Play run.
    }
  }

  return { actualUsage, egress, requestStats };
}

export function createUsageGovernance(input: {
  budgetOptions?: ContextBudgetOptions;
  provider: LlmProviderConfig; workspaceRoot: string; sessionId?: string; contextPackage?: ContextPackage;
  drainReadSources?: () => Array<{ path: string; sourceHash: string; originalChars: number }>;
}): Pick<CopilotRuntimeOptions, 'prepareModelRequest' | 'toolResultProvenance' | 'onEvent'> & { takePersistenceWarning(): boolean } {
  const declared = input.contextPackage ? structuredClone(input.contextPackage) : undefined;
  let pendingWarning = false;
  const egress = createProviderEgressSummary(input.provider);
  return {
    async prepareModelRequest(request) {
      let messages = request.messages.map((message) => ({ ...message, ...(message.provenance ? { provenance: message.provenance.map((p) => ({ ...p })) } : {}) }));
      const initial = messages.flatMap((message) => message.provenance ?? []);
      const removed = new Set<RuntimeMessage>();
      const budget = resolveContextBudget(input.provider, input.budgetOptions);
      const collect = (): UsageSourceEvidence[] => {
        const visible = messages.filter((m) => !removed.has(m)).flatMap((m) => (m.provenance ?? []).map((source) => ({
          ...source, payloadHash: hash(m.content), modelVisibleChars: m.content.length,
          estimatedTokens: source.attribution === 'derived' ? 0 : estimateTextTokens(m.content),
        })));
        const keys = new Set(visible.map(usageSourceKey));
        const omitted = initial.filter((source) => !keys.has(usageSourceKey(source))).map((source) => invisible(source, 'budget'));
        const known = new Set([...visible, ...omitted].map(usageSourceKey));
        for (const source of [...declared?.selected ?? [], ...declared?.omitted ?? []]) {
          if (known.has(usageSourceKey(source))) continue;
          const evidence = fromDeclared(source);
          omitted.push(invisible(evidence, source.semanticBoundary === 'excluded' ? 'policy' : source.outcome === 'omitted' ? 'context-window' : 'declared-only'));
          known.add(usageSourceKey(source));
        }
        return [...visible, ...omitted];
      };
      const refreshSummary = () => {
        if (!declared) return;
        const sources = collect();
        const omitted = new Set(sources.filter((s) => ['omitted', 'excluded'].includes(s.outcome)).map(usageSourceKey));
        const summary: ContextPackage = {
          ...declared,
          selected: declared.selected.filter((s) => !omitted.has(usageSourceKey(s))).map((s) => {
            const evidence = sources.find((e) => usageSourceKey(e) === usageSourceKey(s));
            return evidence ? { ...s, payloadHash: evidence.payloadHash, modelVisibleChars: evidence.modelVisibleChars,
              estimatedTokens: evidence.estimatedTokens, estimator: evidence.estimator, outcome: evidence.outcome,
              ...(evidence.sourceRevision ? { sourceRevision: evidence.sourceRevision } : {}) } : s;
          }),
          omitted: [...declared.omitted, ...declared.selected.filter((s) => omitted.has(usageSourceKey(s))).map((s) => ({ ...s, reason: 'omitted from this model request by context budget or unavailable payload', outcome: 'omitted' as const, payloadHash: undefined, modelVisibleChars: 0, estimatedTokens: 0 }))],
          trace: declared.trace.filter((entry) => entry.outcome !== 'selected' || !sources.some((s) => s.sourceId === entry.sourceId && s.path === entry.path && ['omitted', 'excluded'].includes(s.outcome))),
        };
        for (const message of messages) if (message.provenance?.some((s) => s.sourceId === 'contextPackage')) {
          message.content = `# Selected Context: Context Package Summary\n\n${formatContextPackageSummary(summary, { maxSources: 24, maxTrace: 24 })}`;
        }
        // The final session artifact describes the final assembled request.
        if (input.contextPackage) { input.contextPackage.selected = summary.selected; input.contextPackage.omitted = summary.omitted; input.contextPackage.trace = summary.trace; }
      };
      // Excluded provenance never becomes model-visible, even under unknown budgets.
      for (const m of messages) if (m.provenance?.some((s) => s.semanticBoundary === 'excluded')) removed.add(m);
      refreshSummary();
      let effective = { ...request, messages: messages.filter((m) => !removed.has(m)) };
      let stats = await estimateRuntimeModelRequest(effective);
      const removable = messages.map((message, index) => ({ message, index }))
        .filter(({ message }) => message.role === 'system' && message.provenance?.length && message.provenance.every((s) => s.semanticBoundary === 'compressible'))
        .sort((a, b) => Math.max(...b.message.provenance!.map((s) => Number(s.budgetLayer.slice(1)))) - Math.max(...a.message.provenance!.map((s) => Number(s.budgetLayer.slice(1)))) || a.index - b.index);
      for (const { message } of removable) {
        if (budget.inputTokens === undefined || stats.estimatedRequestTokens <= budget.inputTokens) break;
        removed.add(message); refreshSummary();
        effective = { ...request, messages: messages.filter((m) => !removed.has(m)) };
        stats = await estimateRuntimeModelRequest(effective);
      }
      const sources = collect();
      // Exact hashes are for the post-format payload that reaches the adapter.
      effective.messages = effective.messages.map((m) => ({ ...m, ...(m.provenance ? { provenance: m.provenance.map((s) => sources.find((v) => usageSourceKey(v) === usageSourceKey(s)) ?? s) } : {}) }));
      const metadata: UsageRequestMetadata = {
        ...(declared ? { contextPackageId: declared.id } : {}), sources, egress,
        budget: { status: budget.inputTokens === undefined ? 'unknown' : stats.estimatedRequestTokens > budget.inputTokens ? 'overflow' : 'within',
          ...(budget.inputTokens !== undefined ? { inputTokens: budget.inputTokens } : {}), estimatedRequestTokens: stats.estimatedRequestTokens },
      };
      return { request: effective, metadata };
    },
    toolResultProvenance(toolCall) {
      return (input.drainReadSources?.() ?? []).map((source, index) => ({
        ...createContextEvidence({ ...source, sourceId: `toolRead-${hash(toolCall.id).slice(0, 16)}-${index}`, kind: 'tool', semanticBoundary: 'protected', budgetLayer: 'L1' }),
        reason: 'tool-result', attribution: 'derived',
      }));
    },
    async onEvent(event) {
      if (!input.sessionId || (event.type !== 'model_request_stats' && event.type !== 'usage_stats')) return;
      try { await appendAgentUsageRecord(input.workspaceRoot, input.sessionId, event.record); }
      catch { pendingWarning = true; }
    },
    takePersistenceWarning() { const result = pendingWarning; pendingWarning = false; return result; },
  };
}
function invisible(source: UsageSourceEvidence, reason: UsageSourceEvidence['reason']): UsageSourceEvidence {
  const { payloadHash: _hash, ...rest } = source;
  return { ...rest, outcome: source.semanticBoundary === 'excluded' ? 'excluded' : 'omitted', reason, modelVisibleChars: 0, estimatedTokens: 0 };
}
function fromDeclared(source: ContextSourceRef): UsageSourceEvidence {
  return createContextEvidence({ ...source, kind: source.sourceId });
}
function safeLabel(value: string): string {
  return /^[\p{L}\p{N}._ /:@+-]{1,160}$/u.test(value) && !value.startsWith('/') && !value.includes('..') && !value.includes('://') ? value : 'unavailable';
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
