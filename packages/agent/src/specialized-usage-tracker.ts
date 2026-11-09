import { createHash, randomUUID } from 'node:crypto';
import type { ModelMessage, ToolSet } from 'ai';
import { appendAgentUsageRecord } from '@oh-awesome-novel/core';
import { aggregateModelUsage, normalizeModelUsage, parseUsageOperation } from '@oh-awesome-novel/core/agent-usage';
import type { ModelRequestUsageRecord, ModelStepUsageRecord, UsageTokenField } from '@oh-awesome-novel/core/agent-usage';
import { estimateRuntimeModelRequest, fingerprintRuntimeModelRequest } from '@oh-awesome-novel/runtime';
import { createContextEvidence, createProviderEgressSummary, extractAiSdkUsageFields } from './usage-governance.js';
import type { RecordSpecializedModelUsageTurnInput } from './usage-governance.js';
import { resolveContextBudget } from './context-budget.js';

interface StepStart {
  stepNumber: number;
  instructions?: string | { role: 'system'; content: string } | Array<{ role: 'system'; content: string }>;
  messages: ModelMessage[];
  tools?: ToolSet;
}
interface StepEnd {
  stepNumber: number;
  usage: Parameters<typeof extractAiSdkUsageFields>[0];
  finishReason: string;
}

/** Version-matched SDK hooks describe actual steps, including read-tool exploration. */
export function createSpecializedUsageTracker(input: Omit<RecordSpecializedModelUsageTurnInput, 'outcome'>) {
  const turnId = `turn_${randomUUID()}`;
  const requests = new Map<number, ModelRequestUsageRecord>();
  const starts = new Map<number, string>();
  const steps = new Map<number, ModelStepUsageRecord>();
  let finished = false;
  const base = () => ({ schemaVersion: 1 as const, turnId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}), createdAt: new Date().toISOString() });
  const persist = async (value: Parameters<typeof appendAgentUsageRecord>[2]) => {
    if (!input.workspaceRoot || !input.sessionId) return;
    try { await appendAgentUsageRecord(input.workspaceRoot, input.sessionId, value); }
    catch { /* Telemetry failure never changes the domain run's outcome. */ }
  };
  const completeStep = async (index: number, outcome: ModelStepUsageRecord['outcome'], rawUsage?: Partial<Record<UsageTokenField, unknown>>, finishReason?: string) => {
    if (steps.has(index)) return;
    const startedAt = starts.get(index);
    const step: ModelStepUsageRecord = { ...base(), recordType: 'step', stepIndex: index,
      actualUsage: normalizeModelUsage(rawUsage), outcome,
      ...(finishReason && /^[a-z_-]{1,40}$/u.test(finishReason) ? { finishReason } : {}),
      ...(startedAt ? { timing: { startedAt, completedAt: new Date().toISOString() } } : {}),
    };
    steps.set(index, step);
    await persist(step);
  };
  return {
    async onStepStart(event: StepStart): Promise<void> {
      if (finished || requests.has(event.stepNumber)) return;
      const instructions = event.instructions ?? input.systemPrompt;
      const system = typeof instructions === 'string' ? instructions : (Array.isArray(instructions) ? instructions : [instructions]).map(message => message.content).join('\n\n');
      const all = [{ role: 'system' as const, content: system }, ...event.messages];
      const messages = all.map((message, index) => {
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
        const source = createContextEvidence({
          sourceId: index === 0 ? 'systemInstructions' : index === 1 ? input.sourceId ?? 'specializedInput' : `step-${event.stepNumber}-message-${index}`,
          kind: index === 0 ? 'specializedSystem' : message.role === 'tool' ? 'tool' : input.sourceKind ?? 'specializedPrompt',
          ...(index === 1 ? { path: input.sourcePath, sourceHash: input.sourceHash } : {}),
          originalChars: content.length,
        });
        source.payloadHash = createHash('sha256').update(content).digest('hex');
        // Only hashes and bounded counts survive; no raw content is persisted.
        return { role: message.role, content, provenance: [source] };
      });
      const modelRequest = { messages, tools: event.tools ?? input.tools ?? {} };
      const requestStats = await estimateRuntimeModelRequest(modelRequest);
      const fingerprint = await fingerprintRuntimeModelRequest(modelRequest, input.frozenSystemPrompt);
      const budget = resolveContextBudget(input.provider, input.budgetOptions);
      const request: ModelRequestUsageRecord = { ...base(), recordType: 'request', stepIndex: event.stepNumber,
        request: requestStats, fingerprint, egress: createProviderEgressSummary(input.provider),
        sources: messages.flatMap(message => message.provenance.map(source => ({
          ...source, modelVisibleChars: message.content.length,
          estimatedTokens: requestStats.messages[messages.indexOf(message)]!.estimatedTokens,
        }))),
        budget: { status: budget.inputTokens === undefined ? 'unknown' : requestStats.estimatedRequestTokens > budget.inputTokens ? 'overflow' : 'within',
          estimatedRequestTokens: requestStats.estimatedRequestTokens, ...(budget.inputTokens === undefined ? {} : { inputTokens: budget.inputTokens }) },
        ...(input.usageOperation ? { operation: parseUsageOperation(input.usageOperation) } : {}),
      };
      requests.set(event.stepNumber, request);
      await persist(request);
      starts.set(event.stepNumber, new Date().toISOString());
    },
    async onStepEnd(event: StepEnd): Promise<void> {
      await completeStep(event.stepNumber, event.finishReason === 'error' ? 'failed' : 'completed', extractAiSdkUsageFields(event.usage), event.finishReason);
    },
    async finish(result: Pick<RecordSpecializedModelUsageTurnInput, 'outcome' | 'rawUsage' | 'finishReason'> & Partial<RecordSpecializedModelUsageTurnInput>): Promise<void> {
      if (finished) return;
      finished = true;
      // Completed steps were recorded by SDK hooks. A thrown/aborted active step
      // still gets a terminal unavailable/partial record, never a fabricated zero.
      for (const index of requests.keys()) if (!steps.has(index)) await completeStep(index, result.outcome, result.rawUsage, result.finishReason);
      if (!requests.size) return;
      await persist({ ...base(), recordType: 'turn', stepCount: requests.size,
        estimatedMessageTokens: [...requests.values()].reduce((sum, request) => sum + request.request.estimatedMessageTokens, 0),
        estimatedRequestTokens: [...requests.values()].reduce((sum, request) => sum + request.request.estimatedRequestTokens, 0),
        ...aggregateModelUsage([...steps.values()].map(step => step.actualUsage)), outcome: result.outcome,
      });
    },
  };
}
