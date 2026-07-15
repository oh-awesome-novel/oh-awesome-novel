<script setup lang="ts">
import { useId } from 'vue';

import type {
  PlayRehearsalActorQueueItem,
  PlayRehearsalPerceptionView,
  PlayRehearsalSceneContractView,
  PlayRehearsalVisibleEventView,
} from './types';

const { scene, activeActor, perception, visibleEvents } = defineProps<{
  scene: Readonly<PlayRehearsalSceneContractView>;
  activeActor?: Readonly<PlayRehearsalActorQueueItem>;
  perception?: Readonly<PlayRehearsalPerceptionView>;
  visibleEvents: readonly Readonly<PlayRehearsalVisibleEventView>[];
}>();

const headingId = `${useId()}-rehearsal-inspector-heading`;
</script>

<template>
  <aside class="play-rehearsal-inspector" :aria-labelledby="headingId">
    <header>
      <span>Director view</span>
      <h2 :id="headingId">Scene Inspector</h2>
    </header>

    <section>
      <h3>Scene Contract</h3>
      <dl>
        <div><dt>Location</dt><dd>{{ scene.location || 'Unspecified' }}</dd></div>
        <div><dt>Objective</dt><dd>{{ scene.objective || 'Unspecified' }}</dd></div>
        <div><dt>Risk</dt><dd>{{ scene.risk || 'Unspecified' }}</dd></div>
        <div><dt>Atmosphere</dt><dd>{{ scene.atmosphere || 'Unspecified' }}</dd></div>
      </dl>
    </section>

    <section>
      <h3>Current actor</h3>
      <div v-if="activeActor" class="play-rehearsal-current-actor">
        <strong>{{ activeActor.displayName }}</strong>
        <span>{{ activeActor.position || 'Position not specified' }}</span>
        <p>{{ activeActor.currentGoal || 'Goal not specified' }}</p>
      </div>
      <p v-else class="play-rehearsal-inspector-empty">No actor is currently active.</p>
    </section>

    <section>
      <h3>Permitted perception</h3>
      <p class="play-rehearsal-perception-note">
        Only the filtered perception supplied for this actor is rendered here.
      </p>
      <template v-if="perception">
        <h4>Visible facts</h4>
        <ul v-if="perception.visibleFacts.length">
          <li v-for="(fact, index) in perception.visibleFacts" :key="`${index}:${fact}`">{{ fact }}</li>
        </ul>
        <p v-else class="play-rehearsal-inspector-empty">No visible facts supplied.</p>

        <h4>Behavior anchors</h4>
        <ul v-if="perception.behaviorAnchors.length">
          <li v-for="(anchor, index) in perception.behaviorAnchors" :key="`${index}:${anchor}`">{{ anchor }}</li>
        </ul>
        <p v-else class="play-rehearsal-inspector-empty">No behavior anchors supplied.</p>

        <h4>Observed blocks</h4>
        <ul v-if="perception.observedBlockLabels.length">
          <li v-for="(label, index) in perception.observedBlockLabels" :key="`${index}:${label}`">{{ label }}</li>
        </ul>
        <p v-else class="play-rehearsal-inspector-empty">No earlier block observations.</p>

        <p v-if="perception.omissionNotice" class="play-rehearsal-omission-notice">
          {{ perception.omissionNotice }}
        </p>
      </template>
      <p v-else class="play-rehearsal-inspector-empty">Perception package not prepared.</p>
    </section>

    <section>
      <h3>Visible events</h3>
      <ul v-if="visibleEvents.length" class="play-rehearsal-visible-events">
        <li v-for="event in visibleEvents" :key="event.id">
          <strong>{{ event.title }}</strong>
          <p>{{ event.summary }}</p>
        </li>
      </ul>
      <p v-else class="play-rehearsal-inspector-empty">No visible event in this attempt.</p>
    </section>
  </aside>
</template>

<style scoped>
.play-rehearsal-inspector {
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-inspector > header,
.play-rehearsal-inspector section {
  display: grid;
  gap: 8px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-inspector > header {
  gap: 1px;
}

.play-rehearsal-inspector > header span,
.play-rehearsal-inspector dt,
.play-rehearsal-current-actor span,
.play-rehearsal-perception-note,
.play-rehearsal-inspector-empty,
.play-rehearsal-omission-notice {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-inspector :where(h2, h3, h4, p, dl, ul) {
  margin: 0;
}

.play-rehearsal-inspector h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.play-rehearsal-inspector h3,
.play-rehearsal-inspector h4 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-inspector h4 {
  margin-top: 4px;
  color: var(--play-muted, var(--editor-muted));
}

.play-rehearsal-inspector dl,
.play-rehearsal-current-actor {
  display: grid;
  gap: 6px;
}

.play-rehearsal-inspector dl div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px;
}

.play-rehearsal-inspector dd {
  margin: 0;
  font-size: 10px;
}

.play-rehearsal-current-actor {
  padding: 8px;
  border-left: 2px solid var(--play-ink, var(--editor-ink));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-rehearsal-current-actor strong,
.play-rehearsal-visible-events strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-current-actor p,
.play-rehearsal-inspector li,
.play-rehearsal-visible-events p {
  font-size: 10px;
  line-height: 1.5;
}

.play-rehearsal-inspector ul {
  display: grid;
  gap: 5px;
  padding-left: 16px;
}

.play-rehearsal-visible-events {
  padding: 0;
  list-style: none;
}

.play-rehearsal-visible-events li {
  display: grid;
  gap: 3px;
  padding-top: 7px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-omission-notice {
  padding-top: 7px;
  border-top: 1px dotted var(--play-line, var(--editor-hairline));
}
</style>
