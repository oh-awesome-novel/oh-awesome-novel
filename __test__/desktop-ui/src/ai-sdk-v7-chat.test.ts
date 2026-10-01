// @vitest-environment happy-dom

import { createOanClient } from '@oh-awesome-novel/client';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, effectScope, h, nextTick, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';

const api = vi.hoisted(() => ({ createAgentChatTransport: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import { useAgentCheckpointChat } from '../../../apps/desktop-ui/src/composables/useAgentCheckpointChat';
import { useAgentConversationSessions } from '../../../apps/desktop-ui/src/composables/useAgentConversationSessions';
import ChatTranscript from '../../../apps/desktop-ui/src/components/agent-checkpoint/ChatTranscript.vue';
import ToolActivityList from '../../../apps/desktop-ui/src/components/agent-checkpoint/ToolActivityList.vue';

interface StreamRequest {
  url: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  bytes(value: Uint8Array): void;
  event(value: Record<string, unknown>): void;
  start(id: string): void;
  text(delta: string): void;
  finish(): void;
  fail(error: Error): void;
}
const requests: StreamRequest[] = [];
const scopes: EffectScope[] = [];
const wrappers: VueWrapper[] = [];
const encoder = new TextEncoder();
const pendingAction = {
  id: 'pa_sdk7', title: 'Review chapter', description: 'Author approval required.',
  status: 'pending', createdAt: '2026-10-01T00:00:00.000Z',
  changes: [{ operation: 'create', path: 'chapters/0001/0001.md', newHash: 'a'.repeat(64) }],
  diff: '+New chapter',
};

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let ended = false;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { ended = true; } });
    const bytes = (value: Uint8Array) => { if (!ended) controller.enqueue(value); };
    const event = (value: Record<string, unknown>) => bytes(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
    const signal = init!.signal as AbortSignal;
    const abort = () => {
      if (ended) return;
      ended = true;
      controller.error(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    requests.push({
      url: String(input), body: JSON.parse(String(init!.body)), signal, bytes, event,
      start(id) {
        event({ type: 'start', messageId: id });
        event({ type: 'start-step' });
        event({ type: 'text-start', id: 'text' });
      },
      text(delta) { event({ type: 'text-delta', id: 'text', delta }); },
      finish() {
        event({ type: 'text-end', id: 'text' });
        event({ type: 'finish-step' });
        event({ type: 'finish', finishReason: 'stop' });
        bytes(encoder.encode('data: [DONE]\n\n'));
        ended = true;
        signal.removeEventListener('abort', abort);
        controller.close();
      },
      fail(error) { ended = true; signal.removeEventListener('abort', abort); controller.error(error); },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } });
  }));
  // Use the actual installed SDK through the production client facade. Only the
  // HTTP response body is controlled; neither useChat nor transport is mocked.
  const client = createOanClient({ backendBaseUrl: 'http://sdk7.test' });
  api.createAgentChatTransport.mockImplementation(() => client.createAgentChatTransport());
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  for (const scope of scopes.splice(0)) scope.stop();
  vi.unstubAllGlobals();
});

function conversation() {
  const scope = effectScope(); scopes.push(scope);
  return { scope, state: scope.run(() => useAgentConversationSessions({ getExactWritablePaths: () => ['chapters/0001/0001.md'] }))! };
}
async function request(index: number) {
  await vi.waitFor(() => expect(requests.length).toBeGreaterThan(index));
  return requests[index]!;
}
function assistantText(messages: UIMessage[]) {
  return messages.filter((message) => message.role === 'assistant').flatMap((message) => message.parts)
    .map((part) => part.type === 'text' ? part.text : '').join('');
}

describe('installed AI SDK 7 Vue chat', () => {
  it('renders chunked SSE text, tools and PendingAction before stream completion', async () => {
    let chat!: ReturnType<typeof useAgentCheckpointChat>;
    const wrapper = mount(defineComponent({ setup() {
      chat = useAgentCheckpointChat();
      return () => h('section', [
        h('p', { 'data-status': '' }, chat.status.value),
        h('p', { 'data-pending': '' }, String(chat.pendingActions.value.length)),
        h(ChatTranscript, { messages: chat.messages.value }),
        h(ToolActivityList, { messages: chat.messages.value }),
      ]);
    } }));
    wrappers.push(wrapper);
    const sending = chat.sendPrompt('Write a chapter');
    const stream = await request(0);
    expect(stream.url).toBe('http://sdk7.test/api/agent/chat');
    expect(stream.body.messages).toEqual([expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'Write a chapter' }] })]);
    stream.start('answer-checkpoint');
    const frame = encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', id: 'text', delta: '你好，世界。' })}\n\n`);
    // Split both JSON and UTF-8 characters across transport chunks.
    for (let index = 0; index < frame.length; index += 7) stream.bytes(frame.subarray(index, index + 7));
    stream.event({ type: 'tool-input-available', toolCallId: 'read-1', toolName: 'readFile', input: { path: 'chapters/0001/0001.md' } });
    stream.event({ type: 'tool-output-available', toolCallId: 'read-1', output: { content: '# Chapter' } });
    stream.event({ type: 'data-pending-action', data: pendingAction });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('你好，世界。');
      expect(wrapper.text()).toContain('readFile');
      expect(wrapper.get('[data-status]').text()).toBe('streaming');
      expect(wrapper.get('[data-pending]').text()).toBe('1');
    });
    expect(chat.pendingActions.value).toEqual([pendingAction]);
    stream.finish();
    await sending;
    await nextTick();
    expect(wrapper.get('[data-status]').text()).toBe('ready');
    expect(assistantText(chat.messages.value)).toBe('你好，世界。');
  });

  it('aborts the checkpoint transport when its view unmounts', async () => {
    let chat!: ReturnType<typeof useAgentCheckpointChat>;
    const wrapper = mount(defineComponent({ setup() {
      chat = useAgentCheckpointChat();
      return () => h('p', chat.status.value);
    } }));
    const sending = chat.sendPrompt('Pending checkpoint');
    const stream = await request(0);
    wrapper.unmount();
    await sending;
    expect(stream.signal.aborted).toBe(true);
  });

  it('stops an active request and sends a later request using the preserved conversation', async () => {
    const { state } = conversation();
    state.activeInput.value = 'First prompt';
    const sending = state.sendCurrentInput();
    const first = await request(0); first.start('answer-1'); first.text('Partial');
    await vi.waitFor(() => expect(state.activeStatus.value).toBe('streaming'));
    state.stop();
    await sending;
    expect(first.signal.aborted).toBe(true);
    expect(state.activeStatus.value).toBe('ready');
    expect(assistantText(state.activeMessages.value)).toBe('Partial');
    state.activeInput.value = 'Continue';
    const continued = state.sendCurrentInput();
    const second = await request(1);
    expect((second.body.messages as UIMessage[]).map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(second.body.editContext).toEqual({ exactWritablePaths: ['chapters/0001/0001.md'] });
    second.start('answer-2'); second.text(' continued'); second.finish();
    await continued;
    expect(assistantText(state.activeMessages.value)).toBe('Partial continued');
  });

  it('keeps independent message state when switching while another conversation streams', async () => {
    const { state } = conversation();
    const firstId = state.activeConversationId.value;
    state.activeInput.value = 'First';
    const firstSending = state.sendCurrentInput();
    const first = await request(0); first.start('first-answer'); first.text('First part');
    await vi.waitFor(() => expect(assistantText(state.activeMessages.value)).toBe('First part'));
    const secondId = state.createConversation();
    state.activeInput.value = 'Second';
    const secondSending = state.sendCurrentInput();
    const second = await request(1); second.start('second-answer'); second.text('Second answer'); second.finish();
    await secondSending;
    state.selectedWritingReferenceAttachmentIds.value = ['second-conversation-attachment'];
    first.text(' and more'); first.finish(); await firstSending;
    expect(state.activeConversationId.value).toBe(secondId);
    expect(state.selectedWritingReferenceAttachmentIds.value).toEqual(['second-conversation-attachment']);
    expect(assistantText(state.activeMessages.value)).toBe('Second answer');
    state.selectConversation(firstId);
    expect(assistantText(state.activeMessages.value)).toBe('First part and more');
    expect(state.conversationSummaries.value.map((item) => item.messageCount)).toEqual([2, 2]);
    expect(first.body.id).not.toBe(second.body.id);
  });

  it('stops every independently created chat when the owning scope is disposed', async () => {
    const { scope, state } = conversation();
    state.activeInput.value = 'First'; const firstSending = state.sendCurrentInput();
    const first = await request(0); first.start('first-answer'); first.text('First');
    state.createConversation();
    state.activeInput.value = 'Second'; const secondSending = state.sendCurrentInput();
    const second = await request(1); second.start('second-answer'); second.text('Second');
    scope.stop();
    await Promise.all([firstSending, secondSending]);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });

  it('preserves input and attachment selection when the SDK reports a transport error', async () => {
    const { state } = conversation();
    state.activeInput.value = 'Retry this';
    state.selectedWritingReferenceAttachmentIds.value = ['attachment-1'];
    const sending = state.sendCurrentInput();
    const rejected = expect(sending).rejects.toThrow('transport disconnected');
    const stream = await request(0);
    stream.fail(new Error('transport disconnected'));
    await rejected;
    expect(state.activeStatus.value).toBe('error');
    expect(state.activeInput.value).toBe('Retry this');
    expect(state.selectedWritingReferenceAttachmentIds.value).toEqual(['attachment-1']);
  });
});
