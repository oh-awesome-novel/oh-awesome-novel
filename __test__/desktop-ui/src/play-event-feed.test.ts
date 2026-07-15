// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayEventFeed from '../../../apps/desktop-ui/src/components/play/PlayEventFeed.vue';

describe('PlayEventFeed', () => {
  it('exposes the global author-view switch when only hidden Play content exists', async () => {
    const wrapper = mount(PlayEventFeed, {
      props: {
        events: [],
        hasHiddenPlayContent: true,
        showSpoilers: false,
      },
    });

    const authorView = wrapper.get('[role="switch"]');
    expect(authorView.attributes('aria-checked')).toBe('false');
    expect(authorView.attributes('aria-label')).toContain('玩家未知');

    await authorView.trigger('click');

    expect(wrapper.emitted('update:showSpoilers')).toEqual([[true]]);
    await wrapper.setProps({ showSpoilers: true });
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true');
  });

  it('keeps structured causal reasoning author-only even for a visible event', async () => {
    const wrapper = mount(PlayEventFeed, {
      props: {
        events: [{
          id: 'turn-2-event-1',
          turnId: 'turn-2-referee',
          sequence: 1,
          kind: 'environmentChanged',
          origin: 'environment',
          title: 'The gate closes',
          summary: 'The visible gate is now closed.',
          visibility: 'playerVisible',
          cause: {
            reason: 'A hidden bargain caused the guard to close it.',
            sourceEventIds: ['turn-1-event-1'],
          },
          worldClock: { turn: 2, revision: 2 },
          createdAt: '2026-07-15T04:00:00.000Z',
          canonical: false,
        }],
        hasHiddenPlayContent: true,
        showSpoilers: false,
      },
    });

    expect(wrapper.text()).toContain('The visible gate is now closed.');
    expect(wrapper.text()).not.toContain('A hidden bargain');
    expect(wrapper.find('details').exists()).toBe(false);

    await wrapper.get('[role="switch"]').trigger('click');
    await wrapper.setProps({ showSpoilers: true });

    expect(wrapper.get('details').text()).toContain('A hidden bargain');
  });
});
