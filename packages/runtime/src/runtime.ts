import { PriorityRuntimeContextBuilder } from './context-builder';
import type { ModelMessage, ToolExecutionOptions, ToolResultPart, ToolSet } from 'ai';
import { createHash } from 'node:crypto';

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

    try {
      for (let loop = 0; loop < maxToolLoops; loop += 1) {
        if (input.abortSignal?.aborted) {
          return await this.finish('aborted', assistantMessage, input.abortSignal);
        }

        const tools = this.listActiveTools(input);
        const messages = this.contextBuilder.build({
          doneMessages: this.state.doneMessages,
          curMessages: this.state.curMessages,
          context: input.context,
          skill: input.skill,
        });
        const response = await this.generateModelResponse({
          messages,
          tools,
          abortSignal: input.abortSignal,
        });
        const auditedMessage = response.message
          ? auditRuntimeMessage(response.message)
          : undefined;

        if (response.toolCalls?.length) {
          if (auditedMessage) {
            assistantMessage = auditedMessage;
          }

          this.state.curMessages.push({
            role: 'assistant',
            content: auditedMessage?.content ?? '',
            toolCalls: response.toolCalls.map(auditRuntimeToolCall),
          });
          await this.executeToolCalls(response, tools, messages, input.abortSignal);
          if (input.abortSignal?.aborted) {
            return await this.finish('aborted', assistantMessage, input.abortSignal);
          }
          continue;
        }

        if (auditedMessage) {
          assistantMessage = auditedMessage;
          this.state.curMessages.push(auditedMessage);
        }

        return await this.finish('completed', assistantMessage, input.abortSignal);
      }

      return await this.finish('max_tool_loops', assistantMessage, input.abortSignal);
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        return await this.finish('aborted', assistantMessage, input.abortSignal);
      }
      await this.failTurn(error, input.abortSignal);
      throw error;
    }
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
    messages: RuntimeMessage[],
    abortSignal?: AbortSignal,
  ): Promise<void> {
    for (const toolCall of response.toolCalls ?? []) {
      const auditedToolCall = auditRuntimeToolCall(toolCall);
      await this.emit({ type: 'tool_call_start', toolCall: auditedToolCall });

      const tool = tools[toolCall.name];
      const result: RuntimeToolResult = abortSignal?.aborted
        ? {
            ok: false,
            error: {
              code: 'TOOL_EXECUTION_ABORTED',
              message: `Tool ${toolCall.name} was skipped because the turn was aborted.`,
              recoverable: true,
            },
          }
        : tool ? await this.executeTool(tool, toolCall, {
            toolCallId: toolCall.id,
            messages: toToolExecutionMessages(messages),
            context: undefined,
            ...(abortSignal ? { abortSignal } : {}),
          })
          : this.unknownToolResult(toolCall);

      const logEntry: RuntimeToolLogEntry = { toolCall: auditedToolCall, result };
      this.state.toolLog.push(logEntry);

      await this.emit({
        type: 'tool_call_finish',
        toolCall: auditedToolCall,
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
    options: ToolExecutionOptions<undefined>,
  ): Promise<RuntimeToolResult> {
    try {
      if (!tool.execute) {
        return {
          ok: false,
          error: {
            code: 'TOOL_NOT_EXECUTABLE',
            message: `Tool ${toolCall.name} does not define execute().`,
            recoverable: true,
          },
        };
      }

      const content = await tool.execute(toolCall.args as never, options);
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
    abortSignal?: AbortSignal,
  ): Promise<RunTurnResult> {
    const finalizedActions = await this.options.turnFinalizer?.finalizeTurn({
      stoppedReason,
      pendingActions: [...this.state.pendingActions],
      ...(abortSignal ? { abortSignal } : {}),
    });
    if (finalizedActions) {
      const knownIds = new Set(this.state.pendingActions.map((action) => action.id));
      for (const pendingAction of finalizedActions) {
        if (knownIds.has(pendingAction.id)) continue;
        knownIds.add(pendingAction.id);
        this.state.pendingActions.push(pendingAction);
        await this.emit({ type: 'pending_action', pendingAction });
      }
    }

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

  private async failTurn(error: unknown, abortSignal?: AbortSignal): Promise<void> {
    try {
      await this.options.turnFinalizer?.finalizeTurn({
        stoppedReason: 'error',
        pendingActions: [...this.state.pendingActions],
        ...(abortSignal ? { abortSignal } : {}),
      });
    } catch {
      // The original fatal error remains authoritative. A finalizer must fail closed.
    }
    await this.emit({
      type: 'error',
      error: this.toRuntimeError('RUNTIME_TURN_FAILED', error),
    });
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

/** SDK tool options describe the initiating prompt, without system instructions. */
function toToolExecutionMessages(messages: RuntimeMessage[]): ModelMessage[] {
  return structuredClone(messages.filter((message) => message.role !== 'system').map((message): ModelMessage => {
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: [
          ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
          ...message.toolCalls.map((call) => ({
            type: 'tool-call' as const,
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
          })),
        ],
      };
    }
    if (message.role === 'tool') {
      let output: ToolResultPart['output'];
      try { output = { type: 'json', value: JSON.parse(message.content) }; }
      catch { output = { type: 'text', value: message.content }; }
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: message.toolCallId ?? message.name ?? 'tool-call',
          toolName: message.name ?? 'tool',
          output,
        }],
      };
    }
    return { role: message.role, content: message.content };
  }));
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'AbortError');
}

function auditRuntimeToolCall(toolCall: RuntimeToolCall): RuntimeToolCall {
  if (toolCall.name !== 'bash') return toolCall;
  const command = readBashCommand(toolCall.args);
  const hashInput = command ?? '<invalid-bash-command-arguments>';
  const preview = boundedCommandPreview(
    command ?? '[invalid bash command arguments]',
    2 * 1024,
  );
  return {
    id: toolCall.id,
    name: toolCall.name,
    args: {
      commandPreview: preview.text,
      commandHash: createHash('sha256').update(hashInput, 'utf8').digest('hex'),
      commandByteLength: Buffer.byteLength(command ?? '', 'utf8'),
      previewByteLength: Buffer.byteLength(preview.text, 'utf8'),
      truncated: preview.truncated,
    },
  };
}

function auditRuntimeMessage(message: RuntimeMessage): RuntimeMessage {
  if (!message.toolCalls?.length) return message;
  return {
    ...message,
    toolCalls: message.toolCalls.map(auditRuntimeToolCall),
  };
}

function readBashCommand(value: unknown): string | undefined {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { command?: unknown }).command === 'string'
    ? (value as { command: string }).command
    : undefined;
}

function boundedCommandPreview(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const sanitized = value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/\\/gu, '\\\\')
    .replace(/\r/gu, '\\r')
    .replace(/\n/gu, '\\n')
    .replace(/\t/gu, '\\t')
    .replace(/[\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, (character) => (
      `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`
    ))
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) => (
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    ));
  if (Buffer.byteLength(sanitized, 'utf8') <= maxBytes) {
    return { text: sanitized, truncated: false };
  }
  let text = '';
  let bytes = 0;
  for (const character of sanitized) {
    const length = Buffer.byteLength(character, 'utf8');
    if (bytes + length > maxBytes) break;
    text += character;
    bytes += length;
  }
  return { text, truncated: true };
}

export class CopilotRuntime extends RuntimeSession {}

export const createRuntime = (
  options: CopilotRuntimeOptions,
): RuntimeSession => new RuntimeSession(options);

export const createCopilotRuntime = (
  options: CopilotRuntimeOptions,
): CopilotRuntime => new CopilotRuntime(options);
