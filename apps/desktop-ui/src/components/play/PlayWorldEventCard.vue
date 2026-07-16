<script setup lang="ts">
import PlayEventRevealChain from './PlayEventRevealChain.vue';
import type { PlayAdoptionSeed } from '../../composables/usePlayAdoptionPreview';
import type { PlayEventCardView } from '../../composables/playWorldPresentation';

defineProps<{
  card: Readonly<PlayEventCardView>;
  showAuthorDetails: boolean;
  adoptionDisabled: boolean;
}>();

const emit = defineEmits<{
  prepareAdoption: [seed: PlayAdoptionSeed];
}>();
</script>

<template>
  <article
    class="play-event-card"
    :class="`play-event-${card.visibility}`"
  >
    <div class="play-event-line" aria-hidden="true"></div>
    <div class="play-event-body">
      <div class="play-event-meta">
        <span>{{ card.worldTimeLabel }}</span>
        <span>{{ card.kindLabel }}</span>
        <span>{{ card.originLabel }}</span>
        <span>{{ card.visibility }}</span>
      </div>

      <h3>{{ card.title }}</h3>

      <section class="play-event-impact" aria-label="Event impact">
        <span>Impact</span>
        <p>{{ card.impact }}</p>
      </section>

      <PlayEventRevealChain
        v-if="card.revealChain"
        :chain="card.revealChain"
        :show-author-details="showAuthorDetails"
      />

      <div v-if="card.causeLabels.length" class="play-event-cause">
        <span>Caused by</span>
        <ul>
          <li
            v-for="cause in card.causeLabels"
            :key="`${cause.kind}:${cause.ref}`"
          >
            {{ cause.label }}
          </li>
        </ul>
      </div>

      <section
        v-if="card.stateImpacts.length"
        class="play-event-state"
        aria-label="Turn state changes"
      >
        <span>Turn state changes</span>
        <dl>
          <template
            v-for="impact in card.stateImpacts"
            :key="impact.path"
          >
            <dt>{{ impact.path }}</dt>
            <dd>{{ impact.value }}</dd>
          </template>
        </dl>
      </section>

      <details
        v-if="showAuthorDetails && (card.authorReason || card.technicalRefs.length)"
        class="play-event-author-details"
      >
        <summary>Author details</summary>

        <section v-if="card.authorReason" aria-label="Author cause">
          <span>Author cause</span>
          <p>{{ card.authorReason }}</p>
        </section>

        <section v-if="card.technicalRefs.length" aria-label="Technical references">
          <span>Technical references</span>
          <dl>
            <template
              v-for="reference in card.technicalRefs"
              :key="`${reference.label}:${reference.value}`"
            >
              <dt>{{ reference.label }}</dt>
              <dd>{{ reference.value }}</dd>
            </template>
          </dl>
        </section>
      </details>

      <button
        class="ghost-button tight-button play-event-adopt"
        type="button"
        :disabled="adoptionDisabled"
        :aria-label="`Bring event to writing: ${card.title}`"
        @click="emit('prepareAdoption', { kind: 'event', eventId: card.id })"
      >Bring to writing</button>
    </div>
  </article>
</template>

<style scoped>
.play-event-impact,
.play-event-state,
.play-event-author-details section {
  display: grid;
  gap: 4px;
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid var(--play-line);
}

.play-event-impact > span,
.play-event-state > span,
.play-event-author-details section > span {
  color: var(--play-muted);
  font-size: 10px;
  font-weight: 700;
}

.play-event-state dl,
.play-event-author-details dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 3px 8px;
  margin: 0;
  font-size: 10px;
}

.play-event-state dt,
.play-event-author-details dt {
  overflow-wrap: anywhere;
  color: var(--play-muted);
}

.play-event-state dd,
.play-event-author-details dd {
  margin: 0;
  color: var(--play-body);
}

.play-event-author-details {
  margin-top: 7px;
}

.play-event-adopt {
  justify-self: start;
  margin-top: 7px;
}
</style>
