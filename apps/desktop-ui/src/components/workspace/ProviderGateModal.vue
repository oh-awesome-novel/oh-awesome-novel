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
  baseUrl: '',
  model: 'deepseek-chat',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
});

const canSave = computed(() => Boolean(form.kind && form.model.trim()));

function save() {
  if (!canSave.value) {
    return;
  }

  emit('save', { ...form });
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
          <select v-model="form.kind" class="text-input">
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="custom">Custom</option>
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
        <label class="field">
          <span>Base URL</span>
          <input v-model="form.baseUrl" class="text-input" type="url" placeholder="可留空">
        </label>
        <label class="field field-wide">
          <span>API key 环境变量名</span>
          <input v-model="form.apiKeyEnv" class="text-input" type="text" placeholder="例如 DEEPSEEK_API_KEY">
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
