<script setup lang="ts">
const emit = defineEmits<{
  configure: [];
}>();
</script>

<template>
  <section class="play-rehearsal-provider-gate" aria-label="Provider required">
    <div>
      <strong>Actor-step generation is unavailable</strong>
      <p>The setup and committed result remain readable. Configure a provider to begin or continue an attempt.</p>
    </div>
    <button type="button" @click="emit('configure')">Configure Provider</button>
  </section>
</template>

<style scoped>
.play-rehearsal-provider-gate,
.play-rehearsal-provider-gate > div {
  display: flex;
  align-items: center;
}

.play-rehearsal-provider-gate {
  justify-content: space-between;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-provider-gate > div {
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
}

.play-rehearsal-provider-gate strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-provider-gate p {
  margin: 0;
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-provider-gate button {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

@media (max-width: 720px) {
  .play-rehearsal-provider-gate {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
