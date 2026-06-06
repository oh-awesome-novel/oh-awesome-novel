import { PriorityRuntimeContextBuilder } from './context-builder';
import type { ToolSet } from 'ai';

import type {
  CopilotRuntimeOptions,
  PendingAction,
  RunTurnInput,
  RunTurnResult,
  RuntimeError,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeModelAdapter,
  RuntimeModelResponse,
  RuntimeSessionState,
  RuntimeToolCall,
  RuntimeToolLogEntry,
  RuntimeToolResult,
} from './types';

const defaultMaxToolLoops = 8;

export class RuntimeSession {
  private readonly contextBuilder;
  private readonly options: CopilotRuntimeOptions;
  private streamEvents?: RuntimeEvent[];
  private readonly state: RuntimeSessionState = {
    doneMessages: [],
    curMessages: [],
    toolLog: [],
    pendingActions: [],
  };

  constructor(options: CopilotRuntimeOptions) {
    this.options = options;
    this.contextBuilder =
      options.contextBuilder ?? new PriorityRuntimeContextBuilder();
  }

  getState(): RuntimeSessionState {
    return {
      doneMessages: [...this.state.doneMessages],
      curMessages: [...this.state.curMessages],
      toolLog: [...this.state.toolLog],
      pendingActions: [...this.state.pendingActions],
    };
  }

  clear(): void {
    this.state.doneMessages = [];
    this.state.curMessages = [];
    this.state.toolLog = [];
    this.state.pendingActions = [];
  }

  async runTurn(input: RunTurnInput): Promise<RunTurnResult> {
    this.state.curMessages = [...(input.messages ?? [])];
    this.state.toolLog = [];
    this.state.pendingActions = [];

    if (input.message) {
      this.state.curMessages.push({
        role: 'user',
        content: input.message,
      });
    }

    await this.emit({
      type: 'message_start',
      messages: [...this.state.curMessages],
    });

    const maxToolLoops = this.options.maxToolLoops ?? defaultMaxToolLoops;
    let assistantMessage: RuntimeMessage | undefined;

    for (let loop = 0; loop < maxToolLoops; loop += 1) {
      if (input.abortSignal?.aborted) {
        return this.finish('aborted', assistantMessage);
      }

      const tools = this.listActiveTools(input);
      const response = await this.generateModelResponse({
        messages: this.contextBuilder.build({
          doneMessages: this.state.doneMessages,
          curMessages: this.state.curMessages,
          context: input.context,
          skill: input.skill,
        }),
        tools,
        abortSignal: input.abortSignal,
      });

      if (response.message) {
        assistantMessage = response.message;
        this.state.curMessages.push(response.message);
      }

      if (!response.toolCalls?.length) {
        return this.finish('completed', assistantMessage);
      }

      await this.executeToolCalls(response, tools);
    }

    return this.finish('max_tool_loops', assistantMessage);
  }

  async *streamTurn(input: RunTurnInput): AsyncIterable<RuntimeEvent> {
    const queue = new RuntimeEventQueue();
    this.streamEvents = [];
    this.liveStreamQueue = queue;

    const run = this.runTurn(input)
      .then(() => queue.close())
      .catch((error: unknown) => queue.fail(error));

    try {
      for await (const event of queue) {
        yield event;
      }

      await run;
    } finally {
      this.streamEvents = undefined;
      this.liveStreamQueue = undefined;
    }
  }

  private liveStreamQueue?: RuntimeEventQueue;

  private async generateModelResponse(
    request: Parameters<RuntimeModelAdapter['generate']>[0],
  ): Promise<RuntimeModelResponse> {
    if (!this.options.model.stream) {
      return this.options.model.generate(request);
    }

    let response: RuntimeModelResponse | undefined;

    for await (const event of this.options.model.stream(request)) {
      if (event.type === 'text_delta') {
        await this.emit({
          type: 'message_delta',
          text: event.text,
        });
      } else {
        response = event.response;
      }
    }

    return response ?? {};
  }

  private async executeToolCalls(
    response: RuntimeModelResponse,
    tools: ToolSet,
  ): Promise<void> {
    for (const toolCall of response.toolCalls ?? []) {
      await this.emit({ type: 'tool_call_start', toolCall });

      const tool = tools[toolCall.name];
      const result = tool
        ? await this.executeTool(tool, toolCall)
        : this.unknownToolResult(toolCall);

      const logEntry: RuntimeToolLogEntry = { toolCall, result };
      this.state.toolLog.push(logEntry);

      await this.emit({
        type: 'tool_call_finish',
        toolCall,
        result,
      });

      for (const pendingAction of result.pendingActions ?? []) {
        this.state.pendingActions.push(pendingAction);
        await this.emit({
          type: 'pending_action',
          pendingAction,
        });
      }

      this.state.curMessages.push({
        role: 'tool',
        name: toolCall.name,
        toolCallId: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  private async executeTool(
    tool: ToolSet[string],
    toolCall: RuntimeToolCall,
  ): Promise<RuntimeToolResult> {
    try {
      const executable = tool as {
        execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
      };

      if (!executable.execute) {
        return {
          ok: false,
          error: {
            code: 'TOOL_NOT_EXECUTABLE',
            message: `Tool ${toolCall.name} does not define execute().`,
            recoverable: true,
          },
        };
      }

      const content = await executable.execute(toolCall.args, { toolCall });
      const pendingActions = extractPendingActions(content);

      return {
        ok: true,
        content,
        ...(pendingActions.length ? { pendingActions } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        error: this.toRuntimeError('TOOL_EXECUTION_FAILED', error),
      };
    }
  }

  private unknownToolResult(toolCall: RuntimeToolCall): RuntimeToolResult {
    return {
      ok: false,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Tool ${toolCall.name} is not registered.`,
        recoverable: true,
      },
    };
  }

  private listActiveTools(input: Pick<RunTurnInput, 'skill'>): ToolSet {
    const tools = this.options.tools ?? {};

    if (!input.skill?.allowedTools?.length) {
      return tools;
    }

    const allowed = new Set(input.skill.allowedTools);

    return Object.fromEntries(
      Object.entries(tools).filter(([toolName]) => allowed.has(toolName)),
    );
  }

  private async finish(
    stoppedReason: RunTurnResult['stoppedReason'],
    assistantMessage: RuntimeMessage | undefined,
  ): Promise<RunTurnResult> {
    const result: RunTurnResult = {
      messages: [...this.state.doneMessages, ...this.state.curMessages],
      assistantMessage,
      toolLog: [...this.state.toolLog],
      pendingActions: [...this.state.pendingActions],
      stoppedReason,
    };

    this.state.doneMessages.push(...this.state.curMessages);
    this.state.curMessages = [];

    await this.emit({ type: 'message_finish', result });

    return result;
  }

  private toRuntimeError(code: string, error: unknown): RuntimeError {
    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      recoverable: true,
      cause: error,
    };
  }

  private async emit(event: RuntimeEvent): Promise<void> {
    this.streamEvents?.push(event);
    this.liveStreamQueue?.push(event);

    if (event.type === 'error') {
      await this.options.onEvent?.(event);
      return;
    }

    await this.options.onEvent?.(event);
  }
}

class RuntimeEventQueue implements AsyncIterable<RuntimeEvent> {
  private readonly events: RuntimeEvent[] = [];
  private readonly waiters: Array<{
    resolve(value: IteratorResult<RuntimeEvent>): void;
    reject(error: unknown): void;
  }> = [];
  private closed = false;
  private error: unknown;

  push(event: RuntimeEvent): void {
    const waiter = this.waiters.shift();

    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }

    this.events.push(event);
  }

  close(): void {
    this.closed = true;

    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    this.error = error;

    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => {
        const event = this.events.shift();

        if (event) {
          return Promise.resolve({ value: event, done: false });
        }

        if (this.error) {
          return Promise.reject(this.error);
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<RuntimeEvent>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

function extractPendingActions(content: unknown): PendingAction[] {
  if (
    typeof content === 'object' &&
    content !== null &&
    Array.isArray((content as { pendingActions?: unknown }).pendingActions)
  ) {
    return (content as { pendingActions: PendingAction[] }).pendingActions;
  }

  return [];
}

export class CopilotRuntime extends RuntimeSession {}

export const createRuntime = (
  options: CopilotRuntimeOptions,
): RuntimeSession => new RuntimeSession(options);

export const createCopilotRuntime = (
  options: CopilotRuntimeOptions,
): CopilotRuntime => new CopilotRuntime(options);
