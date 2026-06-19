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
    expect(client.isDirectoryPickerAvailable()).toBe(true);
    await expect(client.selectDirectory()).resolves.toBe('/workspace');
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
