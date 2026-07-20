// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlayEventPresentationEvidence,
  PlaySessionSelectedDetail,
  PlaySessionSummary,
  PlayTranscriptTurn,
  PlayWorldEvent,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  listPlaySessions: vi.fn(),
  listPlaySessionSummaries: vi.fn(),
  getPlaySession: vi.fn(),
  getPlaySessionDetail: vi.fn(),
  listPlayContextTraces: vi.fn(),
  getPlaySourceDrift: vi.fn(),
  decidePlaySourceDrift: vi.fn(),
  listPlayCheckpoints: vi.fn(),
  getPlayOutcomeReport: vi.fn(),
  listPlayWritingReferenceAttachments: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';

describe('PlayWorkspace M5 bounded history journey', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    api.listPlaySessionSummaries.mockResolvedValue({ summaries: [summary] });
    api.listPlayContextTraces.mockResolvedValue({ traces: [] });
    api.getPlaySourceDrift.mockResolvedValue({
      status: {
        sessionId: summary.id,
        revision: summary.revision,
        overall: 'current',
        sources: [],
        availableDecisions: [],
      },
    });
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
    api.getPlayOutcomeReport.mockRejectedValue(Object.assign(new Error('missing'), {
      status: 404,
    }));
    api.listPlayWritingReferenceAttachments.mockResolvedValue({ attachments: [] });
    api.getPlaySessionDetail.mockImplementation(
      async (_id: string, options: DetailOptions = {}) => {
        if (options.transcriptCursor) return { detail: earlierTranscriptDetail() };
        if (options.eventCursor) return { detail: earlierEventDetail() };
        return { detail: latestDetail() };
      },
    );
  });

  it('loads summary then selected detail once and prepends both cursor windows', async () => {
    const wrapper = mountWorkspace();

    await vi.waitFor(() => {
      expect(api.listPlaySessionSummaries).toHaveBeenCalledOnce();
      expect(api.getPlaySessionDetail).toHaveBeenCalledOnce();
    });
    await flushPromises();

    expect(api.listPlaySessions).not.toHaveBeenCalled();
    expect(api.getPlaySession).not.toHaveBeenCalled();
    expect(api.getPlaySessionDetail).toHaveBeenNthCalledWith(1, summary.id, {
      limit: 50,
    });
    expect(wrapper.get('.play-session-card').text()).toContain('4 messages');
    expect(wrapper.get('.play-session-card').text()).toContain('4 events');
    expect(wrapper.get('.play-transcript').text()).toContain('latest message 3');
    expect(wrapper.get('.play-event-feed').text()).toContain('Latest event 4');

    await button(wrapper, 'Load earlier transcript').trigger('click');
    await vi.waitFor(() => {
      expect(api.getPlaySessionDetail).toHaveBeenCalledWith(summary.id, {
        limit: 50,
        transcriptCursor: 'transcript-before-latest',
      });
      expect(wrapper.get('.play-transcript').text()).toContain('legacy message 1');
    });

    const transcriptText = wrapper.get('.play-transcript').text();
    expect(transcriptText).toContain('legacy message 2');
    expect(transcriptText).toContain('latest message 3');
    expect(transcriptText).toContain('latest message 4');
    expect(wrapper.get('.play-transcript-count').text()).toBe('4 messages');

    await button(wrapper, 'Load earlier events').trigger('click');
    await vi.waitFor(() => {
      expect(api.getPlaySessionDetail).toHaveBeenCalledWith(summary.id, {
        limit: 50,
        eventCursor: 'events-before-latest',
      });
      expect(wrapper.get('.play-event-feed').text()).toContain('Earlier event 1');
    });

    const eventText = wrapper.get('.play-event-feed').text();
    expect(eventText).toContain('Earlier event 2');
    expect(eventText).toContain('Latest event 3');
    expect(eventText).toContain('Latest event 4');
    expect(eventText).toContain('Pressure · Earlier pressure 1');
    expect(api.getPlaySessionDetail).toHaveBeenCalledTimes(3);
    expect(api.getPlaySession).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

interface DetailOptions {
  limit?: number;
  transcriptCursor?: string;
  eventCursor?: string;
}

const summary: PlaySessionSummary = {
  schemaVersion: 4,
  id: 'play-long-journey',
  title: 'Long-running station journey',
  createdAt: '2026-07-20T00:00:00.000Z',
  latestActivityAt: '2026-07-20T12:00:00.000Z',
  revision: 4,
  purpose: 'immersiveJourney',
  startMode: 'guided',
  selectedArtifactId: 'turn-4',
  selectedTurnCount: 4,
  transcriptCount: 4,
  eventCount: 4,
  worldClock: { turn: 4, revision: 4 },
  canonical: false,
};

function latestDetail(): PlaySessionSelectedDetail {
  return createDetail({
    transcript: {
      items: [
        message('latest message 3', '2026-07-20T00:03:00.000Z'),
        message('latest message 4', '2026-07-20T00:04:00.000Z'),
      ],
      totalCount: 4,
      hasMoreBefore: true,
      nextCursor: 'transcript-before-latest',
    },
    events: {
      items: [
        event(3, 'Latest event 3'),
        event(4, 'Latest event 4'),
      ],
      totalCount: 4,
      hasMoreBefore: true,
      nextCursor: 'events-before-latest',
    },
  });
}

function earlierTranscriptDetail(): PlaySessionSelectedDetail {
  const current = latestDetail();
  return {
    ...current,
    transcript: {
      // Legacy v4 transcript entries may not have ids. Both must survive the
      // cursor prepend and remain in their stable historical order.
      items: [
        message('legacy message 1', '2026-07-20T00:01:00.000Z'),
        message('legacy message 2', '2026-07-20T00:02:00.000Z'),
      ],
      totalCount: 4,
      hasMoreBefore: false,
    },
  };
}

function earlierEventDetail(): PlaySessionSelectedDetail {
  const current = latestDetail();
  const items = [
    event(1, 'Earlier event 1'),
    event(2, 'Earlier event 2'),
  ];
  return {
    ...current,
    events: {
      items,
      totalCount: 4,
      hasMoreBefore: false,
    },
    eventPresentation: items.map(eventPresentation),
  };
}

function createDetail(
  windows: Pick<PlaySessionSelectedDetail, 'transcript' | 'events'>,
): PlaySessionSelectedDetail {
  const detail: PlaySessionSelectedDetail = {
    summary,
    snapshot: {
      schemaVersion: 4,
      id: summary.id,
      title: summary.title,
      createdAt: summary.createdAt,
      revision: summary.revision,
      sceneStart: 'Rain crosses the station roof.',
      characters: [],
      selectedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4'],
      branchSnapshotRequiredFromRevision: 0,
      metadataExtensions: {},
      playLocalState: {},
      playLocalStateVisibility: {},
      worldClock: summary.worldClock,
      eventPolicy: {
        simulationMode: 'reactiveWorld',
        density: 'balanced',
        allowOffscreen: true,
        allowHidden: true,
        maxExternalEventsPerTurn: 2,
      },
      scheduledEvents: [],
      suggestedActions: [],
      activatedSources: [],
      observations: [],
      adoptionCandidates: [],
    },
    ...windows,
    eventPresentation: windows.events.items.map(eventPresentation),
    selectedArtifactPresentation: {
      id: 'turn-4',
      revision: 4,
      eventIds: ['event-4'],
      stateDelta: {},
      playLocalStateVisibilitySnapshot: {},
      canonical: false,
    },
  };
  return detail;
}

function message(content: string, createdAt: string): PlayTranscriptTurn {
  return {
    speaker: 'world-referee',
    content,
    createdAt,
  };
}

function event(sequence: number, title: string): PlayWorldEvent {
  return {
    id: `event-${sequence}`,
    turnId: `turn-${sequence}`,
    sequence,
    kind: 'environmentChanged',
    origin: 'environment',
    title,
    summary: `${title} impact.`,
    visibility: 'playerVisible',
    cause: {
      reason: `${title} cause.`,
      pressureId: `pressure-${sequence}`,
    },
    worldClock: { turn: sequence, revision: sequence },
    createdAt: `2026-07-20T00:${String(sequence).padStart(2, '0')}:00.000Z`,
    canonical: false,
  };
}

function eventPresentation(event: PlayWorldEvent): PlayEventPresentationEvidence {
  return {
    eventId: event.id,
    causes: {
      actions: [],
      sourceEvents: [],
      pressure: { label: `${event.title.replace('event', 'pressure')}` },
    },
    stateImpacts: [],
    stateImpactOmittedCount: 0,
    author: {
      reason: event.cause.reason,
      technicalRefs: {
        artifactId: event.turnId,
        artifactRevision: event.worldClock.revision,
        turnId: event.turnId,
        sourceTurnIds: [],
        sourceEventIds: [],
        pressureId: event.cause.pressureId,
      },
      hiddenCauses: { actions: [], sourceEvents: [] },
      stateImpacts: [],
      stateImpactOmittedCount: 0,
    },
  };
}

function mountWorkspace() {
  const workspace: WorkspaceSummary = {
    name: 'alpha',
    novelName: 'Alpha',
    path: '/novels/alpha',
    valid: true,
  };
  return mount(PlayWorkspace, {
    attachTo: document.body,
    props: {
      workspace,
      providerConfigured: true,
      files: [],
      filesLoading: false,
    },
  });
}

function button(wrapper: VueWrapper, label: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
