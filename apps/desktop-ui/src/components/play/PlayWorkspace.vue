<script setup lang="ts">
import { formatPlayWorldActivity } from '../../composables/playTerms';
import { computed, nextTick, shallowRef, toRef, useTemplateRef, watch } from 'vue';

import PlayAdoptionDraftForm from './PlayAdoptionDraftForm.vue';
import PlayAdoptionPanel from './PlayAdoptionPanel.vue';
import PlayObservationForm from './PlayObservationForm.vue';
import PlayComposer from './PlayComposer.vue';
import PlayEventFeed from './PlayEventFeed.vue';
import PlayHistoryControls from './PlayHistoryControls.vue';
import PlayWorldlineCompare from './PlayWorldlineCompare.vue';
import PlaySessionRail from './PlaySessionRail.vue';
import PlaySessionMigration from './PlaySessionMigration.vue';
import TavernImportPanel from './TavernImportPanel.vue';
import PlayTranscript from './PlayTranscript.vue';
import VisualNovelStage from './VisualNovelStage.vue';
import PlayPhaseMemory from './PlayPhaseMemory.vue';
import PlayWorldHud from './PlayWorldHud.vue';
import PlayRelationshipPanel from './PlayRelationshipPanel.vue';
import PlayCanonBeatPanel from './PlayCanonBeatPanel.vue';
import PlayCharacterCheckPanel from './PlayCharacterCheckPanel.vue';
import { PLAY_CHARACTER_CHECK_CATEGORY_LABELS, formatPlayCharacterCheckGuidance, projectPlayCanonBeatTable } from '@oh-awesome-novel/client';
import type { PlayCharacterCheckFinding, PlayCharacterCheckReportView, PlayCharacterCheckTarget } from '@oh-awesome-novel/client';
import { usePlayCharacterCheck } from '../../composables/usePlayCharacterCheck';
import PlayContextInspector from './context/PlayContextInspector.vue';
import PlayMessageLog from './message-log/PlayMessageLog.vue';
import DomainUsageInspector from '../usage/DomainUsageInspector.vue';
import { useUsagePresentation } from '../../composables/useUsagePresentation';
import PlayOutcomePanel from './outcome/PlayOutcomePanel.vue';
import PlayLaunchFlow from './launch/PlayLaunchFlow.vue';
import PlayRehearsalWorkspace from './rehearsal/PlayRehearsalWorkspace.vue';
import { usePlayAdoptionPreview } from '../../composables/usePlayAdoptionPreview';
import type {
  PlayAdoptionProjection,
  PlayAdoptionSeed,
} from '../../composables/usePlayAdoptionPreview';
import { canSubmitPlayChoiceDirectly, usePlayWorkspace } from '../../composables/usePlayWorkspace';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  FileTreeNode,
  PlayCanonBeatDirectorOperation,
  PlayLaunchReuseSeed,
  PlaySession,
  WorkspaceSummary,
} from '../../composables/useWorkspaceApi';
import type { PlaySessionCreateRequest, PlaySuggestedActionView } from '../../composables/usePlayWorkspace';

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
const visualNovelOpen = shallowRef(false);
const importOpen = shallowRef(false);
const importBusy = shallowRef(false);
const workspaceApi = useWorkspaceApi();
const launchSeed = shallowRef<PlayLaunchReuseSeed>();
const launchSeedLoading = shallowRef(false);
const launchSeedError = shallowRef('');
// Remounts the flow per open, so a seed prefills exactly one launch.
const launchKey = shallowRef(0);

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
  usagePresentation,
  turnAnnouncement,
  timeAdvance,
  showSpoilers,
  hasHiddenPlayContent,
  sessions,
  eventCards,
  stateEntries,
  suggestedActions,
  extraSuggestions,
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
  submitChoice,
  submitTurn,
} = usePlayWorkspace(props.workspace.path, providerConfigured);

const comparisonOutcomePanel = useTemplateRef<InstanceType<typeof PlayOutcomePanel>>('comparisonOutcomePanel');
async function comparisonOutcome(checkpointId: string): Promise<void> {
  const session = selectedSession.value;
  if (!session || interactionBlocked.value) return;
  const current = historyCheckpoints.value.find(node => node.checkpointId === checkpointId)?.status === 'current';
  if (!current && !await restoreCheckpoint(checkpointId)) return;
  await nextTick();
  if (selectedSession.value?.id !== session.id ||
      (selectedSession.value.selectedTurnIds.at(-1) ?? 'initial-world') !== checkpointId) return;
  await comparisonOutcomePanel.value?.generateAndFocus();
}

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
  usagePresentation: rehearsalUsagePresentation,
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

const usageStage = shallowRef<HTMLElement>();
const usageLens = computed(() => selectedSession.value?.schemaVersion === 5
  ? rehearsalLens.value : showSpoilers.value ? 'director' as const : 'player' as const);
const activeUsagePresentation = computed(() => {
  const value = selectedSession.value?.schemaVersion === 5 ? rehearsalUsagePresentation.value : usagePresentation.value;
  return value?.scope.domain === 'play' && value.scope.sessionId === selectedSessionId.value ? value : undefined;
});
const usageObservation = useUsagePresentation({
  identity: () => `${props.workspace.path}:${selectedSessionId.value}:${usageLens.value}`,
  run: () => activeUsagePresentation.value,
  element: () => usageStage.value,
});
const usageRefreshKey = computed(() => `${selectedSession.value?.revision}:${activeUsagePresentation.value?.localId}:${activeUsagePresentation.value?.finished}:${usageObservation.revision.value}`);

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
    ? '请先完成或取消当前试演，再生成或使用结果报告。'
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

type PlayChoiceAction = Pick<PlaySuggestedActionView, 'userText' | 'actionKind' | 'timeAdvance'>;

/** Sends one choice option as the turn's action; the composer draft is left alone. */
function sendChoice(choice: PlayChoiceAction): void {
  if (interactionBlocked.value || !providerConfigured.value) return;
  if (!canSubmitPlayChoiceDirectly(choice)) {
    // A wait without a stated duration goes to the composer, where the author sets how long.
    actionKind.value = 'wait';
    userText.value = choice.userText;
    timeAdvance.value = undefined;
    visualNovelOpen.value = false;
    return;
  }
  void submitChoice(choice);
}

function chooseVisualAction(text: string): void {
  sendChoice(suggestedActions.value.find(action => action.userText === text) ?? { userText: text, actionKind: 'do' });
}

/** The author's own text from the stage; an edited option keeps the kind of the option it came from. */
function chooseCustomVisualAction(text: string, basedOn?: string): void {
  const source = suggestedActions.value.find(action => action.userText === basedOn);
  sendChoice({
    userText: text,
    actionKind: source?.actionKind ?? 'do',
    ...(source?.timeAdvance ? { timeAdvance: source.timeAdvance } : {}),
  });
}

// The Player lens gets no table at all unless the protagonist knows canon.
const canonBeatTable = computed(() => projectPlayCanonBeatTable(
  (displaySession.value ?? selectedSession.value)?.playLocalState,
  showSpoilers.value ? 'director' : 'player',
));
const canonBeatBusy = shallowRef(false);
const canonBeatError = shallowRef('');

/** A Director-only correction or beat-to-schedule conversion, committed on the selected branch. */
async function applyCanonBeatOperation(operation: PlayCanonBeatDirectorOperation): Promise<void> {
  const session = selectedSession.value;
  if (!session || !showSpoilers.value || interactionBlocked.value || canonBeatBusy.value) return;
  canonBeatBusy.value = true;
  canonBeatError.value = '';
  try {
    const result = await workspaceApi.applyPlayCanonBeatOperation(session.id, {
      baseRevision: session.revision,
      operation,
    });
    replaceSession(result.session);
  } catch (cause) {
    canonBeatError.value = `原作节点没有保存：${cause instanceof Error ? cause.message : String(cause)}`;
    // A refused write usually means the session moved on; reload so a retry uses the current revision.
    void refreshSessions();
  } finally {
    canonBeatBusy.value = false;
  }
}

// In-character check (1510): advisory reports kept beside the session, one lens at a time.
const characterCheck = usePlayCharacterCheck({
  client: workspaceApi,
  scope: computed(() => {
    const session = selectedSession.value;
    if (!session || migration.preview.value) return undefined;
    if (session.schemaVersion === 5) {
      const attempt = rehearsalAttempt.value;
      return { sessionId: session.id, lens: rehearsalLens.value, branchKey: `${attempt?.id ?? ''}:${attempt?.revision ?? ''}:${attempt?.status ?? ''}` };
    }
    return {
      sessionId: session.id,
      lens: showSpoilers.value ? 'director' as const : 'player' as const,
      branchKey: `${session.revision}:${(displaySession.value ?? session).selectedTurnIds.join('/')}`,
    };
  }),
  blocked: interactionBlocked,
});
const checkingMessageId = computed(() => {
  const target = characterCheck.running.value;
  return target?.kind === 'turnMessage' ? target.messageId : '';
});
const checkingStepRef = computed(() => {
  const target = characterCheck.running.value;
  return target?.kind === 'rehearsalStep' ? target.stepRef : '';
});
const characterCheckLabels = computed<Record<string, string>>(() => ({
  ...Object.fromEntries(historyCheckpoints.value.flatMap((checkpoint) => checkpoint.artifactId
    ? [[checkpoint.artifactId, checkpoint.name?.trim() || `第 ${checkpoint.worldTurn} 回合`]]
    : [])),
  ...Object.fromEntries(rehearsalSteps.value.map((step) => [step.id, `${step.participantName} 的试演步骤`])),
}));
const retryDraft = shallowRef<{ checkpointId: string; guidance: string; nonce: number }>();
const rehearsalRedirect = shallowRef<{ stepRef: string; intent: string; nonce: number }>();
const characterCheckNotice = shallowRef('');
const journeyRetryDisabledReason = computed(() => !providerConfigured.value
  ? '配置模型后才能重演。'
  : interactionBlocked.value ? '另一个操作正在进行。' : '');
const rehearsalRetryDisabledReason = computed(() => !rehearsalCapabilities.value.canModify || rehearsalBusy.value
  ? '当前不能修改这个试演步骤。'
  : '');

function checkRehearsalStep(stepRef: string): void {
  const attempt = rehearsalAttempt.value;
  if (attempt) void characterCheck.check({ kind: 'rehearsalStep', attemptId: attempt.id, stepRef });
}

/** "带着这条意见重演": hands editable text to the existing guided Retry box or rehearsal redirect form. */
function retryWithFinding(report: PlayCharacterCheckReportView, finding: PlayCharacterCheckFinding): void {
  if (report.stale) return;
  characterCheckNotice.value = '';
  const guidance = formatPlayCharacterCheckGuidance(finding);
  const nonce = Date.now();
  if (report.target.kind === 'turn') {
    retryDraft.value = { checkpointId: report.target.turnId, guidance, nonce };
  } else {
    rehearsalRedirect.value = { stepRef: report.target.stepRef, intent: guidance, nonce };
  }
}

function noteFinding(_report: PlayCharacterCheckReportView, finding: PlayCharacterCheckFinding): void {
  const opened = observation.prefill({
    summary: `角色贴合度（${PLAY_CHARACTER_CHECK_CATEGORY_LABELS[finding.category]}）：${finding.character} — ${finding.note}`,
    evidence: finding.quote,
    sourceTurnId: finding.segmentId,
  });
  characterCheckNotice.value = opened
    ? '已把这条意见填入下方的观察笔记表单，修改后保存。'
    : '这条消息不在已载入的记录里。请先载入更早的记录，再记为观察笔记。';
}

function focusCheckTarget(target: PlayCharacterCheckTarget): void {
  if (target.kind === 'turn') focusPlayTurn(target.turnId);
}

const relationshipBranchKey = computed(() =>
  `${selectedSession.value?.revision ?? -1}:${(displaySession.value ?? selectedSession.value)?.selectedTurnIds.at(-1) ?? ''}`);

/** Jumps to an event card, paging earlier events in when the card is not loaded yet. */
async function focusPlayEvent(eventId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await nextTick();
    const card = document.getElementById(`play-event-${eventId}`);
    if (card) {
      card.scrollIntoView({ block: 'center' });
      card.focus();
      return;
    }
    if (!eventWindow.value?.hasMoreBefore || !await loadEarlierEvents()) return;
  }
}

function focusPlayTurn(artifactId: string): void {
  const node = [...document.querySelectorAll<HTMLElement>('[data-worldline-checkpoint]')]
    .find((candidate) => candidate.dataset.worldlineCheckpoint === artifactId);
  node?.scrollIntoView({ block: 'center' });
  node?.focus();
}

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

      <div
        v-else-if="selectedSession?.schemaVersion === 5"
        ref="usageStage"
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
          :check-disabled="rehearsalBusy"
          :checking-step-ref="checkingStepRef"
          :redirect-request="rehearsalRedirect"
          @check-step="checkRehearsalStep"
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
        <PlayCharacterCheckPanel
          :reports="characterCheck.reports.value"
          :running="Boolean(characterCheck.running.value)"
          :error="characterCheck.error.value"
          :lens="rehearsalLens"
          :target-labels="characterCheckLabels"
          :retry-disabled-reason="rehearsalRetryDisabledReason"
          :can-note="false"
          :disabled="rehearsalBusy"
          @retry-with="retryWithFinding"
          @focus-target="focusCheckTarget"
          @cancel="characterCheck.cancel"
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
        <p v-if="selectedSession.schemaVersion === 5">排演沿用场景记忆与上下文窗口。阶段归档适用于沉浸式推演。</p>
        <PlayMessageLog :session-id="selectedSession.id" />
        <DomainUsageInspector :workspace-key="workspace.path" :scope="{ domain: 'play', sessionId: selectedSession.id }" :lens="usageLens" :operation-id="activeUsagePresentation?.operationId" :refresh-key="usageRefreshKey" />
        <PlayOutcomePanel
          :workspace-root="workspace.path"
          @review-pending-action="emit('pendingActionCreated'); emit('reviewPendingAction', $event)"
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

      <section v-else-if="selectedSession" ref="usageStage" class="play-stage-center" aria-label="推演舞台">
        <PlayPhaseMemory :workspace-key="workspace.path" :session="selectedSession" :lens="usageLens" :disabled="interactionBlocked" @director="showSpoilers = true" @continued="registerCreatedSession" />
        <div class="play-stage-actions">
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
          :usage-operation-id="provisionalTurn?.turnId"
          :has-more-before="transcriptWindow?.hasMoreBefore"
          :loading-earlier="loadingEarlierTranscript"
          @load-earlier="loadEarlierTranscript"
          :disabled="interactionBlocked || !providerConfigured"
          @choose="chooseVisualAction"
          @custom="chooseCustomVisualAction"
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
          :checkable="selectedSession.schemaVersion === 4"
          :check-disabled="interactionBlocked || Boolean(historyRetryingArtifactId)"
          :checking-message-id="checkingMessageId"
          @load-earlier="loadEarlierTranscript"
          @check-character="characterCheck.check({ kind: 'turnMessage', messageId: $event })"
        />

        <div v-if="!providerConfigured" class="play-provider-gate">
          <div>
            <strong>裁判暂不可用</strong>
            <p>配置模型后才能推进回合；现有会话和推演内容仍可浏览。</p>
          </div>
          <button class="primary-button tight-button" type="button" @click="emit('configureProvider')">
            配置模型
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
          :suppress-choice-hotkeys="visualNovelOpen"
          :show-empty-choices="(displaySession?.transcript ?? selectedSession.transcript).length > 0"
          :can-request-more="providerConfigured && selectedSession.schemaVersion === 4 && !historyRetryingArtifactId"
          :more-loading="extraSuggestions.loading.value"
          :more-active="Boolean(extraSuggestions.items.value)"
          :more-error="extraSuggestions.error.value"
          @more="extraSuggestions.request()"
          @choose="sendChoice"
          @stop="stopTurn"
          @steer="steerTurn"
          @submit="submitTurn"
        />
      </section>

      <section v-else class="play-stage-empty" aria-label="推演舞台">
        <span class="play-empty-marker" aria-hidden="true">[ ]</span>
        <h1>{{ loading ? '正在载入推演会话…' : '打开舞台' }}</h1>
        <p>从左侧创建或选择会话。推演在独立的世界状态中进行，不会直接改写小说文件。</p>
      </section>

      <aside
        v-if="!importOpen && !launchOpen && !migration.preview.value && selectedSession?.schemaVersion === 4"
        class="play-world-inspector"
        aria-label="世界检查器"
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
        <DomainUsageInspector :workspace-key="workspace.path" :scope="{ domain: 'play', sessionId: selectedSession.id }" :lens="usageLens" :operation-id="activeUsagePresentation?.operationId" :refresh-key="usageRefreshKey" />
        <PlayHistoryControls
          :checkpoints="historyCheckpoints"
          :session-revision="selectedSession.revision"
          :loading="historyLoading"
          :busy-artifact-id="historyBusyArtifactId"
          :retrying-artifact-id="historyRetryingArtifactId"
          :naming-checkpoint-id="historyNamingCheckpointId"
          :retry-disabled="!providerConfigured"
          retry-disabled-reason="配置模型后才能重演这一回合。"
          :blocked="interactionBlocked"
          :director-lens="showSpoilers"
          :notice="historyNotice"
          :retry-draft="retryDraft"
          @restore="restoreCheckpoint"
          @retry="retryCheckpoint"
          @name="renameCheckpoint"
        />
        <PlayWorldlineCompare
          :session-id="selectedSession.id"
          :workspace-key="workspace.path"
          :revision="selectedSession.revision"
          :lens="showSpoilers ? 'director' : 'player'"
          :checkpoints="historyCheckpoints"
          :disabled="interactionBlocked || historyLoading || Boolean(historyBusyArtifactId || historyRetryingArtifactId || historyNamingCheckpointId) || historyCheckpoints.find(node => node.status === 'current')?.checkpointId !== (selectedSession.selectedTurnIds.at(-1) ?? 'initial-world')"
          @restore="restoreCheckpoint"
          @name="renameCheckpoint"
          @outcome="comparisonOutcome"
        />
        <PlayCharacterCheckPanel
          :reports="characterCheck.reports.value"
          :running="Boolean(characterCheck.running.value)"
          :error="characterCheck.error.value"
          :lens="showSpoilers ? 'director' : 'player'"
          :target-labels="characterCheckLabels"
          :retry-disabled-reason="journeyRetryDisabledReason"
          :disabled="interactionBlocked"
          @retry-with="retryWithFinding"
          @note="noteFinding"
          @focus-target="focusCheckTarget"
          @cancel="characterCheck.cancel"
        />
        <p v-if="characterCheckNotice" class="play-character-check-notice" role="status">{{ characterCheckNotice }}</p>
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
        <PlayCanonBeatPanel
          :table="canonBeatTable"
          :director-lens="showSpoilers"
          :checkpoints="historyCheckpoints"
          :disabled="interactionBlocked"
          :busy="canonBeatBusy"
          :error="canonBeatError"
          @operate="applyCanonBeatOperation"
          @focus-event="focusPlayEvent"
          @focus-turn="focusPlayTurn"
        />
        <PlayRelationshipPanel
          :session-id="selectedSession.id"
          :branch-key="relationshipBranchKey"
          :lens="showSpoilers ? 'director' : 'player'"
          :paused="interactionBlocked"
          @focus-event="focusPlayEvent"
          @focus-turn="focusPlayTurn"
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
          :workspace-root="workspace.path"
          @review-pending-action="emit('pendingActionCreated'); emit('reviewPendingAction', $event)"
          ref="comparisonOutcomePanel"
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
        选择会话后会显示世界面板。
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
  /* The stage scrolls; rows must keep their content height instead of shrinking to fit. */
  grid-auto-rows: max-content;
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
