<script setup lang="ts">
import { useId } from 'vue';

import type { PlaySessionPurposeChoice } from './types';

const { disabled = false } = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  choose: [purpose: PlaySessionPurposeChoice];
  cancel: [];
}>();

const prefix = `${useId()}-play-purpose`;
const headingId = `${prefix}-heading`;
</script>

<template>
  <section class="play-purpose-picker" :aria-labelledby="headingId">
    <header>
      <span>新建推演会话</span>
      <h2 :id="headingId">选择进入世界的方式</h2>
      <p>用途和世界活跃度相互独立。你可以沉浸推演，也可以导演一场场景试演。</p>
    </header>

    <div class="play-purpose-options">
      <button
        type="button"
        :disabled="disabled"
        :aria-describedby="`${prefix}-immersive-description`"
        @click="emit('choose', 'immersiveJourney')"
      >
        <span aria-hidden="true">[J]</span>
        <strong>沉浸推演</strong>
        <small :id="`${prefix}-immersive-description`">以参与者身份在世界中行动。</small>
      </button>
      <button
        type="button"
        :disabled="disabled"
        :aria-describedby="`${prefix}-rehearsal-description`"
        @click="emit('choose', 'sceneRehearsal')"
      >
        <span aria-hidden="true">[R]</span>
        <strong>场景试演</strong>
        <small :id="`${prefix}-rehearsal-description`">按固定顺序指挥角色行动，逐条审阅生成的反应。</small>
      </button>
    </div>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">取消</button>
    </footer>
  </section>
</template>

<style scoped>
.play-purpose-picker {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-purpose-picker header,
.play-purpose-options,
.play-purpose-options button {
  display: grid;
  gap: 6px;
}

.play-purpose-picker header > span,
.play-purpose-options small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-purpose-picker h2,
.play-purpose-picker p {
  margin: 0;
}

.play-purpose-picker h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 15px;
}

.play-purpose-picker p {
  font-size: 12px;
  line-height: 1.6;
}

.play-purpose-options button {
  min-height: 92px;
  align-content: center;
  padding: 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  border-radius: 0;
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
  text-align: left;
}

.play-purpose-options button:hover:not(:disabled) {
  border-color: var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface-raised, var(--editor-surface-raised));
}

.play-purpose-options button > span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-purpose-options strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.play-purpose-picker footer {
  display: flex;
  justify-content: flex-end;
}

.play-purpose-picker footer button {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: transparent;
  color: var(--play-body, var(--editor-body));
}
</style>
