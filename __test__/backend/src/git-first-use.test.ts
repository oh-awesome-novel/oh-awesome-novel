import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createSandboxEditSession, createWorkspaceChangePolicy } from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('workspace creation Git entrypoint', () => {
  it('creates a usable real baseline and preserves dirty imports', async () => {
    for (const role of ['AUTHOR', 'COMMITTER']) {
      vi.stubEnv(`GIT_${role}_NAME`, 'OAN Test');
      vi.stubEnv(`GIT_${role}_EMAIL`, 'oan@example.test');
    }
    const root = await tempRoot();
    const backend = await startNovelHttpBackend({ globalConfigDir: await tempRoot() });
    servers.push(backend);
    const response = await post(backend.url, '/api/workspaces/create', { path: root });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ git: { repository: true, status: 'clean', head: expect.any(String) } });
    const session = await createSandboxEditSession({
      workspaceRoot: root, policy: createWorkspaceChangePolicy({ capability: 'read-only' }),
    });
    await expect(session.preview()).resolves.toMatchObject({ changes: [] });
    await session.dispose();
    const head = await git(root, 'rev-parse', 'HEAD');
    await writeFile(join(root, 'summaries/global.md'), '# Author draft\n');
    const imported = await post(backend.url, '/api/workspaces/import', { path: root });
    expect(imported.status).toBe(200);
    expect(await git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(root, 'summaries/global.md'), 'utf8')).toBe('# Author draft\n');

    const unsupported = 'summaries/line\nbreak.md';
    await writeFile(join(root, unsupported), 'unsupported\n');
    const preview = await fetch(`${backend.url}/api/git/diff?file=${encodeURIComponent(unsupported)}`);
    expect(preview.status).toBe(400);
    expect(await preview.json()).toMatchObject({ error: expect.stringContaining('Unsupported workspace path') });
  });

  it('returns a visible recoverable state when Git is unavailable', async () => {
    const root = await tempRoot();
    const backend = await startNovelHttpBackend({ globalConfigDir: await tempRoot() });
    servers.push(backend);
    vi.stubEnv('PATH', root);
    const response = await post(backend.url, '/api/workspaces/create', { path: root });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ git: { available: false, error: { code: 'git_unavailable' } } });
    const status = await fetch(`${backend.url}/api/workspace/status`);
    expect(await status.json()).toMatchObject({ git: { error: { code: 'git_unavailable' } } });
  });
});

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'oan-backend-first-use-'));
  roots.push(root);
  return root;
}

function post(url: string, path: string, body: unknown) {
  return fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function git(root: string, ...args: string[]) {
  return (await execFileAsync('git', ['-C', root, ...args])).stdout;
}
