<script setup lang="ts">
import { computed, shallowRef, toRef, watch } from 'vue';

import PlayAdoptionDraftForm from './PlayAdoptionDraftForm.vue';
import PlayAdoptionPanel from './PlayAdoptionPanel.vue';
import PlayObservationForm from './PlayObservationForm.vue';
import PlayComposer from './PlayComposer.vue';
import PlayEventFeed from './PlayEventFeed.vue';
import PlayHistoryControls from './PlayHistoryControls.vue';
import PlaySessionRail from './PlaySessionRail.vue';
import PlaySessionMigration from './PlaySessionMigration.vue';
import TavernImportPanel from './TavernImportPanel.vue';
import PlayTranscript from './PlayTranscript.vue';
import VisualNovelStage from './VisualNovelStage.vue';
import PlayCompactionModal from './PlayCompactionModal.vue';
import PlayWorldHud from './PlayWorldHud.vue';
import PlayContextInspector from './context/PlayContextInspector.vue';
import PlayMessageLog from './message-log/PlayMessageLog.vue';
import PlayOutcomePanel from './outcome/PlayOutcomePanel.vue';
import PlayLaunchFlow from './launch/PlayLaunchFlow.vue';
import PlayRehearsalWorkspace from './rehearsal/PlayRehearsalWorkspace.vue';
import { usePlayAdoptionPreview } from '../../composables/usePlayAdoptionPreview';
import type {
  PlayAdoptionProjection,
  PlayAdoptionSeed,
} from '../../composables/usePlayAdoptionPreview';
import { usePlayWorkspace } from '../../composables/usePlayWorkspace';
import type {
  FileTreeNode,
  PlaySession,
  WorkspaceSummary,
} from '../../composables/useWorkspaceApi';
import type { PlaySessionCreateRequest } from '../../composables/usePlayWorkspace';

const props = withDefaults(defineProps<{
  workspace: WorkspaceSummary;
  requestedSessionId?: string;
  providerConfigured: boolean;
  files?: FileTreeNode[];
  filesLoading?: boolean;
  filesError?: string;
}>(), {
  files: () => [],
  filesLoading: false,
  filesError: '',
});

const emit = defineEmits<{
  configureProvider: [];
  pendingActionCreated: [];
  reviewPendingAction: [pendingActionId: string];
  writingReferencesUpdated: [];
}>();

const providerConfigured = toRef(props, 'providerConfigured');
const launchOpen = shallowRef(false);
const visualNovelOpen = shallowRef(false);
const importOpen = shallowRef(false);
const importBusy = shallowRef(false);

const {
  observation,
  migration,
  actionKind,
  creating,
  error,
  loading,
  displaySession,
  rehearsalWorkspace,
  selectedSession,
  selectedSessionId,
  sending,
  interactionBlocked,
  refreshBlocked,
  historyCheckpoints,
  historyBusyArtifactId,
  historyNamingCheckpointId,
  historyRetryingArtifactId,
  historyLoading,
  historyNotice,
  historyWindow,
  canStop,
  canSteer,
  followUpControls,
  provisionalTurn,
  turnAnnouncement,
  timeAdvance,
  showSpoilers,
  hasHiddenPlayContent,
  sessions,
  eventCards,
  stateEntries,
  suggestedActions,
  userText,
  visibleCandidates,
  visibleObservations,
  visibleScheduledEvents,
  visiblePressures,
  visibleAgendas,
  createSession,
  registerCreatedSession,
  replaceSession,
  refreshSessions,
  retryCheckpoint,
  renameCheckpoint,
  restoreCheckpoint,
  selectSession,
  stopTurn,
  steerTurn,
  submitTurn,
} = usePlayWorkspace(props.workspace.path, providerConfigured);

watch(() => props.requestedSessionId, async (id) => {
  if (!id) return;
  await refreshSessions();
  selectSession(id);
  visualNovelOpen.value = true;
}, { immediate: true });

const {
  transcript: transcriptWindow,
  events: eventWindow,
  traces: contextTraces,
  drift: sourceDrift,
  loadingEarlierTranscript,
  loadingEarlierEvents,
  contextLoading,
  decisionBusy: sourceDecisionBusy,
  contextError,
  announcement: historyWindowAnnouncement,
  loadEarlierTranscript,
  loadEarlierEvents,
  refreshContext,
  decideSourceDrift,
} = historyWindow;

const {
  scene: rehearsalScene,
  clock: rehearsalClock,
  attempt: rehearsalAttempt,
  queue: rehearsalQueue,
  steps: rehearsalSteps,
  stepRun: rehearsalStepRun,
  perception: rehearsalPerception,
  visibleEvents: rehearsalVisibleEvents,
  result: rehearsalResult,
  lens: rehearsalLens,
  memory: rehearsalMemory,
  memoryLoading: rehearsalMemoryLoading,
  memoryRebuilding: rehearsalMemoryRebuilding,
  memoryError: rehearsalMemoryError,
  capabilities: rehearsalCapabilities,
  busy: rehearsalBusy,
  recoveryRequired: rehearsalRecoveryRequired,
  recoveryMessage: rehearsalRecoveryMessage,
  recovering: rehearsalRecovering,
  announcement: rehearsalAnnouncement,
  error: rehearsalError,
  startAttempt: startRehearsalAttempt,
  generateStep: generateRehearsalStep,
  stopStep: stopRehearsalStep,
  steerStep: steerRehearsalStep,
  steerPending: rehearsalSteerPending,
  acceptStep: acceptRehearsalStep,
  retryStep: retryRehearsalStep,
  intervene: interveneRehearsal,
  finishAttempt: finishRehearsalAttempt,
  cancelAttempt: cancelRehearsalAttempt,
  setLens: setRehearsalLens,
  refreshMemory: refreshRehearsalMemory,
  rebuildMemory: rebuildRehearsalMemory,
  reconcileStep: reconcileRehearsalStep,
} = rehearsalWorkspace;

const rehearsalOutcomeBlocked = computed(() => Boolean(
  selectedSession.value?.schemaVersion === 5 &&
  rehearsalAttempt.value &&
  rehearsalAttempt.value.status !== 'committed' &&
  rehearsalAttempt.value.status !== 'cancelled',
));
const outcomeDisabled = computed(() =>
  interactionBlocked.value || rehearsalOutcomeBlocked.value,
);
const outcomeDisabledReason = computed(() =>
  rehearsalOutcomeBlocked.value
    ? 'Finish or cancel the active rehearsal attempt before generating or using an Outcome Report.'
    : '',
);
const adoptionProjection = computed<PlayAdoptionProjection>(() =>
  showSpoilers.value ? 'director' : 'player',
);
const adoptionContextKey = computed(() => JSON.stringify({
  sessionId: selectedSession.value?.id ?? '',
  revision: selectedSession.value?.revision ?? -1,
  selectedPath: displaySession.value?.selectedTurnIds ?? [],
  retryingArtifactId: historyRetryingArtifactId.value,
  sources: (selectedSession.value?.activatedSources ?? []).map((source) => ({
    sourceId: source.sourceId,
    path: source.path,
    contentHash: source.contentHash,
  })),
}));
const adoption = usePlayAdoptionPreview({
  session: selectedSession,
  projection: adoptionProjection,
  contextKey: adoptionContextKey,
  disabled: interactionBlocked,
  onSessionUpdated: replaceSession,
  onPendingActionCreated: () => emit('pendingActionCreated'),
});

function prepareAdoption(seed: PlayAdoptionSeed): void {
  void adoption.open(seed);
}

function chooseVisualAction(text: string): void {
  if (interactionBlocked.value || !providerConfigured.value) return;
  const suggestion = suggestedActions.value.find(action => action.userText === text);
  actionKind.value = suggestion?.actionKind ?? 'do';
  userText.value = text;
  void submitTurn();
}

function openLaunch(): void {
  importOpen.value = false;
  if (!interactionBlocked.value) launchOpen.value = true;
}

function cancelLaunch(): void {
  launchOpen.value = false;
}

function openSession(id: string): void {
  importOpen.value = false;
  launchOpen.value = false;
  selectSession(id);
}

async function createQuickSession(input: PlaySessionCreateRequest): Promise<void> {
  if (await createSession(input)) launchOpen.value = false;
}

function acceptGuidedSession(session: PlaySession): void {
  importOpen.value = false;
  registerCreatedSession(session);
  launchOpen.value = false;
}
</script>

<template>
  <section id="play-workspace" class="play-workspace" aria-label="Play workspace">
    <header class="play-workspace-bar">
      <div class="play-workspace-identity">
        <span><span aria-hidden="true">[play]</span> Interactive world</span>
        <strong>{{ workspace.novelName || workspace.name }}</strong>
        <small>Play-local rehearsal · canonical truth remains protected</small>
      </div>
      <div class="play-workspace-status">
        <button type="button" :disabled="interactionBlocked || importBusy" @click="importOpen = true; launchOpen = false">Import character</button>
        <span v-if="selectedSession && !launchOpen">
          {{ selectedSession.eventPolicy.simulationMode }} · {{ selectedSession.eventPolicy.density }}
        </span>
        <span :class="{ 'play-status-live': sending || rehearsalBusy }">
          {{ launchOpen
            ? 'Preparing a new Play entry'
            : selectedSession?.schemaVersion === 5
            ? rehearsalAnnouncement || 'Rehearsal ready'
            : provisionalTurn?.statusMessage || turnAnnouncement || 'Ready' }}
        </span>
        <button
          type="button"
          :disabled="loading || refreshBlocked || importBusy"
          aria-label="刷新 Play workspace"
          @click="refreshSessions"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>
    </header>

    <p v-if="error" class="play-workspace-error" role="alert">{{ error }}</p>
    <p v-if="migration.notice.value" role="status">{{ migration.notice.value }}</p>

    <div class="play-workspace-grid">
      <PlaySessionRail
        :sessions="sessions"
        :selected-session-id="selectedSessionId"
        :loading="loading"
        :creating="creating"
        :busy="interactionBlocked || importBusy"
        :refresh-disabled="refreshBlocked || importBusy"
        @select-session="openSession"
        @new-session="openLaunch"
        @refresh="refreshSessions"
      />

      <TavernImportPanel
        v-if="importOpen"
        class="play-launch-stage"
        :workspace-root="workspace.path"
        @busy="importBusy = $event"
        @close="importOpen = false"
        @pending-action-created="emit('pendingActionCreated')"
        @review-pending-action="emit('reviewPendingAction', $event)"
        @created="acceptGuidedSession"
      />

      <PlayLaunchFlow
        v-else-if="launchOpen"
        class="play-launch-stage"
        :files="files"
        :files-loading="filesLoading"
        :files-error="filesError"
        :creating="creating"
        :busy="interactionBlocked"
        @quick-create="createQuickSession"
        @created="acceptGuidedSession"
        @cancel="cancelLaunch"
      />

      <PlaySessionMigration
        v-else-if="migration.preview.value"
        :preview="migration.preview.value"
        :busy="migration.busy.value"
        :error="migration.error.value"
        @confirm="migration.confirm"
      >
        <details v-if="selectedSession">
          <summary>Read saved transcript without upgrading</summary>
          <PlayTranscript
            :title="selectedSession.title"
            :scene-start="selectedSession.sceneStart"
            :turns="selectedSession.transcript"
            announcement="Legacy session · read only until upgrade is confirmed"
            :total-count="transcriptWindow?.totalCount"
            :has-more-before="transcriptWindow?.hasMoreBefore"
            :loading-earlier="loadingEarlierTranscript"
            @load-earlier="loadEarlierTranscript"
          />
        </details>
      </PlaySessionMigration>

      <div
        v-else-if="selectedSession?.schemaVersion === 5"
        class="play-rehearsal-stage"
      >
        <button type="button" @click="visualNovelOpen = !visualNovelOpen">{{ visualNovelOpen ? '隐藏演出回放' : '视觉小说回放' }}</button>
        <VisualNovelStage v-if="visualNovelOpen" :session-id="selectedSession.id" :roster="selectedSession.metadataExtensions.characterRoster" :portraits="selectedSession.metadataExtensions.characterPortraits" :backgrounds="selectedSession.metadataExtensions.sceneBackgrounds" :scene="selectedSession.sceneStart" :turns="selectedSession.transcript" :choices="[]" :disabled="true" @close="visualNovelOpen = false" />
        <PlayRehearsalWorkspace
          :scene="rehearsalScene"
          :clock="rehearsalClock"
          :attempt="rehearsalAttempt"
          :queue="rehearsalQueue"
          :steps="rehearsalSteps"
          :step-run="rehearsalStepRun"
          :steer-pending="rehearsalSteerPending"
          :perception="rehearsalPerception"
          :visible-events="rehearsalVisibleEvents"
          :result="rehearsalResult"
          :lens="rehearsalLens"
          :memory="rehearsalMemory"
          :memory-loading="rehearsalMemoryLoading"
          :memory-rebuilding="rehearsalMemoryRebuilding"
          :memory-error="rehearsalMemoryError"
          :capabilities="rehearsalCapabilities"
          :provider-configured="providerConfigured"
          :busy="rehearsalBusy"
          :recovery-required="rehearsalRecoveryRequired"
          :recovery-message="rehearsalRecoveryMessage"
          :recovering="rehearsalRecovering"
          :announcement="rehearsalAnnouncement"
          :error="rehearsalError"
          @start-attempt="startRehearsalAttempt"
          @generate-step="generateRehearsalStep"
          @stop-step="stopRehearsalStep"
          @steer-step="steerRehearsalStep"
          @accept="acceptRehearsalStep"
          @retry="retryRehearsalStep"
          @intervene="interveneRehearsal"
          @finish="finishRehearsalAttempt"
          @cancel="cancelRehearsalAttempt"
          @update-lens="setRehearsalLens"
          @refresh-memory="refreshRehearsalMemory"
          @rebuild-memory="rebuildRehearsalMemory"
          @reconcile-step="reconcileRehearsalStep"
          @configure-provider="emit('configureProvider')"
        />
        <PlayContextInspector
          :traces="contextTraces"
          :drift="sourceDrift"
          :loading="contextLoading"
          :busy="sourceDecisionBusy"
          :error="contextError"
          @refresh="refreshContext"
          @decide="decideSourceDrift"
        />
        <PlayMessageLog :session-id="selectedSession.id" />
        <PlayOutcomePanel
          :session="selectedSession"
          :show-spoilers="showSpoilers"
          :disabled="outcomeDisabled"
          :disabled-reason="outcomeDisabledReason"
          @update-show-spoilers="showSpoilers = $event"
          @prepare-adoption="prepareAdoption"
          @writing-references-updated="emit('writingReferencesUpdated')"
        />
        <PlayAdoptionDraftForm
          v-if="adoption.activeSeed.value"
          :seed="adoption.activeSeed.value"
          :preview="adoption.preview.value"
          :pending-action="adoption.pendingAction.value"
          :previewing="adoption.previewing.value"
          :confirming="adoption.confirming.value"
          :disabled="outcomeDisabled"
          :error="adoption.error.value"
          @close="adoption.clear"
          @preview="adoption.requestPreview"
          @confirm="adoption.confirm"
          @review="emit('reviewPendingAction', $event)"
        />
      </div>

      <section v-else-if="selectedSession" class="play-stage-center" aria-label="Play stage">
        <div class="play-stage-actions">
        <PlayCompactionModal :session="selectedSession" :disabled="interactionBlocked" @continued="registerCreatedSession" />
        <button v-if="!visualNovelOpen" type="button" @click="visualNovelOpen = true">视觉小说演出</button>
        </div>
        <VisualNovelStage v-if="visualNovelOpen"
          :session-id="selectedSession.id"
          :roster="selectedSession.metadataExtensions.characterRoster"
          :portraits="selectedSession.metadataExtensions.characterPortraits"
          :backgrounds="selectedSession.metadataExtensions.sceneBackgrounds"
          :scene="selectedSession.sceneStart"
          :turns="displaySession?.transcript ?? selectedSession.transcript"
          :choices="suggestedActions.map(action => action.userText)"
          :draft="provisionalTurn?.provisionalText"
          :has-more-before="transcriptWindow?.hasMoreBefore"
          :loading-earlier="loadingEarlierTranscript"
          @load-earlier="loadEarlierTranscript"
          :disabled="interactionBlocked || !providerConfigured"
          @choose="chooseVisualAction"
          @close="visualNovelOpen = false"
        />
        <PlayTranscript v-else
          :title="selectedSession.title"
          :scene-start="selectedSession.sceneStart"
          :turns="displaySession?.transcript ?? selectedSession.transcript"
          :total-count="transcriptWindow?.totalCount"
          :has-more-before="transcriptWindow?.hasMoreBefore"
          :loading-earlier="loadingEarlierTranscript"
          :provisional="provisionalTurn"
          :announcement="turnAnnouncement || historyWindowAnnouncement"
          @load-earlier="loadEarlierTranscript"
        />

        <div v-if="!providerConfigured" class="play-provider-gate">
          <div>
            <strong>World referee 暂不可用</strong>
            <p>配置 provider 后才能提交真实 Play 回合；现有 session 和 Play-local 内容仍可浏览。</p>
          </div>
          <button class="primary-button tight-button" type="button" @click="emit('configureProvider')">
            配置 Provider
          </button>
        </div>

        <PlayComposer
          v-model:user-text="userText"
          v-model:action-kind="actionKind"
          v-model:time-advance="timeAdvance"
          :disabled="!providerConfigured"
          :busy="interactionBlocked"
          :phase="provisionalTurn?.phase"
          :can-stop="canStop"
          :suggestions="suggestedActions"
          :running="sending"
          :can-steer="canSteer"
          :follow-ups="followUpControls"
          @stop="stopTurn"
          @steer="steerTurn"
          @submit="submitTurn"
        />
      </section>

      <section v-else class="play-stage-empty" aria-label="Play stage">
        <span class="play-empty-marker" aria-hidden="true">[ ]</span>
        <h1>{{ loading ? 'Loading Play sessions…' : 'Open the stage' }}</h1>
        <p>从左侧创建或选择 session。Play 会在独立世界状态中推进，不会直接改写小说文件。</p>
      </section>

      <aside
        v-if="!importOpen && !launchOpen && !migration.preview.value && selectedSession?.schemaVersion === 4"
        class="play-world-inspector"
        aria-label="Play world inspector"
      >
        <PlayContextInspector
          :traces="contextTraces"
          :drift="sourceDrift"
          :loading="contextLoading"
          :busy="sourceDecisionBusy"
          :error="contextError"
          @refresh="refreshContext"
          @decide="decideSourceDrift"
        />
        <PlayMessageLog :session-id="selectedSession.id" />
        <PlayHistoryControls
          :checkpoints="historyCheckpoints"
          :session-revision="selectedSession.revision"
          :loading="historyLoading"
          :busy-artifact-id="historyBusyArtifactId"
          :retrying-artifact-id="historyRetryingArtifactId"
          :naming-checkpoint-id="historyNamingCheckpointId"
          :retry-disabled="!providerConfigured"
          retry-disabled-reason="Configure a provider to Retry this settlement."
          :blocked="interactionBlocked"
          :notice="historyNotice"
          @restore="restoreCheckpoint"
          @retry="retryCheckpoint"
          @name="renameCheckpoint"
        />
        <PlayWorldHud
          :clock="displaySession?.worldClock ?? selectedSession.worldClock"
          :policy="selectedSession.eventPolicy"
          :scene-start="selectedSession.sceneStart"
          :characters="selectedSession.characters"
          :state-entries="stateEntries"
          :scheduled-events="visibleScheduledEvents"
          :pressures="visiblePressures"
          :agendas="visibleAgendas"
          :sources="selectedSession.activatedSources"
        />
        <PlayEventFeed
          v-model:show-spoilers="showSpoilers"
          :cards="eventCards"
          :total-count="eventWindow?.totalCount"
          :has-more-before="eventWindow?.hasMoreBefore"
          :loading-earlier="loadingEarlierEvents"
          :has-hidden-play-content="hasHiddenPlayContent"
          :adoption-disabled="interactionBlocked"
          @load-earlier="loadEarlierEvents"
          @prepare-adoption="prepareAdoption"
        />
        <PlayAdoptionPanel
          :observations="visibleObservations"
          :candidates="visibleCandidates"
          :disabled="interactionBlocked"
          notice=""
          @prepare-adoption="prepareAdoption"
        >
          <template #observation-form>
            <PlayObservationForm
              v-model:summary="observation.summary.value"
              v-model:evidence="observation.evidence.value"
              v-model:source-turn-id="observation.sourceTurnId.value"
              :open="observation.open.value"
              :sources="observation.sources.value"
              :busy="observation.saving.value"
              :disabled="interactionBlocked"
              :can-save="observation.canSave.value"
              :error="observation.error.value"
              :notice="observation.notice.value"
              @start="observation.start"
              @cancel="observation.cancel"
              @save="observation.save"
              @refresh="refreshSessions"
            />
          </template>
        </PlayAdoptionPanel>
        <PlayOutcomePanel
          :session="selectedSession"
          :show-spoilers="showSpoilers"
          :disabled="outcomeDisabled"
          @update-show-spoilers="showSpoilers = $event"
          @prepare-adoption="prepareAdoption"
          @writing-references-updated="emit('writingReferencesUpdated')"
        />
        <PlayAdoptionDraftForm
          v-if="adoption.activeSeed.value"
          :seed="adoption.activeSeed.value"
          :preview="adoption.preview.value"
          :pending-action="adoption.pendingAction.value"
          :previewing="adoption.previewing.value"
          :confirming="adoption.confirming.value"
          :disabled="interactionBlocked"
          :error="adoption.error.value"
          @close="adoption.clear"
          @preview="adoption.requestPreview"
          @confirm="adoption.confirm"
          @review="emit('reviewPendingAction', $event)"
        />
      </aside>

      <aside v-else-if="!importOpen && !launchOpen && !selectedSession" class="play-world-inspector play-inspector-empty">
        World HUD will appear after a session is selected.
      </aside>
    </div>
  </section>
</template>

<style scoped>
.play-rehearsal-stage,
.play-launch-stage {
  grid-column: 2 / -1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.play-rehearsal-stage {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 0 12px 16px;
}

@media (max-width: 860px) {
  .play-rehearsal-stage,
  .play-launch-stage {
    grid-column: 1;
  }
}
</style>
