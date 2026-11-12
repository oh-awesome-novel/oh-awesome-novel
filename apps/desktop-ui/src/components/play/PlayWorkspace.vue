<script setup lang="ts">
import { formatPlayWorldActivity } from '../../composables/playTerms';
import { computed, shallowRef, toRef, watch } from 'vue';

import PlaySessionRail from './PlaySessionRail.vue';
import PlaySessionMigration from './PlaySessionMigration.vue';
import PlayStageShell from './PlayStageShell.vue';
import PlayWorkbenchShell from './PlayWorkbenchShell.vue';
import TavernImportPanel from './TavernImportPanel.vue';
import PlayTranscript from './PlayTranscript.vue';
import PlayLaunchFlow from './launch/PlayLaunchFlow.vue';
import { usePlayPresentationMode } from '../../composables/usePlayPresentationMode';
import type { PlayPresentationMode } from '../../composables/usePlayPresentationMode';
import { usePlayWorkspace } from '../../composables/usePlayWorkspace';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  FileTreeNode,
  PlayLaunchReuseSeed,
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
  openForge: [];
}>();

const providerConfigured = toRef(props, 'providerConfigured');
const launchOpen = shallowRef(false);
const importOpen = shallowRef(false);
const importBusy = shallowRef(false);
const workspaceApi = useWorkspaceApi();
const launchSeed = shallowRef<PlayLaunchReuseSeed>();
const launchSeedLoading = shallowRef(false);
const launchSeedError = shallowRef('');
// Remounts the flow per open, so a seed prefills exactly one launch.
const launchKey = shallowRef(0);

// One session state for both presentations: drafts, the running turn, the queue,
// the selected branch and the options survive a switch between stage and workbench.
const play = usePlayWorkspace(props.workspace.path, providerConfigured);
const {
  migration,
  creating,
  error,
  loading,
  rehearsalWorkspace,
  selectedSession,
  selectedSessionId,
  sending,
  interactionBlocked,
  refreshBlocked,
  historyWindow,
  provisionalTurn,
  turnAnnouncement,
  showSpoilers,
  sessions,
  createSession,
  registerCreatedSession,
  refreshSessions,
  selectSession,
} = play;
const {
  transcript: transcriptWindow,
  loadingEarlierTranscript,
  loadEarlierTranscript,
} = historyWindow;
const {
  busy: rehearsalBusy,
  announcement: rehearsalAnnouncement,
  lens: rehearsalLens,
  memoryLoading: rehearsalMemoryLoading,
  memoryRebuilding: rehearsalMemoryRebuilding,
  setLens: setRehearsalLens,
} = rehearsalWorkspace;

const presentation = usePlayPresentationMode(props.workspace.path, selectedSessionId);
const presentationMode = presentation.mode;
/** A session is on screen, as opposed to the launch flow, an import or an upgrade prompt. */
const sessionSurface = computed(() =>
  Boolean(selectedSession.value) && !importOpen.value && !launchOpen.value && !migration.preview.value);
const stageActive = computed(() => sessionSurface.value && presentationMode.value === 'stage');
// The workbench mounts the first time it is shown and then stays mounted while the stage
// is in front, so its open forms, running checks and scroll positions survive a switch.
const workbenchKept = shallowRef(false);
watch([selectedSessionId, presentationMode], ([id], previous) => {
  workbenchKept.value = presentationMode.value === 'workbench' || (id === previous?.[0] && workbenchKept.value);
}, { immediate: true });

function setPresentationMode(mode: PlayPresentationMode): void {
  presentation.setMode(mode);
}

// The stage is always the Player view. Closing the Director lens here also keeps the
// hidden workbench from holding Director data while the stage is in front.
watch(
  [presentationMode, selectedSessionId, showSpoilers, rehearsalLens, rehearsalMemoryLoading, rehearsalMemoryRebuilding],
  () => {
    if (presentationMode.value !== 'stage') return;
    if (showSpoilers.value) showSpoilers.value = false;
    if (rehearsalLens.value !== 'player') setRehearsalLens('player');
  },
  { immediate: true, flush: 'sync' },
);

watch(() => props.requestedSessionId, async (id) => {
  if (!id) return;
  await refreshSessions();
  // A handed-over session opens on the stage unless the author already chose a mode for it.
  if (!presentation.hasPreference(id)) presentation.setMode('stage', id);
  selectSession(id);
}, { immediate: true });

function openLaunch(): void {
  importOpen.value = false;
  if (interactionBlocked.value) return;
  launchSeed.value = undefined;
  launchSeedError.value = '';
  launchKey.value += 1;
  launchOpen.value = true;
}

/**
 * Opens the launch flow prefilled from an existing session's opening. The
 * source session is only read; whatever is created is an unrelated new session.
 */
async function reuseLaunch(sessionId: string): Promise<void> {
  if (interactionBlocked.value || launchSeedLoading.value) return;
  launchSeedLoading.value = true;
  launchSeedError.value = '';
  try {
    const { seed } = await workspaceApi.getPlayLaunchReuseSeed(sessionId);
    importOpen.value = false;
    launchSeed.value = seed;
    launchKey.value += 1;
    launchOpen.value = true;
  } catch (cause) {
    launchSeedError.value = `无法读取这个会话的开局：${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    launchSeedLoading.value = false;
  }
}

function cancelLaunch(): void {
  launchOpen.value = false;
  launchSeed.value = undefined;
}

function openSession(id: string): void {
  importOpen.value = false;
  cancelLaunch();
  selectSession(id);
}

async function createQuickSession(input: PlaySessionCreateRequest): Promise<void> {
  if (await createSession(input)) cancelLaunch();
}

function acceptGuidedSession(session: PlaySession): void {
  importOpen.value = false;
  registerCreatedSession(session);
  cancelLaunch();
}
</script>

<template>
  <section id="play-workspace" class="play-workspace" aria-label="推演工作区">
    <header class="play-workspace-bar">
      <div class="play-workspace-identity">
        <span><span aria-hidden="true">[play]</span> 互动世界</span>
        <strong>{{ workspace.novelName || workspace.name }}</strong>
        <small>推演内容独立保存 · 正式文件不受影响</small>
      </div>
      <div class="play-workspace-status">
        <button class="play-import-button" type="button" :disabled="interactionBlocked || importBusy" @click="importOpen = true; launchOpen = false">导入角色卡</button>
        <button
          v-if="selectedSession && !launchOpen && !importOpen"
          class="play-import-button play-reuse-launch"
          type="button"
          :disabled="interactionBlocked || importBusy || launchSeedLoading"
          @click="reuseLaunch(selectedSession.id)"
        >
          以此开局再开一局
        </button>
        <div v-if="sessionSurface" class="play-mode-switch" role="group" aria-label="呈现模式">
          <button class="play-import-button" type="button" :aria-pressed="presentationMode === 'stage'" title="沉浸的舞台：对话、立绘和选项" @click="setPresentationMode('stage')">舞台</button>
          <button class="play-import-button" type="button" :aria-pressed="presentationMode === 'workbench'" title="完整的专业工作台" @click="setPresentationMode('workbench')">专业</button>
        </div>
        <span v-if="selectedSession && !launchOpen">
          {{ formatPlayWorldActivity(selectedSession.eventPolicy) }}
        </span>
        <span :class="{ 'play-status-live': sending || rehearsalBusy }">
          {{ launchOpen
            ? '正在准备新的推演入口'
            : selectedSession?.schemaVersion === 5
            ? rehearsalAnnouncement || '试演已就绪'
            : provisionalTurn?.statusMessage || turnAnnouncement || '就绪' }}
        </span>
        <button
          type="button"
          :disabled="loading || refreshBlocked || importBusy"
          aria-label="刷新推演工作区"
          @click="refreshSessions"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>
    </header>

    <p v-if="error" class="play-workspace-error" role="alert">{{ error }}</p>
    <p v-if="launchSeedError" class="play-workspace-error" role="alert">{{ launchSeedError }}</p>
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
        @reuse-launch="reuseLaunch"
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
        :key="launchKey"
        class="play-launch-stage"
        :seed="launchSeed"
        :files="files"
        :files-loading="filesLoading"
        :files-error="filesError"
        :creating="creating"
        :busy="interactionBlocked"
        @quick-create="createQuickSession"
        @created="acceptGuidedSession"
        @cancel="cancelLaunch"
        @open-forge="emit('openForge')"
      />

      <PlaySessionMigration
        v-else-if="migration.preview.value"
        :preview="migration.preview.value"
        :busy="migration.busy.value"
        :error="migration.error.value"
        @confirm="migration.confirm"
      >
        <details v-if="selectedSession">
          <summary>不升级，只读查看已保存的记录</summary>
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

      <template v-else-if="selectedSession">
        <PlayStageShell
          v-if="stageActive"
          :play="play"
          :provider-configured="providerConfigured"
          @exit="setPresentationMode('workbench')"
          @configure-provider="emit('configureProvider')"
        />
        <PlayWorkbenchShell
          v-if="workbenchKept"
          v-show="!stageActive"
          :play="play"
          :workspace="workspace"
          :provider-configured="providerConfigured"
          :active="!stageActive"
          @enter-stage="setPresentationMode('stage')"
          @configure-provider="emit('configureProvider')"
          @pending-action-created="emit('pendingActionCreated')"
          @review-pending-action="emit('reviewPendingAction', $event)"
          @writing-references-updated="emit('writingReferencesUpdated')"
        />
      </template>

      <section v-else class="play-stage-empty" aria-label="推演舞台">
        <span class="play-empty-marker" aria-hidden="true">[ ]</span>
        <h1>{{ loading ? '正在载入推演会话…' : '打开舞台' }}</h1>
        <p>从左侧创建或选择会话。推演在独立的世界状态中进行，不会直接改写小说文件。</p>
      </section>

      <aside v-if="!importOpen && !launchOpen && !selectedSession" class="play-world-inspector play-inspector-empty">
        选择会话后会显示世界面板。
      </aside>
    </div>
  </section>
</template>

<style scoped>
.play-launch-stage {
  grid-column: 2 / -1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 860px) {
  .play-launch-stage {
    grid-column: 1;
  }
}
</style>
