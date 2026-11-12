<script setup lang="ts">
import { computed, useId } from 'vue';

import type { PlayTranscriptTurn } from '../../composables/useWorkspaceApi';
import type { PlayProvisionalTurn } from '../../composables/usePlayTurnStream';

const props = withDefaults(defineProps<{
  title: string;
  sceneStart: string;
  turns: PlayTranscriptTurn[];
  provisional?: PlayProvisionalTurn;
  announcement: string;
  totalCount?: number;
  hasMoreBefore?: boolean;
  loadingEarlier?: boolean;
  /** Offer "检查角色贴合度" on committed narrative messages. */
  checkable?: boolean;
  checkDisabled?: boolean;
  /** Message whose in-character check is running. */
  checkingMessageId?: string;
}>(), {
  totalCount: undefined,
  hasMoreBefore: false,
  loadingEarlier: false,
  checkable: false,
  checkDisabled: false,
  checkingMessageId: '',
});

const emit = defineEmits<{
  loadEarlier: [];
  checkCharacter: [messageId: string];
}>();

const scrollId = `${useId()}-play-transcript-scroll`;
const messageCount = computed(() => props.totalCount ?? props.turns.length);

/** Display name only; stored speakers stay protocol identifiers. */
function speakerLabel(speaker: string): string {
  const normalized = speaker.toLowerCase();
  if (normalized === 'user' || normalized === 'player') return '我';
  if (normalized === 'world-referee') return '裁判';
  if (normalized === 'narrator') return '旁白';
  return speaker;
}

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

/** Author input and director records are not referee narrative. */
function isNarrative(speaker: string): boolean {
  return !['user', 'player', 'director'].includes(speaker.toLowerCase());
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <section class="play-transcript" aria-label="推演记录">
    <header class="play-transcript-heading">
      <div>
        <span class="play-transcript-kicker">正在推演</span>
        <h1>{{ title }}</h1>
      </div>
      <span class="play-transcript-count">
        {{ messageCount }} 条消息<span v-if="turns.length < messageCount"> · 显示 {{ turns.length }} 条</span>
      </span>
    </header>

    <div :id="scrollId" class="play-transcript-scroll">
      <article class="play-scene-opening">
        <span>开场</span>
        <p>{{ sceneStart }}</p>
      </article>

      <button
        v-if="hasMoreBefore"
        class="play-transcript-load-earlier"
        type="button"
        :disabled="loadingEarlier"
        :aria-controls="scrollId"
        @click="emit('loadEarlier')"
      >
        {{ loadingEarlier ? '正在载入更早的消息…' : '载入更早的记录' }}
      </button>

      <article
        v-for="turn in turns"
        :key="turn.id ?? `${turn.speaker}:${turn.createdAt}:${turn.content.slice(0, 32)}`"
        class="play-turn"
        :class="turnClass(turn.speaker)"
      >
        <header>
          <strong>{{ speakerLabel(turn.speaker) }}</strong>
          <span v-if="turn.actionKind" class="play-action-pill">{{ turn.actionKind }}</span>
          <time :datetime="turn.createdAt">{{ formatTime(turn.createdAt) }}</time>
        </header>
        <p :data-usage-message="turn.id">{{ turn.content }}</p>
        <footer v-if="checkable && turn.id && isNarrative(turn.speaker)" class="play-turn-check">
          <button
            type="button"
            :disabled="checkDisabled || Boolean(checkingMessageId)"
            :data-check-message="turn.id"
            title="一次只读的模型调用：指出这一回合里哪句话不像这个角色，并附角色资料里的依据。"
            @click="emit('checkCharacter', turn.id)"
          >
            {{ checkingMessageId === turn.id ? '正在检查…' : '检查角色贴合度' }}
          </button>
        </footer>
      </article>

      <article
        v-if="provisional"
        class="play-turn play-turn-narrator play-turn-provisional"
        :class="`play-turn-${provisional.phase}`"
      >
        <header>
          <strong>裁判</strong>
          <span>
            {{ provisional.intent === 'retry' ? '重演 · 生成中 · 尚未提交' : '生成中 · 尚未提交' }}
          </span>
        </header>
        <div v-if="provisional.intent === 'retry'" class="play-retry-source">
          <span>按原行动重演</span>
          <p>{{ provisional.userText }}</p>
          <small>旧结果会保留为另一个结果。</small>
        </div>
        <p :data-usage-operation="provisional.provisionalText ? provisional.turnId : undefined">{{ provisional.provisionalText || provisional.statusMessage }}</p>
        <footer class="play-provisional-status">
          <span>{{ provisional.statusMessage }}</span>
          <span v-if="provisional.error">{{ provisional.error }}</span>
        </footer>
      </article>

      <p v-if="turns.length === 0 && !provisional" class="play-transcript-empty">
        舞台已经布置好。提交第一个行动，裁判会同时推进人物与外部世界。
      </p>
    </div>

    <p class="play-stream-announcement" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </p>
  </section>
</template>

<style scoped>
.play-turn-check {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}

.play-turn-check button {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: none;
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-turn-check button:not(:disabled):hover {
  color: var(--play-ink, var(--editor-ink));
}

.play-transcript-load-earlier {
  min-height: 32px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-ink, var(--editor-ink));
}
</style>
