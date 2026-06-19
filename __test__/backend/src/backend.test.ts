import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
import { createWriteIntentTools } from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

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
