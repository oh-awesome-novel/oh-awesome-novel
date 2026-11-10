<script setup lang="ts">
import { PLAY_START_MODE_LABELS } from '../../composables/playTerms';
import type { PlaySessionSummary } from '../../composables/useWorkspaceApi';

defineProps<{
  sessions: readonly Readonly<PlaySessionSummary>[];
  selectedSessionId: string;
  loading: boolean;
  creating: boolean;
  busy: boolean;
  refreshDisabled: boolean;
}>();

const emit = defineEmits<{
  selectSession: [id: string];
  newSession: [];
  refresh: [];
}>();
</script>

<template>
  <aside class="play-session-rail" aria-label="推演会话">
    <div class="play-rail-heading">
      <div>
        <span class="play-kicker">入口</span>
        <h2>推演会话</h2>
      </div>
      <button
        class="play-icon-button"
        type="button"
        :disabled="loading || refreshDisabled"
        aria-label="刷新推演会话"
        @click="emit('refresh')"
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>

    <button
      class="play-create-trigger"
      type="button"
      :disabled="busy || creating"
      @click="emit('newSession')"
    >
      <span aria-hidden="true">[+]</span>
      新建会话
    </button>

    <div class="play-session-list">
      <button
        v-for="session in sessions"
        :key="session.id"
        class="play-session-card"
        :class="{ 'play-session-card-active': session.id === selectedSessionId }"
        type="button"
        :disabled="busy"
        :aria-current="session.id === selectedSessionId ? 'true' : undefined"
        @click="emit('selectSession', session.id)"
      >
        <span class="play-session-title">{{ session.title }}</span>
        <span class="play-session-scene">
          {{ session.purpose === 'sceneRehearsal' ? '场景试演' : '沉浸推演' }}
          · {{ PLAY_START_MODE_LABELS[session.startMode] ?? session.startMode }}
        </span>
        <span class="play-session-meta">
          第 {{ session.worldClock.turn }} 回合 · {{ session.transcriptCount }} 条消息
          · {{ session.eventCount }} 条事件
        </span>
      </button>
      <p v-if="!loading && sessions.length === 0" class="play-empty-copy">
        还没有推演会话。创建一个场景，让人物和世界开始运转。
      </p>
    </div>
  </aside>
</template>
