import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';

const tempRoots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

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

  it('exposes a health endpoint', async () => {
    const workspaceRoot = await createTempWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);

    await expect(fetch(`${backend.url}/api/health`).then((res) => res.json()))
      .resolves
      .toEqual({ ok: true });
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
        git: {
          status: 'unknown',
          dirty: null,
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

  it('stores provider config outside the novel workspace runtime', async () => {
    const workspaceRoot = await createTempWorkspace();
    const globalConfigDir = await createTempWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot, globalConfigDir });
    servers.push(backend);

    await expect(fetchJson(`${backend.url}/api/provider-config`))
      .resolves
      .toMatchObject({ configured: false, providers: [] });

    await expect(fetchJson(`${backend.url}/api/provider-config`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'default',
        kind: 'deepseek',
        model: 'deepseek-chat',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
      }),
    }))
      .resolves
      .toMatchObject({
        configured: true,
        defaultProviderId: 'default',
        providers: [
          expect.objectContaining({
            id: 'default',
            apiKeyEnv: 'DEEPSEEK_API_KEY',
          }),
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
        defaultProviderId: 'default',
        providers: [
          expect.objectContaining({
            id: 'default',
            apiKeyEnv: 'DEEPSEEK_API_KEY',
          }),
        ],
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

  return root;
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
