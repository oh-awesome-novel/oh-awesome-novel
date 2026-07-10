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
        :disabled="loading"
        aria-label="刷新 Play sessions"
        @click="emit('refresh')"
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>

    <button class="play-create-trigger" type="button" @click="createOpen = !createOpen">
      <span aria-hidden="true">[+]</span>
      New session
    </button>

    <PlaySessionCreateForm
      v-if="createOpen"
      :creating="creating"
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

<style scoped>
.play-session-rail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding: 16px;
  border-right: 1px solid rgb(231 220 202);
  background: rgb(250 246 238);
}

.play-rail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.play-rail-heading h2 {
  margin: 2px 0 0;
  color: rgb(68 54 43);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 18px;
}

.play-kicker {
  color: rgb(180 83 9);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.play-icon-button,
.play-create-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgb(214 198 174);
  border-radius: 7px;
  background: rgb(255 252 247);
  color: rgb(120 75 36);
  font-weight: 800;
}

.play-icon-button {
  width: 31px;
  height: 31px;
  padding: 0;
}

.play-create-trigger {
  min-height: 34px;
}

.play-session-list {
  display: grid;
  gap: 8px;
}

.play-session-card {
  display: grid;
  gap: 5px;
  width: 100%;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgb(68 54 43);
  text-align: left;
}

.play-session-card:hover,
.play-session-card-active {
  border-color: rgb(214 198 174);
  background: rgb(255 252 247);
}

.play-session-card-active {
  box-shadow: inset 3px 0 rgb(217 119 6);
}

.play-session-title {
  font-weight: 900;
}

.play-session-scene,
.play-session-meta,
.play-empty-copy {
  color: rgb(139 112 88);
  font-size: 11px;
  line-height: 1.45;
}

.play-session-scene {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

:global([data-theme="dark"]) .play-session-rail {
  border-color: rgb(68 58 49);
  background: rgb(29 25 22);
}

:global([data-theme="dark"]) .play-rail-heading h2,
:global([data-theme="dark"]) .play-session-card {
  color: rgb(245 235 220);
}

:global([data-theme="dark"]) .play-icon-button,
:global([data-theme="dark"]) .play-create-trigger,
:global([data-theme="dark"]) .play-session-card:hover,
:global([data-theme="dark"]) .play-session-card-active {
  border-color: rgb(83 70 58);
  background: rgb(38 32 28);
}
</style>
