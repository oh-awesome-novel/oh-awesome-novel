import type { AgentUsageRecord, ModelRequestStats, NormalizedModelUsage, TurnUsageSummary, UsageRequestMetadata, UsageSourceEvidence } from '@oh-awesome-novel/core/agent-usage';
import type { ToolSet } from 'ai';

export type RuntimeRole = 'system' | 'user' | 'assistant' | 'tool';

export interface RuntimeMessage {
  role: RuntimeRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: RuntimeToolCall[];
  /** Host-only metadata, stripped before the provider request. */
  provenance?: UsageSourceEvidence[];
}

export interface RuntimeToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface RuntimeToolCallAudit {
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
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  changes: Array<{
    operation: 'create' | 'update' | 'delete';
    path: string;
    oldHash?: string;
    newHash?: string;
  }>;
  diff: string;
  origin?: unknown;
  git?: unknown;
}

export type PendingActionSummary = PendingAction;

/**
 * Additive sandbox-engine public view used by injected turns before the atomic
 * production cut removes the legacy PendingAction contract.
 */
export type SandboxPendingActionView = PendingAction;

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
  usage?: NormalizedModelUsage;
  finishReason?: string;
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
  toolCall: RuntimeToolCallAudit;
  result: RuntimeToolResult;
}

export interface RuntimeContextItem {
  provenance?: UsageSourceEvidence[];
  kind:
    | 'constitution'
    | 'workflow'
    | 'skill'
    | 'reminder'
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

export interface RuntimeTurnFinalizer {
  finalizeTurn(input: {
    stoppedReason: RuntimeStopReason;
    pendingActions: PendingAction[];
    abortSignal?: AbortSignal;
  }): Promise<PendingAction[]>;
}

export type RuntimeEvent =
  | { type: 'model_request_stats'; record: Extract<AgentUsageRecord, { recordType: 'request' }> }
  | { type: 'usage_stats'; record: Exclude<AgentUsageRecord, { recordType: 'request' }> }
  | { type: 'usage_warning'; code: 'persistence-unavailable' }
  | { type: 'message_start'; messages: RuntimeMessage[] }
  | { type: 'message_delta'; text: string }
  | { type: 'tool_call_start'; toolCall: RuntimeToolCallAudit }
  | {
      type: 'tool_call_finish';
      toolCall: RuntimeToolCallAudit;
      result: RuntimeToolResult;
    }
  | { type: 'pending_action'; pendingAction: PendingAction }
  | { type: 'message_finish'; result: RunTurnResult }
  | { type: 'error'; error: RuntimeError };

export interface CopilotRuntimeOptions {
  usageSessionId?: string;
  prepareModelRequest?: (request: RuntimeModelRequest) => { request: RuntimeModelRequest; metadata: UsageRequestMetadata } | Promise<{ request: RuntimeModelRequest; metadata: UsageRequestMetadata }>;
  toolResultProvenance?: (toolCall: RuntimeToolCall, result: RuntimeToolResult) => UsageSourceEvidence[];

  model: RuntimeModelAdapter;
  tools?: ToolSet;
  contextBuilder?: RuntimeContextBuilder;
  maxToolLoops?: number;
  turnFinalizer?: RuntimeTurnFinalizer;
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
  usage?: TurnUsageSummary;
  messages: RuntimeMessage[];
  assistantMessage?: RuntimeMessage;
  toolLog: RuntimeToolLogEntry[];
  pendingActions: PendingAction[];
  stoppedReason: RuntimeStopReason;
}
