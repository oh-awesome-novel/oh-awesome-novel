<script setup lang="ts">
import PlayAdoptionPanel from './PlayAdoptionPanel.vue';
import PlayComposer from './PlayComposer.vue';
import PlayEventFeed from './PlayEventFeed.vue';
import PlayHistoryControls from './PlayHistoryControls.vue';
import PlaySessionRail from './PlaySessionRail.vue';
import PlayTranscript from './PlayTranscript.vue';
import PlayWorldHud from './PlayWorldHud.vue';
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

const {
  actionKind,
  adoptionBusyId,
  adoptionCreating,
  adoptionNotice,
  creating,
  error,
  loading,
  selectedSession,
  selectedSessionId,
  sending,
  interactionBlocked,
  historyCheckpoints,
  historyBusyArtifactId,
  historyLoading,
  historyNotice,
  canStop,
  provisionalTurn,
  turnAnnouncement,
  showSpoilers,
  hasHiddenPlayContent,
  sessions,
  sortedEvents,
  stateEntries,
  suggestedActions,
  userText,
  visibleCandidates,
  visibleObservations,
  visibleScheduledEvents,
  createPendingAction,
  createAdoptionCandidate,
  createSession,
  refreshSessions,
  restoreCheckpoint,
  selectSession,
  stopTurn,
  submitTurn,
} = usePlayWorkspace(props.workspace.path);

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
        <span :class="{ 'play-status-live': sending }">
          {{ provisionalTurn?.statusMessage || turnAnnouncement || 'Ready' }}
        </span>
        <button
          type="button"
          :disabled="loading || interactionBlocked"
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
        :refresh-disabled="interactionBlocked"
        @select-session="selectSession"
        @create-session="createSession"
        @refresh="refreshSessions"
      />

      <section v-if="selectedSession" class="play-stage-center" aria-label="Play stage">
        <PlayTranscript
          :title="selectedSession.title"
          :scene-start="selectedSession.sceneStart"
          :turns="selectedSession.transcript"
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

      <aside v-if="selectedSession" class="play-world-inspector" aria-label="Play world inspector">
        <PlayHistoryControls
          :checkpoints="historyCheckpoints"
          :session-revision="selectedSession.revision"
          :loading="historyLoading"
          :busy-artifact-id="historyBusyArtifactId"
          :blocked="interactionBlocked"
          :notice="historyNotice"
          @restore="restoreCheckpoint"
        />
        <PlayWorldHud
          :clock="selectedSession.worldClock"
          :policy="selectedSession.eventPolicy"
          :scene-start="selectedSession.sceneStart"
          :characters="selectedSession.characters"
          :state-entries="stateEntries"
          :scheduled-events="visibleScheduledEvents"
          :sources="selectedSession.activatedSources"
        />
        <PlayEventFeed
          v-model:show-spoilers="showSpoilers"
          :events="sortedEvents"
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

      <aside v-else class="play-world-inspector play-inspector-empty">
        World HUD will appear after a session is selected.
      </aside>
    </div>
  </section>
</template>
