// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import PlayContextInspector from '../../../apps/desktop-ui/src/components/play/context/PlayContextInspector.vue';
import PlayEventFeed from '../../../apps/desktop-ui/src/components/play/PlayEventFeed.vue';
import PlayTranscript from '../../../apps/desktop-ui/src/components/play/PlayTranscript.vue';
import {
  activateFocusedControl,
  getNativeButtonContract,
  getNativeButtonContracts,
  getPlayStatusRegions,
  PLAY_SOURCE_DRIFT_CONTROL_NAMES,
  PLAY_WINDOW_CONTROL_NAMES,
} from './support/playAccessibilityHarness';

describe('Play long-session renderer controls', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('exposes a bounded transcript window as a keyboard-native load action', () => {
    const wrapper = mount(PlayTranscript, {
      attachTo: document.body,
      props: {
        title: 'Long-running station rehearsal',
        sceneStart: 'The first train arrived long ago.',
        turns: createTranscriptTail(),
        totalCount: 120,
        hasMoreBefore: true,
        announcement: 'Showing the latest 12 messages.',
      },
    });
    const loadEarlier = getNativeButtonContract(
      wrapper.element,
      PLAY_WINDOW_CONTROL_NAMES[0],
    );

    expect(wrapper.get('.play-transcript-count').text()).toContain('120 messages');
    expect(wrapper.get('.play-transcript-count').text()).toContain('showing 12');
    expect(loadEarlier.button.getAttribute('aria-controls')).toBe(
      wrapper.get('.play-transcript-scroll').attributes('id'),
    );

    activateFocusedControl(loadEarlier);

    expect(wrapper.emitted('loadEarlier')).toHaveLength(1);
    expect(getPlayStatusRegions(wrapper.element)[0]?.textContent).toContain(
      'Showing the latest 12 messages.',
    );
    wrapper.unmount();
  });

  it('exposes a bounded event window without changing the author-view contract', () => {
    const wrapper = mount(PlayEventFeed, {
      attachTo: document.body,
      props: {
        cards: [],
        hasHiddenPlayContent: false,
        showSpoilers: false,
        totalCount: 72,
        hasMoreBefore: true,
      },
    });
    const loadEarlier = getNativeButtonContract(
      wrapper.element,
      PLAY_WINDOW_CONTROL_NAMES[1],
    );

    activateFocusedControl(loadEarlier);

    expect(wrapper.emitted('loadEarlier')).toHaveLength(1);
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps all source-drift choices keyboard-native and emits a typed decision', async () => {
    const wrapper = mount(PlayContextInspector, {
      attachTo: document.body,
      props: {
        traces: [],
        drift: createDrift(),
        loading: false,
        busy: false,
      },
    });
    const controls = getNativeButtonContracts(
      wrapper.element,
      PLAY_SOURCE_DRIFT_CONTROL_NAMES,
    );

    expect(controls.every(({ describedBy }) => describedBy?.textContent?.includes(
      'Canonical files remain untouched',
    ))).toBe(true);

    activateFocusedControl(controls[1]!);
    await flushPromises();

    const confirm = getNativeButtonContract(wrapper.element, 'Confirm');
    expect(document.activeElement).toBe(confirm.button);
    activateFocusedControl(confirm);
    await flushPromises();

    expect(wrapper.emitted('decide')).toEqual([[{ kind: 'reassemble' }]]);
    expect(document.activeElement).toBe(
      getNativeButtonContract(wrapper.element, 'Reassemble').button,
    );
    expect(getPlayStatusRegions(wrapper.element)).toHaveLength(1);
    wrapper.unmount();
  });

  it('returns source-decision focus after Escape without emitting', async () => {
    const wrapper = mount(PlayContextInspector, {
      attachTo: document.body,
      props: {
        traces: [],
        drift: createDrift(),
        loading: false,
        busy: false,
      },
    });

    activateFocusedControl(getNativeButtonContract(wrapper.element, 'Continue frozen'));
    await flushPromises();
    await wrapper.get('.play-source-decision-confirmation').trigger('keydown', {
      key: 'Escape',
    });
    await flushPromises();

    expect(wrapper.find('.play-source-decision-confirmation').exists()).toBe(false);
    expect(document.activeElement).toBe(
      getNativeButtonContract(wrapper.element, 'Continue frozen').button,
    );
    expect(wrapper.emitted('decide')).toBeUndefined();
    wrapper.unmount();
  });

  it('requires an explicit id before emitting a typed fork decision', async () => {
    const wrapper = mount(PlayContextInspector, {
      attachTo: document.body,
      props: {
        traces: [],
        drift: createDrift(),
        loading: false,
        busy: false,
      },
    });

    activateFocusedControl(getNativeButtonContract(wrapper.element, 'Fork session'));
    await flushPromises();
    const confirm = getNativeButtonContract(wrapper.element, 'Confirm');
    expect(confirm.button.disabled).toBe(true);

    const [sessionId, title] = wrapper.findAll('input');
    await sessionId!.setValue('play-long-fork');
    await title!.setValue('Station rehearsal fork');
    expect(confirm.button.disabled).toBe(false);
    activateFocusedControl(confirm);

    expect(wrapper.emitted('decide')).toEqual([[
      {
        kind: 'fork',
        newSessionId: 'play-long-fork',
        title: 'Station rehearsal fork',
      },
    ]]);
    wrapper.unmount();
  });
});

function createTranscriptTail() {
  return Array.from({ length: 12 }, (_, offset) => ({
    id: `message-${109 + offset}`,
    speaker: offset % 2 === 0 ? 'player' : 'world-referee',
    content: `message ${109 + offset}`,
    createdAt: `2026-07-20T12:${String(offset).padStart(2, '0')}:00.000Z`,
  }));
}

function createDrift() {
  return {
    overall: 'drifted' as const,
    items: [{
      id: 'source-chapter-1',
      label: 'chapters/chapter-01.md',
      state: 'changed' as const,
      evidence: 'content hash changed',
    }],
    availableDecisions: ['continueFrozen', 'reassemble', 'fork'] as const,
  };
}
