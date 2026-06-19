<script setup lang="ts">
import { reactive, computed } from 'vue';

import type { ProviderConfigInput } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  open: boolean;
  workspaceName?: string;
  saving: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  save: [provider: ProviderConfigInput];
  skip: [];
  cancel: [];
}>();

interface ProviderOption {
  kind: string;
  label: string;
  model: string;
  baseUrl: string;
  local?: boolean;
}

const form = reactive<ProviderConfigInput>({
  id: 'default',
  kind: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  default: true,
});

const providerOptions: ProviderOption[] = [
  { kind: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  { kind: 'openai', label: 'OpenAI', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' },
  { kind: 'opencode-go', label: 'OpenCode Go', model: 'opencode-chat', baseUrl: 'https://api.opencodego.com/v1' },
  { kind: 'xiaomi-mimo', label: 'Xiaomi MiMo', model: 'mimo-v2.5', baseUrl: 'https://api.mimo.mi.com/v1' },
  { kind: 'ollama', label: 'Ollama', model: '', baseUrl: 'http://127.0.0.1:11434/v1', local: true },
  { kind: 'custom', label: '自定义 OpenAI-compatible', model: '', baseUrl: '' },
];

const currentProviderOption = computed(() =>
  providerOptions.find((option) => option.kind === form.kind));
const providerNeedsApiKey = computed(() => !currentProviderOption.value?.local);
const canSave = computed(() => Boolean(
  form.kind
    && form.model.trim()
    && (!providerNeedsApiKey.value || form.apiKey?.trim()),
));

function save() {
  if (!canSave.value) {
    return;
  }

  emit('save', { ...form });
}

function applyProviderPreset() {
  const preset = providerOptions.find((option) => option.kind === form.kind);

  if (!preset) {
    return;
  }

  form.displayName = preset.label;
  form.baseUrl = preset.baseUrl;
  form.model = preset.model;
  if (preset.local) {
    form.apiKey = '';
  }
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" role="presentation">
    <section class="provider-modal" role="dialog" aria-modal="true" aria-label="LLM provider config">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Provider gate</p>
          <h2 class="panel-title">配置 LLM Provider</h2>
        </div>
        <button class="icon-button" type="button" aria-label="关闭配置窗口" @click="emit('cancel')">
          ×
        </button>
      </div>

      <p class="form-copy">
        {{ props.workspaceName ? `进入 ${props.workspaceName} 前` : '进入 workspace 前' }}可以先配置 provider。也可以稍后配置，只读浏览仍然可用。
      </p>

      <div class="form-grid">
        <label class="field">
          <span>Provider 类型</span>
          <select v-model="form.kind" class="text-input" @change="applyProviderPreset">
            <option
              v-for="option in providerOptions"
              :key="option.kind"
              :value="option.kind"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>显示名称</span>
          <input v-model="form.displayName" class="text-input" type="text">
        </label>
        <label class="field">
          <span>Model</span>
          <input v-model="form.model" class="text-input" type="text">
        </label>
        <label v-if="form.kind === 'custom' || !providerNeedsApiKey" class="field">
          <span>Base URL</span>
          <input
            v-model="form.baseUrl"
            class="text-input"
            type="url"
            :placeholder="providerNeedsApiKey ? 'https://example.com/v1' : 'http://127.0.0.1:11434/v1'"
          >
        </label>
        <label v-if="providerNeedsApiKey" class="field field-wide">
          <span>API Key</span>
          <input v-model="form.apiKey" class="text-input" type="password" placeholder="直接填写 API key">
        </label>
        <p v-else class="empty-copy field-wide">
          本地 Ollama 不需要 API Key，确认 Ollama 服务正在运行，并填写已安装的模型名。
        </p>
      </div>

      <p v-if="error" class="error-copy">{{ error }}</p>

      <div class="modal-actions">
        <button class="secondary-button" type="button" :disabled="saving" @click="emit('skip')">
          稍后配置
        </button>
        <button class="primary-button" type="button" :disabled="saving || !canSave" @click="save">
          保存并进入
        </button>
      </div>
    </section>
  </div>
</template>
