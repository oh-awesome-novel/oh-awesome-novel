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
        pressures: [],
        agendas: [],
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

  it('shows active pressure and agenda momentum without forcing a numeric meter', () => {
    const wrapper = mount(PlayWorldHud, {
      props: {
        clock: { turn: 2, revision: 2, elapsed: '10 minutes' },
        policy: {
          simulationMode: 'reactiveWorld',
          density: 'balanced',
          allowOffscreen: true,
          allowHidden: true,
          maxExternalEventsPerTurn: 2,
        },
        sceneStart: 'Station',
        characters: [],
        stateEntries: [],
        scheduledEvents: [],
        sources: [],
        pressures: [{
          id: 'pressure-1',
          kind: 'deadline',
          label: 'The last train is leaving',
          status: 'active',
          causeRefs: ['branch-base'],
          nextConsequence: 'The witness leaves the station.',
          visibility: 'playerVisible',
        }],
        agendas: [{
          id: 'agenda-1',
          ownerEntityId: 'Station guard',
          goal: 'Seal every exit',
          nextMove: 'Lock the east gate',
          blockers: [],
          status: 'active',
          visibility: 'playerVisible',
          updatedAtTurnId: 'branch-base',
        }],
      },
    });

    expect(wrapper.get('[aria-label="World momentum"]').text()).toContain(
      'The last train is leaving',
    );
    expect(wrapper.text()).toContain('The witness leaves the station.');
    expect(wrapper.text()).toContain('Lock the east gate');
    expect(wrapper.text()).not.toContain('threshold');
  });
});
