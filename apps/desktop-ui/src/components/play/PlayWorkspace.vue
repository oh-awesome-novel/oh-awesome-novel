<script setup lang="ts">
import { shallowRef, toRef } from 'vue';

import PlayAdoptionPanel from './PlayAdoptionPanel.vue';
import PlayComposer from './PlayComposer.vue';
import PlayEventFeed from './PlayEventFeed.vue';
import PlayHistoryControls from './PlayHistoryControls.vue';
import PlaySessionRail from './PlaySessionRail.vue';
import PlayTranscript from './PlayTranscript.vue';
import PlayWorldHud from './PlayWorldHud.vue';
import PlayLaunchFlow from './launch/PlayLaunchFlow.vue';
import PlayRehearsalWorkspace from './rehearsal/PlayRehearsalWorkspace.vue';
import { usePlayWorkspace } from '../../composables/usePlayWorkspace';
import type {
  FileTreeNode,
  PlayAdoptionCandidate,
  PlaySession,
  WorkspaceSummary,
} from '../../composables/useWorkspaceApi';
import type { PlaySessionCreateRequest } from '../../composables/usePlayWorkspace';

const props = withDefaults(defineProps<{
  workspace: WorkspaceSummary;
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
}>();

const providerConfigured = toRef(props, 'providerConfigured');
const launchOpen = shallowRef(false);

const {
  actionKind,
  adoptionBusyId,
  adoptionCreating,
  adoptionNotice,
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
  canStop,
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
  createPendingAction,
  createAdoptionCandidate,
  createSession,
  registerCreatedSession,
  refreshSessions,
  retryCheckpoint,
  renameCheckpoint,
  restoreCheckpoint,
  selectSession,
  stopTurn,
  submitTurn,
} = usePlayWorkspace(props.workspace.path, providerConfigured);

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
  acceptStep: acceptRehearsalStep,
  retryStep: retryRehearsalStep,
  finishAttempt: finishRehearsalAttempt,
  cancelAttempt: cancelRehearsalAttempt,
  reconcileStep: reconcileRehearsalStep,
} = rehearsalWorkspace;

async function adoptCandidate(candidate: PlayAdoptionCandidate) {
  if (await createPendingAction(candidate)) {
    emit('pendingActionCreated');
  }
}

function openLaunch(): void {
  if (!interactionBlocked.value) launchOpen.value = true;
}

function cancelLaunch(): void {
  launchOpen.value = false;
}

function openSession(id: string): void {
  launchOpen.value = false;
  selectSession(id);
}

async function createQuickSession(input: PlaySessionCreateRequest): Promise<void> {
  if (await createSession(input)) launchOpen.value = false;
}

function acceptGuidedSession(session: PlaySession): void {
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
          :disabled="loading || refreshBlocked"
          aria-label="刷新 Play workspace"
          @click="refreshSessions"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>
    </header>

    <p v-if="error" class="play-workspace-error" role="alert">{{ error }}</p>

    <div class="play-workspace-grid">
      <PlaySessionRail
        :sessions="sessions"
        :selected-session-id="selectedSessionId"
        :loading="loading"
        :creating="creating"
        :busy="interactionBlocked"
        :refresh-disabled="refreshBlocked"
        @select-session="openSession"
        @new-session="openLaunch"
        @refresh="refreshSessions"
      />

      <PlayLaunchFlow
        v-if="launchOpen"
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

      <PlayRehearsalWorkspace
        v-else-if="selectedSession?.schemaVersion === 5"
        class="play-rehearsal-stage"
        :scene="rehearsalScene"
        :clock="rehearsalClock"
        :attempt="rehearsalAttempt"
        :queue="rehearsalQueue"
        :steps="rehearsalSteps"
        :step-run="rehearsalStepRun"
        :perception="rehearsalPerception"
        :visible-events="rehearsalVisibleEvents"
        :result="rehearsalResult"
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
        @accept="acceptRehearsalStep"
        @retry="retryRehearsalStep"
        @finish="finishRehearsalAttempt"
        @cancel="cancelRehearsalAttempt"
        @reconcile-step="reconcileRehearsalStep"
        @configure-provider="emit('configureProvider')"
      />

      <section v-else-if="selectedSession" class="play-stage-center" aria-label="Play stage">
        <PlayTranscript
          :title="selectedSession.title"
          :scene-start="selectedSession.sceneStart"
          :turns="displaySession?.transcript ?? selectedSession.transcript"
          :provisional="provisionalTurn"
          :announcement="turnAnnouncement"
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
          @stop="stopTurn"
          @submit="submitTurn"
        />
      </section>

      <section v-else class="play-stage-empty" aria-label="Play stage">
        <span class="play-empty-marker" aria-hidden="true">[ ]</span>
        <h1>{{ loading ? 'Loading Play sessions…' : 'Open the stage' }}</h1>
        <p>从左侧创建或选择 session。Play 会在独立世界状态中推进，不会直接改写小说文件。</p>
      </section>

      <aside
        v-if="!launchOpen && selectedSession?.schemaVersion === 4"
        class="play-world-inspector"
        aria-label="Play world inspector"
      >
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
          :has-hidden-play-content="hasHiddenPlayContent"
        />
        <PlayAdoptionPanel
          :observations="visibleObservations"
          :candidates="visibleCandidates"
          :busy-candidate-id="adoptionBusyId"
          :creating-candidate="adoptionCreating"
          :disabled="interactionBlocked"
          :notice="adoptionNotice"
          @create-candidate="createAdoptionCandidate"
          @create-pending-action="adoptCandidate"
        />
      </aside>

      <aside v-else-if="!launchOpen && !selectedSession" class="play-world-inspector play-inspector-empty">
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

@media (max-width: 860px) {
  .play-rehearsal-stage,
  .play-launch-stage {
    grid-column: 1;
  }
}
</style>
