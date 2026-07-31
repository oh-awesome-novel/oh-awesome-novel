<script setup lang="ts">
import { computed } from 'vue';
import type {
  WritingProfileListItem,
  WritingReminderId,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  item: WritingProfileListItem;
  busy: boolean;
  deleteConfirming: boolean;
}>();

const emit = defineEmits<{
  activate: [profileId: string];
  clone: [profileId: string];
  edit: [profileId: string];
  delete: [profileId: string];
}>();

const reminderLabels: Record<WritingReminderId, string> = {
  originality: '独立表达',
  aiVoice: 'AI 味审查',
  characterConsistency: '角色一致性',
  adaptationFreedom: '改编自由',
};
const activeReminderLabels = computed(() =>
  (Object.keys(props.item.profile.writingReminders) as WritingReminderId[])
    .filter((reminder) => props.item.profile.writingReminders[reminder])
    .map((reminder) => reminderLabels[reminder]),
);
</script>

<template>
  <article
    class="writing-profile-card"
    :class="{ 'writing-profile-card-active': item.active }"
  >
    <div class="writing-profile-card-heading">
      <div>
        <div class="writing-profile-card-title">
          <h3>{{ item.profile.displayName }}</h3>
          <span v-if="item.builtIn" class="status-pill">内置只读</span>
          <span v-if="item.active" class="status-pill">当前</span>
        </div>
        <code>{{ item.profile.id }}</code>
      </div>
    </div>

    <p>{{ item.profile.description }}</p>
    <dl class="writing-profile-details">
      <div>
        <dt>拆书输出</dt>
        <dd>{{ item.profile.deconstruction.outputs.join(' · ') }}</dd>
      </div>
      <div>
        <dt>Writing 提醒</dt>
        <dd>{{ activeReminderLabels.join(' · ') || '无' }}</dd>
      </div>
    </dl>

    <div class="writing-profile-card-actions">
      <button
        v-if="!item.active"
        class="primary-button tight-button"
        type="button"
        :disabled="busy"
        @click="emit('activate', item.profile.id)"
      >
        设为当前
      </button>
      <button
        class="secondary-button tight-button"
        type="button"
        :disabled="busy"
        @click="emit('clone', item.profile.id)"
      >
        克隆
      </button>
      <button
        v-if="!item.builtIn"
        class="ghost-button tight-button"
        type="button"
        :disabled="busy"
        @click="emit('edit', item.profile.id)"
      >
        编辑
      </button>
      <button
        v-if="!item.builtIn"
        class="danger-button tight-button"
        type="button"
        :disabled="busy || item.active"
        @click="emit('delete', item.profile.id)"
      >
        {{ deleteConfirming ? '确认删除' : '删除' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.writing-profile-card {
  border: 1px solid var(--editor-hairline);
  border-radius: var(--radius-card);
  padding: 0.875rem;
}

.writing-profile-card-active {
  border-color: var(--editor-focus);
}

.writing-profile-card-heading,
.writing-profile-card-title,
.writing-profile-card-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.writing-profile-card-heading {
  justify-content: space-between;
}

.writing-profile-card-title h3,
.writing-profile-card p {
  margin: 0;
}

.writing-profile-card code {
  color: var(--editor-muted);
  font-size: 0.75rem;
}

.writing-profile-card p {
  margin-top: 0.75rem;
  color: var(--editor-body);
  line-height: 1.5;
}

.writing-profile-details {
  display: grid;
  gap: 0.625rem;
  margin: 0.875rem 0;
}

.writing-profile-details div {
  display: grid;
  gap: 0.25rem;
}

.writing-profile-details dt {
  color: var(--editor-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.writing-profile-details dd {
  margin: 0;
  font-size: 0.8125rem;
}

.writing-profile-card-actions {
  flex-wrap: wrap;
}
</style>
