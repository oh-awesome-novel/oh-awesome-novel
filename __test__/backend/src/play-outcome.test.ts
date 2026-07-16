import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startNovelHttpBackend,
  type NovelBackendAgentInput,
  type NovelBackendHandle,
} from '@oh-awesome-novel/backend';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
import { afterEach, describe, expect, it } from 'vitest';

const workspaces: string[] = [];
const backends: NovelBackendHandle[] = [];

afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close();
  for (const workspace of workspaces.splice(0)) {
    await rm(workspace, { recursive: true, force: true });
  }
});

describe('Play outcome and writing-reference HTTP transport', () => {
  it('projects reports safely, tracks source drift, transports explicit attachments, and rejects stale adoption', async () => {
    const workspaceRoot = await createWorkspace();
    const sourcePath = join(workspaceRoot, 'chapters/0001/source.md');
    const sourceText = '# Source\n\nThe public gate is open; the private signal is red.\n';
    await writeFile(sourcePath, sourceText, 'utf-8');
    const agentInputs: NovelBackendAgentInput[] = [];
    let turn = 0;
    const backend = await startBackend(workspaceRoot, {
      runAgent: (input) => {
        agentInputs.push(input);
        return completedRuntimeEvents();
      },
      runPlayTurn: async () => {
        turn += 1;
        return playSettlement(
          turn === 1 ? 'The gate opens.' : 'The porter closes the outer gate.',
          turn,
        );
      },
    });

    const created = await requestJson<{
      session: { id: string; revision: number };
    }>(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: {
        id: 'play-outcome-v4',
        title: 'Outcome v4',
        sceneStart: 'At the station gate',
        activatedSources: [{
          sourceId: 'private-source',
          path: 'chapters/0001/source.md',
          contentHash: sha256(sourceText),
          reason: 'Outcome evidence source',
          budgetLayer: 'L1',
          semanticBoundary: 'compressible',
          trust: 'canonical',
        }],
      },
    });
    expect(created.response.status).toBe(200);

    for (const [index, userText] of ['Wait at the gate', 'Follow the porter'].entries()) {
      const committed = await requestJson<{ session: { revision: number } }>(
        `${backend.url}/api/workspace/play-sessions/play-outcome-v4/world-referee-turn`,
        {
          method: 'POST',
          body: { userText, baseRevision: index },
        },
      );
      expect(committed.response.status).toBe(200);
      expect(committed.body.session.revision).toBe(index + 1);
    }

    const player = await requestJson<OutcomeResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/reports/outcome`,
      { method: 'POST', body: { baseRevision: 2 } },
    );
    expect(player.response.status).toBe(200);
    expect(player.body).toMatchObject({
      projection: 'player',
      status: 'current',
      staleReasons: [],
    });
    expect(player.body.files).toHaveLength(2);
    expect(player.body.report.selectedArtifactTurnRefs).toEqual([]);
    expect(player.body.report.sourceSnapshots).toEqual([]);
    expect(JSON.stringify(player.body)).not.toContain('Private signal');
    expect(JSON.stringify(player.body)).not.toContain('private-source');
    expect(player.body.report.items.every((item) =>
      item.visibility !== 'playerUnknown'
      && item.artifactTurnRefs.length === 0
      && item.messageRefs.length === 0
      && item.eventRefs.length === 0
      && item.observationRefs.length === 0
      && item.evidenceRefs.length === 0
      && item.sourceRefs.length === 0
      && item.participantRefs.length === 0)).toBe(true);

    const director = await requestJson<OutcomeResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/reports/outcome`,
      { method: 'POST', body: { baseRevision: 2, projection: 'director' } },
    );
    expect(director.response.status).toBe(200);
    expect(director.body.report.sourceSnapshots).toEqual([
      expect.objectContaining({ sourceId: 'private-source' }),
    ]);
    expect(director.body.report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        visibility: 'playerUnknown',
        summary: expect.stringContaining('Private signal'),
      }),
    ]));

    const selectedItem = director.body.report.items.find((item) =>
      item.visibility === 'playerVisible' && item.artifactTurnRefs.includes('turn-artifact-2'));
    expect(selectedItem).toBeDefined();

    const noAttachmentChat = await chat(backend.url, {});
    expect(noAttachmentChat.status).toBe(200);
    expect(agentInputs.at(-1)).not.toHaveProperty('playWritingReferences');

    const firstAttachment = await requestJson<AttachmentCreateResponse>(
      `${backend.url}/api/workspace/writing-references`,
      {
        method: 'POST',
        body: {
          sessionId: 'play-outcome-v4',
          baseRevision: 2,
          selectedOutcomeItemIds: [selectedItem!.id],
        },
      },
    );
    expect(firstAttachment.response.status).toBe(201);
    expect(firstAttachment.body.attachment).toMatchObject({
      sessionId: 'play-outcome-v4',
      status: 'active',
      selectedOutcomeItemRefs: [selectedItem!.id],
    });

    const selectedChat = await chat(backend.url, {
      writingReferenceAttachmentIds: [firstAttachment.body.attachment.id],
    });
    expect(selectedChat.status).toBe(200);
    expect(agentInputs.at(-1)?.playWritingReferences).toEqual([
      expect.objectContaining({
        attachmentId: firstAttachment.body.attachment.id,
        sessionId: 'play-outcome-v4',
        content: expect.stringContaining(selectedItem!.summary),
      }),
    ]);

    const duplicateIds = await chat(backend.url, {
      writingReferenceAttachmentIds: [
        firstAttachment.body.attachment.id,
        firstAttachment.body.attachment.id,
      ],
    });
    expect(duplicateIds.status).toBe(400);
    const tooManyIds = await chat(backend.url, {
      writingReferenceAttachmentIds: Array.from(
        { length: 9 },
        (_, index) => `writing-reference-${index}`,
      ),
    });
    expect(tooManyIds.status).toBe(400);
    const missing = await chat(backend.url, {
      writingReferenceAttachmentIds: ['missing-writing-reference'],
    });
    expect(missing.status).toBe(422);

    const detached = await requestJson<{ attachment: WritingAttachment }>(
      `${backend.url}/api/workspace/writing-references/${firstAttachment.body.attachment.id}/detach`,
      { method: 'POST', body: {} },
    );
    expect(detached.response.status).toBe(200);
    expect(detached.body.attachment).toMatchObject({
      id: firstAttachment.body.attachment.id,
      status: 'detached',
      detachedAt: expect.any(String),
    });
    expect((await chat(backend.url, {
      writingReferenceAttachmentIds: [firstAttachment.body.attachment.id],
    })).status).toBe(422);

    const staleAttachment = await requestJson<AttachmentCreateResponse>(
      `${backend.url}/api/workspace/writing-references`,
      {
        method: 'POST',
        body: {
          sessionId: 'play-outcome-v4',
          baseRevision: 2,
          selectedOutcomeItemIds: [selectedItem!.id],
        },
      },
    );
    expect(staleAttachment.response.status).toBe(201);

    await writeFile(sourcePath, `${sourceText}Changed.\n`, 'utf-8');
    const stalePlayer = await requestJson<OutcomeResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/reports/outcome?baseRevision=2`,
    );
    expect(stalePlayer.response.status).toBe(200);
    expect(stalePlayer.body).toMatchObject({
      projection: 'player',
      status: 'stale',
      staleReasons: ['sourceSnapshotChanged'],
    });
    expect(JSON.stringify(stalePlayer.body)).not.toContain('private-source');
    const staleDirector = await requestJson<OutcomeResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/reports/outcome?baseRevision=2&projection=director`,
    );
    expect(staleDirector.response.status).toBe(200);
    expect(staleDirector.body.staleReasons).toContain(
      'sourceContentChanged:private-source',
    );
    expect((await chat(backend.url, {
      writingReferenceAttachmentIds: [staleAttachment.body.attachment.id],
    })).status).toBe(422);

    await writeFile(sourcePath, sourceText, 'utf-8');
    const adopted = await requestJson<AdoptionResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/reports/outcome/items/${selectedItem!.id}/adoption-candidate`,
      {
        method: 'POST',
        body: {
          baseRevision: 2,
          target: 'chapterDraft',
          payload: {
            chapterId: '0001/0002',
            content: '# Draft\n\nThe porter closes the outer gate.\n',
          },
        },
      },
    );
    expect(adopted.response.status).toBe(200);
    expect(adopted.body.candidate.sourceTurnIds).toContain(
      adopted.body.session.transcript.at(-1)!.id,
    );
    expect(adopted.body.observation.sourceTurnIds)
      .toEqual(adopted.body.candidate.sourceTurnIds);

    const revisionConflict = await requestJson<Record<string, unknown>>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/reports/outcome?baseRevision=2`,
    );
    expect(revisionConflict.response.status).toBe(409);

    await writeFile(sourcePath, `${sourceText}Drift before adoption.\n`, 'utf-8');
    const sourceDriftPendingAction = await requestJson<Record<string, unknown>>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/adoption-candidates/${adopted.body.candidate.id}/pending-action`,
      { method: 'POST', body: {} },
    );
    expect(sourceDriftPendingAction.response.status).toBe(409);
    expect(sourceDriftPendingAction.body).toMatchObject({
      code: 'play_adoption_preview_required',
    });

    await writeFile(sourcePath, sourceText, 'utf-8');
    const restored = await requestJson<{ session: { revision: number } }>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/checkpoints/turn-artifact-1/restore`,
      { method: 'POST', body: { baseRevision: 4 } },
    );
    expect(restored.response.status).toBe(200);
    const oldCandidate = await requestJson<Record<string, unknown>>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v4/adoption-candidates/${adopted.body.candidate.id}/pending-action`,
      { method: 'POST', body: {} },
    );
    expect([404, 409]).toContain(oldCandidate.response.status);
    const pendingActions = await requestJson<{ pendingActions: unknown[] }>(
      `${backend.url}/api/workspace/pending-actions`,
    );
    expect(pendingActions.body.pendingActions).toEqual([]);

    const listed = await requestJson<{ attachments: WritingAttachment[] }>(
      `${backend.url}/api/workspace/writing-references`,
    );
    expect(listed.response.status).toBe(200);
    expect(listed.body.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstAttachment.body.attachment.id, status: 'detached' }),
      expect.objectContaining({ id: staleAttachment.body.attachment.id, status: 'stale' }),
    ]));
  });

  it('blocks reports during an active rehearsal and carries v5 artifact provenance into adoption', async () => {
    const workspaceRoot = await createWorkspace();
    const backend = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: async function* () {
        yield 'Alice raises the valid ticket.';
      },
      runPlayRehearsalReferee: async () => playSettlement(
        'The warning lamp turns green.',
        1,
        false,
      ),
    });
    const created = await requestJson<{ session: { id: string; revision: number } }>(
      `${backend.url}/api/workspace/play-sessions`,
      { method: 'POST', body: rehearsalInput('play-outcome-v5') },
    );
    expect(created.response.status).toBe(200);

    const initialReport = await requestJson<OutcomeResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v5/reports/outcome`,
      { method: 'POST', body: { baseRevision: 0, projection: 'director' } },
    );
    expect(initialReport.response.status).toBe(200);

    const attempt = await requestJson<{ attempt: { id: string } }>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v5/attempts`,
      { method: 'POST', body: { baseRevision: 0 } },
    );
    expect(attempt.response.status).toBe(200);
    for (const request of [
      fetch(`${backend.url}/api/workspace/play-sessions/play-outcome-v5/reports/outcome?baseRevision=0&projection=director`),
      fetch(`${backend.url}/api/workspace/play-sessions/play-outcome-v5/reports/outcome`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 0, projection: 'director' }),
      }),
    ]) {
      expect((await request).status).toBe(409);
    }

    const streamed = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v5/attempts/${attempt.body.attempt.id}/steps/next/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedAttemptRevision: 0,
          idempotencyKey: 'outcome-v5-step',
          mode: 'next',
        }),
      },
    );
    expect(streamed.status).toBe(200);
    const prepared = parseSse(await streamed.text()).find((event) =>
      event.type === 'play.actor.step.prepared')!;
    const step = prepared.step as { id: string };
    const accepted = await requestJson<{ attempt: { attemptRevision: number } }>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v5/attempts/${attempt.body.attempt.id}/interventions`,
      {
        method: 'POST',
        body: {
          expectedAttemptRevision: 1,
          idempotencyKey: 'outcome-v5-accept',
          kind: 'accept',
          stepRef: step.id,
        },
      },
    );
    expect(accepted.response.status).toBe(200);
    const finalized = await requestJson<{ session: { revision: number } }>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v5/attempts/${attempt.body.attempt.id}/finalize`,
      {
        method: 'POST',
        body: {
          baseRevision: 0,
          expectedAttemptRevision: 2,
          idempotencyKey: 'outcome-v5-finalize',
          selectedHeadRef: step.id,
        },
      },
    );
    expect(finalized.response.status).toBe(200);
    expect(finalized.body.session.revision).toBe(1);

    const report = await requestJson<OutcomeResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v5/reports/outcome`,
      { method: 'POST', body: { baseRevision: 1, projection: 'director' } },
    );
    expect(report.response.status).toBe(200);
    const footprint = report.body.report.items.find((item) =>
      item.kind === 'participantFootprint' && item.summary.includes('valid ticket'));
    expect(footprint).toBeDefined();

    const adopted = await requestJson<AdoptionResponse>(
      `${backend.url}/api/workspace/play-sessions/play-outcome-v5/reports/outcome/items/${footprint!.id}/adoption-candidate`,
      {
        method: 'POST',
        body: {
          baseRevision: 1,
          target: 'chapterDraft',
          payload: {
            chapterId: '0001/0003',
            content: '# Rehearsal reference\n\nAlice raises the valid ticket.\n',
          },
        },
      },
    );
    expect(adopted.response.status).toBe(200);
    expect(adopted.body.candidate.sourceTurnIds).not.toEqual([]);
    expect(adopted.body.candidate.sourceObservationIds)
      .toEqual([adopted.body.observation.id]);
    expect(adopted.body.candidate.sourceTurnIds.every((messageId) =>
      adopted.body.session.transcript.some((message) => message.id === messageId)))
      .toBe(true);
  });
});

interface OutcomeItem {
  id: string;
  kind: string;
  summary: string;
  visibility: string;
  artifactTurnRefs: string[];
  messageRefs: string[];
  eventRefs: string[];
  observationRefs: string[];
  evidenceRefs: string[];
  sourceRefs: string[];
  participantRefs: string[];
}

interface OutcomeResponse {
  report: {
    sourceSnapshots: Array<{ sourceId: string }>;
    items: OutcomeItem[];
  };
  projection: string;
  status: string;
  staleReasons: string[];
  files?: string[];
}

interface WritingAttachment {
  id: string;
  sessionId: string;
  status: string;
  selectedOutcomeItemRefs: string[];
  detachedAt?: string;
}

interface AttachmentCreateResponse {
  attachment: WritingAttachment;
  files: string[];
}

interface AdoptionResponse {
  session: { transcript: Array<{ id: string }> };
  observation: { id: string; sourceTurnIds: string[] };
  candidate: {
    id: string;
    sourceObservationIds: string[];
    sourceTurnIds: string[];
  };
}

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-outcome-backend-'));
  workspaces.push(workspaceRoot);
  await mkdir(join(workspaceRoot, '.oan'), { recursive: true });
  await mkdir(join(workspaceRoot, 'chapters/0001'), { recursive: true });
  await writeFile(join(workspaceRoot, '.oan/config.yaml'), 'schemaVersion: 1\n');
  return workspaceRoot;
}

async function startBackend(
  workspaceRoot: string,
  options: Parameters<typeof startNovelHttpBackend>[0],
): Promise<NovelBackendHandle> {
  const backend = await startNovelHttpBackend({
    workspaceRoot,
    ...options,
  });
  backends.push(backend);
  return backend;
}

async function requestJson<T>(
  url: string,
  input: { method?: string; body?: unknown } = {},
): Promise<{ response: Response; body: T }> {
  const response = await fetch(url, {
    method: input.method,
    ...(input.body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input.body),
        }),
  });
  return { response, body: await response.json() as T };
}

async function chat(
  baseUrl: string,
  extra: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/api/agent/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Use the selected material.' }],
      }],
      ...extra,
    }),
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function playSettlement(
  narrative: string,
  turn: number,
  includeHidden = true,
): string {
  return [
    narrative,
    '```oan-play-settlement',
    JSON.stringify({
      events: [
        {
          kind: 'environmentChanged',
          origin: 'environment',
          title: `Public gate ${turn}`,
          summary: narrative,
          visibility: 'playerVisible',
          cause: { reason: 'The public mechanism advanced.' },
        },
        ...(includeHidden
          ? [{
              kind: 'informationSpread',
              origin: 'npc',
              title: `Private signal ${turn}`,
              summary: 'Private signal known only to the porter.',
              visibility: 'playerUnknown',
              cause: { reason: 'The porter sent a private code.' },
            }]
          : []),
      ],
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      stateDelta: {},
      observations: [],
      suggestedActions: [],
    }),
    '```',
  ].join('\n');
}

function rehearsalInput(id: string): Record<string, unknown> {
  return {
    id,
    title: 'Outcome v5',
    sceneStart: 'The station gate is about to close.',
    purpose: 'sceneRehearsal',
    sceneContract: {
      sceneId: 'scene-outcome-v5',
      worldClock: { turn: 0, revision: 0 },
      clockProvenance: { kind: 'newSessionInitial', sourceRefs: [] },
      participantRefs: ['participant-alice'],
      orderStrategy: 'directorFixed',
      objective: {
        value: 'Test whether Alice presents the ticket.',
        provenance: {
          kind: 'authorProvided',
          providedAt: '2026-07-16T00:00:00.000Z',
        },
      },
    },
    participants: [{
      participantRef: 'participant-alice',
      displayName: 'Alice',
      currentGoal: 'Present the valid ticket.',
      initialKnowledgeEvidenceRefs: ['knowledge-ticket'],
    }],
    initialKnowledgeEvidence: [{
      id: 'knowledge-ticket',
      participantRef: 'participant-alice',
      visibility: 'playerVisible',
      fact: 'Alice holds the valid ticket.',
      provenance: {
        kind: 'authorProvided',
        providedAt: '2026-07-16T00:00:00.000Z',
      },
    }],
  };
}

function parseSse(raw: string): Array<Record<string, unknown>> {
  return raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

async function* completedRuntimeEvents(): AsyncIterable<RuntimeEvent> {
  yield { type: 'message_start', messages: [] };
  yield {
    type: 'message_finish',
    result: {
      messages: [{ role: 'assistant', content: 'OK' }],
      assistantMessage: { role: 'assistant', content: 'OK' },
      toolLog: [],
      pendingActions: [],
      stoppedReason: 'completed',
    },
  };
}
