import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { PLAY_CHARACTER_CHECK_INSTRUCTION, formatPlayCharacterCheckMaterial } from '@oh-awesome-novel/core';
import type { LlmProviderConfig, PlayCharacterCheckMaterial } from '@oh-awesome-novel/core';
import type { AiSdkProviderResolver } from './index.js';
import { assertModelRequestBudget } from './context-budget.js';
import { createSpecializedUsageTracker } from './specialized-usage-tracker.js';
import { extractAiSdkUsageFields } from './usage-governance.js';

const OUTPUT_RESERVE_TOKENS = 2048;

/**
 * One explicit, tool-less call over the host's fixed window. The model sees
 * the checked narrative and the frozen character material and nothing else
 * from the session. The reply is returned as text; the host verifies it.
 */
export async function runPlayCharacterCheck(input: { material: PlayCharacterCheckMaterial; workspaceRoot: string;
  provider: LlmProviderConfig; resolveModel: AiSdkProviderResolver; signal: AbortSignal }): Promise<string> {
  const { material } = input;
  const prompt = formatPlayCharacterCheckMaterial(material);
  const request = { messages: [{ role: 'system' as const, content: PLAY_CHARACTER_CHECK_INSTRUCTION }, { role: 'user' as const, content: prompt }], tools: {} };
  await assertModelRequestBudget(request, input.provider, { outputReserveTokens: OUTPUT_RESERVE_TOKENS });
  const traceId = material.target.kind === 'turn' ? material.target.turnId : material.target.attemptId;
  const tracker = createSpecializedUsageTracker({ workspaceRoot: input.workspaceRoot, sessionId: 'play-' + material.sessionId, provider: input.provider,
    usageOperation: { domain: 'play', stage: 'characterCheck', operationId: 'character-check-' + randomUUID(), sessionId: material.sessionId, contextTraceId: traceId },
    systemPrompt: PLAY_CHARACTER_CHECK_INSTRUCTION, frozenSystemPrompt: PLAY_CHARACTER_CHECK_INSTRUCTION, userPrompt: prompt,
    sourceId: 'characterCheckMaterial', sourceKind: 'characterCheck', budgetOptions: { outputReserveTokens: OUTPUT_RESERVE_TOKENS } });
  try {
    const result = await generateText({ model: await input.resolveModel(input.provider), instructions: PLAY_CHARACTER_CHECK_INSTRUCTION, prompt,
      maxRetries: 0, maxOutputTokens: OUTPUT_RESERVE_TOKENS, abortSignal: input.signal, onStepStart: tracker.onStepStart, onStepEnd: tracker.onStepEnd });
    await tracker.finish({ outcome: 'completed', rawUsage: extractAiSdkUsageFields(result.usage), finishReason: result.finishReason });
    return result.text;
  } catch (error) {
    await tracker.finish({ outcome: input.signal.aborted ? 'aborted' : 'failed' });
    throw error;
  }
}
