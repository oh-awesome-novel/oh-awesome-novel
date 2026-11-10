<script setup lang="ts">
import { useId } from 'vue';

import type {
  PlayRehearsalCastErrors,
  PlayRehearsalParticipantDraft,
  PlayRehearsalParticipantDraftPatch,
} from './types';
const { participants, errors, disabled } = defineProps<{
  participants: readonly Readonly<PlayRehearsalParticipantDraft>[];
  errors: Readonly<PlayRehearsalCastErrors>;
  disabled: boolean;
}>();
const emit = defineEmits<{
  updateParticipant: [participantRef: string, patch: PlayRehearsalParticipantDraftPatch];
  addParticipant: [];
  removeParticipant: [participantRef: string];
  moveParticipant: [participantRef: string, direction: 'up' | 'down'];
  back: [];
  next: [];
  cancel: [];
}>();

const prefix = `${useId()}-rehearsal-cast`;

function fieldId(index: number, field: string): string {
  return `${prefix}-${index}-${field}`;
}

function updateText(
  participantRef: string,
  field: keyof PlayRehearsalParticipantDraftPatch,
  event: Event,
): void {
  emit('updateParticipant', participantRef, {
    [field]: (event.target as HTMLInputElement | HTMLTextAreaElement).value,
  });
}
</script>

<template>
  <form class="play-rehearsal-cast" :aria-labelledby="`${prefix}-heading`" @submit.prevent="emit('next')">
    <header>
      <span>第 2 / 3 步</span>
      <h2 :id="`${prefix}-heading`">人物</h2>
      <p>列表顺序就是固定的角色行动顺序。初始认知是作者提供的推演内依据。</p>
    </header>

    <ol aria-label="固定的角色顺序">
      <li v-for="(participant, index) in participants" :key="participant.participantRef">
        <header class="play-rehearsal-actor-heading">
          <strong>Actor {{ index + 1 }}</strong>
          <div>
            <button
              type="button"
              :disabled="disabled || index === 0"
              :aria-label="`把第 ${index + 1} 个角色上移`"
              @click="emit('moveParticipant', participant.participantRef, 'up')"
            >↑</button>
            <button
              type="button"
              :disabled="disabled || index === participants.length - 1"
              :aria-label="`把第 ${index + 1} 个角色下移`"
              @click="emit('moveParticipant', participant.participantRef, 'down')"
            >↓</button>
            <button
              type="button"
              :disabled="disabled || participants.length === 1"
              :aria-label="`移除第 ${index + 1} 个角色`"
              @click="emit('removeParticipant', participant.participantRef)"
            >移除</button>
          </div>
        </header>

        <div class="play-rehearsal-cast-fields">
          <label>
            <span>名字</span>
            <input
              :id="fieldId(index, 'name')"
              :name="`actor-${index + 1}-name`"
              type="text"
              :value="participant.displayName"
              :disabled="disabled"
              :aria-invalid="Boolean(errors[participant.participantRef]?.displayName)"
              :aria-describedby="errors[participant.participantRef]?.displayName ? fieldId(index, 'name-error') : undefined"
              aria-required="true"
              @input="updateText(participant.participantRef, 'displayName', $event)"
            >
            <small
              v-if="errors[participant.participantRef]?.displayName"
              :id="fieldId(index, 'name-error')"
              class="play-rehearsal-field-error"
            >{{ errors[participant.participantRef]?.displayName }}</small>
          </label>

          <label>
            <span>位置</span>
            <input
              :id="fieldId(index, 'position')"
              :name="`actor-${index + 1}-position`"
              type="text"
              :value="participant.position"
              :disabled="disabled"
              @input="updateText(participant.participantRef, 'position', $event)"
            >
          </label>

          <label>
            <span>当前目标</span>
            <input
              :id="fieldId(index, 'goal')"
              :name="`actor-${index + 1}-goal`"
              type="text"
              :value="participant.currentGoal"
              :disabled="disabled"
              :aria-invalid="Boolean(errors[participant.participantRef]?.currentGoal)"
              :aria-describedby="errors[participant.participantRef]?.currentGoal ? fieldId(index, 'goal-error') : undefined"
              aria-required="true"
              @input="updateText(participant.participantRef, 'currentGoal', $event)"
            >
            <small
              v-if="errors[participant.participantRef]?.currentGoal"
              :id="fieldId(index, 'goal-error')"
              class="play-rehearsal-field-error"
            >{{ errors[participant.participantRef]?.currentGoal }}</small>
          </label>

          <label class="play-rehearsal-cast-wide">
            <span>初始认知</span>
            <textarea
              :id="fieldId(index, 'knowledge')"
              :name="`actor-${index + 1}-knowledge`"
              rows="2"
              :value="participant.initialKnowledge"
              :disabled="disabled"
              placeholder="只写这个角色可以使用的事实"
              @input="updateText(participant.participantRef, 'initialKnowledge', $event)"
            ></textarea>
          </label>
        </div>
      </li>
    </ol>

    <button class="play-rehearsal-add-actor" type="button" :disabled="disabled" @click="emit('addParticipant')">
      <span aria-hidden="true">[+]</span> 添加角色
    </button>

    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">取消</button>
      <div>
        <button type="button" :disabled="disabled" @click="emit('back')">返回场景</button>
        <button class="play-rehearsal-primary" type="submit" :disabled="disabled">下一步：确认</button>
      </div>
    </footer>
  </form>
</template>

<style scoped>
.play-rehearsal-cast,
.play-rehearsal-cast > header,
.play-rehearsal-cast ol {
  display: grid;
  gap: 12px;
}

.play-rehearsal-cast > header {
  gap: 4px;
}

.play-rehearsal-cast > header > span,
.play-rehearsal-cast > header p,
.play-rehearsal-cast label > span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.play-rehearsal-cast h2,
.play-rehearsal-cast p {
  margin: 0;
}

.play-rehearsal-cast h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 16px;
}

.play-rehearsal-cast ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-rehearsal-cast li {
  display: grid;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
}

.play-rehearsal-actor-heading,
.play-rehearsal-actor-heading > div,
.play-rehearsal-cast footer,
.play-rehearsal-cast footer > div {
  display: flex;
  align-items: center;
  gap: 6px;
}

.play-rehearsal-actor-heading {
  justify-content: space-between;
}

.play-rehearsal-actor-heading button,
.play-rehearsal-add-actor,
.play-rehearsal-cast footer button {
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-cast-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.play-rehearsal-cast-fields label {
  display: grid;
  align-content: start;
  gap: 5px;
}

.play-rehearsal-cast-wide {
  grid-column: 1 / -1;
}

.play-rehearsal-cast :where(input, textarea) {
  width: 100%;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-radius: 4px;
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
  font: inherit;
}

.play-rehearsal-cast textarea {
  resize: vertical;
}

.play-rehearsal-cast [aria-invalid="true"] {
  border-color: var(--play-danger, var(--editor-danger));
}

.play-rehearsal-field-error {
  color: var(--play-danger, var(--editor-danger));
  font-size: 10px;
}

.play-rehearsal-add-actor {
  justify-self: start;
}

.play-rehearsal-cast footer {
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-cast footer .play-rehearsal-primary {
  border-color: var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

@media (max-width: 640px) {
  .play-rehearsal-cast-fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .play-rehearsal-cast-wide {
    grid-column: auto;
  }

  .play-rehearsal-cast footer {
    align-items: stretch;
    flex-direction: column;
  }

  .play-rehearsal-cast footer > div {
    display: grid;
  }
}
</style>
