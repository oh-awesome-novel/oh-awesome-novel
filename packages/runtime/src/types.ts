import type { ToolSet } from 'ai';

export type RuntimeRole = 'system' | 'user' | 'assistant' | 'tool';

export interface RuntimeMessage {
  role: RuntimeRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface RuntimeToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface RuntimeError {
  code: string;
  message: string;
  recoverable: boolean;
  cause?: unknown;
}

export interface PendingAction {
  id: string;
  title: string;
  description: string;
  patches: unknown[];
  touchedFiles: string[];
  diff: string;
  createdAt: string;
  status: 'pending';
}

export type PendingActionSummary = PendingAction;

export type RuntimeToolResult =
  | {
      ok: true;
      content: unknown;
      pendingActions?: PendingAction[];
    }
  | {
      ok: false;
      error: RuntimeError;
      content?: unknown;
      pendingActions?: PendingAction[];
    };

export interface RuntimeModelRequest {
  messages: RuntimeMessage[];
  tools: ToolSet;
  abortSignal?: AbortSignal;
}

export interface RuntimeModelResponse {
  message?: RuntimeMessage;
  toolCalls?: RuntimeToolCall[];
}

export type RuntimeModelStreamEvent =
  | {
      type: 'text_delta';
      text: string;
    }
  | {
      type: 'finish';
      response: RuntimeModelResponse;
    };

export interface RuntimeModelAdapter {
  generate(request: RuntimeModelRequest): Promise<RuntimeModelResponse>;
  stream?(request: RuntimeModelRequest): AsyncIterable<RuntimeModelStreamEvent>;
}

export interface RuntimeToolLogEntry {
  toolCall: RuntimeToolCall;
  result: RuntimeToolResult;
}

export interface RuntimeContextItem {
  kind:
    | 'constitution'
    | 'workflow'
    | 'skill'
    | 'selected'
    | 'summary'
    | 'state'
    | 'timeline'
    | 'foreshadow';
  title?: string;
  content: string;
}

export interface RuntimeSkill {
  name: string;
  system?: string;
  allowedTools?: string[];
}

export interface RuntimeSessionState {
  doneMessages: RuntimeMessage[];
  curMessages: RuntimeMessage[];
  toolLog: RuntimeToolLogEntry[];
  pendingActions: PendingAction[];
}

export interface RuntimeContextBuilderInput {
  doneMessages: RuntimeMessage[];
  curMessages: RuntimeMessage[];
  context?: RuntimeContextItem[];
  skill?: RuntimeSkill;
}

export interface RuntimeContextBuilder {
  build(input: RuntimeContextBuilderInput): RuntimeMessage[];
}

export type RuntimeStopReason =
  | 'completed'
  | 'max_tool_loops'
  | 'aborted'
  | 'error';

export type RuntimeEvent =
  | { type: 'message_start'; messages: RuntimeMessage[] }
  | { type: 'message_delta'; text: string }
  | { type: 'tool_call_start'; toolCall: RuntimeToolCall }
  | {
      type: 'tool_call_finish';
      toolCall: RuntimeToolCall;
      result: RuntimeToolResult;
    }
  | { type: 'pending_action'; pendingAction: PendingAction }
  | { type: 'message_finish'; result: RunTurnResult }
  | { type: 'error'; error: RuntimeError };

export interface CopilotRuntimeOptions {
  model: RuntimeModelAdapter;
  tools?: ToolSet;
  contextBuilder?: RuntimeContextBuilder;
  maxToolLoops?: number;
  onEvent?: (event: RuntimeEvent) => void | Promise<void>;
}

export interface RunTurnInput {
  message?: string;
  messages?: RuntimeMessage[];
  context?: RuntimeContextItem[];
  skill?: RuntimeSkill;
  abortSignal?: AbortSignal;
}

export interface RunTurnResult {
  messages: RuntimeMessage[];
  assistantMessage?: RuntimeMessage;
  toolLog: RuntimeToolLogEntry[];
  pendingActions: PendingAction[];
  stoppedReason: RuntimeStopReason;
}
