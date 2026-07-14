<script setup lang="ts">
import { shallowRef, watch } from 'vue';

import PlaySessionCreateForm from './PlaySessionCreateForm.vue';
import type { PlaySession } from '../../composables/useWorkspaceApi';
import type { PlaySessionCreateInput } from '../../composables/usePlayWorkspace';

const props = defineProps<{
  sessions: PlaySession[];
  selectedSessionId: string;
  loading: boolean;
  creating: boolean;
  busy: boolean;
  refreshDisabled: boolean;
}>();

const emit = defineEmits<{
  selectSession: [id: string];
  createSession: [input: PlaySessionCreateInput];
  refresh: [];
}>();

const createOpen = shallowRef(false);

watch(
  () => props.selectedSessionId,
  (nextId, previousId) => {
    if (nextId && nextId !== previousId) {
      createOpen.value = false;
    }
  },
);
</script>

<template>
  <aside class="play-session-rail" aria-label="Play sessions">
    <div class="play-rail-heading">
      <div>
        <span class="play-kicker">Stage door</span>
        <h2>Play Sessions</h2>
      </div>
      <button
        class="play-icon-button"
        type="button"
        :disabled="loading || refreshDisabled"
        aria-label="刷新 Play sessions"
        @click="emit('refresh')"
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>

    <button
      class="play-create-trigger"
      type="button"
      :disabled="busy"
      @click="createOpen = !createOpen"
    >
      <span aria-hidden="true">[+]</span>
      New session
    </button>

    <PlaySessionCreateForm
      v-if="createOpen"
      :creating="creating || busy"
      @cancel="createOpen = false"
      @create="emit('createSession', $event)"
    />

    <div class="play-session-list">
      <button
        v-for="session in sessions"
        :key="session.id"
        class="play-session-card"
        :class="{ 'play-session-card-active': session.id === selectedSessionId }"
        type="button"
        :disabled="busy"
        @click="emit('selectSession', session.id)"
      >
        <span class="play-session-title">{{ session.title }}</span>
        <span class="play-session-scene">{{ session.sceneStart }}</span>
        <span class="play-session-meta">
          Turn {{ session.worldClock.turn }} · {{ session.transcript.length }} messages
        </span>
      </button>
      <p v-if="!loading && sessions.length === 0" class="play-empty-copy">
        暂无 Play session。创建一个场景，让人物和世界开始运转。
      </p>
    </div>
  </aside>
</template>
