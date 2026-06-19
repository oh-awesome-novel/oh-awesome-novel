// ---------------------------------------------------------------------------
// LLM Provider Configuration
// ---------------------------------------------------------------------------
// Pure functions for managing LLM provider configs.
// `packages/core` maintains config state but does NOT call LLMs.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmProviderKind =
  | 'openai'
  | 'openai-compatible'
  | 'deepseek'
  | 'opencode-go'
  | 'xiaomi-mimo'
  | 'ollama'
  | 'custom';

export interface LlmProviderModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  default?: boolean;
}

export interface LlmProviderConfig {
  id: string;
  kind: LlmProviderKind;
  /** Current default model id for runtime compatibility. */
  model: string;
  /** Models configured under this provider. */
  models?: LlmProviderModel[];
  displayName?: string;
  baseUrl?: string;
  /** Direct API key stored in the app-level config. Redacted before returning to UI. */
  apiKey?: string;
  /** True when a redacted provider has a stored direct API key. */
  hasApiKey?: boolean;
  /** Environment variable name that holds the API key. */
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  default?: boolean;
}

export interface LlmProviderConfigState {
  providers: LlmProviderConfig[];
  defaultProviderId?: string;
}

// ---------------------------------------------------------------------------
// State operations
// ---------------------------------------------------------------------------

export const createEmptyLlmProviderConfigState =
  (): LlmProviderConfigState => ({
    providers: [],
  });

export const upsertLlmProviderConfig = (
  state: LlmProviderConfigState,
  provider: LlmProviderConfig,
): LlmProviderConfigState => {
  const normalizedProvider = normalizeLlmProviderConfig(provider);
  const existingIndex = state.providers.findIndex(
    (item) => item.id === normalizedProvider.id,
  );
  const nextProviders =
    existingIndex === -1
      ? [...state.providers, normalizedProvider]
      : state.providers.map((item, index) =>
          index === existingIndex ? normalizedProvider : item,
        );
  const defaultProviderId = normalizedProvider.default
    ? normalizedProvider.id
    : state.defaultProviderId ?? normalizedProvider.id;

  return withDefaultFlags(nextProviders, defaultProviderId);
};

export const removeLlmProviderConfig = (
  state: LlmProviderConfigState,
  providerId: string,
): LlmProviderConfigState => {
  const providers = state.providers.filter(
    (provider) => provider.id !== providerId,
  );
  const defaultProviderId =
    state.defaultProviderId === providerId
      ? providers[0]?.id
      : state.defaultProviderId;

  return withDefaultFlags(providers, defaultProviderId);
};

export const getLlmProviderConfig = (
  state: LlmProviderConfigState,
  providerId: string,
): LlmProviderConfig | undefined =>
  state.providers.find((provider) => provider.id === providerId);

export const getDefaultLlmProviderConfig = (
  state: LlmProviderConfigState,
): LlmProviderConfig | undefined => {
  if (state.defaultProviderId) {
    return getLlmProviderConfig(state, state.defaultProviderId);
  }

  return state.providers[0];
};

export const setDefaultLlmProviderConfig = (
  state: LlmProviderConfigState,
  providerId: string,
): LlmProviderConfigState => {
  if (!getLlmProviderConfig(state, providerId)) {
    throw new Error(`LLM provider config "${providerId}" does not exist.`);
  }

  return {
    ...withDefaultFlags(state.providers, providerId),
  };
};

function withDefaultFlags(
  providers: LlmProviderConfig[],
  defaultProviderId: string | undefined,
): LlmProviderConfigState {
  const validDefaultProviderId = providers.some(
    (provider) => provider.id === defaultProviderId,
  )
    ? defaultProviderId
    : providers[0]?.id;

  return {
    providers: providers.map((provider) => {
      const normalizedProvider = normalizeLlmProviderConfig(provider);

      return {
        ...normalizedProvider,
        default: normalizedProvider.id === validDefaultProviderId,
      };
    }),
    defaultProviderId: validDefaultProviderId,
  };
}

export const normalizeLlmProviderConfig = (
  provider: LlmProviderConfig,
): LlmProviderConfig => {
  const modelMap = new Map<string, LlmProviderModel>();

  for (const model of provider.models ?? []) {
    const id = model.id.trim();
    if (!id) {
      continue;
    }

    modelMap.set(id, {
      ...model,
      id,
      displayName: model.displayName?.trim() || undefined,
    });
  }

  const explicitDefaultModelId = provider.model?.trim()
    || [...modelMap.values()].find((model) => model.default)?.id
    || [...modelMap.keys()][0]
    || '';

  if (explicitDefaultModelId && !modelMap.has(explicitDefaultModelId)) {
    modelMap.set(explicitDefaultModelId, {
      id: explicitDefaultModelId,
    });
  }

  const models = [...modelMap.values()].map((model) => ({
    ...model,
    default: model.id === explicitDefaultModelId,
  }));

  return {
    ...provider,
    model: explicitDefaultModelId,
    models,
  };
};

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Returns a copy of the provider config with sensitive fields redacted.
 *
 * - `headers` values are replaced with `'[redacted]'`.
 * - `apiKey` is removed and represented as `hasApiKey`.
 * - `apiKeyEnv` is preserved for backward compatibility with old configs.
 */
export const redactLlmProviderConfig = (
  provider: LlmProviderConfig,
): LlmProviderConfig => {
  const { apiKey, ...redactedProvider } = provider;

  return {
    ...redactedProvider,
    ...normalizeLlmProviderConfig(redactedProvider),
    hasApiKey: Boolean(apiKey),
    headers: provider.headers
      ? Object.fromEntries(
          Object.keys(provider.headers).map((key) => [key, '[redacted]']),
        )
      : undefined,
  };
};
