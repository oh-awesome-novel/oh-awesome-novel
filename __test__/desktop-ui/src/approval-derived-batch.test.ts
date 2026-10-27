// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';
import ApprovalTab from '../../../apps/desktop-ui/src/components/workspace/ApprovalTab.vue';

const action = (id: string, path: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, description: '', status: 'pending', createdAt: '2026-10-15T00:00:00.000Z', diff: '',
  changes: [{ operation: 'update', path, oldHash: 'a'.repeat(64), newHash: 'b'.repeat(64) }],
  origin: { kind: 'agentTurn', sessionId: 's', turnId: 't' }, ...extra,
});

describe('derived record batch acceptance in Approval', () => {
  it('offers only undecided derived records and leaves prose out of the batch', async () => {
    const actions = [
      action('summary', 'summaries/chapter/0001/0001.md'),
      action('timeline', 'timeline/events.yaml'),
      action('prose', 'chapters/0001/0001.md'),
      action('decided', 'state/characters.yaml', { decision: 'accepted' }),
    ];
    const wrapper = mount(ApprovalTab, { props: { actions: actions as never, loading: false, error: '', batchStatus: '已接受 2 项派生记录。' },
      global: { stubs: { PendingActionCard: true } } });
    try {
      const button = wrapper.get('.approval-batch-row button');
      expect(button.text()).toContain('接受全部派生记录（2）');
      await button.trigger('click');
      expect((wrapper.emitted('acceptDerived')![0]![0] as Array<{ id: string }>).map((item) => item.id)).toEqual(['summary', 'timeline']);
      expect(wrapper.text()).toContain('已接受 2 项派生记录。');
      await wrapper.setProps({ actions: [actions[0], actions[2]] as never });
      expect(wrapper.find('.approval-batch-row').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
