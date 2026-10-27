// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';
import { computed } from 'vue';
import { describe, expect, it, vi } from 'vite-plus/test';

import AgentTimeline from '../../../apps/desktop-ui/src/components/agent-checkpoint/AgentTimeline.vue';
import PlayMessageLog from '../../../apps/desktop-ui/src/components/play/message-log/PlayMessageLog.vue';
import { useAgentTimeline } from '../../../apps/desktop-ui/src/composables/useAgentTimeline';
import type { PlayMessageLogEntry, PlayMessageLogPage } from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';

describe('Copilot reasoning display', () => {
  it('shows assistant thinking collapsed before the answer and copies only the answer', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const messages = computed<UIMessage[]>(() => [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: '写一句开场' }] },
      {
        id: 'a',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: '先想氛围。', state: 'done' },
          { type: 'text', text: '雨落在旧城。', state: 'done' },
        ],
      },
    ]);
    const { items } = useAgentTimeline(messages);
    expect(items.value.map((item) => item.type)).toEqual(['user-message', 'agent-reasoning', 'agent-message']);

    const wrapper = mount(AgentTimeline, { props: { items: items.value } });
    const details = wrapper.get('details.conversation-reasoning');
    expect(details.attributes('open')).toBeUndefined();
    expect(details.text()).toContain('思考过程');
    expect(details.text()).toContain('先想氛围。');

    const copyButtons = wrapper.findAll('.conversation-copy-button');
    await copyButtons.at(-1)!.trigger('click');
    expect(writeText).toHaveBeenCalledWith('雨落在旧城。');
    wrapper.unmount();
  });

  it('labels thinking that is still streaming and renders nothing extra without reasoning', () => {
    const streaming = useAgentTimeline(computed<UIMessage[]>(() => [{
      id: 'a', role: 'assistant', parts: [{ type: 'reasoning', text: '想…', state: 'streaming' }],
    }]));
    expect(streaming.items.value).toEqual([
      { id: 'a:reasoning', type: 'agent-reasoning', text: '想…', streaming: true },
    ]);

    const plain = useAgentTimeline(computed<UIMessage[]>(() => [{
      id: 'a', role: 'assistant', parts: [{ type: 'text', text: '好' }],
    }]));
    expect(plain.items.value.map((item) => item.type)).toEqual(['agent-message']);
  });
});

describe('Copilot steer display', () => {
  it('shows applied and handed-back steers in order inside the assistant turn', () => {
    const { items } = useAgentTimeline(computed<UIMessage[]>(() => [{
      id: 'a', role: 'assistant', parts: [
        { type: 'text', text: '第一段。' },
        { type: 'data-steering', data: { id: 's1', content: '换成雨天', status: 'applied' } } as UIMessage['parts'][number],
        { type: 'data-steering', data: { id: 's2', content: '晚到', status: 'rejected' } } as UIMessage['parts'][number],
      ],
    }]));
    expect(items.value.filter((item) => item.type === 'steer-message')).toEqual([
      { id: 'a:steer:1', type: 'steer-message', text: '换成雨天', status: 'applied' },
      { id: 'a:steer:2', type: 'steer-message', text: '晚到', status: 'rejected' },
    ]);
    const wrapper = mount(AgentTimeline, { props: { items: items.value } });
    expect(wrapper.findAll('.conversation-steer-tag').map((tag) => tag.text())).toEqual(['插话', '插话未送达，已转入排队']);
    wrapper.unmount();
  });
});

describe('Play message log view', () => {
  const entry = (kind: string, extra: Partial<PlayMessageLogEntry> = {}): PlayMessageLogEntry => ({
    schemaVersion: 1, at: '2026-10-22T00:00:00.000Z', playSessionId: 'play-1', kind, ...extra,
  });

  it('pages the log, filters by kind and participant and keeps thinking collapsed', async () => {
    const pages: PlayMessageLogPage[] = [
      {
        entries: [
          entry('author_action', { turnId: 't1', text: '等待' }),
          entry('model_request', { role: 'world_referee', text: 'PROMPT' }),
          entry('model_reasoning', { role: 'world_referee', text: '裁判在想' }),
        ],
        nextCursor: 3,
        skippedLines: 1,
      },
      {
        entries: [
          entry('model_reasoning', { role: 'rehearsal_actor', participantRef: 'alice', text: 'Alice 在想' }),
          entry('turn_committed', { data: { revision: 1 } }),
        ],
        skippedLines: 0,
      },
    ];
    const client = { getPlayMessageLog: vi.fn(async () => pages.shift()!) };
    const wrapper = mount(PlayMessageLog, { props: { sessionId: 'play-1', client } });

    await wrapper.get('.play-message-log-open').trigger('click');
    await flushPromises();
    expect(client.getPlayMessageLog).toHaveBeenCalledWith('play-1', { cursor: 0, limit: 200 });
    expect(wrapper.text()).toContain('跳过了 1 行');
    expect(wrapper.findAll('.play-message-log-item')).toHaveLength(3);
    const thinking = wrapper.get('.play-message-log-kind-model_reasoning details');
    expect(thinking.attributes('open')).toBeUndefined();
    expect(thinking.text()).toContain('裁判在想');

    const loadMore = wrapper.findAll('.play-message-log-footer button').find((button) => button.text() === '加载更多')!;
    await loadMore.trigger('click');
    await flushPromises();
    expect(client.getPlayMessageLog).toHaveBeenLastCalledWith('play-1', { cursor: 3, limit: 200 });
    expect(wrapper.findAll('.play-message-log-item')).toHaveLength(5);

    const [kindSelect, participantSelect] = wrapper.findAll('.play-message-log-filters select');
    await kindSelect!.setValue('reasoning');
    expect(wrapper.findAll('.play-message-log-item')).toHaveLength(2);
    await participantSelect!.setValue('alice');
    expect(wrapper.findAll('.play-message-log-item').map((item) => item.text()).join(''))
      .toContain('Alice 在想');
    expect(wrapper.findAll('.play-message-log-item')).toHaveLength(1);
    wrapper.unmount();
  });

  it('shows a load error without breaking the view', async () => {
    const client = { getPlayMessageLog: vi.fn(async () => { throw new Error('log unreadable'); }) };
    const wrapper = mount(PlayMessageLog, { props: { sessionId: 'play-1', client } });
    await wrapper.get('.play-message-log-open').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('log unreadable');
    wrapper.unmount();
  });
});
