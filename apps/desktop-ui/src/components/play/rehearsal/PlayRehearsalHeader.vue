<script setup lang="ts">
import type {
  PlayRehearsalAttemptStatus,
  PlayRehearsalClockView,
  PlayRehearsalSceneContractView,
} from './types';

const { scene, clock, attemptStatus } = defineProps<{
  scene: Readonly<PlayRehearsalSceneContractView>;
  clock: Readonly<PlayRehearsalClockView>;
  attemptStatus?: PlayRehearsalAttemptStatus;
}>();
</script>

<template>
  <header class="play-rehearsal-header">
    <div>
      <span>Scene Contract</span>
      <h1>{{ scene.title }}</h1>
      <p>{{ scene.location || 'Location unspecified' }}<template v-if="scene.objective"> · {{ scene.objective }}</template></p>
    </div>
    <dl>
      <div><dt>World</dt><dd>{{ clock.anchor || `Turn ${clock.turn}` }}</dd></div>
      <div><dt>Revision</dt><dd>{{ clock.revision }}</dd></div>
      <div><dt>Attempt</dt><dd>{{ attemptStatus || 'not started' }}</dd></div>
    </dl>
  </header>
</template>

<style scoped>
.play-rehearsal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 13px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-header > div {
  display: grid;
  gap: 2px;
}

.play-rehearsal-header > div > span,
.play-rehearsal-header dt,
.play-rehearsal-header p {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-header :where(h1, p, dl) {
  margin: 0;
}

.play-rehearsal-header h1 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 15px;
}

.play-rehearsal-header dl {
  display: flex;
  align-items: center;
  gap: 12px;
}

.play-rehearsal-header dl div {
  display: grid;
  gap: 1px;
}

.play-rehearsal-header dd {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 10px;
}

@media (max-width: 720px) {
  .play-rehearsal-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .play-rehearsal-header dl {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
