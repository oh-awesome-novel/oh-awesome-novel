<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';

import { PLAY_RELATIONSHIP_PROTAGONIST } from '@oh-awesome-novel/client';
import type { OanClient } from '@oh-awesome-novel/client';

import { PLAY_VISIBILITY_LABELS } from '../../composables/playTerms';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  PlayRelationshipEntry,
  PlayRelationshipLens,
  PlayRelationshipThread,
  PlayRelationshipTimeline,
} from '../../composables/useWorkspaceApi';

export type PlayRelationshipApi = Pick<OanClient, 'getPlayRelationshipTimeline'>;

const props = withDefaults(defineProps<{
  sessionId: string;
  /** Changes whenever the selected branch or its head changes. */
  branchKey: string;
  lens: PlayRelationshipLens;
  /** True while a turn is being written; the projection waits for the commit. */
  paused?: boolean;
  api?: PlayRelationshipApi;
}>(), {
  paused: false,
  api: undefined,
});

const emit = defineEmits<{
  focusEvent: [eventId: string];
  focusTurn: [artifactId: string];
}>();

const api: PlayRelationshipApi = props.api ?? useWorkspaceApi();
const timeline = shallowRef<PlayRelationshipTimeline>();
const loading = shallowRef(false);
const error = shallowRef('');
let request: AbortController | undefined;

const threads = computed(() => timeline.value?.threads ?? []);
const pressureStatusLabels: Readonly<Record<string, string>> = {
  latent: '潜伏',
  active: '进行中',
  resolved: '已了结',
};

// A commit holds the session briefly after the turn stream ends; a read that
// lands in that window is refused, so retry a few times before reporting.
const RETRY_DELAYS_MS = [300, 600, 1200];

async function load(): Promise<void> {
  request?.abort();
  if (props.paused) return;
  const current = new AbortController();
  request = current;
  loading.value = true;
  error.value = '';
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await api.getPlayRelationshipTimeline(
          props.sessionId,
          props.lens,
          current.signal,
        );
        if (request === current) timeline.value = result.timeline;
        return;
      } catch (cause) {
        if (request !== current || current.signal.aborted) return;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          // Never keep showing another branch's or another lens's relationships.
          timeline.value = undefined;
          error.value = cause instanceof Error ? cause.message : String(cause);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (request !== current || current.signal.aborted) return;
      }
    }
  } finally {
    if (request === current) loading.value = false;
  }
}

watch(
  () => [props.sessionId, props.branchKey, props.lens, props.paused] as const,
  () => { void load(); },
  { immediate: true },
);

onBeforeUnmount(() => request?.abort());

function threadTitle(thread: PlayRelationshipThread): string {
  if (!thread.participants.length) return '未指明人物';
  return thread.participants
    .map((name) => name === PLAY_RELATIONSHIP_PROTAGONIST ? '参与者' : name)
    .join(' · ');
}

function statusLabel(entry: PlayRelationshipEntry): string | undefined {
  const status = entry.pressureStatus;
  if (!status) return undefined;
  const to = pressureStatusLabels[status.to] ?? status.to;
  return status.from && status.from !== status.to
    ? `${pressureStatusLabels[status.from] ?? status.from} → ${to}`
    : to;
}
</script>

<template>
  <section class="play-hud-section play-relationship-panel" aria-label="关系与态度">
    <h3><span aria-hidden="true">[+]</span> 关系与态度</h3>
    <p class="play-muted-copy">
      只读 · 由当前分支的关系事件与关系压力整理 · {{ lens === 'director' ? '导演视角' : '参与者视角' }}
    </p>
    <p v-if="error" class="play-relationship-error" role="alert">
      关系面板读取失败：{{ error }}
      <button type="button" class="play-relationship-retry" @click="load">重试</button>
    </p>
    <p v-else-if="loading && !timeline" role="status">正在整理关系变化…</p>
    <p v-else-if="!threads.length" class="play-muted-copy">当前分支还没有记录到关系变化。</p>

    <article
      v-for="thread in threads"
      :key="thread.key"
      class="play-relationship-thread"
    >
      <h4>{{ threadTitle(thread) }}</h4>
      <ol>
        <li
          v-for="entry in thread.entries"
          :key="entry.id"
          :class="`play-relationship-${entry.visibility}`"
        >
          <div class="play-relationship-meta">
            <button
              v-if="entry.artifactId"
              type="button"
              :aria-label="`在世界线中查看第 ${entry.turn} 回合`"
              @click="emit('focusTurn', entry.artifactId)"
            >
              第 {{ entry.turn }} 回合
            </button>
            <span v-else>开局</span>
            <span>{{ entry.source === 'pressure' ? '关系压力' : '关系事件' }}</span>
            <span v-if="statusLabel(entry)">{{ statusLabel(entry) }}</span>
            <span v-if="entry.visibility !== 'playerVisible'">
              {{ PLAY_VISIBILITY_LABELS[entry.visibility] ?? entry.visibility }}
            </span>
          </div>
          <strong>{{ entry.title }}</strong>
          <p v-if="entry.summary">{{ entry.summary }}</p>
          <p v-if="entry.reason" class="play-relationship-reason">
            <span>导演视角起因</span> {{ entry.reason }}
          </p>
          <button
            v-if="entry.eventId"
            class="play-relationship-event-link"
            type="button"
            @click="emit('focusEvent', entry.eventId)"
          >
            查看事件卡片
          </button>
        </li>
      </ol>
    </article>
  </section>
</template>

<style scoped>
.play-relationship-thread {
  display: grid;
  gap: 5px;
}

.play-relationship-thread h4 {
  margin: 0;
  color: var(--play-ink);
  font-size: 12px;
}

.play-relationship-thread ol {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0 0 0 9px;
  border-left: 1px solid var(--play-line);
  list-style: none;
}

.play-relationship-thread li {
  display: grid;
  gap: 3px;
  font-size: 11px;
}

.play-relationship-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--play-muted);
}

.play-relationship-retry,
.play-relationship-thread button {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--play-body);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}

.play-relationship-thread strong {
  color: var(--play-ink);
}

.play-relationship-reason span {
  color: var(--play-body);
  font-weight: 700;
}

.play-relationship-playerUnknown {
  opacity: 0.85;
}

.play-relationship-error {
  color: var(--play-danger);
}
</style>
