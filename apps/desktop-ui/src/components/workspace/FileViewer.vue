<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue';
import NovelLintText from '../editor/NovelLintText.vue';
const props = defineProps<{ path?: string; content: string; loading: boolean; error?: string; line?: number }>();
const lintAvailable = computed(() => /^(chapters|characters|world)\/.*\.md$/u.test(props.path ?? ''));
const lintEnabled = shallowRef(true);
const match = shallowRef<HTMLElement | null>(null);
const selected = computed(() => {
  if (!props.line || props.line < 1) return undefined;
  const lines = props.content.replace(/\r\n?/gu, '\n').split('\n');
  if (props.line > lines.length) return undefined;
  return { before: lines.slice(0, props.line - 1).join('\n') + (props.line > 1 ? '\n' : ''),
    value: lines[props.line - 1], after: props.line < lines.length ? '\n' + lines.slice(props.line).join('\n') : '' };
});
watch(() => [props.path, props.content, props.line, props.loading], async () => {
  await nextTick(); match.value?.scrollIntoView?.({ block: 'center' });
}, { immediate: true });
</script>
<template>
  <section class="viewer-pane" aria-label="File viewer">
    <div class="viewer-header"><div><p class="eyebrow">Read only<span v-if="selected"> · 第 {{ line }} 行</span></p><h2 class="viewer-title">{{ path }}</h2></div><label v-if="lintAvailable" class="lint-toggle"><input v-model="lintEnabled" type="checkbox" /> 自动标记套话</label></div>
    <p v-if="loading" class="empty-copy">读取文件内容…</p>
    <p v-else-if="error" class="error-copy">{{ error }}</p>
    <pre v-else-if="selected" class="file-content"><NovelLintText :text="selected.before" :enabled="lintAvailable && lintEnabled" /><mark ref="match" :data-line="line"><NovelLintText :text="selected.value ?? ''" :enabled="lintAvailable && lintEnabled" /></mark><NovelLintText :text="selected.after" :enabled="lintAvailable && lintEnabled" /></pre>
    <pre v-else class="file-content"><NovelLintText :text="content" :enabled="lintAvailable && lintEnabled" /></pre>
  </section>
</template>
<style scoped>
mark[data-line] { color: inherit; background: #e4b95e66; outline: 1px solid #ba881d; scroll-margin-block: 40px; }
.lint-toggle { display:flex; align-items:center; gap:6px; font-size:12px; white-space:nowrap; }
</style>
