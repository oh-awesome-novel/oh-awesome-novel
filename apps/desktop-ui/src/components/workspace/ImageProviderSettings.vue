<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue';

import { COMFY_WORKFLOW_SLOTS, useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  ComfyWorkflowMapping,
  ComfyWorkflowSlot,
  ImageProviderKind,
  ImageProviderSaveInput,
  ImageProviderView,
} from '../../composables/useWorkspaceApi';

const api = useWorkspaceApi();

const KIND_LABEL: Record<ImageProviderKind, string> = {
  comfyui: 'ComfyUI（本机或自己的服务器）',
  openai: 'OpenAI 图片 API',
  'openai-compatible': '兼容 OpenAI 图片接口的服务',
};
const KIND_DEFAULTS: Record<ImageProviderKind, { id: string; baseUrl: string; model: string }> = {
  comfyui: { id: 'comfyui', baseUrl: 'http://127.0.0.1:8188', model: '' },
  openai: { id: 'openai-image', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
  'openai-compatible': { id: 'image-api', baseUrl: '', model: '' },
};
const SLOT_LABEL: Record<ComfyWorkflowSlot, string> = {
  positive: '正向提示词', negative: '负向提示词', seed: '种子', width: '宽', height: '高', batch: '张数', lora: 'LoRA 文件名',
};

const providers = shallowRef<ImageProviderView[]>([]);
const loading = shallowRef(true);
const saving = shallowRef(false);
const error = shallowRef('');
const notice = shallowRef('');
const editingId = shallowRef('');
const checking = shallowRef('');
const checkResults = shallowRef<Record<string, { ok: boolean; message: string }>>({});

function emptyMapping(): Record<ComfyWorkflowSlot, { node: string; input: string }> {
  return Object.fromEntries(COMFY_WORKFLOW_SLOTS.map(slot => [slot, { node: '', input: '' }])) as Record<ComfyWorkflowSlot, { node: string; input: string }>;
}
const form = reactive({
  kind: 'comfyui' as ImageProviderKind,
  id: KIND_DEFAULTS.comfyui.id,
  displayName: '',
  baseUrl: KIND_DEFAULTS.comfyui.baseUrl,
  model: '',
  apiKey: '',
  defaultWidth: 768,
  defaultHeight: 1152,
  defaultNegative: '',
  timeoutSeconds: 120,
  allowRemote: false,
  workflowText: '',
  workflowName: '',
  mapping: emptyMapping(),
});

const editing = computed(() => providers.value.find(provider => provider.id === editingId.value));
const isComfy = computed(() => form.kind === 'comfyui');
const remoteAddress = computed(() => {
  try {
    const host = new URL(form.baseUrl.trim()).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host));
  } catch {
    return false;
  }
});
const canSave = computed(() => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(form.id.trim()) && Boolean(form.baseUrl.trim())
  && (isComfy.value ? (!remoteAddress.value || form.allowRemote) : Boolean(form.model.trim())));

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    providers.value = (await api.listImageProviders()).providers;
    error.value = '';
  } catch (caught) {
    error.value = message(caught);
  } finally {
    loading.value = false;
  }
}

function startNew(kind: ImageProviderKind): void {
  editingId.value = '';
  Object.assign(form, {
    kind, ...KIND_DEFAULTS[kind], displayName: '', apiKey: '', defaultWidth: 768, defaultHeight: 1152,
    defaultNegative: '', timeoutSeconds: 120, allowRemote: false, workflowText: '', workflowName: '', mapping: emptyMapping(),
  });
  notice.value = '';
  error.value = '';
}

function edit(provider: ImageProviderView): void {
  editingId.value = provider.id;
  const mapping = emptyMapping();
  for (const slot of COMFY_WORKFLOW_SLOTS) {
    const target = provider.workflow?.mapping[slot];
    if (target) mapping[slot] = { ...target };
  }
  Object.assign(form, {
    kind: provider.kind, id: provider.id, displayName: provider.displayName, baseUrl: provider.baseUrl, model: provider.model ?? '',
    apiKey: '', defaultWidth: provider.defaultWidth, defaultHeight: provider.defaultHeight, defaultNegative: provider.defaultNegative ?? '',
    timeoutSeconds: Math.round(provider.timeoutMs / 1000), allowRemote: provider.allowRemote === true, workflowText: '', workflowName: '', mapping,
  });
  notice.value = '';
  error.value = '';
}

async function pickWorkflow(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 1024 * 1024) {
    error.value = '工作流文件超过 1 MiB。';
    return;
  }
  form.workflowText = await file.text();
  form.workflowName = file.name;
  error.value = '';
}

function mappingInput(): ComfyWorkflowMapping {
  const mapping: ComfyWorkflowMapping = {};
  for (const slot of COMFY_WORKFLOW_SLOTS) {
    const node = form.mapping[slot].node.trim();
    const input = form.mapping[slot].input.trim();
    if (node || input) mapping[slot] = { node, input };
  }
  return mapping;
}

async function save(): Promise<void> {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const input: ImageProviderSaveInput = {
      id: form.id.trim(),
      kind: form.kind,
      displayName: form.displayName.trim() || form.id.trim(),
      baseUrl: form.baseUrl.trim(),
      defaultWidth: Number(form.defaultWidth),
      defaultHeight: Number(form.defaultHeight),
      defaultNegative: form.defaultNegative,
      timeoutMs: Math.round(Number(form.timeoutSeconds) * 1000),
      ...(isComfy.value ? { allowRemote: form.allowRemote } : { model: form.model.trim() }),
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(isComfy.value && form.workflowText ? { workflowText: form.workflowText } : {}),
      // The mapping is sent with a new workflow, or to re-map the stored one.
      ...(isComfy.value && (form.workflowText || editing.value?.workflow) ? { workflowMapping: mappingInput() } : {}),
    };
    providers.value = (await api.saveImageProvider(input)).providers;
    const saved = providers.value.find(provider => provider.id === input.id);
    if (saved) edit(saved);
    notice.value = '已保存。';
  } catch (caught) {
    error.value = message(caught);
  } finally {
    saving.value = false;
  }
}

async function remove(provider: ImageProviderView): Promise<void> {
  if (!globalThis.confirm?.(`删除生图服务「${provider.displayName}」？它保存的 API Key 和工作流也会删除。`)) return;
  try {
    providers.value = (await api.deleteImageProvider(provider.id)).providers;
    if (editingId.value === provider.id) startNew('comfyui');
  } catch (caught) {
    error.value = message(caught);
  }
}

async function check(provider: ImageProviderView): Promise<void> {
  checking.value = provider.id;
  try {
    const result = await api.checkImageProvider(provider.id);
    checkResults.value = { ...checkResults.value, [provider.id]: { ok: result.ok, message: result.message } };
    providers.value = (await api.listImageProviders()).providers;
  } catch (caught) {
    checkResults.value = { ...checkResults.value, [provider.id]: { ok: false, message: message(caught) } };
  } finally {
    checking.value = '';
  }
}

function summary(provider: ImageProviderView): string {
  if (provider.kind !== 'comfyui') return `${provider.model ?? ''} · ${provider.hasApiKey ? '已保存 API Key' : '没有 API Key'}`;
  return provider.workflow ? `工作流已导入（${provider.workflow.slots.map(slot => SLOT_LABEL[slot]).join('、')}）` : '还没有导入工作流';
}

onMounted(load);
</script>

<template>
  <section class="image-provider-settings" aria-label="生图服务">
    <header class="settings-section-heading">
      <h2 class="panel-title">生图服务</h2>
      <p class="empty-copy">
        给角色立绘出图用。可以接本机的 ComfyUI，也可以接在线图片 API。配置、API Key 和工作流只保存在这台电脑的应用配置目录里，不会写进小说工作区。
      </p>
    </header>

    <p v-if="error" class="image-provider-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="image-provider-notice" role="status">{{ notice }}</p>

    <div class="model-workbench">
      <section class="settings-section">
        <p v-if="loading" class="empty-copy">正在读取生图服务…</p>
        <div v-else-if="providers.length" class="model-provider-stack">
          <article
            v-for="provider in providers"
            :key="provider.id"
            class="model-provider-card"
            :class="{ 'model-provider-card-active': provider.id === editingId }"
          >
            <div class="model-provider-card-main">
              <strong>{{ provider.displayName }}</strong>
              <span>{{ KIND_LABEL[provider.kind] }} · {{ provider.baseUrl }}</span>
              <small>{{ summary(provider) }}</small>
              <small v-if="checkResults[provider.id]" :class="checkResults[provider.id]!.ok ? 'image-provider-ok' : 'image-provider-bad'">
                {{ checkResults[provider.id]!.message }}
              </small>
              <small v-else-if="provider.lastError" class="image-provider-bad">
                最近一次失败（{{ new Date(provider.lastError.at).toLocaleString('zh-CN') }}）：{{ provider.lastError.message }}
              </small>
            </div>
            <div class="model-provider-card-actions">
              <button class="row-action-button" type="button" @click="edit(provider)">编辑</button>
              <button class="row-action-button" type="button" :disabled="checking === provider.id" @click="check(provider)">
                {{ checking === provider.id ? '测试中…' : '测试连通' }}
              </button>
              <button class="row-action-button row-action-danger" type="button" @click="remove(provider)">删除</button>
            </div>
          </article>
        </div>
        <p v-else class="empty-copy">还没有生图服务。</p>

        <div class="model-preset-row">
          <button class="secondary-button tight-button" type="button" @click="startNew('comfyui')">添加 ComfyUI</button>
          <button class="secondary-button tight-button" type="button" @click="startNew('openai')">添加 OpenAI 图片 API</button>
          <button class="secondary-button tight-button" type="button" @click="startNew('openai-compatible')">添加兼容接口</button>
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-heading">
          <h3 class="panel-title">{{ editing ? `编辑「${editing.displayName}」` : `新增：${KIND_LABEL[form.kind]}` }}</h3>
        </div>
        <form class="model-form" @submit.prevent="save">
          <label class="field">
            <span>服务 ID</span>
            <input v-model="form.id" class="text-input" type="text" name="image-provider-id" :disabled="Boolean(editing)" placeholder="comfyui">
          </label>
          <label class="field">
            <span>显示名称</span>
            <input v-model="form.displayName" class="text-input" type="text" name="image-provider-name" placeholder="书房的 ComfyUI">
          </label>
          <label class="field field-wide">
            <span>服务地址</span>
            <input v-model="form.baseUrl" class="text-input" type="url" name="image-provider-url" :placeholder="isComfy ? 'http://127.0.0.1:8188' : 'https://example.com/v1'">
          </label>
          <label v-if="isComfy && remoteAddress" class="field field-wide image-provider-check">
            <input v-model="form.allowRemote" type="checkbox" name="image-provider-allow-remote">
            <span>
              这个地址不在本机。允许把提示词和工作流发到这台机器
              <small>只在你自己控制这台 ComfyUI 时勾选。</small>
            </span>
          </label>
          <label v-if="!isComfy" class="field">
            <span>模型</span>
            <input v-model="form.model" class="text-input" type="text" name="image-provider-model" placeholder="gpt-image-1">
          </label>
          <label class="field">
            <span>API Key{{ isComfy ? '（可选）' : '' }}</span>
            <input
              v-model="form.apiKey"
              class="text-input"
              type="password"
              name="image-provider-key"
              autocomplete="off"
              :placeholder="editing?.hasApiKey ? '已保存；留空则不修改' : isComfy ? '给加了鉴权的 ComfyUI 用' : '只保存在本机'"
            >
          </label>
          <label class="field">
            <span>默认宽</span>
            <input v-model.number="form.defaultWidth" class="text-input" type="number" name="image-provider-width" min="64" max="4096" step="8">
          </label>
          <label class="field">
            <span>默认高</span>
            <input v-model.number="form.defaultHeight" class="text-input" type="number" name="image-provider-height" min="64" max="4096" step="8">
          </label>
          <label class="field">
            <span>超时（秒）</span>
            <input v-model.number="form.timeoutSeconds" class="text-input" type="number" name="image-provider-timeout" min="5" max="600">
          </label>
          <label class="field field-wide">
            <span>默认负面词</span>
            <textarea v-model="form.defaultNegative" class="text-input" rows="2" name="image-provider-negative" placeholder="lowres, bad anatomy"></textarea>
            <small v-if="!isComfy">在线图片 API 一般不接受负面词，这里的内容不会发给它们。</small>
          </label>

          <fieldset v-if="isComfy" class="field-wide image-provider-workflow">
            <legend>工作流</legend>
            <p class="empty-copy">
              在 ComfyUI 里用“导出（API）”保存工作流，再在这里导入。导入的工作流会在你的 ComfyUI 上原样执行，里面的节点能做什么由那台 ComfyUI 决定；这里只替换下面声明的几处，不改动其他节点。
            </p>
            <p v-if="editing?.workflow && !form.workflowText" class="empty-copy">
              当前工作流：{{ new Date(editing.workflow.importedAt).toLocaleString('zh-CN') }} 导入，指纹 {{ editing.workflow.sha256.slice(0, 12) }}
            </p>
            <label class="secondary-button tight-button image-provider-file">
              {{ form.workflowName ? `已选择 ${form.workflowName}` : editing?.workflow ? '换一个工作流文件' : '选择工作流文件' }}
              <input type="file" accept="application/json,.json" name="image-provider-workflow" @change="pickWorkflow">
            </label>
            <p class="empty-copy">
              告诉系统每项内容填到哪个节点的哪个输入；也可以不填，直接在工作流里写 <code v-pre>{{positive}}</code>、<code v-pre>{{seed}}</code> 这样的占位符。正向提示词必须有去处。
            </p>
            <div v-for="slot in COMFY_WORKFLOW_SLOTS" :key="slot" class="image-provider-slot">
              <span>{{ SLOT_LABEL[slot] }}</span>
              <input v-model="form.mapping[slot].node" class="text-input" type="text" :name="`image-provider-${slot}-node`" placeholder="节点 id，如 6" :aria-label="`${SLOT_LABEL[slot]}的节点 id`">
              <input v-model="form.mapping[slot].input" class="text-input" type="text" :name="`image-provider-${slot}-input`" placeholder="输入名，如 text" :aria-label="`${SLOT_LABEL[slot]}的输入名`">
            </div>
          </fieldset>

          <div class="model-actions field-wide">
            <button class="primary-button" type="submit" :disabled="saving || !canSave">{{ saving ? '保存中…' : '保存生图服务' }}</button>
          </div>
        </form>
      </section>
    </div>
  </section>
</template>

<style scoped>
.image-provider-settings { display: grid; gap: 12px; margin-top: 28px; }
.image-provider-error { color: var(--danger, #b42318); }
.image-provider-notice, .image-provider-ok { color: var(--success, #1a7f37); }
.image-provider-bad { color: var(--danger, #b42318); }
.image-provider-check { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 8px; }
.image-provider-check small { display: block; opacity: 0.75; }
.image-provider-workflow { display: grid; gap: 8px; border: 1px solid var(--hairline, #d0d5dd); border-radius: 6px; padding: 12px; }
.image-provider-file { position: relative; justify-self: start; overflow: hidden; cursor: pointer; }
.image-provider-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.image-provider-slot { display: grid; grid-template-columns: 7em 1fr 1fr; align-items: center; gap: 8px; }
@media (max-width: 680px) {
  .image-provider-slot { grid-template-columns: 1fr; }
}
</style>
