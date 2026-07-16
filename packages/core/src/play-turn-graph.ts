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

export type PlayCheckpointKind = 'initialWorld' | 'turn';

export const PLAY_INITIAL_WORLD_CHECKPOINT_ID = 'initial-world' as const;
export const PLAY_CHECKPOINT_NAMES_METADATA_KEY = 'playCheckpointNames' as const;

const MAX_PLAY_CHECKPOINT_NAME_LENGTH = 80;

export interface PlayCheckpointSummary {
  checkpointId: string;
  kind: PlayCheckpointKind;
  artifactId?: string;
  parentCheckpointId?: string;
  selectedTurnIds: string[];
  depth: number;
  revision: number;
  worldTurn: number;
  committedAt: string;
  preview: string;
  name?: string;
  status: PlayCheckpointStatus;
  restorable: boolean;
  retryable: boolean;
  canonical: false;
}

/**
 * Lists checkpoints already carried by the immutable turn graph and its
 * branch-base snapshot. No parallel checkpoint state is created: the virtual
 * initial world, complete v2 branch snapshots, and the legacy branch-base head
 * are the only restorable facts.
 */
export function listPlaySessionCheckpoints(
  session: PlaySession,
): PlayCheckpointSummary[] {
  const facts = materializePlayTurnFacts(session);
  const artifactsById = indexPlayTurnArtifacts(facts.turnArtifacts);
  const selectedArtifactIds = new Set(facts.selectedTurnIds);
  const currentArtifactId = facts.selectedTurnIds.at(-1);
  const hasInitialWorldCheckpoint =
    facts.branchBaseSnapshot.parentTurnId === undefined;
  const checkpointNames = readPlayCheckpointNames(
    session,
    facts.turnArtifacts,
    hasInitialWorldCheckpoint,
  );

  const turnCheckpoints = facts.turnArtifacts
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
        checkpointId: artifact.id,
        kind: 'turn' as const,
        artifactId: artifact.id,
        ...(artifact.parentTurnId
          ? { parentCheckpointId: artifact.parentTurnId }
          : hasInitialWorldCheckpoint
            ? { parentCheckpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID }
            : {}),
        selectedTurnIds,
        depth: Math.max(
          0,
          selectedTurnIds.length - (hasInitialWorldCheckpoint ? 0 : 1),
        ),
        revision: artifact.revision,
        worldTurn,
        committedAt: artifact.committedAt,
        preview: formatPlayCheckpointPreview(artifact, {
          importedStartingPoint: branchBaseHead && !completeSnapshot,
          worldTurn,
        }),
        ...(checkpointNames[artifact.id]
          ? { name: checkpointNames[artifact.id] }
          : {}),
        status,
        restorable: status !== 'current' && (completeSnapshot || branchBaseHead),
        retryable:
          completeSnapshot &&
          artifact.artifactKind === 'worldSettlement' &&
          artifact.rehearsalEvidenceRefs === undefined,
        canonical: false,
      };
    })
    .toSorted((left, right) =>
      left.revision - right.revision ||
      left.committedAt.localeCompare(right.committedAt) ||
      left.checkpointId.localeCompare(right.checkpointId),
    );

  if (!hasInitialWorldCheckpoint) {
    return turnCheckpoints;
  }

  const initialStatus: PlayCheckpointStatus = facts.selectedTurnIds.length === 0
    ? 'current'
    : 'selectedAncestor';
  const initialCheckpoint: PlayCheckpointSummary = {
    checkpointId: PLAY_INITIAL_WORLD_CHECKPOINT_ID,
    kind: 'initialWorld',
    selectedTurnIds: [],
    depth: 0,
    revision: facts.branchBaseSnapshot.worldClock.revision,
    worldTurn: facts.branchBaseSnapshot.worldClock.turn,
    committedAt: session.createdAt,
    preview: 'Initial world',
    ...(checkpointNames[PLAY_INITIAL_WORLD_CHECKPOINT_ID]
      ? { name: checkpointNames[PLAY_INITIAL_WORLD_CHECKPOINT_ID] }
      : {}),
    status: initialStatus,
    restorable: initialStatus !== 'current',
    retryable: false,
    canonical: false,
  };

  // Preserve the established artifact ordering as a stable prefix for callers
  // that already consume the implicit turn list. Timeline consumers should use
  // parentCheckpointId / depth rather than array position to render the root.
  return [...turnCheckpoints, initialCheckpoint];
}

/**
 * Restores the selected projection to a turn or initial-world checkpoint while
 * retaining every historical artifact and ledger fact. Restoring is a new
 * Play-local mutation, so the session revision advances monotonically even
 * though the selected world clock and projections move to an older branch.
 */
export function restorePlaySessionCheckpoint(
  session: PlaySession,
  checkpointId: string,
): PlaySession {
  const facts = materializePlayTurnFacts(session);
  const hasInitialWorldCheckpoint =
    facts.branchBaseSnapshot.parentTurnId === undefined;
  readPlayCheckpointNames(
    session,
    facts.turnArtifacts,
    hasInitialWorldCheckpoint,
  );

  if (checkpointId === PLAY_INITIAL_WORLD_CHECKPOINT_ID) {
    if (!hasInitialWorldCheckpoint) {
      throw new Error('Play initial-world checkpoint is unavailable for this session.');
    }
    if (facts.selectedTurnIds.length === 0) {
      throw new Error(
        `Play checkpoint is already current: ${PLAY_INITIAL_WORLD_CHECKPOINT_ID}.`,
      );
    }
    return projectPlaySessionToTurnHead(session, undefined, {
      advanceRevision: true,
    });
  }

  const safeArtifactId = assertSafePlayTurnArtifactId(checkpointId);
  const artifactsById = indexPlayTurnArtifacts(facts.turnArtifacts);
  const artifact = artifactsById.get(safeArtifactId);
  if (!artifact) {
    throw new Error(`Play checkpoint references an unknown artifact: ${safeArtifactId}.`);
  }
  if (facts.selectedTurnIds.at(-1) === safeArtifactId) {
    throw new Error(`Play checkpoint is already current: ${safeArtifactId}.`);
  }

  return projectPlaySessionToTurnHead(session, safeArtifactId, {
    advanceRevision: true,
  });
}

/**
 * Adds or replaces a user-facing name annotation for an immutable checkpoint.
 * The annotation lives in session metadata rather than a parallel checkpoint
 * fact store. Callers remain responsible for the filesystem CAS / staged write.
 */
export function renamePlaySessionCheckpoint(
  session: PlaySession,
  checkpointId: string,
  name: string,
): PlaySession {
  const facts = materializePlayTurnFacts(session);
  const hasInitialWorldCheckpoint =
    facts.branchBaseSnapshot.parentTurnId === undefined;
  const checkpointNames = readPlayCheckpointNames(
    session,
    facts.turnArtifacts,
    hasInitialWorldCheckpoint,
  );
  const safeCheckpointId = assertKnownPlayCheckpointId(
    checkpointId,
    facts.turnArtifacts,
    hasInitialWorldCheckpoint,
  );
  const normalizedName = normalizePlayCheckpointName(name);
  const revision = resolvePlaySessionRevision(session, facts.turnArtifacts) + 1;
  const renamed: PlaySession = {
    ...session,
    revision,
    metadataExtensions: {
      ...(session.metadataExtensions ?? {}),
      [PLAY_CHECKPOINT_NAMES_METADATA_KEY]: {
        ...checkpointNames,
        [safeCheckpointId]: normalizedName,
      },
    },
    worldClock: {
      ...session.worldClock,
      revision,
    },
  };

  // Re-run both the selected projection and annotation validation before the
  // caller can stage this Play-local metadata mutation.
  materializePlayTurnFacts(renamed);
  listPlaySessionCheckpoints(renamed);
  return renamed;
}

/**
 * Builds a validated projection at an artifact head without deleting any
 * ledger facts. An undefined head represents the virtual branch base and is
 * only valid for a new-session forest whose branch base has no artifact head.
 *
 * @internal This seam is shared by checkpoint restore and atomic turn retry.
 */
export function projectPlaySessionToTurnHead(
  session: PlaySession,
  artifactId: string | undefined,
  options: { advanceRevision: boolean },
): PlaySession {
  const safeArtifactId = artifactId === undefined
    ? undefined
    : assertSafePlayTurnArtifactId(artifactId);
  const facts = materializePlayTurnFacts(session);
  const artifactsById = indexPlayTurnArtifacts(facts.turnArtifacts);
  if (
    safeArtifactId === undefined &&
    facts.branchBaseSnapshot.parentTurnId !== undefined
  ) {
    throw new Error(
      'Play virtual branch base is unavailable when the branch base has an artifact head.',
    );
  }
  const artifact = safeArtifactId === undefined
    ? undefined
    : artifactsById.get(safeArtifactId);
  if (safeArtifactId !== undefined && !artifact) {
    throw new Error(`Play checkpoint references an unknown artifact: ${safeArtifactId}.`);
  }

  const completeSnapshot = artifact
    ? hasCompletePlayBranchSnapshot(artifact)
    : false;
  const branchBaseHead = artifact
    ? isPlayBranchBaseHead(
        artifact,
        facts.branchBaseSnapshot.parentTurnId,
      )
    : false;
  if (artifact && !completeSnapshot && !branchBaseHead) {
    throw new Error(
      `Play checkpoint artifact ${artifact.id} has no restorable branch snapshot.`,
    );
  }

  const selectedTurnIds = artifact
    ? resolvePlayTurnPath(artifact.id, artifactsById)
    : [];
  const snapshot = artifact && completeSnapshot
    ? {
        worldClock: artifact.worldClock!,
        playLocalState: artifact.playLocalStateSnapshot!,
        playLocalStateVisibility: artifact.playLocalStateVisibilitySnapshot!,
        scheduledEvents: artifact.scheduledEventSnapshots,
        suggestedActions: artifact.suggestedActions,
      }
    : facts.branchBaseSnapshot;
  const revision = resolvePlaySessionRevision(session, facts.turnArtifacts) +
    (options.advanceRevision ? 1 : 0);
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

function formatPlayCheckpointPreview(
  artifact: PlayTurnArtifact,
  options: { importedStartingPoint: boolean; worldTurn: number },
): string {
  // A checkpoint list is player-visible by default. Only the user's own input
  // is safe to summarize here; referee or narrator output can contain hidden
  // world facts and must stay behind the normal visibility projections.
  const content = artifact.input?.raw.trim().replace(/\s+/gu, ' ') ?? '';
  if (!content) {
    return options.importedStartingPoint
      ? 'Imported starting point'
      : `World turn ${options.worldTurn}`;
  }
  return content.length > 160 ? `${content.slice(0, 157)}...` : content;
}

function readPlayCheckpointNames(
  session: PlaySession,
  artifacts: PlayTurnArtifact[],
  hasInitialWorldCheckpoint: boolean,
): Record<string, string> {
  const value = session.metadataExtensions?.[PLAY_CHECKPOINT_NAMES_METADATA_KEY];
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error('Play checkpoint names metadata must be an object.');
  }

  const names: Record<string, string> = {};
  for (const [checkpointId, storedName] of Object.entries(value)) {
    const safeCheckpointId = assertKnownPlayCheckpointId(
      checkpointId,
      artifacts,
      hasInitialWorldCheckpoint,
    );
    const normalizedName = normalizePlayCheckpointName(storedName);
    if (normalizedName !== storedName) {
      throw new Error(
        `Play checkpoint name metadata is not normalized: ${safeCheckpointId}.`,
      );
    }
    names[safeCheckpointId] = normalizedName;
  }
  return names;
}

function assertKnownPlayCheckpointId(
  checkpointId: string,
  artifacts: PlayTurnArtifact[],
  hasInitialWorldCheckpoint: boolean,
): string {
  if (checkpointId === PLAY_INITIAL_WORLD_CHECKPOINT_ID) {
    if (!hasInitialWorldCheckpoint) {
      throw new Error('Play initial-world checkpoint is unavailable for this session.');
    }
    return checkpointId;
  }

  const safeArtifactId = assertSafePlayTurnArtifactId(checkpointId);
  if (!artifacts.some((artifact) => artifact.id === safeArtifactId)) {
    throw new Error(`Play checkpoint references an unknown artifact: ${safeArtifactId}.`);
  }
  return safeArtifactId;
}

function normalizePlayCheckpointName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Play checkpoint name must be a string.');
  }
  const name = value.trim();
  if (!name) {
    throw new Error('Play checkpoint name must not be empty.');
  }
  if (name.length > MAX_PLAY_CHECKPOINT_NAME_LENGTH) {
    throw new Error(
      `Play checkpoint name must be at most ${MAX_PLAY_CHECKPOINT_NAME_LENGTH} characters.`,
    );
  }
  if (/[\u0000-\u001f\u007f]/u.test(name)) {
    throw new Error('Play checkpoint name must not contain control characters.');
  }
  return name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
