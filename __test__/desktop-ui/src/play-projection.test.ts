import { describe, expect, it } from 'vitest';

import {
  buildPlayStateEntryViews,
  isPlayProvenanceInSelectedBranch,
  normalizeRelativeTimeAdvance,
  readPlayWorldMomentum,
} from '../../../apps/desktop-ui/src/composables/usePlayWorkspace';

describe('Play selected-branch projection', () => {
  it('keeps session-level facts only when every provenance reference is selected', () => {
    const selectedMessages = new Set(['turn-a-referee']);
    const selectedEvents = new Set(['event-a']);

    expect(isPlayProvenanceInSelectedBranch({
      sourceTurnIds: ['turn-a-referee'],
      sourceEventIds: ['event-a'],
    }, selectedMessages, selectedEvents)).toBe(true);
    expect(isPlayProvenanceInSelectedBranch({
      sourceTurnIds: ['turn-b-referee'],
      sourceEventIds: ['event-b'],
    }, selectedMessages, selectedEvents)).toBe(false);
    expect(isPlayProvenanceInSelectedBranch({
      sourceTurnIds: [],
      sourceEventIds: [],
    }, selectedMessages, selectedEvents)).toBe(true);
  });

  it('reads only a complete typed worldMomentum block and fails closed otherwise', () => {
    const momentum = readPlayWorldMomentum({
      worldMomentum: {
        pressures: [{
          id: 'pressure-1',
          kind: 'deadline',
          label: 'Midnight deadline',
          status: 'active',
          causeRefs: ['branch-base'],
          visibility: 'playerVisible',
        }],
        agendas: [],
      },
    });

    expect(momentum.pressures).toHaveLength(1);
    expect(readPlayWorldMomentum({
      worldMomentum: { pressures: [{ id: 'incomplete' }], agendas: [] },
    })).toEqual({ pressures: [], agendas: [] });
  });

  it('accepts only positive safe relative time advances', () => {
    expect(normalizeRelativeTimeAdvance({ amount: 2, unit: 'hour' })).toEqual({
      amount: 2,
      unit: 'hour',
    });
    expect(normalizeRelativeTimeAdvance({ amount: 0, unit: 'minute' })).toBeUndefined();
  });

  it('never exposes reserved playKnowledge through the generic state HUD', () => {
    const state = {
      publicWeather: 'rain',
      authorNote: 'north patrol',
      playKnowledge: {
        schemaVersion: 1,
        records: [{ subjectEventId: 'hidden-subject' }],
      },
    };
    const visibility = {
      publicWeather: 'playerVisible' as const,
      authorNote: 'playerUnknown' as const,
      playKnowledge: 'playerUnknown' as const,
    };

    expect(buildPlayStateEntryViews(state, visibility, false)).toEqual([
      { key: 'publicWeather', value: 'rain' },
    ]);
    expect(buildPlayStateEntryViews(state, visibility, true)).toEqual([
      { key: 'publicWeather', value: 'rain' },
      { key: 'authorNote', value: 'north patrol' },
    ]);
    expect(JSON.stringify(buildPlayStateEntryViews(state, visibility, true)))
      .not.toContain('hidden-subject');
  });
});
