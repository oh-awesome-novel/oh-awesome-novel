import { materializePlayTurnFacts } from './play-session-facts.js';
import type { PlaySession } from './play-session.js';
import type {
  PlayEventVisibility,
  PlayPressure,
  PlayPressureStatus,
  PlayWorldEvent,
} from './play-types.js';
import { readPlayWorldMomentum } from './play-world-momentum.js';

/** Stands for the author's own character; renderers supply the display label. */
export const PLAY_RELATIONSHIP_PROTAGONIST = '@protagonist' as const;

export type PlayRelationshipLens = 'player' | 'director';

export interface PlayRelationshipEntry {
  id: string;
  source: 'event' | 'pressure';
  /** World turn the change belongs to; 0 is the opening state. */
  turn: number;
  revision: number;
  /** Selected-branch turn artifact to jump to. Absent for the opening state. */
  artifactId?: string;
  /** Event card to jump to. A pressure entry links the event that advanced it. */
  eventId?: string;
  pressureId?: string;
  title: string;
  summary: string;
  visibility: PlayEventVisibility;
  /** Qualitative pressure movement only; never a numeric meter. */
  pressureStatus?: { from?: PlayPressureStatus; to: PlayPressureStatus };
  /** Referee-side cause. Present in the Director lens only. */
  reason?: string;
}

export interface PlayRelationshipThread {
  key: string;
  /** Names in order of first mention; empty when the text names nobody known. */
  participants: string[];
  entries: PlayRelationshipEntry[];
}

export interface PlayRelationshipTimeline {
  sessionId: string;
  revision: number;
  selectedHead?: string;
  lens: PlayRelationshipLens;
  threads: PlayRelationshipThread[];
  canonical: false;
}

/**
 * A rebuildable projection of how relationships moved on the selected branch.
 * It reads only `relationshipChanged` events and `relationship` pressures along
 * the selected root-to-head path, stores nothing, and adds no affinity score.
 * The Player lens drops playerUnknown events and pressures and every cause
 * reason, exactly as the event feed does.
 */
export function projectPlayRelationshipTimeline(
  session: PlaySession,
  lens: PlayRelationshipLens,
): PlayRelationshipTimeline {
  const facts = materializePlayTurnFacts(session);
  const director = lens === 'director';
  const visible = (visibility: PlayEventVisibility): boolean =>
    director || visibility !== 'playerUnknown';
  const names = collectKnownNames(session);
  const eventsById = new Map(session.events.map((event) => [event.id, event]));
  const artifactsById = new Map(
    facts.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const threads = new Map<string, PlayRelationshipThread>();
  const push = (text: string, entry: PlayRelationshipEntry): void => {
    const participants = resolveParticipants(text, names);
    const key = participants.length
      ? [...participants].toSorted().join('\u0000')
      : '';
    const thread = threads.get(key) ?? { key, participants, entries: [] };
    thread.entries.push(entry);
    threads.set(key, thread);
  };

  let previousPressures = relationshipPressures(
    facts.branchBaseSnapshot.playLocalState,
  );
  for (const pressure of previousPressures.values()) {
    if (!visible(pressure.visibility)) continue;
    push(pressure.label, {
      id: `pressure:${pressure.id}:opening`,
      source: 'pressure',
      turn: facts.branchBaseSnapshot.worldClock.turn,
      revision: facts.branchBaseSnapshot.worldClock.revision,
      pressureId: pressure.id,
      title: pressure.label,
      summary: pressure.nextConsequence ?? '',
      visibility: pressure.visibility,
      pressureStatus: { to: pressure.status },
    });
  }

  for (const artifactId of facts.selectedTurnIds) {
    const artifact = artifactsById.get(artifactId);
    if (!artifact) continue;
    const turn = artifact.worldClock?.turn ?? 0;
    const artifactEvents = artifact.eventIds
      .map((eventId) => eventsById.get(eventId))
      .filter((event): event is PlayWorldEvent => event !== undefined)
      .toSorted((left, right) => left.sequence - right.sequence);

    for (const event of artifactEvents) {
      if (event.kind !== 'relationshipChanged' || !visible(event.visibility)) continue;
      push(`${event.title}\n${event.summary}`, {
        id: `event:${event.id}`,
        source: 'event',
        turn,
        revision: artifact.revision,
        artifactId: artifact.id,
        eventId: event.id,
        ...(event.cause.pressureId ? { pressureId: event.cause.pressureId } : {}),
        title: event.title,
        summary: event.summary,
        visibility: event.visibility,
        ...(director ? { reason: event.cause.reason } : {}),
      });
    }

    if (!artifact.playLocalStateSnapshot) continue;
    const currentPressures = relationshipPressures(artifact.playLocalStateSnapshot);
    for (const pressure of currentPressures.values()) {
      const before = previousPressures.get(pressure.id);
      if (
        !visible(pressure.visibility) ||
        (before?.status === pressure.status &&
          before.nextConsequence === pressure.nextConsequence)
      ) continue;
      const linkedEvent = artifactEvents.find((event) =>
        event.cause.pressureId === pressure.id && visible(event.visibility));
      // A relationshipChanged event citing this pressure already tells the change.
      if (linkedEvent?.kind === 'relationshipChanged') continue;
      push(pressure.label, {
        id: `pressure:${pressure.id}:${artifact.id}`,
        source: 'pressure',
        turn,
        revision: artifact.revision,
        artifactId: artifact.id,
        ...(linkedEvent ? { eventId: linkedEvent.id } : {}),
        pressureId: pressure.id,
        title: pressure.label,
        summary: pressure.nextConsequence ?? '',
        visibility: pressure.visibility,
        pressureStatus: {
          ...(before ? { from: before.status } : {}),
          to: pressure.status,
        },
      });
    }
    previousPressures = currentPressures;
  }

  const selectedHead = facts.selectedTurnIds.at(-1);
  return {
    sessionId: session.id,
    revision: session.revision,
    ...(selectedHead ? { selectedHead } : {}),
    lens,
    threads: [...threads.values()],
    canonical: false,
  };
}

function relationshipPressures(
  playLocalState: Readonly<Record<string, unknown>>,
): Map<string, PlayPressure> {
  return new Map(readPlayWorldMomentum(playLocalState).pressures
    .filter((pressure) => pressure.kind === 'relationship')
    .map((pressure) => [pressure.id, pressure]));
}

function collectKnownNames(session: PlaySession): string[] {
  const roster = session.metadataExtensions.characterRoster;
  const rosterNames = Array.isArray(roster)
    ? roster.flatMap((entry) =>
        entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
          ? [(entry as { name: string }).name]
          : [])
    : [];
  const names = [
    ...session.characters,
    ...rosterNames,
    ...(session.sceneRehearsal?.participants.map((participant) =>
      participant.displayName) ?? []),
  ].map((name) => name.trim()).filter(Boolean);
  // Longer names first, so "林晚晴" is not also counted as "林晚".
  return [...new Set(names)].toSorted((left, right) => right.length - left.length);
}

/**
 * Names the people a change is about from its own text. One known name means a
 * change towards the author's character; none leaves the thread unattributed
 * rather than guessing.
 */
function resolveParticipants(text: string, names: readonly string[]): string[] {
  let remaining = text.toLocaleLowerCase();
  const found: Array<{ name: string; index: number }> = [];
  for (const name of names) {
    const needle = name.toLocaleLowerCase();
    const index = remaining.indexOf(needle);
    if (index < 0) continue;
    found.push({ name, index });
    remaining = remaining.replaceAll(needle, ' '.repeat(needle.length));
  }
  const ordered = found
    .toSorted((left, right) => left.index - right.index)
    .map((item) => item.name);
  return ordered.length === 1
    ? [ordered[0]!, PLAY_RELATIONSHIP_PROTAGONIST]
    : ordered;
}
