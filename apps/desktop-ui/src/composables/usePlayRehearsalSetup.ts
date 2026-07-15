import { computed, readonly, shallowRef } from 'vue';

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
}

const setupSteps: PlayRehearsalSetupStep[] = ['scene', 'cast', 'review'];

export function usePlayRehearsalSetup(
  options: UsePlayRehearsalSetupOptions = {},
) {
  let participantSequence = 0;
  const currentStep = shallowRef<PlayRehearsalSetupStep>('scene');
  const sceneDraft = shallowRef<PlayRehearsalSceneDraft>(createSceneDraft());
  const participants = shallowRef<PlayRehearsalParticipantDraft[]>([
    createParticipantDraft(),
  ]);
  const sceneValidationVisible = shallowRef(false);
  const castValidationVisible = shallowRef(false);
  const announcement = shallowRef('Scene setup. Step 1 of 3.');

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
    announcement.value = `Actor added. ${participants.value.length} actors in the fixed queue.`;
  }

  function removeParticipant(participantRef: string): void {
    if (participants.value.length <= 1) {
      return;
    }
    participants.value = participants.value.filter(
      (participant) => participant.participantRef !== participantRef,
    );
    announcement.value = `Actor removed. ${participants.value.length} actors remain.`;
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
        announcement.value = 'Complete the required Scene fields before continuing.';
        return false;
      }
      currentStep.value = 'cast';
      announcement.value = 'Cast setup. Step 2 of 3.';
      return true;
    }

    if (currentStep.value === 'cast') {
      castValidationVisible.value = true;
      if (Object.keys(rawCastErrors.value).length > 0) {
        announcement.value = 'Complete every actor name and current goal before continuing.';
        return false;
      }
      currentStep.value = 'review';
      announcement.value = 'Review setup. Step 3 of 3. No session has been created yet.';
      return true;
    }

    return false;
  }

  function previousStep(): boolean {
    if (currentStep.value === 'review') {
      currentStep.value = 'cast';
      announcement.value = 'Cast setup. Step 2 of 3.';
      return true;
    }
    if (currentStep.value === 'cast') {
      currentStep.value = 'scene';
      announcement.value = 'Scene setup. Step 1 of 3.';
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
      announcement.value = 'Setup validation failed. Review Scene and Cast fields.';
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
      startMode: 'guided',
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
    announcement.value = 'Scene setup. Step 1 of 3.';
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
  };
}

function validateScene(scene: PlayRehearsalSceneDraft): PlayRehearsalSceneErrors {
  const errors: PlayRehearsalSceneErrors = {};
  if (!scene.title.trim()) errors.title = 'Scene title is required.';
  if (!scene.opening.trim()) errors.opening = 'Opening situation is required.';
  if (!scene.location.trim()) errors.location = 'Location is required.';
  if (!scene.objective.trim()) errors.objective = 'Rehearsal objective is required.';
  return errors;
}

function validateCast(
  participants: PlayRehearsalParticipantDraft[],
): PlayRehearsalCastErrors {
  return Object.fromEntries(participants.flatMap((participant) => {
    const errors = {
      ...(!participant.displayName.trim()
        ? { displayName: 'Actor name is required.' }
        : {}),
      ...(!participant.currentGoal.trim()
        ? { currentGoal: 'Current goal is required.' }
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
