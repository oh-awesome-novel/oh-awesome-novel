<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import type {
  PlayEventDensity,
  PlaySimulationMode,
} from '../../composables/useWorkspaceApi';
import type { PlaySessionCreateInput } from '../../composables/usePlayWorkspace';

defineProps<{
  creating: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  create: [input: PlaySessionCreateInput];
}>();

const title = shallowRef('');
const sceneStart = shallowRef('');
const userPersona = shallowRef('');
const characters = shallowRef('');
const simulationMode = shallowRef<PlaySimulationMode>('reactiveWorld');
const density = shallowRef<PlayEventDensity>('balanced');
const canCreate = computed(() =>
  title.value.trim().length > 0 && sceneStart.value.trim().length > 0,
);

function submitCreate() {
  if (!canCreate.value) {
    return;
  }

  emit('create', {
    title: title.value.trim(),
    sceneStart: sceneStart.value.trim(),
    userPersona: userPersona.value.trim() || undefined,
    characters: splitCharacters(characters.value),
    eventPolicy: {
      simulationMode: simulationMode.value,
      density: density.value,
    },
  });
}

function splitCharacters(value: string): string[] {
  return value
    .split(/\r?\n|,/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
</script>

<template>
  <form class="play-create-form" @submit.prevent="submitCreate">
    <label>
      <span>标题</span>
      <input v-model="title" class="text-input" type="text" placeholder="雨夜码头">
    </label>
    <label>
      <span>开场场景</span>
      <textarea v-model="sceneStart" class="text-input" rows="3" placeholder="从一个可行动的瞬间开始"></textarea>
    </label>
    <label>
      <span>玩家身份</span>
      <input v-model="userPersona" class="text-input" type="text" placeholder="可选">
    </label>
    <label>
      <span>在场角色</span>
      <textarea v-model="characters" class="text-input" rows="2" placeholder="每行一个角色"></textarea>
    </label>
    <div class="play-policy-fields">
      <label>
        <span>世界模式</span>
        <select v-model="simulationMode" class="text-input">
          <option value="conversation">Conversation</option>
          <option value="reactiveWorld">Reactive world</option>
          <option value="activeWorld">Active world</option>
        </select>
      </label>
      <label>
        <span>事件密度</span>
        <select v-model="density" class="text-input">
          <option value="quiet">Quiet</option>
          <option value="balanced">Balanced</option>
          <option value="volatile">Volatile</option>
        </select>
      </label>
    </div>
    <div class="play-create-actions">
      <button class="ghost-button tight-button" type="button" :disabled="creating" @click="emit('cancel')">
        Cancel
      </button>
      <button class="primary-button tight-button" type="submit" :disabled="creating || !canCreate">
        {{ creating ? 'Creating…' : 'Create session' }}
      </button>
    </div>
  </form>
</template>
