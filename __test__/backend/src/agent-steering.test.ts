import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import type { NovelBackendAgentInput, NovelHonoApp } from '@oh-awesome-novel/backend';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const sessionId = 'chat-steer';
const turnId = 'turn-steer-1';

function post(app: NovelHonoApp, url: string, body: unknown) {
  return app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function chat(app: NovelHonoApp, body: Record<string, unknown> = {}) {
  return post(app, '/api/agent/chat', {
    sessionId,
    turnId,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    ...body,
  });
}
function steer(app: NovelHonoApp, body: unknown, id = sessionId) {
  return post(app, `/api/agent/chat/${id}/steer`, body);
}
function finish(content: string): RuntimeEvent {
  return {
    type: 'message_finish',
    result: { messages: [], assistantMessage: { role: 'assistant', content }, toolLog: [], pendingActions: [], stoppedReason: 'completed' },
  };
}

async function fixture(runAgent: (input: NovelBackendAgentInput) => AsyncIterable<RuntimeEvent>) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-agent-steer-'));
  roots.push(workspaceRoot);
  return createNovelHonoApp({ workspaceRoot, runAgent });
}

describe('Copilot steer endpoint', () => {
  it('delivers a steer to the running turn and refuses it once the turn has ended', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const app = await fixture(async function* (input) {
      yield { type: 'message_start', messages: [] };
      started();
      await gate;
      const steers = input.steering?.drain() ?? [];
      input.steering?.close();
      yield { type: 'message_delta', text: `saw:${steers.map((message) => message.content).join('|')}` };
      yield finish('done');
    });

    const response = await chat(app);
    const wire = response.text();
    await running;

    const accepted = await steer(app, { turnId, content: '  换成第一人称  ' });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ status: 'accepted', id: expect.stringMatching(/^steer-/) });
    expect((await steer(app, { turnId: 'turn-other', content: 'x' })).status).toBe(409);

    release();
    expect(await wire).toContain('saw:换成第一人称');

    const late = await steer(app, { turnId, content: 'too late' });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'STEER_TOO_LATE' });
  });

  it('hands back steers a turn never drained', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const app = await fixture(async function* () {
      yield { type: 'message_start', messages: [] };
      started();
      await gate;
      yield finish('done');
    });

    const wire = (await chat(app)).text();
    await running;
    expect((await steer(app, { turnId, content: '补一句' })).status).toBe(200);
    release();

    const body = await wire;
    expect(body).toContain('"type":"data-steering"');
    expect(body).toContain('"status":"rejected"');
    expect(body).toContain('补一句');
  });

  it('releases the registry when the turn throws', async () => {
    const app = await fixture(async function* () {
      yield { type: 'message_start', messages: [] };
      throw new Error('boom');
    });
    await (await chat(app)).text();
    expect((await steer(app, { turnId, content: 'x' })).status).toBe(409);
  });

  it('rejects malformed steers and turn ids', async () => {
    const app = await fixture(async function* () { yield finish('done'); });
    expect((await steer(app, { turnId, content: 'x', exactWritablePaths: ['chapters/0001/0001.md'] })).status).toBe(400);
    expect((await steer(app, { turnId, content: '   ' })).status).toBe(400);
    expect((await steer(app, { turnId, content: 'x'.repeat(20_001) })).status).toBe(400);
    expect((await steer(app, { turnId: '../x', content: 'x' })).status).toBe(400);
    expect((await steer(app, { turnId, content: 'x' }, 'bad.id')).status).toBe(400);
    expect((await chat(app, { turnId: 'bad id' })).status).toBe(400);
    expect((await chat(app, { sessionId: undefined })).status).toBe(400);
  });
});
