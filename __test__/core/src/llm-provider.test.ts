import { describe, it, expect } from 'vitest';
import {
  createEmptyLlmProviderConfigState,
  upsertLlmProviderConfig,
  removeLlmProviderConfig,
  getLlmProviderConfig,
  getDefaultLlmProviderConfig,
  setDefaultLlmProviderConfig,
  redactLlmProviderConfig,
} from '@oh-awesome-novel/core';
import type {
  LlmProviderConfig,
  LlmProviderConfigState,
} from '@oh-awesome-novel/core';

describe('createEmptyLlmProviderConfigState', () => {
  it('returns an empty state', () => {
    const state = createEmptyLlmProviderConfigState();
    expect(state.providers).toEqual([]);
    expect(state.defaultProviderId).toBeUndefined();
  });
});

describe('upsertLlmProviderConfig', () => {
  const openaiProvider: LlmProviderConfig = {
    id: 'openai-gpt4',
    kind: 'openai',
    model: 'gpt-4o',
    displayName: 'GPT-4o',
    apiKey: 'openai-secret',
    default: true,
  };

  const deepseekProvider: LlmProviderConfig = {
    id: 'deepseek-chat',
    kind: 'deepseek',
    model: 'deepseek-chat',
    apiKey: 'deepseek-secret',
  };

  it('adds a provider to an empty state', () => {
    const state = createEmptyLlmProviderConfigState();
    const next = upsertLlmProviderConfig(state, openaiProvider);

    expect(next.providers).toHaveLength(1);
    expect(next.providers[0]).toEqual(openaiProvider);
    expect(next.defaultProviderId).toBe('openai-gpt4');
  });

  it('adds a second provider', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, openaiProvider);
    const s2 = upsertLlmProviderConfig(s1, deepseekProvider);

    expect(s2.providers).toHaveLength(2);
    expect(s2.defaultProviderId).toBe('openai-gpt4');
    expect(s2.providers.map((provider) => provider.default)).toEqual([
      true,
      false,
    ]);
  });

  it('updates an existing provider by id', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, openaiProvider);

    const updated: LlmProviderConfig = {
      ...openaiProvider,
      model: 'gpt-4o-mini',
    };
    const s2 = upsertLlmProviderConfig(s1, updated);

    expect(s2.providers).toHaveLength(1);
    expect(s2.providers[0].model).toBe('gpt-4o-mini');
  });

  it('sets defaultProviderId when default: true', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, openaiProvider);
    const s2 = upsertLlmProviderConfig(s1, {
      ...deepseekProvider,
      default: true,
    });

    expect(s2.defaultProviderId).toBe('deepseek-chat');
    expect(s2.providers).toMatchObject([
      { id: 'openai-gpt4', default: false },
      { id: 'deepseek-chat', default: true },
    ]);
  });

  it('preserves provider order when updating an existing provider', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, openaiProvider);
    const s2 = upsertLlmProviderConfig(s1, deepseekProvider);
    const s3 = upsertLlmProviderConfig(s2, {
      ...openaiProvider,
      model: 'gpt-4.1',
    });

    expect(s3.providers.map((provider) => provider.id)).toEqual([
      'openai-gpt4',
      'deepseek-chat',
    ]);
  });
});

describe('removeLlmProviderConfig', () => {
  it('removes a provider by id', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, {
      id: 'openai-gpt4',
      kind: 'openai',
      model: 'gpt-4o',
      apiKey: 'openai-secret',
    });
    const s2 = upsertLlmProviderConfig(s1, {
      id: 'deepseek-chat',
      kind: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'deepseek-secret',
    });

    const s3 = removeLlmProviderConfig(s2, 'openai-gpt4');
    expect(s3.providers).toHaveLength(1);
    expect(s3.providers[0].id).toBe('deepseek-chat');
  });

  it('falls back to first provider when default is removed', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, {
      id: 'p1',
      kind: 'openai',
      model: 'gpt-4o',
      default: true,
    });
    const s2 = upsertLlmProviderConfig(s1, {
      id: 'p2',
      kind: 'deepseek',
      model: 'deepseek-chat',
    });

    const s3 = removeLlmProviderConfig(s2, 'p1');
    expect(s3.defaultProviderId).toBe('p2');
    expect(s3.providers[0].default).toBe(true);
  });

  it('handles removing the only provider', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, {
      id: 'p1',
      kind: 'openai',
      model: 'gpt-4o',
    });
    const s2 = removeLlmProviderConfig(s1, 'p1');
    expect(s2.providers).toHaveLength(0);
    expect(s2.defaultProviderId).toBeUndefined();
  });
});

describe('getLlmProviderConfig', () => {
  it('returns the provider when found', () => {
    const state = createEmptyLlmProviderConfigState();
    const provider: LlmProviderConfig = {
      id: 'test-id',
      kind: 'openai',
      model: 'gpt-4o',
    };
    const s1 = upsertLlmProviderConfig(state, provider);
    expect(getLlmProviderConfig(s1, 'test-id')).toEqual({
      ...provider,
      default: true,
    });
  });

  it('returns undefined when not found', () => {
    const state = createEmptyLlmProviderConfigState();
    expect(getLlmProviderConfig(state, 'nonexistent')).toBeUndefined();
  });
});

describe('getDefaultLlmProviderConfig', () => {
  it('returns the default provider', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, {
      id: 'p1',
      kind: 'openai',
      model: 'gpt-4o',
    });
    const s2 = upsertLlmProviderConfig(s1, {
      id: 'p2',
      kind: 'deepseek',
      model: 'deepseek-chat',
      default: true,
    });

    const result = getDefaultLlmProviderConfig(s2);
    expect(result?.id).toBe('p2');
  });

  it('returns first provider when no default is set', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, {
      id: 'p1',
      kind: 'openai',
      model: 'gpt-4o',
    });

    const result = getDefaultLlmProviderConfig(s1);
    expect(result?.id).toBe('p1');
  });

  it('returns undefined for empty state', () => {
    const state = createEmptyLlmProviderConfigState();
    expect(getDefaultLlmProviderConfig(state)).toBeUndefined();
  });
});

describe('setDefaultLlmProviderConfig', () => {
  it('sets the default provider', () => {
    const state = createEmptyLlmProviderConfigState();
    const s1 = upsertLlmProviderConfig(state, {
      id: 'p1',
      kind: 'openai',
      model: 'gpt-4o',
    });
    const s2 = upsertLlmProviderConfig(s1, {
      id: 'p2',
      kind: 'deepseek',
      model: 'deepseek-chat',
    });

    const s3 = setDefaultLlmProviderConfig(s2, 'p2');
    expect(s3.defaultProviderId).toBe('p2');
    expect(s3.providers).toMatchObject([
      { id: 'p1', default: false },
      { id: 'p2', default: true },
    ]);
  });

  it('throws when setting a non-existent provider as default', () => {
    const state = createEmptyLlmProviderConfigState();
    expect(() => setDefaultLlmProviderConfig(state, 'nonexistent')).toThrow(
      'does not exist',
    );
  });
});

describe('redactLlmProviderConfig', () => {
  it('redacts header values and direct api keys', () => {
    const provider: LlmProviderConfig = {
      id: 'test',
      kind: 'openai-compatible',
      model: 'gpt-4o',
      apiKey: 'secret-api-key',
      headers: {
        'X-API-Key': 'secret-value',
        Authorization: 'Bearer token123',
      },
      apiKeyEnv: 'MY_API_KEY',
    };

    const redacted = redactLlmProviderConfig(provider);
    expect(redacted.headers?.['X-API-Key']).toBe('[redacted]');
    expect(redacted.headers?.['Authorization']).toBe('[redacted]');
    expect(redacted.apiKey).toBeUndefined();
    expect(redacted.hasApiKey).toBe(true);
    expect(redacted.apiKeyEnv).toBe('MY_API_KEY');
  });

  it('handles provider without headers', () => {
    const provider: LlmProviderConfig = {
      id: 'test',
      kind: 'openai',
      model: 'gpt-4o',
    };

    const redacted = redactLlmProviderConfig(provider);
    expect(redacted.headers).toBeUndefined();
  });
});
