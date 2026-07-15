import { isDeepStrictEqual } from 'node:util';

import { evaluatePlayDueEvents } from './play-event-schedule.js';
import type { PlayScheduledEvent } from './play-event-schedule.js';
import {
  PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION,
  PLAY_TURN_ARTIFACT_SCHEMA_VERSION,
} from './play-turn-artifact.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type {
  PlayWorldClock,
  PlayWorldEvent,
  PlayWorldRefereeSettlementEvent,
} from './play-types.js';

interface ValidatePlayScheduledEventHistoryInput {
  artifacts: PlayTurnArtifact[];
  artifactsById: Map<string, PlayTurnArtifact>;
  selectedTurnIds: string[];
  ledger: PlayScheduledEvent[];
  messageOwners: Map<string, string>;
  eventOwners: Map<string, string>;
  eventsById: Map<string, PlayWorldEvent>;
  currentRevision: number;
  currentWorldTurn: number;
  branchBaseSnapshot: {
    worldClock: PlayWorldClock;
    playLocalState: Record<string, unknown>;
    scheduledEvents: PlayScheduledEvent[];
  };
}

export function validatePlayScheduledEventHistory(
  input: ValidatePlayScheduledEventHistoryInput,
): PlayScheduledEvent[] {
  for (const artifact of input.artifacts) {
    if (!hasCompletePlayBranchSnapshot(artifact)) {
      continue;
    }
    const allowedArtifactIds = collectPlayArtifactAncestorIds(
      artifact,
      input.artifactsById,
    );
    const parent = artifact.parentTurnId
      ? input.artifactsById.get(artifact.parentTurnId)
      : undefined;
    const parentSnapshotComplete = Boolean(
      parent && hasCompletePlayBranchSnapshot(parent),
    );
    const previousSnapshots = parentSnapshotComplete
      ? parent!.scheduledEventSnapshots
      : input.branchBaseSnapshot.scheduledEvents;
    const predecessorWorldClock = parentSnapshotComplete
      ? parent!.worldClock!
      : input.branchBaseSnapshot.worldClock;
    const predecessorPlayLocalState = parentSnapshotComplete
      ? parent!.playLocalStateSnapshot!
      : input.branchBaseSnapshot.playLocalState;
    const previousById = new Map(
      previousSnapshots.map((event) => [event.id, event]),
    );
    const currentById = new Map(
      artifact.scheduledEventSnapshots.map((event) => [event.id, event]),
    );
    if (
      artifact.artifactKind === 'transcriptAppend' &&
      !arePlayScheduledEventListsEqual(
        artifact.scheduledEventSnapshots,
        previousSnapshots,
      )
    ) {
      throw new Error(
        `Play turn artifact ${artifact.id} transcript append changes the schedule head.`,
      );
    }
    assertPlayArtifactDueScheduleEvidence({
      artifact,
      previousSnapshots,
      currentSnapshots: artifact.scheduledEventSnapshots,
      predecessorWorldClock,
      predecessorPlayLocalState,
    });

    for (const previous of previousSnapshots) {
      if (!currentById.has(previous.id)) {
        throw new Error(
          `Play turn artifact ${artifact.id} removes scheduled event ${previous.id}.`,
        );
      }
    }

    for (const scheduledEvent of artifact.scheduledEventSnapshots) {
      assertPlayScheduledEventEvidence({
        artifact,
        scheduledEvent,
        allowedArtifactIds,
        artifactsById: input.artifactsById,
        messageOwners: input.messageOwners,
        eventOwners: input.eventOwners,
        eventsById: input.eventsById,
      });
      assertPlayScheduledEventTransition(
        artifact,
        true,
        previousById.get(scheduledEvent.id),
        scheduledEvent,
      );
    }
  }

  for (const event of input.eventsById.values()) {
    const triggerId = event.cause.triggerId;
    if (!triggerId) {
      continue;
    }
    const ownerId = input.eventOwners.get(event.id);
    const owner = ownerId ? input.artifactsById.get(ownerId) : undefined;
    const scheduledEvent = owner?.scheduledEventSnapshots.find(
      (candidate) => candidate.id === triggerId,
    );
    if (
      !scheduledEvent ||
      scheduledEvent.status !== 'occurred' ||
      !scheduledEvent.occurredEventIds?.includes(event.id)
    ) {
      throw new Error(
        `Play event ${event.id} is not recorded by scheduled event ${triggerId} on its branch.`,
      );
    }
  }

  const selectedHeadId = input.selectedTurnIds.at(-1);
  const selectedHead = selectedHeadId
    ? input.artifactsById.get(selectedHeadId)
    : undefined;
  let selectedScheduledEvents: PlayScheduledEvent[];
  if (selectedHead && hasCompletePlayBranchSnapshot(selectedHead)) {
    selectedScheduledEvents = selectedHead.scheduledEventSnapshots;
  } else {
    selectedScheduledEvents = input.branchBaseSnapshot.scheduledEvents;
  }

  if (!arePlayScheduledEventListsEqual(input.ledger, selectedScheduledEvents)) {
    throw new Error(
      'Play event-schedule ledger does not match the selected turn artifact head.',
    );
  }

  for (const scheduledEvent of selectedScheduledEvents) {
    if (
      scheduledEvent.scheduledAtRevision > input.currentRevision ||
      scheduledEvent.scheduledAtTurn > input.currentWorldTurn
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} is ahead of the selected session clock.`,
      );
    }
  }

  return selectedScheduledEvents.map(clonePlayScheduledEvent);
}

function assertPlayScheduledEventEvidence(input: {
  artifact: PlayTurnArtifact;
  scheduledEvent: PlayScheduledEvent;
  allowedArtifactIds: Set<string>;
  artifactsById: Map<string, PlayTurnArtifact>;
  messageOwners: Map<string, string>;
  eventOwners: Map<string, string>;
  eventsById: Map<string, PlayWorldEvent>;
}): void {
  const {
    artifact,
    scheduledEvent,
    allowedArtifactIds,
    artifactsById,
    messageOwners,
    eventOwners,
    eventsById,
  } = input;

  if (scheduledEvent.scheduledAtRevision > artifact.revision) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} has a future scheduledAtRevision in artifact ${artifact.id}.`,
    );
  }
  if (
    artifact.worldClock &&
    scheduledEvent.scheduledAtTurn > artifact.worldClock.turn
  ) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} has a future scheduledAtTurn in artifact ${artifact.id}.`,
    );
  }

  if (scheduledEvent.sourceTurnId) {
    const sourceOwnerId = messageOwners.get(scheduledEvent.sourceTurnId);
    const sourceOwner = sourceOwnerId
      ? artifactsById.get(sourceOwnerId)
      : undefined;
    const sourceMessage = sourceOwner?.messages.find(
      (message) => message.id === scheduledEvent.sourceTurnId,
    );
    if (
      !sourceOwnerId ||
      !sourceOwner ||
      sourceOwner.artifactKind !== 'worldSettlement' ||
      sourceMessage?.speaker !== 'world-referee' ||
      sourceOwner.messages[1]?.id !== scheduledEvent.sourceTurnId ||
      !allowedArtifactIds.has(sourceOwnerId)
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} references an out-of-branch source turn.`,
      );
    }
    if (
      scheduledEvent.scheduledAtRevision !== sourceOwner.revision ||
      !sourceOwner.worldClock ||
      scheduledEvent.scheduledAtTurn !== sourceOwner.worldClock.turn
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} scheduling evidence does not match its source artifact.`,
      );
    }
    if (!scheduledEvent.changeReason) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} requires changeReason for a turn-owned change.`,
      );
    }
  }

  if (!scheduledEvent.resolvedAtTurnId) {
    return;
  }

  const resolutionOwnerId = messageOwners.get(scheduledEvent.resolvedAtTurnId);
  const resolutionOwner = resolutionOwnerId
    ? artifactsById.get(resolutionOwnerId)
    : undefined;
  const resolutionMessage = resolutionOwner?.messages.find(
    (message) => message.id === scheduledEvent.resolvedAtTurnId,
  );
  if (
    !resolutionOwnerId ||
    resolutionOwner?.artifactKind !== 'worldSettlement' ||
    resolutionMessage?.speaker !== 'world-referee' ||
    resolutionOwner?.messages[1]?.id !== scheduledEvent.resolvedAtTurnId ||
    !allowedArtifactIds.has(resolutionOwnerId)
  ) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} references an out-of-branch resolution turn.`,
    );
  }

  if (
    scheduledEvent.status === 'occurred' &&
    scheduledEvent.occurredEventIds?.length !== 1
  ) {
    throw new Error(
      `Play scheduled event ${scheduledEvent.id} must resolve to exactly one occurred event.`,
    );
  }

  for (const eventId of scheduledEvent.occurredEventIds ?? []) {
    const event = eventsById.get(eventId);
    if (
      !event ||
      eventOwners.get(eventId) !== resolutionOwnerId ||
      event.turnId !== scheduledEvent.resolvedAtTurnId ||
      event.cause.triggerId !== scheduledEvent.id
    ) {
      throw new Error(
        `Play scheduled event ${scheduledEvent.id} references invalid branch-owned occurred event ${eventId}.`,
      );
    }
    assertDueEventMatchesTemplate(event, scheduledEvent);
  }
}

function assertPlayArtifactDueScheduleEvidence(input: {
  artifact: PlayTurnArtifact;
  previousSnapshots: PlayScheduledEvent[];
  currentSnapshots: PlayScheduledEvent[];
  predecessorWorldClock: PlayWorldClock;
  predecessorPlayLocalState: Record<string, unknown>;
}): void {
  const {
    artifact,
    previousSnapshots,
    currentSnapshots,
    predecessorWorldClock,
    predecessorPlayLocalState,
  } = input;
  const eligibleIds = new Set(previousSnapshots.map((event) => event.id));
  if (artifact.dueScheduledEventIds.some((id) => !eligibleIds.has(id))) {
    throw new Error(
      `Play turn artifact ${artifact.id} contains invalid hard-due schedule evidence.`,
    );
  }

  const expectedDueIds = artifact.artifactKind === 'worldSettlement'
    ? evaluatePlayDueEvents({
      scheduledEvents: previousSnapshots,
      currentTurn: predecessorWorldClock.turn,
      nextTurn: artifact.worldClock!.turn,
      playLocalState: predecessorPlayLocalState,
      ...(predecessorWorldClock.anchor
        ? { currentWorldTime: predecessorWorldClock.anchor }
        : {}),
    }).dueEvents.map((event) => event.id)
    : [];
  if (!isDeepStrictEqual(artifact.dueScheduledEventIds, expectedDueIds)) {
    throw new Error(
      `Play turn artifact ${artifact.id} hard-due evidence does not match its predecessor snapshot.`,
    );
  }

  for (const dueId of artifact.dueScheduledEventIds) {
    if (currentSnapshots.find((event) => event.id === dueId)?.status !== 'occurred') {
      throw new Error(
        `Play scheduled event ${dueId} was hard-due and did not occur in artifact ${artifact.id}.`,
      );
    }
  }
}

function assertPlayScheduledEventTransition(
  artifact: PlayTurnArtifact,
  parentSnapshotComplete: boolean,
  previous: PlayScheduledEvent | undefined,
  current: PlayScheduledEvent,
): void {
  if (!previous) {
    if (!current.sourceTurnId) {
      const resolvesSeedInThisArtifact =
        current.status !== 'scheduled' &&
        Boolean(current.resolvedAtTurnId) &&
        artifact.messages.some((message) => message.id === current.resolvedAtTurnId);
      if (
        parentSnapshotComplete ||
        current.scheduledAtRevision >= artifact.revision ||
        (current.status !== 'scheduled' && !resolvesSeedInThisArtifact)
      ) {
        throw new Error(
          `Play scheduled event ${current.id} has invalid seed evidence in artifact ${artifact.id}.`,
        );
      }
      if (current.status !== 'scheduled') {
        assertScheduledEventResolutionMatchesDueEvidence(artifact, current);
      } else if (artifact.dueScheduledEventIds.includes(current.id)) {
        throw new Error(
          `Play scheduled event ${current.id} was hard-due and cannot remain scheduled.`,
        );
      }
      return;
    }
    if (
      current.status !== 'scheduled' ||
      !artifact.messages.some((message) => message.id === current.sourceTurnId)
    ) {
      throw new Error(
        `Play scheduled event ${current.id} has an invalid creation transition in artifact ${artifact.id}.`,
      );
    }
    return;
  }

  if (previous.status !== 'scheduled') {
    if (arePlayScheduledEventsEqual(previous, current)) {
      return;
    }
    throw new Error(
      `Play scheduled event ${current.id} changes after reaching ${previous.status}.`,
    );
  }

  const wasDue = artifact.dueScheduledEventIds.includes(previous.id);
  if (wasDue && current.status !== 'occurred') {
    throw new Error(
      `Play scheduled event ${current.id} was hard-due and cannot be ${current.status}.`,
    );
  }
  if (!wasDue && current.status === 'occurred') {
    throw new Error(
      `Play scheduled event ${current.id} occurred before its trigger was due.`,
    );
  }
  if (arePlayScheduledEventsEqual(previous, current)) {
    if (wasDue) {
      throw new Error(
        `Play scheduled event ${current.id} was hard-due and cannot remain scheduled.`,
      );
    }
    return;
  }

  if (current.status === 'scheduled') {
    if (
      previous.id !== current.id ||
      previous.label !== current.label ||
      JSON.stringify(previous.template) !== JSON.stringify(current.template) ||
      !current.sourceTurnId ||
      !artifact.messages.some((message) => message.id === current.sourceTurnId) ||
      current.scheduledAtRevision !== artifact.revision ||
      !artifact.worldClock ||
      current.scheduledAtTurn !== artifact.worldClock.turn
    ) {
      throw new Error(
        `Play scheduled event ${current.id} has an invalid reschedule transition in artifact ${artifact.id}.`,
      );
    }
    return;
  }

  if (
    !hasSamePlayScheduledEventPlan(previous, current) ||
    !current.resolvedAtTurnId ||
    !artifact.messages.some((message) => message.id === current.resolvedAtTurnId)
  ) {
    throw new Error(
      `Play scheduled event ${current.id} has an invalid ${current.status} transition in artifact ${artifact.id}.`,
    );
  }
}

function assertScheduledEventResolutionMatchesDueEvidence(
  artifact: PlayTurnArtifact,
  current: PlayScheduledEvent,
): void {
  const wasDue = artifact.dueScheduledEventIds.includes(current.id);
  if (current.status === 'occurred' && !wasDue) {
    throw new Error(
      `Play scheduled event ${current.id} occurred before its trigger was due.`,
    );
  }
  if (current.status === 'cancelled' && wasDue) {
    throw new Error(
      `Play scheduled event ${current.id} was hard-due and cannot be cancelled.`,
    );
  }
}

export function hasCompletePlayBranchSnapshot(artifact: PlayTurnArtifact): boolean {
  return artifact.schemaVersion === PLAY_TURN_ARTIFACT_SCHEMA_VERSION ||
    artifact.schemaVersion === PLAY_REHEARSAL_TURN_ARTIFACT_SCHEMA_VERSION;
}

export function collectPlayArtifactAncestorIds(
  artifact: PlayTurnArtifact,
  artifactsById: Map<string, PlayTurnArtifact>,
): Set<string> {
  const ids = new Set<string>();
  let current: PlayTurnArtifact | undefined = artifact;
  while (current) {
    ids.add(current.id);
    current = current.parentTurnId
      ? artifactsById.get(current.parentTurnId)
      : undefined;
  }
  return ids;
}

function hasSamePlayScheduledEventPlan(
  left: PlayScheduledEvent,
  right: PlayScheduledEvent,
): boolean {
  return left.id === right.id &&
    left.label === right.label &&
    JSON.stringify(left.trigger) === JSON.stringify(right.trigger) &&
    JSON.stringify(left.template) === JSON.stringify(right.template) &&
    left.scheduledAtTurn === right.scheduledAtTurn &&
    left.scheduledAtRevision === right.scheduledAtRevision &&
    left.sourceTurnId === right.sourceTurnId &&
    left.changeReason === right.changeReason &&
    left.priority === right.priority;
}

function arePlayScheduledEventsEqual(
  left: PlayScheduledEvent,
  right: PlayScheduledEvent,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function arePlayScheduledEventListsEqual(
  left: readonly PlayScheduledEvent[],
  right: readonly PlayScheduledEvent[],
): boolean {
  return left.length === right.length && left.every((event, index) =>
    arePlayScheduledEventsEqual(event, right[index]!));
}

export function clonePlayScheduledEvent(
  event: PlayScheduledEvent,
): PlayScheduledEvent {
  return {
    ...event,
    trigger: { ...event.trigger },
    template: { ...event.template },
    ...(event.occurredEventIds
      ? { occurredEventIds: [...event.occurredEventIds] }
      : {}),
  };
}

export function assertDueEventMatchesTemplate(
  event: PlayWorldRefereeSettlementEvent,
  scheduledEvent: PlayScheduledEvent,
): void {
  const template = scheduledEvent.template;
  if (
    event.kind !== template.kind ||
    event.origin !== template.origin ||
    event.title !== template.title ||
    event.visibility !== template.visibility
  ) {
    throw new Error(
      `Play hard-due event does not match its host template: ${scheduledEvent.id}.`,
    );
  }
}
