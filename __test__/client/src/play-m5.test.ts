import { describe, expect, it, vi } from 'vitest';

import {
  createOanClient,
  type PlaySessionSelectedDetail,
  type PlaySessionSummary,
  type PlaySessionV4,
  type PlaySourceDriftDecisionResult,
  type PlaySourceDriftStatus,
  type PlayTurnContextTrace,
} from '@oh-awesome-novel/client';

const OLD_HASH = 'a'.repeat(64);
const NEW_HASH = 'b'.repeat(64);

describe('Play M5 client contracts', () => {
  it('routes and strictly parses bounded reads, context traces, and drift decisions', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const summary = createSummary();
    const detail = createDetail(summary);
    const trace = createTrace();
    const drift = createDriftStatus();
    const decisionResult = createDecisionResult();
    const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      calls.push({ url, init });
      if (url.endsWith('/play-session-summaries')) {
        return jsonResponse({ summaries: [summary] });
      }
      if (url.includes('/detail?')) return jsonResponse({ detail });
      if (url.includes('/context-traces?')) return jsonResponse({ traces: [trace] });
      if (url.endsWith('/source-drift/decisions')) return jsonResponse(decisionResult);
      if (url.endsWith('/source-drift')) return jsonResponse({ status: drift });
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
    });

    await expect(client.listPlaySessionSummaries()).resolves.toEqual({
      summaries: [summary],
    });
    await expect(client.getPlaySessionDetail('play-m5', {
      limit: 25,
      transcriptCursor: 'play-window-v1.cursor',
    })).resolves.toEqual({ detail });
    await expect(client.listPlayContextTraces('play-m5', { limit: 10 }))
      .resolves.toEqual({ traces: [trace] });
    await expect(client.getPlaySourceDrift('play-m5')).resolves.toEqual({
      status: drift,
    });
    await expect(client.decidePlaySourceDrift('play-m5', {
      kind: 'reassemble',
      baseRevision: 0,
    })).resolves.toEqual(decisionResult);

    expect(calls.map((call) => call.url)).toEqual([
      'http://backend.test/api/workspace/play-session-summaries',
      'http://backend.test/api/workspace/play-sessions/play-m5/detail?limit=25&transcriptCursor=play-window-v1.cursor',
      'http://backend.test/api/workspace/play-sessions/play-m5/context-traces?limit=10',
      'http://backend.test/api/workspace/play-sessions/play-m5/source-drift',
      'http://backend.test/api/workspace/play-sessions/play-m5/source-drift/decisions',
    ]);
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({
      kind: 'reassemble',
      baseRevision: 0,
    });
  });

  it('rejects unknown fields, inconsistent windows, private trace fields, and stale decision envelopes', async () => {
    const summary = createSummary();
    const detail = createDetail(summary);
    const malformedDetails = [
      { ...detail, privateReasoning: 'hidden' },
      {
        ...detail,
        transcript: { ...detail.transcript, totalCount: 1 },
      },
      {
        ...detail,
        summary: { ...summary, revision: 1 },
      },
      {
        ...detail,
        eventPresentation: [{}],
      },
    ];
    for (const malformed of malformedDetails) {
      const client = clientWithResponse({ detail: malformed });
      await expect(client.getPlaySessionDetail('play-m5'))
        .rejects.toThrow('invalid payload');
    }

    const presented = createPresentedDetail();
    await expect(clientWithResponse({ detail: presented })
      .getPlaySessionDetail('play-m5')).resolves.toEqual({ detail: presented });
    const wrongEventEvidence = structuredClone(presented);
    wrongEventEvidence.eventPresentation[0]!.eventId = 'turn-1-event-other';
    await expect(clientWithResponse({ detail: wrongEventEvidence })
      .getPlaySessionDetail('play-m5')).rejects.toThrow('invalid payload');
    const wrongSelectedArtifact = structuredClone(presented);
    wrongSelectedArtifact.selectedArtifactPresentation!.id = 'turn-artifact-other';
    await expect(clientWithResponse({ detail: wrongSelectedArtifact })
      .getPlaySessionDetail('play-m5')).rejects.toThrow('invalid payload');

    const rehearsalDetail = createPresentedDetail(5);
    await expect(clientWithResponse({ detail: rehearsalDetail })
      .getPlaySessionDetail('play-m5')).resolves.toEqual({ detail: rehearsalDetail });
    expect(rehearsalDetail.selectedArtifactPresentation?.rehearsalEvidenceRefs)
      .toEqual(['rehearsal-evidence-1']);

    const trace = createTrace();
    const privateTrace = { ...trace, reasoning: 'do not persist' };
    await expect(clientWithResponse({ traces: [privateTrace] })
      .listPlayContextTraces('play-m5')).rejects.toThrow('invalid payload');

    const decision = createDecisionResult();
    const wrongRevision = structuredClone(decision);
    wrongRevision.status.sessionRevision = 2;
    await expect(clientWithResponse(wrongRevision).decidePlaySourceDrift(
      'play-m5',
      { kind: 'reassemble', baseRevision: 0 },
    )).rejects.toThrow('invalid payload');

    const client = clientWithResponse({});
    expect(() => client.getPlaySessionDetail('play-m5', { limit: 0 }))
      .toThrow('between 1 and 200');
    expect(() => client.decidePlaySourceDrift('play-m5', {
      kind: 'fork',
      baseRevision: 0,
      newSessionId: 'play-m5',
    })).toThrow('requires a new session id');
  });
});

function createSummary(): PlaySessionSummary {
  return {
    schemaVersion: 4,
    id: 'play-m5',
    title: 'M5',
    createdAt: '2026-07-20T00:00:00.000Z',
    latestActivityAt: '2026-07-20T00:00:00.000Z',
    revision: 0,
    purpose: 'immersiveJourney',
    startMode: 'quick',
    selectedTurnCount: 0,
    transcriptCount: 0,
    eventCount: 0,
    worldClock: { turn: 0, revision: 0 },
    canonical: false,
  };
}

function createDetail(summary: PlaySessionSummary): PlaySessionSelectedDetail {
  return {
    summary,
    snapshot: {
      schemaVersion: 4,
      id: 'play-m5',
      title: 'M5',
      createdAt: '2026-07-20T00:00:00.000Z',
      revision: 0,
      sceneStart: 'At the gate',
      characters: [],
      selectedTurnIds: [],
      branchSnapshotRequiredFromRevision: 0,
      metadataExtensions: {},
      playLocalState: {},
      playLocalStateVisibility: {},
      worldClock: { turn: 0, revision: 0 },
      eventPolicy: {
        simulationMode: 'reactiveWorld',
        density: 'balanced',
        allowOffscreen: true,
        allowHidden: true,
        maxExternalEventsPerTurn: 2,
      },
      scheduledEvents: [],
      suggestedActions: [],
      activatedSources: [],
      observations: [],
      adoptionCandidates: [],
    },
    transcript: { items: [], totalCount: 0, hasMoreBefore: false },
    events: { items: [], totalCount: 0, hasMoreBefore: false },
    eventPresentation: [],
  };
}

function createPresentedDetail(
  schemaVersion: 4 | 5 = 4,
): PlaySessionSelectedDetail {
  const artifactId = 'turn-artifact-1';
  const eventId = 'turn-1-event-1';
  const summary: PlaySessionSummary = {
    ...createSummary(),
    schemaVersion,
    revision: 1,
    purpose: schemaVersion === 5 ? 'sceneRehearsal' : 'immersiveJourney',
    selectedArtifactId: artifactId,
    selectedTurnCount: 1,
    eventCount: 1,
    worldClock: { turn: 1, revision: 1 },
  };
  const event = {
    id: eventId,
    turnId: 'turn-1-referee',
    sequence: 1,
    kind: 'locationChanged' as const,
    origin: 'player' as const,
    title: 'The gate closes',
    summary: 'The station gate is now closed.',
    visibility: 'playerVisible' as const,
    cause: {
      reason: 'The player waited for the gate to close.',
      sourceTurnIds: ['turn-1-user'],
    },
    worldClock: { turn: 1, revision: 1 },
    createdAt: '2026-07-20T00:00:01.000Z',
    canonical: false as const,
  };
  return {
    summary,
    snapshot: {
      ...createDetail(createSummary()).snapshot,
      schemaVersion,
      revision: 1,
      selectedTurnIds: [artifactId],
      playLocalState: { station: 'closed' },
      playLocalStateVisibility: { station: 'playerVisible' },
      worldClock: { turn: 1, revision: 1 },
      ...(schemaVersion === 5
        ? { sceneRehearsal: {}, rehearsalScenes: [{}] }
        : {}),
    },
    transcript: { items: [], totalCount: 0, hasMoreBefore: false },
    events: { items: [event], totalCount: 1, hasMoreBefore: false },
    eventPresentation: [{
      eventId,
      causes: {
        actions: [{ actionKind: 'wait', contentExcerpt: 'Wait by the gate.' }],
        sourceEvents: [],
      },
      stateImpacts: [{ path: 'station', value: 'closed' }],
      stateImpactOmittedCount: 0,
      author: {
        reason: event.cause.reason,
        technicalRefs: {
          artifactId,
          artifactRevision: 1,
          turnId: event.turnId,
          sourceTurnIds: ['turn-1-user'],
          sourceEventIds: [],
        },
        hiddenCauses: { actions: [], sourceEvents: [] },
        stateImpacts: [{ path: 'station', value: 'closed' }],
        stateImpactOmittedCount: 0,
      },
    }],
    selectedArtifactPresentation: {
      id: artifactId,
      revision: 1,
      eventIds: [eventId],
      stateDelta: { station: 'closed' },
      playLocalStateVisibilitySnapshot: { station: 'playerVisible' },
      ...(schemaVersion === 5
        ? { rehearsalEvidenceRefs: ['rehearsal-evidence-1'] }
        : {}),
      canonical: false,
    },
  };
}

function createTrace(): PlayTurnContextTrace {
  return {
    schemaVersion: 1,
    sessionId: 'play-m5',
    sessionRevision: 1,
    artifactId: 'turn-artifact-1',
    createdAt: '2026-07-20T00:00:01.000Z',
    transcriptWindow: {
      kind: 'transcript',
      availableCount: 0,
      selectedCount: 0,
      selectedIds: [],
      omittedCount: 0,
      limit: 20,
    },
    eventWindow: {
      kind: 'event',
      availableCount: 0,
      selectedCount: 0,
      selectedIds: [],
      omittedCount: 0,
      limit: 12,
    },
    sources: [],
    canonical: false,
  };
}

function createDriftStatus(): PlaySourceDriftStatus {
  return {
    sessionId: 'play-m5',
    sessionRevision: 0,
    overall: 'drifted',
    sources: [{
      sourceId: 'world',
      path: 'world/rules.md',
      expectedContentHash: OLD_HASH,
      actualContentHash: NEW_HASH,
      state: 'changed',
    }],
    availableDecisions: ['continueFrozen', 'reassemble', 'fork'],
    canonical: false,
  };
}

function createDecisionResult(): PlaySourceDriftDecisionResult {
  const resolution = {
    schemaVersion: 1 as const,
    kind: 'reassemble' as const,
    decidedAt: '2026-07-20T00:00:01.000Z',
    sourceSessionId: 'play-m5',
    sourceRevision: 0,
    snapshots: createDriftStatus().sources,
    excludedSourceIds: [],
    canonical: false as const,
  };
  const session = createSession();
  session.metadataExtensions.playSourceDriftResolution = resolution;
  return {
    session,
    resolution,
    status: {
      sessionId: 'play-m5',
      sessionRevision: 1,
      overall: 'current',
      sources: [{
        sourceId: 'world',
        path: 'world/rules.md',
        expectedContentHash: NEW_HASH,
        actualContentHash: NEW_HASH,
        state: 'current',
      }],
      availableDecisions: [],
      canonical: false,
    },
    sourceSessionId: 'play-m5',
  };
}

function createSession(): PlaySessionV4 {
  return {
    schemaVersion: 4,
    id: 'play-m5',
    title: 'M5',
    createdAt: '2026-07-20T00:00:00.000Z',
    revision: 1,
    sceneStart: 'At the gate',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock: { turn: 0, revision: 1 },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [],
    scheduledEvents: [],
    suggestedActions: [],
    activatedSources: [{
      sourceId: 'world',
      path: 'world/rules.md',
      objectId: 'rules',
      contentHash: NEW_HASH,
      role: 'world',
      reason: 'World rules',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
      trust: 'canonical',
    }],
    observations: [],
    adoptionCandidates: [],
  };
}

function clientWithResponse(value: unknown) {
  return createOanClient({
    backendBaseUrl: 'http://backend.test',
    fetch: (async () => jsonResponse(value)) as unknown as typeof fetch,
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
