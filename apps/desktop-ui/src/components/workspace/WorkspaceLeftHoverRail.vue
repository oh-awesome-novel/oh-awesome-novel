<script setup lang="ts">
import { onBeforeUnmount } from 'vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  updateOpen: [open: boolean];
}>();

let openTimer: number | undefined;
let closeTimer: number | undefined;

function scheduleOpen() {
  clearCloseTimer();
  openTimer = window.setTimeout(() => emit('updateOpen', true), 100);
}

function scheduleClose() {
  clearOpenTimer();
  closeTimer = window.setTimeout(() => emit('updateOpen', false), 180);
}

function clearOpenTimer() {
  if (openTimer !== undefined) {
    window.clearTimeout(openTimer);
    openTimer = undefined;
  }
}

function clearCloseTimer() {
  if (closeTimer !== undefined) {
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  }
}

onBeforeUnmount(() => {
  clearOpenTimer();
  clearCloseTimer();
});
</script>

<template>
  <div
    class="left-edge-hover-zone"
    aria-hidden="true"
    @mouseenter="scheduleOpen"
    @mouseleave="scheduleClose"
  ></div>
  <div
    v-if="open"
    class="workspace-left-overlay"
    @mouseenter="clearCloseTimer"
    @mouseleave="scheduleClose"
  >
    <slot></slot>
  </div>
</template>
