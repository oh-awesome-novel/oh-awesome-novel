// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayEventFeed from '../../../apps/desktop-ui/src/components/play/PlayEventFeed.vue';
import type { PlayEventCardView } from '../../../apps/desktop-ui/src/composables/playWorldPresentation';

describe('PlayEventFeed', () => {
  it('exposes the global author-view switch when only hidden Play content exists', async () => {
    const wrapper = mount(PlayEventFeed, {
      props: {
        events: [],
        causeLabelsByEventId: {},
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
        causeLabelsByEventId: {},
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

  it('shows spoiler-safe momentum labels while keeping author reasoning gated', () => {
    const wrapper = mount(PlayEventFeed, {
      props: {
        events: [{
          id: 'turn-3-event-1',
          turnId: 'turn-3-referee',
          sequence: 1,
          kind: 'factionActed',
          origin: 'faction',
          title: 'The east gate closes',
          summary: 'Guards seal the station exit.',
          visibility: 'playerVisible',
          cause: {
            reason: 'The hidden commander ordered the lockdown.',
            pressureId: 'pressure-1',
            agendaId: 'agenda-1',
          },
          worldClock: { turn: 3, revision: 3 },
          createdAt: '2026-07-15T05:00:00.000Z',
          canonical: false,
        }],
        causeLabelsByEventId: {
          'turn-3-event-1': [
            'Pressure · Station lockdown',
            'Agenda · Guard: lock the east gate',
          ],
        },
        hasHiddenPlayContent: true,
        showSpoilers: false,
      },
    });

    expect(wrapper.get('.play-event-cause').text()).toContain('Station lockdown');
    expect(wrapper.get('.play-event-cause').text()).toContain('lock the east gate');
    expect(wrapper.text()).not.toContain('hidden commander');
  });

  it('renders projected impact, cause, state, time, and author-only diagnostics', async () => {
    const cards: PlayEventCardView[] = [{
      id: 'event-visible',
      title: 'The east gate closes',
      impact: 'Guards seal the station exit.',
      kindLabel: 'Faction acted',
      originLabel: 'Origin · Faction',
      visibility: 'playerVisible',
      worldTimeLabel: 'Nightfall · Turn 3 · + 30 minutes',
      causeLabels: [{
        kind: 'action',
        label: 'Wait · Stay beside the gate',
        ref: 'turn-3-player',
      }],
      stateImpacts: [{ path: 'location.gate', value: 'closed' }],
      technicalRefs: [{ label: 'Artifact', value: 'artifact-3' }],
      authorReason: 'The hidden commander ordered the lockdown.',
    }, {
      id: 'event-hidden',
      title: 'A hidden patrol moves',
      impact: 'The patrol takes the northern route.',
      kindLabel: 'Npc acted',
      originLabel: 'Origin · Npc',
      visibility: 'playerUnknown',
      worldTimeLabel: 'Turn 3',
      causeLabels: [],
      stateImpacts: [],
      technicalRefs: [],
      authorReason: 'An unrevealed order sent them north.',
    }];
    const wrapper = mount(PlayEventFeed, {
      props: {
        cards,
        hasHiddenPlayContent: true,
        showSpoilers: false,
      },
    });

    expect(wrapper.get('[aria-label="Event impact"]').text()).toContain('Impact');
    expect(wrapper.text()).toContain('Guards seal the station exit.');
    expect(wrapper.text()).toContain('Nightfall · Turn 3 · + 30 minutes');
    expect(wrapper.text()).toContain('Origin · Faction');
    expect(wrapper.get('.play-event-cause').text()).toContain('Stay beside the gate');
    expect(wrapper.get('[aria-label="Turn state changes"]').text()).toContain('location.gate');
    expect(wrapper.text()).not.toContain('hidden commander');
    expect(wrapper.text()).not.toContain('artifact-3');
    expect(wrapper.text()).not.toContain('A hidden patrol moves');

    await wrapper.get('[role="switch"]').trigger('click');
    await wrapper.setProps({ showSpoilers: true });

    expect(wrapper.text()).toContain('A hidden patrol moves');
    expect(wrapper.get('[aria-label="Author cause"]').text()).toContain('hidden commander');
    expect(wrapper.get('[aria-label="Technical references"]').text()).toContain('artifact-3');
  });
});
