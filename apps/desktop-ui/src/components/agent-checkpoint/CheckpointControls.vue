<script setup lang="ts">
import type { ChatStatus } from 'ai';

defineProps<{
  status: ChatStatus;
}>();

const emit = defineEmits<{
  run: [prompt: string];
  stop: [];
}>();

const checkpoints = [
  {
    id: 'level-1',
    title: 'Level 1',
    body: 'Read workflow and constitution.',
    prompt: 'Level 1: read workflow and constitution.',
  },
  {
    id: 'level-2',
    title: 'Level 2',
    body: 'Read heroine and state.',
    prompt: 'Level 2: read character and state.',
  },
  {
    id: 'level-3',
    title: 'Level 3',
    body: 'Create a pending write preview.',
    prompt: 'Level 3: create a pending write preview.',
  },
];
</script>

<template>
  <div class="panel">
    <div class="panel-heading">
      <h2 class="panel-title">Checkpoints</h2>
      <span class="status-pill">{{ status }}</span>
    </div>

    <div class="checkpoint-list">
      <button
        v-for="checkpoint in checkpoints"
        :key="checkpoint.id"
        class="checkpoint-button"
        type="button"
        :disabled="status !== 'ready'"
        @click="emit('run', checkpoint.prompt)"
      >
        <span class="checkpoint-title">{{ checkpoint.title }}</span>
        <span class="checkpoint-body">{{ checkpoint.body }}</span>
      </button>
    </div>

    <button
      class="secondary-button"
      type="button"
      :disabled="status === 'ready'"
      @click="emit('stop')"
    >
      Stop stream
    </button>
  </div>
</template>
