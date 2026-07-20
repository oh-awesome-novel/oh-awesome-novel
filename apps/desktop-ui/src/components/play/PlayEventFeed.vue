<script setup lang="ts">
import { computed } from 'vue';

import {
  buildPlayEventCardViews,
  type PlayEventCardView,
} from '../../composables/playWorldPresentation';
import type { PlayAdoptionSeed } from '../../composables/usePlayAdoptionPreview';
import type { PlayWorldEvent } from '../../composables/useWorkspaceApi';
import PlayWorldEventCard from './PlayWorldEventCard.vue';

const props = withDefaults(defineProps<{
  cards?: readonly PlayEventCardView[];
  events?: readonly PlayWorldEvent[];
  causeLabelsByEventId?: Readonly<Record<string, readonly string[]>>;
  hasHiddenPlayContent: boolean;
  adoptionDisabled?: boolean;
  totalCount?: number;
  hasMoreBefore?: boolean;
  loadingEarlier?: boolean;
}>(), {
  cards: undefined,
  events: undefined,
  causeLabelsByEventId: undefined,
  adoptionDisabled: false,
  totalCount: undefined,
  hasMoreBefore: false,
  loadingEarlier: false,
});

const emit = defineEmits<{
  prepareAdoption: [seed: PlayAdoptionSeed];
  loadEarlier: [];
}>();

const showSpoilers = defineModel<boolean>('showSpoilers', { required: true });
const displayCards = computed<PlayEventCardView[]>(() => {
  if (props.cards !== undefined) {
    return props.cards
      .filter((card) => showSpoilers.value || card.visibility !== 'playerUnknown')
      .map((card) => projectCardForLens(card, showSpoilers.value));
  }

  return buildPlayEventCardViews({
    events: props.events ?? [],
    artifacts: [],
    scheduledEvents: [],
    pressures: [],
    agendas: [],
    stateVisibility: {},
    showSpoilers: showSpoilers.value,
  }).map((card) => ({
    ...card,
    causeLabels: mergeLegacyCauseLabels(
      card,
      props.causeLabelsByEventId?.[card.id] ?? [],
    ),
  }));
});

function projectCardForLens(
  card: Readonly<PlayEventCardView>,
  showAuthorDetails: boolean,
): PlayEventCardView {
  if (showAuthorDetails) return { ...card };

  const revealChain = buildPlayerRevealChain(card);
  const cardWasPlayerProjected = card.projection === 'player';
  return {
    id: card.id,
    title: card.title,
    impact: card.impact,
    kindLabel: card.kindLabel,
    originLabel: card.originLabel,
    visibility: card.visibility,
    worldTimeLabel: card.worldTimeLabel,
    projection: 'player',
    technicalRefs: [],
    causeLabels: cardWasPlayerProjected
      ? [...card.causeLabels]
      : card.causeLabels.filter((cause) => cause.kind === 'action'),
    stateImpacts: cardWasPlayerProjected ? [...card.stateImpacts] : [],
    ...(revealChain ? { revealChain } : {}),
  };
}

function buildPlayerRevealChain(
  card: Readonly<PlayEventCardView>,
): PlayEventCardView['revealChain'] {
  if (!card.revealChain) return undefined;
  return card.visibility === 'rumor'
    ? {
        statusLabel: 'Rumor surfaced',
        explanation: 'This event carries a rumor about an earlier unseen development.',
      }
    : {
        statusLabel: 'Information confirmed',
        explanation: 'This event confirms information about an earlier unseen development.',
      };
}

function mergeLegacyCauseLabels(
  card: Readonly<PlayEventCardView>,
  legacyLabels: readonly string[],
): PlayEventCardView['causeLabels'] {
  const labels = [...card.causeLabels];
  const seen = new Set(labels.map((cause) => cause.label));
  for (const label of legacyLabels) {
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push({ kind: 'related', label, ref: `legacy:${label}` });
  }
  return labels;
}
</script>

<template>
  <section class="play-event-feed" aria-label="World events">
    <header>
      <div>
        <span>World motion</span>
        <h2>Recent events</h2>
        <small v-if="totalCount !== undefined && totalCount > displayCards.length">
          Showing {{ displayCards.length }} of {{ totalCount }}
        </small>
      </div>
      <button
        v-if="hasHiddenPlayContent"
        type="button"
        role="switch"
        :aria-checked="showSpoilers"
        :aria-label="showSpoilers ? '关闭作者视图' : '开启作者视图，显示玩家未知内容和因果分析'"
        :title="showSpoilers ? '隐藏作者专用内容' : '作者视图：显示未知内容和因果分析'"
        @click="showSpoilers = !showSpoilers"
      >
        <span aria-hidden="true">{{ showSpoilers ? '[-]' : '[+]' }}</span>
        Author view
      </button>
    </header>

    <button
      v-if="hasMoreBefore"
      class="play-event-load-earlier"
      type="button"
      :disabled="loadingEarlier"
      @click="emit('loadEarlier')"
    >
      {{ loadingEarlier ? 'Loading earlier events…' : 'Load earlier events' }}
    </button>

    <div v-if="displayCards.length" class="play-event-list">
      <PlayWorldEventCard
        v-for="card in displayCards"
        :key="card.id"
        :card="card"
        :show-author-details="showSpoilers"
        :adoption-disabled="adoptionDisabled"
        @prepare-adoption="emit('prepareAdoption', $event)"
      />
    </div>

    <div v-else class="play-event-empty">
      <span aria-hidden="true">[ ]</span>
      <p>尚无已揭示的外部事件。世界变化会在完成回合后出现在这里。</p>
    </div>
  </section>
</template>

<style scoped>
.play-event-load-earlier {
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}
</style>
