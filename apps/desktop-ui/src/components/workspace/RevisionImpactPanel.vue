<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { REVISION_IMPACT_LABELS } from '@oh-awesome-novel/client';
import type { OanClient, RevisionImpactRequest, RevisionImpactRepair, RevisionImpactSource, RevisionImpactView } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
const props = defineProps<{ workspaceRoot: string; request?: RevisionImpactRequest; api?: Pick<OanClient, 'createRevisionImpact' | 'readRevisionImpact' | 'listRevisionImpacts'> }>();
const emit = defineEmits<{ repair: [input: RevisionImpactRepair] }>();
const api = props.api ?? useWorkspaceApi();
const path = shallowRef(''); const ref = shallowRef('HEAD'); const actionId = shallowRef(''); const mode = shallowRef<'git' | 'acceptedAction'>('git');
const view = shallowRef<RevisionImpactView>(); const reports = shallowRef<Awaited<ReturnType<OanClient['listRevisionImpacts']>>['reports']>([]);
const busy = shallowRef(false); const error = shallowRef(''); let epoch = 0; let controller: AbortController | undefined;
const groups = computed(() => Object.entries(REVISION_IMPACT_LABELS).map(([kind, label]) => ({ kind, label, count: view.value?.report.counts[kind as keyof typeof REVISION_IMPACT_LABELS] ?? 0, items: view.value?.report.items.filter(item => item.kind === kind) ?? [] })));
function cancel() { epoch++; controller?.abort(); busy.value = false; }
async function run(operation: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
  cancel(); const current = ++epoch; controller = new AbortController(); const signal = controller.signal; busy.value = true; error.value = '';
  try { await operation(signal, () => current === epoch); } catch (cause) { if (current === epoch && !signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (current === epoch) busy.value = false; }
}
function install(result: RevisionImpactView) {
  view.value = result;
  reports.value = [{ id: result.report.id, createdAt: result.report.createdAt, paths: result.report.comparisons.map(c => c.path) }, ...reports.value.filter(r => r.id !== result.report.id)].slice(0, 20);
}
async function analyze() {
  const source: RevisionImpactSource = mode.value === 'git' ? { kind: 'git', path: path.value.trim(), ref: ref.value.trim() } : { kind: 'acceptedAction', actionId: actionId.value.trim() };
  view.value = undefined;
  await run(async (signal, current) => { const result = await api.createRevisionImpact({ expectedWorkspaceRoot: props.workspaceRoot, source }, signal); if (current()) install(result); });
}
async function reopen(id: string) {
  view.value = undefined;
  await run(async (signal, current) => { const result = await api.readRevisionImpact(id, props.workspaceRoot, signal); if (current()) { install(result); setSource(result.report.source); } });
}
function setSource(source: RevisionImpactSource) { mode.value = source.kind; if (source.kind === 'git') { path.value = source.path; ref.value = source.ref; } else actionId.value = source.actionId; }
async function repair(input: RevisionImpactRepair) {
  if (!view.value || busy.value) return;
  if (input.kind === 'open') { emit('repair', input); return; }
  const id = view.value.report.id;
  await run(async (signal, current) => { const result = await api.readRevisionImpact(id, props.workspaceRoot, signal); if (!current()) return; install(result); if (!result.stale) emit('repair', input); });
}
function chapter(path: string) { const match = /^(?:chapters|summaries\/chapter|state\/chapters)\/(\d{4}\/\d{4})\.(?:md|yaml)$/u.exec(path); return match ? `chapters/${match[1]}.md` : undefined; }
watch(() => [props.workspaceRoot, props.request?.nonce] as const, async () => {
  cancel(); view.value = undefined; reports.value = []; path.value = ''; ref.value = 'HEAD'; actionId.value = ''; mode.value = 'git';
  if (props.request) setSource(props.request.source);
  await run(async (signal, current) => { const result = await api.listRevisionImpacts(props.workspaceRoot, signal); if (current()) reports.value = result.reports; });
}, { immediate: true });
onBeforeUnmount(cancel);
</script>

<template>
  <section class="right-tab-panel impact-panel" aria-label="修改影响分析">
    <h2 class="panel-title">修改影响分析</h2>
    <p class="muted-copy">按内容与已记录证据只读分析。读取过、引用过或名称命中，都需要作者判断；未覆盖的文件不能视为确认不受影响。</p>
    <label class="field">比较来源<select v-model="mode" :disabled="busy" class="text-input"><option value="git">Git 版本 → 当前工作区</option><option value="acceptedAction">已接受的修改</option></select></label>
    <template v-if="mode === 'git'">
      <label class="field">文件路径<input v-model="path" :disabled="busy" class="text-input" placeholder="chapters/0001/0001.md"></label>
      <label class="field">变更前 Git 版本<input v-model="ref" :disabled="busy" class="text-input" placeholder="HEAD"></label>
    </template>
    <label v-else class="field">已接受的修改 ID<input v-model="actionId" :disabled="busy" class="text-input"></label>
    <button class="primary-button" type="button" :disabled="busy || (mode === 'git' ? !path.trim() || !ref.trim() : !actionId.trim())" @click="analyze">只读分析</button>
    <p v-if="busy" role="status">正在核对来源…</p><p v-if="error" role="alert" class="error-copy">{{ error }}</p>
    <details v-if="reports.length"><summary>重开最近报告（{{ reports.length }}）</summary><button v-for="r in reports" :key="r.id" class="ghost-button report-link" type="button" :disabled="busy" @click="reopen(r.id)">{{ r.createdAt }} · {{ r.paths.join('、') }}</button></details>
    <template v-if="view">
      <p v-if="view.stale" class="error-copy" role="alert">报告已过期：{{ view.staleReason }}</p>
      <ul><li v-for="c in view.report.comparisons" :key="c.path"><strong>{{ c.path }}</strong> · {{ c.change === 'unchanged' ? '内容相同，无本次变更' : c.change === 'unknown' ? '旧版本未知' : '内容已变化' }}<details><summary>比较证据</summary><p>前：{{ c.beforeKnown ? c.beforeHash ?? '文件不存在' : '未知' }}</p><p>后：{{ c.afterHash ?? '文件不存在' }}</p><p v-if="c.beforeRef">Git：{{ c.beforeRef }}</p></details></li></ul>
      <p class="muted-copy">已读取 {{ view.report.coverage.loadedFiles }} 个文件。{{ view.report.coverage.complete ? '对象树扫描完成。' : '本次覆盖不完整。' }}</p>
      <div v-if="view.report.coverage.gaps.length"><h3>覆盖不足</h3><ul><li v-for="gap in view.report.coverage.gaps" :key="gap">{{ gap }}</li></ul></div>
      <p v-if="view.report.omittedItems">另有 {{ view.report.omittedItems }} 条未展示，请按更小的变更范围复核。</p>
      <section v-for="group in groups" :key="group.kind" :aria-label="group.label">
        <h3>{{ group.label }} · {{ group.count }}</h3><p v-if="!group.items.length" class="muted-copy">本次范围内没有可展示的记录。</p>
        <article v-for="item in group.items" :key="item.id" class="impact-item">
          <strong>{{ item.path }}</strong><p>{{ item.reason }}</p><p v-if="item.status">{{ item.beforeStatus ?? '变更前未知' }} → {{ item.status }}</p>
          <p class="muted-copy">{{ item.sourcePath }} · {{ item.location }}<span v-if="item.generationId"> · {{ item.generationId }}</span></p>
          <blockquote>{{ item.evidence }}</blockquote><p v-if="item.kind === 'generationRead' && !item.targetKnown" class="muted-copy">未记录输出目标；打开操作仅查看来源。</p>
          <div class="pending-actions">
            <button class="ghost-button" type="button" :disabled="busy" @click="repair({ kind: 'open', path: item.path, line: item.line })">打开文件</button>
            <template v-if="chapter(item.path)"><button class="secondary-button" type="button" :disabled="busy || view.stale" @click="repair({ kind: 'review', path: chapter(item.path)! })">重新审稿</button><button class="secondary-button" type="button" :disabled="busy || view.stale" @click="repair({ kind: 'settleChapter', path: chapter(item.path)! })">整理本章</button></template>
            <button v-if="/^summaries\/volume\/\d{4}\.md$/.test(item.path)" class="secondary-button" type="button" :disabled="busy || view.stale" @click="repair({ kind: 'summarizeVolume', path: item.path })">整理本卷</button>
            <button v-if="item.path === 'summaries/global.md'" class="secondary-button" type="button" :disabled="busy || view.stale" @click="repair({ kind: 'summarizeGlobal', path: item.path })">整理全书</button>
          </div>
        </article>
      </section>
    </template>
  </section>
</template>
<style scoped>
.impact-panel { display: flex; flex-direction: column; gap: 12px; overflow-wrap: anywhere; }
.impact-item { border-top: 1px solid var(--editor-hairline); padding: 12px 0; }
.impact-item p { margin: 8px 0; }.impact-item blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--editor-hairline-strong); white-space: pre-wrap; }
.report-link { display: block; width: 100%; text-align: left; }.pending-actions { flex-wrap: wrap; }
</style>
