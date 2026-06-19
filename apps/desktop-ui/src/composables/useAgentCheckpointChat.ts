import { Chat } from '@ai-sdk/vue';
import type { UIMessage } from 'ai';
import { computed, shallowRef } from 'vue';

import { oanClient } from '../client';

export interface PendingActionView {
  id: string;
  title: string;
  description: string;
  touchedFiles?: string[];
  diff: string;
  status: string;
}

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

function collectPendingActions(messages: UIMessage[]): PendingActionView[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== 'data-pending-action' || !isPendingAction(part.data)) {
        return [];
      }

      return [part.data];
    }),
  );
}

function isPendingAction(value: unknown): value is PendingActionView {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PendingActionView).id === 'string' &&
    typeof (value as PendingActionView).title === 'string' &&
    typeof (value as PendingActionView).description === 'string' &&
    typeof (value as PendingActionView).diff === 'string' &&
    typeof (value as PendingActionView).status === 'string'
  );
}
