<script setup lang="ts">
import type {
  PlayActivatedSource,
  PlayEventPolicy,
  PlayWorldClock,
} from '../../composables/useWorkspaceApi';
import type { PlayStateEntryView } from '../../composables/usePlayWorkspace';

defineProps<{
  clock: PlayWorldClock;
  policy: PlayEventPolicy;
  sceneStart: string;
  characters: string[];
  stateEntries: PlayStateEntryView[];
  sources: PlayActivatedSource[];
}>();

function sourceName(source: PlayActivatedSource): string {
  return source.path ?? source.sourceId;
}
</script>

<template>
  <section class="play-hud" aria-label="World HUD">
    <header class="play-hud-heading">
      <div>
        <span>World HUD</span>
        <h2>{{ clock.anchor || `Turn ${clock.turn}` }}</h2>
      </div>
      <span class="play-hud-marker" aria-hidden="true">[clock]</span>
    </header>

    <div class="play-hud-clock">
      <strong>Turn {{ clock.turn }}</strong>
      <span>Revision {{ clock.revision }}</span>
      <span v-if="clock.elapsed">+ {{ clock.elapsed }}</span>
    </div>

    <div class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> Scene & cast</h3>
      <p>{{ sceneStart }}</p>
      <div class="play-chip-list">
        <span v-for="character in characters" :key="character">{{ character }}</span>
        <span v-if="characters.length === 0">No fixed cast</span>
      </div>
    </div>

    <div class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> World activity</h3>
      <dl class="play-policy-grid">
        <div><dt>Mode</dt><dd>{{ policy.simulationMode }}</dd></div>
        <div><dt>Density</dt><dd>{{ policy.density }}</dd></div>
        <div><dt>Offscreen</dt><dd>{{ policy.allowOffscreen ? 'on' : 'off' }}</dd></div>
        <div><dt>Turn cap</dt><dd>{{ policy.maxExternalEventsPerTurn }}</dd></div>
      </dl>
    </div>

    <div v-if="stateEntries.length" class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> Local state</h3>
      <dl class="play-state-list">
        <div v-for="entry in stateEntries" :key="entry.key">
          <dt>{{ entry.key }}</dt>
          <dd>{{ entry.value }}</dd>
        </div>
      </dl>
    </div>

    <div class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> Active sources</h3>
      <div v-if="sources.length" class="play-source-list">
        <article v-for="source in sources" :key="source.sourceId">
          <strong>{{ sourceName(source) }}</strong>
          <span>{{ source.trust }} · {{ source.budgetLayer }}</span>
          <p>{{ source.reason }}</p>
        </article>
      </div>
      <p v-else class="play-muted-copy">No source activation recorded for this session.</p>
    </div>
  </section>
</template>
