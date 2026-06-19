import { computed, type ComputedRef } from 'vue';
import type { UIMessage } from 'ai';

export type AgentTimelineItem =
  | {
      id: string;
      type: 'user-message' | 'agent-message';
      role: UIMessage['role'];
      text: string;
    }
  | {
      id: string;
      type: 'tool-activity';
      label: string;
      detail: string;
    }
  | {
      id: string;
      type: 'status';
      text: string;
    };

export function useAgentTimeline(messages: ComputedRef<UIMessage[]>) {
  const items = computed<AgentTimelineItem[]>(() =>
    messages.value.flatMap((message) => {
      const text = message.parts
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim();
      const entries: AgentTimelineItem[] = [];

      if (text) {
        entries.push({
          id: `${message.id}:text`,
          type: message.role === 'user' ? 'user-message' : 'agent-message',
          role: message.role,
          text,
        });
      }

      for (const [index, part] of message.parts.entries()) {
        if (!part.type.startsWith('tool-') && part.type !== 'data-tool-log') {
          continue;
        }

        entries.push({
          id: `${message.id}:tool:${index}`,
          type: 'tool-activity',
          label: toolLabel(part),
          detail: part.type,
        });
      }

      if (entries.length === 0) {
        entries.push({
          id: `${message.id}:status`,
          type: 'status',
          text: 'Waiting for content...',
        });
      }

      return entries;
    }),
  );

  return { items };
}

function toolLabel(part: UIMessage['parts'][number]): string {
  if ('toolName' in part && typeof part.toolName === 'string') {
    return part.toolName;
  }

  if (
    part.type === 'data-tool-log' &&
    typeof part.data === 'object' &&
    part.data !== null &&
    'toolCall' in part.data
  ) {
    const toolCall = part.data.toolCall as { name?: unknown };
    return typeof toolCall.name === 'string' ? toolCall.name : 'tool';
  }

  return part.type;
}
