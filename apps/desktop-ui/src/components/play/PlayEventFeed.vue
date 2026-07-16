<script setup lang="ts">
import { computed } from 'vue';

import {
  buildPlayEventCardViews,
  type PlayEventCardView,
} from '../../composables/playWorldPresentation';
import type { PlayWorldEvent } from '../../composables/useWorkspaceApi';
import PlayWorldEventCard from './PlayWorldEventCard.vue';

const props = defineProps<{
  cards?: readonly PlayEventCardView[];
  events?: readonly PlayWorldEvent[];
  causeLabelsByEventId?: Readonly<Record<string, readonly string[]>>;
  hasHiddenPlayContent: boolean;
}>();

const showSpoilers = defineModel<boolean>('showSpoilers', { required: true });
const displayCards = computed<PlayEventCardView[]>(() => {
  if (props.cards !== undefined) {
    return props.cards
      .filter((card) => showSpoilers.value || card.visibility !== 'playerUnknown')
      .map((card) => showSpoilers.value
        ? { ...card }
        : { ...card, authorReason: undefined });
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

    <div v-if="displayCards.length" class="play-event-list">
      <PlayWorldEventCard
        v-for="card in displayCards"
        :key="card.id"
        :card="card"
        :show-author-details="showSpoilers"
      />
    </div>

    <div v-else class="play-event-empty">
      <span aria-hidden="true">[ ]</span>
      <p>尚无已揭示的外部事件。世界变化会在完成回合后出现在这里。</p>
    </div>
  </section>
</template>
