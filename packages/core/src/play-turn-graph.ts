import {
  clonePlayScheduledEvent,
  hasCompletePlayBranchSnapshot,
} from './play-event-schedule-history.js';
import {
  materializePlayTurnFacts,
  resolvePlaySessionRevision,
} from './play-session-facts.js';
import {
  assertSafePlayTurnArtifactId,
  projectPlayTranscript,
} from './play-turn-artifact.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type { PlaySession } from './play-session.js';

export type PlayCheckpointStatus =
  | 'current'
  | 'selectedAncestor'
  | 'variant';

export interface PlayCheckpointSummary {
  artifactId: string;
  parentArtifactId?: string;
  selectedTurnIds: string[];
  revision: number;
  worldTurn: number;
  committedAt: string;
  preview: string;
  status: PlayCheckpointStatus;
  restorable: boolean;
  canonical: false;
}

/**
 * Lists the implicit checkpoints already carried by the immutable turn graph.
 * No parallel checkpoint state is created: complete v2 branch snapshots and the
 * legacy branch-base head are the only restorable facts.
 */
export function listPlaySessionCheckpoints(
  session: PlaySession,
): PlayCheckpointSummary[] {
  const facts = materializePlayTurnFacts(session);
  const artifactsById = indexPlayTurnArtifacts(facts.turnArtifacts);
  const selectedArtifactIds = new Set(facts.selectedTurnIds);
  const currentArtifactId = facts.selectedTurnIds.at(-1);

  return facts.turnArtifacts
    .map((artifact) => {
      const status: PlayCheckpointStatus = artifact.id === currentArtifactId
        ? 'current'
        : selectedArtifactIds.has(artifact.id)
          ? 'selectedAncestor'
          : 'variant';
      const branchBaseHead = isPlayBranchBaseHead(
        artifact,
        facts.branchBaseSnapshot.parentTurnId,
      );
      const completeSnapshot = hasCompletePlayBranchSnapshot(artifact);
      const selectedTurnIds = resolvePlayTurnPath(
        artifact.id,
        artifactsById,
      );
      const worldTurn = completeSnapshot
        ? artifact.worldClock!.turn
        : branchBaseHead
          ? facts.branchBaseSnapshot.worldClock.turn
          : 0;

      return {
        artifactId: artifact.id,
        ...(artifact.parentTurnId
          ? { parentArtifactId: artifact.parentTurnId }
          : {}),
        selectedTurnIds,
        revision: artifact.revision,
        worldTurn,
        committedAt: artifact.committedAt,
        preview: formatPlayCheckpointPreview(artifact),
        status,
        restorable: status !== 'current' && (completeSnapshot || branchBaseHead),
        canonical: false,
      };
    })
    .toSorted((left, right) =>
      left.revision - right.revision ||
      left.committedAt.localeCompare(right.committedAt) ||
      left.artifactId.localeCompare(right.artifactId),
    );
}

/**
 * Restores the selected projection to an implicit turn checkpoint while
 * retaining every historical artifact and ledger fact. Restoring is a new
 * Play-local mutation, so the session revision advances monotonically even
 * though the selected world clock and projections move to an older branch.
 */
export function restorePlaySessionCheckpoint(
  session: PlaySession,
  artifactId: string,
): PlaySession {
  const safeArtifactId = assertSafePlayTurnArtifactId(artifactId);
  const facts = materializePlayTurnFacts(session);
  const artifactsById = indexPlayTurnArtifacts(facts.turnArtifacts);
  const artifact = artifactsById.get(safeArtifactId);
  if (!artifact) {
    throw new Error(`Play checkpoint references an unknown artifact: ${safeArtifactId}.`);
  }
  if (facts.selectedTurnIds.at(-1) === safeArtifactId) {
    throw new Error(`Play checkpoint is already current: ${safeArtifactId}.`);
  }

  const completeSnapshot = hasCompletePlayBranchSnapshot(artifact);
  const branchBaseHead = isPlayBranchBaseHead(
    artifact,
    facts.branchBaseSnapshot.parentTurnId,
  );
  if (!completeSnapshot && !branchBaseHead) {
    throw new Error(
      `Play checkpoint artifact ${safeArtifactId} has no restorable branch snapshot.`,
    );
  }

  const selectedTurnIds = resolvePlayTurnPath(safeArtifactId, artifactsById);
  const snapshot = completeSnapshot
    ? {
        worldClock: artifact.worldClock!,
        playLocalState: artifact.playLocalStateSnapshot!,
        playLocalStateVisibility: artifact.playLocalStateVisibilitySnapshot!,
        scheduledEvents: artifact.scheduledEventSnapshots,
        suggestedActions: artifact.suggestedActions,
      }
    : facts.branchBaseSnapshot;
  const revision = resolvePlaySessionRevision(session, facts.turnArtifacts) + 1;
  const restored: PlaySession = {
    ...session,
    revision,
    transcript: projectPlayTranscript(facts.turnArtifacts, selectedTurnIds),
    turnArtifacts: facts.turnArtifacts,
    selectedTurnIds,
    branchBaseSnapshot: facts.branchBaseSnapshot,
    metadataExtensions: { ...(session.metadataExtensions ?? {}) },
    playLocalState: structuredClone(snapshot.playLocalState),
    playLocalStateVisibility: {
      ...snapshot.playLocalStateVisibility,
    },
    worldClock: {
      ...snapshot.worldClock,
      revision,
    },
    scheduledEvents: snapshot.scheduledEvents.map(clonePlayScheduledEvent),
    suggestedActions: [...snapshot.suggestedActions],
  };

  // Validate the restored projection as a complete session before exposing it.
  const restoredFacts = materializePlayTurnFacts(restored);
  return {
    ...restored,
    transcript: restoredFacts.transcript,
    turnArtifacts: restoredFacts.turnArtifacts,
    selectedTurnIds: restoredFacts.selectedTurnIds,
    branchBaseSnapshot: restoredFacts.branchBaseSnapshot,
    playLocalState: restoredFacts.selectedPlayLocalState,
    playLocalStateVisibility:
      restoredFacts.selectedPlayLocalStateVisibility,
    scheduledEvents: restoredFacts.selectedScheduledEvents,
    suggestedActions: restoredFacts.selectedSuggestedActions,
  };
}

function indexPlayTurnArtifacts(
  artifacts: PlayTurnArtifact[],
): Map<string, PlayTurnArtifact> {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]));
}

function resolvePlayTurnPath(
  artifactId: string,
  artifactsById: Map<string, PlayTurnArtifact>,
): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let artifact = artifactsById.get(artifactId);

  while (artifact) {
    if (visited.has(artifact.id)) {
      throw new Error(`Play turn artifact graph contains a cycle at: ${artifact.id}.`);
    }
    visited.add(artifact.id);
    path.push(artifact.id);
    artifact = artifact.parentTurnId
      ? artifactsById.get(artifact.parentTurnId)
      : undefined;
  }

  return path.reverse();
}

function isPlayBranchBaseHead(
  artifact: PlayTurnArtifact,
  branchBaseParentTurnId?: string,
): boolean {
  return artifact.id === branchBaseParentTurnId;
}

function formatPlayCheckpointPreview(artifact: PlayTurnArtifact): string {
  // A checkpoint list is player-visible by default. Only the user's own input
  // is safe to summarize here; referee or narrator output can contain hidden
  // world facts and must stay behind the normal visibility projections.
  const content = artifact.input?.raw.trim().replace(/\s+/gu, ' ') ?? '';
  if (!content) {
    return artifact.id;
  }
  return content.length > 160 ? `${content.slice(0, 157)}...` : content;
}
