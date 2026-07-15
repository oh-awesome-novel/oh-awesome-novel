<script setup lang="ts">
const { recovering = false, message = '' } = defineProps<{
  recovering?: boolean;
  message?: string;
}>();

const emit = defineEmits<{
  recover: [];
}>();
</script>

<template>
  <section
    class="play-rehearsal-recovery"
    aria-label="Actor-step recovery required"
    role="alert"
  >
    <div>
      <strong>Rehearsal truth needs reconciliation</strong>
      <p>
        Active-attempt or actor-step truth could not be proven. Recover from authoritative
        attempt state before continuing; no Play turn is committed by this action.
      </p>
      <small v-if="message">{{ message }}</small>
    </div>
    <button
      type="button"
      :disabled="recovering"
      @click="emit('recover')"
    >
      {{ recovering ? 'Recovering…' : 'Recover attempt truth' }}
    </button>
  </section>
</template>

<style scoped>
.play-rehearsal-recovery {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid var(--play-danger, var(--editor-danger));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-recovery > div {
  display: grid;
  gap: 3px;
}

.play-rehearsal-recovery strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-recovery p,
.play-rehearsal-recovery small {
  margin: 0;
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
  line-height: 1.5;
}

.play-rehearsal-recovery button {
  min-height: 34px;
  flex: 0 0 auto;
  padding: 0 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

@media (max-width: 640px) {
  .play-rehearsal-recovery {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
