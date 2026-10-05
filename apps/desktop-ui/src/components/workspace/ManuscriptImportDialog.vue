<script setup lang="ts">
import { shallowRef } from 'vue';
import { MANUSCRIPT_IMPORT_MAX_BYTES } from '@oh-awesome-novel/client';
import { useWorkspaceDialog } from '../../composables/useWorkspaceDialog';
import { useManuscriptImport } from '../../composables/useManuscriptImport';
import ManuscriptImportMapping from './manuscript/ManuscriptImportMapping.vue';
import ManuscriptImportPreview from './manuscript/ManuscriptImportPreview.vue';
const props = defineProps<{ workspacePath: string }>();
const emit = defineEmits<{ close: []; proposed: [pendingActionId: string] }>();
const panel = shallowRef<HTMLElement | null>(null);
const { keydown } = useWorkspaceDialog(panel, () => emit('close'));
const state = useManuscriptImport(() => props.workspacePath, (id) => emit('proposed', id));
function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void state.readFile(file);
}
</script>
<template>
  <div class="search-overlay" role="dialog" aria-modal="true" aria-label="导入旧稿 Markdown" @click.self="emit('close')" @keydown="keydown">
    <section ref="panel" class="search-panel manuscript-import">
      <header><h2>导入旧稿 Markdown</h2><button class="icon-button" type="button" aria-label="关闭旧稿导入" @click="emit('close')">×</button></header>
      <p>将自己的 Markdown 原稿拆分为工程章节。单次最多 512 KiB、64 章，卷号和章号为 1–9999；大稿请分批导入。</p>
      <p>无需配置模型。预览后创建待审批导入，在审阅栏接受后才写入章节。</p>
      <form @submit.prevent="state.createPreview">
        <fieldset class="source-fields" :disabled="state.phase.value === 'proposing'">
          <legend>1. 选择文件或粘贴原稿</legend>
          <label for="manuscript-file">UTF-8 Markdown 文件</label>
          <input id="manuscript-file" type="file" accept=".md,text/markdown" @change="chooseFile">
          <label for="manuscript-source-name">原稿文件名</label>
          <input id="manuscript-source-name" class="text-input" type="text" maxlength="255" :value="state.sourceName.value" :aria-invalid="Boolean(state.sourceNameError.value)" :aria-describedby="state.sourceNameError.value ? 'manuscript-name-error' : undefined" @input="state.setSourceName(($event.target as HTMLInputElement).value)">
          <p v-if="state.sourceNameError.value" id="manuscript-name-error" class="error-copy">{{ state.sourceNameError.value }}</p>
          <label for="manuscript-text">原稿内容</label>
          <textarea id="manuscript-text" class="text-input manuscript-source" rows="9" :value="state.text.value" aria-describedby="manuscript-source-help" @input="state.setText(($event.target as HTMLTextAreaElement).value)" />
          <p id="manuscript-source-help">{{ state.sourceBytes.value }} / {{ MANUSCRIPT_IMPORT_MAX_BYTES }} 字节。自动识别章节标题；无标题文本作为单章导入。可在此调整拆章标题，再重新预览。</p>
          <p v-if="state.sourceBytes.value > MANUSCRIPT_IMPORT_MAX_BYTES" class="error-copy" role="alert">原稿超过 512 KiB，请拆分后分批导入。</p>
        </fieldset>
        <ManuscriptImportMapping v-if="state.mappings.value.length" :mappings="state.mappings.value" :chapters="state.chapters.value" :disabled="state.phase.value === 'proposing'" :error="state.mappingError.value" @update-mapping="state.updateMapping" />
        <div class="import-actions"><button class="secondary-button" type="submit" :disabled="!state.canPreview.value">{{ state.chapters.value.length ? '重新预览' : '拆章并预览' }}</button></div>
      </form>
      <p v-if="state.phase.value !== 'idle'" role="status">{{ state.phase.value === 'reading' ? '正在读取原稿…' : state.phase.value === 'previewing' ? '正在生成导入预览…' : '正在创建待审批导入…' }}</p>
      <p v-if="state.error.value" class="error-copy" role="alert">{{ state.error.value }}</p>
      <p v-if="state.chapters.value.length && !state.preview.value && !state.busy.value" role="status">输入或映射已变更，请重新预览。</p>
      <ManuscriptImportPreview v-if="state.preview.value" :preview="state.preview.value" />
      <footer class="import-actions">
        <button class="ghost-button" type="button" @click="emit('close')">取消</button>
        <button class="primary-button" type="button" :disabled="state.busy.value || !state.preview.value?.canPropose" @click="state.propose">创建待审批导入</button>
      </footer>
    </section>
  </div>
</template>
<style scoped>
.manuscript-import { width: min(850px, calc(100vw - 32px)); padding: 24px; overflow-y: auto; }
header, .import-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
header { justify-content: space-between; }
.source-fields { display: grid; gap: 10px; border: 0; padding: 0; margin: 24px 0 12px; min-width: 0; }
legend { font-weight: 600; margin-bottom: 12px; }
.manuscript-source { resize: vertical; min-height: 140px; font-family: inherit; }
p { margin: 12px 0; line-height: 1.7; }
.import-actions { margin-top: 16px; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--editor-focus); outline-offset: 2px; }
@media (max-width: 540px) { .manuscript-import { padding: 16px; } }
</style>
