<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { UIMessage } from 'ai';
import type { ModelRequestUsageRecord, ModelStepUsageRecord, TurnUsageSummary } from '@oh-awesome-novel/client';
import { useAgentUsage } from '../../composables/useAgentUsage';

const props = defineProps<{ messages: UIMessage[] }>();
const emit = defineEmits<{ openSource: [path: string] }>();
const { expanded, selectedSession, sessions, records, warnings, loading, error, toggle, refreshSessions, selectSession } = useAgentUsage(computed(() => props.messages));
const turns = computed(() => records.value.filter((r): r is TurnUsageSummary => r.recordType === 'turn'));
const requests = computed(() => [...records.value.filter((r): r is ModelRequestUsageRecord => r.recordType === 'request')].reverse());
const latest = computed(() => [...turns.value].reverse().find((turn) => turn.turnId === records.value.at(-1)?.turnId));
const steps = computed(() => records.value.filter((r): r is ModelStepUsageRecord => r.recordType === 'step'));
const compact = computed(() => latest.value
  ? `${latest.value.stepCount} 次模型调用 · 约 ${latest.value.estimatedRequestTokens.toLocaleString()} tokens estimated · Actual ${latest.value.actualCoverage}`
  : requests.value.length ? `约 ${requests.value[0]!.request.estimatedRequestTokens.toLocaleString()} tokens estimated · 等待实际用量` : '上下文与用量');
const sourceLimits = shallowRef<Record<string, number>>({});
function sourceLimit(request: ModelRequestUsageRecord) { return sourceLimits.value[`${request.turnId}:${request.stepIndex}`] ?? 50; }
function moreSources(request: ModelRequestUsageRecord) { sourceLimits.value = { ...sourceLimits.value, [`${request.turnId}:${request.stepIndex}`]: sourceLimit(request) + 50 }; }
const outcomeLabels = { selected: '已选入消息', compressed: '已压缩来源', omitted: '已省略', excluded: '已排除' };
const reasonLabels = { selected: '已选择', 'context-window': '上下文窗口外', budget: '预算省略', policy: '策略排除', 'tool-result': '工具读取后派生输出', 'declared-only': '声明来源，未映射到本次消息' };
function stepFor(request: ModelRequestUsageRecord) { return steps.value.find((s) => s.turnId === request.turnId && s.stepIndex === request.stepIndex); }
function canOpenSource(path: string) { return /^(?:characters|world|chapters|state|timeline|foreshadow|summaries|outline)\//u.test(path) || path.startsWith('.oan/constitution/') || path === '.oan/workflow.yaml'; }
function count(value?: number) { return value === undefined ? 'unavailable' : value.toLocaleString(); }
function sourceGroups(request: ModelRequestUsageRecord) {
  const groups = new Map<string, number>();
  for (const source of request.sources) groups.set(source.kind, (groups.get(source.kind) ?? 0) + source.estimatedTokens);
  return [...groups].map(([kind, tokens]) => `${kind}: ~${tokens.toLocaleString()}`).join(' · ');
}
</script>

<template>
  <section class="usage-inspector" aria-label="Context and Usage">
    <button type="button" class="ghost-button usage-toggle" :aria-expanded="expanded" @click="toggle">{{ compact }}</button>
    <div v-if="expanded" class="usage-body">
      <p class="usage-note">Estimated 是本地估算，不代表计费。Actual 来自模型服务；partial 仅含已返回的部分用量，unavailable 表示未提供。</p>
      <label>查看会话
        <select :value="selectedSession" @change="selectSession(($event.target as HTMLSelectElement).value)">
          <option value="live">当前对话 · 实时</option>
          <option v-for="session in sessions" :key="session.id" :value="session.id">{{ new Date(session.updatedAt).toLocaleString() }} · {{ session.id }}</option>
        </select>
      </label>
      <button type="button" class="ghost-button tight-button" :disabled="loading" @click="selectedSession === 'live' ? refreshSessions() : selectSession(selectedSession)">刷新历史</button>
      <p v-if="loading" role="status">正在读取统计…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-for="warning in warnings" :key="warning" role="status">{{ warning }}</p>
      <p v-if="!records.length && !loading">此会话暂无用量记录。</p>
      <div v-if="latest" class="usage-total">
        <strong>本轮合计 · Actual {{ latest.actualCoverage }}</strong>
        <p>输入 {{ count(latest.actualUsage.inputTokens) }} · 输出 {{ count(latest.actualUsage.outputTokens) }} · 总计 {{ count(latest.actualUsage.totalTokens) }}</p>
        <p>输入覆盖 {{ latest.fieldCoverage.inputTokens }}/{{ latest.stepCount }} 步 · 输出覆盖 {{ latest.fieldCoverage.outputTokens }}/{{ latest.stepCount }} 步 · 总计覆盖 {{ latest.fieldCoverage.totalTokens }}/{{ latest.stepCount }} 步</p>
        <p>缓存读取 {{ count(latest.actualUsage.cacheReadTokens) }} · 缓存写入 {{ count(latest.actualUsage.cacheWriteTokens) }} · reasoning {{ count(latest.actualUsage.reasoningTokens) }}</p>
      </div>
      <details v-for="request in requests" :key="`${request.turnId}:${request.stepIndex}`" class="usage-step">
        <summary>{{ new Date(request.createdAt).toLocaleTimeString() }} · 第 {{ request.stepIndex + 1 }} 步 · ~{{ count(request.request.estimatedRequestTokens) }} estimated · Actual {{ stepFor(request)?.actualUsage.availability ?? 'unavailable' }}</summary>
        <p>预算：{{ request.budget.status === 'unknown' ? '模型上下文预算未知' : request.budget.status === 'overflow' ? '必要上下文超出预算；请求未发送' : '预算范围内' }}{{ request.budget.inputTokens === undefined ? '' : ` · ${request.budget.inputTokens} tokens` }}</p>
        <p v-if="request.egress">Provider {{ request.egress.providerId }} / {{ request.egress.providerKind }} · Model {{ request.egress.modelId }} · Endpoint {{ request.egress.endpointOrigin ?? 'unavailable' }}（发送前摘要）</p>
        <p>Actual 输入 {{ count(stepFor(request)?.actualUsage.inputTokens) }} · 输出 {{ count(stepFor(request)?.actualUsage.outputTokens) }} · 状态 {{ stepFor(request)?.outcome ?? '等待结果' }}</p>
        <p>{{ sourceGroups(request) }}</p>
        <p class="usage-note">{{ request.request.estimator }}；含消息、工具定义与 20% 余量，不含不可见的 provider framing。工具读取的来源仅说明派生关系，无法精确归因的 token 计入消息估算。</p>
        <details>
          <summary>{{ request.sources.length }} 个来源及省略记录</summary>
          <div class="usage-sources">
            <article v-for="(source, index) in request.sources.slice(0, sourceLimit(request))" :key="`${index}:${source.sourceId}:${source.path}`" class="usage-source">
              <strong>{{ source.sourceId }} · {{ outcomeLabels[source.outcome] }}</strong>
              <button v-if="source.path && canOpenSource(source.path)" type="button" class="ghost-button source-path" @click="emit('openSource', source.path)">{{ source.path }}</button>
              <span v-else-if="source.path" class="source-path">{{ source.path }}（来源记录）</span>
              <p>{{ source.budgetLayer }} · {{ source.semanticBoundary }} · {{ reasonLabels[source.reason] }} · ~{{ source.estimatedTokens }} estimated</p>
              <p>source {{ source.sourceHash?.slice(0, 12) ?? 'unavailable' }} · payload {{ source.payloadHash?.slice(0, 12) ?? 'unavailable' }} · {{ source.modelVisibleChars }} chars · {{ source.attribution ?? 'exact' }}</p>
            </article>
          </div>
          <button v-if="request.sources.length > sourceLimit(request)" type="button" class="ghost-button" @click="moreSources(request)">继续显示来源（已显示 {{ sourceLimit(request) }}/{{ request.sources.length }}）</button>
        </details>
        <details>
          <summary>{{ request.request.messageCount }} 条消息估算</summary>
          <p v-for="message in request.request.messages" :key="message.index">{{ message.index + 1 }} · {{ message.role }} · {{ message.chars }} chars · ~{{ message.estimatedTokens }} estimated</p>
        </details>
      </details>
    </div>
  </section>
</template>

<style scoped>
.usage-inspector { border-top: 1px solid var(--border-color, #7775); font-size: 12px; }
.usage-toggle { width: 100%; text-align: left; padding: 10px; }
.usage-body { padding: 10px; max-height: 52vh; overflow: auto; }
.usage-body p { margin: 6px 0; overflow-wrap: anywhere; }
.usage-body select { max-width: 100%; display: block; margin: 6px 0; }
.usage-note { opacity: .75; line-height: 1.6; }
.usage-total, .usage-step { padding: 10px 0; border-top: 1px solid var(--border-color, #7775); }
.usage-step summary { cursor: pointer; }
.usage-sources { max-height: 260px; overflow: auto; }
.usage-source { padding: 8px; border-bottom: 1px solid var(--border-color, #7773); }
.source-path { display: block; text-align: left; overflow-wrap: anywhere; }
</style>
