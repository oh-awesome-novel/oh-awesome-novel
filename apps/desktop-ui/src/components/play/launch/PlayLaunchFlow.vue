<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef } from 'vue';

import PlaySessionCreateForm from '../PlaySessionCreateForm.vue';
import PlayRehearsalSetup from '../rehearsal/PlayRehearsalSetup.vue';
import PlaySessionPurposePicker from '../rehearsal/PlaySessionPurposePicker.vue';
import type {
  PlayRehearsalSetupSubmission,
  PlaySessionPurposeChoice,
} from '../rehearsal/types';
import { buildPlayRehearsalSessionInput } from '../../../composables/playRehearsalPresentation';
import type {
  FileTreeNode,
  PlaySession,
} from '../../../composables/useWorkspaceApi';
import type { PlaySessionCreateRequest } from '../../../composables/usePlayWorkspace';
import PlayGuidedStartWizard from './PlayGuidedStartWizard.vue';
import PlayLaunchModePicker from './PlayLaunchModePicker.vue';

defineProps<{
  files: FileTreeNode[];
  filesLoading: boolean;
  filesError?: string;
  creating: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  quickCreate: [input: PlaySessionCreateRequest];
  created: [session: PlaySession];
  cancel: [];
}>();

const purpose = shallowRef<PlaySessionPurposeChoice>();
const mode = shallowRef<'quick' | 'guided'>();
const flow = useTemplateRef<HTMLElement>('flow');

async function choosePurpose(next: PlaySessionPurposeChoice): Promise<void> {
  purpose.value = next;
  mode.value = undefined;
  await focusFirst();
}

async function chooseMode(next: 'quick' | 'guided'): Promise<void> {
  mode.value = next;
  await focusFirst();
}

async function returnToPurpose(): Promise<void> {
  purpose.value = undefined;
  mode.value = undefined;
  await focusFirst();
}

async function returnToMode(): Promise<void> {
  mode.value = undefined;
  await focusFirst();
}

function createQuickRehearsal(submission: PlayRehearsalSetupSubmission): void {
  emit('quickCreate', {
    ...buildPlayRehearsalSessionInput(submission),
    startMode: 'quick',
  });
}

async function focusFirst(): Promise<void> {
  await nextTick();
  flow.value?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
}
</script>

<template>
  <section ref="flow" class="play-launch-flow" aria-label="Create Play session">
    <PlaySessionPurposePicker
      v-if="!purpose"
      :disabled="creating || busy"
      @choose="choosePurpose"
      @cancel="emit('cancel')"
    />

    <PlayLaunchModePicker
      v-else-if="!mode"
      :purpose="purpose"
      :disabled="creating || busy"
      @choose="chooseMode"
      @back="returnToPurpose"
      @cancel="emit('cancel')"
    />

    <PlaySessionCreateForm
      v-else-if="mode === 'quick' && purpose === 'immersiveJourney'"
      :creating="creating || busy"
      @cancel="returnToMode"
      @create="emit('quickCreate', $event)"
    />

    <PlayRehearsalSetup
      v-else-if="mode === 'quick'"
      :creating="creating"
      :disabled="busy"
      @cancel="returnToMode"
      @create="createQuickRehearsal"
    />

    <PlayGuidedStartWizard
      v-else
      :purpose="purpose"
      :files="files"
      :files-loading="filesLoading"
      :files-error="filesError"
      :disabled="creating || busy"
      @cancel="returnToMode"
      @created="emit('created', $event)"
    />
  </section>
</template>

<style scoped>
.play-launch-flow {
  display: grid;
  place-items: start center;
  min-width: 0;
  min-height: 0;
  padding: clamp(16px, 4vw, 44px);
  overflow: auto;
  background: var(--play-canvas, var(--editor-canvas));
}

.play-launch-flow > :deep(*) {
  width: min(860px, 100%);
}
</style>
