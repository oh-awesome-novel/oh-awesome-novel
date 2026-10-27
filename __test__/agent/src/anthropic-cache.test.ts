import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createAiSdkModelAdapter, createAiSdkProviderResolver } from '@oh-awesome-novel/agent';

const reply = () => {
  const events = [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Continue.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
};

describe('Anthropic explicit prefix caching', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends stable cached system and most recent reply, keeping changing user tails outside cache points', async () => {
    const bodies: any[] = [];
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://anthropic.test/v1/messages');
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key');
      bodies.push(JSON.parse(String(init?.body)));
      return reply();
    });
    vi.stubGlobal('fetch', fetch);
    const adapter = createAiSdkModelAdapter({ providerConfig: { id: 'anthropic', kind: 'anthropic', model: 'claude-test', apiKey: 'test-key', baseUrl: 'https://anthropic.test/v1' }, resolveModel: createAiSdkProviderResolver() });
    for (let n = 0; n < 5; n++) {
      const result = await adapter.generate({ tools: {}, messages: [
        { role: 'system', content: 'Frozen roles and constitution.' },
        { role: 'user', content: 'Earlier action.' },
        { role: 'assistant', content: 'Earlier reply.' },
        { role: 'user', content: 'Last action.' },
        { role: 'assistant', content: 'Latest committed reply.' },
        { role: 'user', content: `Dynamic state and action ${n}` },
      ] });
      expect(result.message?.content).toBe('Continue.');
    }
    expect(new Set(bodies.map(body => JSON.stringify(body.system))).size).toBe(1);
    for (const [n, body] of bodies.entries()) {
      expect(body.system).toEqual([{ type: 'text', text: 'Frozen roles and constitution.', cache_control: { type: 'ephemeral' } }]);
      expect(body.messages[1].content[0].cache_control).toBeUndefined();
      expect(body.messages[3].content).toEqual([{ type: 'text', text: 'Latest committed reply.', cache_control: { type: 'ephemeral' } }]);
      expect(body.messages.at(-1).content).toEqual([{ type: 'text', text: `Dynamic state and action ${n}` }]);
    }
  });
});
