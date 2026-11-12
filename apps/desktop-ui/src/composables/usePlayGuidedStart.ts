import {
  computed,
  readonly,
  onScopeDispose,
  getCurrentScope,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
} from 'vue';

import type { PlayOriginWork, PlayCrossoverContract } from '@oh-awesome-novel/client';
import { collectPlayOriginWorks, normalizePlayCrossoverContract } from '@oh-awesome-novel/core/play-crossover';
import type { OanClient } from '@oh-awesome-novel/client';
import { normalizePlayIsoWorldTime } from '@oh-awesome-novel/client';

import type {
  FileTreeNode,
  PlayCanonBeatCandidate,
  PlayEventDensity,
  PlayEventVisibility,
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlayLaunchReuseSeed,
  PlayLaunchReuseSourceCheck,
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
  | 'crossover'
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
> & Partial<Pick<OanClient, 'listPlayCanonBeatCandidates' | 'listReferences' | 'listReferenceMaterialAdoptionRecords'>>;

export const MAX_GUIDED_CANON_BEATS = 24;

/** One canon beat the author ticked from a timeline source or typed by hand. */
export interface PlayGuidedCanonBeatDraft {
  key: string;
  label: string;
  expectedWhen: string;
  /** Set for a beat picked from a timeline source; its quote is verbatim source text. */
  sourceId?: string;
  quote?: string;
}

export interface PlayGuidedCanonCandidates {
  sourceId: string;
  path: string;
  loading: boolean;
  error?: string;
  candidates: readonly Readonly<PlayCanonBeatCandidate>[];
}

export interface PlayGuidedSourceOption {
  originWork?: PlayOriginWork;
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
  worldTimeFormat?: 'narrative' | 'iso8601';
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
  crossover?: string;
  title?: string;
  label?: string;
  opening?: string;
  entrySources?: string;
  worldTime?: string;
  persona?: string;
  directorPurpose?: string;
  cast?: string;
  participants?: Record<string, { displayName?: string; currentGoal?: string }>;
}

export type PlayGuidedReuseSeed = Extract<PlayLaunchReuseSeed, { kind: 'guided' }>;

/** A reused source whose current file no longer matches the frozen opening. */
export interface PlayGuidedReuseCheck {
  sourceId: string;
  path: string;
  status: Exclude<PlayLaunchReuseSourceCheck['status'], 'unchanged'>;
  /** False once the author removed it, or when it can no longer be selected. */
  selected: boolean;
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
  const canonBeats = shallowRef<PlayGuidedCanonBeatDraft[]>([]);
  const protagonistKnowsCanon = shallowRef(true);
  const canonCandidates = shallowRef<Record<string, PlayGuidedCanonCandidates>>({});
  let canonBeatSequence = 0;
  const reuseSourceTitle = shallowRef<string>();
  const reuseProblems = shallowRef<Array<Omit<PlayGuidedReuseCheck, 'selected'>>>([]);

  const sourceWorks = shallowRef<Record<string, PlayOriginWork>>({});
  const crossoverDraft = shallowRef<Omit<PlayCrossoverContract, 'works'>>({ fusion: 'merged', knowledge: 'isolated', rulePrecedence: [] });
  const originSuggestionNotice = shallowRef('');
  const originSuggestionsLoading = shallowRef(false);
  let originRequest = 0;
  if (getCurrentScope()) onScopeDispose(() => { originRequest++; });
  const sourceOptions = computed(() => flattenFiles(toValue(options.tree)).map(source => ({ ...source, ...(sourceWorks.value[source.sourceId] ? { originWork: sourceWorks.value[source.sourceId] } : {}) })));
  const selectedSources = computed(() => {
    const ids = new Set(selectedSourceIds.value);
    return sourceOptions.value.filter((source) => ids.has(source.sourceId));
  });
  const crossoverWorks = computed(() => collectPlayOriginWorks(selectedSources.value));
  const hasCrossover = computed(() => crossoverWorks.value.length >= 2);
  const activeSteps = computed<readonly PlayGuidedStartStep[]>(() => hasCrossover.value ? ['sources', 'crossover', 'entry', 'identity', 'cast', 'review'] : steps);
  const crossoverError = computed(() => {
    if (!hasCrossover.value) return undefined;
    try { normalizePlayCrossoverContract({ ...crossoverDraft.value, works: crossoverWorks.value }); return undefined; }
    catch (error) { return error instanceof Error ? error.message : '请检查融合契约。'; }
  });
  function setSourceWork(sourceId: string, titleValue: string, suggested?: PlayOriginWork): void {
    if (creating.value || previewing.value) return;
    const title = titleValue.trim().slice(0, 120);
    const next = { ...sourceWorks.value };
    if (!title) delete next[sourceId];
    else next[sourceId] = Object.values(next).find(work => work.title === title) ?? suggested ?? { id: `work-${crypto.randomUUID()}`, title };
    sourceWorks.value = next;
    const ids = new Set(crossoverWorks.value.map(work => work.id));
    crossoverDraft.value = { ...crossoverDraft.value, rulePrecedence: crossoverDraft.value.rulePrecedence.filter(rule => ids.has(rule.winner)) };
    invalidatePreview();
  }
  function updateCrossover(patch: Partial<Omit<PlayCrossoverContract, 'works'>>): void {
    if (creating.value || previewing.value) return;
    crossoverDraft.value = { ...crossoverDraft.value, ...patch }; invalidatePreview();
  }
  async function prefillSourceWorks(): Promise<void> {
    if (!options.api.listReferences || !options.api.listReferenceMaterialAdoptionRecords || originSuggestionsLoading.value) return;
    const epoch = ++originRequest; const selected = [...selectedSources.value];
    originSuggestionsLoading.value = true; originSuggestionNotice.value = '';
    const startingWorks = { ...sourceWorks.value };
    try {
      const references = (await options.api.listReferences()).references.slice(0, 32);
      const matches = new Map<string, PlayOriginWork[]>();
      for (const reference of references) {
        if (epoch !== originRequest) return;
        try {
          const records = await options.api.listReferenceMaterialAdoptionRecords(reference.id);
          for (const source of selected) if (records.records.some(record => record.status === 'accepted' && record.targets.some(target => target.path === source.path && target.operation !== 'delete'))) {
            matches.set(source.sourceId, [...matches.get(source.sourceId) ?? [], { id: sourceIdForPath(`reference-${reference.id}`), title: reference.title }]);
          }
        } catch { /* Unpublished/cleared reference data cannot establish provenance. */ }
      }
      if (epoch !== originRequest) return;
      let count = 0;
      for (const [id, works] of matches) if (works.length === 1 && !startingWorks[id] && !sourceWorks.value[id] && selectedSourceIds.value.includes(id)) {
        setSourceWork(id, works[0]!.title, works[0]); count++;
      }
      originSuggestionNotice.value = `已预填 ${count} 个来源，请检查作品名称后继续；无记录或有多个出处的来源需手动标注。仅检查仍保留记录的前 32 部参考作品。`;
    } catch { if (epoch === originRequest) originSuggestionNotice.value = '采用记录暂时不可用，可以直接手动标注。'; }
    finally { if (epoch === originRequest) originSuggestionsLoading.value = false; }
  }
  const characterSources = computed(() =>
    selectedSources.value.filter((source) => source.role === 'character'));
  const timelineSources = computed(() =>
    selectedSources.value.filter((source) => source.role === 'timeline'));
  const canonBeatLimitReached = computed(() =>
    canonBeats.value.length >= MAX_GUIDED_CANON_BEATS);
  const rawErrors = computed(() => validateDraft(
    purpose.value,
    selectedSourceIds.value,
    entryDraft.value,
    identityDraft.value,
    participants.value,
  ));
  const errors = computed<PlayGuidedStartErrors>(() => {
    if (!validationVisible.value[currentStep.value]) return {};
    return currentStep.value === 'crossover' ? { crossover: crossoverError.value } : errorsForStep(currentStep.value, rawErrors.value);
  });
  const stepNumber = computed(() => activeSteps.value.indexOf(currentStep.value) + 1);
  const reuseChecks = computed<PlayGuidedReuseCheck[]>(() => {
    const selected = new Set(selectedSources.value.map((source) => source.sourceId));
    return reuseProblems.value.map((check) => ({
      ...check,
      selected: selected.has(check.sourceId),
    }));
  });
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
    // A beat cannot outlive the timeline source its quote came from.
    canonBeats.value = canonBeats.value.filter((beat) =>
      beat.sourceId === undefined || retained.has(beat.sourceId));
    invalidatePreview();
  }

  /** Reads the verbatim beats one selected timeline source offers. Read-only. */
  async function loadCanonCandidates(sourceId: string): Promise<void> {
    const source = timelineSources.value.find((item) => item.sourceId === sourceId);
    if (!source || !options.api.listPlayCanonBeatCandidates) return;
    const set = (patch: Partial<PlayGuidedCanonCandidates>): void => {
      canonCandidates.value = {
        ...canonCandidates.value,
        [sourceId]: {
          sourceId,
          path: source.path,
          loading: false,
          candidates: canonCandidates.value[sourceId]?.candidates ?? [],
          ...patch,
        },
      };
    };
    set({ loading: true, error: undefined });
    try {
      const result = await options.api.listPlayCanonBeatCandidates(source.path);
      set({ candidates: result.candidates });
    } catch (error) {
      set({ error: errorMessage(error, '无法读取这个时间线来源。') });
    }
  }

  function isCanonCandidateSelected(sourceId: string, quote: string): boolean {
    return canonBeats.value.some((beat) => beat.sourceId === sourceId && beat.quote === quote);
  }

  function toggleCanonCandidate(
    sourceId: string,
    candidate: PlayCanonBeatCandidate,
    selected: boolean,
  ): void {
    if (!selected) {
      canonBeats.value = canonBeats.value.filter((beat) =>
        beat.sourceId !== sourceId || beat.quote !== candidate.quote);
    } else if (!canonBeatLimitReached.value && !isCanonCandidateSelected(sourceId, candidate.quote)) {
      canonBeatSequence += 1;
      canonBeats.value = [...canonBeats.value, {
        key: `canon-draft-${canonBeatSequence}`,
        label: candidate.label,
        expectedWhen: candidate.expectedWhen ?? '',
        sourceId,
        quote: candidate.quote,
      }];
    }
    invalidatePreview();
  }

  /** A hand-written beat has no source quote and is marked author-provided. */
  function addManualCanonBeat(label: string, expectedWhen = ''): boolean {
    const text = label.trim();
    if (!text || canonBeatLimitReached.value) return false;
    canonBeatSequence += 1;
    canonBeats.value = [...canonBeats.value, {
      key: `canon-draft-${canonBeatSequence}`,
      label: text.slice(0, 200),
      expectedWhen: expectedWhen.trim().slice(0, 120),
    }];
    invalidatePreview();
    return true;
  }

  function removeCanonBeat(key: string): void {
    canonBeats.value = canonBeats.value.filter((beat) => beat.key !== key);
    invalidatePreview();
  }

  function setProtagonistKnowsCanon(value: boolean): void {
    protagonistKnowsCanon.value = value;
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
    announcement.value = `已添加参与者，现在共 ${participants.value.length} 人。`;
    invalidatePreview();
  }

  function removeParticipant(participantRef: string): void {
    participants.value = participants.value.filter(
      (participant) => participant.participantRef !== participantRef,
    );
    announcement.value = `已移除参与者，还剩 ${participants.value.length} 人。`;
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
    if (currentStep.value === 'review' || originSuggestionsLoading.value) return false;
    validationVisible.value = {
      ...validationVisible.value,
      [currentStep.value]: true,
    };
    if (currentStep.value === 'crossover' && crossoverError.value || stepHasErrors(currentStep.value, rawErrors.value)) {
      announcement.value = validationMessage(currentStep.value);
      return false;
    }

    if (currentStep.value === 'cast') {
      return previewLaunchPackage();
    }

    const nextIndex = activeSteps.value.indexOf(currentStep.value) + 1;
    currentStep.value = activeSteps.value[nextIndex]!;
    announcement.value = stepAnnouncement(currentStep.value);
    return true;
  }

  function previousStep(): boolean {
    const currentIndex = activeSteps.value.indexOf(currentStep.value);
    if (currentIndex <= 0) return false;
    if (currentStep.value === 'review') invalidatePreview();
    currentStep.value = activeSteps.value[currentIndex - 1]!;
    announcement.value = stepAnnouncement(currentStep.value);
    return true;
  }

  async function previewLaunchPackage(): Promise<boolean> {
    previewing.value = true;
    requestError.value = undefined;
    announcement.value = '正在核对来源并准备开局预览。';
    try {
      const result = await options.api.previewPlayLaunchPackage(buildPreviewInput());
      preview.value = result.launchPackage;
      currentStep.value = 'review';
      announcement.value = '确认。第 5 / 5 步。还没有创建任何内容。';
      return true;
    } catch (error) {
      requestError.value = errorMessage(error, '开局预览失败。');
      announcement.value = requestError.value;
      return false;
    } finally {
      previewing.value = false;
    }
  }

  async function confirm(): Promise<PlaySession | undefined> {
    if (!canStart.value || !preview.value) {
      announcement.value = '请先处理来源错误再开始推演。';
      return undefined;
    }

    creating.value = true;
    requestError.value = undefined;
    announcement.value = '正在保存已确认的开局包。';
    try {
      const storedResult = await options.api.createPlayLaunchPackage(preview.value);
      const storedPackage = storedResult.launchPackage;
      announcement.value = '开局包已保存，正在开始推演。';
      const sessionResult = await options.api.startPlaySessionFromLaunchPackage({
        launchPackageId: storedPackage.id,
      });
      const session = sessionResult.session;
      announcement.value = '推演会话已创建。';
      return session;
    } catch (error) {
      requestError.value = errorMessage(error, '无法开始推演。');
      preview.value = undefined;
      currentStep.value = 'cast';
      announcement.value = `${requestError.value} 请重新预览开局包后再试。`;
      return undefined;
    } finally {
      creating.value = false;
    }
  }

  /**
   * Prefills every step from another session's frozen opening. Source ids are
   * re-derived from paths, so the new launch shares nothing with the old setup.
   * Missing files cannot be selected and are dropped; changed files stay
   * selected (the new opening freezes their current content) until removed.
   */
  function applySeed(seed: PlayGuidedReuseSeed): void {
    const launch = seed.launch;
    const checks = new Map(seed.sources.map((check) => [check.sourceId, check]));
    const idByOldId = new Map<string, string>();
    for (const source of launch.sources) {
      if (checks.get(source.sourceId)?.status === 'missing') continue;
      idByOldId.set(source.sourceId, sourceIdForPath(normalizeTreePath(source.path)));
    }
    const remap = (refs: readonly string[]): string[] =>
      refs.flatMap((ref) => idByOldId.get(ref) ?? []);
    const entry = launch.entryPoint;
    const worldTime = entry.worldTime?.value ?? '';

    selectedSourceIds.value = [...new Set(idByOldId.values())];
    sourceWorks.value = Object.fromEntries(launch.sources.flatMap(source => source.originWork && idByOldId.has(source.sourceId) ? [[idByOldId.get(source.sourceId)!, structuredClone(source.originWork)]] : []));
    if (launch.crossover) {
      const { works: _works, ...contract } = structuredClone(launch.crossover); crossoverDraft.value = contract;
    }
    entryDraft.value = {
      title: launch.title,
      label: entry.label,
      opening: entry.opening,
      sourceRefs: remap(entry.sourceRefs),
      location: entry.location?.value ?? '',
      worldTime,
      worldTimeFormat: worldTime && normalizePlayIsoWorldTime(worldTime)
        ? 'iso8601'
        : 'narrative',
      atmosphere: entry.atmosphere?.value ?? '',
      trigger: entry.trigger?.value ?? '',
      objective: entry.objective?.value ?? '',
      risk: entry.risk?.value ?? '',
      simulationMode: launch.simulationMode,
      density: launch.density,
    };
    identityDraft.value = {
      persona: launch.identity.persona ?? '',
      directorPurpose: launch.identity.directorPurpose ?? '',
    };
    participantSequence = launch.participantRoles.length;
    participants.value = launch.participantRoles.map((participant, index) => ({
      participantRef: options.createParticipantRef?.(index + 1)
        ?? `participant-${index + 1}`,
      displayName: participant.displayName,
      characterSourceId: remap(participant.sourceRefs).find((id) =>
        launch.sources.some((source) =>
          source.role === 'character' && idByOldId.get(source.sourceId) === id)) ?? '',
      position: participant.position ?? '',
      currentGoal: participant.currentGoal ?? '',
      initialKnowledge: participant.initialKnowledge
        .map((knowledge) => knowledge.fact)
        .join('\n'),
      knowledgeVisibility: participant.initialKnowledge[0]?.visibility
        ?? 'playerUnknown',
    }));
    canonBeatSequence = 0;
    protagonistKnowsCanon.value = launch.canonBeats?.protagonistKnowsCanon ?? true;
    canonBeats.value = (launch.canonBeats?.beats ?? []).flatMap((beat) => {
      const sourceId = beat.source.kind === 'sourceBacked'
        ? idByOldId.get(beat.source.sourceId)
        : undefined;
      // A beat whose timeline file is gone cannot keep a verifiable quote.
      if (beat.source.kind === 'sourceBacked' && !sourceId) return [];
      canonBeatSequence += 1;
      return [{
        key: `canon-draft-${canonBeatSequence}`,
        label: beat.label,
        expectedWhen: beat.expectedWhen ?? '',
        ...(beat.source.kind === 'sourceBacked'
          ? { sourceId, quote: beat.source.quote }
          : {}),
      }];
    });
    reuseSourceTitle.value = seed.sourceSessionTitle;
    reuseProblems.value = seed.sources.flatMap((check) =>
      check.status === 'unchanged'
        ? []
        : [{
            sourceId: idByOldId.get(check.sourceId) ?? check.sourceId,
            path: check.path,
            status: check.status,
          }]);
    currentStep.value = 'sources';
    validationVisible.value = {};
    invalidatePreview();
    announcement.value = reuseProblems.value.length
      ? `已用「${seed.sourceSessionTitle}」的开局预填，有 ${reuseProblems.value.length} 个来源与当时不同，请先确认。`
      : `已用「${seed.sourceSessionTitle}」的开局预填。`;
  }

  /**
   * With an unchanged opening the author can create straight away: this skips
   * to Review through the same validation and preview as walking the steps.
   */
  async function previewSeededLaunch(): Promise<boolean> {
    if (
      !reuseSourceTitle.value ||
      reuseProblems.value.length > 0 ||
      selectedSources.value.length !== selectedSourceIds.value.length ||
      Object.values(rawErrors.value).some(Boolean)
    ) return false;
    return previewLaunchPackage();
  }

  function reset(): void {
    originRequest++; sourceWorks.value = {}; crossoverDraft.value = { fusion: 'merged', knowledge: 'isolated', rulePrecedence: [] };
    originSuggestionsLoading.value = false; originSuggestionNotice.value = '';
    canonBeats.value = [];
    canonCandidates.value = {};
    protagonistKnowsCanon.value = true;
    canonBeatSequence = 0;
    reuseSourceTitle.value = undefined;
    reuseProblems.value = [];
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
        ...(source.originWork ? { originWork: { ...source.originWork } } : {}),
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
      ...(hasCrossover.value ? { crossover: { ...structuredClone(crossoverDraft.value), works: structuredClone(crossoverWorks.value) } } : {}),
      // Absent unless the author picked beats, so other launches are unchanged.
      ...(purpose.value === 'immersiveJourney' && canonBeats.value.length
        ? {
            canonBeats: {
              protagonistKnowsCanon: protagonistKnowsCanon.value,
              beats: canonBeats.value.map((beat) => ({
                label: beat.label,
                ...(beat.expectedWhen ? { expectedWhen: beat.expectedWhen } : {}),
                source: beat.sourceId && beat.quote
                  ? { kind: 'sourceBacked' as const, sourceId: beat.sourceId, quote: beat.quote }
                  : { kind: 'authorProvided' as const },
              })),
            },
          }
        : {}),
    };
  }

  return {
    currentStep: readonly(currentStep),
    activeSteps, hasCrossover, crossoverWorks, crossoverDraft: readonly(crossoverDraft), setSourceWork, updateCrossover, prefillSourceWorks,
    originSuggestionsLoading: readonly(originSuggestionsLoading), originSuggestionNotice: readonly(originSuggestionNotice),
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
    timelineSources,
    canonBeats: readonly(canonBeats),
    canonCandidates: readonly(canonCandidates),
    canonBeatLimitReached,
    protagonistKnowsCanon: readonly(protagonistKnowsCanon),
    loadCanonCandidates,
    isCanonCandidateSelected,
    toggleCanonCandidate,
    addManualCanonBeat,
    removeCanonBeat,
    setProtagonistKnowsCanon,
    reuseSourceTitle: readonly(reuseSourceTitle),
    reuseChecks,
    applySeed,
    previewSeededLaunch,
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
    worldTimeFormat: 'narrative',
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
      const path = normalizeTreePath(node.path);
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

function normalizeTreePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
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
        ? { displayName: '请填写参与者名字。' }
        : {}),
      ...(!participant.currentGoal.trim()
        ? { currentGoal: '请填写当前目标。' }
        : {}),
    };
    return Object.keys(errors).length
      ? [[participant.participantRef, errors] as const]
      : [];
  }));
  return {
    ...(selectedSourceIds.length === 0
      ? { sources: '请至少选择一个工作区文件。' }
      : {}),
    ...(!entry.title.trim() ? { title: '请填写会话标题。' } : {}),
    ...(!entry.label.trim() ? { label: '请填写入场点名称。' } : {}),
    ...(!entry.opening.trim() ? { opening: '请填写开场情境。' } : {}),
    ...(entry.worldTimeFormat === 'iso8601' && !normalizePlayIsoWorldTime(entry.worldTime.trim())
      ? { worldTime: '请输入带时区的有效日期时间，例如 2026-10-07T09:00:00+08:00。' }
      : {}),
    ...(entry.sourceRefs.length === 0
      ? { entrySources: '请为入场点至少选择一个来源。' }
      : {}),
    ...(purpose === 'immersiveJourney' && !identity.persona.trim()
      ? { persona: '请填写参与者身份。' }
      : {}),
    ...(purpose === 'sceneRehearsal' && !identity.directorPurpose.trim()
      ? { directorPurpose: '请填写试演目的。' }
      : {}),
    ...(purpose === 'sceneRehearsal' && participants.length === 0
      ? { cast: '场景试演至少需要一名参与者。' }
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
      worldTime: errors.worldTime,
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
  if (step === 'sources') return '请至少选择一个来源再继续。';
  if (step === 'entry') return '请先填写入场的必填项。';
  if (step === 'identity') return '请先填写身份。';
  return '请先填写人物的必填项。';
}

function stepAnnouncement(step: PlayGuidedStartStep): string {
  const labels: Record<PlayGuidedStartStep, string> = {
    sources: 'Sources',
    crossover: '融合契约',
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
