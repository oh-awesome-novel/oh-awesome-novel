import { parseAgentUsageRecord } from '@oh-awesome-novel/core/agent-usage';
import { createUIMessageStream } from 'ai';
import type { UIMessage, UIMessageChunk } from 'ai';

import type {
  RunTurnResult,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeToolCall,
} from '@oh-awesome-novel/runtime';
import {
  createBashCommandAudit,
  normalizeBashCommandAudit,
} from './bash-command-audit';

export interface RuntimeEventUiStreamOptions {
  messageId?: string;
}

export function runtimeEventsToUiMessageStream(
  events: AsyncIterable<RuntimeEvent>,
  options: RuntimeEventUiStreamOptions = {},
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream<UIMessage>({
    generateId: () => options.messageId ?? `oan-${Date.now().toString(36)}`,
    // Runtime error events already carry an intentional public message below.
    // Unexpected iterator/transport errors must not reveal raw server details.
    onError: () => 'An error occurred.',
    async execute({ writer }) {
      let textPartId: string | undefined;

      const ensureTextPart = () => {
        if (textPartId) {
          return textPartId;
        }

        textPartId = `text-${Date.now().toString(36)}`;
        writer.write({
          type: 'text-start',
          id: textPartId,
        });
        return textPartId;
      };

      const endTextPart = () => {
        if (!textPartId) {
          return;
        }

        writer.write({
          type: 'text-end',
          id: textPartId,
        });
        textPartId = undefined;
      };

      writer.write({ type: 'start-step' });

      for await (const event of events) {
        if (event.type === 'model_request_stats' || event.type === 'usage_stats') {
          try { writer.write({ type: 'data-agent-usage', data: parseAgentUsageRecord(event.record) }); }
          catch { writer.write({ type: 'data-usage-warning', data: { code: 'invalid-metadata' } }); }
          continue;
        }
        if (event.type === 'usage_warning') {
          writer.write({ type: 'data-usage-warning', data: { code: event.code } });
          continue;
        }
        if (event.type === 'message_delta') {
          writer.write({
            type: 'text-delta',
            id: ensureTextPart(),
            delta: event.text,
          });
          continue;
        }

        if (event.type === 'tool_call_start') {
          endTextPart();
          const publicToolCall = sanitizeRuntimeToolCall(event.toolCall);
          writer.write({
            type: 'tool-input-available',
            toolCallId: event.toolCall.id,
            toolName: event.toolCall.name,
            input: publicToolCall.args,
          });
          writer.write({
            type: 'data-runtime-event',
            data: {
              ...event,
              toolCall: publicToolCall,
            },
          });
          continue;
        }

        if (event.type === 'tool_call_finish') {
          const publicToolCall = sanitizeRuntimeToolCall(event.toolCall);
          writer.write(
            event.result.ok
              ? {
                  type: 'tool-output-available',
                  toolCallId: event.toolCall.id,
                  output: event.result.content,
                }
              : {
                  type: 'tool-output-error',
                  toolCallId: event.toolCall.id,
                  errorText: event.result.error.message,
                },
          );
          writer.write({
            type: 'data-tool-log',
            data: {
              toolCall: publicToolCall,
              result: event.result,
            },
          });
          continue;
        }

        if (event.type === 'pending_action') {
          writer.write({
            type: 'data-pending-action',
            data: event.pendingAction,
          });
          continue;
        }

        if (event.type === 'message_finish') {
          endTextPart();
          writer.write({
            type: 'data-runtime-result',
            data: sanitizeRuntimeResult(event.result),
          });
          writer.write({ type: 'finish-step' });
          continue;
        }

        if (event.type === 'error') {
          endTextPart();
          writer.write({
            type: 'error',
            errorText: event.error.message,
          });
        }
      }

      endTextPart();
    },
  });
}

export function sanitizeRuntimeToolCall(
  toolCall: RuntimeToolCall,
): RuntimeToolCall {
  if (toolCall.name !== 'bash') return toolCall;
  const audit = normalizeBashCommandAudit(toolCall.args)
    ?? createBashCommandAudit(toolCall.args);
  return {
    id: toolCall.id,
    name: toolCall.name,
    args: {
      commandPreview: audit.commandPreview,
      commandHash: audit.commandHash,
      commandByteLength: audit.commandByteLength,
      previewByteLength: audit.previewByteLength,
      truncated: audit.truncated,
    },
  };
}

export function sanitizeRuntimeResult(result: RunTurnResult): RunTurnResult {
  return {
    ...result,
    messages: result.messages.map(sanitizeRuntimeMessage),
    ...(result.assistantMessage
      ? { assistantMessage: sanitizeRuntimeMessage(result.assistantMessage) }
      : {}),
    toolLog: result.toolLog.map((entry) => ({
      ...entry,
      toolCall: sanitizeRuntimeToolCall(entry.toolCall),
    })),
  };
}

function sanitizeRuntimeMessage(message: RuntimeMessage): RuntimeMessage {
  if (!message.toolCalls?.length) return message;
  return {
    ...message,
    toolCalls: message.toolCalls.map(sanitizeRuntimeToolCall),
  };
}
