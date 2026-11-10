import { computed, readonly, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';

import type {
  PlayRehearsalControlCapabilities,
  PlayRehearsalSceneContractView,
} from '../components/play/rehearsal/types';
import {
  findPersistedPlayRehearsalResult,
  isPlayRehearsalSession,
  projectPlayRehearsalAttempt,
  projectPlayRehearsalClock,
  projectPlayRehearsalPerception,
  projectPlayRehearsalQueue,
  projectPlayRehearsalResult,
  projectPlayRehearsalScene,
  projectPlayRehearsalStepRun,
  projectPlayRehearsalSteps,
  projectPlayRehearsalVisibleEvents,
} from './playRehearsalPresentation';
import type { PlayActorStepOutcome } from './usePlayActorStepStream';
import { usePlayDirectorInterventions } from './usePlayDirectorInterventions';
import { usePlayRehearsalAttempt } from './usePlayRehearsalAttempt';
import type { PlayRehearsalAttemptClient } from './usePlayRehearsalAttempt';
import type {
  PlayRehearsalSessionV5,
  PlayRehearsalTurnEvidence,
  PlaySelectedArtifactPresentation,
  PlaySession,
  PlayTurnArtifact,
} from './useWorkspaceApi';

export interface UsePlayRehearsalWorkspaceOptions {
  client: PlayRehearsalAttemptClient<
    PlayRehearsalSessionV5,
    PlayTurnArtifact,
    PlayRehearsalTurnEvidence
  >;
  selectedSession: Readonly<Ref<PlaySession | undefined>>;
  selectedArtifactPresentation?: Readonly<
    Ref<PlaySelectedArtifactPresentation | undefined>
  >;
  providerConfigured: Readonly<Ref<boolean>>;
  onCommitted(session: PlayRehearsalSessionV5): void;
}

const EMPTY_SCENE: PlayRehearsalSceneContractView = {
  title: '',
  opening: '',
};

export function usePlayRehearsalWorkspace(
  options: UsePlayRehearsalWorkspaceOptions,
) {
  const reconciling = shallowRef(false);
  const steerPending = shallowRef<string>();
  const selectedSession = computed(() => {
    const session = options.selectedSession.value;
    return isPlayRehearsalSession(session) ? session : undefined;
  });
  const sessionId = computed(() => selectedSession.value?.id);
  const baseRevision = computed(() => selectedSession.value?.revision);
  const rehearsal = usePlayRehearsalAttempt({
    client: options.client,
    sessionId,
    baseRevision,
    onFinished(result) {
      options.onCommitted(result.session);
    },
  });
  const director = usePlayDirectorInterventions({
    client: {
      getPlaySceneMemory(sessionId, lens) {
        return options.client.getPlaySceneMemory?.(sessionId, lens) ??
          Promise.resolve({ memory: null });
      },
      rebuildPlaySceneMemory(sessionId, lens) {
        const rebuild = options.client.rebuildPlaySceneMemory;
        return rebuild
          ? rebuild(sessionId, lens)
          : Promise.reject(new Error('场景记忆不可用。'));
      },
    },
    sessionId,
    sessionRevision: baseRevision,
    attempt: rehearsal.attempt,
    apply: rehearsal.intervene,
  });

  watch(
    sessionId,
    (nextSessionId, previousSessionId) => {
      if (nextSessionId === previousSessionId) return;
      rehearsal.clear();
      if (nextSessionId) {
        void rehearsal.loadActive();
      }
    },
    { immediate: true },
  );

  const activeAttempt = computed(() => {
    const attempt = rehearsal.attempt.value;
    return attempt?.status === 'running' || attempt?.status === 'prepared'
      ? attempt
      : undefined;
  });
  const committedProjection = computed(() => {
    if (activeAttempt.value) return undefined;
    const session = selectedSession.value;
    if (!session) return undefined;
    const persisted = findPersistedPlayRehearsalResult(
      session,
      options.selectedArtifactPresentation?.value,
    );
    if (persisted) return persisted;

    // The Finish response may render one tick before the parent replaces its
    // session entry. It is only a bridge across that hand-off, never authority
    // over an equal/newer selected branch restored from the session list.
    const transient = rehearsal.committedResult.value;
    return transient &&
      transient.session.id === session.id &&
      transient.session.revision > session.revision &&
      transient.session.selectedTurnIds.includes(transient.artifact.id)
      ? transient
      : undefined;
  });
  const scene = computed(() => selectedSession.value
    ? projectPlayRehearsalScene(selectedSession.value)
    : EMPTY_SCENE);
  const clock = computed(() => selectedSession.value
    ? projectPlayRehearsalClock(selectedSession.value)
    : { turn: 0, revision: 0 });
  const attempt = computed(() => selectedSession.value
    ? projectPlayRehearsalAttempt(selectedSession.value, activeAttempt.value)
    : undefined);
  const queue = computed(() => selectedSession.value
    ? projectPlayRehearsalQueue(
        selectedSession.value,
        activeAttempt.value,
        committedProjection.value,
      )
    : []);
  const steps = computed(() => selectedSession.value
    ? projectPlayRehearsalSteps(
        selectedSession.value,
        activeAttempt.value,
        rehearsal.stepRun.value,
        committedProjection.value,
      )
    : []);
  const stepRun = computed(() => projectPlayRehearsalStepRun(
    rehearsal.stepRun.value,
  ));
  const perception = computed(() => selectedSession.value
    ? projectPlayRehearsalPerception(selectedSession.value, activeAttempt.value)
    : undefined);
  const visibleEvents = computed(() => selectedSession.value
    ? projectPlayRehearsalVisibleEvents(selectedSession.value, activeAttempt.value)
    : []);
  const result = computed(() => projectPlayRehearsalResult(
    committedProjection.value,
  ));
  const truthIndeterminate = computed(() =>
    rehearsal.stepRun.value?.phase === 'indeterminate');
  const activeLookupIndeterminate = computed(() =>
    rehearsal.activeLookupIndeterminate.value);
  const mutationIndeterminate = computed(() =>
    rehearsal.mutationIndeterminate.value);
  const recoveryRequired = computed(() =>
    truthIndeterminate.value ||
    mutationIndeterminate.value ||
    activeLookupIndeterminate.value);
  const recoveryMessage = computed(() =>
    truthIndeterminate.value
      ? rehearsal.stepRun.value?.error
      : mutationIndeterminate.value || activeLookupIndeterminate.value
        ? rehearsal.error.value
        : undefined);
  const canReconcile = computed(() =>
    recoveryRequired.value && !reconciling.value);
  const busy = computed(() =>
    rehearsal.busy.value || recoveryRequired.value || reconciling.value);
  const error = computed(() => rehearsal.error.value || director.error.value);
  const interactionBlocked = computed(() =>
    busy.value || Boolean(activeAttempt.value));
  const capabilities = computed<PlayRehearsalControlCapabilities>(() => ({
    canStartAttempt:
      options.providerConfigured.value && rehearsal.canStartAttempt.value,
    canGenerateStep:
      options.providerConfigured.value && rehearsal.canGenerateStep.value,
    canStopStep: rehearsal.canStopStep.value,
    canAccept: rehearsal.canAcceptStep.value,
    canModify: rehearsal.canIntervene.value && Boolean(
      rehearsal.attempt.value?.steps.some((step) =>
        (step.status === 'draft' || step.status === 'selected') &&
        Boolean(step.effectFingerprint),
      ),
    ),
    canRetry:
      options.providerConfigured.value && rehearsal.canRetryStep.value,
    canInsertActor: rehearsal.canIntervene.value,
    canGrantKnowledge: rehearsal.canIntervene.value && Boolean(
      rehearsal.attempt.value?.steps.some((step) =>
        step.status === 'draft' || step.status === 'selected',
      ),
    ),
    canFinish: rehearsal.canFinishAttempt.value,
    canCancel: rehearsal.canCancelAttempt.value,
    disabledReasons: {
      ...(!options.providerConfigured.value
        ? {
            startAttempt: '请先配置模型再开始试演。',
            generateStep: '请先配置模型再生成角色步骤。',
            retry: '请先配置模型再重演。',
          }
        : {}),
      ...(truthIndeterminate.value
        ? {
            generateStep: '角色步骤状态不确定，请先恢复试演状态再继续。',
            retry: '角色步骤状态不确定，请先恢复试演状态再继续。',
          }
        : {}),
      ...(activeLookupIndeterminate.value
        ? {
            startAttempt: '请先恢复当前试演状态，再开始新的试演。',
          }
        : {}),
      ...(mutationIndeterminate.value
        ? {
            startAttempt: '请先恢复上一个操作的状态，再开始新的试演。',
            generateStep: '请先恢复上一个操作的状态，再生成角色步骤。',
            retry: '请先恢复上一个操作的状态，再重演。',
          }
        : {}),
      ...(!rehearsal.canIntervene.value
        ? {
            modify: '导演干预需要一场状态稳定、正在进行的试演。',
            insertActor: '导演干预需要一场状态稳定、正在进行的试演。',
            grantKnowledge: '导演干预需要一场状态稳定、正在进行的试演。',
          }
        : {}),
    },
  }));

  async function startAttempt(): Promise<void> {
    if (!options.providerConfigured.value) return;
    await rehearsal.startAttempt();
  }

  async function generateStep(): Promise<void> {
    if (!options.providerConfigured.value) return;
    await applySteer(await rehearsal.generateNextStep());
  }

  async function retryStep(stepRef: string): Promise<void> {
    if (!options.providerConfigured.value) return;
    await applySteer(await rehearsal.retryStep(stepRef), stepRef);
  }

  /**
   * A Director steer during actor generation becomes a `redirectStep` on
   * that step, so it passes the same constraint checks as a manual redirect.
   * A Retry already has its step and stops at once; a new step has nothing
   * to redirect until its draft exists, so it finishes first.
   */
  async function steerStep(text: string): Promise<void> {
    const intent = text.trim();
    const run = rehearsal.stepRun.value;
    if (!intent || !run || !rehearsal.canStopStep.value) return;
    steerPending.value = steerPending.value ? `${steerPending.value}\n${intent}` : intent;
    if (run.mode === 'retry' && run.sourceStepRef) await rehearsal.stopStep();
  }

  async function applySteer(outcome: PlayActorStepOutcome, retrySourceRef?: string): Promise<void> {
    const directorIntent = steerPending.value;
    if (!directorIntent) return;
    steerPending.value = undefined;
    const stepRef = outcome === 'prepared'
      ? rehearsal.currentStep.value?.id
      : outcome === 'aborted' ? retrySourceRef : undefined;
    if (!stepRef) return;
    await director.intervene({
      kind: 'redirectStep',
      stepRef,
      directorIntent,
      authorConstraintRefs: [],
      delivery: 'steer',
    });
  }

  async function acceptStep(stepRef: string): Promise<void> {
    await rehearsal.acceptStep(stepRef);
  }

  async function stopStep(): Promise<void> {
    await rehearsal.stopStep();
  }

  async function finishAttempt(): Promise<void> {
    await rehearsal.finishAttempt();
  }

  async function cancelAttempt(): Promise<void> {
    await rehearsal.cancelAttempt();
  }

  async function intervene(
    draft: Parameters<typeof director.intervene>[0],
  ): Promise<boolean> {
    return director.intervene(draft);
  }

  async function reconcileStep(): Promise<void> {
    if (!canReconcile.value) return;
    reconciling.value = true;
    try {
      if (truthIndeterminate.value) {
        await rehearsal.reconcileStep();
      } else if (mutationIndeterminate.value) {
        await rehearsal.recoverMutation();
      } else if (activeLookupIndeterminate.value) {
        await rehearsal.loadActive();
      }
    } finally {
      reconciling.value = false;
    }
  }

  return {
    steerPending: readonly(steerPending),
    steerStep,
    selectedSession,
    scene,
    clock,
    attempt,
    queue,
    steps,
    stepRun,
    usagePresentation: rehearsal.usagePresentation,
    perception,
    visibleEvents,
    result,
    lens: director.lens,
    memory: director.memory,
    memoryLoading: director.loadingMemory,
    memoryRebuilding: director.rebuildingMemory,
    memoryError: director.error,
    capabilities,
    busy,
    interactionBlocked,
    recoveryRequired,
    recoveryMessage,
    recovering: readonly(reconciling),
    canReconcile,
    announcement: rehearsal.announcement,
    error,
    startAttempt,
    generateStep,
    stopStep,
    acceptStep,
    retryStep,
    intervene,
    finishAttempt,
    cancelAttempt,
    setLens: director.setLens,
    refreshMemory: director.refreshMemory,
    rebuildMemory: director.rebuildMemory,
    reconcileStep,
  };
}
