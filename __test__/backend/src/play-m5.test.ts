import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  startNovelHttpBackend,
  type NovelBackendHandle,
  type NovelBackendPlayTurnInput,
} from '@oh-awesome-novel/backend';
import { withPlaySessionFileTransaction } from '@oh-awesome-novel/core';

const workspaces: string[] = [];
const backends: NovelBackendHandle[] = [];

afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close();
  for (const workspace of workspaces.splice(0)) {
    await rm(workspace, { recursive: true, force: true });
  }
});

describe('Play M5 HTTP contracts', () => {
  it('serves bounded summaries/details and atomically persisted context traces', async () => {
    const workspaceRoot = await createWorkspace();
    const backend = await startBackend(workspaceRoot, {
      runPlayTurn: async (_input) => settlement('The world advances.'),
    });
    await createSession(backend.url, { id: 'play-long' });
    for (let revision = 0; revision < 5; revision += 1) {
      const turn = await requestJson<{ session: { revision: number } }>(
        `${backend.url}/api/workspace/play-sessions/play-long/world-referee-turn`,
        {
          method: 'POST',
          body: { userText: `Turn ${revision + 1}`, baseRevision: revision },
        },
      );
      expect(turn.response.status).toBe(200);
    }

    const summaries = await requestJson<{
      summaries: Array<Record<string, unknown>>;
    }>(`${backend.url}/api/workspace/play-session-summaries`);
    expect(summaries.response.status).toBe(200);
    expect(summaries.body.summaries).toEqual([
      expect.objectContaining({
        id: 'play-long',
        revision: 5,
        selectedTurnCount: 5,
        transcriptCount: 10,
        eventCount: 0,
        canonical: false,
      }),
    ]);
    expect(summaries.body.summaries[0]).not.toHaveProperty('transcript');
    expect(summaries.body.summaries[0]).not.toHaveProperty('events');
    expect(summaries.body.summaries[0]).not.toHaveProperty('turnArtifacts');

    const detail = await requestJson<{
      detail: {
        snapshot: Record<string, unknown>;
        transcript: {
          items: Array<{ content: string }>;
          nextCursor?: string;
          totalCount: number;
        };
      };
    }>(`${backend.url}/api/workspace/play-sessions/play-long/detail?limit=2`);
    expect(detail.response.status).toBe(200);
    expect(detail.body.detail.snapshot).not.toHaveProperty('transcript');
    expect(detail.body.detail.snapshot).not.toHaveProperty('events');
    expect(detail.body.detail.snapshot).not.toHaveProperty('turnArtifacts');
    expect(detail.body.detail.transcript).toMatchObject({
      totalCount: 10,
      items: [
        expect.objectContaining({ content: 'Turn 5' }),
        expect.objectContaining({ content: 'The world advances.' }),
      ],
    });

    const older = await requestJson<{
      detail: { transcript: { items: Array<{ content: string }> } };
    }>(`${backend.url}/api/workspace/play-sessions/play-long/detail?limit=2&transcriptCursor=${encodeURIComponent(detail.body.detail.transcript.nextCursor!)}`);
    expect(older.response.status).toBe(200);
    expect(older.body.detail.transcript.items.map((item) => item.content)).toEqual([
      'Turn 4',
      'The world advances.',
    ]);

    const traces = await requestJson<{
      traces: Array<{ artifactId: string; sessionRevision: number }>;
    }>(`${backend.url}/api/workspace/play-sessions/play-long/context-traces?limit=10`);
    expect(traces.response.status).toBe(200);
    expect(traces.body.traces).toHaveLength(5);
    expect(traces.body.traces[0]).toMatchObject({ sessionRevision: 5 });
  });

  it('keeps failed generations zero-write and filters explicitly frozen drift', async () => {
    const workspaceRoot = await createWorkspace();
    const sourcePath = join(workspaceRoot, 'world/rules.md');
    const oldSource = 'old canonical rule';
    const changedSource = 'changed canonical rule';
    await mkdir(join(workspaceRoot, 'world'), { recursive: true });
    await writeFile(sourcePath, oldSource, 'utf-8');
    const turnInputs: NovelBackendPlayTurnInput[] = [];
    let valid = false;
    const backend = await startBackend(workspaceRoot, {
      runPlayTurn: async (input) => {
        turnInputs.push(input);
        return valid ? settlement('Continued locally.') : 'invalid response';
      },
    });
    await createSession(backend.url, {
      id: 'play-drift',
      activatedSources: [{
        sourceId: 'world',
        path: 'world/rules.md',
        contentHash: sha256(oldSource),
        role: 'world',
        reason: 'World rules',
        budgetLayer: 'L1',
        semanticBoundary: 'protected',
        trust: 'canonical',
      }],
    });

    const failed = await requestJson<Record<string, unknown>>(
      `${backend.url}/api/workspace/play-sessions/play-drift/world-referee-turn`,
      { method: 'POST', body: { userText: 'Try', baseRevision: 0 } },
    );
    expect(failed.response.status).toBe(422);
    const noTraces = await requestJson<{ traces: unknown[] }>(
      `${backend.url}/api/workspace/play-sessions/play-drift/context-traces`,
    );
    expect(noTraces.body.traces).toEqual([]);

    await writeFile(sourcePath, changedSource, 'utf-8');
    const drift = await requestJson<{
      status: { overall: string; availableDecisions: string[] };
    }>(`${backend.url}/api/workspace/play-sessions/play-drift/source-drift`);
    expect(drift.body.status).toMatchObject({
      overall: 'drifted',
      availableDecisions: ['continueFrozen', 'reassemble', 'fork'],
    });

    const unresolved = await requestJson<Record<string, unknown>>(
      `${backend.url}/api/workspace/play-sessions/play-drift/world-referee-turn`,
      { method: 'POST', body: { userText: 'Do not mix', baseRevision: 0 } },
    );
    expect(unresolved.response.status).toBe(422);

    const continued = await requestJson<{
      session: { revision: number; activatedSources: Array<{ contentHash: string }> };
      status: { overall: string; activeResolution: { excludedSourceIds: string[] } };
    }>(`${backend.url}/api/workspace/play-sessions/play-drift/source-drift/decisions`, {
      method: 'POST',
      body: { kind: 'continueFrozen', baseRevision: 0 },
    });
    expect(continued.response.status).toBe(200);
    expect(continued.body.session.activatedSources[0]?.contentHash).toBe(sha256(oldSource));
    expect(continued.body.status).toMatchObject({
      overall: 'drifted',
      activeResolution: { excludedSourceIds: ['world'] },
    });

    valid = true;
    const committed = await requestJson<{ session: { revision: number } }>(
      `${backend.url}/api/workspace/play-sessions/play-drift/world-referee-turn`,
      { method: 'POST', body: { userText: 'Continue', baseRevision: 1 } },
    );
    expect(committed.response.status).toBe(200);
    expect(turnInputs.at(-1)?.request).not.toContain(changedSource);
    expect(turnInputs.at(-1)?.request).not.toContain(oldSource);
    const trace = await requestJson<{
      traces: Array<{ sources: Array<Record<string, unknown>> }>;
    }>(`${backend.url}/api/workspace/play-sessions/play-drift/context-traces`);
    expect(trace.body.traces[0]?.sources).toEqual([
      expect.objectContaining({
        sourceId: 'world',
        outcome: 'omitted',
        omissionReason: 'canonicalDrift',
        driftState: 'changed',
      }),
    ]);
    expect(await readFile(sourcePath, 'utf-8')).toBe(changedSource);
  });

  it('reassembles through CAS and forks without mutating the source session', async () => {
    const workspaceRoot = await createWorkspace();
    const sourcePath = join(workspaceRoot, 'world/rules.md');
    await mkdir(join(workspaceRoot, 'world'), { recursive: true });
    await writeFile(sourcePath, 'v1', 'utf-8');
    const backend = await startBackend(workspaceRoot, {});
    await createSession(backend.url, {
      id: 'play-source',
      activatedSources: [source('v1')],
    });
    await writeFile(sourcePath, 'v2', 'utf-8');

    const reassembled = await requestJson<{
      session: { revision: number; activatedSources: Array<{ contentHash: string }> };
      status: { overall: string };
    }>(`${backend.url}/api/workspace/play-sessions/play-source/source-drift/decisions`, {
      method: 'POST',
      body: { kind: 'reassemble', baseRevision: 0 },
    });
    expect(reassembled.response.status).toBe(200);
    expect(reassembled.body).toMatchObject({
      session: { revision: 1 },
      status: { overall: 'current' },
    });
    expect(reassembled.body.session.activatedSources[0]?.contentHash).toBe(sha256('v2'));

    await writeFile(sourcePath, 'v3', 'utf-8');
    const forked = await requestJson<{
      sourceSessionId: string;
      createdSessionId: string;
      session: { id: string; activatedSources: Array<{ contentHash: string }> };
    }>(`${backend.url}/api/workspace/play-sessions/play-source/source-drift/decisions`, {
      method: 'POST',
      body: {
        kind: 'fork',
        baseRevision: 1,
        newSessionId: 'play-source-fork',
        title: 'Forked source',
      },
    });
    expect(forked.response.status).toBe(201);
    expect(forked.body).toMatchObject({
      sourceSessionId: 'play-source',
      createdSessionId: 'play-source-fork',
      session: { id: 'play-source-fork' },
    });
    expect(forked.body.session.activatedSources[0]?.contentHash).toBe(sha256('v3'));

    const original = await requestJson<{
      session: { id: string; revision: number; activatedSources: Array<{ contentHash: string }> };
    }>(`${backend.url}/api/workspace/play-sessions/play-source`);
    expect(original.body.session).toMatchObject({ id: 'play-source', revision: 1 });
    expect(original.body.session.activatedSources[0]?.contentHash).toBe(sha256('v2'));
    expect(await readFile(sourcePath, 'utf-8')).toBe('v3');
  });

  it('holds the source revision lock until a fork target commits', async () => {
    const workspaceRoot = await createWorkspace();
    const sourcePath = join(workspaceRoot, 'world/rules.md');
    await mkdir(join(workspaceRoot, 'world'), { recursive: true });
    await writeFile(sourcePath, 'v1', 'utf-8');
    const forkBackend = await startBackend(workspaceRoot, {});
    const mutationBackend = await startBackend(workspaceRoot, {});
    await createSession(forkBackend.url, {
      id: 'aa-source',
      activatedSources: [source('v1')],
    });
    await writeFile(sourcePath, 'v2', 'utf-8');

    type ForkResponse = {
      createdSessionId: string;
      resolution: { sourceRevision: number };
      session: { id: string; revision: number };
    };
    type MutationResponse = {
      session: { id: string; revision: number; observations: unknown[] };
    };
    let forkRequest:
      | Promise<{ response: Response; body: ForkResponse }>
      | undefined;
    let mutationRequest:
      | Promise<{ response: Response; body: MutationResponse }>
      | undefined;

    await withPlaySessionFileTransaction(
      workspaceRoot,
      'zz-fork',
      async () => {
        forkRequest = requestJson<ForkResponse>(
          `${forkBackend.url}/api/workspace/play-sessions/aa-source/source-drift/decisions`,
          {
            method: 'POST',
            body: {
              kind: 'fork',
              baseRevision: 0,
              newSessionId: 'zz-fork',
            },
          },
        );
        await waitForPath(join(
          workspaceRoot,
          '.workspace/play-sessions/.write-locks/aa-source.lock/owner.json',
        ));

        mutationRequest = requestJson<MutationResponse>(
          `${mutationBackend.url}/api/workspace/play-sessions/aa-source/observations`,
          {
            method: 'POST',
            body: {
              summary: 'Concurrent source mutation',
              evidence: 'M5 fork CAS regression',
              baseRevision: 0,
            },
          },
        );
        const mutationState = await Promise.race([
          mutationRequest.then(
            () => 'completed' as const,
            () => 'failed' as const,
          ),
          new Promise<'blocked'>((resolveWait) => {
            setTimeout(() => resolveWait('blocked'), 75);
          }),
        ]);
        expect(mutationState).toBe('blocked');
      },
    );

    if (!forkRequest || !mutationRequest) {
      throw new Error('Expected concurrent M5 requests to start.');
    }
    const [forked, mutated] = await Promise.all([forkRequest, mutationRequest]);
    expect(forked.response.status).toBe(201);
    expect(forked.body).toMatchObject({
      createdSessionId: 'zz-fork',
      resolution: { sourceRevision: 0 },
      session: { id: 'zz-fork', revision: 1 },
    });
    expect(mutated.response.status).toBe(200);
    expect(mutated.body.session).toMatchObject({
      id: 'aa-source',
      revision: 1,
      observations: [expect.objectContaining({
        summary: 'Concurrent source mutation',
      })],
    });
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-m5-backend-'));
  workspaces.push(root);
  await mkdir(join(root, '.oan'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n', 'utf-8');
  return root;
}

async function startBackend(
  workspaceRoot: string,
  options: Parameters<typeof startNovelHttpBackend>[0],
): Promise<NovelBackendHandle> {
  const backend = await startNovelHttpBackend({ workspaceRoot, ...options });
  backends.push(backend);
  return backend;
}

async function createSession(
  baseUrl: string,
  input: { id: string; activatedSources?: unknown[] },
): Promise<void> {
  const response = await requestJson<Record<string, unknown>>(
    `${baseUrl}/api/workspace/play-sessions`,
    {
      method: 'POST',
      body: {
        id: input.id,
        title: input.id,
        sceneStart: 'At the gate',
        characters: [],
        ...(input.activatedSources
          ? { activatedSources: input.activatedSources }
          : {}),
      },
    },
  );
  expect(response.response.status).toBe(200);
}

function source(content: string): Record<string, unknown> {
  return {
    sourceId: 'world',
    path: 'world/rules.md',
    contentHash: sha256(content),
    role: 'world',
    reason: 'World rules',
    budgetLayer: 'L1',
    semanticBoundary: 'protected',
    trust: 'canonical',
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function settlement(narrative: string): string {
  return [
    narrative,
    '```oan-play-settlement',
    JSON.stringify({
      events: [],
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      knowledgeChanges: [],
      stateDelta: {},
      observations: [],
      suggestedActions: [],
    }),
    '```',
  ].join('\n');
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

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      await access(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 2));
  }
  throw new Error(`Timed out waiting for path: ${path}`);
}
