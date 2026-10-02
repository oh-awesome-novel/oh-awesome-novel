import type { LlmProviderConfig } from '@oh-awesome-novel/core';
import type { RuntimeModelRequest } from '@oh-awesome-novel/runtime';
import { estimateRuntimeModelRequest } from '@oh-awesome-novel/runtime';
import { estimateTextTokens } from '@oh-awesome-novel/core/agent-usage';

/** A deliberately conservative estimate, not a tokenizer or billing measure. */
export function estimateContextTokens(text: string): number {
  return estimateTextTokens(text);
}

export interface ContextBudgetOptions {
  maxEstimatedInputTokens?: number;
  outputReserveTokens?: number;
}

export function resolveContextBudget(provider: LlmProviderConfig, options: ContextBudgetOptions = {}) {
  for (const value of [options.maxEstimatedInputTokens, options.outputReserveTokens]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('Explicit context budgets must be positive safe integers.');
  }
  const model = provider.models?.find((entry) => entry.id === provider.model);
  const maxOutputTokens = positiveInteger(model?.maxOutputTokens) ?? options.outputReserveTokens;
  const window = positiveInteger(model?.contextWindow);
  const configured = window !== undefined && maxOutputTokens !== undefined ? Math.max(0, window - maxOutputTokens) : undefined;
  const candidates = [options.maxEstimatedInputTokens, configured].filter((v): v is number => v !== undefined);
  return { maxOutputTokens, inputTokens: candidates.length ? Math.min(...candidates) : undefined };
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

export async function assertModelRequestBudget(
  request: RuntimeModelRequest,
  provider: LlmProviderConfig,
  options: ContextBudgetOptions = {},
): Promise<void> {
  const budget = resolveContextBudget(provider, options);
  if (budget.inputTokens === undefined) return;
  const estimate = (await estimateRuntimeModelRequest(request)).estimatedRequestTokens;
  if (estimate > budget.inputTokens) throw new ContextBudgetExceededError(estimate, budget.inputTokens);
}

function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value : undefined;
}
