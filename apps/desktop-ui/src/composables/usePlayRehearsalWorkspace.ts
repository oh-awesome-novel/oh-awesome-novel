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
import { usePlayRehearsalAttempt } from './usePlayRehearsalAttempt';
import type { PlayRehearsalAttemptClient } from './usePlayRehearsalAttempt';
import type {
  PlayRehearsalSessionV5,
  PlayRehearsalTurnEvidence,
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
    const persisted = findPersistedPlayRehearsalResult(session);
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
  const interactionBlocked = computed(() =>
    busy.value || Boolean(activeAttempt.value));
  const capabilities = computed<PlayRehearsalControlCapabilities>(() => ({
    canStartAttempt:
      options.providerConfigured.value && rehearsal.canStartAttempt.value,
    canGenerateStep:
      options.providerConfigured.value && rehearsal.canGenerateStep.value,
    canStopStep: rehearsal.canStopStep.value,
    canAccept: rehearsal.canAcceptStep.value,
    canRetry:
      options.providerConfigured.value && rehearsal.canRetryStep.value,
    canFinish: rehearsal.canFinishAttempt.value,
    canCancel: rehearsal.canCancelAttempt.value,
    disabledReasons: {
      ...(!options.providerConfigured.value
        ? {
            startAttempt: 'Configure a provider before starting a rehearsal.',
            generateStep: 'Configure a provider before generating an actor step.',
            retry: 'Configure a provider before generating a Retry variant.',
          }
        : {}),
      ...(truthIndeterminate.value
        ? {
            generateStep: 'Actor-step truth is indeterminate; recover attempt truth before continuing.',
            retry: 'Actor-step truth is indeterminate; recover attempt truth before continuing.',
          }
        : {}),
      ...(activeLookupIndeterminate.value
        ? {
            startAttempt: 'Recover active-attempt truth before starting another rehearsal.',
          }
        : {}),
      ...(mutationIndeterminate.value
        ? {
            startAttempt: 'Recover mutation truth before starting another rehearsal.',
            generateStep: 'Recover mutation truth before generating another actor step.',
            retry: 'Recover mutation truth before generating another Retry variant.',
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
    await rehearsal.generateNextStep();
  }

  async function retryStep(stepRef: string): Promise<void> {
    if (!options.providerConfigured.value) return;
    await rehearsal.retryStep(stepRef);
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
    selectedSession,
    scene,
    clock,
    attempt,
    queue,
    steps,
    stepRun,
    perception,
    visibleEvents,
    result,
    capabilities,
    busy,
    interactionBlocked,
    recoveryRequired,
    recoveryMessage,
    recovering: readonly(reconciling),
    canReconcile,
    announcement: rehearsal.announcement,
    error: rehearsal.error,
    startAttempt,
    generateStep,
    stopStep,
    acceptStep,
    retryStep,
    finishAttempt,
    cancelAttempt,
    reconcileStep,
  };
}
