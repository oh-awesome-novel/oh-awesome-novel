export type LlmProviderKind =
  | 'openai'
  | 'openai-compatible'
  | 'deepseek'
  | 'custom';

export interface LlmProviderConfig {
  id: string;
  kind: LlmProviderKind;
  model: string;
  displayName?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  default?: boolean;
}

export interface LlmProviderConfigState {
  providers: LlmProviderConfig[];
  defaultProviderId?: string;
}

export const createEmptyLlmProviderConfigState =
  (): LlmProviderConfigState => ({
    providers: [],
  });

export const upsertLlmProviderConfig = (
  state: LlmProviderConfigState,
  provider: LlmProviderConfig,
): LlmProviderConfigState => {
  const providers = state.providers.filter(
    (item) => item.id !== provider.id,
  );
  const nextProviders = [...providers, provider];

  return {
    providers: nextProviders,
    defaultProviderId: provider.default
      ? provider.id
      : state.defaultProviderId ?? provider.id,
  };
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

  return {
    providers,
    defaultProviderId,
  };
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
    ...state,
    defaultProviderId: providerId,
  };
};

export const redactLlmProviderConfig = (
  provider: LlmProviderConfig,
): LlmProviderConfig => ({
  ...provider,
  headers: provider.headers
    ? Object.fromEntries(
        Object.keys(provider.headers).map((key) => [key, '[redacted]']),
      )
    : undefined,
});
