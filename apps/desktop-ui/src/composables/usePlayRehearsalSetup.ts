import { computed, readonly, shallowRef } from 'vue';
import { createPlayEventSettingsDraft, playEventSettingsError } from './playEventPolicyForm';

import type { PlayLaunchReuseQuickRehearsalForm } from './useWorkspaceApi';
import type {
  PlayRehearsalCastErrors,
  PlayRehearsalParticipantDraft,
  PlayRehearsalParticipantDraftPatch,
  PlayRehearsalSceneDraft,
  PlayRehearsalSceneErrors,
  PlayRehearsalSetupStep,
  PlayRehearsalSetupSubmission,
} from '../components/play/rehearsal/types';

export interface UsePlayRehearsalSetupOptions {
  createParticipantRef?: (sequence: number) => string;
  /** Another quick rehearsal's opening form to prefill from. */
  initial?: PlayLaunchReuseQuickRehearsalForm;
}

const setupSteps: PlayRehearsalSetupStep[] = ['scene', 'cast', 'review'];

export function usePlayRehearsalSetup(
  options: UsePlayRehearsalSetupOptions = {},
) {
  let participantSequence = 0;
  const currentStep = shallowRef<PlayRehearsalSetupStep>('scene');
  const sceneDraft = shallowRef<PlayRehearsalSceneDraft>(options.initial
    ? {
        title: options.initial.title,
        opening: options.initial.opening,
        location: options.initial.location,
        atmosphere: options.initial.atmosphere,
        objective: options.initial.objective,
        risk: options.initial.risk,
        simulationMode: options.initial.eventPolicy.simulationMode,
        density: options.initial.eventPolicy.density,
        eventSettings: {
          allowOffscreen: options.initial.eventPolicy.allowOffscreen,
          allowHidden: options.initial.eventPolicy.allowHidden,
          maxExternalEventsPerTurn: options.initial.eventPolicy.maxExternalEventsPerTurn,
        },
      }
    : createSceneDraft());
  const participants = shallowRef<PlayRehearsalParticipantDraft[]>(
    options.initial?.participants.length
      ? options.initial.participants.map((participant) => ({
          ...createParticipantDraft(),
          displayName: participant.displayName,
          position: participant.position,
          currentGoal: participant.currentGoal,
          initialKnowledge: participant.initialKnowledge,
        }))
      : [createParticipantDraft()],
  );
  const sceneValidationVisible = shallowRef(false);
  const castValidationVisible = shallowRef(false);
  const announcement = shallowRef('场景设置。第 1 / 3 步。');

  const rawSceneErrors = computed(() => validateScene(sceneDraft.value));
  const rawCastErrors = computed(() => validateCast(participants.value));
  const sceneErrors = computed<PlayRehearsalSceneErrors>(() =>
    sceneValidationVisible.value ? rawSceneErrors.value : {},
  );
  const castErrors = computed<PlayRehearsalCastErrors>(() =>
    castValidationVisible.value ? rawCastErrors.value : {},
  );
  const stepNumber = computed(() => setupSteps.indexOf(currentStep.value) + 1);

  function createParticipantDraft(): PlayRehearsalParticipantDraft {
    participantSequence += 1;
    return {
      participantRef: options.createParticipantRef?.(participantSequence)
        ?? `participant-${participantSequence}`,
      displayName: '',
      position: '',
      currentGoal: '',
      initialKnowledge: '',
    };
  }

  function updateScene(next: PlayRehearsalSceneDraft): void {
    sceneDraft.value = { ...next };
  }

  function updateParticipant(
    participantRef: string,
    patch: PlayRehearsalParticipantDraftPatch,
  ): void {
    participants.value = participants.value.map((participant) =>
      participant.participantRef === participantRef
        ? { ...participant, ...patch }
        : participant,
    );
  }

  function addParticipant(): void {
    participants.value = [...participants.value, createParticipantDraft()];
    announcement.value = `已添加角色，固定顺序中共 ${participants.value.length} 个角色。`;
  }

  function removeParticipant(participantRef: string): void {
    if (participants.value.length <= 1) {
      return;
    }
    participants.value = participants.value.filter(
      (participant) => participant.participantRef !== participantRef,
    );
    announcement.value = `已移除角色，还剩 ${participants.value.length} 个角色。`;
  }

  function moveParticipant(
    participantRef: string,
    direction: 'up' | 'down',
  ): void {
    const index = participants.value.findIndex(
      (participant) => participant.participantRef === participantRef,
    );
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= participants.value.length) {
      return;
    }

    const next = [...participants.value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    participants.value = next;
    announcement.value = `${next[target]!.displayName.trim() || 'Actor'} moved ${direction}.`;
  }

  function nextStep(): boolean {
    if (currentStep.value === 'scene') {
      sceneValidationVisible.value = true;
      if (Object.keys(rawSceneErrors.value).length > 0) {
        announcement.value = '请先填写场景的必填项。';
        return false;
      }
      currentStep.value = 'cast';
      announcement.value = '人物设置。第 2 / 3 步。';
      return true;
    }

    if (currentStep.value === 'cast') {
      castValidationVisible.value = true;
      if (Object.keys(rawCastErrors.value).length > 0) {
        announcement.value = '请先填写每个角色的名字和当前目标。';
        return false;
      }
      currentStep.value = 'review';
      announcement.value = '确认设置。第 3 / 3 步。还没有创建会话。';
      return true;
    }

    return false;
  }

  function previousStep(): boolean {
    if (currentStep.value === 'review') {
      currentStep.value = 'cast';
      announcement.value = '人物设置。第 2 / 3 步。';
      return true;
    }
    if (currentStep.value === 'cast') {
      currentStep.value = 'scene';
      announcement.value = '场景设置。第 1 / 3 步。';
      return true;
    }
    return false;
  }

  function buildSubmission(): PlayRehearsalSetupSubmission | undefined {
    sceneValidationVisible.value = true;
    castValidationVisible.value = true;
    if (
      Object.keys(rawSceneErrors.value).length > 0 ||
      Object.keys(rawCastErrors.value).length > 0
    ) {
      announcement.value = '设置校验失败，请检查场景和人物。';
      return undefined;
    }

    const normalizedParticipants = participants.value.map((participant) => ({
      ...participant,
      displayName: participant.displayName.trim(),
      position: participant.position.trim(),
      currentGoal: participant.currentGoal.trim(),
      initialKnowledge: participant.initialKnowledge.trim(),
    }));

    return {
      purpose: 'sceneRehearsal',
      startMode: 'quick',
      scene: normalizeScene(sceneDraft.value),
      participants: normalizedParticipants,
      actorOrder: normalizedParticipants.map((participant) => participant.participantRef),
    };
  }

  function reset(): void {
    participantSequence = 0;
    currentStep.value = 'scene';
    sceneDraft.value = createSceneDraft();
    participants.value = [createParticipantDraft()];
    sceneValidationVisible.value = false;
    castValidationVisible.value = false;
    announcement.value = '场景设置。第 1 / 3 步。';
  }

  return {
    currentStep: readonly(currentStep),
    stepNumber,
    sceneDraft: readonly(sceneDraft),
    participants: readonly(participants),
    sceneErrors,
    castErrors,
    announcement: readonly(announcement),
    updateScene,
    updateParticipant,
    addParticipant,
    removeParticipant,
    moveParticipant,
    nextStep,
    previousStep,
    buildSubmission,
    reset,
  };
}

function createSceneDraft(): PlayRehearsalSceneDraft {
  return {
    title: '',
    opening: '',
    location: '',
    atmosphere: '',
    objective: '',
    risk: '',
    simulationMode: 'reactiveWorld',
    density: 'balanced',
    eventSettings: createPlayEventSettingsDraft(),
  };
}

function validateScene(scene: PlayRehearsalSceneDraft): PlayRehearsalSceneErrors {
  const errors: PlayRehearsalSceneErrors = {};
  if (!scene.title.trim()) errors.title = '请填写场景标题。';
  if (!scene.opening.trim()) errors.opening = '请填写开场情境。';
  if (!scene.location.trim()) errors.location = '请填写地点。';
  if (!scene.objective.trim()) errors.objective = '请填写试演目标。';
  if (scene.eventSettings) errors.eventSettings = playEventSettingsError(scene.eventSettings);
  if (!errors.eventSettings) delete errors.eventSettings;
  return errors;
}

function validateCast(
  participants: PlayRehearsalParticipantDraft[],
): PlayRehearsalCastErrors {
  return Object.fromEntries(participants.flatMap((participant) => {
    const errors = {
      ...(!participant.displayName.trim()
        ? { displayName: '请填写角色名字。' }
        : {}),
      ...(!participant.currentGoal.trim()
        ? { currentGoal: '请填写当前目标。' }
        : {}),
    };
    return Object.keys(errors).length > 0
      ? [[participant.participantRef, errors] as const]
      : [];
  }));
}

function normalizeScene(scene: PlayRehearsalSceneDraft): PlayRehearsalSceneDraft {
  return {
    ...scene,
    title: scene.title.trim(),
    opening: scene.opening.trim(),
    location: scene.location.trim(),
    atmosphere: scene.atmosphere.trim(),
    objective: scene.objective.trim(),
    risk: scene.risk.trim(),
  };
}
