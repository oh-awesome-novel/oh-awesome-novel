<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue';
import { selectUsageOperation } from '@oh-awesome-novel/client';
import type { UsageInspectorCall, UsageInspectorEnvelope, UsageInspectorScope } from '@oh-awesome-novel/client';
import { oanClient } from '../../client';
import UsageProbePanel from './UsageProbePanel.vue';

const props = withDefaults(defineProps<{
  workspaceKey: string;
  scope: UsageInspectorScope;
  lens?: 'player' | 'director';
  operationId?: string;
  refreshKey?: string | number;
}>(), { lens: 'player', operationId: undefined, refreshKey: undefined });

const expanded = shallowRef(false);
const loading = shallowRef(false);
const error = shallowRef('');
const envelope = shallowRef<UsageInspectorEnvelope>();
const selectedOperation = shallowRef('current');
const sourceLimits = shallowRef<Record<string, number>>({});
const bodyId = `${useId()}-domain-usage`;
let generation = 0;
let controller: AbortController | undefined;
const identity = computed(() => JSON.stringify({ workspace: props.workspaceKey, scope: props.scope, lens: props.scope.domain === 'play' ? props.lens : undefined }));
const detailed = computed(() => props.scope.domain !== 'play' || props.lens === 'director');
const calls = computed(() => envelope.value?.projection.calls ?? []);
const operationIds = computed(() => [...new Set(calls.value.flatMap(call => call.request?.operation ? [call.request.operation.operationId] : []))].reverse());
const effectiveOperation = computed(() => selectedOperation.value === 'history'
  ? undefined
  : selectedOperation.value === 'current'
    ? props.operationId ?? operationIds.value[0]
    : selectedOperation.value);
const projection = computed(() => {
  const data = envelope.value;
  if (!data) return undefined;
  if (!effectiveOperation.value) return data.projection;
  return selectUsageOperation(data.projection, data.history, effectiveOperation.value);
});
const visibleCalls = computed(() => [...projection.value?.calls ?? []].reverse());
const estimatedTokens = computed(() => visibleCalls.value.reduce((sum, call) => sum + (call.request?.request.estimatedRequestTokens ?? 0), 0));
const outcomeLabels = { selected: '已选入', compressed: '已压缩', omitted: '已省略', excluded: '已排除' };
const reasonLabels = { selected: '已选择', 'context-window': '窗口外', budget: '预算省略', policy: '策略排除', 'tool-result': '工具读取后的派生输出', 'declared-only': '仅声明，未映射到本次消息' };
const statusLabels = { pending: '等待结果', completed: '已完成', failed: '失败', aborted: '已停止', conflict: '记录冲突，不计合计' };
const availabilityLabels = { actual: 'actual · 已返回', partial: 'partial · 部分返回', unavailable: 'unavailable · 未提供', complete: 'complete · 字段完整' };
const warningLabels: Record<string, string> = {
  missing: '尚无可读取的统计记录。', 'truncated-tail': '尾行不完整，仅显示此前完整记录。',
  'invalid-record': '部分记录格式不受支持或损坏，已跳过。', 'read-failed': '部分记录无法安全读取。',
  'size-limit': '记录超过读取上限。', 'duplicate-records': '重复记录已去重，不重复计费。',
  'conflicting-records': '存在相互冲突的记录，冲突调用未计入合计。',
  'unmatched-records': '部分旧记录缺少任务关联，不能归属到当前操作。',
};

function count(value: number | undefined): string { return value === undefined ? '未提供' : value.toLocaleString(); }
function duration(from?: string, to?: string): string {
  if (!from || !to) return '未观测';
  const milliseconds = Date.parse(to) - Date.parse(from);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? `${milliseconds.toLocaleString()} ms` : '未观测';
}
function stage(call: UsageInspectorCall): string { return call.request?.operation?.stage ?? '关联信息缺失'; }
function fingerprintLabel(call: UsageInspectorCall): string {
  const change = call.fingerprintChange;
  if (change.status === 'unavailable') return '缺少前缀或工具指纹';
  if (change.status === 'first-observed') return '当前读取范围内首条，尚无可比较前项';
  if (change.status === 'unchanged') return '前缀与工具定义未变';
  const labels = { prefix: '前缀内容', tools: '工具定义', 'prefix-kind': '前缀类型' };
  return `已变化：${change.reasons.map(reason => labels[reason]).join('、')}`;
}
function presentationFor(call: UsageInspectorCall) {
  const operation = call.request?.operation;
  if (!operation) return undefined;
  return envelope.value?.presentation.find(item => item.operationId === operation.operationId
    && (item.unitId === undefined || item.unitId === operation.unitId)
    && (item.attemptId === undefined || item.attemptId === operation.attemptId)
    && (item.stepId === undefined || item.stepId === operation.stepId));
}
function sourceLimit(call: UsageInspectorCall): number { return sourceLimits.value[call.id] ?? 30; }
function revealSources(call: UsageInspectorCall): void { sourceLimits.value = { ...sourceLimits.value, [call.id]: sourceLimit(call) + 30 }; }
function clearScope(): void {
  generation++;
  controller?.abort(); controller = undefined;
  envelope.value = undefined; loading.value = false; error.value = '';
  selectedOperation.value = 'current'; sourceLimits.value = {};
}
async function refresh(): Promise<void> {
  if (!expanded.value) return;
  const version = ++generation;
  controller?.abort(); const active = new AbortController(); controller = active;
  const key = identity.value;
  loading.value = true; error.value = '';
  try {
    const scope = props.scope;
    const data = scope.domain === 'play'
      ? await oanClient.getPlayUsageInspector(scope.sessionId, { limit: 100, lens: props.lens, signal: active.signal })
      : await oanClient.getReferenceUsageInspector(scope.referenceId, scope.runId, { limit: 100, signal: active.signal });
    if (version === generation && key === identity.value) envelope.value = data;
  } catch {
    if (version === generation && !active.signal.aborted) error.value = '无法读取这次任务的统计。可刷新重试。';
  } finally {
    if (version === generation) { loading.value = false; controller = undefined; }
  }
}
function toggle(): void {
  expanded.value = !expanded.value;
  if (expanded.value) void refresh();
  else { generation++; controller?.abort(); controller = undefined; loading.value = false; }
}
watch(identity, () => { clearScope(); if (expanded.value) void refresh(); }, { flush: 'sync' });
watch(() => [props.refreshKey, props.operationId], () => { if (expanded.value) void refresh(); });
onBeforeUnmount(clearScope);
</script>

<template>
  <section class="domain-usage" :aria-label="scope.domain === 'play' ? 'Play 用量与上下文' : 'Reference 用量与上下文'">
    <button type="button" class="usage-toggle" :aria-expanded="expanded" :aria-controls="bodyId" :aria-label="expanded ? '收起用量与上下文' : '打开用量与上下文'" @click="toggle">
      <span aria-hidden="true">{{ expanded ? '[-]' : '[+]' }}</span>
      用量与上下文
      <small>{{ scope.domain === 'play' ? '当前推演' : '当前拆解任务' }}</small>
    </button>
    <div v-if="expanded" :id="bodyId" class="usage-body" :aria-busy="loading">
      <div class="usage-controls">
        <label>查看范围
          <select v-model="selectedOperation" aria-label="用量查看范围">
            <option value="current">当前操作 / 最近一次</option>
            <option value="history">近期历史 · 当前读取范围</option>
            <option v-for="(operation, index) in operationIds" :key="operation" :value="operation">{{ detailed ? operation : `近期操作 ${index + 1}` }}</option>
          </select>
        </label>
        <button type="button" :disabled="loading" @click="refresh">刷新统计</button>
      </div>
      <p class="usage-note">Estimated 是本地估算；实际 token 与缓存字段来自模型服务。未提供不等于 0，前缀不变也不代表缓存命中。</p>
      <p v-if="scope.domain === 'play' && !detailed" class="usage-note">Player 视角只显示无内容统计；来源名称和隐藏关联由服务端移除。</p>
      <p v-if="loading" role="status">正在读取任务统计…</p>
      <p v-if="error" class="usage-error" role="alert">{{ error }}</p>
      <p v-for="warning in projection?.diagnostics ?? []" :key="warning" class="usage-note" role="status">{{ warningLabels[warning] ?? warning }}</p>
      <p v-if="envelope?.projection.truncated" class="usage-note" role="status">只读取最近的有界记录，以下合计不是全会话累计；更早数据可能未覆盖。</p>
      <p v-if="!loading && !visibleCalls.length">此范围暂无可关联的模型调用。</p>
      <div v-if="projection && visibleCalls.length" class="usage-summary">
        <strong>当前读取范围 · {{ projection.totals.callCount }} 次调用</strong>
        <p>{{ availabilityLabels[projection.totals.actualCoverage] }} · 已返回 {{ projection.totals.reportedCalls }}/{{ projection.totals.callCount }} 次调用</p>
        <dl>
          <div><dt>输入 token</dt><dd>{{ count(projection.totals.actualUsage.inputTokens) }}</dd></div>
          <div><dt>输出 token</dt><dd>{{ count(projection.totals.actualUsage.outputTokens) }}</dd></div>
          <div><dt>缓存读取 token</dt><dd>{{ count(projection.totals.actualUsage.cacheReadTokens) }}</dd></div>
          <div><dt>缓存写入 token</dt><dd>{{ count(projection.totals.actualUsage.cacheWriteTokens) }}</dd></div>
        </dl>
        <p class="usage-note">请求估算合计 ~{{ estimatedTokens.toLocaleString() }} tokens；实际输入覆盖 {{ projection.totals.fieldCoverage.inputTokens }}/{{ projection.totals.callCount }}，缓存读取覆盖 {{ projection.totals.fieldCoverage.cacheReadTokens }}/{{ projection.totals.callCount }}。</p>
      </div>
      <details v-for="call in visibleCalls" :key="call.id" class="usage-call">
        <summary>{{ stage(call) }} · {{ statusLabels[call.status] }} · {{ availabilityLabels[call.step?.actualUsage.availability ?? 'unavailable'] }}</summary>
        <p v-if="call.request?.egress">{{ call.request.egress.providerId }} · {{ call.request.egress.modelId }} · {{ call.request.egress.endpointOrigin ?? '服务地址未记录' }}</p>
        <p>实际输入 {{ count(call.step?.actualUsage.inputTokens) }} · 输出 {{ count(call.step?.actualUsage.outputTokens) }} · 缓存读取 {{ count(call.step?.actualUsage.cacheReadTokens) }} · 缓存写入 {{ count(call.step?.actualUsage.cacheWriteTokens) }}</p>
        <p v-if="call.request">预算：{{ call.request.budget.status === 'unknown' ? '模型输入预算未知' : call.request.budget.status === 'overflow' ? '估算超过输入预算' : '输入预算范围内' }} · 请求估算 ~{{ count(call.request.request.estimatedRequestTokens) }} / {{ count(call.request.budget.inputTokens) }} tokens</p>
        <dl class="usage-timing">
          <div><dt>模型首包 · 服务端观测</dt><dd>{{ duration(call.step?.timing?.startedAt, call.step?.timing?.firstResponseAt) }}</dd></div>
          <div><dt>模型调用总时长</dt><dd>{{ duration(call.step?.timing?.startedAt, call.step?.timing?.completedAt) }}</dd></div>
          <div><dt>{{ scope.domain === 'reference' ? '结果可见' : '首段可见' }} · 客户端观测</dt><dd>{{ presentationFor(call) ? `${presentationFor(call)!.elapsedMs.toLocaleString()} ms` : '未观测' }}</dd></div>
        </dl>
        <p class="usage-note">界面时间从作者发起整次操作算起，包含排队、网络与展示等待；不能当作模型首包时间。非流式调用或缺失历史证据时首包显示未观测。</p>
        <p v-if="detailed" class="usage-fingerprint">{{ fingerprintLabel(call) }}</p>
        <details v-if="detailed && call.request?.fingerprint" class="usage-technical">
          <summary>前缀与工具指纹</summary>
          <p>类型 {{ call.request.fingerprint.prefixKind }}</p>
          <p>前缀 <code>{{ call.request.fingerprint.prefixHash }}</code></p>
          <p>工具 <code>{{ call.request.fingerprint.toolSchemaHash }}</code></p>
        </details>
        <details v-if="call.request" class="usage-sources">
          <summary>{{ call.request.sources.length }} 项来源与省略说明</summary>
          <article v-for="(source, index) in call.request.sources.slice(0, sourceLimit(call))" :key="`${index}:${source.sourceId}:${source.path}`">
            <strong>{{ detailed ? source.sourceId : `上下文 ${index + 1}` }} · {{ outcomeLabels[source.outcome] }}</strong>
            <p v-if="detailed && source.path"><code>{{ source.path }}</code></p>
            <p>{{ source.budgetLayer }} · {{ reasonLabels[source.reason] }} · {{ source.attribution === 'derived' ? '派生来源，token 计入整体消息，无法精确分摊' : `~${source.estimatedTokens.toLocaleString()} tokens` }}</p>
            <p v-if="detailed" class="usage-note">source {{ source.sourceHash?.slice(0, 12) ?? '未记录' }} · payload {{ source.payloadHash?.slice(0, 12) ?? '未记录' }} · {{ source.modelVisibleChars.toLocaleString() }} 字符</p>
          </article>
          <button v-if="call.request.sources.length > sourceLimit(call)" type="button" @click="revealSources(call)">继续显示来源</button>
        </details>
        <details v-if="detailed" class="usage-technical">
          <summary>调用关联与时间</summary>
          <p>操作 {{ call.request?.operation?.operationId ?? '未关联' }} · 模型调用 {{ call.turnId }} / {{ call.stepIndex + 1 }}</p>
          <p v-if="call.request?.operation?.unitId">拆解单元 {{ call.request.operation.unitId }}</p>
          <p v-if="call.request?.operation?.attemptId">尝试 {{ call.request.operation.attemptId }}</p>
          <p v-if="call.request?.operation?.stepId">角色步骤 {{ call.request.operation.stepId }}</p>
          <p v-if="call.request?.operation?.contextTraceId">上下文记录 {{ call.request.operation.contextTraceId }}</p>
          <p>开始 {{ call.step?.timing?.startedAt ?? call.request?.createdAt ?? '未记录' }} · 完成 {{ call.step?.timing?.completedAt ?? '未记录' }}</p>
        </details>
      </details>
      <UsageProbePanel :workspace-key="workspaceKey" :scope="scope" />
    </div>
  </section>
</template>

<style scoped>
.domain-usage { border: 1px solid var(--play-line, var(--editor-hairline)); background: var(--play-surface, var(--editor-surface)); color: var(--play-body, var(--editor-body)); font-size: 12px; min-width: 0; }
.usage-toggle { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 9px 12px; text-align: left; background: transparent; color: inherit; border: 0; font: inherit; cursor: pointer; }
.usage-toggle small { margin-left: auto; color: var(--play-muted, var(--editor-muted)); }
.usage-body { display: grid; gap: 10px; padding: 0 12px 12px; min-width: 0; }
.usage-body p { margin: 5px 0; line-height: 1.6; overflow-wrap: anywhere; }
.usage-controls { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }
.usage-controls label { display: grid; gap: 4px; flex: 1; min-width: 0; }
.usage-body :where(button, select) { min-height: 32px; padding: 5px 8px; font: inherit; border: 1px solid var(--play-line, var(--editor-hairline)); color: inherit; background: var(--play-surface, var(--editor-surface)); max-width: 100%; }
.usage-body button, summary { cursor: pointer; }
.usage-body button:disabled { cursor: default; opacity: .6; }
.usage-note { color: var(--play-muted, var(--editor-muted)); }
.usage-error { color: var(--play-danger, var(--editor-danger)); }
.usage-summary, .usage-call { border-top: 1px solid var(--play-line, var(--editor-hairline)); padding-top: 10px; min-width: 0; }
.usage-call summary { line-height: 1.6; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin: 10px 0; }
dl div { min-width: 0; }
dt { color: var(--play-muted, var(--editor-muted)); line-height: 1.5; }
dd { margin: 2px 0 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.usage-timing { grid-template-columns: 1fr; gap: 6px; }
.usage-timing div { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; }
.usage-sources article { padding: 8px 0; border-top: 1px solid var(--play-line, var(--editor-hairline)); }
.usage-sources article:first-of-type { margin-top: 8px; }
.usage-technical, .usage-sources { margin-top: 8px; }
code { font-size: 11px; overflow-wrap: anywhere; }
:where(button, select, summary):focus-visible { outline: 2px solid var(--play-ink, var(--editor-ink)); outline-offset: 2px; }
@media (max-width: 520px) { dl { grid-template-columns: 1fr; } .usage-controls { align-items: stretch; } }
</style>
