import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
import { createWriteIntentTools } from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

const tempRoots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }

  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('novel HTTP backend', () => {
  it('streams AI SDK UI message SSE chunks for an agent chat request', async () => {
    const workspaceRoot = await createTempWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runAgent: () => scriptedRuntimeEvents(),
    });
    servers.push(backend);

    const response = await fetch(`${backend.url}/api/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          },
        ],
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain('Hello from backend');
    expect(body).toContain('"type":"data-tool-log"');
  });

  it('uses the default AI SDK model resolver when provider config is present', async () => {
    const modelServer = await startModelListServer();
    servers.push(modelServer);
    const backend = await startNovelHttpBackend({
      workspaceRoot: await createOanWorkspace(),
      providerConfig: {
        id: 'custom',
        kind: 'custom',
        baseUrl: `${modelServer.url}/v1`,
        model: 'custom-large',
        apiKey: 'custom-secret',
      },
    });
    servers.push(backend);

    const response = await fetch(`${backend.url}/api/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'user-1',
            role: 'user',
            parts: [{ type: 'text', text: '请回复 OK，不要调用工具。' }],
          },
        ],
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain('OK');
  });

  it('exposes a health endpoint', async () => {
    const workspaceRoot = await createTempWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);

    await expect(fetch(`${backend.url}/api/health`).then((res) => res.json()))
      .resolves
      .toEqual({ ok: true });
  });

  it('stores app config in the global config directory', async () => {
    const workspaceRoot = await createTempWorkspace();
    const globalConfigDir = await createTempWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot, globalConfigDir });
    servers.push(backend);

    await expect(fetchJson(`${backend.url}/api/app-config`))
      .resolves
      .toEqual({ config: {} });

    await expect(fetchJson(`${backend.url}/api/app-config`, {
      method: 'PATCH',
      body: JSON.stringify({
        theme: 'dark',
        composerSubmitShortcut: 'ctrl-enter',
      }),
    }))
      .resolves
      .toEqual({
        config: {
          theme: 'dark',
          composerSubmitShortcut: 'ctrl-enter',
        },
      });

    await expect(readFile(join(globalConfigDir, 'app-config.json'), 'utf-8'))
      .resolves
      .toContain('"composerSubmitShortcut": "ctrl-enter"');
  });

  it('supports launcher workspace flow and read-only workspace endpoints', async () => {
    const workspaceRoot = await createOanWorkspace();
    const globalConfigDir = await createTempWorkspace();
    const backend = await startNovelHttpBackend({
      seedWorkspaceRoot: workspaceRoot,
      globalConfigDir,
    });
    servers.push(backend);

    const list = await fetchJson<{ workspaces: Array<{ path: string; name: string }> }>(
      `${backend.url}/api/workspaces`,
    );
    expect(list.workspaces).toEqual([
      expect.objectContaining({
        name: 'backend-sample',
      }),
    ]);

    const invalidImport = await fetch(`${backend.url}/api/workspaces/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: globalConfigDir }),
    });
    expect(invalidImport.status).toBe(400);

    const opened = await fetchJson<{ providerConfigured: boolean }>(
      `${backend.url}/api/workspaces/open`,
      {
        method: 'POST',
        body: JSON.stringify({ path: workspaceRoot }),
      },
    );
    expect(opened.providerConfigured).toBe(false);

    await expect(fetchJson(`${backend.url}/api/workspace/tree`))
      .resolves
      .toMatchObject({
        tree: expect.arrayContaining([
          expect.objectContaining({ path: 'chapters', type: 'directory' }),
        ]),
      });
    await expect(fetchJson(`${backend.url}/api/workspace/file?path=chapters%2F0001%2F0001.md`))
      .resolves
      .toMatchObject({
        path: 'chapters/0001/0001.md',
        content: expect.stringContaining('第一章'),
      });
    await expect(fetchJson(`${backend.url}/api/workspace/status`))
      .resolves
      .toMatchObject({
        pendingActionCount: 0,
        gitConfig: {
          autoCommitOnAccept: true,
        },
        git: {
          status: 'unknown',
          dirty: null,
        },
      });
    await expect(fetchJson(`${backend.url}/api/workspace/project-health`))
      .resolves
      .toMatchObject({
        health: {
          pendingActionCount: 0,
          activeHookCount: 0,
          issues: expect.any(Array),
        },
      });
    await expect(fetchJson(`${backend.url}/api/workspace/chapters/rescan`, { method: 'POST' }))
      .resolves
      .toMatchObject({
        index: {
          volumes: [
            expect.objectContaining({
              id: '0001',
              chapters: [
                expect.objectContaining({ id: '0001/0001' }),
              ],
            }),
          ],
        },
      });
  });

  it('imports reference works and selects only enabled distilled context', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);

    const imported = await fetchJson<{
      reference: {
        id: string;
        title: string;
        bundlePath: string;
        summaryPath: string;
        chapterCount: number;
      };
      manifest: { detectedStructure: { chapterCount: number } };
      createdFiles: string[];
    }>(`${backend.url}/api/workspace/references/import`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Backend Reference',
        sourceText: '第一章 开端\n一句样本文字。\n第二章 推进\n另一句样本文字。',
        sourceType: 'novel',
        rights: 'owned',
        allowedUsage: ['analysisOnly', 'styleInspiration', 'noDirectQuotation'],
      }),
    });

    expect(imported.reference).toMatchObject({
      title: 'Backend Reference',
      chapterCount: 2,
    });
    expect(imported.createdFiles).toContain(`${imported.reference.bundlePath}/context/reference-summary.md`);

    await expect(fetchJson(`${backend.url}/api/workspace/references`))
      .resolves
      .toMatchObject({
        references: [
          expect.objectContaining({
            id: imported.reference.id,
            enabled: true,
          }),
        ],
      });

    await expect(fetchJson(`${backend.url}/api/workspace/references/context`, {
      method: 'POST',
      body: JSON.stringify({ tokenBudget: 2000 }),
    }))
      .resolves
      .toMatchObject({
        selection: {
          included: [
            expect.objectContaining({
              id: imported.reference.id,
              path: imported.reference.summaryPath,
            }),
          ],
        },
      });

    await expect(fetchJson(`${backend.url}/api/workspace/references/${imported.reference.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    }))
      .resolves
      .toMatchObject({
        reference: {
          id: imported.reference.id,
          enabled: false,
        },
      });

    await expect(fetchJson(`${backend.url}/api/workspace/references/context`, {
      method: 'POST',
      body: JSON.stringify({ tokenBudget: 2000 }),
    }))
      .resolves
      .toMatchObject({
        selection: {
          included: [],
          omitted: [
            expect.objectContaining({
              id: imported.reference.id,
              reason: 'disabled',
            }),
          ],
        },
      });

    await expect(readFile(join(workspaceRoot, imported.reference.summaryPath), 'utf-8'))
      .resolves
      .toContain('Original source is retained');
  });

  it('creates a workspace and stores onboarding answers', async () => {
    const targetRoot = await createTempWorkspace();
    const globalConfigDir = await createTempWorkspace();
    const backend = await startNovelHttpBackend({ globalConfigDir });
    servers.push(backend);
    const canonicalTargetRoot = await realpath(targetRoot);

    const created = await fetchJson<{
      workspace: { path: string; name: string };
      providerConfigured: boolean;
      onboarding: { show: boolean };
    }>(`${backend.url}/api/workspaces/create`, {
      method: 'POST',
      body: JSON.stringify({ path: targetRoot }),
    });

    expect(created).toMatchObject({
      workspace: {
        path: canonicalTargetRoot,
      },
      providerConfigured: false,
      onboarding: { show: true },
    });
    await expect(readFile(join(targetRoot, '.oan/config.yaml'), 'utf-8'))
      .resolves
      .toContain('version: 1');

    const saved = await fetchJson<{
      workspace: { name: string; novelName: string };
      config: { novelName: string; onboarding: { completed: boolean; skipped: boolean } };
    }>(`${backend.url}/api/workspace/onboarding`, {
      method: 'POST',
      body: JSON.stringify({
        novelName: '雾港来信',
        inspiration: '一封迟到十年的信。',
        characterSeed: '先生成女主和调查员。',
        startGoal: 'characters',
      }),
    });

    expect(saved).toMatchObject({
      workspace: {
        name: '雾港来信',
        novelName: '雾港来信',
      },
      config: {
        novelName: '雾港来信',
        onboarding: {
          completed: true,
          skipped: false,
        },
      },
    });
    await expect(readFile(join(targetRoot, '.oan/config.yaml'), 'utf-8'))
      .resolves
      .toContain('novelName: 雾港来信');
  });

  it('lists and accepts persisted PendingActions through workspace approval endpoints', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'summary.generateChapter', {
      chapterId: '0001/0001',
      content: '# 第一章\n\n审批接口生成的新摘要。\n',
    });
    const action = expectSinglePendingAction(result);

    await expect(fetchJson<{ pendingActions: Array<{ id: string }> }>(
      `${backend.url}/api/workspace/pending-actions`,
    ))
      .resolves
      .toMatchObject({
        pendingActions: [expect.objectContaining({ id: action.id })],
      });

    await expect(fetchJson(`${backend.url}/api/workspace/pending-actions/${action.id}/accept`, {
      method: 'POST',
    }))
      .resolves
      .toMatchObject({
        id: action.id,
        status: 'accepted',
        appliedFiles: ['summaries/chapter/0001/0001.md'],
      });

    await expect(fetchJson<{ pendingActions: unknown[] }>(
      `${backend.url}/api/workspace/pending-actions`,
    ))
      .resolves
      .toMatchObject({ pendingActions: [] });
    await expect(
      readFile(join(workspaceRoot, 'summaries/chapter/0001/0001.md'), 'utf-8'),
    ).resolves.toContain('新摘要');
  });

  it('rebuilds projections through an explicit workspace endpoint', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);

    await expect(fetchJson(`${backend.url}/api/workspace/projections/rebuild`, {
      method: 'POST',
    }))
      .resolves
      .toMatchObject({
        projections: expect.arrayContaining([
          expect.objectContaining({ path: '.oan/indexes/state.md' }),
          expect.objectContaining({ path: '.oan/indexes/context-snapshot.md' }),
        ]),
        warnings: [expect.stringContaining('not canonical truth')],
      });
    await expect(readFile(join(workspaceRoot, '.oan/indexes/state.md'), 'utf-8'))
      .resolves
      .toContain('Generated projection');
  });

  it('creates Play sessions and converts adoption candidates into PendingActions', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);

    const created = await fetchJson<{
      session: { id: string; title: string; transcript: unknown[] };
      files: string[];
    }>(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        title: '雨夜试跑',
        sceneStart: '码头雨夜',
        characters: ['heroine'],
      }),
    });

    expect(created.session).toMatchObject({
      title: '雨夜试跑',
      transcript: [],
    });
    expect(created.files).toContain(
      join(workspaceRoot, '.workspace/play-sessions', created.session.id, 'session.yaml'),
    );

    await expect(fetchJson(`${backend.url}/api/workspace/play-sessions/${created.session.id}/transcript`, {
      method: 'POST',
      body: JSON.stringify({
        speaker: 'heroine',
        content: '她在雨里停住。',
      }),
    }))
      .resolves
      .toMatchObject({
        session: {
          transcript: [
            expect.objectContaining({ speaker: 'heroine' }),
          ],
        },
      });

    const candidateResult = await fetchJson<{
      candidate: { id: string };
    }>(`${backend.url}/api/workspace/play-sessions/${created.session.id}/adoption-candidates`, {
      method: 'POST',
      body: JSON.stringify({
        target: 'chapterDraft',
        summary: '转成下一章草稿',
        evidence: 'Play transcript turn',
        payload: {
          chapterId: '0001/0002',
          content: '# 第二章\n\n她在雨里停住。\n',
        },
      }),
    });

    await expect(fetchJson(`${backend.url}/api/workspace/play-sessions/${created.session.id}/adoption-candidates/${candidateResult.candidate.id}/pending-action`, {
      method: 'POST',
    }))
      .resolves
      .toMatchObject({
        pendingActionResult: {
          pendingActions: [
            expect.objectContaining({
              touchedFiles: ['chapters/0001/0002.md'],
            }),
          ],
        },
        refresh: {
          workspaceStatus: {
            pendingActionCount: 1,
          },
        },
      });
    await expect(readFile(join(workspaceRoot, 'chapters/0001/0002.md'), 'utf-8'))
      .rejects
      .toThrow();
  });

  it('commits an injected Play referee settlement to Play-local world state only', async () => {
    const workspaceRoot = await createOanWorkspace();
    const canonicalChapterPath = join(workspaceRoot, 'chapters/0001/0001.md');
    const canonicalChapterBefore = await readFile(canonicalChapterPath, 'utf-8');
    const interactionPath = join(workspaceRoot, 'characters/heroine/interaction.md');
    let playTurnRequest = '';
    await mkdir(join(workspaceRoot, 'characters/heroine'), { recursive: true });
    await writeFile(interactionPath, '她在压力下会先观察出口。\n', 'utf-8');
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async (input) => {
        playTurnRequest = input.request;
        return [
          '远处的铁门落锁，东侧入口已被控制。',
          '',
          '```oan-play-settlement',
          JSON.stringify({
            elapsed: '35 minutes',
            worldTimeAnchor: 'midnight',
            events: [
              {
                kind: 'npcActed',
                origin: 'npc',
                title: '封锁推进',
                summary: '东侧入口被控制',
                visibility: 'playerVisible',
                cause: { reason: '组织原有计划在本回合推进' },
              },
            ],
            stateDelta: { stationStatus: 'blocked' },
            observations: [
              { summary: '封锁已推进', evidence: 'event settlement' },
            ],
            suggestedActions: ['调查东侧入口'],
          }),
          '```',
        ].join('\n');
      },
    });
    servers.push(backend);

    const created = await fetchJson<{
      session: { id: string; revision: number; transcript: unknown[] };
    }>(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-world-turn',
        title: '车站试演',
        sceneStart: '子夜车站',
        characters: ['heroine'],
        activatedSources: [{
          sourceId: 'heroine.interaction',
          path: 'characters/heroine/interaction.md',
          reason: 'voice and reaction hint',
          budgetLayer: 'L1',
          semanticBoundary: 'compressible',
          trust: 'interactionHint',
        }],
      }),
    });

    expect(created.session).toMatchObject({
      id: 'play-world-turn',
      revision: 0,
      transcript: [],
    });

    const committed = await fetchJson<{
      session: {
        id: string;
        revision: number;
        transcript: Array<{ speaker: string; content: string; actionKind?: string }>;
        playLocalState: Record<string, unknown>;
        worldClock: { turn: number; revision: number; anchor?: string; elapsed?: string };
        events: Array<Record<string, unknown>>;
        observations: Array<Record<string, unknown>>;
        suggestedActions: string[];
      };
    }>(`${backend.url}/api/workspace/play-sessions/${created.session.id}/world-referee-turn`, {
      method: 'POST',
      body: JSON.stringify({
        userText: '等待并观察封锁变化',
        actionKind: 'wait',
        baseRevision: 0,
      }),
    });

    expect(committed.session).toMatchObject({
      id: 'play-world-turn',
      revision: 1,
      transcript: [
        expect.objectContaining({
          speaker: 'user',
          content: '等待并观察封锁变化',
          actionKind: 'wait',
        }),
        expect.objectContaining({
          speaker: 'world-referee',
          content: '远处的铁门落锁，东侧入口已被控制。',
        }),
      ],
      playLocalState: { stationStatus: 'blocked' },
      worldClock: {
        turn: 1,
        revision: 1,
        anchor: 'midnight',
        elapsed: '35 minutes',
      },
      suggestedActions: ['调查东侧入口'],
    });
    expect(committed.session.transcript[1]?.content).not.toContain('oan-play-settlement');
    expect(committed.session.events).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        turnId: expect.any(String),
        sequence: 1,
        kind: 'npcActed',
        origin: 'npc',
        title: '封锁推进',
        summary: '东侧入口被控制',
        visibility: 'playerVisible',
        worldClock: expect.objectContaining({ turn: 1, revision: 1, anchor: 'midnight' }),
        canonical: false,
        createdAt: expect.any(String),
      }),
    ]);
    expect(committed.session.observations).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        summary: '封锁已推进',
        evidence: 'event settlement',
        canonical: false,
      }),
    ]);
    expect(playTurnRequest).toContain('她在压力下会先观察出口。');
    expect(playTurnRequest).toContain('Trust: interactionHint');
    expect(playTurnRequest).toContain('User turn: 等待并观察封锁变化');

    await expect(fetchJson<{
      session: {
        revision: number;
        worldClock: { turn: number; revision: number };
        events: Array<Record<string, unknown>>;
        playLocalState: Record<string, unknown>;
        observations: Array<Record<string, unknown>>;
      };
    }>(`${backend.url}/api/workspace/play-sessions/${created.session.id}`))
      .resolves
      .toMatchObject({
        session: {
          revision: 1,
          worldClock: { turn: 1, revision: 1 },
          events: [expect.objectContaining({ kind: 'npcActed', sequence: 1 })],
          playLocalState: { stationStatus: 'blocked' },
          observations: [expect.objectContaining({ summary: '封锁已推进' })],
        },
      });
    await expect(readFile(canonicalChapterPath, 'utf-8'))
      .resolves
      .toBe(canonicalChapterBefore);
  });

  it('rejects a referee response without the structured settlement block', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async () => '只有叙事，没有结构化结算。',
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-missing-settlement',
        title: 'Missing settlement',
        sceneStart: 'Archive room',
      }),
    });
    const response = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-missing-settlement/world-referee-turn`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '等待', actionKind: 'wait', baseRevision: 0 }),
      },
    );

    expect(response.status).toBe(422);
    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-missing-settlement`,
    )).resolves.toMatchObject({
      session: { revision: 0, transcript: [], events: [], playLocalState: {} },
    });
  });

  it('does not load an activated source that resolves outside the workspace', async () => {
    const workspaceRoot = await createOanWorkspace();
    const outsideRoot = await createTempWorkspace();
    const outsideFile = join(outsideRoot, 'provider-secret.md');
    const linkPath = join(workspaceRoot, 'world/outside-source.md');
    let request = '';
    await mkdir(join(workspaceRoot, 'world'), { recursive: true });
    await writeFile(outsideFile, 'SHOULD_NOT_REACH_PROVIDER\n', 'utf-8');
    await symlink(outsideFile, linkPath);
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async (input) => {
        request = input.request;
        return [
          '房间没有发生明显变化。',
          '```oan-play-settlement',
          JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] }),
          '```',
        ].join('\n');
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-source-boundary',
        title: 'Source boundary',
        sceneStart: 'Archive room',
        activatedSources: [{
          sourceId: 'outside',
          path: 'world/outside-source.md',
          reason: 'untrusted source',
          budgetLayer: 'L1',
          semanticBoundary: 'compressible',
          trust: 'interactionHint',
        }],
      }),
    });
    await fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-source-boundary/world-referee-turn`,
      {
        method: 'POST',
        body: JSON.stringify({ userText: '观察', actionKind: 'look', baseRevision: 0 }),
      },
    );

    expect(request).not.toContain('SHOULD_NOT_REACH_PROVIDER');
  });

  it('serializes all mutations for one Play session', async () => {
    const workspaceRoot = await createOanWorkspace();
    let markStarted: (() => void) | undefined;
    let finishTurn: ((value: string) => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const refereeResponse = new Promise<string>((resolve) => {
      finishTurn = resolve;
    });
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async () => {
        markStarted?.();
        return refereeResponse;
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-shared-lock',
        title: 'Shared lock',
        sceneStart: 'Archive room',
      }),
    });
    const runningTurn = fetch(
      `${backend.url}/api/workspace/play-sessions/play-shared-lock/world-referee-turn`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '等待', actionKind: 'wait', baseRevision: 0 }),
      },
    );
    await started;

    const competingMutation = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-shared-lock/transcript`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          speaker: 'note',
          content: 'This must not race.',
          baseRevision: 0,
        }),
      },
    );
    expect(competingMutation.status).toBe(409);

    finishTurn?.([
      '时间过去了。',
      '```oan-play-settlement',
      JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] }),
      '```',
    ].join('\n'));
    expect((await runningTurn).status).toBe(200);
  });

  it('rejects duplicate explicit Play session ids without overwriting the session', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    const endpoint = `${backend.url}/api/workspace/play-sessions`;

    await fetchJson(endpoint, {
      method: 'POST',
      body: JSON.stringify({ id: 'play-duplicate', title: 'First', sceneStart: 'Scene one' }),
    });
    await fetchJson(`${endpoint}/play-duplicate/transcript`, {
      method: 'POST',
      body: JSON.stringify({ speaker: 'note', content: 'Preserve me', baseRevision: 0 }),
    });
    const duplicate = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'play-duplicate', title: 'Second', sceneStart: 'Scene two' }),
    });

    expect(duplicate.status).toBe(409);
    await expect(fetchJson(`${endpoint}/play-duplicate`)).resolves.toMatchObject({
      session: {
        title: 'First',
        revision: 1,
        transcript: [expect.objectContaining({ content: 'Preserve me' })],
      },
    });
  });

  it('rejects an invalid Play settlement without committing a partial turn', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async () => [
        '这段叙事不应被提交。',
        '',
        '```oan-play-settlement',
        '{"events": [}',
        '```',
      ].join('\n'),
    });
    servers.push(backend);

    const created = await fetchJson<{
      session: { id: string; revision: number; transcript: unknown[] };
    }>(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-invalid-turn',
        title: '无效结算测试',
        sceneStart: '子夜车站',
      }),
    });
    const transcriptPath = join(
      workspaceRoot,
      '.workspace/play-sessions',
      created.session.id,
      'transcript.md',
    );
    const transcriptBefore = await readFile(transcriptPath, 'utf-8');

    const response = await fetch(
      `${backend.url}/api/workspace/play-sessions/${created.session.id}/world-referee-turn`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userText: '等待',
          actionKind: 'wait',
          baseRevision: 0,
        }),
      },
    );
    const errorPayload = await response.json() as { error?: string };

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(errorPayload).toEqual({ error: expect.any(String) });
    await expect(fetchJson(`${backend.url}/api/workspace/play-sessions/${created.session.id}`))
      .resolves
      .toMatchObject({
        session: {
          revision: 0,
          transcript: [],
          playLocalState: {},
          worldClock: { turn: 0, revision: 0 },
          events: [],
          observations: [],
        },
      });
    await expect(readFile(transcriptPath, 'utf-8')).resolves.toBe(transcriptBefore);
  });

  it('rejects stale Play base revisions before invoking the referee', async () => {
    const workspaceRoot = await createOanWorkspace();
    let refereeCalled = false;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async () => {
        refereeCalled = true;
        return 'This should not run.';
      },
    });
    servers.push(backend);

    const created = await fetchJson<{ session: { id: string } }>(
      `${backend.url}/api/workspace/play-sessions`,
      {
        method: 'POST',
        body: JSON.stringify({
          id: 'play-stale-revision',
          title: 'Revision test',
          sceneStart: 'Archive room',
        }),
      },
    );
    await fetchJson(
      `${backend.url}/api/workspace/play-sessions/${created.session.id}/transcript`,
      {
        method: 'POST',
        body: JSON.stringify({ speaker: 'note', content: 'Session edited.' }),
      },
    );

    const response = await fetch(
      `${backend.url}/api/workspace/play-sessions/${created.session.id}/world-referee-turn`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userText: 'Continue',
          actionKind: 'do',
          baseRevision: 0,
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(refereeCalled).toBe(false);
    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/${created.session.id}`,
    )).resolves.toMatchObject({
      session: {
        revision: 1,
        worldClock: { turn: 0, revision: 1 },
        transcript: [expect.objectContaining({ content: 'Session edited.' })],
      },
    });
  });

  it('exposes Git status and quick commit endpoints', async () => {
    const workspaceRoot = await createOanWorkspace();
    await initGitRepo(workspaceRoot);
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    await writeFile(join(workspaceRoot, 'chapters/0001/0001.md'), '# 第一章\n\n更新后的正文。\n', 'utf-8');

    await expect(fetchJson(`${backend.url}/api/git/status`))
      .resolves
      .toMatchObject({
        repository: true,
        status: 'dirty',
        files: [expect.objectContaining({ path: 'chapters/0001/0001.md' })],
      });

    await expect(fetchJson(`${backend.url}/api/git/commit`, {
      method: 'POST',
      body: JSON.stringify({
        files: ['chapters/0001/0001.md'],
        message: 'chore(novel): quick commit test',
      }),
    }))
      .resolves
      .toMatchObject({
        status: 'committed',
        message: 'chore(novel): quick commit test',
      });
  });

  it('stores multiple provider configs outside the novel workspace runtime', async () => {
    const workspaceRoot = await createTempWorkspace();
    const globalConfigDir = await createTempWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot, globalConfigDir });
    servers.push(backend);

    await expect(fetchJson(`${backend.url}/api/provider-config`))
      .resolves
      .toMatchObject({ configured: false, providers: [] });

    const firstProviderSave = await fetchJson<{
      providers: Array<{ id: string; hasApiKey?: boolean; apiKey?: string }>;
    }>(`${backend.url}/api/provider-config`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'default',
        kind: 'deepseek',
        model: 'deepseek-chat',
        models: [
          { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
          { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
        ],
        apiKey: 'deepseek-secret',
        default: true,
      }),
    });
    expect(firstProviderSave).toMatchObject({
      configured: true,
      defaultProviderId: 'default',
      providers: [
        expect.objectContaining({
          id: 'default',
          hasApiKey: true,
          model: 'deepseek-chat',
          models: [
            expect.objectContaining({ id: 'deepseek-chat', default: true }),
            expect.objectContaining({ id: 'deepseek-reasoner', default: false }),
          ],
        }),
      ],
    });
    expect(firstProviderSave.providers[0]).not.toHaveProperty('apiKey');

    await expect(fetchJson(`${backend.url}/api/provider-config`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'openai',
        kind: 'openai',
        model: 'gpt-4.1-mini',
        apiKey: 'openai-secret',
      }),
    }))
      .resolves
      .toMatchObject({
        configured: true,
        defaultProviderId: 'default',
        providers: [
          expect.objectContaining({ id: 'default', default: true }),
          expect.objectContaining({ id: 'openai', default: false, hasApiKey: true }),
        ],
      });

    await expect(fetchJson(`${backend.url}/api/provider-config/openai/default`, {
      method: 'POST',
    }))
      .resolves
      .toMatchObject({
        defaultProviderId: 'openai',
        providers: [
          expect.objectContaining({ id: 'default', default: false }),
          expect.objectContaining({ id: 'openai', default: true }),
        ],
      });

    await backend.close();
    servers.splice(servers.indexOf(backend), 1);

    const restartedBackend = await startNovelHttpBackend({ workspaceRoot, globalConfigDir });
    servers.push(restartedBackend);

    await expect(fetchJson(`${restartedBackend.url}/api/provider-config`))
      .resolves
      .toMatchObject({
        configured: true,
        defaultProviderId: 'openai',
        providers: [
          expect.objectContaining({
            id: 'default',
            hasApiKey: true,
            models: [
              expect.objectContaining({ id: 'deepseek-chat' }),
              expect.objectContaining({ id: 'deepseek-reasoner' }),
            ],
          }),
          expect.objectContaining({
            id: 'openai',
            hasApiKey: true,
          }),
        ],
      });
  });

  it('fetches OpenAI-compatible model lists through the backend', async () => {
    const modelServer = await startModelListServer();
    servers.push(modelServer);
    const backend = await startNovelHttpBackend({
      workspaceRoot: await createTempWorkspace(),
      globalConfigDir: await createTempWorkspace(),
    });
    servers.push(backend);

    await expect(fetchJson(`${backend.url}/api/provider-config/models`, {
      method: 'POST',
      body: JSON.stringify({
        baseUrl: `${modelServer.url}/v1`,
        apiKey: 'custom-secret',
      }),
    }))
      .resolves
      .toMatchObject({
        models: [
          { id: 'custom-large', displayName: 'Custom Large', contextWindow: 128000 },
          { id: 'custom-small' },
        ],
      });
  });

  it('supports local Ollama model lists and checks without API keys', async () => {
    const ollamaServer = await startOllamaServer();
    servers.push(ollamaServer);
    const backend = await startNovelHttpBackend({
      workspaceRoot: await createTempWorkspace(),
      globalConfigDir: await createTempWorkspace(),
    });
    servers.push(backend);

    await expect(fetchJson(`${backend.url}/api/provider-config/models`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'ollama',
        baseUrl: `${ollamaServer.url}/v1`,
      }),
    }))
      .resolves
      .toMatchObject({
        models: [
          { id: 'llama3.2:latest', displayName: 'llama3.2:latest (3.2B)' },
        ],
      });

    await expect(fetchJson(`${backend.url}/api/provider-config`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'ollama',
        kind: 'ollama',
        baseUrl: `${ollamaServer.url}/v1`,
        model: 'llama3.2:latest',
        models: [{ id: 'llama3.2:latest', displayName: 'llama3.2:latest (3.2B)' }],
        default: true,
      }),
    }))
      .resolves
      .toMatchObject({
        providers: [
          expect.objectContaining({
            id: 'ollama',
            hasApiKey: false,
            model: 'llama3.2:latest',
          }),
        ],
      });

    await expect(fetchJson(`${backend.url}/api/provider-config/check`, {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'ollama',
      }),
    }))
      .resolves
      .toMatchObject({
        ok: true,
        model: 'llama3.2:latest',
        status: 200,
        message: 'OK',
        latencyMs: expect.any(Number),
      });
  });

  it('checks OpenAI-compatible models through the backend', async () => {
    const modelServer = await startModelListServer();
    servers.push(modelServer);
    const backend = await startNovelHttpBackend({
      workspaceRoot: await createTempWorkspace(),
      globalConfigDir: await createTempWorkspace(),
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/provider-config`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'custom',
        kind: 'custom',
        baseUrl: `${modelServer.url}/v1`,
        model: 'custom-large',
        apiKey: 'custom-secret',
        default: true,
      }),
    });

    await expect(fetchJson(`${backend.url}/api/provider-config/check`, {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
      }),
    }))
      .resolves
      .toMatchObject({
        ok: true,
        model: 'custom-large',
        status: 200,
        message: 'OK',
        latencyMs: expect.any(Number),
      });

    await expect(fetchJson(`${backend.url}/api/provider-config/check`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'custom',
        baseUrl: `${modelServer.url}/v1`,
        model: 'custom-small',
        apiKey: 'wrong-secret',
      }),
    }))
      .resolves
      .toMatchObject({
        ok: false,
        model: 'custom-small',
        status: 401,
        message: 'unauthorized',
        latencyMs: expect.any(Number),
      });
  });
});

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-backend-'));
  tempRoots.push(root);
  return root;
}

async function createOanWorkspace(): Promise<string> {
  const root = await createTempWorkspace();

  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await mkdir(join(root, 'characters'), { recursive: true });
  await mkdir(join(root, 'summaries/chapter/0001'), { recursive: true });
  await writeFile(
    join(root, '.oan/config.yaml'),
    'version: 1\nnovelName: backend-sample\n',
    'utf-8',
  );
  await writeFile(
    join(root, '.oan/workflow.yaml'),
    'name: lightnovel\nsteps:\n  - chapter\n',
    'utf-8',
  );
  await writeFile(join(root, 'chapters/0001/0000.md'), '# 第一卷\n', 'utf-8');
  await writeFile(join(root, 'chapters/0001/0001.md'), '# 第一章\n\n正文。\n', 'utf-8');
  await writeFile(join(root, 'summaries/chapter/0001/0001.md'), '# 第一章\n\n旧摘要。\n', 'utf-8');

  return root;
}

async function initGitRepo(workspaceRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: workspaceRoot });
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
}

async function startModelListServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== 'Bearer custom-secret') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'unauthorized' } }));
        return;
      }

      if (request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          data: [
            {
              id: 'custom-large',
              object: 'model',
              name: 'Custom Large',
              context_length: 128000,
            },
            { id: 'custom-small', object: 'model' },
          ],
        }));
        return;
      }

      if (request.url === '/v1/chat/completions') {
        const body = await readMockJsonBody(request);
        if (body.model !== 'custom-large' && body.model !== 'custom-small') {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'model not found' } }));
          return;
        }

        if (body.stream === true) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: 'OK',
                },
                finish_reason: null,
              },
            ],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion.chunk',
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          })}\n\n`);
          response.end('data: [DONE]\n\n');
          return;
        }

        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'OK',
              },
            },
          ],
        }));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
    })().catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Model list server did not expose a TCP address.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function startOllamaServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url === '/api/tags') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          models: [
            {
              name: 'llama3.2:latest',
              model: 'llama3.2:latest',
              details: {
                parameter_size: '3.2B',
              },
            },
          ],
        }));
        return;
      }

      if (request.url === '/v1/chat/completions') {
        const body = await readMockJsonBody(request);
        if (body.model !== 'llama3.2:latest') {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'model not found' } }));
          return;
        }

        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'OK',
              },
            },
          ],
        }));
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
    })().catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Ollama server did not expose a TCP address.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function readMockJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : init?.headers,
  });
  const data = await response.json() as T;

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function executeTool(
  tools: ToolSet,
  name: string,
  args: unknown,
): Promise<unknown> {
  const executable = tools[name] as {
    execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
  };

  if (!executable?.execute) {
    throw new Error(`Tool ${name} is not executable.`);
  }

  return executable.execute(args, {});
}

function expectSinglePendingAction(result: unknown): { id: string } {
  expect(result).toMatchObject({
    pendingActions: [expect.any(Object)],
  });

  return (result as { pendingActions: Array<{ id: string }> }).pendingActions[0];
}

async function* scriptedRuntimeEvents(): AsyncIterable<RuntimeEvent> {
  yield { type: 'message_start', messages: [] };
  yield { type: 'message_delta', text: 'Hello from backend' };
  yield {
    type: 'tool_call_start',
    toolCall: { id: 'call_1', name: 'workflow.get', args: {} },
  };
  yield {
    type: 'tool_call_finish',
    toolCall: { id: 'call_1', name: 'workflow.get', args: {} },
    result: { ok: true, content: { file: '.oan/workflow.yaml' } },
  };
  yield {
    type: 'message_finish',
    result: {
      messages: [{ role: 'assistant', content: 'Hello from backend' }],
      assistantMessage: { role: 'assistant', content: 'Hello from backend' },
      toolLog: [
        {
          toolCall: { id: 'call_1', name: 'workflow.get', args: {} },
          result: { ok: true, content: { file: '.oan/workflow.yaml' } },
        },
      ],
      pendingActions: [],
      stoppedReason: 'completed',
    },
  };
}
