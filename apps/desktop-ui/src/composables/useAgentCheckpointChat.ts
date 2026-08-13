import { Chat } from '@ai-sdk/vue';
import { parsePendingActionView } from '@oh-awesome-novel/client';
import type { PendingActionViewV1 } from '@oh-awesome-novel/client';
import type { UIMessage } from 'ai';
import { computed, shallowRef } from 'vue';

import { oanClient } from '../client';

export type PendingActionView = PendingActionViewV1;

export function useAgentCheckpointChat() {
  const input = shallowRef('');
  const chat = shallowRef(
    new Chat<UIMessage>({
      transport: oanClient.createAgentChatTransport(),
    }),
  );

  const messages = computed(() => chat.value.messages);
  const pendingActions = computed(() => collectPendingActions(messages.value));

  async function sendPrompt(prompt: string) {
    input.value = '';
    await chat.value.sendMessage({ text: prompt });
  }

  async function sendCurrentInput() {
    const text = input.value.trim();

    if (!text) {
      return;
    }

    await sendPrompt(text);
  }

  function stop() {
    chat.value.stop();
  }

  return {
    chat,
    input,
    messages,
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
