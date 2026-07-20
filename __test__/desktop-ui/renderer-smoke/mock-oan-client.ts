import type {
  NarrativeBlock,
  OanClient,
  PlayDirectorInterventionInput,
  PlayEventPresentationEvidence,
  PlaySessionSelectedDetail,
  PlaySessionSummary,
  PlayTranscriptTurn,
  PlayTurnAttempt,
  PlayWorldEvent,
} from '@oh-awesome-novel/client';

interface RendererSmokeCall {
  method: string;
  args: unknown[];
}

export const rendererSmokeState = {
  ready: false,
  calls: [] as RendererSmokeCall[],
  errors: [] as string[],
  unexpectedCalls: [] as string[],
};

const JOURNEY_ID = 'play-long-journey';
const REHEARSAL_ID = 'play-scene-rehearsal';
const ATTEMPT_ID = 'attempt-renderer-smoke';

const rehearsalSummary: PlaySessionSummary = {
  schemaVersion: 5,
  id: REHEARSAL_ID,
  title: 'Last train character rehearsal',
  createdAt: '2026-07-20T11:00:00.000Z',
  latestActivityAt: '2026-07-20T12:00:00.000Z',
  revision: 0,
  purpose: 'sceneRehearsal',
  startMode: 'guided',
  selectedTurnCount: 0,
  transcriptCount: 0,
  eventCount: 0,
  worldClock: { turn: 0, revision: 0, anchor: '23:50' },
  canonical: false,
};

const journeySummary: PlaySessionSummary = {
  schemaVersion: 4,
  id: JOURNEY_ID,
  title: 'Long-running station journey',
  createdAt: '2026-07-20T00:00:00.000Z',
  latestActivityAt: '2026-07-20T10:00:00.000Z',
  revision: 4,
  purpose: 'immersiveJourney',
  startMode: 'guided',
  selectedArtifactId: 'turn-4',
  selectedTurnCount: 4,
  transcriptCount: 4,
  eventCount: 4,
  worldClock: { turn: 4, revision: 4, anchor: '23:54' },
  canonical: false,
};

// Start on the non-blocking journey so the smoke can exercise summary
// selection into an active rehearsal after verifying both M5 cursor windows.
const summaries = [journeySummary, rehearsalSummary];

let activeAttempt = createDraftAttempt();

const methods = {
  async listPlaySessionSummaries() {
    record('listPlaySessionSummaries', []);
    return { summaries: structuredClone(summaries) };
  },

  async getPlaySessionDetail(
    id: string,
    options: {
      limit?: number;
      transcriptCursor?: string;
      eventCursor?: string;
    } = {},
  ) {
    record('getPlaySessionDetail', [id, options]);
    if (id === REHEARSAL_ID) return { detail: rehearsalDetail() };
    if (id !== JOURNEY_ID) throw new Error(`Unknown smoke Play session: ${id}`);
    if (options.transcriptCursor) return { detail: earlierTranscriptDetail() };
    if (options.eventCursor) return { detail: earlierEventDetail() };
    return { detail: latestJourneyDetail() };
  },

  async listPlayContextTraces(id: string, options: { limit?: number } = {}) {
    record('listPlayContextTraces', [id, options]);
    if (id !== JOURNEY_ID) return { traces: [] };
    return {
      traces: [{
        schemaVersion: 1 as const,
        sessionId: JOURNEY_ID,
        sessionRevision: 4,
        artifactId: 'turn-4',
        createdAt: '2026-07-20T10:00:00.000Z',
        transcriptWindow: {
          kind: 'transcript' as const,
          availableCount: 4,
          selectedCount: 2,
          selectedIds: ['message-3', 'message-4'],
          omittedCount: 2,
          limit: 2,
          omissionReason: 'windowLimit' as const,
        },
        eventWindow: {
          kind: 'event' as const,
          availableCount: 4,
          selectedCount: 2,
          selectedIds: ['event-3', 'event-4'],
          omittedCount: 2,
          limit: 2,
          omissionReason: 'windowLimit' as const,
        },
        sources: [{
          sourceId: 'source-station',
          path: 'world/station.md',
          role: 'world' as const,
          trust: 'canonical' as const,
          budgetLayer: 'L1' as const,
          semanticBoundary: 'protected' as const,
          expectedContentHash: 'aaaaaaaaaaaaaaaa',
          actualContentHash: 'bbbbbbbbbbbbbbbb',
          driftState: 'changed' as const,
          outcome: 'omitted' as const,
          omissionReason: 'canonicalDrift' as const,
        }],
        canonical: false as const,
      }],
    };
  },

  async getPlaySourceDrift(id: string) {
    record('getPlaySourceDrift', [id]);
    if (id !== JOURNEY_ID) {
      return {
        status: {
          sessionId: id,
          sessionRevision: 0,
          overall: 'current' as const,
          sources: [],
          availableDecisions: [],
          canonical: false as const,
        },
      };
    }
    return {
      status: {
        sessionId: JOURNEY_ID,
        sessionRevision: 4,
        overall: 'drifted' as const,
        sources: [{
          sourceId: 'source-station',
          path: 'world/station.md',
          expectedContentHash: 'aaaaaaaaaaaaaaaa',
          actualContentHash: 'bbbbbbbbbbbbbbbb',
          state: 'changed' as const,
        }],
        availableDecisions: ['continueFrozen', 'reassemble', 'fork'] as const,
        canonical: false as const,
      },
    };
  },

  async listPlayCheckpoints(id: string) {
    record('listPlayCheckpoints', [id]);
    return { checkpoints: [] };
  },

  async getPlayOutcomeReport(id: string, options: unknown) {
    record('getPlayOutcomeReport', [id, options]);
    throw Object.assign(new Error('No smoke Outcome Report'), { status: 404 });
  },

  async listPlayWritingReferenceAttachments() {
    record('listPlayWritingReferenceAttachments', []);
    return { attachments: [] };
  },

  async getActivePlayRehearsalAttempt(id: string) {
    record('getActivePlayRehearsalAttempt', [id]);
    return {
      attempt: id === REHEARSAL_ID ? structuredClone(activeAttempt) : null,
    };
  },

  async getPlaySceneMemory(id: string, lens: 'player' | 'director') {
    record('getPlaySceneMemory', [id, lens]);
    return { memory: null };
  },

  async intervenePlayTurnAttempt(
    sessionId: string,
    attemptId: string,
    input: PlayDirectorInterventionInput,
  ) {
    record('intervenePlayTurnAttempt', [sessionId, attemptId, input]);
    if (
      sessionId !== REHEARSAL_ID ||
      attemptId !== ATTEMPT_ID ||
      input.kind !== 'reviseProjection'
    ) {
      throw Object.assign(new Error('Unexpected smoke intervention'), { status: 422 });
    }
    const previous = activeAttempt;
    const sourceStep = previous.steps.find((step) => step.id === input.stepRef)!;
    const replacementStep = {
      ...sourceStep,
      id: 'step-mara-revised',
      status: 'draft' as const,
      narrativeBlocks: structuredClone(input.replacementBlocks),
    };
    const receipt = {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: 'renderer-smoke-revise-fingerprint',
      resultingAttemptRevision: previous.attemptRevision + 1,
      resultRef: replacementStep.id,
      responseDigest: 'renderer-smoke-revise-digest',
    };
    activeAttempt = {
      ...previous,
      attemptRevision: previous.attemptRevision + 1,
      currentStepRef: replacementStep.id,
      steps: [
        ...previous.steps.map((step) => step.id === sourceStep.id
          ? { ...step, status: 'superseded' as const }
          : step),
        replacementStep,
      ],
      interventions: [
        ...(previous.interventions ?? []),
        {
          schemaVersion: 1,
          id: 'intervention-revise-1',
          attemptId: ATTEMPT_ID,
          attemptRevision: previous.attemptRevision + 1,
          createdAt: '2026-07-20T11:06:00.000Z',
          provenance: { actor: 'user' as const, source: 'directorControl' as const },
          kind: 'reviseProjection' as const,
          stepRef: sourceStep.id,
          replacementStepRef: replacementStep.id,
          replacementBlocks: structuredClone(input.replacementBlocks),
          expectedEffectFingerprint: input.expectedEffectFingerprint,
          supersededStepRefs: [sourceStep.id],
        },
      ],
      mutationReceipts: [...(previous.mutationReceipts ?? []), receipt],
    };
    return {
      attempt: structuredClone(activeAttempt),
      receipt,
      replayed: false,
    };
  },
} satisfies Partial<OanClient>;

export const oanClient = new Proxy(methods, {
  get(target, property, receiver) {
    if (typeof property !== 'string' || property in target) {
      return Reflect.get(target, property, receiver);
    }
    return (...args: unknown[]) => {
      rendererSmokeState.unexpectedCalls.push(property);
      record(property, args);
      return Promise.reject(new Error(`Unexpected renderer smoke client call: ${property}`));
    };
  },
}) as unknown as OanClient;

function record(method: string, args: unknown[]): void {
  rendererSmokeState.calls.push({
    method,
    args: structuredClone(args),
  });
}

function latestJourneyDetail(): PlaySessionSelectedDetail {
  return journeyDetail({
    transcript: {
      items: [
        message('message-3', 'latest message 3', '2026-07-20T00:03:00.000Z'),
        message('message-4', 'latest message 4', '2026-07-20T00:04:00.000Z'),
      ],
      totalCount: 4,
      hasMoreBefore: true,
      nextCursor: 'transcript-before-latest',
    },
    events: {
      items: [event(3, 'Latest event 3'), event(4, 'Latest event 4')],
      totalCount: 4,
      hasMoreBefore: true,
      nextCursor: 'events-before-latest',
    },
  });
}

function earlierTranscriptDetail(): PlaySessionSelectedDetail {
  const current = latestJourneyDetail();
  return {
    ...current,
    transcript: {
      items: [
        message('message-1', 'earlier message 1', '2026-07-20T00:01:00.000Z'),
        message('message-2', 'earlier message 2', '2026-07-20T00:02:00.000Z'),
      ],
      totalCount: 4,
      hasMoreBefore: false,
    },
  };
}

function earlierEventDetail(): PlaySessionSelectedDetail {
  const current = latestJourneyDetail();
  const items = [event(1, 'Earlier event 1'), event(2, 'Earlier event 2')];
  return {
    ...current,
    events: {
      items,
      totalCount: 4,
      hasMoreBefore: false,
    },
    eventPresentation: items.map(eventPresentation),
  };
}

function journeyDetail(
  windows: Pick<PlaySessionSelectedDetail, 'transcript' | 'events'>,
): PlaySessionSelectedDetail {
  const summary = journeySummary;
  return {
    summary,
    snapshot: {
      schemaVersion: 4,
      id: JOURNEY_ID,
      title: summary.title,
      createdAt: summary.createdAt,
      revision: summary.revision,
      sceneStart: 'Rain crosses the station roof.',
      characters: ['Mara', 'Ivo'],
      selectedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4'],
      branchSnapshotRequiredFromRevision: 0,
      metadataExtensions: {},
      playLocalState: {},
      playLocalStateVisibility: {},
      worldClock: summary.worldClock,
      eventPolicy: eventPolicy(),
      scheduledEvents: [],
      suggestedActions: [],
      activatedSources: [{
        sourceId: 'source-station',
        path: 'world/station.md',
        contentHash: 'aaaaaaaaaaaaaaaa',
        role: 'world',
        reason: 'Station world truth',
        budgetLayer: 'L1',
        semanticBoundary: 'protected',
        trust: 'canonical',
      }],
      observations: [],
      adoptionCandidates: [],
    },
    ...windows,
    eventPresentation: windows.events.items.map(eventPresentation),
    selectedArtifactPresentation: {
      id: 'turn-4',
      revision: 4,
      eventIds: ['event-4'],
      stateDelta: {},
      playLocalStateVisibilitySnapshot: {},
      canonical: false,
    },
  };
}

function rehearsalDetail(): PlaySessionSelectedDetail {
  const summary = rehearsalSummary;
  return {
    summary,
    snapshot: {
      schemaVersion: 5,
      id: REHEARSAL_ID,
      title: summary.title,
      createdAt: summary.createdAt,
      revision: summary.revision,
      sceneStart: 'The last train doors begin to close.',
      characters: ['Mara', 'Ivo'],
      selectedTurnIds: [],
      branchSnapshotRequiredFromRevision: 0,
      metadataExtensions: {},
      playLocalState: {},
      playLocalStateVisibility: {},
      worldClock: summary.worldClock,
      eventPolicy: eventPolicy(),
      scheduledEvents: [],
      suggestedActions: [],
      activatedSources: [],
      observations: [],
      adoptionCandidates: [],
      sceneRehearsal: {
        schemaVersion: 1,
        sessionId: REHEARSAL_ID,
        purpose: 'sceneRehearsal',
        startMode: 'guided',
        activeSceneRef: 'scene-last-train',
        sceneContract: {
          sceneId: 'scene-last-train',
          worldClock: summary.worldClock,
          clockProvenance: {
            kind: 'newSessionInitial',
            sourceRefs: [],
            authorProvidedAt: '2026-07-20T11:00:00.000Z',
          },
          location: authorValue('Platform nine'),
          atmosphere: authorValue('Tense'),
          trigger: authorValue('The last train doors begin to close.'),
          objective: authorValue('Discover whether Mara reveals the letter.'),
          risk: authorValue('Ivo may board without the truth.'),
          participantRefs: ['participant-mara', 'participant-ivo'],
          orderStrategy: 'hybrid',
        },
        participants: [{
          participantRef: 'participant-mara',
          displayName: 'Mara',
          currentGoal: 'Keep the sealed letter hidden',
          initialKnowledgeEvidenceRefs: ['knowledge-mara'],
        }, {
          participantRef: 'participant-ivo',
          displayName: 'Ivo',
          currentGoal: 'Learn why Mara came to the station',
          initialKnowledgeEvidenceRefs: ['knowledge-ivo'],
        }],
        initialKnowledgeEvidence: [{
          id: 'knowledge-mara',
          participantRef: 'participant-mara',
          visibility: 'playerVisible',
          fact: 'The sealed letter names the stationmaster.',
          provenance: {
            kind: 'authorProvided',
            providedAt: '2026-07-20T11:00:00.000Z',
          },
        }, {
          id: 'knowledge-ivo',
          participantRef: 'participant-ivo',
          visibility: 'playerVisible',
          fact: 'The train leaves at midnight.',
          provenance: {
            kind: 'authorProvided',
            providedAt: '2026-07-20T11:00:00.000Z',
          },
        }],
      },
      rehearsalScenes: [{
        schemaVersion: 1,
        sessionId: REHEARSAL_ID,
        sceneId: 'scene-last-train',
        turns: [],
      }],
    },
    transcript: { items: [], totalCount: 0, hasMoreBefore: false },
    events: { items: [], totalCount: 0, hasMoreBefore: false },
    eventPresentation: [],
  };
}

function createDraftAttempt(): PlayTurnAttempt {
  const visibleBlock: NarrativeBlock = {
    id: 'block-mara-visible',
    kind: 'characterAction',
    speakerRef: 'participant-mara',
    content: 'Mara keeps the sealed letter behind her back.',
    visibility: 'playerVisible',
    projection: 'transcript',
    eventRefs: ['event-draft-visible'],
    sourceRefs: ['knowledge-mara'],
  };
  const hiddenBlock: NarrativeBlock = {
    id: 'block-mara-hidden',
    kind: 'narrator',
    content: 'The letter names the stationmaster as an informant.',
    visibility: 'playerUnknown',
    projection: 'directorOnly',
    eventRefs: ['event-draft-hidden'],
    sourceRefs: ['knowledge-mara'],
  };
  return {
    schemaVersion: 1,
    id: ATTEMPT_ID,
    sessionId: REHEARSAL_ID,
    baseRevision: 0,
    attemptRevision: 3,
    sceneBeforeRef: 'scene-last-train',
    status: 'running',
    actorOrder: ['participant-mara', 'participant-ivo'],
    participantRefs: ['participant-mara', 'participant-ivo'],
    orderStrategy: 'hybrid',
    selectedStepRefs: [],
    currentStepRef: 'step-mara-draft',
    dueScheduledEventIds: [],
    steps: [{
      id: 'step-mara-draft',
      attemptId: ATTEMPT_ID,
      participantRef: 'participant-mara',
      queueIndex: 0,
      perceptionRef: 'perception-mara-0',
      intentSummary: 'Keep the letter out of sight',
      narrativeBlocks: [visibleBlock, hiddenBlock],
      settlementContribution: {
        events: [],
        knowledgeChanges: [],
        pressureChanges: [],
        agendaChanges: [],
        scheduledEventChanges: [],
        stateDelta: { 'letter.visible': false },
        observations: [],
        suggestedActions: [],
      },
      effectFingerprint: 'effect-fingerprint-mara-1',
      decisionBasisRefs: ['knowledge-mara'],
      materialEffect: { kind: 'materialEffect' },
      status: 'draft',
      createdAt: '2026-07-20T11:05:00.000Z',
    }],
    interventions: [],
    stagnation: {
      consecutiveNoMaterialSteps: 0,
      threshold: 3,
      warning: false,
    },
    mutationReceipts: [],
    createdAt: '2026-07-20T11:01:00.000Z',
    updatedAt: '2026-07-20T11:05:00.000Z',
  };
}

function message(id: string, content: string, createdAt: string): PlayTranscriptTurn {
  return { id, speaker: 'world-referee', content, createdAt };
}

function event(sequence: number, title: string): PlayWorldEvent {
  return {
    id: `event-${sequence}`,
    turnId: `turn-${sequence}`,
    sequence,
    kind: 'environmentChanged',
    origin: 'environment',
    title,
    summary: `${title} impact.`,
    visibility: 'playerVisible',
    cause: {
      reason: `${title} cause.`,
      pressureId: `pressure-${sequence}`,
    },
    worldClock: { turn: sequence, revision: sequence },
    createdAt: `2026-07-20T00:${String(sequence).padStart(2, '0')}:00.000Z`,
    canonical: false,
  };
}

function eventPresentation(item: PlayWorldEvent): PlayEventPresentationEvidence {
  return {
    eventId: item.id,
    causes: {
      actions: [],
      sourceEvents: [],
      pressure: { label: item.title.replace('event', 'pressure') },
    },
    stateImpacts: [],
    stateImpactOmittedCount: 0,
    author: {
      reason: item.cause.reason,
      technicalRefs: {
        artifactId: item.turnId,
        artifactRevision: item.worldClock.revision,
        turnId: item.turnId,
        sourceTurnIds: [],
        sourceEventIds: [],
        pressureId: item.cause.pressureId,
      },
      hiddenCauses: { actions: [], sourceEvents: [] },
      stateImpacts: [],
      stateImpactOmittedCount: 0,
    },
  };
}

function eventPolicy() {
  return {
    simulationMode: 'reactiveWorld' as const,
    density: 'balanced' as const,
    allowOffscreen: true,
    allowHidden: true,
    maxExternalEventsPerTurn: 2,
  };
}

function authorValue(value: string) {
  return {
    value,
    provenance: {
      kind: 'authorProvided' as const,
      providedAt: '2026-07-20T11:00:00.000Z',
    },
  };
}
