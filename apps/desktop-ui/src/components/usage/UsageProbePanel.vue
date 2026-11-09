<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import type { UsageInspectorScope, UsageProbe, UsageProbeOptions, UsageProbeResult } from '@oh-awesome-novel/client';
import { oanClient } from '../../client';

const props = defineProps<{ workspaceKey: string; scope: UsageInspectorScope }>();
const opened = shallowRef(false);
const options = shallowRef<UsageProbeOptions>();
const probe = shallowRef<UsageProbe>();
const result = shallowRef<UsageProbeResult>();
const loading = shallowRef(false);
const running = shallowRef(false);
const stopping = shallowRef(false);
const error = shallowRef('');
const identity = computed(() => JSON.stringify({ workspace: props.workspaceKey, scope: props.scope }));
const bookmarkKey = computed(() => `oan:usage-probe:${identity.value}`);
const unresolved = computed(() => ['running', 'unknown'].includes(probe.value?.status ?? ''));
let generation = 0;
let controller: AbortController | undefined;
const statusLabels = { ready: '已准备，尚未调用', running: '对照进行中', completed: '两次调用已完成', failed: '对照失败', aborted: '已停止', unknown: '结果未知，请刷新记录' };
function count(value?: number): string { return value === undefined ? '未提供' : value.toLocaleString(); }
function saveBookmark(id: string): void { try { localStorage.setItem(bookmarkKey.value, id); } catch { /* UI bookmark only. */ } }
function readBookmark(): string | undefined {
  try { const id = localStorage.getItem(bookmarkKey.value); return id && /^probe_[A-Za-z0-9_-]{1,110}$/u.test(id) ? id : undefined; }
  catch { return undefined; }
}
async function load(): Promise<void> {
  const version = ++generation; const key = identity.value;
  loading.value = true; error.value = '';
  try {
    const value = await oanClient.getUsageProbeOptions();
    if (version !== generation || key !== identity.value) return;
    options.value = value;
    const id = readBookmark();
    if (id) {
      try {
        const stored = await oanClient.getUsageProbe(id);
        if (version === generation && key === identity.value && JSON.stringify(stored.probe.scope) === JSON.stringify(props.scope)) {
          result.value = stored; probe.value = stored.probe;
        }
      } catch { /* A deleted disposable probe does not block a new one. */ }
    }
  } catch {
    if (version === generation) error.value = '无法读取模型对照设置。请检查 Provider 配置。';
  } finally { if (version === generation) loading.value = false; }
}
function toggle(): void { opened.value = !opened.value; if (opened.value && !options.value) void load(); }
async function run(): Promise<void> {
  if (!options.value || running.value || unresolved.value) return;
  const version = ++generation; const key = identity.value; const active = new AbortController(); controller = active;
  const configured = options.value.provider;
  running.value = true; stopping.value = false; error.value = ''; result.value = undefined; probe.value = undefined;
  try {
    const created = await oanClient.createUsageProbe(props.scope, { expectedProviderId: configured.providerId, expectedModelId: configured.modelId });
    if (version !== generation || key !== identity.value) return;
    probe.value = created; saveBookmark(created.id);
    if (active.signal.aborted) {
      const cancelled = await oanClient.cancelUsageProbe(created.id);
      if (version === generation && key === identity.value) {
        probe.value = { ...created, status: cancelled.status };
        error.value = '已在准备阶段停止，没有启动模型对照调用。';
      }
      return;
    }
    const value = await oanClient.runUsageProbe(created.id, { signal: active.signal });
    if (version === generation && key === identity.value) { result.value = value; probe.value = value.probe; }
  } catch {
    if (version === generation) {
      if (probe.value && !['completed', 'failed', 'aborted'].includes(probe.value.status)) probe.value = { ...probe.value, status: 'unknown' };
      error.value = active.signal.aborted
        ? '已请求停止。刷新对照记录可查看服务端已完成的调用。'
        : '对照未完成或模型配置发生变化。请刷新记录与模型设置后再决定是否新建对照。';
    }
  } finally { if (version === generation) { running.value = false; stopping.value = false; controller = undefined; } }
}
async function cancel(): Promise<void> {
  const current = probe.value; const key = identity.value; const version = generation;
  if (stopping.value) return;
  stopping.value = true; controller?.abort('usage-probe-cancelled');
  if (!current) return;
  try {
    const cancelled = await oanClient.cancelUsageProbe(current.id);
    if (key === identity.value && version === generation && probe.value?.id === current.id) {
      probe.value = { ...current, status: cancelled.status };
      const stored = await oanClient.getUsageProbe(current.id);
      if (key === identity.value && version === generation) { result.value = stored; probe.value = stored.probe; }
    }
  } catch { if (key === identity.value && version === generation) error.value = '停止结果尚未确认，请刷新对照记录。'; }
  finally { if (key === identity.value && version === generation) stopping.value = false; }
}
async function refresh(): Promise<void> {
  if (!probe.value || loading.value || running.value) return;
  const version = ++generation; const key = identity.value; const id = probe.value.id;
  loading.value = true; error.value = '';
  try {
    const value = await oanClient.getUsageProbe(id);
    if (version === generation && key === identity.value) { result.value = value; probe.value = value.probe; }
  } catch { if (version === generation) error.value = '无法读取对照结果；不会自动重放调用。'; }
  finally { if (version === generation) loading.value = false; }
}
function reset(): void {
  generation++; controller?.abort('usage-scope-changed'); controller = undefined;
  options.value = undefined; probe.value = undefined; result.value = undefined;
  loading.value = false; running.value = false; stopping.value = false; error.value = ''; opened.value = false;
}
watch(identity, reset, { flush: 'sync' });
onBeforeUnmount(reset);
</script>

<template>
  <section class="usage-probe" aria-label="模型用量对照">
    <button type="button" :aria-expanded="opened" @click="toggle">{{ opened ? '收起' : '打开' }}模型对照</button>
    <div v-if="opened" class="probe-body" :aria-busy="loading || running">
      <p>使用合成短文本，最多顺序调用当前模型 2 次。不会发送小说内容或修改作品；可能产生模型服务费用，结果独立于故事用量。</p>
      <p v-if="options">模型：{{ options.provider.providerId }} / {{ options.provider.modelId }} · 上限 {{ options.maxCalls }} 次</p>
      <p v-if="loading" role="status">正在读取对照设置与记录…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="probe-actions">
        <button type="button" :disabled="!options || loading || running || unresolved" @click="run">运行 2 次合成样例</button>
        <button v-if="running || unresolved" type="button" :disabled="stopping" @click="cancel">{{ stopping ? '正在停止…' : '停止对照' }}</button>
        <button v-if="probe" type="button" :disabled="loading || running" @click="refresh">刷新对照记录</button>
        <button v-if="!running" type="button" :disabled="loading" @click="load">刷新模型设置</button>
      </div>
      <p v-if="probe" role="status">{{ statusLabels[probe.status] }} · 已完成 {{ probe.completedCalls }}/{{ probe.maxCalls }} 次</p>
      <template v-if="result">
        <p>Actual {{ result.projection.totals.actualCoverage }} · 输入 {{ count(result.projection.totals.actualUsage.inputTokens) }} · 输出 {{ count(result.projection.totals.actualUsage.outputTokens) }}</p>
        <p>缓存读取 {{ count(result.projection.totals.actualUsage.cacheReadTokens) }} · 缓存写入 {{ count(result.projection.totals.actualUsage.cacheWriteTokens) }}</p>
        <p class="probe-note">此对照仅记录本模型对合成输入的返回值，不推算小说账单，也不保证下一轮缓存命中。</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.usage-probe { border-top: 1px solid var(--play-line, var(--editor-hairline)); padding-top: 10px; min-width: 0; }
.probe-body { display: grid; gap: 8px; margin-top: 8px; }
.probe-body p { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }
.probe-note { color: var(--play-muted, var(--editor-muted)); }
.probe-actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { min-height: 32px; border: 1px solid var(--play-line, var(--editor-hairline)); background: var(--play-surface, var(--editor-surface)); color: inherit; font: inherit; padding: 5px 8px; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
button:focus-visible { outline: 2px solid var(--play-ink, var(--editor-ink)); outline-offset: 2px; }
</style>
