// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayActorQueue from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayActorQueue.vue';
import type { PlayRehearsalActorQueueItem } from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

describe('PlayActorQueue', () => {
  it('distinguishes current, waiting, selected and committed without relying on color', () => {
    const items: PlayRehearsalActorQueueItem[] = [
      actor('mara', 'Mara', 'selected'),
      actor('ivo', 'Ivo', 'current'),
      actor('guard', 'Guard', 'waiting'),
      actor('porter', 'Porter', 'committed'),
    ];
    const wrapper = mount(PlayActorQueue, { props: { items } });
    const rows = wrapper.findAll('li');

    expect(rows.map((row) => row.text())).toEqual([
      expect.stringContaining('Selected'),
      expect.stringContaining('Current'),
      expect.stringContaining('Waiting'),
      expect.stringContaining('Committed'),
    ]);
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Ivo');
    expect(wrapper.get('[data-status="selected"]').text()).toContain('Mara');
    expect(wrapper.get('[data-status="committed"]').text()).toContain('Porter');
  });
});

function actor(
  participantRef: string,
  displayName: string,
  status: PlayRehearsalActorQueueItem['status'],
): PlayRehearsalActorQueueItem {
  return {
    participantRef,
    displayName,
    status,
    position: 'Station',
    currentGoal: `${displayName}'s goal`,
  };
}
