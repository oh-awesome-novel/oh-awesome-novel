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
    :id="`play-event-${card.id}`"
    class="play-event-card"
    :class="`play-event-${card.visibility}`"
    tabindex="-1"
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

      <section class="play-event-impact" aria-label="事件影响">
        <span>影响</span>
        <p>{{ card.impact }}</p>
      </section>

      <PlayEventRevealChain
        v-if="card.revealChain"
        :chain="card.revealChain"
        :show-author-details="showAuthorDetails"
      />

      <div v-if="card.causeLabels.length" class="play-event-cause">
        <span>起因</span>
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
        aria-label="本回合状态变化"
      >
        <span>本回合状态变化</span>
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
        <summary>导演视角详情</summary>

        <section v-if="card.authorReason" aria-label="导演视角起因">
          <span>导演视角起因</span>
          <p>{{ card.authorReason }}</p>
        </section>

        <section v-if="card.technicalRefs.length" aria-label="技术引用">
          <span>技术引用</span>
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
        :aria-label="`带回写作：${card.title}`"
        @click="emit('prepareAdoption', { kind: 'event', eventId: card.id })"
      >带回写作</button>
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
