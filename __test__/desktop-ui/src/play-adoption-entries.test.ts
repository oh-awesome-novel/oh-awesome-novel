// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayAdoptionPanel from '../../../apps/desktop-ui/src/components/play/PlayAdoptionPanel.vue';
import PlayWorldEventCard from '../../../apps/desktop-ui/src/components/play/PlayWorldEventCard.vue';
import PlayOutcomeItem from '../../../apps/desktop-ui/src/components/play/outcome/PlayOutcomeItem.vue';
import type { PlayEventCardView } from '../../../apps/desktop-ui/src/composables/playWorldPresentation';
import type {
  PlayObservation,
  PlayOutcomeItem as PlayOutcomeItemValue,
} from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';

describe('Play adoption entry seeds', () => {
  it('emits the same identity-only seed contract from event, observation, and outcome', async () => {
    const eventCard: PlayEventCardView = {
      id: 'event-visible-1',
      title: 'The public gate closes',
      impact: 'Travelers can no longer use the east gate.',
      kindLabel: 'Environment changed',
      originLabel: 'Origin · Environment',
      visibility: 'playerVisible',
      worldTimeLabel: 'Turn 3',
      projection: 'player',
      causeLabels: [],
      stateImpacts: [],
      technicalRefs: [],
    };
    const event = mount(PlayWorldEventCard, {
      props: {
        card: eventCard,
        showAuthorDetails: false,
        adoptionDisabled: false,
      },
    });

    await event.get('button[aria-label^="Bring event to writing"]').trigger('click');
    expect(event.emitted('prepareAdoption')).toEqual([[
      { kind: 'event', eventId: 'event-visible-1' },
    ]]);

    const observationValue: PlayObservation = {
      id: 'observation-visible-1',
      summary: 'The eastern route is blocked',
      evidence: 'The player saw guards lock the gate.',
      visibility: 'playerVisible',
      sourceTurnIds: ['turn-player-3'],
      sourceEventIds: ['event-visible-1'],
      canonical: false,
    };
    const observation = mount(PlayAdoptionPanel, {
      props: {
        observations: [observationValue],
        candidates: [],
        disabled: false,
        notice: '',
      },
    });

    await observation.get('button[aria-label^="Bring observation to writing"]').trigger('click');
    expect(observation.emitted('prepareAdoption')).toEqual([[
      { kind: 'observation', observationId: 'observation-visible-1' },
    ]]);

    const outcomeValue: PlayOutcomeItemValue = {
      id: 'outcome-visible-1',
      kind: 'writingMaterial',
      summary: 'Reuse the locked gate as a later obstacle.',
      visibility: 'playerVisible',
      confidence: 'confirmed',
      tags: ['writingMaterial'],
      artifactTurnRefs: ['artifact-3'],
      messageRefs: [],
      eventRefs: ['event-visible-1'],
      observationRefs: ['observation-visible-1'],
      evidenceRefs: [],
      sourceRefs: [],
      participantRefs: [],
    };
    const outcome = mount(PlayOutcomeItem, {
      props: {
        item: outcomeValue,
        selected: false,
        disabled: false,
        outcomeReportFingerprint: 'c'.repeat(64),
      },
    });

    await outcome.get('button[aria-label^="Bring outcome to writing"]').trigger('click');
    expect(outcome.emitted('prepareAdoption')).toEqual([[
      {
        kind: 'outcome',
        outcomeItemId: 'outcome-visible-1',
        outcomeReportFingerprint: 'c'.repeat(64),
      },
    ]]);

    expect(JSON.stringify([
      event.emitted('prepareAdoption'),
      observation.emitted('prepareAdoption'),
      outcome.emitted('prepareAdoption'),
    ])).not.toContain('The public gate closes');
  });
});
