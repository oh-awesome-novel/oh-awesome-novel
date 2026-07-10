<script setup lang="ts">
import PlayAdoptionPanel from './PlayAdoptionPanel.vue';
import PlayComposer from './PlayComposer.vue';
import PlayEventFeed from './PlayEventFeed.vue';
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
  showSpoilers,
  sessions,
  sortedEvents,
  stateEntries,
  suggestedActions,
  userText,
  visibleCandidates,
  visibleObservations,
  createPendingAction,
  createAdoptionCandidate,
  createSession,
  refreshSessions,
  selectSession,
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
          {{ sending ? 'World referee resolving' : 'Ready' }}
        </span>
        <button type="button" :disabled="loading" aria-label="刷新 Play workspace" @click="refreshSessions">
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
        @select-session="selectSession"
        @create-session="createSession"
        @refresh="refreshSessions"
      />

      <section v-if="selectedSession" class="play-stage-center" aria-label="Play stage">
        <PlayTranscript
          :title="selectedSession.title"
          :scene-start="selectedSession.sceneStart"
          :turns="selectedSession.transcript"
          :sending="sending"
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
          :sending="sending"
          :suggestions="suggestedActions"
          @submit="submitTurn"
        />
      </section>

      <section v-else class="play-stage-empty" aria-label="Play stage">
        <span class="play-empty-marker" aria-hidden="true">[ ]</span>
        <h1>{{ loading ? 'Loading Play sessions…' : 'Open the stage' }}</h1>
        <p>从左侧创建或选择 session。Play 会在独立世界状态中推进，不会直接改写小说文件。</p>
      </section>

      <aside v-if="selectedSession" class="play-world-inspector" aria-label="Play world inspector">
        <PlayWorldHud
          :clock="selectedSession.worldClock"
          :policy="selectedSession.eventPolicy"
          :scene-start="selectedSession.sceneStart"
          :characters="selectedSession.characters"
          :state-entries="stateEntries"
          :sources="selectedSession.activatedSources"
        />
        <PlayEventFeed v-model:show-spoilers="showSpoilers" :events="sortedEvents" />
        <PlayAdoptionPanel
          :observations="visibleObservations"
          :candidates="visibleCandidates"
          :busy-candidate-id="adoptionBusyId"
          :creating-candidate="adoptionCreating"
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

<style scoped>
.play-workspace {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  grid-template-rows: 52px minmax(0, 1fr);
  background: rgb(247 242 233);
}

.play-workspace-bar {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 14px;
  border-bottom: 1px solid rgb(224 208 185);
  background: rgb(255 252 247 / 94%);
}

.play-workspace-identity,
.play-workspace-status {
  display: flex;
  align-items: center;
  gap: 9px;
}

.play-workspace-identity > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgb(180 83 9);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.play-workspace-identity strong {
  overflow: hidden;
  color: rgb(68 54 43);
  font-family: Georgia, "Times New Roman", serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-workspace-identity small,
.play-workspace-status span {
  color: rgb(139 112 88);
  font-size: 10px;
}

.play-workspace-status span {
  padding: 4px 7px;
  border-radius: 999px;
  background: rgb(246 235 218);
  font-weight: 800;
}

.play-workspace-status .play-status-live {
  background: rgb(254 243 199);
  color: rgb(146 64 14);
}

.play-workspace-status button {
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  border: 1px solid rgb(224 208 185);
  border-radius: 7px;
  background: rgb(255 253 249);
  color: rgb(120 75 36);
}

.play-workspace-error {
  position: absolute; inset: 52px 0 auto; z-index: 5;
  margin: 0;
  padding: 7px 14px;
  border-bottom: 1px solid rgb(254 202 202);
  background: rgb(254 242 242);
  color: rgb(185 28 28);
  font-size: 11px;
}

.play-workspace-grid {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: 250px minmax(400px, 1fr) minmax(290px, 330px);
}

.play-stage-center {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto auto;
  background: rgb(255 253 249);
}

.play-provider-gate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-top: 1px solid rgb(254 215 170);
  background: rgb(255 247 237);
}

.play-provider-gate p {
  margin: 3px 0 0;
  color: rgb(154 52 18);
  font-size: 10px;
}

.play-stage-empty {
  display: grid;
  min-height: 0;
  align-content: center;
  justify-items: center;
  padding: 30px;
  color: rgb(166 102 45);
  text-align: center;
}

.play-stage-empty h1 {
  margin: 12px 0 4px;
  color: rgb(68 54 43);
  font-family: Georgia, "Times New Roman", serif;
}

.play-stage-empty p {
  max-width: 480px;
  color: rgb(139 112 88);
  line-height: 1.6;
}

.play-world-inspector {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  border-left: 1px solid rgb(231 220 202);
  background: rgb(252 249 244);
}

.play-inspector-empty {
  color: rgb(139 112 88);
  font-size: 11px;
}

@media (max-width: 1120px) {
  .play-workspace-grid {
    grid-template-columns: 220px minmax(360px, 1fr) 280px;
  }

  .play-workspace-identity small,
  .play-workspace-status span:first-child {
    display: none;
  }
}

@media (max-width: 860px) {
  .play-workspace {
    overflow: auto;
  }

  .play-workspace-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .play-world-inspector {
    border-top: 1px solid rgb(231 220 202);
    border-left: 0;
  }
}

</style>
