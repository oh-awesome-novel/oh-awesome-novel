import type {
  RuntimeModelAdapter,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeTool,
  RuntimeToolExecuteContext,
  RuntimeToolResult,
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

export const createTool = (
  id: string,
  execute: (
    args: unknown,
    context: RuntimeToolExecuteContext,
  ) => Promise<RuntimeToolResult> | RuntimeToolResult,
): RuntimeTool => ({
  id,
  description: `${id} test tool`,
  readOnly: true,
  risk: 'low',
  async execute(args, context) {
    return execute(args, context);
  },
});
