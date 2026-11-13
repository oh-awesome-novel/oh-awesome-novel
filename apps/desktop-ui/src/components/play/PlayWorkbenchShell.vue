<script setup lang="ts">
import { computed, nextTick, shallowRef, toRef, useTemplateRef } from 'vue';

import PlayAdoptionDraftForm from './PlayAdoptionDraftForm.vue';
import PlayAdoptionPanel from './PlayAdoptionPanel.vue';
import PlayObservationForm from './PlayObservationForm.vue';
import PlayComposer from './PlayComposer.vue';
import PlayEventFeed from './PlayEventFeed.vue';
import PlayHistoryControls from './PlayHistoryControls.vue';
import PlayWorldlineCompare from './PlayWorldlineCompare.vue';
import PlayTranscript from './PlayTranscript.vue';
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
import PlayRehearsalWorkspace from './rehearsal/PlayRehearsalWorkspace.vue';
import { usePlayAdoptionPreview } from '../../composables/usePlayAdoptionPreview';
import type {
  PlayAdoptionProjection,
  PlayAdoptionSeed,
} from '../../composables/usePlayAdoptionPreview';
import { canSubmitPlayChoiceDirectly } from '../../composables/usePlayWorkspace';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  PlayCanonBeatDirectorOperation,
  WorkspaceSummary,
} from '../../composables/useWorkspaceApi';
import type { PlaySuggestedActionView, PlayWorkspaceState } from '../../composables/usePlayWorkspace';

/**
 * Workbench presentation of a Play session: transcript, composer and every inspector panel.
 * Session and turn state live in `play`, which the stage presentation shares.
 */
const props = defineProps<{
  /** Shared session state; the same object drives the stage presentation. */
  play: PlayWorkspaceState;
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
  /** False while the stage presentation is on screen and this shell is hidden. */
  active: boolean;
}>();

const emit = defineEmits<{
  configureProvider: [];
  pendingActionCreated: [];
  reviewPendingAction: [pendingActionId: string];
  writingReferencesUpdated: [];
  enterStage: [];
}>();

const providerConfigured = toRef(props, 'providerConfigured');
const workspaceApi = useWorkspaceApi();

const {
  observation,
  migration,
  actionKind,
  displaySession,
  rehearsalWorkspace,
  selectedSession,
  selectedSessionId,
  sending,
  interactionBlocked,
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
  registerCreatedSession,
  replaceSession,
  refreshSessions,
  retryCheckpoint,
  renameCheckpoint,
  restoreCheckpoint,
  stopTurn,
  steerTurn,
  submitChoice,
  submitTurn,
} = props.play;
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
    return;
  }
  void submitChoice(choice);
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
</script>

<template>
  <div class="play-workbench-shell">
      <div
        v-if="selectedSession?.schemaVersion === 5"
        ref="usageStage"
        class="play-rehearsal-stage"
      >
        <button type="button" @click="emit('enterStage')">舞台模式回放（只读）</button>
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
        <button type="button" @click="emit('enterStage')">进入舞台模式</button>
        </div>
        <PlayTranscript
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
          :suppress-choice-hotkeys="!active"
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

      <aside
        v-if="selectedSession?.schemaVersion === 4"
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
  </div>
</template>

<style scoped>
/* The shell adds no box of its own: its children stay items of the workspace grid. */
.play-workbench-shell {
  display: contents;
}

.play-rehearsal-stage {
  grid-column: 2 / -1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: grid;
  /* The stage scrolls; rows must keep their content height instead of shrinking to fit. */
  grid-auto-rows: max-content;
  align-content: start;
  gap: 12px;
  padding: 0 12px 16px;
}

@media (max-width: 860px) {
  .play-rehearsal-stage {
    grid-column: 1;
  }
}
</style>
