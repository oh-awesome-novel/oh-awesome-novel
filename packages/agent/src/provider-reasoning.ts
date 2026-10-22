import type { LlmProviderConfig, LlmReasoningEffort } from '@oh-awesome-novel/core';

/** The configured thinking effort for the provider's active model, if any. */
export function resolveProviderReasoningEffort(
  providerConfig: LlmProviderConfig,
): LlmReasoningEffort | undefined {
  return providerConfig.models?.find((model) => model.id === providerConfig.model)?.reasoningEffort;
}
