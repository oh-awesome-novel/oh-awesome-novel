<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import { useWorkspaceDialog } from '../../composables/useWorkspaceDialog';
const props = defineProps<{ workspacePath: string }>();
const emit = defineEmits<{ close: [] }>();
const api = useWorkspaceApi();
const panel = shallowRef<HTMLElement | null>(null);
const busy = shallowRef(false); const error = shallowRef(''); const status = shallowRef('');
const { keydown } = useWorkspaceDialog(panel, () => emit('close'));
let sequence = 0;
watch(() => props.workspacePath, () => { ++sequence; busy.value = false; error.value = ''; status.value = ''; });
onBeforeUnmount(() => { ++sequence; });
async function download(format: 'md' | 'txt') {
  if (busy.value) return;
  const request = ++sequence; const workspace = props.workspacePath;
  busy.value = true; error.value = ''; status.value = '';
  try {
    const result = await api.exportManuscript(format);
    if (request !== sequence || workspace !== props.workspacePath) return;
    const url = URL.createObjectURL(new Blob([result.content], { type: `${format === 'md' ? 'text/markdown' : 'text/plain'};charset=utf-8` }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = result.fileName; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.value = `已发起下载：${result.chapterPaths.length} 章 · ${result.fileName}`;
  } catch (cause) { if (request === sequence) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (request === sequence) busy.value = false; }
}
</script>
<template>
  <div class="search-overlay" role="dialog" aria-modal="true" aria-label="Export manuscript" @click.self="emit('close')" @keydown="keydown">
    <section ref="panel" class="search-panel manuscript-export">
      <header><h2>导出正文</h2><button class="icon-button" type="button" aria-label="Close export" @click="emit('close')">×</button></header>
      <p>按卷号、章节号导出已保存正文，保留章节标题，去除 YAML 元数据。不包含摘要、设定、参考资料、Play 或尚未接受的草稿。</p>
      <p>点击后下载带时间戳的新文件，保存位置和同名覆盖由浏览器的下载设置或保存对话框控制。不会修改工程文件。TXT 保留正文中的 Markdown 标记，仅去除标题前缀。</p>
      <div class="export-actions">
        <button class="primary-button" type="button" :disabled="busy" @click="download('md')">下载 Markdown</button>
        <button class="ghost-button" type="button" :disabled="busy" @click="download('txt')">下载 TXT</button>
      </div>
      <p v-if="busy" role="status">正在读取已保存正文…</p>
      <p v-if="status" role="status">{{ status }}</p>
      <p v-if="error" class="error-copy" role="alert">{{ error }}</p>
    </section>
  </div>
</template>
<style scoped>
.manuscript-export { padding: 24px; overflow-y: auto; }
header, .export-actions { display: flex; align-items: center; gap: 12px; }
header { justify-content: space-between; }
p { margin: 16px 0; line-height: 1.7; }
button:focus-visible { outline: 2px solid var(--accent, #3c796e); outline-offset: 2px; }
</style>
