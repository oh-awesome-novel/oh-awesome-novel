import type {
  PlayEventVisibility,
  PlayScheduledEvent,
  PlaySession,
  PlayTranscriptTurn,
  PlayTurnArtifact,
  PlayWorldClock,
} from './useWorkspaceApi';

export interface PlayRetryBeforeTurnProjection {
  sourceArtifactId: string;
  parentArtifactId?: string;
  selectedTurnIds: string[];
  transcript: PlayTranscriptTurn[];
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
}

/**
 * Rebuilds only a view of the state immediately before an artifact. The
 * authoritative session stays untouched until the atomic Retry stream commits.
 */
export function projectPlaySessionBeforeArtifact(
  session: PlaySession,
  sourceArtifactId: string,
): PlayRetryBeforeTurnProjection | undefined {
  const artifactsById = new Map(
    session.turnArtifacts.map((artifact) => [artifact.id, artifact]),
  );
  const source = artifactsById.get(sourceArtifactId);
  if (
    !source?.input ||
    source.schemaVersion !== 2 ||
    source.artifactKind !== 'worldSettlement' ||
    !snapshotFromArtifact(source)
  ) {
    return undefined;
  }

  const parentPath = collectParentPath(source, artifactsById);
  if (!parentPath) {
    return undefined;
  }

  const parent = parentPath[parentPath.length - 1];
  const snapshot = parent
    ? snapshotFromArtifact(parent) ?? (
        parent.id === session.branchBaseSnapshot.parentTurnId
          ? session.branchBaseSnapshot
          : undefined
      )
    : session.branchBaseSnapshot.parentTurnId === undefined
      ? session.branchBaseSnapshot
      : undefined;
  if (!snapshot) {
    return undefined;
  }

  return {
    sourceArtifactId,
    parentArtifactId: source.parentTurnId,
    selectedTurnIds: parentPath.map((artifact) => artifact.id),
    transcript: parentPath.flatMap((artifact) => artifact.messages),
    playLocalState: snapshot.playLocalState,
    playLocalStateVisibility: snapshot.playLocalStateVisibility,
    worldClock: snapshot.worldClock,
    scheduledEvents: snapshot.scheduledEvents,
    suggestedActions: snapshot.suggestedActions,
  };
}

function collectParentPath(
  source: PlayTurnArtifact,
  artifactsById: ReadonlyMap<string, PlayTurnArtifact>,
): PlayTurnArtifact[] | undefined {
  const reversed: PlayTurnArtifact[] = [];
  const visited = new Set([source.id]);
  let parentId = source.parentTurnId;

  while (parentId) {
    if (visited.has(parentId)) {
      return undefined;
    }
    visited.add(parentId);
    const parent = artifactsById.get(parentId);
    if (!parent) {
      return undefined;
    }
    reversed.push(parent);
    parentId = parent.parentTurnId;
  }

  return reversed.reverse();
}

function snapshotFromArtifact(artifact: PlayTurnArtifact): {
  playLocalState: Record<string, unknown>;
  playLocalStateVisibility: Record<string, PlayEventVisibility>;
  worldClock: PlayWorldClock;
  scheduledEvents: PlayScheduledEvent[];
  suggestedActions: string[];
} | undefined {
  if (
    !artifact.worldClock ||
    !artifact.playLocalStateSnapshot ||
    !artifact.playLocalStateVisibilitySnapshot
  ) {
    return undefined;
  }

  return {
    playLocalState: artifact.playLocalStateSnapshot,
    playLocalStateVisibility: artifact.playLocalStateVisibilitySnapshot,
    worldClock: artifact.worldClock,
    scheduledEvents: artifact.scheduledEventSnapshots,
    suggestedActions: artifact.suggestedActions,
  };
}
