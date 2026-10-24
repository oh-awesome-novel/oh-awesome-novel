import { randomUUID } from 'node:crypto';
import { extractAiSdkUsageFields, recordSpecializedModelUsageTurn } from './usage-governance.js';
import { generateText } from 'ai';
import { formatNovelLintReviewPrompt, parseNovelLintReviewResponse, validateNovelLintReplacements } from '@oh-awesome-novel/core';
import type { LlmProviderConfig, LintReplacement } from '@oh-awesome-novel/core';
import type { AiSdkProviderResolver } from './index.js';
export async function generateNovelLintReview(input: {source:string; sourceHash:string; workspaceRoot?:string; sourcePath?:string; providerConfig:LlmProviderConfig; resolveModel:AiSdkProviderResolver; abortSignal?:AbortSignal}): Promise<LintReplacement[]> {
  if (input.source.length > 100_000) throw new Error('LINT review is limited to 100,000 characters; choose a smaller source.');
  const prompt = formatNovelLintReviewPrompt(input.source);
  const result = await generateText({ model:await input.resolveModel(input.providerConfig), prompt,
    maxOutputTokens:8192,maxRetries:0,abortSignal:input.abortSignal });
  await recordSpecializedModelUsageTurn({workspaceRoot:input.workspaceRoot,sessionId:`lint-${randomUUID()}`,provider:input.providerConfig,
    systemPrompt:'',userPrompt:prompt,sourceId:`lint:${input.sourceHash}`,sourceKind:'novelLint',sourcePath:input.sourcePath,sourceHash:input.sourceHash,
    rawUsage:extractAiSdkUsageFields(result.usage),finishReason:result.finishReason,outcome:result.finishReason==='stop'?'completed':'failed'});
  if (result.finishReason !== 'stop') throw new Error('LINT review did not finish; retry the review.');
  return validateNovelLintReplacements(input.source,input.sourceHash,parseNovelLintReviewResponse(result.text));
}
