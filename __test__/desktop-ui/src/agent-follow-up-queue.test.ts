// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import type { ChatStatus, UIMessage } from 'ai';
import { shallowRef, type ShallowRef } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockChatInstance {
  messages: ShallowRef<UIMessage[]>;
  status: ShallowRef<ChatStatus>;
  error: ShallowRef<Error | undefined>;
  sendMessage: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const chatHarness = vi.hoisted(() => ({ instances: [] as MockChatInstance[] }));
const api = vi.hoisted(() => ({
  createAgentChatTransport: vi.fn(() => ({})),
  listPlayWritingReferenceAttachments: vi.fn(),
  steerAgentTurn: vi.fn(),
  getComposerSubmitShortcutPreference: vi.fn(async () => 'enter'),
  setComposerSubmitShortcutPreference: vi.fn(async (value: string) => value),
}));

vi.mock('@ai-sdk/vue', () => ({
  useChat: () => {
    const chat: MockChatInstance = {
      messages: shallowRef<UIMessage[]>([]),
      status: shallowRef<ChatStatus>('ready'),
      error: shallowRef<Error>(),
      sendMessage: vi.fn(),
      stop: vi.fn(),
    };
    chatHarness.instances.push(chat);
    return chat;
  },
}));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import ChatComposer from '../../../apps/desktop-ui/src/components/agent-checkpoint/ChatComposer.vue';
import FollowUpQueue from '../../../apps/desktop-ui/src/components/agent-checkpoint/FollowUpQueue.vue';
import { useAgentConversationSessions } from '../../../apps/desktop-ui/src/composables/useAgentConversationSessions';
import { evaluateAgentTurnOutcome } from '../../../apps/desktop-ui/src/composables/useAgentFollowUpQueue';
import type { AgentFollowUpControls } from '../../../apps/desktop-ui/src/composables/useAgentFollowUpQueue';

type Turn = { finish(result?: { stoppedReason?: string; pendingActions?: unknown[] }, extraParts?: UIMessage['parts']): void };

/** Each sendMessage streams until the test finishes it. */
function scriptChat(chat: MockChatInstance) {
  const turns: Turn[] = [];
  chat.sendMessage.mockImplementation(({ text }: { text: string }) => new Promise<void>((resolve) => {
    chat.status.value = 'streaming';
    chat.messages.value = [...chat.messages.value, { id: `u${turns.length}`, role: 'user', parts: [{ type: 'text', text }] }];
    turns.push({
      finish(result = { stoppedReason: 'completed', pendingActions: [] }, extraParts = []) {
        chat.messages.value = [...chat.messages.value, {
          id: `a${turns.length}`,
          role: 'assistant',
          parts: [...extraParts, { type: 'data-runtime-result', data: result } as UIMessage['parts'][number]],
        }];
        chat.status.value = 'ready';
        resolve();
      },
    });
  }));
  return turns;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Copilot follow-up queue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    chatHarness.instances.length = 0;
    api.createAgentChatTransport.mockReturnValue({});
    api.getComposerSubmitShortcutPreference.mockResolvedValue('enter');
  });

  it('queues input while a turn runs and sends it after the turn completes', async () => {
    const conversations = useAgentConversationSessions();
    const chat = chatHarness.instances[0]!;
    const turns = scriptChat(chat);

    conversations.activeInput.value = '写开场';
    const first = conversations.sendCurrentInput();
    await flush();
    conversations.activeInput.value = '再写第二段';
    await conversations.sendCurrentInput();

    expect(conversations.activeInput.value).toBe('');
    expect(conversations.activeFollowUps.value.map((item) => item.text)).toEqual(['再写第二段']);
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);

    turns[0]!.finish();
    await flush();
    expect(chat.sendMessage).toHaveBeenCalledTimes(2);
    expect(chat.sendMessage.mock.calls[1]![0]).toEqual({ text: '再写第二段' });
    expect(conversations.activeFollowUps.value).toEqual([]);
    turns[1]!.finish();
    await first;
  });

  it('pauses the queue when the turn leaves a PendingAction and resumes on request', async () => {
    const conversations = useAgentConversationSessions();
    const chat = chatHarness.instances[0]!;
    const turns = scriptChat(chat);

    conversations.activeInput.value = '改第一章';
    const first = conversations.sendCurrentInput();
    await flush();
    conversations.activeInput.value = '然后改第二章';
    await conversations.sendCurrentInput();
    turns[0]!.finish({ stoppedReason: 'completed', pendingActions: [{ id: 'action-1' }] });
    await first;

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    expect(conversations.activeFollowUpsPaused.value).toBe(true);
    expect(conversations.activeFollowUpNotice.value).toContain('待审批');

    const resumed = conversations.resumeFollowUps();
    await flush();
    expect(chat.sendMessage).toHaveBeenCalledTimes(2);
    turns[1]!.finish();
    await resumed;
  });

  it('steers the running turn, and keeps the message queued when it is too late', async () => {
    const conversations = useAgentConversationSessions();
    const chat = chatHarness.instances[0]!;
    const turns = scriptChat(chat);
    api.steerAgentTurn.mockResolvedValueOnce({ status: 'accepted', id: 'steer-1' })
      .mockResolvedValueOnce({ status: 'too_late' })
      .mockResolvedValueOnce({ status: 'too_late' });

    conversations.activeInput.value = '写开场';
    const first = conversations.sendCurrentInput();
    await flush();
    const body = chat.sendMessage.mock.calls[0]![1].body;

    conversations.activeInput.value = '换成雨天';
    await conversations.steerCurrentInput();
    expect(api.steerAgentTurn).toHaveBeenLastCalledWith(body.sessionId, body.turnId, '换成雨天');
    expect(conversations.activeFollowUps.value).toEqual([]);

    conversations.activeInput.value = '加一个配角';
    await conversations.sendCurrentInput();
    const queued = conversations.activeFollowUps.value[0]!;
    await conversations.steerQueuedFollowUp(queued.id);
    expect(conversations.activeFollowUps.value.map((item) => item.text)).toEqual(['加一个配角']);
    expect(conversations.activeFollowUpNotice.value).toContain('保留在排队中');

    conversations.activeInput.value = '直接插话但太晚';
    await conversations.steerCurrentInput();
    expect(conversations.activeFollowUps.value.map((item) => item.text)).toEqual(['直接插话但太晚', '加一个配角']);

    turns[0]!.finish();
    await flush();
    turns[1]!.finish();
    await flush();
    turns[2]!.finish();
    await first;
    expect(chat.sendMessage.mock.calls.map((call) => call[0].text)).toEqual(['写开场', '直接插话但太晚', '加一个配角']);
  });

  it('re-queues steers the backend handed back and stops after a user stop', () => {
    const messages: UIMessage[] = [{
      id: 'a', role: 'assistant', parts: [
        { type: 'data-steering', data: { id: 's1', content: '晚到的插话', status: 'rejected' } } as UIMessage['parts'][number],
        { type: 'data-runtime-result', data: { stoppedReason: 'completed', pendingActions: [] } } as UIMessage['parts'][number],
      ],
    }];
    expect(evaluateAgentTurnOutcome(messages, 'ready', false)).toEqual({ rejectedSteers: ['晚到的插话'] });
    expect(evaluateAgentTurnOutcome(messages, 'ready', true).pause).toBe('stopped');
    expect(evaluateAgentTurnOutcome(messages, 'error', false).pause).toBe('failed');
    expect(evaluateAgentTurnOutcome([], 'ready', false).pause).toBe('incomplete');
  });
});

describe('Copilot composer while running', () => {
  it('queues with the send shortcut and steers with Alt+Enter or the 插话 button', async () => {
    const wrapper = mount(ChatComposer, { props: { modelValue: '补充', disabled: false, running: true } });
    const textarea = wrapper.get('textarea');
    await textarea.trigger('keydown', { key: 'Enter', altKey: true });
    expect(wrapper.emitted('steer')).toHaveLength(1);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toHaveLength(1);
    await wrapper.get('.composer-steer-button').trigger('click');
    expect(wrapper.emitted('steer')).toHaveLength(2);
    wrapper.unmount();

    const idle = mount(ChatComposer, { props: { modelValue: '补充', disabled: false } });
    expect(idle.find('.composer-steer-button').exists()).toBe(false);
    await idle.get('textarea').trigger('keydown', { key: 'Enter', altKey: true });
    expect(idle.emitted('steer')).toBeUndefined();
    idle.unmount();
  });

  it('lists queued messages with convert, reorder, edit and remove actions', async () => {
    const controls: AgentFollowUpControls = {
      items: [
        { id: 'q1', text: '第一条', writingReferenceAttachmentIds: [] },
        { id: 'q2', text: '第二条', writingReferenceAttachmentIds: [] },
      ],
      notice: '',
      paused: false,
      steerInput: vi.fn(), steer: vi.fn(), edit: vi.fn(), remove: vi.fn(), move: vi.fn(), resume: vi.fn(),
    };
    const wrapper = mount(FollowUpQueue, { props: { controls, running: true } });
    const buttons = (label: string) => wrapper.findAll('button').filter((button) => button.text() === label);

    await buttons('转为插话')[1]!.trigger('click');
    expect(controls.steer).toHaveBeenCalledWith('q2');
    await wrapper.get('[aria-label="上移"]:not([disabled])').trigger('click');
    expect(controls.move).toHaveBeenCalledWith('q2', -1);
    await buttons('删除')[0]!.trigger('click');
    expect(controls.remove).toHaveBeenCalledWith('q1');
    await buttons('编辑')[0]!.trigger('click');
    await wrapper.get('textarea').setValue('改过的第一条');
    await buttons('保存')[0]!.trigger('click');
    expect(controls.edit).toHaveBeenCalledWith('q1', '改过的第一条');

    await wrapper.setProps({ running: false, controls: { ...controls, paused: true } });
    expect(buttons('转为插话')).toHaveLength(0);
    await buttons('继续发送')[0]!.trigger('click');
    expect(controls.resume).toHaveBeenCalled();
    wrapper.unmount();
  });
});
