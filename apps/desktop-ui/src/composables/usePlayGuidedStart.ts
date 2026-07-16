import {
  computed,
  readonly,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
} from 'vue';

import type { OanClient } from '@oh-awesome-novel/client';

import type {
  FileTreeNode,
  PlayEventDensity,
  PlayEventVisibility,
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlayLaunchSceneValue,
  PlayLaunchSourceRole,
  PlaySession,
  PlaySessionPurpose,
  PlaySimulationMode,
} from './useWorkspaceApi';

export type {
  PlayLaunchDiagnostic,
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlayLaunchSceneValue,
  PlayLaunchSourceRole,
  PlayLaunchSourceStatus,
} from './useWorkspaceApi';

export type PlayGuidedStartStep =
  | 'sources'
  | 'entry'
  | 'identity'
  | 'cast'
  | 'review';

export type PlayKnowledgeVisibility = PlayEventVisibility;
export type PlayGuidedSimulationMode = PlaySimulationMode;
export type PlayGuidedEventDensity = PlayEventDensity;

export type PlayGuidedStartApi = Pick<
  OanClient,
  | 'previewPlayLaunchPackage'
  | 'createPlayLaunchPackage'
  | 'startPlaySessionFromLaunchPackage'
>;

export interface PlayGuidedSourceOption {
  sourceId: string;
  name: string;
  path: string;
  role: PlayLaunchSourceRole;
  objectId?: string;
}

export interface PlayGuidedEntryDraft {
  title: string;
  label: string;
  opening: string;
  sourceRefs: readonly string[];
  location: string;
  worldTime: string;
  atmosphere: string;
  trigger: string;
  objective: string;
  risk: string;
  simulationMode: PlayGuidedSimulationMode;
  density: PlayGuidedEventDensity;
}

export interface PlayGuidedIdentityDraft {
  persona: string;
  directorPurpose: string;
}

export interface PlayGuidedParticipantDraft {
  participantRef: string;
  displayName: string;
  characterSourceId: string;
  position: string;
  currentGoal: string;
  initialKnowledge: string;
  knowledgeVisibility: PlayKnowledgeVisibility;
}

export type PlayGuidedParticipantPatch = Partial<
  Omit<PlayGuidedParticipantDraft, 'participantRef'>
>;

export interface PlayGuidedStartErrors {
  sources?: string;
  title?: string;
  label?: string;
  opening?: string;
  entrySources?: string;
  persona?: string;
  directorPurpose?: string;
  cast?: string;
  participants?: Record<string, { displayName?: string; currentGoal?: string }>;
}

export interface UsePlayGuidedStartOptions {
  api: PlayGuidedStartApi;
  purpose: MaybeRefOrGetter<PlaySessionPurpose>;
  tree: MaybeRefOrGetter<readonly FileTreeNode[]>;
  now?: () => string;
  createParticipantRef?: (sequence: number) => string;
}

const steps: readonly PlayGuidedStartStep[] = [
  'sources',
  'entry',
  'identity',
  'cast',
  'review',
];

export function usePlayGuidedStart(options: UsePlayGuidedStartOptions) {
  let participantSequence = 0;
  const now = options.now ?? (() => new Date().toISOString());
  const purpose = computed(() => toValue(options.purpose));
  const currentStep = shallowRef<PlayGuidedStartStep>('sources');
  const selectedSourceIds = shallowRef<string[]>([]);
  const entryDraft = shallowRef<PlayGuidedEntryDraft>(createEntryDraft());
  const identityDraft = shallowRef<PlayGuidedIdentityDraft>(createIdentityDraft());
  const participants = shallowRef<PlayGuidedParticipantDraft[]>(
    purpose.value === 'sceneRehearsal' ? [createParticipant()] : [],
  );
  const validationVisible = shallowRef<Partial<Record<PlayGuidedStartStep, boolean>>>({});
  const preview = shallowRef<PlayLaunchPackage>();
  const previewing = shallowRef(false);
  const creating = shallowRef(false);
  const requestError = shallowRef<string>();
  const announcement = shallowRef('Sources. Step 1 of 5.');

  const sourceOptions = computed(() => flattenFiles(toValue(options.tree)));
  const selectedSources = computed(() => {
    const ids = new Set(selectedSourceIds.value);
    return sourceOptions.value.filter((source) => ids.has(source.sourceId));
  });
  const characterSources = computed(() =>
    selectedSources.value.filter((source) => source.role === 'character'));
  const rawErrors = computed(() => validateDraft(
    purpose.value,
    selectedSourceIds.value,
    entryDraft.value,
    identityDraft.value,
    participants.value,
  ));
  const errors = computed<PlayGuidedStartErrors>(() => {
    if (!validationVisible.value[currentStep.value]) return {};
    return errorsForStep(currentStep.value, rawErrors.value);
  });
  const stepNumber = computed(() => steps.indexOf(currentStep.value) + 1);
  const blockingDiagnostics = computed(() => preview.value?.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  ) ?? []);
  const hasUnavailableSources = computed(() => Boolean(
    preview.value?.sourceBase.activatedSources.some((source) => source.status !== 'ready'),
  ));
  const canStart = computed(() => Boolean(
    preview.value
      && !previewing.value
      && !creating.value
      && blockingDiagnostics.value.length === 0
      && !hasUnavailableSources.value,
  ));

  function createParticipant(): PlayGuidedParticipantDraft {
    participantSequence += 1;
    return {
      participantRef: options.createParticipantRef?.(participantSequence)
        ?? `participant-${participantSequence}`,
      displayName: '',
      characterSourceId: '',
      position: '',
      currentGoal: '',
      initialKnowledge: '',
      knowledgeVisibility: 'playerUnknown',
    };
  }

  function toggleSource(sourceId: string, selected: boolean): void {
    const sourceExists = sourceOptions.value.some((source) => source.sourceId === sourceId);
    if (!sourceExists) return;
    const ids = new Set(selectedSourceIds.value);
    if (selected) ids.add(sourceId);
    else ids.delete(sourceId);
    selectedSourceIds.value = [...ids];

    const retained = new Set(selectedSourceIds.value);
    entryDraft.value = {
      ...entryDraft.value,
      sourceRefs: entryDraft.value.sourceRefs.filter((id) => retained.has(id)),
    };
    if (selected && entryDraft.value.sourceRefs.length === 0) {
      entryDraft.value = { ...entryDraft.value, sourceRefs: [sourceId] };
    }
    participants.value = participants.value.map((participant) =>
      participant.characterSourceId && !retained.has(participant.characterSourceId)
        ? { ...participant, characterSourceId: '' }
        : participant);
    invalidatePreview();
  }

  function updateEntry(patch: Partial<PlayGuidedEntryDraft>): void {
    entryDraft.value = { ...entryDraft.value, ...patch };
    invalidatePreview();
  }

  function toggleEntrySource(sourceId: string, selected: boolean): void {
    const refs = new Set(entryDraft.value.sourceRefs);
    if (selected) refs.add(sourceId);
    else refs.delete(sourceId);
    updateEntry({ sourceRefs: [...refs] });
  }

  function updateIdentity(patch: Partial<PlayGuidedIdentityDraft>): void {
    identityDraft.value = { ...identityDraft.value, ...patch };
    invalidatePreview();
  }

  function addParticipant(): void {
    participants.value = [...participants.value, createParticipant()];
    announcement.value = `Participant added. ${participants.value.length} in the cast.`;
    invalidatePreview();
  }

  function removeParticipant(participantRef: string): void {
    participants.value = participants.value.filter(
      (participant) => participant.participantRef !== participantRef,
    );
    announcement.value = `Participant removed. ${participants.value.length} remain.`;
    invalidatePreview();
  }

  function updateParticipant(
    participantRef: string,
    patch: PlayGuidedParticipantPatch,
  ): void {
    participants.value = participants.value.map((participant) =>
      participant.participantRef === participantRef
        ? { ...participant, ...patch }
        : participant);
    invalidatePreview();
  }

  async function nextStep(): Promise<boolean> {
    if (currentStep.value === 'review') return false;
    validationVisible.value = {
      ...validationVisible.value,
      [currentStep.value]: true,
    };
    if (stepHasErrors(currentStep.value, rawErrors.value)) {
      announcement.value = validationMessage(currentStep.value);
      return false;
    }

    if (currentStep.value === 'cast') {
      return previewLaunchPackage();
    }

    const nextIndex = steps.indexOf(currentStep.value) + 1;
    currentStep.value = steps[nextIndex]!;
    announcement.value = stepAnnouncement(currentStep.value);
    return true;
  }

  function previousStep(): boolean {
    const currentIndex = steps.indexOf(currentStep.value);
    if (currentIndex <= 0) return false;
    if (currentStep.value === 'review') invalidatePreview();
    currentStep.value = steps[currentIndex - 1]!;
    announcement.value = stepAnnouncement(currentStep.value);
    return true;
  }

  async function previewLaunchPackage(): Promise<boolean> {
    previewing.value = true;
    requestError.value = undefined;
    announcement.value = 'Checking sources and preparing the launch preview.';
    try {
      const result = await options.api.previewPlayLaunchPackage(buildPreviewInput());
      preview.value = result.launchPackage;
      currentStep.value = 'review';
      announcement.value = 'Review. Step 5 of 5. Nothing has been created yet.';
      return true;
    } catch (error) {
      requestError.value = errorMessage(error, 'Launch preview failed.');
      announcement.value = requestError.value;
      return false;
    } finally {
      previewing.value = false;
    }
  }

  async function confirm(): Promise<PlaySession | undefined> {
    if (!canStart.value || !preview.value) {
      announcement.value = 'Resolve source errors before starting Play.';
      return undefined;
    }

    creating.value = true;
    requestError.value = undefined;
    announcement.value = 'Saving the reviewed launch package.';
    try {
      const storedResult = await options.api.createPlayLaunchPackage(preview.value);
      const storedPackage = storedResult.launchPackage;
      announcement.value = 'Launch package saved. Starting the Play session.';
      const sessionResult = await options.api.startPlaySessionFromLaunchPackage({
        launchPackageId: storedPackage.id,
      });
      const session = sessionResult.session;
      announcement.value = 'Play session created.';
      return session;
    } catch (error) {
      requestError.value = errorMessage(error, 'Play could not be started.');
      preview.value = undefined;
      currentStep.value = 'cast';
      announcement.value = `${requestError.value} Preview the Launch Package again before retrying.`;
      return undefined;
    } finally {
      creating.value = false;
    }
  }

  function reset(): void {
    participantSequence = 0;
    currentStep.value = 'sources';
    selectedSourceIds.value = [];
    entryDraft.value = createEntryDraft();
    identityDraft.value = createIdentityDraft();
    participants.value = purpose.value === 'sceneRehearsal' ? [createParticipant()] : [];
    validationVisible.value = {};
    preview.value = undefined;
    previewing.value = false;
    creating.value = false;
    requestError.value = undefined;
    announcement.value = 'Sources. Step 1 of 5.';
  }

  function invalidatePreview(): void {
    preview.value = undefined;
    requestError.value = undefined;
  }

  function buildPreviewInput(): PlayLaunchPackagePreviewInput {
    const providedAt = now();
    const entry = entryDraft.value;
    const authorValue = (value: string): PlayLaunchSceneValue | undefined => {
      const normalized = value.trim();
      return normalized
        ? {
            value: normalized,
            provenance: { kind: 'authorProvided', providedAt },
          }
        : undefined;
    };
    const selectedById = new Map(
      selectedSources.value.map((source) => [source.sourceId, source]),
    );

    return {
      createdAt: providedAt,
      title: entry.title.trim(),
      purpose: purpose.value,
      startMode: 'guided',
      simulationMode: entry.simulationMode,
      density: entry.density,
      sources: selectedSources.value.map((source) => ({
        sourceId: source.sourceId,
        path: source.path,
        role: source.role,
        reason: `Guided Start ${source.role} source`,
      })),
      entryPoint: {
        id: 'entry-guided-1',
        label: entry.label.trim(),
        opening: entry.opening.trim(),
        sourceRefs: [...entry.sourceRefs],
        ...optionalField('location', authorValue(entry.location)),
        ...optionalField('worldTime', authorValue(entry.worldTime)),
        ...optionalField('atmosphere', authorValue(entry.atmosphere)),
        ...optionalField('trigger', authorValue(entry.trigger)),
        ...optionalField('objective', authorValue(entry.objective)),
        ...optionalField('risk', authorValue(entry.risk)),
      },
      identity: purpose.value === 'sceneRehearsal'
        ? {
            kind: 'director',
            directorPurpose: identityDraft.value.directorPurpose.trim(),
          }
        : {
            kind: 'player',
            persona: identityDraft.value.persona.trim(),
          },
      participantRoles: participants.value.map((participant) => {
        const characterSource = selectedById.get(participant.characterSourceId);
        const sourceRefs = characterSource ? [characterSource.sourceId] : [];
        const knowledge = participant.initialKnowledge.trim();
        return {
          participantRef: participant.participantRef,
          displayName: participant.displayName.trim(),
          ...(characterSource?.objectId
            ? { canonicalCharacterRef: characterSource.objectId }
            : {}),
          sourceRefs,
          ...(participant.position.trim()
            ? { position: participant.position.trim() }
            : {}),
          ...(participant.currentGoal.trim()
            ? { currentGoal: participant.currentGoal.trim() }
            : {}),
          initialKnowledge: knowledge
            ? [{
                id: `${participant.participantRef}-knowledge-1`,
                fact: knowledge,
                visibility: participant.knowledgeVisibility,
                sourceRefs: [],
              }]
            : [],
        };
      }),
    };
  }

  return {
    currentStep: readonly(currentStep),
    stepNumber,
    sourceOptions,
    selectedSourceIds: readonly(selectedSourceIds),
    selectedSources,
    characterSources,
    entryDraft: readonly(entryDraft),
    identityDraft: readonly(identityDraft),
    participants: readonly(participants),
    errors,
    preview: readonly(preview),
    previewing: readonly(previewing),
    creating: readonly(creating),
    requestError: readonly(requestError),
    announcement: readonly(announcement),
    blockingDiagnostics,
    hasUnavailableSources,
    canStart,
    toggleSource,
    updateEntry,
    toggleEntrySource,
    updateIdentity,
    addParticipant,
    removeParticipant,
    updateParticipant,
    nextStep,
    previousStep,
    confirm,
    reset,
    buildPreviewInput,
  };
}

function createEntryDraft(): PlayGuidedEntryDraft {
  return {
    title: '',
    label: '',
    opening: '',
    sourceRefs: [],
    location: '',
    worldTime: '',
    atmosphere: '',
    trigger: '',
    objective: '',
    risk: '',
    simulationMode: 'reactiveWorld',
    density: 'balanced',
  };
}

function createIdentityDraft(): PlayGuidedIdentityDraft {
  return { persona: '', directorPurpose: '' };
}

function flattenFiles(tree: readonly FileTreeNode[]): PlayGuidedSourceOption[] {
  const files: PlayGuidedSourceOption[] = [];
  const visit = (nodes: readonly FileTreeNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'directory') {
        visit(node.children ?? []);
        continue;
      }
      const path = node.path.replaceAll('\\', '/').replace(/^\.\//u, '');
      const role = inferPlayLaunchSourceRole(path);
      const objectId = inferObjectId(path, role);
      files.push({
        sourceId: sourceIdForPath(path),
        name: node.name,
        path,
        role,
        ...(objectId ? { objectId } : {}),
      });
    }
  };
  visit(tree);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function inferPlayLaunchSourceRole(path: string): PlayLaunchSourceRole {
  const root = path.replaceAll('\\', '/').replace(/^\.\//u, '').split('/')[0];
  if (root === 'chapters') return 'chapter';
  if (root === 'characters') return 'character';
  if (root === 'world') return 'world';
  if (root === 'timeline') return 'timeline';
  if (root === 'state') return 'state';
  return 'other';
}

function inferObjectId(
  path: string,
  role: PlayLaunchSourceRole,
): string | undefined {
  const parts = path.split('/');
  if (role === 'other' || parts.length < 2) return undefined;
  if (role === 'character') return parts[1];
  const identity = parts.slice(1);
  identity[identity.length - 1] = identity.at(-1)!.replace(/\.[^.]+$/u, '');
  return identity.join('/');
}

function sourceIdForPath(path: string): string {
  const slug = path
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 150) || 'file';
  let hash = 2166136261;
  for (const character of path) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `source-${slug}-${(hash >>> 0).toString(36)}`;
}

function validateDraft(
  purpose: PlaySessionPurpose,
  selectedSourceIds: readonly string[],
  entry: PlayGuidedEntryDraft,
  identity: PlayGuidedIdentityDraft,
  participants: readonly PlayGuidedParticipantDraft[],
): PlayGuidedStartErrors {
  const participantErrors = Object.fromEntries(participants.flatMap((participant) => {
    const errors = {
      ...(!participant.displayName.trim()
        ? { displayName: 'Participant name is required.' }
        : {}),
      ...(!participant.currentGoal.trim()
        ? { currentGoal: 'Current goal is required.' }
        : {}),
    };
    return Object.keys(errors).length
      ? [[participant.participantRef, errors] as const]
      : [];
  }));
  return {
    ...(selectedSourceIds.length === 0
      ? { sources: 'Select at least one workspace file.' }
      : {}),
    ...(!entry.title.trim() ? { title: 'Session title is required.' } : {}),
    ...(!entry.label.trim() ? { label: 'Entry label is required.' } : {}),
    ...(!entry.opening.trim() ? { opening: 'Opening situation is required.' } : {}),
    ...(entry.sourceRefs.length === 0
      ? { entrySources: 'Choose at least one source for the entry point.' }
      : {}),
    ...(purpose === 'immersiveJourney' && !identity.persona.trim()
      ? { persona: 'Player persona is required.' }
      : {}),
    ...(purpose === 'sceneRehearsal' && !identity.directorPurpose.trim()
      ? { directorPurpose: 'Director purpose is required.' }
      : {}),
    ...(purpose === 'sceneRehearsal' && participants.length === 0
      ? { cast: 'Scene Rehearsal requires at least one participant.' }
      : {}),
    ...(Object.keys(participantErrors).length > 0
      ? { participants: participantErrors }
      : {}),
  };
}

function errorsForStep(
  step: PlayGuidedStartStep,
  errors: PlayGuidedStartErrors,
): PlayGuidedStartErrors {
  if (step === 'sources') return { sources: errors.sources };
  if (step === 'entry') {
    return {
      title: errors.title,
      label: errors.label,
      opening: errors.opening,
      entrySources: errors.entrySources,
    };
  }
  if (step === 'identity') {
    return {
      persona: errors.persona,
      directorPurpose: errors.directorPurpose,
    };
  }
  if (step === 'cast') {
    return { cast: errors.cast, participants: errors.participants };
  }
  return {};
}

function stepHasErrors(
  step: PlayGuidedStartStep,
  errors: PlayGuidedStartErrors,
): boolean {
  return Object.values(errorsForStep(step, errors)).some(Boolean);
}

function validationMessage(step: PlayGuidedStartStep): string {
  if (step === 'sources') return 'Select at least one source before continuing.';
  if (step === 'entry') return 'Complete the required Entry fields before continuing.';
  if (step === 'identity') return 'Complete the Play identity before continuing.';
  return 'Complete the required Cast fields before continuing.';
}

function stepAnnouncement(step: PlayGuidedStartStep): string {
  const labels: Record<PlayGuidedStartStep, string> = {
    sources: 'Sources',
    entry: 'Entry',
    identity: 'Identity',
    cast: 'Cast',
    review: 'Review',
  };
  return `${labels[step]}. Step ${steps.indexOf(step) + 1} of 5.`;
}

function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : { [key]: value } as Record<Key, Value>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
