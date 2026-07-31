<script setup lang="ts">
import { computed } from 'vue';
import type {
  WritingProfileOutput,
  WritingProfileState,
  WritingReminderId,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  state?: WritingProfileState;
  error?: string;
}>();

const reminderLabels: Record<WritingReminderId, string> = {
  originality: '独立表达',
  aiVoice: 'AI 味审查',
  characterConsistency: '角色一致性',
  adaptationFreedom: '改编自由',
};
const outputLabels: Record<WritingProfileOutput, string> = {
  techniques: '抽象技法',
  world: '世界观',
  characters: '角色',
  relationships: '关系',
  outline: '大纲',
  timeline: '时间线',
};
const outputSummary = computed(() =>
  props.state?.summary.outputs
    .map((output) => outputLabels[output])
    .join('、') || '无',
);
const reminderSummary = computed(() =>
  props.state?.summary.reminders
    .map((reminder) => reminderLabels[reminder])
    .join('、') || '无',
);
</script>

<template>
  <aside v-if="state || error" class="writing-profile-summary" aria-label="Writing Profile summary">
    <template v-if="state">
      <strong>Writing Profile：{{ state.summary.displayName }}</strong>
      <span>
        Outputs：{{ outputSummary }}
      </span>
      <span>
        Reminders：{{ reminderSummary }}
      </span>
      <small v-if="state.configError">{{ state.configError }}</small>
    </template>
    <small v-if="error">{{ error }}</small>
  </aside>
</template>

<style scoped>
.writing-profile-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem 0.75rem;
  border: 1px solid var(--editor-hairline);
  border-radius: var(--radius-card);
  padding: 0.625rem 0.75rem;
  color: var(--editor-body);
  font-size: 0.75rem;
}

.writing-profile-summary small {
  flex-basis: 100%;
  color: var(--editor-danger);
}
</style>
