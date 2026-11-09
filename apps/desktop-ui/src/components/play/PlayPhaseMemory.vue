<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { PlayPhaseOverview, PlayPhaseRecall, PlaySession } from '@oh-awesome-novel/client';
import { oanClient } from '../../client';
import PlayCompactionModal from './PlayCompactionModal.vue';

const props = defineProps<{ workspaceKey: string; session: PlaySession; lens: 'player' | 'director'; disabled?: boolean }>();
const emit = defineEmits<{ continued: [session: PlaySession]; director: [] }>();
const overview = shallowRef<PlayPhaseOverview>();
const result = shallowRef<PlayPhaseRecall>();
const phaseId = ref('');
const query = ref('');
const first = ref(1), last = ref(0);
const loading = ref(false), searching = ref(false);
const error = ref(''), searchError = ref('');
const phase = computed(() => overview.value?.phases.find(item => item.sessionId === phaseId.value));
const budget = computed(() => overview.value?.budget);
const budgetLabels = { unknown: '窗口预算未知', within: '窗口余量充足', 'near-limit': '已接近输入预算，可预览归档', overflow: '输入估算超出预算，建议整理阶段', 'protected-overflow': '完整保留当前状态与最近两轮需要更大的输入预算' };
let search: AbortController | undefined;
function clearSearch() { search?.abort(); search = undefined; searching.value = false; result.value = undefined; searchError.value = ''; }
watch(() => [props.workspaceKey, props.session.id, props.session.revision, props.session.selectedTurnIds.at(-1), props.lens], async (_, __, cleanup) => {
  clearSearch(); overview.value = undefined; phaseId.value = ''; query.value = ''; error.value = ''; loading.value = true;
  const controller = new AbortController();
  cleanup(() => { controller.abort(); clearSearch(); });
  try {
    const data = await oanClient.getPlayPhases(props.session.id, controller.signal);
    if (controller.signal.aborted) return;
    if (data.revision !== props.session.revision || data.headId !== (props.session.selectedTurnIds.at(-1) ?? null)) throw new Error('当前分支已改变，请刷新会话。');
    overview.value = data;
    phaseId.value = data.phases.find(item => item.current && item.firstTurn <= item.lastTurn)?.sessionId
      ?? [...data.phases].reverse().find(item => item.firstTurn <= item.lastTurn)?.sessionId ?? '';
  } catch (e) { if (!controller.signal.aborted) error.value = e instanceof Error ? e.message : String(e); }
  finally { if (!controller.signal.aborted) loading.value = false; }
}, { immediate: true, flush: 'sync' });
watch(phase, value => { first.value = value?.firstTurn ?? 1; last.value = value?.lastTurn ?? 0; }, { flush: 'sync' });
watch([query, phaseId, first, last], clearSearch, { flush: 'sync' });
async function recall(selectEvidence = false) {
  const catalog = overview.value;
  if (!catalog?.headId || !phase.value || !query.value.trim()) return;
  clearSearch();
  const controller = new AbortController(); search = controller; searching.value = true;
  try {
    const data = await oanClient.recallPlayPhase({ sessionId: catalog.sessionId, headId: catalog.headId, revision: catalog.revision,
      phaseSessionId: phaseId.value, lens: props.lens, firstTurn: first.value, lastTurn: last.value, query: query.value.trim(), ...(selectEvidence ? { selectEvidence: true as const } : {}) }, controller.signal);
    if (!controller.signal.aborted) result.value = data;
  } catch (e) { if (!controller.signal.aborted) searchError.value = e instanceof Error ? e.message : String(e); }
  finally { if (!controller.signal.aborted) searching.value = false; }
}
</script>
<template>
  <section class="phase-memory" aria-label="阶段记忆">
    <p v-if="loading" role="status">正在读取阶段目录…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="overview && budget">
      <p class="budget-line"><strong>{{ budgetLabels[budget.status] }}</strong>
        <span>上下文估算 {{ budget.estimatedTokens }} / {{ budget.inputTokens ?? '未知' }} tokens · 输出预留 {{ budget.outputReserve ?? '未知' }}</span>
      </p>
      <details>
        <summary>阶段与历史原文（{{ overview.phases.length }} 个阶段）</summary>
        <p>固定提示、当前状态与最近两轮约 {{ budget.protectedTokens }} tokens。{{ budget.previousRequestTokens !== undefined ? '本分支上一请求估算 ' + budget.previousRequestTokens + ' tokens。' : '' }}已配置输入预算时，达到 85% 显示整理提醒。</p>
        <p v-if="overview.gap" role="status">部分阶段来源缺失、损坏或超出目录深度，无法核验的范围已省略。</p>
        <ol>
          <li v-for="item in overview.phases" :key="item.sessionId">{{ item.current ? '当前阶段' : '历史阶段' }} · {{ item.firstTurn > item.lastTurn ? '尚无新回合' : '第 ' + item.firstTurn + '–' + item.lastTurn + ' 轮' }} · {{ item.sessionId }}</li>
        </ol>
        <form v-if="overview.phases.some(item => item.firstTurn <= item.lastTurn)" @submit.prevent="recall()">
          <label>检索阶段<select v-model="phaseId"><option v-for="item in overview.phases.filter(item => item.firstTurn <= item.lastTurn)" :key="item.sessionId" :value="item.sessionId">{{ item.sessionId }}</option></select></label>
          <label>起始轮<input v-model.number="first" type="number" :min="phase?.firstTurn" :max="last" required></label>
          <label>结束轮<input v-model.number="last" type="number" :min="first" :max="phase?.lastTurn" required></label>
          <label>原文关键词<input v-model="query" maxlength="160" required></label>
          <button type="submit" :disabled="!query.trim() || searching">{{ searching ? '检索中…' : '查回原文' }}</button>
        </form>
        <p v-if="searchError" role="alert">{{ searchError }}</p>
        <template v-if="result">
          <p role="status">{{ result.hits.length }} 条原文 · 窗口 {{ result.candidateBytes }} 字节 · 省略 {{ result.omittedMessages }} 条候选、{{ result.omittedHits }} 条命中</p>
          <p v-if="result.omittedMessages">可缩小起止轮次重新检索。</p>
          <button v-if="result.hits.length && !result.selectedMessageIds" type="button" :disabled="searching || disabled" @click="recall(true)">让当前模型从这些命中选择证据（1 次调用）</button>
          <p v-if="result.selectedMessageIds">模型选中 {{ result.selectedMessageIds.length }} 条证据。</p>
          <ul class="evidence"><li v-for="hit in result.hits" :key="hit.messageId">
            <strong>第 {{ hit.turn }} 轮<span v-if="result.selectedMessageIds?.includes(hit.messageId)"> · 模型选中</span></strong><blockquote>{{ hit.quote }}</blockquote>
            <details><summary>核验证据与当时状态</summary>
              <p>来源 {{ result.scope.phaseSessionId }} · 当前分支 {{ result.scope.sessionId }} / {{ result.scope.headId }}</p>
              <p>{{ hit.turnId }} / {{ hit.messageId }} · 原文范围 [{{ hit.start }}, {{ hit.end }}) · {{ hit.visibility }}</p>
              <p>SHA-256 {{ hit.quoteHash }}</p><pre v-if="hit.stateRecorded">{{ JSON.stringify(hit.historicalState, null, 2) }}</pre><p v-else>此回合未记录状态快照。</p>
              <p v-if="hit.omittedStateFields">状态字段省略 {{ hit.omittedStateFields }} 项</p>
            </details>
          </li></ul>
        </template>
      </details>
      <PlayCompactionModal v-if="lens === 'director'" :key="workspaceKey + session.id" :session="session" :disabled="disabled" @continued="emit('continued', $event)" />
      <button v-else type="button" @click="emit('director')">切换导演视角以审阅归档</button>
    </template>
  </section>
</template>
<style scoped>
.phase-memory { display: grid; gap: .5rem; overflow-wrap: anywhere; }
.budget-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; }
.phase-memory p { margin: .35rem 0; }
form { display: flex; flex-wrap: wrap; gap: .5rem; align-items: end; }
label { display: grid; gap: .25rem; }
input[type="number"] { width: 6rem; }
summary { cursor: pointer; }
pre, blockquote { white-space: pre-wrap; margin: .5rem 0; }
.phase-memory > button { justify-self: start; }
</style>
