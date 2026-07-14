import { describe, expect, it, vi } from 'vitest';

import {
  createOanClient,
  type OanDesktopBridge,
  type PlayTurnStreamEvent,
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

  it('parses typed Play turn SSE events without treating provisional text as a session', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const onTurnId = vi.fn();
    const encoded = new TextEncoder();
    const frames = [
      'event: play.turn.started\n',
      'data: {"type":"play.turn.started","eventId":"run-1:1","sequence":1,"sessionId":"play-1","turnId":"run-1","baseRevision":0,"expectedArtifactId":"turn-artifact-1"}\n\n',
      'event: play.narrative.delta\n',
      'data: {"type":"play.narrative.delta","eventId":"run-1:2","sequence":2,"sessionId":"play-1","turnId":"run-1","delta":"雨声逼近。","provisional":true}\n\n',
      'event: play.turn.cancelled\n',
      'data: {"type":"play.turn.cancelled","eventId":"run-1:3","sequence":3,"sessionId":"play-1","turnId":"run-1","committed":false,"revision":0,"reason":"user"}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.encode(frames.slice(0, 37)));
          controller.enqueue(encoded.encode(frames.slice(37, 149)));
          controller.enqueue(encoded.encode(frames.slice(149)));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'X-OAN-Play-Turn-Id': 'run-1',
        },
      });
    }) as typeof fetch;
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: fetcher,
      systemTheme: () => 'dark',
    });
    const events: PlayTurnStreamEvent[] = [];

    for await (const event of client.streamPlayWorldRefereeTurn('play-1', {
      userText: '等待',
      actionKind: 'wait',
      baseRevision: 0,
    }, { onTurnId })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'play.turn.started',
      'play.narrative.delta',
      'play.turn.cancelled',
    ]);
    expect(events[1]).toMatchObject({ delta: '雨声逼近。', provisional: true });
    expect(onTurnId).toHaveBeenCalledOnce();
    expect(onTurnId).toHaveBeenCalledWith('run-1');
    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/turns/stream',
      init: { method: 'POST' },
    });
  });

  it('rejects malformed variant payloads in typed Play turn events', async () => {
    const encoded = new TextEncoder();
    const client = createOanClient({
      fetch: (async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.encode(
            'data: {"type":"play.turn.committed","eventId":"run-1:3","sequence":3,"sessionId":"play-1","turnId":"run-1","revision":1}\n\n',
          ));
          controller.close();
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });

    const consume = async () => {
      for await (const _event of client.streamPlayWorldRefereeTurn('play-1', {
        userText: '等待',
        baseRevision: 0,
      })) {
        // The parser must reject before yielding the malformed terminal event.
      }
    };

    await expect(consume()).rejects.toThrow('invalid play.turn.committed event');
  });

  it('routes Play stop through the explicit server cancellation endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOanClient({
      backendBaseUrl: 'http://backend.test',
      fetch: createFetchMock(calls, {
        status: 'cancelled',
        committed: false,
        turnId: 'run-1',
      }),
      systemTheme: () => 'dark',
    });

    await expect(client.cancelPlayWorldRefereeTurn('play-1', 'run-1')).resolves.toEqual({
      status: 'cancelled',
      committed: false,
      turnId: 'run-1',
    });
    expect(calls[0]).toMatchObject({
      url: 'http://backend.test/api/workspace/play-sessions/play-1/turns/run-1/cancel',
      init: { method: 'POST' },
    });
  });

  it('rejects malformed Play cancellation results at the network boundary', async () => {
    const client = createOanClient({
      fetch: createFetchMock([], {
        status: 'committed',
        committed: true,
        turnId: 'run-1',
      }),
      systemTheme: () => 'dark',
    });

    await expect(client.cancelPlayWorldRefereeTurn('play-1', 'run-1'))
      .rejects
      .toThrow('invalid result');
  });

  it('cancels the response body when a Play stream consumer exits early', async () => {
    let bodyCancelled = false;
    const encoded = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.encode(
          'data: {"type":"play.turn.started","eventId":"run-1:1","sequence":1,"sessionId":"play-1","turnId":"run-1","baseRevision":0,"expectedArtifactId":"turn-artifact-1"}\n\n',
        ));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const client = createOanClient({
      fetch: (async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch,
      systemTheme: () => 'dark',
    });

    for await (const _event of client.streamPlayWorldRefereeTurn('play-1', {
      userText: '等待',
      baseRevision: 0,
    })) {
      break;
    }

    expect(bodyCancelled).toBe(true);
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
