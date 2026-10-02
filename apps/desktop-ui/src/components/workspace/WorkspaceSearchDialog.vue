<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import type { WorkspaceSearchResponse } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import { useWorkspaceDialog } from '../../composables/useWorkspaceDialog';
const props = defineProps<{ workspacePath: string; refreshVersion: number }>();
const emit = defineEmits<{ close: []; openFile: [hit: { path: string; line: number }] }>();
const api = useWorkspaceApi();
const panel = shallowRef<HTMLElement | null>(null);
const query = shallowRef('');
const result = shallowRef<WorkspaceSearchResponse>();
const loading = shallowRef(false);
const error = shallowRef('');
const { keydown } = useWorkspaceDialog(panel, () => emit('close'));
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
async function search() {
  clearTimeout(timer);
  const request = ++sequence;
  const workspace = props.workspacePath;
  const q = query.value.trim();
  result.value = undefined; error.value = '';
  if (!q) { loading.value = false; return; }
  loading.value = true;
  try {
    const response = await api.searchWorkspace(q);
    if (request === sequence && workspace === props.workspacePath) result.value = response;
  } catch (cause) {
    if (request === sequence) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { if (request === sequence) loading.value = false; }
}
watch(query, () => {
  ++sequence; result.value = undefined; error.value = ''; loading.value = Boolean(query.value.trim());
  clearTimeout(timer); timer = setTimeout(() => { void search(); }, 200);
});
watch(() => props.workspacePath, () => { ++sequence; query.value = ''; result.value = undefined; loading.value = false; });
watch(() => props.refreshVersion, () => { void search(); });
onBeforeUnmount(() => { ++sequence; clearTimeout(timer); });
</script>

<template>
  <div class="search-overlay" role="dialog" aria-modal="true" aria-label="Workspace search" @click.self="emit('close')" @keydown="keydown">
    <section ref="panel" class="search-panel">
      <form class="search-panel-header" @submit.prevent="search">
        <input v-model="query" class="search-input" type="search" maxlength="160" placeholder="搜索正文、标题或路径" aria-label="Search files">
        <button class="icon-button" type="button" aria-label="Close search" @click="emit('close')">×</button>
      </form>
      <div class="search-freshness">
        <span>每次查询重新读取已保存文件。外部编辑、删除或重命名后请刷新。</span>
        <button class="ghost-button" type="button" :disabled="!query.trim() || loading" @click="search">刷新结果</button>
      </div>
      <p v-if="loading" class="empty-copy" role="status">正在搜索正文…</p>
      <p v-else-if="error" class="error-copy" role="alert">{{ error }}</p>
      <p v-else-if="!query.trim()" class="empty-copy">输入中文短语、角色名或英文，搜索当前工程。</p>
      <template v-else-if="result">
        <p class="search-meta" role="status">{{ result.results.length }} 个匹配文件 · 扫描 {{ result.scannedFiles }} 个文件 · {{ new Date(result.scannedAt).toLocaleTimeString() }}</p>
        <p v-if="result.truncated" class="empty-copy">仅显示前 100 个匹配文件，请缩小搜索范围。</p>
        <div class="search-results" aria-label="Search results">
          <button v-for="hit in result.results" :key="hit.path" class="search-result" type="button" @click="emit('openFile', { path: hit.path, line: hit.line })">
            <strong>{{ hit.name }} <small>第 {{ hit.line }} 行</small></strong>
            <span>{{ hit.path }} · {{ hit.domain }}</span>
            <span class="search-snippet">{{ hit.snippet }}</span>
          </button>
          <p v-if="!result.results.length" class="empty-copy">No matches · 没有匹配的正文或路径</p>
        </div>
      </template>
    </section>
  </div>
</template>
<style scoped>
.search-freshness { display: flex; align-items: center; gap: 12px; padding: 12px 16px; font-size: 12px; }
.search-freshness span { flex: 1; }
.search-freshness button { flex-shrink: 0; }
.search-meta { padding: 0 16px; font-size: 12px; }
.search-result .search-snippet { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; }
.search-result small { font-weight: normal; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent, #3c796e); outline-offset: 2px; }
</style>
