import type {
  PlayCursorWindow,
  PlaySessionSummary,
} from '@oh-awesome-novel/client';

export type PlayJourneySummaryFixture = PlaySessionSummary;

export interface PlayJourneyItemFixture {
  id: string;
  label: string;
}

export type PlayJourneyWindowFixture<T> = PlayCursorWindow<T>;

export interface PlayLongJourneyFixture {
  summary: PlayJourneySummaryFixture;
  transcript: PlayJourneyWindowFixture<PlayJourneyItemFixture>;
  events: PlayJourneyWindowFixture<PlayJourneyItemFixture>;
}

export interface CreatePlayLongJourneyFixtureOptions {
  transcriptCount?: number;
  eventCount?: number;
  windowSize?: number;
}

export function createPlayLongJourneyFixture(
  options: CreatePlayLongJourneyFixtureOptions = {},
): PlayLongJourneyFixture {
  const transcriptCount = options.transcriptCount ?? 120;
  const eventCount = options.eventCount ?? 72;
  const windowSize = options.windowSize ?? 12;

  return {
    summary: {
      schemaVersion: 5,
      id: 'play-long-journey',
      title: 'Long-running station rehearsal',
      createdAt: '2026-07-20T00:00:00.000Z',
      latestActivityAt: '2026-07-20T12:00:00.000Z',
      revision: 42,
      purpose: 'sceneRehearsal',
      startMode: 'guided',
      selectedArtifactId: 'turn-42',
      selectedTurnCount: 42,
      transcriptCount,
      eventCount,
      worldClock: { turn: 42, revision: 42 },
      canonical: false,
    },
    transcript: createTailWindow('message', transcriptCount, windowSize),
    events: createTailWindow('event', eventCount, windowSize),
  };
}

function createTailWindow(
  kind: 'message' | 'event',
  totalCount: number,
  windowSize: number,
): PlayJourneyWindowFixture<PlayJourneyItemFixture> {
  const firstIndex = Math.max(1, totalCount - windowSize + 1);
  const items = Array.from(
    { length: Math.max(0, totalCount - firstIndex + 1) },
    (_, offset) => {
      const index = firstIndex + offset;
      return {
        id: `${kind}-${index}`,
        label: `${kind} ${index}`,
      };
    },
  );
  const hasMoreBefore = firstIndex > 1;

  return {
    items,
    totalCount,
    hasMoreBefore,
    ...(hasMoreBefore ? { nextCursor: `${kind}:${firstIndex}` } : {}),
  };
}
