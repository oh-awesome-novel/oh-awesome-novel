import {
  createOanClient,
  type CreatePlayAdoptionPreviewInput,
  type PlayAdoptionCandidate,
  type PlayAdoptionPreview,
  type PlayAdoptionSeed,
  type PlayAdoptionTarget,
} from '@oh-awesome-novel/client';
import { describe, expect, it, vi } from 'vitest';

const PREVIEW_ID = 'pa_00000000-0000-4000-8000-000000000001';
const FINGERPRINT = 'a'.repeat(64);

describe('Play adoption client contract', () => {
  it.each([
    {
      name: 'event -> timeline',
      seed: { kind: 'event', eventId: 'event-1' } as const,
      target: 'timeline' as const,
      payload: {
        file: 'events.yaml',
        path: 'events',
        event: { id: 'event-adopted', summary: 'The gate opened.' },
      },
      touchedFile: 'timeline/events.yaml',
    },
    {
      name: 'observation -> chapterDraft',
      seed: { kind: 'observation', observationId: 'observation-1' } as const,
      target: 'chapterDraft' as const,
      payload: {
        chapterId: '0001/0002',
        content: 'The gate opened.',
        mode: 'replace',
      },
      touchedFile: 'chapters/0001/0002.md',
    },
    {
      name: 'outcome -> state',
      seed: {
        kind: 'outcome',
        outcomeItemId: 'outcome-1',
        outcomeReportFingerprint: 'b'.repeat(64),
      } as const,
      target: 'state' as const,
      payload: {
        file: 'play-adoption.yaml',
        path: 'evidence.gate',
        value: { summary: 'The gate opened.' },
      },
      touchedFile: 'state/play-adoption.yaml',
    },
    {
      name: 'event -> foreshadow',
      seed: { kind: 'event', eventId: 'event-2' } as const,
      target: 'foreshadow' as const,
      payload: {
        file: 'active.yaml',
        path: 'active',
        item: { id: 'gate-clue', summary: 'The gate opened.' },
      },
      touchedFile: 'foreshadow/active.yaml',
    },
  ])('routes and strictly parses $name preview', async ({
    seed,
    target,
    payload,
    touchedFile,
  }) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const input: CreatePlayAdoptionPreviewInput = {
      baseRevision: 7,
      projection: 'player',
      seed,
      target,
      payload,
    };
    const response = createPreviewResponse(input, touchedFile);
    const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(request), init });
      return jsonResponse(response);
    }) as unknown as typeof fetch;
    const client = createClient(fetcher);

    await expect(client.createPlayAdoptionPreview('play-1', input))
      .resolves.toEqual(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/adoption-previews',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual(input);
  });

  it('rejects malformed preview truth, unknown fields, and Player provenance leakage', async () => {
    const input: CreatePlayAdoptionPreviewInput = {
      baseRevision: 7,
      projection: 'player',
      seed: { kind: 'event', eventId: 'event-1' },
      target: 'timeline',
      payload: {
        event: { id: 'event-adopted', summary: 'The gate opened.' },
      },
    };
    const valid = createPreviewResponse(input, 'timeline/events.yaml');
    const malformed = [
      mutate(valid, (value) => { (value as Record<string, unknown>).unexpected = true; }),
      mutate(valid, (value) => {
        (value.preview as unknown as Record<string, unknown>).unexpected = true;
      }),
      mutate(valid, (value) => { value.preview.id = '../pending'; }),
      mutate(valid, (value) => { value.preview.baseRevision = 8; }),
      mutate(valid, (value) => { value.preview.projection = 'director'; }),
      mutate(valid, (value) => { value.preview.fingerprint = 'invalid'; }),
      mutate(valid, (value) => { value.preview.evidenceFingerprint = 'invalid'; }),
      mutate(valid, (value) => { value.preview.touchedFiles = ['../timeline.yaml']; }),
      mutate(valid, (value) => {
        value.preview.diff = 'diff --git a/state/secret.yaml b/state/secret.yaml\n';
      }),
      mutate(valid, (value) => {
        value.preview.evidenceClosure.eventRefs = ['event-hidden'];
      }),
      mutate(valid, (value) => { value.preview.visibility = 'playerUnknown'; }),
      mutate(valid, (value) => {
        (value.preview.seed as unknown as Record<string, unknown>).hiddenRef = 'secret';
      }),
      mutate(valid, (value) => {
        (value.preview.suggestions[0] as unknown as Record<string, unknown>)
          .unexpected = true;
      }),
      mutate(valid, (value) => {
        value.preview.suggestions[0]!.toolName = 'state.set';
      }),
    ];

    for (const response of malformed) {
      const client = createClient(async () => jsonResponse(response));
      await expect(client.createPlayAdoptionPreview('play-1', input))
        .rejects.toThrow('invalid payload');
    }
  });

  it('accepts a Director preview whose selected branch exceeds the evidence-ref cap', async () => {
    const input: CreatePlayAdoptionPreviewInput = {
      baseRevision: 7,
      projection: 'director',
      seed: { kind: 'event', eventId: 'event-1' },
      target: 'timeline',
      payload: targetPayload('timeline'),
    };
    const response = createPreviewResponse(input, 'timeline/events.yaml');
    response.preview.evidenceClosure.selectedArtifactTurnRefs = Array.from(
      { length: 25 },
      (_, index) => `turn-artifact-${index + 1}`,
    );
    response.preview.evidenceClosure.artifactTurnRefs = ['turn-artifact-25'];
    const client = createClient(async () => jsonResponse(response));

    await expect(client.createPlayAdoptionPreview('play-1', input))
      .resolves.toEqual(response);
  });

  it('fails closed on malformed preview and promotion requests before fetch', () => {
    const fetcher = vi.fn(async () => jsonResponse({}));
    const client = createClient(fetcher as unknown as typeof fetch);
    const base = {
      baseRevision: 7,
      projection: 'player' as const,
      seed: { kind: 'event', eventId: 'event-1' } as const,
    };

    expect(() => client.createPlayAdoptionPreview('../play-1', base))
      .toThrow('Play session id is invalid');
    expect(() => client.createPlayAdoptionPreview('play-1', {
      ...base,
      unexpected: true,
    } as CreatePlayAdoptionPreviewInput)).toThrow('request is invalid');
    expect(() => client.createPlayAdoptionPreview('play-1', {
      ...base,
      seed: { ...base.seed, hiddenRef: 'secret' },
    } as CreatePlayAdoptionPreviewInput)).toThrow('request is invalid');
    expect(() => client.createPlayAdoptionPreview('play-1', {
      ...base,
      payload: { event: { id: 'ambiguous' } },
    })).toThrow('does not match its target');
    expect(() => client.createPlayAdoptionPreview('play-1', {
      ...base,
      target: 'state',
      payload: { event: { id: 'wrong-schema' } },
    })).toThrow('does not match its target');
    expect(() => client.createPlayAdoptionPreview('play-1', {
      ...base,
      seed: {
        kind: 'outcome',
        outcomeItemId: 'outcome-1',
        outcomeReportFingerprint: 'invalid',
      },
    })).toThrow('request is invalid');
    expect(() => client.createPlayAdoptionPendingAction('play-1', '../preview', {
      baseRevision: 7,
      fingerprint: FINGERPRINT,
    })).toThrow('preview id is invalid');
    expect(() => client.createPlayAdoptionPendingAction('play-1', PREVIEW_ID, {
      baseRevision: 7,
      fingerprint: 'invalid',
    })).toThrow('request is invalid');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('strictly parses an idempotent preview promotion response', async () => {
    const response = createPromotionResponse();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(request), init });
      return jsonResponse(response);
    }) as unknown as typeof fetch;
    const client = createClient(fetcher);
    const input = { baseRevision: 7, fingerprint: FINGERPRINT };

    await expect(client.createPlayAdoptionPendingAction('play-1', PREVIEW_ID, input))
      .resolves.toEqual(response);
    await expect(client.createPlayAdoptionPendingAction('play-1', PREVIEW_ID, input))
      .resolves.toEqual(response);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: `http://backend.test/api/workspace/play-sessions/play-1/adoption-previews/${PREVIEW_ID}/pending-action`,
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual(input);
  });

  it('rejects malformed confirm wrappers, session truth, PendingAction, and refresh', async () => {
    const valid = createPromotionResponse();
    const malformed = [
      mutate(valid, (value) => { (value as Record<string, unknown>).unexpected = true; }),
      mutate(valid, (value) => {
        value.sessionUpdate.revision = 7;
      }),
      mutate(valid, (value) => { value.candidate.id = 'adoption-other'; }),
      mutate(valid, (value) => { value.pendingAction.id = 'pa_other'; }),
      mutate(valid, (value) => {
        value.pendingAction.touchedFiles = ['state/secret.yaml'];
      }),
      mutate(valid, (value) => {
        (value.pendingAction as unknown as Record<string, unknown>).patches = [];
      }),
      mutate(valid, (value) => { value.pendingAction.diff = 42 as unknown as string; }),
      mutate(valid, (value) => { value.refresh.projectHealth.pendingActionCount = 2; }),
      mutate(valid, (value) => {
        (value.refresh as unknown as Record<string, unknown>).unexpected = true;
      }),
    ];

    for (const response of malformed) {
      const client = createClient(async () => jsonResponse(response));
      await expect(client.createPlayAdoptionPendingAction('play-1', PREVIEW_ID, {
        baseRevision: 7,
        fingerprint: FINGERPRINT,
      })).rejects.toThrow('invalid payload');
    }
  });
});

function createPreviewResponse(
  input: CreatePlayAdoptionPreviewInput,
  touchedFile: string,
): { preview: PlayAdoptionPreview } {
  const payload = structuredClone(input.payload ?? targetPayload(input.target ?? 'timeline'));
  const suggestions = createSuggestions();
  const selectedTarget = input.target ?? 'timeline';
  return {
    preview: {
      schemaVersion: 1,
      id: PREVIEW_ID,
      sessionId: 'play-1',
      baseRevision: input.baseRevision,
      projection: input.projection,
      seed: structuredClone(input.seed),
      candidateId: 'adoption-00000000-0000-4000-8000-000000000001',
      summary: 'The gate opened.',
      evidence: 'The selected Play result shows the gate opening.',
      visibility: 'playerVisible',
      evidenceClosure: {
        schemaVersion: 1,
        sessionId: 'play-1',
        sessionRevision: input.baseRevision,
        selectedArtifactTurnRefs: [],
        artifactTurnRefs: [],
        messageRefs: [],
        eventRefs: [],
        observationRefs: [],
        evidenceRefs: [],
        sourceSnapshots: [],
        selectedPathFingerprint: 'c'.repeat(64),
        sourceBaseFingerprint: 'd'.repeat(64),
      },
      evidenceFingerprint: 'e'.repeat(64),
      suggestions,
      target: selectedTarget,
      payload,
      touchedFiles: [touchedFile],
      diff: `diff --git a/${touchedFile} b/${touchedFile}\n`,
      fingerprint: FINGERPRINT,
      createdAt: '2026-07-16T02:00:00.000Z',
      canonicalUnchanged: true,
    },
  };
}

function createSuggestions() {
  return ([
    ['chapterDraft', 'chapter.createDraft'],
    ['state', 'state.set'],
    ['timeline', 'timeline.add'],
    ['foreshadow', 'foreshadow.create'],
  ] as const).map(([target, toolName]) => ({
    target,
    toolName,
    recommended: target === 'timeline',
    reason: `Use ${target}.`,
    defaultPayload: targetPayload(target),
  }));
}

function targetPayload(target: PlayAdoptionTarget): Record<string, unknown> {
  if (target === 'chapterDraft') {
    return {
      chapterId: '0001/0002',
      content: 'The gate opened.',
      mode: 'replace',
    };
  }
  if (target === 'state') {
    return {
      file: 'play-adoption.yaml',
      path: 'evidence.gate',
      value: { summary: 'The gate opened.' },
    };
  }
  if (target === 'timeline') {
    return {
      file: 'events.yaml',
      path: 'events',
      event: { id: 'event-adopted', summary: 'The gate opened.' },
    };
  }
  return {
    file: 'active.yaml',
    path: 'active',
    item: { id: 'gate-clue', summary: 'The gate opened.' },
  };
}

function createPromotionResponse() {
  const candidate: PlayAdoptionCandidate = {
    id: 'adoption-00000000-0000-4000-8000-000000000001',
    target: 'timeline',
    summary: 'The gate opened.',
    evidence: 'The selected Play result shows the gate opening.',
    payload: targetPayload('timeline'),
    visibility: 'playerVisible',
    sourceObservationIds: [],
    sourceTurnIds: [],
    sourceEventIds: [],
    requiresPendingAction: true,
  };
  return {
    sessionUpdate: {
      sessionId: 'play-1',
      baseRevision: 7,
      revision: 8,
    },
    candidate,
    pendingAction: {
      id: PREVIEW_ID,
      title: 'Add timeline event event-adopted',
      description: 'Append to events in timeline/events.yaml.',
      touchedFiles: ['timeline/events.yaml'],
      diff: 'diff --git a/timeline/events.yaml b/timeline/events.yaml\n',
      createdAt: '2026-07-16T02:01:00.000Z',
      status: 'pending' as const,
    },
    refresh: {
      workspaceStatus: {
        pendingActionCount: 1,
        git: {
          available: false,
          source: 'global' as const,
          repository: false,
          status: 'unknown' as const,
          dirty: null,
          files: [],
        },
        gitConfig: { autoCommitOnAccept: true },
      },
      projectHealth: {
        generatedAt: '2026-07-16T02:01:00.000Z',
        missingCharacterCards: [],
        chaptersWithoutSummaries: [],
        activeHookCount: 0,
        latestStateStale: false,
        timelineGapCount: 0,
        pendingActionCount: 1,
        issues: [{
          id: 'pending-actions',
          severity: 'info' as const,
          title: 'PendingAction exists',
          detail: '1 pending action needs review.',
        }],
      },
    },
  };
}

function mutate<T>(value: T, apply: (draft: T) => void): T {
  const draft = structuredClone(value);
  apply(draft);
  return draft;
}

function createClient(fetcher: typeof fetch) {
  return createOanClient({
    backendBaseUrl: 'http://backend.test',
    fetch: fetcher,
    systemTheme: () => 'dark',
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
