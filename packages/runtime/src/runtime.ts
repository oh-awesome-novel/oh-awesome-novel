import { PriorityRuntimeContextBuilder } from './context-builder';

import type {
  CopilotRuntimeOptions,
  PendingAction,
  RunTurnInput,
  RunTurnResult,
  RuntimeError,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeModelResponse,
  RuntimeSessionState,
  RuntimeTool,
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

      const response = await this.options.model.generate({
        messages: this.contextBuilder.build({
          doneMessages: this.state.doneMessages,
          curMessages: this.state.curMessages,
          context: input.context,
          skill: input.skill,
        }),
        tools: this.listActiveTools(input),
        abortSignal: input.abortSignal,
      });

      if (response.message) {
        assistantMessage = response.message;
        this.state.curMessages.push(response.message);
      }

      if (!response.toolCalls?.length) {
        return this.finish('completed', assistantMessage);
      }

      await this.executeToolCalls(response);
    }

    return this.finish('max_tool_loops', assistantMessage);
  }

  async *streamTurn(input: RunTurnInput): AsyncIterable<RuntimeEvent> {
    this.streamEvents = [];

    try {
      await this.runTurn(input);

      for (const event of this.streamEvents) {
        yield event;
      }
    } finally {
      this.streamEvents = undefined;
    }
  }

  private async executeToolCalls(
    response: RuntimeModelResponse,
  ): Promise<void> {
    for (const toolCall of response.toolCalls ?? []) {
      await this.emit({ type: 'tool_call_start', toolCall });

      const tool = this.options.tools.get(toolCall.name);
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
    tool: RuntimeTool,
    toolCall: RuntimeToolCall,
  ): Promise<RuntimeToolResult> {
    try {
      return await tool.execute(toolCall.args, { toolCall });
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

  private listActiveTools(input: RunTurnInput): RuntimeTool[] {
    return this.options.tools.listForSkill?.(input.skill) ?? this.options.tools.list();
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

    if (event.type === 'error') {
      await this.options.onEvent?.(event);
      return;
    }

    await this.options.onEvent?.(event);
  }
}

export class CopilotRuntime extends RuntimeSession {}

export const createRuntime = (
  options: CopilotRuntimeOptions,
): RuntimeSession => new RuntimeSession(options);

export const createCopilotRuntime = (
  options: CopilotRuntimeOptions,
): CopilotRuntime => new CopilotRuntime(options);
