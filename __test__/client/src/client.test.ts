import { describe, expect, it, vi } from 'vitest';

import {
  createOanClient,
  type OanDesktopBridge,
} from '@oh-awesome-novel/client';

describe('createOanClient', () => {
  it('routes workspace requests through the configured HTTP base URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = createFetchMock(calls, {
      workspaces: [],
      providerConfigured: true,
    });
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test/',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });

    await client.listWorkspaces();
    await client.importWorkspace('/novels/demo');
    await client.rebuildProjections();
    await client.createPlaySession({
      title: 'Play',
      sceneStart: 'Scene',
    });
    await client.runPlayWorldRefereeTurn('play-1', {
      userText: '等待两小时',
      actionKind: 'wait',
      baseRevision: 0,
    });
    await client.createPlayAdoptionPendingAction('play-1', 'adopt-1', {
      chapterId: '0001/0002',
      content: '正文',
    });

    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspaces',
      init: { method: 'GET' },
    });
    expect(calls[1]).toMatchObject({
      url: 'http://backend.test/api/workspaces/import',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      path: '/novels/demo',
    });
    expect(calls[2]).toMatchObject({
      url: 'http://backend.test/api/workspace/projections/rebuild',
      init: { method: 'POST' },
    });
    expect(calls[3]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions',
      init: { method: 'POST' },
    });
    expect(calls[4]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/world-referee-turn',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(calls[4]?.init?.body))).toEqual({
      userText: '等待两小时',
      actionKind: 'wait',
      baseRevision: 0,
    });
    expect(calls[5]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/adoption-candidates/adopt-1/pending-action',
      init: { method: 'POST' },
    });
  });

  it('surfaces backend error messages from JSON error responses', async () => {
    const client = createOanClient({
      fetch: createFetchMock([], { error: 'Workspace missing.' }, 404),
      systemTheme: () => 'dark',
    });

    await expect(client.getWorkspaceStatus()).rejects.toThrow('Workspace missing.');
  });

  it('uses the desktop bridge for app, theme, directory picker and backend URL', async () => {
    const bridge: OanDesktopBridge = {
      backendBaseUrl: 'http://desktop-backend',
      app: {
        getVersion: vi.fn(async () => '1.2.3'),
      },
      appConfig: {
        get: vi.fn(async () => ({ composerSubmitShortcut: 'meta-enter' })),
        set: vi.fn(async (config) => config),
      },
      theme: {
        get: vi.fn(async () => 'light'),
        set: vi.fn(async (theme) => theme),
      },
      workspace: {
        selectDirectory: vi.fn(async () => '/workspace'),
      },
    };
    const client = createOanClient({
      backendBaseUrl: 'http://browser-backend',
      bridge,
      fetch: createFetchMock([], {}),
      systemTheme: () => 'dark',
    });

    expect(client.backendBaseUrl).toBe('http://desktop-backend');
    expect(client.getAgentChatApi()).toBe('http://desktop-backend/api/agent/chat');
    expect(client.createAgentChatTransport()).toBeTruthy();
    await expect(client.getAppVersion()).resolves.toBe('1.2.3');
    await expect(client.getThemePreference()).resolves.toBe('light');
    await expect(client.setThemePreference('dark')).resolves.toBe('dark');
    await expect(client.getComposerSubmitShortcutPreference()).resolves.toBe('meta-enter');
    await expect(client.setComposerSubmitShortcutPreference('ctrl-enter')).resolves.toBe('ctrl-enter');
    expect(client.isDirectoryPickerAvailable()).toBe(true);
    await expect(client.selectDirectory()).resolves.toBe('/workspace');
  });

  it('reads and writes app config through the HTTP backend when no desktop bridge exists', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });

      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({
          config: JSON.parse(String(init.body)),
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        config: {
          theme: 'light',
          composerSubmitShortcut: 'meta-enter',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });

    await expect(client.getAppConfig()).resolves.toEqual({
      theme: 'light',
      composerSubmitShortcut: 'meta-enter',
    });
    await expect(client.getThemePreference()).resolves.toBe('light');
    await expect(client.getComposerSubmitShortcutPreference()).resolves.toBe('meta-enter');
    await expect(client.setComposerSubmitShortcutPreference('ctrl-enter')).resolves.toBe('ctrl-enter');

    expect(calls.map((call) => call.url)).toEqual([
      'http://backend.test/api/app-config',
      'http://backend.test/api/app-config',
      'http://backend.test/api/app-config',
      'http://backend.test/api/app-config',
    ]);
    expect(calls[3]?.init).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse(String(calls[3]?.init?.body))).toEqual({
      composerSubmitShortcut: 'ctrl-enter',
    });
  });

  it('falls back to injected browser capabilities when no desktop bridge exists', async () => {
    const client = createOanClient({
      fetch: createFetchMock([], {}),
      systemTheme: () => 'dark',
    });

    expect(client.backendBaseUrl).toBe('');
    expect(client.getSystemThemePreference()).toBe('dark');
    await expect(client.getThemePreference()).resolves.toBe('dark');
    await expect(client.setThemePreference('light')).resolves.toBe('light');
    expect(client.isDirectoryPickerAvailable()).toBe(false);
    await expect(client.selectDirectory()).resolves.toBeUndefined();
  });
});

function createFetchMock(
  calls: Array<{ url: string; init?: RequestInit }>,
  body: unknown,
  status = 200,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      init,
    });

    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof fetch;
}
