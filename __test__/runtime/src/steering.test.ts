import { describe, expect, it, vi } from 'vitest';

import { createRuntime } from '@oh-awesome-novel/runtime';
import type { RuntimeEvent, RuntimeSteeringMessage, RuntimeSteeringSource } from '@oh-awesome-novel/runtime';

import { createFakeModel, createTool } from './helpers';

function createSteering() {
  const queue: RuntimeSteeringMessage[] = [];
  let closed = false;
  const source: RuntimeSteeringSource & { push(content: string): boolean; drains: number; closed(): boolean } = {
    drains: 0,
    drain: () => { source.drains += 1; return queue.splice(0); },
    close: () => { closed = true; },
    push(content) {
      if (closed) return false;
      queue.push({ id: `steer-${queue.length + 1}`, content });
      return true;
    },
    closed: () => closed,
  };
  return source;
}

async function collect(stream: AsyncIterable<RuntimeEvent>) {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('RuntimeSession steering', () => {
  it('applies a steer that arrives during a tool before the next model request', async () => {
    const steering = createSteering();
    const model = createFakeModel([
      { toolCalls: [{ id: 'call_1', name: 'character.get', args: { id: 'heroine' } }] },
      { message: { role: 'assistant', content: 'Done.' } },
    ]);
    const runtime = createRuntime({
      model,
      tools: createTool('character.get', () => {
        steering.push('Use her nickname.');
        return { ok: true as const, content: { name: 'heroine' } };
      }),
    });

    const events = await collect(runtime.streamTurn({ message: 'Describe her', steering }));

    const secondRequest = model.requests[1]!;
    expect(secondRequest.messages.at(-1)).toEqual({ role: 'user', content: 'Use her nickname.', delivery: 'steer' });
    expect(Object.keys(secondRequest.tools)).toEqual(Object.keys(model.requests[0]!.tools));
    expect(events.filter((event) => event.type === 'steering_applied')).toEqual([
      { type: 'steering_applied', message: { id: 'steer-1', content: 'Use her nickname.' } },
    ]);
    const finish = events.find((event) => event.type === 'message_finish');
    expect(finish?.type === 'message_finish' && finish.result.messages.some((message) => message.delivery === 'steer')).toBe(true);
  });

  it('continues after a tool-free answer when a steer arrived while it streamed', async () => {
    const steering = createSteering();
    let calls = 0;
    const runtime = createRuntime({
      tools: {},
      model: {
        async generate() {
          calls += 1;
          if (calls === 1) {
            steering.push('Shorter, please.');
            return { message: { role: 'assistant', content: 'A long answer.' } };
          }
          return { message: { role: 'assistant', content: 'Short.' } };
        },
      },
    });

    const result = await runtime.runTurn({ message: 'Answer', steering });

    expect(calls).toBe(2);
    expect(result.stoppedReason).toBe('completed');
    expect(result.assistantMessage?.content).toBe('Short.');
    expect(result.messages.map((message) => message.content)).toEqual([
      'Answer', 'A long answer.', 'Shorter, please.', 'Short.',
    ]);
  });

  it('closes steering before the finalizer and hands back steers that never reached the model', async () => {
    const steering = createSteering();
    const finalizeTurn = vi.fn(async () => {
      expect(steering.closed()).toBe(true);
      return [];
    });
    const runtime = createRuntime({
      maxToolLoops: 1,
      turnFinalizer: { finalizeTurn },
      model: createFakeModel([
        { toolCalls: [{ id: 'call_1', name: 'character.get', args: {} }] },
      ]),
      tools: createTool('character.get', () => ({ ok: true as const, content: {} })),
    });
    const originalDrain = steering.drain;
    steering.drain = () => {
      const drained = originalDrain();
      // Arrives after the last poll of the final loop.
      if (steering.drains === 1) steering.push('Too late');
      return drained;
    };

    const events = await collect(runtime.streamTurn({ message: 'Go', steering }));

    expect(finalizeTurn).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'steering_rejected')).toEqual([
      { type: 'steering_rejected', message: { id: 'steer-1', content: 'Too late' } },
    ]);
    expect(steering.push('after finish')).toBe(false);
  });

  it('closes steering when the turn fails', async () => {
    const steering = createSteering();
    const runtime = createRuntime({
      tools: {},
      model: { async generate() { throw new Error('provider down'); } },
    });
    await expect(runtime.runTurn({ message: 'Go', steering })).rejects.toThrow('provider down');
    expect(steering.closed()).toBe(true);
  });
});
