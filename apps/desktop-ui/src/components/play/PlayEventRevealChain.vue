<script setup lang="ts">
import type { PlayEventRevealChainView } from '../../composables/playWorldPresentation';

defineProps<{
  chain: Readonly<PlayEventRevealChainView>;
  showAuthorDetails: boolean;
}>();
</script>

<template>
  <section class="play-event-reveal-chain" aria-label="Information reveal chain">
    <header class="play-event-reveal-header">
      <span>Reveal chain</span>
      <strong>{{ chain.statusLabel }}</strong>
    </header>
    <p class="play-event-reveal-explanation">{{ chain.explanation }}</p>

    <ol v-if="showAuthorDetails && chain.author" class="play-event-reveal-steps">
      <li>
        <span>Hidden source</span>
        <strong>{{ chain.author.subjectTitle }}</strong>
        <p>{{ chain.author.subjectSummary }}</p>
        <small>
          {{ chain.author.subjectEventId }} · {{ chain.author.subjectWorldTimeLabel }}
        </small>
        <p v-if="chain.author.subjectReason" class="play-event-reveal-reason">
          {{ chain.author.subjectReason }}
        </p>
      </li>
      <li>
        <span>Revealed by</span>
        <strong>{{ chain.author.revealedByTitle }}</strong>
        <small>{{ chain.author.revealedByEventId }}</small>
      </li>
    </ol>

    <dl v-if="showAuthorDetails && chain.author" class="play-event-reveal-technical">
      <dt>Knowledge record</dt>
      <dd>{{ chain.author.recordId }}</dd>
      <dt>Projection</dt>
      <dd>
        {{ chain.author.previousPlayerProjection }} → {{ chain.author.playerProjection }}
      </dd>
      <template v-if="chain.author.knownByParticipantRefs.length">
        <dt>Known by</dt>
        <dd>{{ chain.author.knownByParticipantRefs.join(', ') }}</dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.play-event-reveal-chain {
  display: grid;
  gap: 6px;
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid var(--play-line);
}

.play-event-reveal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.play-event-reveal-header span,
.play-event-reveal-steps span,
.play-event-reveal-technical dt {
  color: var(--play-muted);
  font-size: 10px;
  font-weight: 700;
}

.play-event-reveal-header strong,
.play-event-reveal-steps strong {
  color: var(--play-ink);
  font-size: 10px;
}

.play-event-reveal-explanation,
.play-event-reveal-steps p {
  margin: 0;
  color: var(--play-body);
  font-size: 10px;
  line-height: 1.5;
}

.play-event-reveal-steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-event-reveal-steps li {
  display: grid;
  gap: 3px;
  padding: 7px;
  border: 1px solid var(--play-line);
  background: var(--play-surface);
}

.play-event-reveal-steps small {
  overflow-wrap: anywhere;
  color: var(--play-muted);
  font-size: 9px;
}

.play-event-reveal-reason {
  padding-top: 4px;
  border-top: 1px dashed var(--play-line);
}

.play-event-reveal-technical {
  display: grid;
  grid-template-columns: minmax(90px, .6fr) minmax(0, 1fr);
  gap: 3px 8px;
  margin: 0;
  font-size: 9px;
}

.play-event-reveal-technical dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--play-body);
}
</style>
