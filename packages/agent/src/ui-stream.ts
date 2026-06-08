import { createUIMessageStream } from 'ai';
import type { UIMessage, UIMessageChunk } from 'ai';

import type { RuntimeEvent } from '@oh-awesome-novel/runtime';

export interface RuntimeEventUiStreamOptions {
  messageId?: string;
}

export function runtimeEventsToUiMessageStream(
  events: AsyncIterable<RuntimeEvent>,
  options: RuntimeEventUiStreamOptions = {},
): ReadableStream<UIMessageChunk> {
  return createUIMessageStream<UIMessage>({
    generateId: () => options.messageId ?? `oan-${Date.now().toString(36)}`,
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
          writer.write({
            type: 'tool-input-available',
            toolCallId: event.toolCall.id,
            toolName: event.toolCall.name,
            input: event.toolCall.args,
          });
          writer.write({
            type: 'data-runtime-event',
            data: event,
          });
          continue;
        }

        if (event.type === 'tool_call_finish') {
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
              toolCall: event.toolCall,
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
            data: event.result,
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
