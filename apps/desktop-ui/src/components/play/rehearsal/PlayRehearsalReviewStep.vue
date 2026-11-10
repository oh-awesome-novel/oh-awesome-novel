<script setup lang="ts">
import { formatPlayWorldActivity } from '../../../composables/playTerms';
import { useId } from 'vue';

import type {
  PlayRehearsalParticipantDraft,
  PlayRehearsalSceneDraft,
} from './types';

const { scene, participants, creating, disabled } = defineProps<{
  scene: Readonly<PlayRehearsalSceneDraft>;
  participants: readonly Readonly<PlayRehearsalParticipantDraft>[];
  creating: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  back: [];
  confirm: [];
  cancel: [];
}>();

const prefix = `${useId()}-rehearsal-review`;
</script>

<template>
  <form
    class="play-rehearsal-review"
    :aria-labelledby="`${prefix}-heading`"
    :aria-busy="creating"
    @submit.prevent="emit('confirm')"
  >
    <header>
      <span>第 3 / 3 步</span>
      <h2 :id="`${prefix}-heading`">确认</h2>
      <p>还没有创建任何内容。确认一次即可用这些设置创建试演。</p>
    </header>

    <section :aria-labelledby="`${prefix}-scene-heading`">
      <h3 :id="`${prefix}-scene-heading`">场景约定</h3>
      <dl>
        <div><dt>标题</dt><dd>{{ scene.title }}</dd></div>
        <div><dt>地点</dt><dd>{{ scene.location }}</dd></div>
        <div><dt>目标</dt><dd>{{ scene.objective }}</dd></div>
        <div><dt>风险</dt><dd>{{ scene.risk || '未指定' }}</dd></div>
        <div><dt>世界</dt><dd>{{ formatPlayWorldActivity(scene) }}</dd></div>
        <div v-if="scene.eventSettings"><dt>事件</dt><dd>Offscreen {{ scene.eventSettings.allowOffscreen ? 'on' : 'off' }} · Hidden {{ scene.eventSettings.allowHidden ? 'on' : 'off' }} · Limit {{ scene.eventSettings.maxExternalEventsPerTurn }}</dd></div>
      </dl>
      <p class="play-rehearsal-review-opening">{{ scene.opening }}</p>
    </section>

    <section :aria-labelledby="`${prefix}-cast-heading`">
      <h3 :id="`${prefix}-cast-heading`">固定的角色顺序</h3>
      <ol>
        <li v-for="(participant, index) in participants" :key="participant.participantRef">
          <span>{{ index + 1 }}</span>
          <div>
            <strong>{{ participant.displayName }}</strong>
            <small>{{ participant.currentGoal }}<template v-if="participant.position"> · {{ participant.position }}</template></small>
            <p>{{ participant.initialKnowledge || '没有作者提供的初始认知。' }}</p>
          </div>
        </li>
      </ol>
    </section>

    <aside class="play-rehearsal-knowledge-warning" aria-label="认知边界提醒">
      <strong>[knowledge boundary]</strong>
      <p>每个角色步骤只能拿到这个角色的冻结感知包；自然语言输出仍需检查是否提到不该知道的内容。</p>
    </aside>

    <footer>
      <button type="button" :disabled="disabled || creating" @click="emit('cancel')">取消</button>
      <div>
        <button type="button" :disabled="disabled || creating" @click="emit('back')">返回人物</button>
        <button class="play-rehearsal-primary" type="submit" :disabled="disabled || creating">
          {{ creating ? '正在创建试演…' : '开始场景试演' }}
        </button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.play-rehearsal-review,
.play-rehearsal-review > header,
.play-rehearsal-review section,
.play-rehearsal-review ol {
  display: grid;
  gap: 12px;
}

.play-rehearsal-review > header {
  gap: 4px;
}

.play-rehearsal-review > header > span,
.play-rehearsal-review > header p,
.play-rehearsal-review dt,
.play-rehearsal-review small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-rehearsal-review :where(h2, h3, p, dl) {
  margin: 0;
}

.play-rehearsal-review h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 16px;
}

.play-rehearsal-review h3 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 12px;
}

.play-rehearsal-review section,
.play-rehearsal-knowledge-warning {
  padding: 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-review dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.play-rehearsal-review dl div {
  display: grid;
  gap: 2px;
}

.play-rehearsal-review dd {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
}

.play-rehearsal-review-opening {
  padding-top: 9px;
  border-top: 1px dotted var(--play-line, var(--editor-hairline));
  white-space: pre-wrap;
}

.play-rehearsal-review ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-rehearsal-review li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-review li > span {
  color: var(--play-muted, var(--editor-muted));
  font-variant-numeric: tabular-nums;
}

.play-rehearsal-review li div {
  display: grid;
  gap: 3px;
}

.play-rehearsal-review li p,
.play-rehearsal-knowledge-warning p {
  font-size: 11px;
}

.play-rehearsal-knowledge-warning {
  border-style: dashed;
}

.play-rehearsal-knowledge-warning strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-review footer,
.play-rehearsal-review footer > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.play-rehearsal-review footer {
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-review footer button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}

.play-rehearsal-review footer .play-rehearsal-primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

@media (max-width: 640px) {
  .play-rehearsal-review dl {
    grid-template-columns: minmax(0, 1fr);
  }

  .play-rehearsal-review footer {
    align-items: stretch;
    flex-direction: column;
  }

  .play-rehearsal-review footer > div {
    display: grid;
  }
}
</style>
