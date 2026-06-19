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

const form = reactive<ProviderConfigInput>({
  id: 'default',
  kind: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: '',
  default: true,
});

const canSave = computed(() => Boolean(form.kind && form.model.trim() && form.apiKey?.trim()));

const providerOptions = [
  { kind: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  { kind: 'openai', label: 'OpenAI', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' },
  { kind: 'opencode-go', label: 'OpenCode Go', model: 'opencode-chat', baseUrl: 'https://api.opencodego.com/v1' },
  { kind: 'xiaomi-mimo', label: 'Xiaomi MiMo', model: 'mimo-v2.5', baseUrl: 'https://api.mimo.mi.com/v1' },
  { kind: 'custom', label: '自定义 OpenAI-compatible', model: '', baseUrl: '' },
];

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
        <label v-if="form.kind === 'custom'" class="field">
          <span>Base URL</span>
          <input v-model="form.baseUrl" class="text-input" type="url" placeholder="https://example.com/v1">
        </label>
        <label class="field field-wide">
          <span>API Key</span>
          <input v-model="form.apiKey" class="text-input" type="password" placeholder="直接填写 API key">
        </label>
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
