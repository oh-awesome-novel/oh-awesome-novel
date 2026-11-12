<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue';
import type { DeepReadonly } from 'vue';
import type { OanClient, PlayCheckpointSummary, PlayWorldlineComparison, PlayWorldlineSection } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';

const props = withDefaults(defineProps<{
  sessionId: string;
  workspaceKey: string;
  revision: number;
  lens: 'player' | 'director';
  checkpoints: DeepReadonly<PlayCheckpointSummary[]>;
  disabled?: boolean;
  api?: Pick<OanClient, 'comparePlayWorldlines'>;
}>(), { disabled: false, api: undefined });
const emit = defineEmits<{
  restore: [checkpointId: string];
  name: [checkpointId: string, name: string];
  outcome: [checkpointId: string];
}>();
const api = props.api ?? useWorkspaceApi();
const uid = useId();
const left = shallowRef(''); const right = shallowRef('');
const result = shallowRef<PlayWorldlineComparison>();
const loading = shallowRef(false); const error = shallowRef('');
const names = ref({ left: '', right: '' });
const confirmation = shallowRef<{ id: string; kind: 'restore' | 'outcome' }>();
let request: AbortController | undefined;
const labels: Record<PlayWorldlineSection, string> = {
  actions: '分叉后的行动', state: '状态变化', events: '只在一边发生的事件',
  scheduled: '计划事件', knowledge: '认知与揭示', canon: '原作走向',
};
const maxPages = computed(() => Math.max(1, ...result.value?.sections.map(section => Math.ceil(section.total / 40)) ?? []));
const unavailable = computed(() => props.disabled || loading.value);
function reset(): void {
  request?.abort(); request = undefined;
  result.value = undefined; error.value = ''; loading.value = false; confirmation.value = undefined;
}
// Background read windows also disable actions. They do not invalidate this
// immutable comparison; only its identity/revision/lens does. Hide it while busy.
watch(() => [props.workspaceKey, props.sessionId, props.revision, props.lens,
  props.checkpoints.find(node => node.status === 'current')?.checkpointId], reset);
watch(() => [props.workspaceKey, props.sessionId], () => {
  left.value = ''; right.value = ''; names.value = { left: '', right: '' };
});
watch([left, right], reset);
onBeforeUnmount(reset);
function title(id: string): string {
  const node = props.checkpoints.find(item => item.checkpointId === id);
  return node?.name || (node?.kind === 'initialWorld' ? '初始世界' : node?.preview) || id;
}
async function compare(page = 0): Promise<void> {
  reset();
  if (props.disabled || !left.value || !right.value || left.value === right.value) return;
  const current = new AbortController(); request = current; loading.value = true;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await api.comparePlayWorldlines(props.sessionId, {
          left: left.value, right: right.value, lens: props.lens, page,
        }, current.signal);
        if (request !== current) return;
        if (response.revision !== props.revision) throw new Error('世界线已变化，请刷新存档点后重新比较。');
        result.value = response;
        break;
      } catch (cause) {
        if (request !== current || current.signal.aborted) return;
        const delay = [150, 300, 600][attempt];
        // Existing read projections briefly hold the same session lock.
        if (delay === undefined || !(cause instanceof Error) || !cause.message.includes('being modified')) throw cause;
        await new Promise(resolve => setTimeout(resolve, delay));
        if (request !== current || current.signal.aborted) return;
      }
    }
  } catch (cause) {
    if (request === current && !current.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { if (request === current) loading.value = false; }
}
function confirm(): void {
  const action = confirmation.value;
  if (!action || unavailable.value || !result.value) return;
  confirmation.value = undefined;
  if (action.kind === 'restore') emit('restore', action.id);
  else emit('outcome', action.id);
}
function name(side: 'left' | 'right'): void {
  const value = names.value[side].trim();
  if (!result.value || unavailable.value || !value || value.length > 80) return;
  emit('name', result.value[side].checkpointId, value);
}
</script>

<template>
  <section class="play-worldline-compare play-hud-section" aria-label="世界线比较" :aria-busy="loading">
    <h3>世界线比较</h3>
    <p>选两个存档点，只读比较分叉后的变化。长列表每页显示 40 条，长文本显示节选。</p>
    <form class="compare-selectors" @submit.prevent="compare()">
      <label :for="`${uid}-left`">左侧节点</label>
      <select :id="`${uid}-left`" v-model="left" :disabled="disabled">
        <option value="">选择存档点</option>
        <option v-for="node in checkpoints" :key="node.checkpointId" :value="node.checkpointId">{{ title(node.checkpointId) }}</option>
      </select>
      <label :for="`${uid}-right`">右侧节点</label>
      <select :id="`${uid}-right`" v-model="right" :disabled="disabled">
        <option value="">选择存档点</option>
        <option v-for="node in checkpoints" :key="node.checkpointId" :value="node.checkpointId">{{ title(node.checkpointId) }}</option>
      </select>
      <button type="submit" :disabled="unavailable || !left || !right || left === right">{{ loading ? '正在比较…' : '比较这两个节点' }}</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="result && !disabled">
      <p v-if="result.unavailableReason" role="status">{{ result.unavailableReason }}</p>
      <template v-else>
        <p>共同起点：{{ title(result.commonAncestor!) }} · {{ lens === 'director' ? '导演视角' : '参与者视角' }}</p>
        <div class="compare-sides">
          <article v-for="side in (['left', 'right'] as const)" :key="side">
            <h4>{{ side === 'left' ? '左侧' : '右侧' }}：{{ title(result[side].checkpointId) }}</h4>
            <p>路径 {{ result[side].turnCount }} 回合 · 分叉后 {{ result[side].divergentTurnCount }} 回合</p>
            <p>世界第 {{ result[side].clock.turn }} 回合 {{ result[side].clock.anchor }} {{ result[side].clock.elapsed }}</p>
            <button type="button" :disabled="unavailable || checkpoints.find(node => node.checkpointId === result?.[side].checkpointId)?.status === 'current'" @click="confirmation = { id: result[side].checkpointId, kind: 'restore' }">切换到{{ side === 'left' ? '左边' : '右边' }}</button>
            <form @submit.prevent="name(side)">
              <label :for="`${uid}-${side}-name`">命名{{ side === 'left' ? '左侧' : '右侧' }}存档点</label>
              <input :id="`${uid}-${side}-name`" v-model="names[side]" maxlength="80" :disabled="unavailable" />
              <button type="submit" :disabled="unavailable || !names[side].trim()">保存名称</button>
            </form>
            <button type="button" :disabled="unavailable" @click="confirmation = { id: result[side].checkpointId, kind: 'outcome' }">切换并生成结果报告</button>
          </article>
        </div>
        <div v-if="confirmation" class="compare-confirm" role="group" aria-label="确认切换世界线" @keydown.esc.prevent="confirmation = undefined">
          <p>切换到「{{ title(confirmation.id) }}」{{ confirmation.kind === 'outcome' ? '并生成结果报告' : '' }}？现有回合会保留。</p>
          <button type="button" @click="confirmation = undefined">取消</button>
          <button type="button" :disabled="unavailable" @click="confirm">确认切换</button>
        </div>
        <details v-for="section in result.sections" :key="section.kind" open>
          <summary>{{ labels[section.kind] }}（{{ section.total }}）</summary>
          <table v-if="section.items.length">
            <caption class="sr-only">{{ labels[section.kind] }}，左右两条世界线比较</caption>
            <thead><tr><th scope="col">项目</th><th scope="col">左侧</th><th scope="col">右侧</th></tr></thead>
            <tbody><tr v-for="row in section.items" :key="row.key"><th scope="row">{{ row.label }}</th><td>{{ row.left ?? '—' }}</td><td>{{ row.right ?? '—' }}</td></tr></tbody>
          </table>
          <p v-else>{{ section.total ? '本页无更多条目。' : '当前视角未发现差异。' }}</p>
        </details>
        <nav v-if="maxPages > 1" aria-label="比较结果分页">
          <button type="button" :disabled="unavailable || result.page === 0" @click="compare(result.page - 1)">上一页</button>
          <span>第 {{ result.page + 1 }} / {{ maxPages }} 页</span>
          <button type="button" :disabled="unavailable || result.page + 1 >= maxPages" @click="compare(result.page + 1)">下一页</button>
        </nav>
      </template>
    </template>
  </section>
</template>

<style scoped>
.play-worldline-compare { font-size: 12px; line-height: 1.5; }
h3, h4, p { margin: 0; }
form, .compare-sides article { display: grid; gap: 6px; min-width: 0; }
.compare-sides { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.compare-sides article, .compare-confirm { padding: 8px; border: 1px solid var(--play-line); }
input, select, button { min-width: 0; min-height: 36px; padding: 6px; border: 1px solid var(--play-line-strong); background: var(--play-canvas); color: var(--play-ink); font: inherit; }
button { cursor: pointer; } button:disabled { cursor: default; opacity: .6; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--play-ink); outline-offset: 2px; }
summary { cursor: pointer; font-weight: 700; padding-block: 8px; }
table { table-layout: fixed; width: 100%; border-collapse: collapse; }
td, th { text-align: start; vertical-align: top; padding: 6px; border: 1px solid var(--play-line); overflow-wrap: anywhere; white-space: pre-wrap; }
th { font-weight: 600; } td { color: var(--play-body); }
nav { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
[role='alert'] { color: var(--play-danger); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 600px) { .compare-sides { grid-template-columns: 1fr; } }
</style>
