import { describe, expect, it } from 'vitest';

import { createRuntime } from '@oh-awesome-novel/runtime';
import type { RuntimeEvent, RuntimeModelRequest } from '@oh-awesome-novel/runtime';

import { createFakeModel, createTool } from './helpers';

describe('RuntimeSession reasoning', () => {
  it('streams reasoning deltas as runtime events', async () => {
    const requests: RuntimeModelRequest[] = [];
    const runtime = createRuntime({
      tools: {},
      model: {
        async generate() {
          throw new Error('stream expected');
        },
        async *stream(request) {
          requests.push(request);
          yield { type: 'reasoning_delta', text: 'think ' };
          yield { type: 'reasoning_delta', text: 'more' };
          yield { type: 'text_delta', text: 'Done.' };
          yield {
            type: 'finish',
            response: { message: { role: 'assistant', content: 'Done.', reasoning: 'think more' } },
          };
        },
      },
    });

    const events: RuntimeEvent[] = [];
    for await (const event of runtime.streamTurn({ message: 'Hello' })) events.push(event);

    expect(events.filter((event) => event.type === 'reasoning_delta')).toEqual([
      { type: 'reasoning_delta', text: 'think ' },
      { type: 'reasoning_delta', text: 'more' },
    ]);
    const finish = events.find((event) => event.type === 'message_finish');
    expect(finish?.type === 'message_finish' && finish.result.assistantMessage?.reasoning)
      .toBe('think more');
  });

  it('replays reasoning between tool steps of one turn but never into the next turn', async () => {
    const model = createFakeModel([
      {
        message: { role: 'assistant', content: '', reasoning: 'need the character' },
        toolCalls: [{ id: 'call_1', name: 'character.get', args: { id: 'heroine' } }],
      },
      { message: { role: 'assistant', content: 'Found her.', reasoning: 'answer now' } },
      { message: { role: 'assistant', content: 'Second turn.' } },
    ]);
    const runtime = createRuntime({
      model,
      tools: createTool('character.get', () => ({ ok: true as const, content: { name: 'heroine' } })),
    });

    const first = await runtime.runTurn({ message: 'Who is the heroine?' });
    // The session log keeps this turn's thinking for debugging.
    expect(first.messages.filter((message) => message.reasoning).map((message) => message.reasoning))
      .toEqual(['need the character', 'answer now']);

    const toolStepRequest = model.requests[1]!;
    expect(toolStepRequest.messages.find((message) => message.toolCalls?.length)?.reasoning)
      .toBe('need the character');

    await runtime.runTurn({ message: 'And next?', messages: first.messages });
    const nextTurnRequest = model.requests[2]!;
    expect(nextTurnRequest.messages.some((message) => message.reasoning !== undefined)).toBe(false);
  });
});
