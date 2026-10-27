import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  createNovelHonoApp,
  startNovelHttpBackend,
  toPendingActionViewErrorResponse,
} from '@oh-awesome-novel/backend';

const servers: Array<{ close(): Promise<void> }> = [];
const tempRoots: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local backend trust boundary', () => {
  it('requires the per-launch token when one is configured', async () => {
    const app = createNovelHonoApp({ authToken: 'launch-secret' });

    expect((await app.request('http://127.0.0.1/api/health')).status).toBe(401);
    expect((await app.request('http://127.0.0.1/api/health', {
      headers: { 'x-oan-token': 'wrong-secret' },
    })).status).toBe(401);
    expect((await app.request('http://127.0.0.1/api/health', {
      headers: { 'x-oan-token': 'launch-secret' },
    })).status).toBe(200);
  });

  it('rejects foreign origins and does not grant them CORS access', async () => {
    const app = createNovelHonoApp({ authToken: 'launch-secret' });
    const headers = { 'x-oan-token': 'launch-secret' };

    const foreign = await app.request('http://127.0.0.1/api/health', {
      headers: { ...headers, origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await app.request('http://127.0.0.1/api/workspace/pending-actions/a/accept', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();

    const devServer = await app.request('http://127.0.0.1/api/health', {
      headers: { ...headers, origin: 'http://127.0.0.1:5173' },
    });
    expect(devServer.status).toBe(200);
    expect(devServer.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');

    // The packaged renderer is a file:// page; its opaque origin is only
    // trusted together with the token.
    expect((await app.request('http://127.0.0.1/api/health', {
      headers: { ...headers, origin: 'null' },
    })).status).toBe(200);
    expect((await createNovelHonoApp({}).request('http://127.0.0.1/api/health', {
      headers: { origin: 'null' },
    })).status).toBe(403);
  });

  it('rejects DNS-rebinding hosts', async () => {
    const app = createNovelHonoApp({});

    expect((await app.request('http://attacker.example/api/health')).status).toBe(403);
    expect((await app.request('http://localhost/api/health')).status).toBe(200);
    expect((await app.request('http://127.0.0.1/api/health')).status).toBe(200);
  });

  it('never sends a stored API key to a Base URL it was not saved for', async () => {
    const provider = await startCapturingProvider();
    const attacker = await startCapturingProvider();
    const globalConfigDir = await createTempDir();
    const backend = await startNovelHttpBackend({
      workspaceRoot: await createTempDir(),
      globalConfigDir,
    });
    servers.push(provider, attacker, backend);

    await postJson(`${backend.url}/api/provider-config`, {
      id: 'custom',
      kind: 'custom',
      baseUrl: `${provider.url}/v1`,
      model: 'custom-large',
      apiKey: 'stored-secret',
      default: true,
    });

    for (const route of ['/api/provider-config/check', '/api/provider-config/models']) {
      const redirected = await postJson(`${backend.url}${route}`, {
        providerId: 'custom',
        kind: 'custom',
        model: 'custom-large',
        baseUrl: `${attacker.url}/v1`,
      });
      expect(redirected.status).toBe(400);
    }

    const moved = await postJson(`${backend.url}/api/provider-config`, {
      id: 'custom',
      kind: 'custom',
      baseUrl: `${attacker.url}/v1`,
      model: 'custom-large',
    });
    expect(moved.status).toBe(400);
    expect(attacker.authorizations).toEqual([]);

    // Same endpoint: the stored key is reused.
    const sameEndpoint = await postJson(`${backend.url}/api/provider-config`, {
      id: 'custom',
      kind: 'custom',
      baseUrl: `${provider.url}/v1/`,
      model: 'custom-small',
    });
    expect(sameEndpoint.status).toBe(200);
    await postJson(`${backend.url}/api/provider-config/models`, { providerId: 'custom' });
    expect(provider.authorizations).toContain('Bearer stored-secret');

    const stored = JSON.parse(await readFile(join(globalConfigDir, 'llm-providers.json'), 'utf8'));
    expect(stored.state.providers[0]).toMatchObject({ apiKey: 'stored-secret', model: 'custom-small' });
    if (process.platform !== 'win32') {
      expect((await stat(join(globalConfigDir, 'llm-providers.json'))).mode & 0o777).toBe(0o600);
    }
  });

  it('strips host absolute paths from PendingAction errors', () => {
    const response = toPendingActionViewErrorResponse(Object.assign(
      new Error('Expected private regular file: /Users/author/novel/chapters/0001/0001.md.'),
      { code: 'UNSAFE_CANONICAL_TARGET' },
    ));
    expect(response.body.error).toBe('Expected private regular file: <host-path>/0001.md.');
    expect(JSON.stringify(response.body)).not.toContain('/Users/author');
  });
});

async function createTempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-trust-boundary-'));
  tempRoots.push(root);
  return root;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function startCapturingProvider(): Promise<{
  url: string;
  authorizations: string[];
  close(): Promise<void>;
}> {
  const authorizations: string[] = [];
  const server = createServer((request, response) => {
    const authorization = (request.headers as IncomingHttpHeaders).authorization;
    if (authorization) authorizations.push(authorization);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'custom-large', object: 'model' }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    authorizations,
    close: () => new Promise<void>((resolveClose) => {
      server.closeAllConnections();
      server.close(() => resolveClose());
    }),
  };
}
