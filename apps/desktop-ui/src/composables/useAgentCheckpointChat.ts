import { useChat } from '@ai-sdk/vue';
import { parsePendingActionView } from '@oh-awesome-novel/client';
import type { PendingActionViewV1 } from '@oh-awesome-novel/client';
import type { UIMessage } from 'ai';
import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue';

import { oanClient } from '../client';

export type PendingActionView = PendingActionViewV1;

export function useAgentCheckpointChat() {
  const input = shallowRef('');
  const chat = useChat<UIMessage>({
    transport: oanClient.createAgentChatTransport(),
  });
  const { messages, status } = chat;
  if (getCurrentScope()) onScopeDispose(() => { void chat.stop(); });
  const pendingActions = computed(() => collectPendingActions(messages.value));

  async function sendPrompt(prompt: string) {
    input.value = '';
    await chat.sendMessage({ text: prompt });
  }

  async function sendCurrentInput() {
    const text = input.value.trim();

    if (!text) {
      return;
    }

    await sendPrompt(text);
  }

  function stop() {
    void chat.stop();
  }

  return {
    chat,
    input,
    messages,
    status,
    pendingActions,
    sendPrompt,
    sendCurrentInput,
    stop,
  };
}

export function collectPendingActions(messages: UIMessage[]): PendingActionView[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== 'data-pending-action') {
        return [];
      }

      return [parsePendingActionView(part.data)];
    }),
  );
}
