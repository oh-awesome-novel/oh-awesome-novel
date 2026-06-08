import { mkdtemp, rm } from 'node:fs/promises';
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
});

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-backend-'));
  tempRoots.push(root);
  return root;
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
