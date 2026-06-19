<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef, watch } from 'vue';

import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  ProviderCheckResult,
  ProviderConfigInput,
  ProviderConfigState,
  ProviderModelSummary,
} from '../../composables/useWorkspaceApi';

interface ProviderPreset {
  kind: string;
  label: string;
  defaultId: string;
  defaultModel: string;
  baseUrl?: string;
  custom?: boolean;
}

const emit = defineEmits<{
  saved: [configured: boolean];
}>();

const providerPresets: ProviderPreset[] = [
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    defaultId: 'deepseek',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com',
  },
  {
    kind: 'openai',
    label: 'OpenAI',
    defaultId: 'openai',
    defaultModel: 'gpt-4.1-mini',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    kind: 'opencode-go',
    label: 'OpenCode Go',
    defaultId: 'opencode-go',
    defaultModel: 'opencode-chat',
    baseUrl: 'https://api.opencodego.com/v1',
  },
  {
    kind: 'xiaomi-mimo',
    label: 'Xiaomi MiMo',
    defaultId: 'xiaomi-mimo',
    defaultModel: 'mimo-v2.5',
    baseUrl: 'https://api.mimo.mi.com/v1',
  },
  {
    kind: 'custom',
    label: '自定义 OpenAI-compatible',
    defaultId: 'custom',
    defaultModel: '',
    custom: true,
  },
];

const api = useWorkspaceApi();
const loading = shallowRef(false);
const saving = shallowRef(false);
const modelLoading = shallowRef(false);
const checking = shallowRef(false);
const error = shallowRef('');
const modelError = shallowRef('');
const checkError = shallowRef('');
const savedMessage = shallowRef('');
const editingId = shallowRef('');
const providerState = shallowRef<ProviderConfigState>({
  configured: false,
  providers: [],
});
const fetchedModels = shallowRef<ProviderModelSummary[]>([]);
const checkResult = shallowRef<ProviderCheckResult | null>(null);
const form = reactive<ProviderConfigInput>({
  id: 'deepseek',
  kind: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  default: true,
});

const currentProvider = computed(() => {
  const defaultId = providerState.value.defaultProviderId;

  return providerState.value.providers.find((provider) => provider.id === defaultId)
    ?? providerState.value.providers[0];
});
const savedProviderForCheck = computed(() => {
  const providerId = editingId.value || form.id;

  return providerState.value.providers.find((provider) => provider.id === providerId)
    ?? providerState.value.providers.find((provider) => provider.id === form.id);
});
const currentPreset = computed(() => providerPresets.find((preset) => preset.kind === form.kind));
const isCustomProvider = computed(() => Boolean(currentPreset.value?.custom));
const hasCheckApiKey = computed(() => Boolean(form.apiKey?.trim()) || Boolean(savedProviderForCheck.value?.hasApiKey));
const canSave = computed(() => {
  const hasApiKey = Boolean(form.apiKey?.trim())
    || Boolean(providerState.value.providers.find((provider) => provider.id === form.id)?.hasApiKey);

  return Boolean(form.kind && form.id.trim() && form.model.trim() && hasApiKey);
});
const canCheck = computed(() => Boolean(
  form.kind
    && form.model.trim()
    && hasCheckApiKey.value
    && (!isCustomProvider.value || form.baseUrl?.trim()),
));
const checkResultClass = computed(() => ({
  'model-check-panel-ok': checkResult.value?.ok,
  'model-check-panel-failed': Boolean(checkResult.value && !checkResult.value.ok),
}));
const checkResultSummary = computed(() => {
  const result = checkResult.value;

  if (!result) {
    return hasCheckApiKey.value ? '发送一次极短请求，确认当前模型配置可用。' : '填写 API Key 后可以检测模型。';
  }

  const status = result.status ? `HTTP ${result.status} · ` : '';
  return `${result.ok ? '可用' : '失败'} · ${status}${result.latencyMs}ms · ${result.message}`;
});

onMounted(() => {
  void loadProviderConfig();
});

watch(
  () => [form.kind, form.baseUrl, form.model, form.apiKey],
  () => resetCheckResult(),
);

async function loadProviderConfig() {
  loading.value = true;
  error.value = '';
  savedMessage.value = '';

  try {
    const state = await api.getProviderConfig();
    providerState.value = state;

    if (currentProvider.value) {
      editProvider(currentProvider.value.id);
    } else {
      startNewProvider(providerPresets[0]);
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

function startNewProvider(preset = providerPresets[0]) {
  editingId.value = '';
  fetchedModels.value = [];
  modelError.value = '';
  resetCheckResult();
  Object.assign(form, {
    id: uniqueProviderId(preset.defaultId),
    kind: preset.kind,
    displayName: preset.label,
    baseUrl: preset.baseUrl ?? '',
    model: preset.defaultModel,
    apiKey: '',
    default: providerState.value.providers.length === 0,
  });
}

function editProvider(id: string) {
  const provider = providerState.value.providers.find((item) => item.id === id);

  if (!provider) {
    return;
  }

  editingId.value = id;
  fetchedModels.value = [];
  modelError.value = '';
  resetCheckResult();
  Object.assign(form, {
    id: provider.id,
    kind: provider.kind,
    displayName: provider.displayName ?? provider.id,
    baseUrl: provider.baseUrl ?? providerPreset(provider.kind)?.baseUrl ?? '',
    model: provider.model,
    apiKey: '',
    default: provider.default,
  });
}

function applyProviderPreset() {
  const preset = providerPreset(form.kind);

  if (!preset) {
    return;
  }

  form.displayName = preset.label;
  form.baseUrl = preset.baseUrl ?? '';
  form.model = preset.defaultModel;
  if (!editingId.value || form.id === editingId.value) {
    form.id = uniqueProviderId(preset.defaultId, editingId.value);
  }
  fetchedModels.value = [];
  modelError.value = '';
  resetCheckResult();
}

async function saveProviderConfig() {
  if (!canSave.value) {
    return;
  }

  saving.value = true;
  error.value = '';
  savedMessage.value = '';

  try {
    const state = await api.saveProviderConfig({
      ...form,
      id: form.id.trim(),
      displayName: form.displayName?.trim() || form.id.trim(),
      baseUrl: form.baseUrl?.trim() || undefined,
      model: form.model.trim(),
      apiKey: form.apiKey?.trim() || undefined,
      default: Boolean(form.default),
    });
    providerState.value = state;
    savedMessage.value = '模型配置已保存。';
    emit('saved', state.configured);
    editProvider(form.id);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function setDefaultProvider(id: string) {
  saving.value = true;
  error.value = '';
  savedMessage.value = '';

  try {
    const state = await api.setDefaultProviderConfig(id);
    providerState.value = state;
    savedMessage.value = '默认模型已切换。';
    emit('saved', state.configured);
    editProvider(id);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function deleteProvider(id: string) {
  saving.value = true;
  error.value = '';
  savedMessage.value = '';

  try {
    const state = await api.deleteProviderConfig(id);
    providerState.value = state;
    savedMessage.value = 'Provider 已删除。';
    emit('saved', state.configured);
    if (currentProvider.value) {
      editProvider(currentProvider.value.id);
    } else {
      startNewProvider(providerPresets[0]);
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function fetchCustomModels() {
  modelLoading.value = true;
  modelError.value = '';
  fetchedModels.value = [];

  try {
    const result = await api.listProviderModels({
      baseUrl: form.baseUrl?.trim() ?? '',
      apiKey: form.apiKey?.trim() || undefined,
    });
    fetchedModels.value = result.models;

    if (!form.model && result.models[0]) {
      form.model = result.models[0].id;
    }
  } catch (caught) {
    modelError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    modelLoading.value = false;
  }
}

async function checkProviderConfig() {
  if (!canCheck.value) {
    return;
  }

  checking.value = true;
  checkError.value = '';
  checkResult.value = null;

  try {
    checkResult.value = await api.checkProviderConfig({
      providerId: editingId.value || form.id.trim(),
      kind: form.kind,
      baseUrl: form.baseUrl?.trim() || undefined,
      model: form.model.trim(),
      apiKey: form.apiKey?.trim() || undefined,
    });
  } catch (caught) {
    checkError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    checking.value = false;
  }
}

function resetCheckResult() {
  checkError.value = '';
  checkResult.value = null;
}

function providerPreset(kind: string | undefined): ProviderPreset | undefined {
  return providerPresets.find((preset) => preset.kind === kind);
}

function providerLabel(kind: string): string {
  return providerPreset(kind)?.label ?? kind;
}

function uniqueProviderId(baseId: string, currentId = ''): string {
  const existingIds = new Set(
    providerState.value.providers
      .map((provider) => provider.id)
      .filter((id) => id !== currentId),
  );

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}
</script>

<template>
  <section class="launcher-main model-main" aria-label="LLM Provider config">
    <header class="settings-page-header">
      <p class="eyebrow">Model</p>
      <h1 class="settings-title">模型</h1>
      <p class="launcher-copy">配置多个 LLM Provider 后，可以在默认模型之间切换，workspace 内的 Copilot 会使用当前默认配置。</p>
    </header>

    <section class="model-status-section">
      <div class="status-block">
        <span>Provider</span>
        <strong>{{ providerState.configured ? `${providerState.providers.length} 个` : '未配置' }}</strong>
      </div>
      <div class="status-block">
        <span>默认模型</span>
        <strong>{{ currentProvider?.model ?? '未选择' }}</strong>
      </div>
      <div class="status-block">
        <span>API Key</span>
        <strong>{{ currentProvider?.hasApiKey ? '已保存' : '未设置' }}</strong>
      </div>
    </section>

    <div class="model-workbench">
      <section class="settings-section model-provider-list">
        <div class="settings-section-heading">
          <h2 class="panel-title">Provider 列表</h2>
          <p class="empty-copy">选择一个配置进行编辑，或切换默认 provider。</p>
        </div>

        <p v-if="loading" class="empty-copy">正在读取模型配置…</p>
        <div v-else-if="providerState.providers.length" class="model-provider-stack">
          <article
            v-for="provider in providerState.providers"
            :key="provider.id"
            class="model-provider-card"
            :class="{ 'model-provider-card-active': provider.id === editingId }"
          >
            <div class="model-provider-card-main">
              <strong>{{ provider.displayName ?? provider.id }}</strong>
              <span>{{ providerLabel(provider.kind) }} · {{ provider.model }}</span>
              <small>{{ provider.hasApiKey ? 'API key 已保存' : '缺少 API key' }}</small>
            </div>
            <div class="model-provider-card-actions">
              <span v-if="provider.default" class="status-pill">默认</span>
              <button class="row-action-button" type="button" @click="editProvider(provider.id)">
                编辑
              </button>
              <button
                class="row-action-button"
                type="button"
                :disabled="provider.default || saving"
                @click="setDefaultProvider(provider.id)"
              >
                设为默认
              </button>
              <button
                class="row-action-button row-action-danger"
                type="button"
                :disabled="saving"
                @click="deleteProvider(provider.id)"
              >
                删除
              </button>
            </div>
          </article>
        </div>
        <p v-else class="empty-copy">还没有模型配置。先从右侧添加一个 provider。</p>

        <div class="model-preset-row">
          <button
            v-for="preset in providerPresets"
            :key="preset.kind"
            class="secondary-button tight-button"
            type="button"
            @click="startNewProvider(preset)"
          >
            添加 {{ preset.label }}
          </button>
        </div>
      </section>

      <section class="settings-section model-config-section">
        <div class="settings-section-heading">
          <h2 class="panel-title">{{ editingId ? '编辑 Provider' : '新增 Provider' }}</h2>
          <p class="empty-copy">常见提供方只需要填写 API key；自定义 provider 需要兼容 OpenAI 消息格式。</p>
        </div>

        <form class="model-form" @submit.prevent="saveProviderConfig">
          <label class="field" for="provider-kind-input">
            <span>Provider 类型</span>
            <select
              id="provider-kind-input"
              v-model="form.kind"
              class="text-input"
              @change="applyProviderPreset"
            >
              <option
                v-for="preset in providerPresets"
                :key="preset.kind"
                :value="preset.kind"
              >
                {{ preset.label }}
              </option>
            </select>
          </label>

          <label class="field" for="provider-id-input">
            <span>Provider ID</span>
            <input
              id="provider-id-input"
              v-model="form.id"
              class="text-input"
              type="text"
              placeholder="deepseek"
            >
          </label>

          <label class="field" for="provider-display-name-input">
            <span>显示名称</span>
            <input
              id="provider-display-name-input"
              v-model="form.displayName"
              class="text-input"
              type="text"
              placeholder="DeepSeek"
            >
          </label>

          <label class="field" for="provider-model-input">
            <span>Model</span>
            <input
              id="provider-model-input"
              v-model="form.model"
              class="text-input"
              type="text"
              list="provider-model-options"
              placeholder="deepseek-chat"
            >
          </label>

          <label v-if="isCustomProvider" class="field field-wide" for="provider-base-url-input">
            <span>Base URL</span>
            <input
              id="provider-base-url-input"
              v-model="form.baseUrl"
              class="text-input"
              type="url"
              placeholder="https://example.com/v1"
            >
          </label>

          <label class="field field-wide" for="provider-api-key-input">
            <span>API Key</span>
            <input
              id="provider-api-key-input"
              v-model="form.apiKey"
              class="text-input"
              type="password"
              :placeholder="editingId ? '留空则保留已保存 API key' : '直接填写 API key'"
            >
          </label>

          <datalist id="provider-model-options">
            <option
              v-for="model in fetchedModels"
              :key="model.id"
              :value="model.id"
            ></option>
          </datalist>

          <div v-if="isCustomProvider" class="model-fetch-row field-wide">
            <button
              class="secondary-button"
              type="button"
              :disabled="modelLoading || !form.baseUrl?.trim() || !form.apiKey?.trim()"
              @click="fetchCustomModels"
            >
              {{ modelLoading ? '拉取中…' : '拉取模型列表' }}
            </button>
            <span v-if="fetchedModels.length">{{ fetchedModels.length }} 个模型可选</span>
          </div>

          <label class="model-default-check field-wide">
            <input v-model="form.default" type="checkbox">
            <span>保存后设为默认 provider</span>
          </label>

          <div class="model-check-panel field-wide" :class="checkResultClass">
            <div class="model-check-copy">
              <strong>模型检测</strong>
              <span>{{ checkResultSummary }}</span>
            </div>
            <button
              class="secondary-button"
              type="button"
              :disabled="checking || !canCheck"
              @click="checkProviderConfig"
            >
              {{ checking ? '检测中…' : '检测模型' }}
            </button>
          </div>

          <p v-if="checkError" class="error-copy field-wide">{{ checkError }}</p>
          <p v-if="modelError" class="error-copy field-wide">{{ modelError }}</p>
          <p v-if="error" class="error-copy field-wide">{{ error }}</p>
          <p v-if="savedMessage" class="success-copy field-wide">{{ savedMessage }}</p>

          <div class="model-actions field-wide">
            <button class="secondary-button" type="button" :disabled="loading || saving" @click="loadProviderConfig">
              重新读取
            </button>
            <button class="primary-button" type="submit" :disabled="saving || !canSave">
              保存 Provider
            </button>
          </div>
        </form>
      </section>
    </div>
  </section>
</template>
