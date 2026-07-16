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

    const observed = await fetchJson<{
      session: {
        revision: number;
        observations: Array<{ id: string }>;
      };
    }>(`${backend.url}/api/workspace/play-sessions/${created.session.id}/observations`, {
      method: 'POST',
      body: JSON.stringify({
        summary: '她在雨里停住。',
        evidence: 'Play transcript turn',
      }),
    });
    const observationId = observed.session.observations[0]!.id;
    const invalidCandidateResponse = await fetch(
      `${backend.url}/api/workspace/play-sessions/${created.session.id}/adoption-candidates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: 'chapterDraft',
          summary: '重复证据候选',
          evidence: 'Play observation',
          sourceObservationIds: [observationId, observationId],
          baseRevision: observed.session.revision,
        }),
      },
    );
    expect(invalidCandidateResponse.status).toBe(400);
    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/${created.session.id}`,
    )).resolves.toMatchObject({
      session: {
        revision: observed.session.revision,
        adoptionCandidates: [],
      },
    });

    const candidateResult = await fetchJson<{
      candidate: { id: string };
    }>(`${backend.url}/api/workspace/play-sessions/${created.session.id}/adoption-candidates`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'caller-controlled-candidate',
        target: 'chapterDraft',
        summary: '转成下一章草稿',
        evidence: 'Play transcript turn',
        payload: {
          chapterId: '0001/0002',
          content: '# 第二章\n\n她在雨里停住。\n',
        },
      }),
    });
    expect(candidateResult.candidate.id).not.toBe('caller-controlled-candidate');

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

  it('previews, confirms, reads, and starts source-backed Guided Play for both purposes', async () => {
    const workspaceRoot = await createOanWorkspace();
    await mkdir(join(workspaceRoot, 'characters/heroine'), { recursive: true });
    await writeFile(
      join(workspaceRoot, 'characters/heroine/character.md'),
      '# Heroine\n\nShe keeps watch at the gate.\n',
      'utf-8',
    );
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);

    const immersiveInput = createPlayLaunchPreviewInput(
      'setup-guided-journey',
      'immersiveJourney',
    );
    const immersivePreview = await fetchJson<{
      launchPackage: Record<string, unknown> & {
        id: string;
        sourceBase: { activatedSources: Array<Record<string, unknown>> };
      };
    }>(`${backend.url}/api/workspace/play-setups/preview`, {
      method: 'POST',
      body: JSON.stringify(immersiveInput),
    });
    expect(immersivePreview.launchPackage).toMatchObject({
      schemaVersion: 1,
      id: 'setup-guided-journey',
      purpose: 'immersiveJourney',
      startMode: 'guided',
      canonical: false,
      sourceBase: {
        activatedSources: [expect.objectContaining({
          sourceId: 'chapter-opening',
          path: 'chapters/0001/0001.md',
          objectId: '0001/0001',
          role: 'chapter',
          status: 'ready',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        })],
      },
    });
    await expect(readFile(
      join(workspaceRoot, '.workspace/play-setups/setup-guided-journey/setup.yaml'),
      'utf-8',
    )).rejects.toThrow();
    await expect(readFile(
      join(workspaceRoot, '.workspace/play-sessions/play-guided-journey/session.yaml'),
      'utf-8',
    )).rejects.toThrow();

    const confirmed = await fetchJson<{
      launchPackage: typeof immersivePreview.launchPackage;
      files: string[];
    }>(`${backend.url}/api/workspace/play-setups`, {
      method: 'POST',
      body: JSON.stringify(immersivePreview.launchPackage),
    });
    expect(confirmed).toEqual({
      launchPackage: immersivePreview.launchPackage,
      files: ['.workspace/play-setups/setup-guided-journey/setup.yaml'],
    });
    await expect(fetchJson(
      `${backend.url}/api/workspace/play-setups/setup-guided-journey`,
    )).resolves.toEqual({ launchPackage: immersivePreview.launchPackage });

    const immersive = await fetchJson<{
      session: {
        schemaVersion: number;
        id: string;
        activatedSources: Array<Record<string, unknown>>;
        metadataExtensions: Record<string, unknown>;
      };
    }>(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        launchPackageId: 'setup-guided-journey',
        id: 'play-guided-journey',
      }),
    });
    expect(immersive.session).toMatchObject({
      schemaVersion: 4,
      id: 'play-guided-journey',
      activatedSources: [expect.objectContaining({
        sourceId: 'chapter-opening',
        role: 'chapter',
        contentHash: immersivePreview.launchPackage.sourceBase.activatedSources[0]
          ?.contentHash,
      })],
      metadataExtensions: {
        playLaunch: {
          setupId: 'setup-guided-journey',
          setupSchemaVersion: 1,
          purpose: 'immersiveJourney',
          startMode: 'guided',
        },
      },
    });

    const rehearsalInput = createPlayLaunchPreviewInput(
      'setup-guided-rehearsal',
      'sceneRehearsal',
    );
    const rehearsalPreview = await fetchJson<{
      launchPackage: Record<string, unknown>;
    }>(`${backend.url}/api/workspace/play-setups/preview`, {
      method: 'POST',
      body: JSON.stringify(rehearsalInput),
    });
    await fetchJson(`${backend.url}/api/workspace/play-setups`, {
      method: 'POST',
      body: JSON.stringify(rehearsalPreview.launchPackage),
    });
    const rehearsal = await fetchJson<{
      session: {
        schemaVersion: number;
        id: string;
        sceneRehearsal: { purpose: string; startMode: string };
        metadataExtensions: Record<string, unknown>;
      };
    }>(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        launchPackageId: 'setup-guided-rehearsal',
        id: 'play-guided-rehearsal',
      }),
    });
    expect(rehearsal.session).toMatchObject({
      schemaVersion: 5,
      id: 'play-guided-rehearsal',
      sceneRehearsal: {
        purpose: 'sceneRehearsal',
        startMode: 'guided',
      },
      metadataExtensions: {
        playLaunch: {
          setupId: 'setup-guided-rehearsal',
          purpose: 'sceneRehearsal',
          startMode: 'guided',
        },
      },
    });

    const compactQuick = await fetchJson<{
      session: { schemaVersion: number; sceneRehearsal: { startMode: string } };
    }>(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify(createCompactSceneRehearsalCreateInput(
        'play-compact-quick',
      )),
    });
    expect(compactQuick.session).toMatchObject({
      schemaVersion: 5,
      sceneRehearsal: { startMode: 'quick' },
    });
  });

  it('returns one conflict for concurrent create-only writers sharing a session id', async () => {
    const workspaceRoot = await createOanWorkspace();
    const firstBackend = await startNovelHttpBackend({ workspaceRoot });
    const secondBackend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(firstBackend, secondBackend);
    const firstInput = {
      ...createCompactSceneRehearsalCreateInput('play-concurrent-create'),
      title: 'First backend contender',
    };
    const secondInput = {
      ...createCompactSceneRehearsalCreateInput('play-concurrent-create'),
      title: 'Second backend contender',
    };

    const responses = await Promise.all([
      fetch(`${firstBackend.url}/api/workspace/play-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(firstInput),
      }),
      fetch(`${secondBackend.url}/api/workspace/play-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(secondInput),
      }),
    ]);
    expect(responses.map((response) => response.status).toSorted()).toEqual([200, 409]);
    const winner = responses.find((response) => response.status === 200)!;
    const loser = responses.find((response) => response.status === 409)!;
    const winnerBody = await winner.json() as { session: { title: string } };
    await expect(loser.json()).resolves.toMatchObject({
      error: expect.stringContaining('already exists'),
    });

    const reopened = await fetchJson<{ session: { title: string } }>(
      `${firstBackend.url}/api/workspace/play-sessions/play-concurrent-create`,
    );
    expect(reopened.session.title).toBe(winnerBody.session.title);
  });

  it('blocks stale Guided Play packages before setup, start, or source context use', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerCalls = 0;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async () => {
        providerCalls += 1;
        return [
          'Nothing changes.',
          '```oan-play-settlement',
          JSON.stringify({
            events: [],
            stateDelta: {},
            observations: [],
            suggestedActions: [],
          }),
          '```',
        ].join('\n');
      },
    });
    servers.push(backend);
    const sourcePath = join(workspaceRoot, 'chapters/0001/0001.md');

    const stalePreview = await fetchJson<{ launchPackage: Record<string, unknown> }>(
      `${backend.url}/api/workspace/play-setups/preview`,
      {
        method: 'POST',
        body: JSON.stringify(createPlayLaunchPreviewInput(
          'setup-stale-preview',
          'immersiveJourney',
        )),
      },
    );
    await writeFile(sourcePath, '# Changed after preview\n', 'utf-8');
    const staleCreate = await fetch(`${backend.url}/api/workspace/play-setups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stalePreview.launchPackage),
    });
    expect(staleCreate.status).toBe(409);
    await expect(staleCreate.json()).resolves.toMatchObject({
      code: 'play_launch_source_validation',
      diagnostics: [expect.objectContaining({
        code: 'staleSource',
        severity: 'error',
        expectedContentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        actualContentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      })],
    });
    await expect(readFile(
      join(workspaceRoot, '.workspace/play-setups/setup-stale-preview/setup.yaml'),
      'utf-8',
    )).rejects.toThrow();

    const currentPreview = await fetchJson<{ launchPackage: Record<string, unknown> }>(
      `${backend.url}/api/workspace/play-setups/preview`,
      {
        method: 'POST',
        body: JSON.stringify(createPlayLaunchPreviewInput(
          'setup-stale-start',
          'immersiveJourney',
        )),
      },
    );
    await fetchJson(`${backend.url}/api/workspace/play-setups`, {
      method: 'POST',
      body: JSON.stringify(currentPreview.launchPackage),
    });
    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        launchPackageId: 'setup-stale-start',
        id: 'play-guided-before-stale',
      }),
    });

    await writeFile(sourcePath, 'x'.repeat(1_000_001), 'utf-8');
    const staleSetupReopen = await fetch(
      `${backend.url}/api/workspace/play-setups/setup-stale-start`,
    );
    expect(staleSetupReopen.status).toBe(409);
    await expect(staleSetupReopen.json()).resolves.toMatchObject({
      code: 'play_launch_source_validation',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'sourceTooLarge', severity: 'error' }),
      ]),
    });
    const staleSessionReopen = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-guided-before-stale`,
    );
    expect(staleSessionReopen.status).toBe(409);
    await expect(staleSessionReopen.json()).resolves.toMatchObject({
      code: 'play_launch_source_validation',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'sourceTooLarge', severity: 'error' }),
      ]),
    });
    const staleStart = await fetch(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        launchPackageId: 'setup-stale-start',
        id: 'play-must-not-exist',
      }),
    });
    expect(staleStart.status).toBe(409);
    await expect(staleStart.json()).resolves.toMatchObject({
      code: 'play_launch_source_validation',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'sourceTooLarge' }),
      ]),
    });
    await expect(readFile(
      join(workspaceRoot, '.workspace/play-sessions/play-must-not-exist/session.yaml'),
      'utf-8',
    )).rejects.toThrow();

    const turn = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-guided-before-stale/world-referee-turn`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userText: 'Look around.',
          actionKind: 'look',
          baseRevision: 0,
        }),
      },
    );
    expect(turn.status).toBe(422);
    expect(providerCalls).toBe(0);
  });

  it('validates every Guided source beyond the prompt-content budget', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerCalls = 0;
    let providerRequest = '';
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async ({ request }) => {
        providerCalls += 1;
        providerRequest = request;
        return [
          'The world remains still.',
          '```oan-play-settlement',
          JSON.stringify({
            events: [],
            stateDelta: {},
            observations: [],
            suggestedActions: [],
          }),
          '```',
        ].join('\n');
      },
    });
    servers.push(backend);

    const sourceInputs: Array<Record<string, string>> = [{
      sourceId: 'chapter-opening',
      path: 'chapters/0001/0001.md',
      role: 'chapter',
      reason: 'Opening scene source',
    }];
    await mkdir(join(workspaceRoot, 'world'), { recursive: true });
    const ninthPath = 'world/guided-context-8.md';
    const ninthOriginal = '# Guided context 8\n';
    for (let index = 1; index <= 8; index += 1) {
      const relativePath = `world/guided-context-${index}.md`;
      await writeFile(
        join(workspaceRoot, relativePath),
        `# Guided context ${index}\n`,
        'utf-8',
      );
      sourceInputs.push({
        sourceId: `world-context-${index}`,
        path: relativePath,
        role: 'world',
        reason: `World context ${index}`,
      });
    }
    const input = createPlayLaunchPreviewInput(
      'setup-nine-sources',
      'immersiveJourney',
    ) as Record<string, unknown> & {
      sources: Array<Record<string, string>>;
      entryPoint: Record<string, unknown> & { sourceRefs: string[] };
    };
    input.sources = sourceInputs;
    input.entryPoint.sourceRefs = sourceInputs.map((source) => source.sourceId!);

    const preview = await fetchJson<{ launchPackage: Record<string, unknown> }>(
      `${backend.url}/api/workspace/play-setups/preview`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    await fetchJson(`${backend.url}/api/workspace/play-setups`, {
      method: 'POST',
      body: JSON.stringify(preview.launchPackage),
    });

    await writeFile(join(workspaceRoot, ninthPath), '# Stale before start\n', 'utf-8');
    const blockedStart = await fetch(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        launchPackageId: 'setup-nine-sources',
        id: 'play-nine-sources',
      }),
    });
    expect(blockedStart.status).toBe(409);
    await expect(blockedStart.json()).resolves.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'staleSource',
          sourceId: 'world-context-8',
        }),
      ]),
    });

    await writeFile(join(workspaceRoot, ninthPath), ninthOriginal, 'utf-8');
    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        launchPackageId: 'setup-nine-sources',
        id: 'play-nine-sources',
      }),
    });
    const validTurn = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-nine-sources/world-referee-turn`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userText: 'Look around.',
          actionKind: 'look',
          baseRevision: 0,
        }),
      },
    );
    expect(validTurn.status).toBe(200);
    expect(providerCalls).toBe(1);
    expect(providerRequest).toContain(
      'Validated 1 additional activated sources; omitted by context budget.',
    );
    await writeFile(join(workspaceRoot, ninthPath), '# Stale during Play\n', 'utf-8');
    const turn = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-nine-sources/world-referee-turn`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userText: 'Continue.',
          actionKind: 'look',
          baseRevision: 1,
        }),
      },
    );
    expect(turn.status).toBe(422);
    expect(providerCalls).toBe(1);
  });

  it('rejects malformed Play setup and launch-session payloads without writing truth', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    const input = createPlayLaunchPreviewInput(
      'setup-malformed',
      'immersiveJourney',
    );

    const malformedPreview = await fetch(
      `${backend.url}/api/workspace/play-setups/preview`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, unexpected: true }),
      },
    );
    expect(malformedPreview.status).toBe(400);

    const preview = await fetchJson<{ launchPackage: Record<string, unknown> }>(
      `${backend.url}/api/workspace/play-setups/preview`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    const tamperedExcerpt = structuredClone(preview.launchPackage) as {
      sourceBase: { activatedSources: Array<Record<string, unknown>> };
    };
    tamperedExcerpt.sourceBase.activatedSources[0]!.excerpt = 'Forged excerpt';
    const forgedExcerptCreate = await fetch(
      `${backend.url}/api/workspace/play-setups`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tamperedExcerpt),
      },
    );
    expect(forgedExcerptCreate.status).toBe(409);

    const tamperedDiagnostics = structuredClone(preview.launchPackage) as {
      diagnostics: Array<Record<string, unknown>>;
    };
    tamperedDiagnostics.diagnostics.push({
      id: 'diagnostic-forged-warning',
      code: 'invalidSource',
      severity: 'warning',
      message: 'Forged client diagnostic',
    });
    const forgedDiagnosticsCreate = await fetch(
      `${backend.url}/api/workspace/play-setups`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tamperedDiagnostics),
      },
    );
    expect(forgedDiagnosticsCreate.status).toBe(409);

    const malformedCreate = await fetch(`${backend.url}/api/workspace/play-setups`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...preview.launchPackage, unexpected: true }),
    });
    expect(malformedCreate.status).toBe(400);

    const malformedStart = await fetch(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        launchPackageId: 'setup-malformed',
        id: 'play-malformed',
        title: 'must not enter the Quick branch',
      }),
    });
    expect(malformedStart.status).toBe(400);
    await expect(readFile(
      join(workspaceRoot, '.workspace/play-setups/setup-malformed/setup.yaml'),
      'utf-8',
    )).rejects.toThrow();
    await expect(readFile(
      join(workspaceRoot, '.workspace/play-sessions/play-malformed/session.yaml'),
      'utf-8',
    )).rejects.toThrow();
  });

  it('commits an injected Play referee settlement to Play-local world state only', async () => {
    const workspaceRoot = await createOanWorkspace();
    const canonicalChapterPath = join(workspaceRoot, 'chapters/0001/0001.md');
    const canonicalChapterBefore = await readFile(canonicalChapterPath, 'utf-8');
    const interactionPath = join(workspaceRoot, 'characters/heroine/interaction.md');
    let playTurnRequest = '';
    let playTurnTimeAdvance: { amount: number; unit: string } | undefined;
    await mkdir(join(workspaceRoot, 'characters/heroine'), { recursive: true });
    await writeFile(interactionPath, '她在压力下会先观察出口。\n', 'utf-8');
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async (input) => {
        playTurnRequest = input.request;
        playTurnTimeAdvance = input.timeAdvance;
        return [
          '远处的铁门落锁，东侧入口已被控制。',
          '',
          '```oan-play-settlement',
          JSON.stringify({
            elapsed: 'PT2H',
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
        worldMomentum: {
          pressures: [{
            id: 'station-lockdown',
            kind: 'deadline',
            label: '车站封锁完成',
            status: 'active',
            causeRefs: ['scene-seed'],
            nextConsequence: '东侧入口被控制',
            visibility: 'playerVisible',
          }],
          agendas: [],
        },
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
        timeAdvance: { amount: 2, unit: 'hour' },
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
        elapsed: 'PT2H',
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
    expect(playTurnRequest).toContain('requested elapsed PT2H');
    expect(playTurnRequest).toContain('pressure station-lockdown');
    expect(playTurnTimeAdvance).toEqual({ amount: 2, unit: 'hour' });

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

  it('rejects malformed Play stream request bodies before starting a provider', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerCalled = false;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* () {
        providerCalled = true;
        yield 'should not run';
      },
    });
    servers.push(backend);
    const endpoint = `${backend.url}/api/workspace/play-sessions/not-needed/turns/stream`;
    const request = (body: string) => fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    const responses = await Promise.all([
      request('{'),
      request('null'),
      request(JSON.stringify({ userText: '等待', actionKind: 42 })),
      request(JSON.stringify({ userText: '等待', baseRevision: '0' })),
      request(JSON.stringify({ userText: '等待', surprise: true })),
      request(JSON.stringify({
        userText: '等待',
        actionKind: 'wait',
        timeAdvance: { amount: 0, unit: 'hour' },
      })),
      request(JSON.stringify({
        userText: '查看钟表',
        actionKind: 'look',
        timeAdvance: { amount: 1, unit: 'hour' },
      })),
      request(JSON.stringify({
        userText: '等待',
        actionKind: 'wait',
        timeAdvance: { amount: 366, unit: 'day' },
      })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
    ]);
    expect(providerCalled).toBe(false);
  });

  it('streams provisional Play narrative without exposing the settlement fence, then commits once', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerTimeAdvance: { amount: number; unit: string } | undefined;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* (input) {
        providerTimeAdvance = input.timeAdvance;
        yield '远处的铁门开始落锁。\n```oan-play-settle';
        yield 'ment\n';
        yield JSON.stringify({
          elapsed: 'PT10M',
          events: [],
          stateDelta: { gate: 'locked' },
          observations: [],
          suggestedActions: ['检查铁门'],
        });
        yield '\n```';
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-stream-success',
        title: 'Stream success',
        sceneStart: 'Station',
      }),
    });
    const response = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-stream-success/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userText: '等待十分钟',
          actionKind: 'wait',
          baseRevision: 0,
          timeAdvance: { amount: 10, unit: 'minute' },
        }),
      },
    );
    const body = await response.text();
    const events = parseSseDataEvents(body);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-oan-play-turn-id')).toMatch(/^play-turn-/u);
    expect(events.map((event) => event.type)).toEqual([
      'play.turn.started',
      'play.context.ready',
      'play.narrative.delta',
      'play.turn.prepared',
      'play.turn.committed',
    ]);
    expect(events
      .filter((event) => event.type === 'play.narrative.delta')
      .map((event) => event.delta)
      .join('')).toBe('远处的铁门开始落锁。\n');
    expect(body).not.toContain('oan-play-settlement');
    expect(providerTimeAdvance).toEqual({ amount: 10, unit: 'minute' });

    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-stream-success`,
    )).resolves.toMatchObject({
      session: {
        revision: 1,
        worldClock: { turn: 1, revision: 1, elapsed: 'PT10M' },
        turnArtifacts: [expect.objectContaining({
          input: {
            kind: 'wait',
            raw: '等待十分钟',
            timeAdvance: { amount: 10, unit: 'minute' },
          },
        })],
        transcript: [
          expect.objectContaining({ speaker: 'user', content: '等待十分钟' }),
          expect.objectContaining({
            speaker: 'world-referee',
            content: '远处的铁门开始落锁。',
          }),
        ],
        playLocalState: { gate: 'locked' },
      },
    });
  });

  it('publishes hard-due world events only after the scheduled snapshot is committed', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerTurn = 0;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* (input) {
        providerTurn += 1;
        if (providerTurn === 1) {
          yield '广播仍然沉默。\n```oan-play-settlement\n';
          yield JSON.stringify({
            events: [],
            scheduledEventChanges: [{
              type: 'schedule',
              label: 'Station lockdown',
              trigger: { type: 'nextTurn' },
              template: {
                kind: 'factionActed',
                origin: 'faction',
                title: '封锁开始',
                summary: '站台出口按计划关闭',
                visibility: 'playerVisible',
              },
              reason: '安保协议已经启动',
              priority: 10,
            }],
          });
          yield '\n```';
          return;
        }

        expect(input.request).toContain(
          'scheduled-1-1 [priority 10/playerVisible] Station lockdown',
        );
        yield '铁门依次落下。\n```oan-play-settlement\n';
        yield JSON.stringify({
          events: [{
            kind: 'factionActed',
            origin: 'faction',
            title: '封锁开始',
            summary: '站台出口已经关闭',
            visibility: 'playerVisible',
            cause: { reason: '安保计划到期', triggerId: 'scheduled-1-1' },
          }],
        });
        yield '\n```';
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-hard-due-stream',
        title: 'Hard due stream',
        sceneStart: 'Station',
        eventPolicy: { maxExternalEventsPerTurn: 0 },
      }),
    });

    const first = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-hard-due-stream/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '观察广播。', baseRevision: 0 }),
      },
    );
    const firstEvents = parseSseDataEvents(await first.text());
    expect(firstEvents.some((event) => event.type === 'play.event.occurred')).toBe(false);
    expect(firstEvents.at(-1)).toMatchObject({
      type: 'play.turn.committed',
      revision: 1,
    });

    const second = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-hard-due-stream/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '继续等待。', actionKind: 'wait', baseRevision: 1 }),
      },
    );
    const secondEvents = parseSseDataEvents(await second.text());
    expect(secondEvents.map((event) => event.type)).toEqual([
      'play.turn.started',
      'play.context.ready',
      'play.narrative.delta',
      'play.turn.prepared',
      'play.event.occurred',
      'play.turn.committed',
    ]);
    expect(secondEvents[4]).toMatchObject({
      revision: 2,
      event: {
        id: 'turn-2-event-1',
        cause: { triggerId: 'scheduled-1-1' },
      },
    });

    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-hard-due-stream`,
    )).resolves.toMatchObject({
      session: {
        revision: 2,
        scheduledEvents: [{
          id: 'scheduled-1-1',
          status: 'occurred',
          occurredEventIds: ['turn-2-event-1'],
          resolvedAtTurnId: 'turn-2-referee',
        }],
      },
    });
  });

  it('lists implicit Play checkpoints and restores the complete selected projection', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerTurn = 0;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      runPlayTurn: async () => {
        providerTurn += 1;
        return providerTurn === 1
          ? [
              '站台闸门暂时保持开启。',
              '```oan-play-settlement',
              JSON.stringify({
                events: [],
                stateDelta: { gate: 'open' },
                scheduledEventChanges: [{
                  type: 'schedule',
                  label: 'Station lockdown',
                  trigger: { type: 'nextTurn' },
                  template: {
                    kind: 'factionActed',
                    origin: 'faction',
                    title: '封锁开始',
                    summary: '站台出口按计划关闭',
                    visibility: 'playerVisible',
                  },
                  reason: '安保协议已经启动',
                }],
                observations: [],
                suggestedActions: ['检查闸门'],
              }),
              '```',
            ].join('\n')
          : [
              '闸门在身后关闭。',
              '```oan-play-settlement',
              JSON.stringify({
                events: [{
                  kind: 'factionActed',
                  origin: 'faction',
                  title: '封锁开始',
                  summary: '站台出口已经关闭',
                  visibility: 'playerVisible',
                  cause: { reason: '安保计划到期', triggerId: 'scheduled-1-1' },
                }],
                stateDelta: { gate: 'locked' },
                observations: [],
                suggestedActions: ['寻找备用出口'],
              }),
              '```',
            ].join('\n');
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-checkpoint-restore',
        title: 'Checkpoint restore',
        sceneStart: 'Station',
      }),
    });
    await fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-checkpoint-restore/world-referee-turn`,
      {
        method: 'POST',
        body: JSON.stringify({ userText: '观察闸门', baseRevision: 0 }),
      },
    );
    await fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-checkpoint-restore/world-referee-turn`,
      {
        method: 'POST',
        body: JSON.stringify({ userText: '继续等待', baseRevision: 1 }),
      },
    );

    const listed = await fetchJson<{
      checkpoints: Array<{
        checkpointId: string;
        kind: string;
        artifactId?: string;
        parentCheckpointId?: string;
        depth: number;
        selectedTurnIds: string[];
        status: string;
        restorable: boolean;
      }>;
    }>(`${backend.url}/api/workspace/play-sessions/play-checkpoint-restore/checkpoints`);
    expect(listed.checkpoints).toHaveLength(3);
    expect(listed.checkpoints).toEqual([
      expect.objectContaining({
        checkpointId: 'turn-artifact-1',
        kind: 'turn',
        artifactId: 'turn-artifact-1',
        parentCheckpointId: 'initial-world',
        depth: 1,
        selectedTurnIds: ['turn-artifact-1'],
        status: 'selectedAncestor',
        restorable: true,
      }),
      expect.objectContaining({
        checkpointId: 'turn-artifact-2',
        kind: 'turn',
        artifactId: 'turn-artifact-2',
        parentCheckpointId: 'turn-artifact-1',
        depth: 2,
        selectedTurnIds: ['turn-artifact-1', 'turn-artifact-2'],
        status: 'current',
        restorable: false,
      }),
      expect.objectContaining({
        checkpointId: 'initial-world',
        kind: 'initialWorld',
        depth: 0,
        selectedTurnIds: [],
        status: 'selectedAncestor',
        restorable: true,
      }),
    ]);

    const restored = await fetchJson<{
      restoredCheckpointId: string;
      session: {
        revision: number;
        selectedTurnIds: string[];
        transcript: Array<{ content: string }>;
        playLocalState: Record<string, unknown>;
        worldClock: { turn: number; revision: number };
        scheduledEvents: Array<{ id: string; status: string }>;
        suggestedActions: string[];
      };
      checkpoints: Array<{ checkpointId: string; status: string; restorable: boolean }>;
    }>(
      `${backend.url}/api/workspace/play-sessions/play-checkpoint-restore/checkpoints/turn-artifact-1/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ baseRevision: 2 }),
      },
    );

    expect(restored).toMatchObject({
      restoredCheckpointId: 'turn-artifact-1',
      session: {
        revision: 3,
        selectedTurnIds: ['turn-artifact-1'],
        playLocalState: { gate: 'open' },
        worldClock: { turn: 1, revision: 3 },
        scheduledEvents: [{ id: 'scheduled-1-1', status: 'scheduled' }],
        suggestedActions: ['检查闸门'],
      },
      checkpoints: [
        expect.objectContaining({
          checkpointId: 'turn-artifact-1',
          status: 'current',
          restorable: false,
        }),
        expect.objectContaining({
          checkpointId: 'turn-artifact-2',
          status: 'variant',
          restorable: true,
        }),
        expect.objectContaining({
          checkpointId: 'initial-world',
          status: 'selectedAncestor',
          restorable: true,
        }),
      ],
    });
    expect(restored.session.transcript.map((turn) => turn.content)).toEqual([
      '观察闸门',
      '站台闸门暂时保持开启。',
    ]);

    const initial = await fetchJson<{
      restoredCheckpointId: string;
      session: {
        revision: number;
        selectedTurnIds: string[];
        transcript: Array<{ content: string }>;
        worldClock: { turn: number; revision: number };
      };
      checkpoints: Array<{ checkpointId: string; status: string; restorable: boolean }>;
    }>(
      `${backend.url}/api/workspace/play-sessions/play-checkpoint-restore/checkpoints/initial-world/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ baseRevision: 3 }),
      },
    );
    expect(initial).toMatchObject({
      restoredCheckpointId: 'initial-world',
      session: {
        revision: 4,
        selectedTurnIds: [],
        transcript: [],
        worldClock: { turn: 0, revision: 4 },
      },
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          checkpointId: 'initial-world',
          status: 'current',
          restorable: false,
        }),
        expect.objectContaining({
          checkpointId: 'turn-artifact-1',
          status: 'variant',
          restorable: true,
        }),
      ]),
    });
  });

  it('requires a current baseRevision and leaves Play checkpoints unchanged on restore errors', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/play-checkpoint-cas`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-checkpoint-cas',
        title: 'Checkpoint CAS',
        sceneStart: 'Archive',
      }),
    });
    await fetchJson(`${sessionEndpoint}/transcript`, {
      method: 'POST',
      body: JSON.stringify({ speaker: 'note', content: 'First', baseRevision: 0 }),
    });
    await fetchJson(`${sessionEndpoint}/transcript`, {
      method: 'POST',
      body: JSON.stringify({ speaker: 'note', content: 'Second', baseRevision: 1 }),
    });

    const restoreEndpoint = `${sessionEndpoint}/checkpoints/turn-artifact-1/restore`;
    const missingRevision = await fetch(restoreEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missingRevision.status).toBe(400);
    await expect(missingRevision.json()).resolves.toEqual({ error: 'baseRevision is required.' });

    const invalidRevision = await fetch(restoreEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: -1 }),
    });
    expect(invalidRevision.status).toBe(400);

    const unknownField = await fetch(restoreEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: 2, force: true }),
    });
    expect(unknownField.status).toBe(400);
    await expect(unknownField.json()).resolves.toEqual({
      error: 'Play checkpoint restore request contains unknown fields.',
    });

    const staleRevision = await fetch(restoreEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: 1 }),
    });
    expect(staleRevision.status).toBe(409);

    const unknownTarget = await fetch(
      `${sessionEndpoint}/checkpoints/unknown-artifact/restore`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 2 }),
      },
    );
    expect(unknownTarget.status).toBe(404);

    const unsafeTarget = await fetch(
      `${sessionEndpoint}/checkpoints/${encodeURIComponent('../unsafe')}/restore`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 2 }),
      },
    );
    expect(unsafeTarget.status).toBe(400);

    const currentTarget = await fetch(
      `${sessionEndpoint}/checkpoints/turn-artifact-2/restore`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 2 }),
      },
    );
    expect(currentTarget.status).toBe(409);

    await expect(fetchJson(sessionEndpoint)).resolves.toMatchObject({
      session: {
        revision: 2,
        selectedTurnIds: ['turn-artifact-1', 'turn-artifact-2'],
        transcript: [
          expect.objectContaining({ content: 'First' }),
          expect.objectContaining({ content: 'Second' }),
        ],
      },
    });
  });

  it('names initial and turn checkpoints through revision-checked staged mutations', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/play-checkpoint-name`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-checkpoint-name',
        title: 'Checkpoint names',
        sceneStart: 'Archive',
      }),
    });
    await fetchJson(`${sessionEndpoint}/transcript`, {
      method: 'POST',
      body: JSON.stringify({ speaker: 'note', content: 'First', baseRevision: 0 }),
    });

    const nameEndpoint = `${sessionEndpoint}/checkpoints/turn-artifact-1/name`;
    const missingRevision = await fetch(nameEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Archive opened' }),
    });
    expect(missingRevision.status).toBe(400);
    const missingName = await fetch(nameEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: 1 }),
    });
    expect(missingName.status).toBe(400);
    const unknownField = await fetch(nameEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: 1, name: 'Archive opened', force: true }),
    });
    expect(unknownField.status).toBe(400);

    const renamed = await fetchJson<{
      renamedCheckpointId: string;
      session: {
        revision: number;
        worldClock: { revision: number };
        metadataExtensions: Record<string, unknown>;
      };
      checkpoints: Array<{ checkpointId: string; name?: string }>;
    }>(nameEndpoint, {
      method: 'POST',
      body: JSON.stringify({ baseRevision: 1, name: '  Archive opened  ' }),
    });
    expect(renamed).toMatchObject({
      renamedCheckpointId: 'turn-artifact-1',
      session: {
        revision: 2,
        worldClock: { revision: 2 },
        metadataExtensions: {
          playCheckpointNames: {
            'turn-artifact-1': 'Archive opened',
          },
        },
      },
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          checkpointId: 'turn-artifact-1',
          name: 'Archive opened',
        }),
      ]),
    });

    const stale = await fetch(nameEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: 1, name: 'Stale overwrite' }),
    });
    expect(stale.status).toBe(409);

    const namedInitial = await fetchJson<{
      renamedCheckpointId: string;
      session: { revision: number; worldClock: { revision: number } };
      checkpoints: Array<{ checkpointId: string; name?: string }>;
    }>(`${sessionEndpoint}/checkpoints/initial-world/name`, {
      method: 'POST',
      body: JSON.stringify({ baseRevision: 2, name: 'Before the archive opened' }),
    });
    expect(namedInitial).toMatchObject({
      renamedCheckpointId: 'initial-world',
      session: { revision: 3, worldClock: { revision: 3 } },
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          checkpointId: 'initial-world',
          name: 'Before the archive opened',
        }),
        expect.objectContaining({
          checkpointId: 'turn-artifact-1',
          name: 'Archive opened',
        }),
      ]),
    });

    const invalidName = await fetch(nameEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision: 3, name: 'line\nbreak' }),
    });
    expect(invalidName.status).toBe(400);
    const unknownTarget = await fetch(
      `${sessionEndpoint}/checkpoints/missing-artifact/name`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 3, name: 'Missing' }),
      },
    );
    expect(unknownTarget.status).toBe(404);

    await expect(fetchJson(sessionEndpoint)).resolves.toMatchObject({
      session: {
        revision: 3,
        metadataExtensions: {
          playCheckpointNames: {
            'turn-artifact-1': 'Archive opened',
            'initial-world': 'Before the archive opened',
          },
        },
      },
    });
  });

  it('rejects checkpoint naming while a Scene Rehearsal attempt is active', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    const sessionId = 'play-checkpoint-active-attempt';
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/${sessionId}`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: sessionId,
        title: 'Checkpoint attempt conflict',
        sceneStart: 'The station gate is about to close.',
        purpose: 'sceneRehearsal',
        startMode: 'guided',
        sceneContract: {
          sceneId: 'scene-gate',
          worldClock: { turn: 0, revision: 0 },
          clockProvenance: { kind: 'newSessionInitial', sourceRefs: [] },
          objective: {
            value: 'Test whether Alice leaves.',
            provenance: {
              kind: 'authorProvided',
              providedAt: '2026-07-15T00:00:00.000Z',
            },
          },
          risk: {
            value: 'The gate closes first.',
            provenance: {
              kind: 'authorProvided',
              providedAt: '2026-07-15T00:00:00.000Z',
            },
          },
          participantRefs: ['participant-alice'],
          orderStrategy: 'directorFixed',
        },
        participants: [{
          participantRef: 'participant-alice',
          displayName: 'Alice',
          initialKnowledgeEvidenceRefs: ['knowledge-ticket'],
        }],
        initialKnowledgeEvidence: [{
          id: 'knowledge-ticket',
          participantRef: 'participant-alice',
          visibility: 'playerVisible',
          fact: 'Alice knows she holds the valid ticket.',
          provenance: {
            kind: 'authorProvided',
            providedAt: '2026-07-15T00:00:00.000Z',
          },
        }],
      }),
    });
    await fetchJson(`${sessionEndpoint}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ baseRevision: 0 }),
    });

    const response = await fetch(
      `${sessionEndpoint}/checkpoints/initial-world/name`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 0, name: 'Blocked name' }),
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'active_attempt',
    });
    await expect(fetchJson(sessionEndpoint)).resolves.toMatchObject({
      session: {
        revision: 0,
        metadataExtensions: {},
      },
    });
  });

  it('retries a committed Play turn atomically from its exact before-turn snapshot', async () => {
    const workspaceRoot = await createOanWorkspace();
    const providerTurns: Array<{
      session: {
        revision: number;
        selectedTurnIds: string[];
        transcript: Array<{ content: string }>;
        playLocalState: Record<string, unknown>;
      };
      request: string;
      timeAdvance?: { amount: number; unit: string };
    }> = [];
    let providerCall = 0;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* (input) {
        providerCall += 1;
        providerTurns.push({
          session: structuredClone(input.session),
          request: input.request,
          ...(input.timeAdvance ? { timeAdvance: { ...input.timeAdvance } } : {}),
        });
        yield createPlayTestRefereeResponse(
          providerCall === 1 ? '第一种结果。' : '重试后的另一种结果。',
          providerCall === 1 ? 'first' : 'retry',
          'PT2H',
        );
      },
    });
    servers.push(backend);
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/play-atomic-retry`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-atomic-retry',
        title: 'Atomic retry',
        sceneStart: 'Station',
      }),
    });
    const firstResponse = await fetch(`${sessionEndpoint}/turns/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userText: '等待钟声',
        actionKind: 'wait',
        baseRevision: 0,
        timeAdvance: { amount: 2, unit: 'hour' },
      }),
    });
    expect(parseSseDataEvents(await firstResponse.text())).toContainEqual(
      expect.objectContaining({ type: 'play.turn.committed', revision: 1 }),
    );

    const retryResponse = await fetch(
      `${sessionEndpoint}/turns/turn-artifact-1/retry/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 1 }),
      },
    );
    const runId = retryResponse.headers.get('x-oan-play-turn-id');
    const retryEvents = parseSseDataEvents(await retryResponse.text());
    const committed = retryEvents.find((event) =>
      event.type === 'play.turn.committed') as {
        artifactId: string;
        revision: number;
        session: {
          revision: number;
          selectedTurnIds: string[];
          turnArtifacts: Array<{
            id: string;
            parentTurnId?: string;
            input?: {
              kind: string;
              raw: string;
              timeAdvance?: { amount: number; unit: string };
            };
          }>;
          transcript: Array<{ content: string }>;
          playLocalState: Record<string, unknown>;
        };
      };

    expect(runId).toMatch(/^play-turn-/u);
    expect(runId).not.toBe('turn-artifact-1');
    expect(retryEvents[0]).toMatchObject({
      type: 'play.turn.started',
      baseRevision: 1,
      expectedArtifactId: 'turn-artifact-2',
      retry: { sourceArtifactId: 'turn-artifact-1' },
    });
    expect(committed).toMatchObject({
      artifactId: 'turn-artifact-2',
      revision: 2,
      session: {
        revision: 2,
        selectedTurnIds: ['turn-artifact-2'],
        playLocalState: { outcome: 'retry' },
      },
    });
    expect(committed.session.turnArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'turn-artifact-1',
        input: {
          kind: 'wait',
          raw: '等待钟声',
          timeAdvance: { amount: 2, unit: 'hour' },
        },
      }),
      expect.objectContaining({
        id: 'turn-artifact-2',
        input: {
          kind: 'wait',
          raw: '等待钟声',
          timeAdvance: { amount: 2, unit: 'hour' },
        },
      }),
    ]));
    expect(committed.session.turnArtifacts.every((artifact) =>
      artifact.parentTurnId === undefined)).toBe(true);
    expect(committed.session.transcript.map((turn) => turn.content)).toEqual([
      '等待钟声',
      '重试后的另一种结果。',
    ]);
    expect(providerTurns[1]).toMatchObject({
      session: {
        revision: 1,
        selectedTurnIds: [],
        transcript: [],
        playLocalState: {},
      },
      timeAdvance: { amount: 2, unit: 'hour' },
    });
    expect(providerTurns[1]?.request).toContain('requested elapsed PT2H');
  });

  it('strictly validates Play retry targets and mandatory revision before provider work', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerCalls = 0;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* () {
        providerCalls += 1;
        yield createPlayTestRefereeResponse('不应调用。', 'unexpected');
      },
    });
    servers.push(backend);
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/play-retry-validation`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-retry-validation',
        title: 'Retry validation',
        sceneStart: 'Archive',
      }),
    });
    await fetchJson(`${sessionEndpoint}/transcript`, {
      method: 'POST',
      body: JSON.stringify({
        speaker: 'note',
        content: 'Not a settlement.',
        baseRevision: 0,
      }),
    });
    const retry = (artifactId: string, body: Record<string, unknown>) => fetch(
      `${sessionEndpoint}/turns/${encodeURIComponent(artifactId)}/retry/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    await expect(retry('turn-artifact-1', {})).resolves.toMatchObject({ status: 400 });
    await expect(retry('turn-artifact-1', { baseRevision: -1 }))
      .resolves.toMatchObject({ status: 400 });
    await expect(retry('turn-artifact-1', { baseRevision: 1, userText: 'override' }))
      .resolves.toMatchObject({ status: 400 });
    await expect(retry('turn-artifact-1', { baseRevision: 0 }))
      .resolves.toMatchObject({ status: 409 });
    await expect(retry('missing-artifact', { baseRevision: 1 }))
      .resolves.toMatchObject({ status: 404 });
    await expect(retry('..unsafe', { baseRevision: 1 }))
      .resolves.toMatchObject({ status: 400 });
    await expect(retry('turn-artifact-1', { baseRevision: 1 }))
      .resolves.toMatchObject({ status: 422 });
    expect(providerCalls).toBe(0);
  });

  it('cancels a Play retry by execution run id without changing the selected artifact', async () => {
    const workspaceRoot = await createOanWorkspace();
    let providerCall = 0;
    let markRetryStreaming: (() => void) | undefined;
    const retryStreaming = new Promise<void>((resolve) => {
      markRetryStreaming = resolve;
    });
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* (input) {
        providerCall += 1;
        if (providerCall === 1) {
          yield createPlayTestRefereeResponse('原结果。', 'original');
          return;
        }
        markRetryStreaming?.();
        yield '仍未提交的重试内容。';
        await new Promise<void>((resolve) => {
          input.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    });
    servers.push(backend);
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/play-retry-cancel`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({ id: 'play-retry-cancel', title: 'Retry cancel', sceneStart: 'Gate' }),
    });
    const first = await fetch(`${sessionEndpoint}/turns/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userText: '等待', actionKind: 'wait', baseRevision: 0 }),
    });
    await first.text();

    const retryResponse = await fetch(
      `${sessionEndpoint}/turns/turn-artifact-1/retry/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 1 }),
      },
    );
    await retryStreaming;
    const runId = retryResponse.headers.get('x-oan-play-turn-id');
    expect(runId).toMatch(/^play-turn-/u);
    await expect(fetchJson(
      `${sessionEndpoint}/turns/turn-artifact-1/cancel`,
      { method: 'POST' },
    )).rejects.toThrow('Play turn run was not found');
    await expect(fetchJson(
      `${sessionEndpoint}/turns/${runId}/cancel`,
      { method: 'POST' },
    )).resolves.toMatchObject({ status: 'cancelling', committed: false });

    const retryEvents = parseSseDataEvents(await retryResponse.text());
    expect(retryEvents).toContainEqual(expect.objectContaining({
      type: 'play.turn.cancelled',
      committed: false,
      revision: 1,
    }));
    expect(retryEvents.some((event) => event.type === 'play.turn.committed')).toBe(false);
    await expect(fetchJson(sessionEndpoint)).resolves.toMatchObject({
      session: {
        revision: 1,
        selectedTurnIds: ['turn-artifact-1'],
        turnArtifacts: [expect.objectContaining({ id: 'turn-artifact-1' })],
      },
    });
  });

  it('fails a prepared Play retry when another backend changes the revision before commit', async () => {
    const workspaceRoot = await createOanWorkspace();
    const competingBackend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(competingBackend);
    let providerCall = 0;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* () {
        providerCall += 1;
        if (providerCall === 2) {
          await fetchJson(
            `${competingBackend.url}/api/workspace/play-sessions/play-retry-drift/transcript`,
            {
              method: 'POST',
              body: JSON.stringify({
                speaker: 'note',
                content: 'Concurrent committed mutation.',
                baseRevision: 1,
              }),
            },
          );
        }
        yield createPlayTestRefereeResponse(
          providerCall === 1 ? '原结果。' : '本应成为重试结果。',
          providerCall === 1 ? 'original' : 'retry',
        );
      },
    });
    servers.push(backend);
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/play-retry-drift`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({ id: 'play-retry-drift', title: 'Retry drift', sceneStart: 'Gate' }),
    });
    const first = await fetch(`${sessionEndpoint}/turns/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userText: '等待', actionKind: 'wait', baseRevision: 0 }),
    });
    await first.text();

    const retryResponse = await fetch(
      `${sessionEndpoint}/turns/turn-artifact-1/retry/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 1 }),
      },
    );
    const retryEvents = parseSseDataEvents(await retryResponse.text());
    expect(retryEvents).toContainEqual(expect.objectContaining({
      type: 'play.turn.failed',
      error: expect.objectContaining({ code: 'revision_conflict', retryable: true }),
    }));
    expect(retryEvents.some((event) => event.type === 'play.turn.committed')).toBe(false);
    await expect(fetchJson(
      `${competingBackend.url}/api/workspace/play-sessions/play-retry-drift`,
    )).resolves.toMatchObject({
      session: {
        revision: 2,
        selectedTurnIds: ['turn-artifact-1', 'turn-artifact-2'],
        transcript: expect.arrayContaining([
          expect.objectContaining({ content: 'Concurrent committed mutation.' }),
        ]),
      },
    });
  });

  it('confirms a mid-stream Play cancellation without committing provisional facts', async () => {
    const workspaceRoot = await createOanWorkspace();
    let markStreaming: (() => void) | undefined;
    const streaming = new Promise<void>((resolve) => {
      markStreaming = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* (input) {
        providerSignal = input.abortSignal;
        markStreaming?.();
        yield '这段文字仍然只是 provisional。';
        await new Promise<void>((resolve) => {
          input.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-stream-cancel',
        title: 'Stream cancel',
        sceneStart: 'Station',
      }),
    });
    const response = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-stream-cancel/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '等待', actionKind: 'wait', baseRevision: 0 }),
      },
    );
    await streaming;
    const turnId = response.headers.get('x-oan-play-turn-id');
    expect(turnId).toBeTruthy();

    const cancellation = await fetchJson<{
      status: string;
      committed: boolean;
    }>(
      `${backend.url}/api/workspace/play-sessions/play-stream-cancel/turns/${turnId}/cancel`,
      { method: 'POST' },
    );
    const events = parseSseDataEvents(await response.text());

    expect(cancellation).toMatchObject({ status: 'cancelling', committed: false });
    expect(providerSignal?.aborted).toBe(true);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'play.turn.cancelled',
        committed: false,
        revision: 0,
      }),
    ]));
    expect(events.some((event) => event.type === 'play.narrative.delta')).toBe(false);
    expect(events.some((event) => event.type === 'play.turn.committed')).toBe(false);
    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-stream-cancel`,
    )).resolves.toMatchObject({
      session: {
        revision: 0,
        transcript: [],
        events: [],
        observations: [],
        playLocalState: {},
      },
    });
  });

  it('blocks workspace switching and removal while a Play turn is active', async () => {
    const workspaceRoot = await createOanWorkspace();
    const otherWorkspaceRoot = await createOanWorkspace();
    const globalConfigDir = await createTempWorkspace();
    let markStreaming: (() => void) | undefined;
    const streaming = new Promise<void>((resolve) => {
      markStreaming = resolve;
    });
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      globalConfigDir,
      streamPlayTurn: async function* (input) {
        yield '仍在生成的 provisional。';
        markStreaming?.();
        await new Promise<void>((resolve) => {
          input.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-workspace-transition',
        title: 'Workspace transition',
        sceneStart: 'Station',
      }),
    });
    const streamResponse = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-workspace-transition/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '等待', baseRevision: 0 }),
      },
    );
    const turnId = streamResponse.headers.get('x-oan-play-turn-id');
    expect(turnId).toMatch(/^play-turn-/u);
    await streaming;

    const openResponse = await fetch(`${backend.url}/api/workspaces/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: otherWorkspaceRoot }),
    });
    expect(openResponse.status).toBe(409);

    const removeResponse = await fetch(`${backend.url}/api/workspaces`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: workspaceRoot }),
    });
    expect(removeResponse.status).toBe(409);

    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-workspace-transition/turns/${turnId}/cancel`,
      { method: 'POST' },
    )).resolves.toMatchObject({ status: 'cancelling', committed: false });
    expect(await streamResponse.text()).toContain('play.turn.cancelled');
  });

  it('reconciles an old committed turn from its immutable workspace without rolling back revision', async () => {
    const workspaceRoot = await createOanWorkspace();
    const otherWorkspaceRoot = await createOanWorkspace();
    const globalConfigDir = await createTempWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      globalConfigDir,
      streamPlayTurn: async function* () {
        yield [
          '第一回合已经提交。',
          '```oan-play-settlement',
          JSON.stringify({
            events: [],
            stateDelta: {},
            observations: [],
            suggestedActions: [],
          }),
          '```',
        ].join('\n');
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-delayed-reconcile',
        title: 'Delayed reconcile',
        sceneStart: 'Station',
      }),
    });
    const streamResponse = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-delayed-reconcile/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '行动', baseRevision: 0 }),
      },
    );
    const turnId = streamResponse.headers.get('x-oan-play-turn-id');
    expect(turnId).toMatch(/^play-turn-/u);
    expect(await streamResponse.text()).toContain('play.turn.committed');

    await fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-delayed-reconcile/transcript`,
      {
        method: 'POST',
        body: JSON.stringify({
          speaker: 'narrator',
          content: '第二次 mutation。',
          baseRevision: 1,
        }),
      },
    );
    await fetchJson(`${backend.url}/api/workspaces/open`, {
      method: 'POST',
      body: JSON.stringify({ path: otherWorkspaceRoot }),
    });

    await expect(fetchJson<{
      status: string;
      session: { revision: number; transcript: Array<{ content: string }> };
    }>(
      `${backend.url}/api/workspace/play-sessions/play-delayed-reconcile/turns/${turnId}/cancel`,
      { method: 'POST' },
    )).resolves.toMatchObject({
      status: 'committed',
      session: {
        revision: 2,
        transcript: expect.arrayContaining([
          expect.objectContaining({ content: '第二次 mutation。' }),
        ]),
      },
    });
  });

  it('releases the Play session after cancel even when an injected provider ignores abort', async () => {
    const workspaceRoot = await createOanWorkspace();
    let markBlocked: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      markBlocked = resolve;
    });
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* () {
        yield 'provider 已输出一部分内容。';
        markBlocked?.();
        await new Promise<void>(() => undefined);
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-stream-stubborn-provider',
        title: 'Stubborn provider',
        sceneStart: 'Station',
      }),
    });
    const response = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-stream-stubborn-provider/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '等待', actionKind: 'wait', baseRevision: 0 }),
      },
    );
    await blocked;
    const turnId = response.headers.get('x-oan-play-turn-id');

    await fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-stream-stubborn-provider/turns/${turnId}/cancel`,
      { method: 'POST' },
    );
    const events = parseSseDataEvents(await response.text());

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'play.turn.cancelled', committed: false }),
    ]));
    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-stream-stubborn-provider`,
    )).resolves.toMatchObject({
      session: { revision: 0, transcript: [], events: [], playLocalState: {} },
    });
  });

  it('rejects raw structured data before a valid fence without exposing or committing it', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      streamPlayTurn: async function* () {
        yield '走廊安静。\n';
        yield '{"events":[{"visibility":"playerUnknown","summary":"刺客在阁楼"}]}';
        yield '\n```oan-play-settlement\n';
        yield JSON.stringify({
          events: [],
          stateDelta: {},
          observations: [],
          suggestedActions: [],
        });
        yield '\n```';
      },
    });
    servers.push(backend);

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-stream-invalid',
        title: 'Invalid stream',
        sceneStart: 'Station',
      }),
    });
    const response = await fetch(
      `${backend.url}/api/workspace/play-sessions/play-stream-invalid/turns/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: '观察', actionKind: 'look', baseRevision: 0 }),
      },
    );
    const events = parseSseDataEvents(await response.text());

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'play.turn.failed',
        error: expect.objectContaining({ code: 'invalid_settlement' }),
      }),
    ]));
    expect(events.some((event) => event.type === 'play.narrative.delta')).toBe(false);
    expect(events.some((event) => event.type === 'play.turn.committed')).toBe(false);
    await expect(fetchJson(
      `${backend.url}/api/workspace/play-sessions/play-stream-invalid`,
    )).resolves.toMatchObject({
      session: { revision: 0, transcript: [], events: [], playLocalState: {} },
    });
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

  it('keeps Play checkpoint reads and restores behind the active session lock', async () => {
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
    const sessionEndpoint = `${backend.url}/api/workspace/play-sessions/play-checkpoint-busy`;

    await fetchJson(`${backend.url}/api/workspace/play-sessions`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'play-checkpoint-busy',
        title: 'Checkpoint busy',
        sceneStart: 'Archive',
      }),
    });
    await fetchJson(`${sessionEndpoint}/transcript`, {
      method: 'POST',
      body: JSON.stringify({ speaker: 'note', content: 'First', baseRevision: 0 }),
    });
    await fetchJson(`${sessionEndpoint}/transcript`, {
      method: 'POST',
      body: JSON.stringify({ speaker: 'note', content: 'Second', baseRevision: 1 }),
    });

    const runningTurn = fetch(`${sessionEndpoint}/world-referee-turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userText: '等待', actionKind: 'wait', baseRevision: 2 }),
    });
    await started;

    const listed = await fetch(`${sessionEndpoint}/checkpoints`);
    expect(listed.status).toBe(409);
    const restored = await fetch(
      `${sessionEndpoint}/checkpoints/turn-artifact-1/restore`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 2 }),
      },
    );
    expect(restored.status).toBe(409);

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

function createPlayLaunchPreviewInput(
  id: string,
  purpose: 'immersiveJourney' | 'sceneRehearsal',
): Record<string, unknown> {
  const rehearsal = purpose === 'sceneRehearsal';
  const sources = [{
    sourceId: 'chapter-opening',
    path: 'chapters/0001/0001.md',
    role: 'chapter',
    reason: 'Opening scene source',
  }];
  if (rehearsal) {
    sources.push({
      sourceId: 'character-heroine',
      path: 'characters/heroine/character.md',
      role: 'character',
      reason: 'Canonical participant source',
    });
  }
  const sourceRefs = sources.map((source) => source.sourceId);
  return {
    id,
    createdAt: '2026-07-16T00:00:00.000Z',
    title: rehearsal ? 'Gate Scene Rehearsal' : 'Guided Gate Journey',
    purpose,
    startMode: 'guided',
    simulationMode: rehearsal ? 'conversation' : 'reactiveWorld',
    density: 'balanced',
    sources,
    entryPoint: {
      id: rehearsal ? 'scene-gate' : 'entry-gate',
      label: 'At the gate',
      opening: 'Rain falls over the gate as the last train approaches.',
      sourceRefs,
      worldTime: {
        value: 'Late evening',
        provenance: {
          kind: 'authorProvided',
          providedAt: '2026-07-16T00:00:00.000Z',
        },
      },
      objective: {
        value: rehearsal ? 'Test whether the heroine leaves.' : 'Reach the platform.',
        provenance: { kind: 'sourceBacked', sourceRefs: ['chapter-opening'] },
      },
      risk: {
        value: 'The gate may close first.',
        provenance: { kind: 'sourceBacked', sourceRefs: ['chapter-opening'] },
      },
    },
    identity: rehearsal
      ? {
          kind: 'director',
          directorPurpose: 'Test the heroine reaction without changing canon.',
        }
      : { kind: 'player', persona: 'A traveler trying to catch the train.' },
    participantRoles: rehearsal
      ? [{
          participantRef: 'participant-heroine',
          displayName: 'Heroine',
          canonicalCharacterRef: 'heroine',
          sourceRefs: ['character-heroine'],
          position: 'Beside the closing gate',
          currentGoal: 'Decide whether to board',
          initialKnowledge: [{
            id: 'knowledge-last-train',
            fact: 'This is the last train tonight.',
            visibility: 'playerVisible',
            sourceRefs: ['chapter-opening'],
          }],
        }]
      : [],
  };
}

function createCompactSceneRehearsalCreateInput(id: string): Record<string, unknown> {
  return {
    id,
    title: 'Compact rehearsal',
    sceneStart: 'The station gate is about to close.',
    purpose: 'sceneRehearsal',
    sceneContract: {
      sceneId: 'scene-compact',
      worldClock: { turn: 0, revision: 0 },
      clockProvenance: { kind: 'newSessionInitial', sourceRefs: [] },
      participantRefs: ['participant-alice'],
      orderStrategy: 'directorFixed',
    },
    participants: [{
      participantRef: 'participant-alice',
      displayName: 'Alice',
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

function createPlayTestRefereeResponse(
  narrative: string,
  outcome: string,
  elapsed?: string,
): string {
  return [
    narrative,
    '```oan-play-settlement',
    JSON.stringify({
      ...(elapsed ? { elapsed } : {}),
      events: [],
      scheduledEventChanges: [],
      stateDelta: { outcome },
      observations: [],
      suggestedActions: [],
    }),
    '```',
  ].join('\n');
}

function parseSseDataEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split(/\r?\n\r?\n/u)
    .map((block) => block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n'))
    .filter((data) => data && data !== '[DONE]')
    .map((data) => JSON.parse(data) as Record<string, unknown>);
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
