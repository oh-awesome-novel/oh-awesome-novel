import { createOanClient } from '@oh-awesome-novel/client';
import { describe, expect, it, vi } from 'vitest';

describe('Play outcome client transport', () => {
  it('routes player-by-default and director reports through strict typed methods', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const player = createOutcomeResponse('player');
    const director = createOutcomeResponse('director');
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const projection = init?.body
        ? (JSON.parse(String(init.body)) as { projection: string }).projection
        : new URL(url).searchParams.get('projection');
      return jsonResponse(projection === 'director' ? director : player);
    }) as unknown as typeof fetch;
    const client = createClient(fetcher);

    await expect(client.generatePlayOutcomeReport('play-1', {
      baseRevision: 1,
    })).resolves.toEqual(player);
    await expect(client.getPlayOutcomeReport('play-1', {
      baseRevision: 1,
      projection: 'director',
    })).resolves.toEqual(director);

    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/reports/outcome',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({
      baseRevision: 1,
      projection: 'player',
    });
    expect(calls[1]!.url).toContain('baseRevision=1');
    expect(calls[1]!.url).toContain('projection=director');

    expect(() => client.generatePlayOutcomeReport('play-1', {
      baseRevision: -1,
    })).toThrow('baseRevision');
    expect(() => client.getPlayOutcomeReport('../play-1', {
      baseRevision: 1,
    })).toThrow('Play session id is invalid');
  });

  it('fails closed on unknown, hidden, malformed, duplicated, and unsafe report refs', async () => {
    const validPlayer = createOutcomeResponse('player');
    const validDirector = createOutcomeResponse('director');
    const malformed: unknown[] = [];

    malformed.push({ ...validPlayer, unexpected: true });
    malformed.push({ ...validPlayer, reportFingerprint: 'not-a-fingerprint' });
    const missingFingerprint = structuredClone(validPlayer) as Record<string, unknown>;
    delete missingFingerprint.reportFingerprint;
    malformed.push(missingFingerprint);
    malformed.push({
      ...validPlayer,
      report: { ...validPlayer.report, unexpected: true },
    });
    const hiddenPlayer = structuredClone(validPlayer);
    hiddenPlayer.report.items[0]!.visibility = 'playerUnknown';
    malformed.push(hiddenPlayer);
    const playerWithHiddenRef = structuredClone(validPlayer);
    playerWithHiddenRef.report.items[0]!.messageRefs = ['message-secret'];
    malformed.push(playerWithHiddenRef);
    const playerWithSelectedBranchRef = structuredClone(validPlayer);
    playerWithSelectedBranchRef.report.selectedArtifactTurnRefs = ['turn-artifact-secret'];
    malformed.push(playerWithSelectedBranchRef);
    const playerWithArtifactRef = structuredClone(validPlayer);
    playerWithArtifactRef.report.items[0]!.artifactTurnRefs = ['turn-artifact-secret'];
    malformed.push(playerWithArtifactRef);
    const duplicateRef = structuredClone(validDirector);
    duplicateRef.report.items[0]!.messageRefs = ['message-1', 'message-1'];
    malformed.push(duplicateRef);
    const unsafeRef = structuredClone(validDirector);
    unsafeRef.report.items[0]!.eventRefs = ['../secret'];
    malformed.push(unsafeRef);
    const unknownItemField = structuredClone(validDirector) as Record<string, unknown>;
    ((unknownItemField.report as { items: Array<Record<string, unknown>> }).items[0]!)
      .unexpected = true;
    malformed.push(unknownItemField);
    const duplicateItems = structuredClone(validDirector);
    duplicateItems.report.items.push(structuredClone(duplicateItems.report.items[0]!));
    malformed.push(duplicateItems);
    const duplicateSources = structuredClone(validDirector);
    duplicateSources.report.sourceSnapshots.push(
      structuredClone(duplicateSources.report.sourceSnapshots[0]!),
    );
    malformed.push(duplicateSources);
    malformed.push({
      ...structuredClone(validPlayer),
      status: 'stale',
      staleReasons: ['sourceContentChanged:secret-source'],
    });
    malformed.push({
      ...structuredClone(validPlayer),
      status: 'current',
      staleReasons: ['sourceSnapshotChanged'],
    });

    for (const payload of malformed) {
      const client = createClient(async () => jsonResponse(payload));
      await expect(client.getPlayOutcomeReport('play-1', {
        baseRevision: 1,
        projection: payload === validDirector ? 'director' : 'player',
      })).rejects.toThrow('invalid payload');
    }

    const malformedDirectorPayloads = malformed.slice(8, 13);
    for (const payload of malformedDirectorPayloads) {
      const client = createClient(async () => jsonResponse(payload));
      await expect(client.getPlayOutcomeReport('play-1', {
        baseRevision: 1,
        projection: 'director',
      })).rejects.toThrow('invalid payload');
    }
  });

  it('rejects an outcome projection that does not match the requested lens', async () => {
    const director = createOutcomeResponse('director');
    const player = createOutcomeResponse('player');
    const playerClient = createClient(async () => jsonResponse(director));
    const directorClient = createClient(async () => jsonResponse(player));

    await expect(playerClient.generatePlayOutcomeReport('play-1', {
      baseRevision: 1,
      projection: 'player',
    })).rejects.toThrow('invalid payload');
    await expect(directorClient.getPlayOutcomeReport('play-1', {
      baseRevision: 1,
      projection: 'director',
    })).rejects.toThrow('invalid payload');
  });

  it('strictly validates writing-reference create/list/detach payloads and the 24-item limit', async () => {
    const active = createAttachment();
    const detached = {
      ...active,
      status: 'detached' as const,
      detachedAt: '2026-07-16T01:00:00.000Z',
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/detach')) return jsonResponse({ attachment: detached });
      if (init?.method === 'POST') {
        return jsonResponse({
          attachment: active,
          files: [`/novel/.workspace/writing-references/${active.id}.yaml`],
        });
      }
      return jsonResponse({ attachments: [active] });
    }) as unknown as typeof fetch;
    const client = createClient(fetcher);

    await expect(client.createPlayWritingReferenceAttachment({
      sessionId: 'play-1',
      baseRevision: 1,
      selectedOutcomeItemIds: ['outcome-1'],
    })).resolves.toMatchObject({ attachment: active });
    await expect(client.listPlayWritingReferenceAttachments())
      .resolves.toEqual({ attachments: [active] });
    await expect(client.detachPlayWritingReferenceAttachment(active.id))
      .resolves.toEqual({ attachment: detached });
    expect(calls.map((call) => call.url)).toEqual([
      'http://backend.test/api/workspace/writing-references',
      'http://backend.test/api/workspace/writing-references',
      `http://backend.test/api/workspace/writing-references/${active.id}/detach`,
    ]);

    expect(() => client.createPlayWritingReferenceAttachment({
      sessionId: 'play-1',
      baseRevision: 1,
      selectedOutcomeItemIds: Array.from(
        { length: 25 },
        (_, index) => `outcome-${index + 1}`,
      ),
    })).toThrow('writing reference request is invalid');

    const malformedAttachments: unknown[] = [];
    malformedAttachments.push({ ...active, unexpected: true });
    malformedAttachments.push({
      ...active,
      reportRef: '.workspace/play-sessions/another-session/reports/outcome.yaml',
    });
    malformedAttachments.push({
      ...active,
      evidenceClosureRefs: ['artifact:../turn-artifact-1'],
    });
    malformedAttachments.push({
      ...active,
      evidenceClosureRefs: [
        'artifact:turn-artifact-1',
        'artifact:turn-artifact-1',
      ],
    });
    malformedAttachments.push({ ...active, createdAt: 'not-a-timestamp' });
    malformedAttachments.push({
      ...active,
      selectedOutcomeItemRefs: Array.from(
        { length: 25 },
        (_, index) => `outcome-${index + 1}`,
      ),
    });
    malformedAttachments.push({
      ...active,
      sourceSnapshots: [
        active.sourceSnapshots[0],
        structuredClone(active.sourceSnapshots[0]),
      ],
    });
    malformedAttachments.push({
      ...detached,
      detachedAt: 'not-a-timestamp',
    });
    malformedAttachments.push({
      ...active,
      status: 'active',
      detachedAt: '2026-07-16T01:00:00.000Z',
    });

    for (const attachment of malformedAttachments) {
      const malformedClient = createClient(async () => jsonResponse({
        attachments: [attachment],
      }));
      await expect(malformedClient.listPlayWritingReferenceAttachments())
        .rejects.toThrow('invalid payload');
    }
  });
});

function createClient(fetcher: typeof fetch) {
  return createOanClient({
    backendBaseUrl: 'http://backend.test',
    fetch: fetcher,
    systemTheme: () => 'dark',
  });
}

function createOutcomeResponse(projection: 'player' | 'director') {
  const director = projection === 'director';
  return {
    report: {
      schemaVersion: 1 as const,
      sessionId: 'play-1',
      createdAt: '2026-07-16T00:00:00.000Z',
      sessionRevision: 1,
      selectedArtifactTurnRefs: director ? ['turn-artifact-1'] : [],
      sourceSnapshots: director
        ? [{
            sourceId: 'source:legacy-name',
            path: 'chapters/0001/0001.md',
            contentHash: 'a'.repeat(64),
          }]
        : [],
      items: [{
        id: 'outcome-1',
        kind: 'sceneSummary' as const,
        summary: 'The gate remained sealed.',
        visibility: 'playerVisible' as const,
        confidence: 'confirmed' as const,
        tags: ['writingMaterial' as const],
        artifactTurnRefs: director ? ['turn-artifact-1'] : [],
        messageRefs: director ? ['message-1'] : [],
        eventRefs: director ? ['event-1'] : [],
        observationRefs: director ? ['observation-1'] : [],
        evidenceRefs: director ? ['evidence-1'] : [],
        sourceRefs: director ? ['source-1'] : [],
        participantRefs: director ? ['participant-1'] : [],
      }],
    },
    reportFingerprint: 'c'.repeat(64),
    projection,
    status: 'current' as const,
    staleReasons: [],
    ...(projection === 'player'
      ? { files: ['/novel/outcome.yaml', '/novel/outcome.md'] }
      : {}),
  };
}

function createAttachment() {
  return {
    schemaVersion: 1 as const,
    id: 'writing-reference-1',
    sessionId: 'play-1',
    reportRef: '.workspace/play-sessions/play-1/reports/outcome.yaml',
    reportFingerprint: 'b'.repeat(64),
    selectedOutcomeItemRefs: ['outcome-1'],
    selectedArtifactTurnRefs: ['turn-artifact-1'],
    evidenceClosureRefs: [
      'artifact:turn-artifact-1',
      'message:message-1',
    ],
    sourceSnapshots: [{
      sourceId: 'source:legacy-name',
      path: 'chapters/0001/0001.md',
      contentHash: 'a'.repeat(64),
    }],
    status: 'active' as const,
    createdAt: '2026-07-16T00:00:00.000Z',
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
