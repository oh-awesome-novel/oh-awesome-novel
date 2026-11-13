import { describe, expect, it } from 'vite-plus/test';

import { createOanClient } from '@oh-awesome-novel/client';

const encoder = new TextEncoder();
const frame = (event: Record<string, unknown>) => `data: ${JSON.stringify({ sessionId: 'play-1', turnId: 'run-1', ...event })}\n\n`;
const failed = { type: 'play.turn.failed', eventId: 'run-1:9', sequence: 9, error: { code: 'invalid_settlement', message: 'no', retryable: true } };

function clientFor(frames: string[], requests: Array<{ url: string; body: unknown }> = []) {
  return createOanClient({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          for (const item of frames) controller.enqueue(encoder.encode(item));
          controller.close();
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream', 'x-oan-play-turn-id': 'run-1' } });
    }) as typeof fetch,
    systemTheme: () => 'dark',
  });
}
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('Play stage streaming client', () => {
  it('sends the presentation with a turn and with a Retry, and nothing when it is not given', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = clientFor([frame(failed)], requests);
    await collect(client.streamPlayWorldRefereeTurn('play-1', { userText: '等待', baseRevision: 0 }));
    await collect(client.streamPlayWorldRefereeTurn('play-1', { userText: '等待', baseRevision: 0, presentation: 'stage' }));
    // Only the request matters here; this stub does not play a full Retry stream.
    await collect(client.retryPlayWorldRefereeTurn('play-1', 'turn-artifact-1', { baseRevision: 1, presentation: 'stage' })).catch(() => undefined);
    expect(requests.map(request => request.body)).toEqual([
      { userText: '等待', baseRevision: 0 },
      { userText: '等待', baseRevision: 0, presentation: 'stage' },
      { baseRevision: 1, presentation: 'stage' },
    ]);
    expect(requests[2]!.url).toContain('/turns/turn-artifact-1/retry/stream');
  });

  it('accepts tagged draft lines on a narrative delta and rejects malformed ones', async () => {
    const delta = { type: 'play.narrative.delta', eventId: 'run-1:2', sequence: 2, delta: '“走。”\n', provisional: true };
    const markup = [{ line: 0, speakerId: 'nian', speaker: '念念', portraitId: 'angry' }, { line: 1, speakerId: 'lin', speaker: '林师兄' }];
    const events = await collect(clientFor([frame({ ...delta, markup }), frame(failed)]).streamPlayWorldRefereeTurn('play-1', { userText: '等待' }));
    expect(events[0]).toMatchObject({ type: 'play.narrative.delta', markup });

    for (const bad of [
      [{ line: -1, speakerId: 'nian', speaker: '念念' }],
      [{ line: 0, speakerId: '', speaker: '念念' }],
      [{ line: 0, speakerId: 'nian', speaker: '念念', portraitId: '../x' }],
      [{ line: 0, speakerId: 'nian', speaker: '念念', text: '@nian' }],
      'nian',
    ]) {
      await expect(collect(clientFor([frame({ ...delta, markup: bad })]).streamPlayWorldRefereeTurn('play-1', { userText: '等待' })))
        .rejects.toThrow('invalid play.narrative.delta event');
    }
  });

  it('passes the stage markup choice when a session is started from a launch package', async () => {
    const client = clientFor([]);
    await expect(client.startPlaySessionFromLaunchPackage({ launchPackageId: 'setup-1', stageMarkup: 'yes' as never })).rejects.toThrow('invalid');
  });
});
