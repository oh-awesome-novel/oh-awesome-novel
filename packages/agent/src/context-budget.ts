import type { LlmProviderConfig } from '@oh-awesome-novel/core';
import type { RuntimeModelRequest } from '@oh-awesome-novel/runtime';

/** A deliberately conservative estimate, not a tokenizer or billing measure. */
export function estimateContextTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}

export function resolveContextBudget(provider: LlmProviderConfig) {
  const model = provider.models?.find((entry) => entry.id === provider.model);
  const maxOutputTokens = positiveInteger(model?.maxOutputTokens);
  const window = positiveInteger(model?.contextWindow);
  // Without an explicit output limit there is no honest input budget to enforce.
  const inputTokens = window !== undefined && maxOutputTokens !== undefined
    ? Math.max(0, window - maxOutputTokens)
    : undefined;
  return { maxOutputTokens, inputTokens };
}

export class ContextBudgetExceededError extends Error {
  readonly code = 'CONTEXT_INPUT_OVERFLOW';
  readonly estimatedTokens: number;
  readonly budgetTokens: number;

  constructor(estimatedTokens: number, budgetTokens: number) {
    super(`Context input estimate ${estimatedTokens} exceeds budget ${budgetTokens}. Narrow the selected context or conversation, or adjust the model context/output configuration. Estimates are not exact token counts.`);
    this.name = 'ContextBudgetExceededError';
    this.estimatedTokens = estimatedTokens;
    this.budgetTokens = budgetTokens;
  }
}

export function assertModelRequestBudget(
  request: RuntimeModelRequest,
  provider: LlmProviderConfig,
): void {
  const budget = resolveContextBudget(provider);
  if (budget.inputTokens === undefined) return;
  // Include history, tool arguments/results and visible schema descriptions on
  // every step. Functions/provider overhead cannot be measured exactly here.
  const tools = Object.fromEntries(Object.entries(request.tools).map(([name, tool]) => [name, {
    description: tool.description,
    inputSchema: tool.inputSchema,
  }]));
  const estimate = Math.ceil(estimateContextTokens(JSON.stringify({
    messages: request.messages,
    tools,
  })) * 1.2);
  if (estimate > budget.inputTokens) {
    throw new ContextBudgetExceededError(estimate, budget.inputTokens);
  }
}

function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value : undefined;
}
