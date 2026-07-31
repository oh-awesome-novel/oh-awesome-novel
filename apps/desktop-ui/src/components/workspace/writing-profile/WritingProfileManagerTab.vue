<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import WritingProfileCard from './WritingProfileCard.vue';
import WritingProfileForm from './WritingProfileForm.vue';
import { useWorkspaceApi } from '../../../composables/useWorkspaceApi';
import type {
  WritingProfile,
  WritingProfileState,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  state?: WritingProfileState;
  loading: boolean;
  loadError?: string;
}>();

const emit = defineEmits<{
  refresh: [];
  stateChanged: [state: WritingProfileState];
}>();

const api = useWorkspaceApi();
const busy = shallowRef(false);
const error = shallowRef('');
const formMode = shallowRef<'create' | 'edit' | 'clone'>();
const sourceProfileId = shallowRef('');
const formProfile = shallowRef<WritingProfile>();
const deleteConfirmationId = shallowRef('');
const profiles = computed(() => props.state?.profiles ?? []);

function startCreate() {
  sourceProfileId.value = '';
  formMode.value = 'create';
  formProfile.value = {
    version: 1,
    id: '',
    displayName: '',
    description: '',
    deconstruction: { outputs: ['techniques'] },
    writingReminders: {
      originality: false,
      aiVoice: false,
      characterConsistency: false,
      adaptationFreedom: false,
    },
  };
}

function startClone(profileId: string) {
  const source = profiles.value.find((item) => item.profile.id === profileId)?.profile;
  if (!source) return;
  sourceProfileId.value = profileId;
  formMode.value = 'clone';
  formProfile.value = {
    ...source,
    id: `${source.id}-copy`,
    displayName: `${source.displayName} 副本`,
    deconstruction: { outputs: [...source.deconstruction.outputs] },
    writingReminders: { ...source.writingReminders },
  };
}

function startEdit(profileId: string) {
  const source = profiles.value.find((item) => item.profile.id === profileId)?.profile;
  if (!source) return;
  sourceProfileId.value = profileId;
  formMode.value = 'edit';
  formProfile.value = {
    ...source,
    deconstruction: { outputs: [...source.deconstruction.outputs] },
    writingReminders: { ...source.writingReminders },
  };
}

function closeForm() {
  formMode.value = undefined;
  formProfile.value = undefined;
  sourceProfileId.value = '';
}

async function submitProfile(profile: WritingProfile) {
  if (!formMode.value) return;
  await mutate(async () => {
    if (formMode.value === 'create') {
      return (await api.createWritingProfile(profile)).state;
    }
    if (formMode.value === 'clone') {
      return (await api.cloneWritingProfile(sourceProfileId.value, {
        id: profile.id,
        displayName: profile.displayName,
        description: profile.description,
      })).state;
    }
    return (await api.updateWritingProfile(sourceProfileId.value, profile)).state;
  });
  if (!error.value) closeForm();
}

async function activate(profileId: string) {
  await mutate(async () => (await api.activateWritingProfile(profileId)).state);
}

async function requestDelete(profileId: string) {
  if (deleteConfirmationId.value !== profileId) {
    deleteConfirmationId.value = profileId;
    return;
  }
  await mutate(async () => (await api.deleteWritingProfile(profileId)).state);
  if (!error.value) deleteConfirmationId.value = '';
}

async function mutate(operation: () => Promise<WritingProfileState>) {
  busy.value = true;
  error.value = '';
  try {
    emit('stateChanged', await operation());
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="right-tab-panel writing-profile-manager" aria-label="Writing Profile manager">
    <div class="panel-heading">
      <div>
        <h2 class="panel-title">Writing Profiles</h2>
        <p class="empty-copy">
          选择拆书输出与固定 Writing 提醒；变更从下一次请求生效。
        </p>
      </div>
      <div class="writing-profile-manager-actions">
        <button
          class="ghost-button tight-button"
          type="button"
          :disabled="loading || busy"
          @click="emit('refresh')"
        >
          刷新
        </button>
        <button
          class="primary-button tight-button"
          type="button"
          :disabled="loading || busy"
          @click="startCreate"
        >
          新建
        </button>
      </div>
    </div>

    <p v-if="loadError || error" class="error-copy" role="alert">
      {{ error || loadError }}
    </p>
    <p v-if="state?.configError" class="error-copy" role="alert">
      {{ state.configError }} 已回落到商业写作。
    </p>
    <ul v-if="state?.profileErrors.length" class="writing-profile-errors">
      <li v-for="item in state.profileErrors" :key="item.source">
        <code>{{ item.source }}</code>：{{ item.message }}
      </li>
    </ul>
    <p v-if="loading" class="empty-copy">正在读取 Writing Profiles…</p>

    <WritingProfileForm
      v-if="formMode && formProfile"
      :key="`${formMode}:${formProfile.id}`"
      :mode="formMode"
      :initial-profile="formProfile"
      :busy="busy"
      @submit="submitProfile"
      @cancel="closeForm"
    />

    <div class="writing-profile-list">
      <WritingProfileCard
        v-for="item in profiles"
        :key="item.profile.id"
        :item="item"
        :busy="busy"
        :delete-confirming="deleteConfirmationId === item.profile.id"
        @activate="activate"
        @clone="startClone"
        @edit="startEdit"
        @delete="requestDelete"
      />
    </div>
  </section>
</template>

<style scoped>
.writing-profile-manager {
  display: grid;
  align-content: start;
  gap: 0.875rem;
}

.writing-profile-manager-actions {
  display: flex;
  gap: 0.5rem;
}

.writing-profile-list {
  display: grid;
  gap: 0.75rem;
}

.writing-profile-errors {
  margin: 0;
  padding-left: 1.25rem;
  color: var(--editor-danger);
  font-size: 0.75rem;
}
</style>
