import { createHash } from 'node:crypto';
import { appendAgentUsageRecord, formatContextPackageSummary } from '@oh-awesome-novel/core';
import type { ContextPackage, ContextSourceRef, LlmProviderConfig } from '@oh-awesome-novel/core';
import { estimateTextTokens, isUsageSourcePath, safeEndpointOrigin, USAGE_ESTIMATOR, usageSourceKey } from '@oh-awesome-novel/core/agent-usage';
import type { UsageSourceEvidence, UsageRequestMetadata } from '@oh-awesome-novel/core/agent-usage';
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

export function createUsageGovernance(input: {
  budgetOptions?: ContextBudgetOptions;
  provider: LlmProviderConfig; workspaceRoot: string; sessionId?: string; contextPackage?: ContextPackage;
  drainReadSources?: () => Array<{ path: string; sourceHash: string; originalChars: number }>;
}): Pick<CopilotRuntimeOptions, 'prepareModelRequest' | 'toolResultProvenance' | 'onEvent'> & { takePersistenceWarning(): boolean } {
  const declared = input.contextPackage ? structuredClone(input.contextPackage) : undefined;
  let pendingWarning = false;
  const defaults: Record<string, string> = {
    openai: 'https://api.openai.com', deepseek: 'https://api.deepseek.com',
    ollama: 'http://127.0.0.1:11434', 'opencode-go': 'https://api.opencodego.com', 'xiaomi-mimo': 'https://api.mimo.mi.com',
  };
  const endpointOrigin = safeEndpointOrigin(input.provider.baseUrl ?? defaults[input.provider.kind]);
  const egress = {
    providerId: safeLabel(input.provider.id), providerKind: safeLabel(input.provider.kind), modelId: safeLabel(input.provider.model),
    ...(endpointOrigin ? { endpointOrigin } : {}), status: 'prepared' as const,
  };
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
