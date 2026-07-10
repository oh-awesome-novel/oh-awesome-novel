<script setup lang="ts">
import type { PlayTranscriptTurn } from '../../composables/useWorkspaceApi';

defineProps<{
  title: string;
  sceneStart: string;
  turns: PlayTranscriptTurn[];
  sending: boolean;
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

    <div class="play-transcript-scroll" aria-live="polite">
      <article class="play-scene-opening">
        <span>Opening scene</span>
        <p>{{ sceneStart }}</p>
      </article>

      <article
        v-for="(turn, index) in turns"
        :key="turn.id ?? `${turn.speaker}:${turn.createdAt}:${index}`"
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

      <article v-if="sending" class="play-turn play-turn-narrator play-turn-provisional">
        <header>
          <strong>world-referee</strong>
          <span>resolving turn</span>
        </header>
        <p>世界正在回应你的行动<span class="play-ellipsis" aria-hidden="true">…</span></p>
      </article>

      <p v-if="turns.length === 0 && !sending" class="play-transcript-empty">
        舞台已经布置好。提交第一个行动，world referee 会同时推进人物与外部世界。
      </p>
    </div>
  </section>
</template>

<style scoped>
.play-transcript {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
}

.play-transcript-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgb(235 226 212);
}

.play-transcript-heading h1 {
  margin: 3px 0 0;
  color: rgb(58 45 35);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 23px;
  font-weight: 700;
}

.play-transcript-kicker,
.play-transcript-count {
  color: rgb(166 102 45);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.play-transcript-scroll {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 13px;
  overflow: auto;
  padding: 20px clamp(18px, 4vw, 54px) 28px;
  scroll-behavior: smooth;
}

.play-scene-opening {
  padding: 14px 16px;
  border-left: 3px solid rgb(217 119 6);
  background: rgb(255 249 237);
}

.play-scene-opening span {
  color: rgb(180 83 9);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .09em;
  text-transform: uppercase;
}

.play-scene-opening p,
.play-turn p {
  margin: 6px 0 0;
  white-space: pre-wrap;
  color: rgb(71 56 44);
  line-height: 1.75;
}

.play-turn {
  max-width: min(720px, 88%);
  padding: 13px 15px;
  border: 1px solid rgb(235 226 212);
  border-radius: 10px;
  background: rgb(255 253 249);
  box-shadow: 0 5px 16px rgb(91 67 43 / 5%);
}

.play-turn header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgb(139 105 76);
  font-size: 11px;
}

.play-turn header time {
  margin-left: auto;
}

.play-turn-player {
  align-self: flex-end;
  border-color: rgb(224 194 151);
  background: rgb(255 247 232);
}

.play-turn-narrator {
  border-left: 3px solid rgb(120 53 15);
}

.play-turn-character {
  margin-left: 16px;
  border-left: 3px solid rgb(202 138 4);
}

.play-turn-provisional {
  border-style: dashed;
  opacity: .78;
}

.play-action-pill {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgb(254 243 199);
  color: rgb(146 64 14);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
}

.play-transcript-empty {
  margin: auto;
  max-width: 480px;
  color: rgb(139 112 88);
  line-height: 1.7;
  text-align: center;
}

:global([data-theme="dark"]) .play-transcript-heading {
  border-color: rgb(68 58 49);
}

:global([data-theme="dark"]) .play-transcript-heading h1,
:global([data-theme="dark"]) .play-scene-opening p,
:global([data-theme="dark"]) .play-turn p {
  color: rgb(245 235 220);
}

:global([data-theme="dark"]) .play-scene-opening,
:global([data-theme="dark"]) .play-turn {
  border-color: rgb(83 70 58);
  background: rgb(34 29 25);
}

:global([data-theme="dark"]) .play-turn-player {
  background: rgb(55 42 29);
}
</style>
