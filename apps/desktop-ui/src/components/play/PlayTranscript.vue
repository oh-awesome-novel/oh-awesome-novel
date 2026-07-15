<script setup lang="ts">
import type { PlayTranscriptTurn } from '../../composables/useWorkspaceApi';
import type { PlayProvisionalTurn } from '../../composables/usePlayTurnStream';

defineProps<{
  title: string;
  sceneStart: string;
  turns: PlayTranscriptTurn[];
  provisional?: PlayProvisionalTurn;
  announcement: string;
}>();

function turnClass(speaker: string): string {
  const normalized = speaker.toLowerCase();
  if (normalized === 'user' || normalized === 'player') {
    return 'play-turn-player';
  }
  if (normalized === 'world-referee' || normalized === 'narrator') {
    return 'play-turn-narrator';
  }
  return 'play-turn-character';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <section class="play-transcript" aria-label="Play transcript">
    <header class="play-transcript-heading">
      <div>
        <span class="play-transcript-kicker">Now playing</span>
        <h1>{{ title }}</h1>
      </div>
      <span class="play-transcript-count">{{ turns.length }} messages</span>
    </header>

    <div class="play-transcript-scroll">
      <article class="play-scene-opening">
        <span>Opening scene</span>
        <p>{{ sceneStart }}</p>
      </article>

      <article
        v-for="turn in turns"
        :key="turn.id ?? `${turn.speaker}:${turn.createdAt}:${turn.content.slice(0, 32)}`"
        class="play-turn"
        :class="turnClass(turn.speaker)"
      >
        <header>
          <strong>{{ turn.speaker }}</strong>
          <span v-if="turn.actionKind" class="play-action-pill">{{ turn.actionKind }}</span>
          <time :datetime="turn.createdAt">{{ formatTime(turn.createdAt) }}</time>
        </header>
        <p>{{ turn.content }}</p>
      </article>

      <article
        v-if="provisional"
        class="play-turn play-turn-narrator play-turn-provisional"
        :class="`play-turn-${provisional.phase}`"
      >
        <header>
          <strong>world-referee</strong>
          <span>
            {{ provisional.intent === 'retry' ? 'Retry · provisional · not committed' : 'provisional · not committed' }}
          </span>
        </header>
        <div v-if="provisional.intent === 'retry'" class="play-retry-source">
          <span>Replaying original action</span>
          <p>{{ provisional.userText }}</p>
          <small>Old result preserved as a variant.</small>
        </div>
        <p>{{ provisional.provisionalText || provisional.statusMessage }}</p>
        <footer class="play-provisional-status">
          <span>{{ provisional.statusMessage }}</span>
          <span v-if="provisional.error">{{ provisional.error }}</span>
        </footer>
      </article>

      <p v-if="turns.length === 0 && !provisional" class="play-transcript-empty">
        舞台已经布置好。提交第一个行动，world referee 会同时推进人物与外部世界。
      </p>
    </div>

    <p class="play-stream-announcement" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </p>
  </section>
</template>
