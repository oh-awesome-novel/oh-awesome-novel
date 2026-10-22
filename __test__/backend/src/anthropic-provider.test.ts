import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
const roots: string[] = [];
const git = promisify(execFile);
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('Anthropic provider setup', () => {
  it('lists models and checks Messages API using Anthropic headers, then saves the provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-anthropic-')); roots.push(root);
    const app = createNovelHonoApp({ workspaceRoot: root, globalConfigDir: root });
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-secret');
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01');
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'claude-test', display_name: 'Test Claude' }] });
      expect(String(url)).toBe('https://anthropic.test/v1/messages');
      const body = JSON.parse(String(init?.body));
      expect(body.system).toContain('connectivity check');
      expect(body.messages).toEqual([{ role: 'user', content: 'Reply OK.' }]);
      return Response.json({ content: [{ type: 'text', text: 'OK' }] });
    });
    vi.stubGlobal('fetch', fetch);
    const input = { id: 'anthropic', kind: 'anthropic', baseUrl: 'https://anthropic.test/v1', model: 'claude-test', apiKey: 'test-secret' };
    const post = (path: string) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const models = await post('/api/provider-config/models');
    expect(models.status).toBe(200);
    expect(await models.json()).toMatchObject({ models: [{ id: 'claude-test', displayName: 'Test Claude' }] });
    const checked = await post('/api/provider-config/check');
    expect(await checked.json()).toMatchObject({ ok: true, model: 'claude-test' });
    const saved = await post('/api/provider-config');
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toMatchObject({ providers: [expect.objectContaining({ kind: 'anthropic', hasApiKey: true })] });
  });
});


describe('Play Anthropic cache wiring', () => {
  it('caches the frozen prefix and actual committed reply on the next HTTP Play turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-play-cache-')); roots.push(root);
    await mkdir(join(root, '.oan')); await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
    await writeFile(join(root, '.gitignore'), '.workspace/\n');
    await git('git', ['init', '-b', 'main', root]);
    await git('git', ['-C', root, 'config', 'user.name', 'Test']);
    await git('git', ['-C', root, 'config', 'user.email', 'test@example.test']);
    await git('git', ['-C', root, 'add', '.']);
    await git('git', ['-C', root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'baseline']);
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const text = 'The gate remains closed.\n```oan-play-settlement\n' + JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] }) + '\n```';
      const events = [
        { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    const app = createNovelHonoApp({ workspaceRoot: root, providerConfig: { id: 'anthropic', kind: 'anthropic', model: 'claude-test', apiKey: 'test', baseUrl: 'https://anthropic.test/v1' } });
    const post = (path: string, body: unknown) => app.request(`/api/workspace/play-sessions${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('', { id: 'cache-play', title: 'Cache', sceneStart: 'Gate', characters: [] })).status).toBe(200);
    for (let n = 0; n < 2; n++) {
      const response = await post('/cache-play/world-referee-turn', { userText: `Wait ${n}`, baseRevision: n });
      expect(response.status, await response.clone().text()).toBe(200);
    }
    expect(bodies).toHaveLength(2);
    expect(bodies[0].system).toEqual(bodies[1].system);
    expect(bodies[1].system.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    const reply = bodies[1].messages.find((message: any) => message.role === 'assistant');
    expect(reply.content).toEqual([{ type: 'text', text: 'The gate remains closed.', cache_control: { type: 'ephemeral' } }]);
    expect(bodies[1].messages.at(-1).content.at(-1).cache_control).toBeUndefined();
  });
});
