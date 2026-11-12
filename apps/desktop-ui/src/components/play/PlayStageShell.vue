<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';

import PlayStageActionBar from './PlayStageActionBar.vue';
import VisualNovelStage from './VisualNovelStage.vue';
import { canSubmitPlayChoiceDirectly } from '../../composables/usePlayWorkspace';
import type { PlaySuggestedActionView, PlayWorkspaceState } from '../../composables/usePlayWorkspace';

/**
 * Stage presentation of a Play session: scenery, cast, dialogue, options and a small
 * action input. It reads and writes the same session state as the workbench and is
 * always the Player view; a Scene Rehearsal session is a read-only playback here.
 */
const props = defineProps<{
  /** Shared session state; the same object drives the workbench presentation. */
  play: PlayWorkspaceState;
  providerConfigured: boolean;
}>();

const emit = defineEmits<{
  /** Back to the workbench presentation. */
  exit: [];
  configureProvider: [];
}>();

const {
  actionKind,
  displaySession,
  selectedSession,
  sending,
  interactionBlocked,
  historyCheckpoints,
  historyNotice,
  historyWindow,
  canStop,
  canSteer,
  followUpControls,
  provisionalTurn,
  turnAnnouncement,
  timeAdvance,
  suggestedActions,
  userText,
  retryCheckpoint,
  restoreCheckpoint,
  stopTurn,
  steerTurn,
  submitChoice,
  submitTurn,
} = props.play;
const { transcript: transcriptWindow, loadingEarlierTranscript, loadEarlierTranscript } = historyWindow;

const stage = useTemplateRef<InstanceType<typeof VisualNovelStage>>('stage');
const actionBar = useTemplateRef<InstanceType<typeof PlayStageActionBar>>('actionBar');

const readOnly = computed(() => selectedSession.value?.schemaVersion !== 4);
const turns = computed(() => readOnly.value
  ? selectedSession.value?.transcript ?? []
  : displaySession.value?.transcript ?? selectedSession.value?.transcript ?? []);
const status = computed(() =>
  provisionalTurn.value?.statusMessage || turnAnnouncement.value || historyNotice.value || '');

type StageChoice = Pick<PlaySuggestedActionView, 'userText' | 'actionKind' | 'timeAdvance'>;

/** Sends one option as the turn's action; the shared draft is left alone. */
function sendChoice(choice: StageChoice): void {
  if (readOnly.value || interactionBlocked.value || !props.providerConfigured) return;
  if (!canSubmitPlayChoiceDirectly(choice)) {
    // A wait without a stated duration: the author sets how long in the stage input.
    actionKind.value = 'wait';
    userText.value = choice.userText;
    timeAdvance.value = undefined;
    void actionBar.value?.open();
    return;
  }
  void submitChoice(choice);
}

function choose(text: string): void {
  sendChoice(suggestedActions.value.find(action => action.userText === text) ?? { userText: text, actionKind: 'do' });
}

/** "改一改" puts the option into the shared draft; "自己写" keeps whatever the author already typed. */
function edit(basedOn?: string): void {
  if (readOnly.value) return;
  const source = suggestedActions.value.find(action => action.userText === basedOn);
  if (source) {
    actionKind.value = source.actionKind;
    userText.value = source.userText;
    if (source.actionKind === 'wait') timeAdvance.value = source.timeAdvance;
  } else if (basedOn !== undefined) {
    userText.value = basedOn;
  } else if (suggestedActions.value.some(action => action.userText === userText.value)) {
    // Text that is just an untouched option is not a draft worth keeping.
    userText.value = '';
  }
  void actionBar.value?.open();
}
</script>

<template>
  <section v-if="selectedSession" class="play-stage-shell" aria-label="舞台模式">
    <VisualNovelStage
      ref="stage"
      fill
      external-editor
      close-label="专业模式"
      :session-id="selectedSession.id"
      :roster="selectedSession.metadataExtensions.characterRoster"
      :portraits="selectedSession.metadataExtensions.characterPortraits"
      :backgrounds="selectedSession.metadataExtensions.sceneBackgrounds"
      :scene="selectedSession.sceneStart"
      :turns="turns"
      :choices="readOnly ? [] : suggestedActions.map(action => action.userText)"
      :draft="readOnly ? undefined : provisionalTurn?.provisionalText"
      :usage-operation-id="readOnly ? undefined : provisionalTurn?.turnId"
      :has-more-before="transcriptWindow?.hasMoreBefore"
      :loading-earlier="loadingEarlierTranscript"
      :disabled="readOnly || interactionBlocked || !providerConfigured"
      @load-earlier="loadEarlierTranscript"
      @choose="choose"
      @edit="edit"
      @close="emit('exit')"
    >
      <template #controls>
        <p v-if="readOnly" class="play-stage-readonly" role="note">
          场景排练在舞台模式只读回放；继续排练请回到专业模式。
        </p>
        <PlayStageActionBar
          v-else
          ref="actionBar"
          v-model:user-text="userText"
          v-model:action-kind="actionKind"
          v-model:time-advance="timeAdvance"
          :disabled="!providerConfigured"
          :busy="interactionBlocked"
          :running="sending"
          :can-stop="canStop"
          :can-steer="canSteer"
          :phase="provisionalTurn?.phase"
          :status="status"
          :follow-ups="followUpControls"
          :checkpoints="historyCheckpoints"
          @submit="submitTurn"
          @steer="steerTurn"
          @stop="stopTurn"
          @retry="retryCheckpoint($event)"
          @restore="restoreCheckpoint"
          @configure-provider="emit('configureProvider')"
          @closed="stage?.focus()"
        />
      </template>
    </VisualNovelStage>
  </section>
</template>

<style scoped>
.play-stage-shell {
  grid-column: 2 / -1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.play-stage-readonly {
  margin: 10px 0 0;
  color: #ccd0d7;
  font-size: 12px;
}

@media (max-width: 860px) {
  .play-stage-shell {
    grid-column: 1;
  }
}
</style>
