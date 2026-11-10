<script setup lang="ts">
import { useId } from 'vue';

import type { PlaySessionPurpose } from '../../../composables/useWorkspaceApi';

defineProps<{
  purpose: PlaySessionPurpose;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  choose: [mode: 'quick' | 'guided'];
  back: [];
  cancel: [];
}>();

const headingId = `${useId()}-play-launch-mode-heading`;
</script>

<template>
  <section class="play-launch-mode-picker" :aria-labelledby="headingId">
    <header>
      <span>开局方式</span>
      <h2 :id="headingId">
        {{ purpose === 'sceneRehearsal' ? '场景试演' : '沉浸推演' }}
      </h2>
      <p>快速开局用简短表单；引导开局会在打开舞台前核对工作区里的真实来源。</p>
    </header>

    <div class="play-launch-mode-options">
      <button type="button" :disabled="disabled" @click="emit('choose', 'quick')">
        <span aria-hidden="true">[Q]</span>
        <strong>快速开局</strong>
        <small>使用默认设置，以最少的步骤开始。</small>
      </button>
      <button type="button" :disabled="disabled" @click="emit('choose', 'guided')">
        <span aria-hidden="true">[G]</span>
        <strong>引导开局</strong>
        <small>依次确认来源、入场、身份、人物和最终开局包。</small>
      </button>
    </div>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('back')">返回</button>
      <button type="button" :disabled="disabled" @click="emit('cancel')">取消</button>
    </footer>
  </section>
</template>

<style scoped>
.play-launch-mode-picker,
.play-launch-mode-picker header,
.play-launch-mode-options,
.play-launch-mode-options button {
  display: grid;
  gap: 8px;
}

.play-launch-mode-picker {
  width: min(720px, 100%);
  padding: 20px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-launch-mode-picker h2,
.play-launch-mode-picker p {
  margin: 0;
}

.play-launch-mode-picker header > span,
.play-launch-mode-options small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-launch-mode-options {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.play-launch-mode-options button {
  min-height: 116px;
  align-content: center;
  padding: 16px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  border-radius: 0;
  background: var(--play-surface, var(--editor-surface));
  color: inherit;
  text-align: left;
}

.play-launch-mode-options button:hover:not(:disabled) {
  background: var(--play-surface-raised, var(--editor-surface-raised));
}

.play-launch-mode-picker footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 620px) {
  .play-launch-mode-options {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
