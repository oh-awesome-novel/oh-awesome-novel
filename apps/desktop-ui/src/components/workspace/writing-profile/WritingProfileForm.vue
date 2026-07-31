<script setup lang="ts">
import { computed, reactive } from 'vue';
import type {
  WritingProfile,
  WritingProfileOutput,
  WritingReminderId,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  mode: 'create' | 'edit' | 'clone';
  initialProfile: WritingProfile;
  busy: boolean;
}>();

const emit = defineEmits<{
  submit: [profile: WritingProfile];
  cancel: [];
}>();

const outputLabels: Record<WritingProfileOutput, string> = {
  techniques: '抽象技法',
  world: '世界观',
  characters: '角色',
  relationships: '关系',
  outline: '大纲',
  timeline: '时间线',
};
const reminderLabels: Record<WritingReminderId, string> = {
  originality: '独立表达',
  aiVoice: 'AI 味审查',
  characterConsistency: '角色一致性',
  adaptationFreedom: '改编自由',
};
const outputIds = Object.keys(outputLabels) as WritingProfileOutput[];
const reminderIds = Object.keys(reminderLabels) as WritingReminderId[];
const draft = reactive<WritingProfile>({
  ...props.initialProfile,
  deconstruction: {
    outputs: [...props.initialProfile.deconstruction.outputs],
  },
  writingReminders: {
    ...props.initialProfile.writingReminders,
  },
});
const title = computed(() =>
  props.mode === 'create'
    ? '创建自定义 Profile'
    : props.mode === 'clone'
      ? '克隆 Profile'
      : '编辑自定义 Profile',
);
const submitLabel = computed(() =>
  props.mode === 'clone' ? '创建副本' : props.mode === 'edit' ? '保存' : '创建',
);
const idValid = computed(() => /^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(draft.id));
const canSubmit = computed(() =>
  idValid.value
  && draft.displayName.trim().length > 0
  && draft.description.trim().length > 0
  && draft.deconstruction.outputs.length > 0,
);

function toggleOutput(output: WritingProfileOutput) {
  const selected = draft.deconstruction.outputs.includes(output);
  if (selected) {
    if (draft.deconstruction.outputs.length === 1) return;
    draft.deconstruction.outputs = draft.deconstruction.outputs
      .filter((item) => item !== output);
    return;
  }
  draft.deconstruction.outputs = [...draft.deconstruction.outputs, output];
}

function submit() {
  if (!canSubmit.value) return;
  emit('submit', {
    ...draft,
    id: draft.id.trim(),
    displayName: draft.displayName.trim(),
    description: draft.description.trim(),
    deconstruction: {
      outputs: [...draft.deconstruction.outputs],
    },
    writingReminders: {
      ...draft.writingReminders,
    },
  });
}
</script>

<template>
  <form class="writing-profile-form" @submit.prevent="submit">
    <div class="panel-heading">
      <h3 class="panel-title">{{ title }}</h3>
      <button class="ghost-button tight-button" type="button" @click="emit('cancel')">
        取消
      </button>
    </div>

    <label class="writing-profile-field">
      <span>安全 ID</span>
      <input
        v-model="draft.id"
        class="text-input"
        type="text"
        :disabled="mode === 'edit' || busy"
        placeholder="my-writing-profile"
      >
      <small>字母开头，只使用字母、数字和连字符。</small>
    </label>
    <label class="writing-profile-field">
      <span>显示名</span>
      <input
        v-model="draft.displayName"
        class="text-input"
        type="text"
        :disabled="busy"
        maxlength="100"
      >
    </label>
    <label class="writing-profile-field">
      <span>说明</span>
      <textarea
        v-model="draft.description"
        class="text-input writing-profile-description"
        :disabled="busy"
        maxlength="2000"
      ></textarea>
    </label>

    <fieldset v-if="mode !== 'clone'" class="writing-profile-options">
      <legend>拆书输出（至少一项）</legend>
      <label v-for="output in outputIds" :key="output">
        <input
          type="checkbox"
          :checked="draft.deconstruction.outputs.includes(output)"
          :disabled="busy"
          @change="toggleOutput(output)"
        >
        <span>{{ outputLabels[output] }}</span>
      </label>
    </fieldset>

    <fieldset v-if="mode !== 'clone'" class="writing-profile-options">
      <legend>Writing 提醒</legend>
      <label v-for="reminder in reminderIds" :key="reminder">
        <input
          v-model="draft.writingReminders[reminder]"
          type="checkbox"
          :disabled="busy"
        >
        <span>{{ reminderLabels[reminder] }}</span>
      </label>
    </fieldset>

    <p v-else class="empty-copy">
      副本将完整复制拆书输出和 Writing 提醒；创建后可继续编辑。
    </p>

    <button
      class="primary-button"
      type="submit"
      :disabled="busy || !canSubmit"
    >
      {{ busy ? '保存中…' : submitLabel }}
    </button>
  </form>
</template>

<style scoped>
.writing-profile-form {
  display: grid;
  gap: 0.875rem;
  border: 1px solid var(--editor-hairline);
  border-radius: var(--radius-card);
  padding: 0.875rem;
}

.writing-profile-field {
  display: grid;
  gap: 0.375rem;
  font-size: 0.8125rem;
  font-weight: 700;
}

.writing-profile-field small {
  color: var(--editor-muted);
  font-weight: 400;
}

.writing-profile-description {
  min-height: 5rem;
  resize: vertical;
}

.writing-profile-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
  border: 1px solid var(--editor-hairline);
  border-radius: var(--radius-card);
  padding: 0.75rem;
}

.writing-profile-options legend {
  padding: 0 0.25rem;
  color: var(--editor-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.writing-profile-options label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
}
</style>
