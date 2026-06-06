import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import type {
  RuntimeModelAdapter,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeModelStreamEvent,
} from '@oh-awesome-novel/runtime';

export interface FakeModel extends RuntimeModelAdapter {
  requests: RuntimeModelRequest[];
}

export const createFakeModel = (
  responses: RuntimeModelResponse[],
): FakeModel => {
  const queue = [...responses];
  const requests: RuntimeModelRequest[] = [];

  return {
    requests,
    async generate(request) {
      requests.push(request);

      const response = queue.shift();
      if (!response) {
        throw new Error('Fake model has no queued response.');
      }

      return response;
    },
  };
};

export const createStreamingFakeModel = (
  events: RuntimeModelStreamEvent[],
): FakeModel => {
  const requests: RuntimeModelRequest[] = [];

  return {
    requests,
    async generate(request) {
      requests.push(request);
      let response: RuntimeModelResponse | undefined;

      for await (const event of this.stream?.(request) ?? []) {
        if (event.type === 'finish') {
          response = event.response;
        }
      }

      return response ?? {};
    },
    async *stream(request) {
      requests.push(request);

      for (const event of events) {
        yield event;
      }
    },
  };
};

export const createTool = (
  id: string,
  execute: (args: unknown, context: unknown) => Promise<unknown> | unknown,
): ToolSet => ({
  [id]: tool({
    description: `${id} test tool`,
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: true,
    }),
    async execute(args, context) {
      return execute(args, context);
    },
  }),
});
