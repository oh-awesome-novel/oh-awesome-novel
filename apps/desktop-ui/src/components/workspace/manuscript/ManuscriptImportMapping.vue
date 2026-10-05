<script setup lang="ts">
import type { ManuscriptImportChapter, ManuscriptImportMapping } from '@oh-awesome-novel/client';
defineProps<{ mappings: ManuscriptImportMapping[]; chapters: ManuscriptImportChapter[]; disabled: boolean; error: string }>();
const emit = defineEmits<{ updateMapping: [index: number, patch: Partial<ManuscriptImportMapping>] }>();
function changeNumber(index: number, field: 'volume' | 'chapter', event: Event) {
  emit('updateMapping', index, { [field]: Number((event.target as HTMLInputElement).value) });
}
</script>
<template>
  <section aria-label="卷章映射" class="mapping-section">
    <h3>2. 调整卷章映射</h3>
    <p>修改卷号、章号或标题后需重新预览。需要重新拆章时，可修改上方原稿中的章节标题。</p>
    <p v-if="error" id="manuscript-mapping-error" class="error-copy" role="alert">{{ error }}</p>
    <fieldset v-for="mapping in mappings" :key="mapping.index" :disabled="disabled" class="mapping-row" :aria-describedby="error ? 'manuscript-mapping-error' : undefined">
      <legend>分片 {{ mapping.index + 1 }} · 原稿第 {{ chapters[mapping.index]?.sourceStartLine }}–{{ chapters[mapping.index]?.sourceEndLine }} 行</legend>
      <label :for="`import-volume-${mapping.index}`">卷号</label>
      <input :id="`import-volume-${mapping.index}`" class="text-input" type="number" min="1" max="9999" step="1" :value="mapping.volume" @input="changeNumber(mapping.index, 'volume', $event)">
      <label :for="`import-chapter-${mapping.index}`">章号</label>
      <input :id="`import-chapter-${mapping.index}`" class="text-input" type="number" min="1" max="9999" step="1" :value="mapping.chapter" @input="changeNumber(mapping.index, 'chapter', $event)">
      <label :for="`import-title-${mapping.index}`">标题</label>
      <input :id="`import-title-${mapping.index}`" class="text-input mapping-title" type="text" maxlength="200" :value="mapping.title" @input="emit('updateMapping', mapping.index, { title: ($event.target as HTMLInputElement).value })">
    </fieldset>
  </section>
</template>
<style scoped>
.mapping-section { margin-top: 24px; }
.mapping-row { display: grid; grid-template-columns: auto minmax(60px, 90px) auto minmax(60px, 90px); align-items: center; gap: 10px; margin: 14px 0; border: 1px solid var(--editor-hairline); border-radius: var(--radius-card); padding: 12px; }
.mapping-title { grid-column: 2 / -1; }
legend { padding: 0 6px; }
p { line-height: 1.6; }
input:focus-visible { outline: 2px solid var(--editor-focus); outline-offset: 2px; }
@media (max-width: 540px) { .mapping-row { grid-template-columns: auto minmax(0, 1fr); } .mapping-title { grid-column: auto; } }
</style>
