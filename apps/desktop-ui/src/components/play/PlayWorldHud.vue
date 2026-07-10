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

<style scoped>
.play-hud {
  display: grid;
  gap: 13px;
}

.play-hud-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgb(120 75 36);
}

.play-hud-heading span {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .11em;
  text-transform: uppercase;
}

.play-hud-heading h2 {
  margin: 3px 0 0;
  color: rgb(68 54 43);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 18px;
}

.play-hud-clock {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 8px;
  padding: 11px;
  border: 1px solid rgb(225 203 170);
  border-radius: 9px;
  background: linear-gradient(135deg, rgb(255 247 230), rgb(255 252 247));
  color: rgb(120 75 36);
}

.play-hud-clock strong {
  grid-row: span 2;
  align-self: center;
  font-size: 17px;
}

.play-hud-clock span {
  font-size: 10px;
  text-align: right;
}

.play-hud-section {
  display: grid;
  gap: 7px;
  padding-top: 12px;
  border-top: 1px solid rgb(235 226 212);
}

.play-hud-section h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: rgb(98 72 50);
  font-size: 11px;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.play-hud-section p,
.play-source-list p {
  margin: 0;
  color: rgb(139 112 88);
  font-size: 11px;
  line-height: 1.5;
}

.play-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.play-chip-list span {
  padding: 3px 7px;
  border-radius: 999px;
  background: rgb(246 235 218);
  color: rgb(120 75 36);
  font-size: 10px;
  font-weight: 800;
}

.play-policy-grid,
.play-state-list {
  display: grid;
  gap: 6px;
  margin: 0;
}

.play-policy-grid {
  grid-template-columns: 1fr 1fr;
}

.play-policy-grid div,
.play-state-list div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.play-policy-grid dt,
.play-state-list dt {
  color: rgb(148 119 91);
  font-size: 10px;
}

.play-policy-grid dd,
.play-state-list dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: rgb(82 60 43);
  font-size: 10px;
  font-weight: 800;
  text-align: right;
}

.play-source-list {
  display: grid;
  gap: 6px;
}

.play-source-list article {
  display: grid;
  gap: 2px;
  padding: 8px;
  border-radius: 7px;
  background: rgb(250 246 238);
}

.play-source-list strong,
.play-source-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-source-list strong {
  color: rgb(82 60 43);
  font-size: 10px;
}

.play-source-list span {
  color: rgb(180 83 9);
  font-size: 9px;
  font-weight: 800;
}

:global([data-theme="dark"]) .play-hud-heading h2,
:global([data-theme="dark"]) .play-policy-grid dd,
:global([data-theme="dark"]) .play-state-list dd,
:global([data-theme="dark"]) .play-source-list strong {
  color: rgb(245 235 220);
}

:global([data-theme="dark"]) .play-hud-clock,
:global([data-theme="dark"]) .play-source-list article {
  border-color: rgb(83 70 58);
  background: rgb(38 32 28);
}

:global([data-theme="dark"]) .play-hud-section {
  border-color: rgb(68 58 49);
}
</style>
