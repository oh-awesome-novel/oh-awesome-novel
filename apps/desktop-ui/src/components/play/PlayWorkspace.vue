<script setup lang="ts">
import { toRef } from 'vue';

import PlayAdoptionPanel from './PlayAdoptionPanel.vue';
import PlayComposer from './PlayComposer.vue';
import PlayEventFeed from './PlayEventFeed.vue';
import PlayHistoryControls from './PlayHistoryControls.vue';
import PlaySessionRail from './PlaySessionRail.vue';
import PlayTranscript from './PlayTranscript.vue';
import PlayWorldHud from './PlayWorldHud.vue';
import PlayRehearsalWorkspace from './rehearsal/PlayRehearsalWorkspace.vue';
import { usePlayWorkspace } from '../../composables/usePlayWorkspace';
import type { PlayAdoptionCandidate, WorkspaceSummary } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
}>();

const emit = defineEmits<{
  configureProvider: [];
  pendingActionCreated: [];
}>();

const providerConfigured = toRef(props, 'providerConfigured');

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
  sortedEvents,
  causeLabelsByEventId,
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
  refreshSessions,
  retryCheckpoint,
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
        <span v-if="selectedSession">
          {{ selectedSession.eventPolicy.simulationMode }} · {{ selectedSession.eventPolicy.density }}
        </span>
        <span :class="{ 'play-status-live': sending || rehearsalBusy }">
          {{ selectedSession?.schemaVersion === 5
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
        @select-session="selectSession"
        @create-session="createSession"
        @refresh="refreshSessions"
      />

      <PlayRehearsalWorkspace
        v-if="selectedSession?.schemaVersion === 5"
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
        v-if="selectedSession?.schemaVersion === 4"
        class="play-world-inspector"
        aria-label="Play world inspector"
      >
        <PlayHistoryControls
          :checkpoints="historyCheckpoints"
          :session-revision="selectedSession.revision"
          :loading="historyLoading"
          :busy-artifact-id="historyBusyArtifactId"
          :retrying-artifact-id="historyRetryingArtifactId"
          :retry-disabled="!providerConfigured"
          retry-disabled-reason="Configure a provider to Retry this settlement."
          :blocked="interactionBlocked"
          :notice="historyNotice"
          @restore="restoreCheckpoint"
          @retry="retryCheckpoint"
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
          :events="sortedEvents"
          :cause-labels-by-event-id="causeLabelsByEventId"
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

      <aside v-else-if="!selectedSession" class="play-world-inspector play-inspector-empty">
        World HUD will appear after a session is selected.
      </aside>
    </div>
  </section>
</template>

<style scoped>
.play-rehearsal-stage {
  grid-column: 2 / -1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 860px) {
  .play-rehearsal-stage {
    grid-column: 1;
  }
}
</style>
