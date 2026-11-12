<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { OanClient, PlayChapterIntent, PlayChapterPreview, PlayChapterTarget } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from '../../../composables/useWorkspaceApi';
import PendingActionDiffViewer from '../../agent-checkpoint/PendingActionDiffViewer.vue';
const props = withDefaults(defineProps<{
  workspaceRoot: string; sessionId: string; revision: number; reportFingerprint: string;
  selectedItemIds: readonly string[]; lens: 'player' | 'director'; disabled: boolean;
  api?: Pick<OanClient, 'createPlayWritingReferenceAttachment' | 'getPlayChapterTarget' | 'generatePlayChapter' | 'proposePlayChapter'>;
}>(), { api: undefined });
const emit = defineEmits<{ review: [id: string]; attachmentCreated: [] }>();
const api = props.api ?? useWorkspaceApi();
const open = shallowRef(false); const loading = shallowRef(false); const generating = shallowRef(false); const proposing = shallowRef(false);
const attachmentId = shallowRef(''); const target = shallowRef<PlayChapterTarget>(); const preview = shallowRef<PlayChapterPreview>();
const pendingId = shallowRef(''); const error = shallowRef(''); const characters = shallowRef(0);
const intent = ref<PlayChapterIntent>({ mustKeep: '', mayChange: '可调整叙述与对白，保留选中事件的结果。', pov: '第三人称', goal: '', length: '约 2000 字' });
let epoch = 0; let controller: AbortController | undefined;
const busy = computed(() => loading.value || generating.value || proposing.value);
const changes = computed(() => preview.value ? [{ operation: 'create' as const, path: preview.value.targetPath }] : []);
function stop(): void { epoch++; controller?.abort(); controller = undefined; loading.value = false; generating.value = false; proposing.value = false; }
function clear(): void { stop(); open.value = false; target.value = undefined; preview.value = undefined; attachmentId.value = ''; pendingId.value = ''; error.value = ''; }
watch(() => [props.workspaceRoot, props.sessionId, props.revision, props.reportFingerprint, props.lens, props.selectedItemIds.join('\0')], clear);
watch(intent, () => { if (!generating.value && !proposing.value) { preview.value = undefined; pendingId.value = ''; } }, { deep: true });
onBeforeUnmount(stop);
function request() { return { expectedWorkspaceRoot: props.workspaceRoot, attachmentId: attachmentId.value, lens: props.lens, intent: { ...intent.value } }; }
async function start(): Promise<void> {
  if (props.disabled || busy.value || !props.selectedItemIds.length) return;
  clear(); open.value = true; loading.value = true; const current = ++epoch; controller = new AbortController();
  try {
    const result = await api.createPlayWritingReferenceAttachment({ sessionId: props.sessionId, baseRevision: props.revision, selectedOutcomeItemIds: [...props.selectedItemIds] });
    if (current !== epoch) return;
    if (result.attachment.reportFingerprint !== props.reportFingerprint) throw new Error('结果报告已变化，请重新选择素材。');
    attachmentId.value = result.attachment.id;
    const next = await api.getPlayChapterTarget(request(), controller.signal);
    if (current === epoch) { target.value = next; emit('attachmentCreated'); }
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : '无法准备转写。'; }
  finally { if (current === epoch) loading.value = false; }
}
async function generate(): Promise<void> {
  if (!target.value || props.disabled || busy.value) return;
  stop(); const current = ++epoch; controller = new AbortController(); generating.value = true; characters.value = 0; preview.value = undefined; pendingId.value = ''; error.value = '';
  const selectedTarget = target.value;
  try {
    for await (const event of api.generatePlayChapter({ ...request(), targetPath: selectedTarget.targetPath,
      chapterInventoryHash: selectedTarget.chapterInventoryHash, reportFingerprint: selectedTarget.reportFingerprint }, controller.signal)) {
      if (current !== epoch) return;
      if (event.type === 'progress') characters.value = event.characters;
      else {
        if (event.preview.citedItemIds.some(id => !props.selectedItemIds.includes(id))) throw new Error('章节引用了未选素材，请重新生成。');
        preview.value = event.preview;
      }
    }
  } catch (cause) { if (current === epoch) { preview.value = undefined; error.value = cause instanceof Error ? cause.message : '转写失败。'; } }
  finally { if (current === epoch) generating.value = false; }
}
async function propose(): Promise<void> {
  if (!preview.value || props.disabled || busy.value) return;
  const current = ++epoch; proposing.value = true; error.value = '';
  try {
    const result = await api.proposePlayChapter(preview.value.id, { expectedWorkspaceRoot: props.workspaceRoot, fingerprint: preview.value.fingerprint, intent: { ...intent.value } });
    if (current !== epoch) return;
    pendingId.value = result.pendingAction.id; emit('review', result.pendingAction.id);
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : '无法创建审批。'; }
  finally { if (current === epoch) proposing.value = false; }
}
</script>

<template>
  <section class="play-chapter-writing" aria-label="推演转章节" :aria-busy="busy">
    <button v-if="!open" type="button" :disabled="disabled || !selectedItemIds.length" @click="start">把选中素材写成下一章（{{ selectedItemIds.length }}）</button>
    <template v-else>
      <h3>把推演写成一章</h3>
      <p v-if="loading" role="status">正在核对所选素材与下一章目标…</p>
      <template v-if="target">
        <p class="chapter-target">新章节：<strong>{{ target.targetPath }}</strong></p>
        <p>所选分支共 {{ target.range.turnCount }} 回合，本次仅使用以下 {{ target.items.length }} 条素材。</p>
        <details><summary>查看选中证据</summary><ul><li v-for="item in target.items" :key="item.id">{{ item.summary }}</li></ul></details>
        <fieldset :disabled="busy || disabled"><legend>转写要求（按需填写）</legend>
          <label>必须保留的事件<textarea v-model="intent.mustKeep" rows="2" maxlength="2000"></textarea></label>
          <label>允许调整的表达<textarea v-model="intent.mayChange" rows="2" maxlength="2000"></textarea></label>
          <label>叙述视角<input v-model="intent.pov" maxlength="2000" /></label>
          <label>本章目标<textarea v-model="intent.goal" rows="2" maxlength="2000"></textarea></label>
          <label>篇幅方向<input v-model="intent.length" maxlength="2000" /></label>
        </fieldset>
        <p>生成完整正文候选；保存后再由你决定是否整理本章。</p>
        <button type="button" :disabled="busy || disabled" @click="generate">{{ preview ? '重新生成章节' : '生成章节候选' }}</button>
      </template>
      <p v-if="generating" role="status">正在转写…已接收 {{ characters }} 个输出字符。</p>
      <button v-if="generating" type="button" @click="stop">取消生成</button>
      <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="start">重新核对素材与目标</button></p>
      <template v-if="preview">
        <p>已核对 {{ preview.citedItemIds.length }} 个引用标识。情节与文学质量仍请结合正文审阅。</p>
        <PendingActionDiffViewer :diff="preview.diff" :changes="changes" />
        <button v-if="!pendingId" type="button" :disabled="busy || disabled" @click="propose">提交本章审批</button>
        <button v-else type="button" @click="emit('review', pendingId)">打开本章审批</button>
      </template>
      <button type="button" :disabled="proposing" @click="clear">关闭转写</button>
    </template>
  </section>
</template>

<style scoped>
.play-chapter-writing, fieldset, label { display: grid; gap: 8px; min-width: 0; }
.play-chapter-writing { padding: 10px; border: 1px solid var(--play-line, var(--editor-hairline)); font-size: 12px; line-height: 1.5; }
h3, p, ul { margin: 0; } fieldset { padding: 8px; border: 1px solid var(--play-line, var(--editor-hairline)); }
input, textarea, button { min-width: 0; min-height: 36px; padding: 6px; font: inherit; background: var(--play-canvas, var(--editor-canvas)); color: var(--play-ink, var(--editor-ink)); border: 1px solid var(--play-line-strong, var(--editor-hairline)); }
button { cursor: pointer; } button:disabled { opacity: .6; cursor: default; }
.chapter-target { overflow-wrap: anywhere; } [role='alert'] { color: var(--play-danger, var(--editor-danger)); }
summary { cursor: pointer; } input:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--play-focus, var(--editor-focus)); outline-offset: 2px; }
</style>
