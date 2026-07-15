// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayWorldHud from '../../../apps/desktop-ui/src/components/play/PlayWorldHud.vue';

describe('PlayWorldHud', () => {
  it('shows pending scheduled world changes with deterministic trigger evidence', () => {
    const wrapper = mount(PlayWorldHud, {
      props: {
        clock: { turn: 2, revision: 2 },
        policy: {
          simulationMode: 'reactiveWorld',
          density: 'balanced',
          allowOffscreen: true,
          allowHidden: true,
          maxExternalEventsPerTurn: 0,
        },
        sceneStart: 'Station',
        characters: [],
        stateEntries: [],
        sources: [],
        scheduledEvents: [{
          id: 'scheduled-2-1',
          label: 'Patrol arrives',
          trigger: { type: 'afterTurns', turns: 2 },
          template: {
            kind: 'arrival',
            origin: 'npc',
            title: 'Patrol arrives',
            summary: 'A patrol enters the station.',
            visibility: 'playerVisible',
          },
          status: 'scheduled',
          scheduledAtTurn: 2,
          scheduledAtRevision: 2,
          priority: 5,
        }],
      },
    });

    expect(wrapper.text()).toContain('Scheduled changes');
    expect(wrapper.text()).toContain('Patrol arrives');
    expect(wrapper.text()).toContain('after 2 turns · priority 5');
  });
});
