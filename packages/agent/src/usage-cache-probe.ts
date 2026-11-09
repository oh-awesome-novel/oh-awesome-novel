import { generateText } from 'ai';
import type { LlmProviderConfig } from '@oh-awesome-novel/core';
import type { UsageOperation } from '@oh-awesome-novel/core/agent-usage';
import type { AiSdkProviderResolver } from './index.js';
import { createSpecializedUsageTracker } from './specialized-usage-tracker.js';
import { extractAiSdkUsageFields } from './usage-governance.js';

// Fixed synthetic material only. Repeated calls deliberately keep identical bytes.
const PROBE_SYSTEM = [
  'This is a synthetic cache observation, not a story or an instruction to use tools.',
  ...Array.from({ length: 64 }, (_, index) => `Synthetic reference item ${index + 1}: the blue triangle remains beside the green circle.`),
].join('\n');
const PROBE_PROMPT = 'Reply only with OK.';

export interface UsageCacheProbeCallInput {
  workspaceRoot: string;
  usageSessionId: string;
  usageOperation: UsageOperation;
  providerConfig: LlmProviderConfig;
  resolveModel: AiSdkProviderResolver;
  abortSignal?: AbortSignal;
}

/** One caller-authorized bounded request. The backend owns the two-call cap. */
export async function runUsageCacheProbeCall(input: UsageCacheProbeCallInput): Promise<{ outcome: 'completed' | 'failed' | 'aborted' }> {
  if (input.abortSignal?.aborted) return { outcome: 'aborted' };
  const tracker = createSpecializedUsageTracker({
    workspaceRoot: input.workspaceRoot, sessionId: input.usageSessionId,
    usageOperation: input.usageOperation, provider: input.providerConfig,
    systemPrompt: PROBE_SYSTEM, frozenSystemPrompt: PROBE_SYSTEM,
    userPrompt: PROBE_PROMPT, sourceId: 'syntheticCacheProbe', sourceKind: 'synthetic',
    budgetOptions: { outputReserveTokens: 32 },
  });
  try {
    const model = await input.resolveModel(input.providerConfig);
    input.abortSignal?.throwIfAborted();
    const result = await generateText({
      model, instructions: PROBE_SYSTEM, prompt: PROBE_PROMPT,
      maxOutputTokens: 32, maxRetries: 0, abortSignal: input.abortSignal,
      onStepStart: tracker.onStepStart, onStepEnd: tracker.onStepEnd,
    });
    const outcome = input.abortSignal?.aborted ? 'aborted' : result.finishReason === 'stop' ? 'completed' : 'failed';
    await tracker.finish({ outcome, rawUsage: extractAiSdkUsageFields(result.usage), finishReason: result.finishReason });
    return { outcome };
  } catch {
    const outcome = input.abortSignal?.aborted ? 'aborted' : 'failed';
    await tracker.finish({ outcome });
    return { outcome };
  }
}
