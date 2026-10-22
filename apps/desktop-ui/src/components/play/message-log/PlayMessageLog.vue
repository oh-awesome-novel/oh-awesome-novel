<script setup lang="ts">
import { shallowRef, toRef, watch } from 'vue';

import {
  PLAY_MESSAGE_LOG_KIND_FILTERS,
  playMessageLogKindLabel,
  playMessageLogRoleLabel,
  usePlayMessageLog,
  type PlayMessageLogClient,
} from '../../../composables/usePlayMessageLog';
import { useWorkspaceApi } from '../../../composables/useWorkspaceApi';
import type { PlayMessageLogEntry } from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  sessionId?: string;
  client?: PlayMessageLogClient;
}>();

const open = shallowRef(false);
const log = usePlayMessageLog({
  client: props.client ?? useWorkspaceApi(),
  sessionId: toRef(props, 'sessionId'),
});
const {
  visibleEntries,
  participants,
  skippedLines,
  hasMore,
  loading,
  error,
  kindFilter,
  participantFilter,
} = log;

watch(() => props.sessionId, () => {
  if (open.value) void log.reload();
});

function show(): void {
  open.value = true;
  void log.reload();
}

// Long prompts and thinking start collapsed so the log reads as a timeline.
function collapsible(entry: PlayMessageLogEntry): boolean {
  return entry.kind === 'model_reasoning' || entry.kind === 'model_request';
}

function entryKey(entry: PlayMessageLogEntry, index: number): string {
  return `${entry.at}:${entry.kind}:${index}`;
}

function metaLine(entry: PlayMessageLogEntry): string {
  const data = entry.data ?? {};
  return [
    typeof data.outcome === 'string' ? data.outcome : '',
    data.partial === true ? 'partial' : '',
    typeof data.actionKind === 'string' ? data.actionKind : '',
    typeof data.code === 'string' ? data.code : '',
    typeof data.reason === 'string' ? data.reason : '',
    entry.truncated ? 'truncated' : '',
  ].filter(Boolean).join(' · ');
}
</script>

<template>
  <section class="play-message-log-entry" aria-label="Play message log">
    <header>
      <span>Debug</span>
      <h2>消息日志</h2>
    </header>
    <p>按时间查看本会话发给模型和模型返回的全部内容，包括思考过程。</p>
    <button class="play-message-log-open" type="button" :disabled="!sessionId" @click="show">
      打开消息日志
    </button>
  </section>

  <div
    v-if="open"
    class="play-message-log-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Play 消息日志"
    @keydown.esc="open = false"
  >
    <div class="play-message-log-panel">
      <header class="play-message-log-header">
        <h2>消息日志</h2>
        <div class="play-message-log-filters">
          <label>
            <span>类型</span>
            <select v-model="kindFilter">
              <option v-for="option in PLAY_MESSAGE_LOG_KIND_FILTERS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            <span>角色</span>
            <select v-model="participantFilter">
              <option value="">全部</option>
              <option v-for="participant in participants" :key="participant" :value="participant">
                {{ participant === 'world_referee' ? 'World referee' : participant }}
              </option>
            </select>
          </label>
          <button type="button" :disabled="loading" @click="log.reload()">刷新</button>
          <button type="button" @click="open = false">关闭</button>
        </div>
      </header>

      <p v-if="error" class="play-message-log-error" role="alert">{{ error }}</p>
      <p v-if="skippedLines" class="play-message-log-warning" role="status">
        跳过了 {{ skippedLines }} 行无法解析的日志。
      </p>

      <ol class="play-message-log-list">
        <li
          v-for="(entry, index) in visibleEntries"
          :key="entryKey(entry, index)"
          class="play-message-log-item"
          :class="`play-message-log-kind-${entry.kind}`"
        >
          <div class="play-message-log-meta">
            <strong>{{ playMessageLogKindLabel(entry) }}</strong>
            <span v-if="entry.role">{{ playMessageLogRoleLabel(entry) }}</span>
            <span v-if="metaLine(entry)">{{ metaLine(entry) }}</span>
            <time :datetime="entry.at">{{ entry.at }}</time>
          </div>
          <details v-if="collapsible(entry) && entry.text">
            <summary>{{ entry.kind === 'model_reasoning' ? '展开思考过程' : '展开请求内容' }}</summary>
            <pre>{{ entry.text }}</pre>
          </details>
          <pre v-else-if="entry.text">{{ entry.text }}</pre>
        </li>
      </ol>

      <p v-if="!loading && visibleEntries.length === 0" class="play-message-log-empty">
        还没有日志。提交一个 Play 回合或生成一个 rehearsal step 后会出现在这里。
      </p>
      <footer class="play-message-log-footer">
        <span role="status" aria-live="polite">{{ loading ? '读取中…' : '' }}</span>
        <button v-if="hasMore" type="button" :disabled="loading" @click="log.loadMore()">加载更多</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.play-message-log-entry {
  display: grid;
  gap: 6px;
  padding: 11px 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-message-log-entry :where(h2, p),
.play-message-log-panel :where(h2, p, ol) {
  margin: 0;
}

.play-message-log-entry > header span,
.play-message-log-entry > p {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-message-log-entry h2,
.play-message-log-header h2 {
  font-size: 13px;
}

.play-message-log-open {
  justify-self: start;
}

.play-message-log-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 0.35);
}

.play-message-log-panel {
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  gap: 8px;
  width: min(960px, 100%);
  height: min(86vh, 100%);
  padding: 12px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-message-log-header,
.play-message-log-filters,
.play-message-log-meta,
.play-message-log-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.play-message-log-header {
  justify-content: space-between;
}

.play-message-log-filters label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.play-message-log-list {
  display: grid;
  align-content: start;
  gap: 6px;
  min-height: 0;
  overflow: auto;
  padding: 0;
  list-style: none;
}

.play-message-log-item {
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-message-log-meta {
  font-size: 11px;
}

.play-message-log-meta span,
.play-message-log-meta time,
.play-message-log-empty,
.play-message-log-footer {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-message-log-item pre {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.play-message-log-kind-model_reasoning {
  color: var(--play-muted, var(--editor-muted));
}

.play-message-log-error {
  color: var(--play-danger, var(--editor-danger));
}

.play-message-log-warning {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}
</style>
