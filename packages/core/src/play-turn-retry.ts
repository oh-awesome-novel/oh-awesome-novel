import {
  hasCompletePlayBranchSnapshot,
} from './play-event-schedule-history.js';
import {
  materializePlayTurnFacts,
  resolvePlaySessionRevision,
} from './play-session-facts.js';
import {
  settlePlayWorldRefereeResponse,
} from './play-session.js';
import type { PlaySession } from './play-session.js';
import {
  projectPlaySessionToTurnHead,
} from './play-turn-graph.js';
import {
  assertSafePlayTurnArtifactId,
} from './play-turn-artifact.js';
import type { PlayTurnArtifact } from './play-turn-artifact.js';
import type { PlayActionKind, PlayRelativeTimeAdvance } from './play-types.js';

export type PlayWorldSettlementRetryErrorCode =
  | 'invalidArtifactId'
  | 'artifactNotFound'
  | 'artifactNotRetryable'
  | 'beforeSnapshotUnavailable'
  | 'invalidRevision'
  | 'revisionConflict';

export class PlayWorldSettlementRetryError extends Error {
  readonly name = 'PlayWorldSettlementRetryError';

  constructor(
    readonly code: PlayWorldSettlementRetryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PlayWorldSettlementRetryPreparation {
  sourceArtifactId: string;
  sourceRevision: number;
  expectedSessionRevision: number;
  parentArtifactId?: string;
  userText: string;
  actionKind: PlayActionKind;
  timeAdvance?: PlayRelativeTimeAdvance;
  beforeTurnSession: PlaySession;
}

export interface SettlePlayWorldSettlementRetryInput {
  session: PlaySession;
  sourceArtifactId: string;
  expectedSessionRevision: number;
  refereeResponse: string;
  createdAt?: string;
}

export interface SettledPlayWorldSettlementRetry {
  session: PlaySession;
  sourceArtifactId: string;
  retryArtifactId: string;
  parentArtifactId?: string;
}

/**
 * Produces the exact Play-local projection immediately before a committed
 * world-settlement artifact. This object is prompt input only; the final
 * settlement API reconstructs it from the authoritative session instead of
 * trusting a caller-held preparation.
 */
export function preparePlayWorldSettlementRetry(
  session: PlaySession,
  sourceArtifactId: string,
): PlayWorldSettlementRetryPreparation {
  const safeSourceArtifactId = normalizeRetryArtifactId(sourceArtifactId);
  const facts = materializePlayTurnFacts(session);
  const sourceArtifact = facts.turnArtifacts.find(
    (artifact) => artifact.id === safeSourceArtifactId,
  );
  if (!sourceArtifact) {
    throw new PlayWorldSettlementRetryError(
      'artifactNotFound',
      `Play retry references an unknown artifact: ${safeSourceArtifactId}.`,
    );
  }
  assertRetryableWorldSettlement(sourceArtifact);
  assertRetryBeforeSnapshotAvailable(
    sourceArtifact,
    facts.turnArtifacts,
    facts.branchBaseSnapshot.parentTurnId,
  );

  const beforeTurnSession = projectPlaySessionToTurnHead(
    session,
    sourceArtifact.parentTurnId,
    { advanceRevision: false },
  );
  const expectedSessionRevision = resolvePlaySessionRevision(
    session,
    facts.turnArtifacts,
  );

  return {
    sourceArtifactId: sourceArtifact.id,
    sourceRevision: sourceArtifact.revision,
    expectedSessionRevision,
    ...(sourceArtifact.parentTurnId
      ? { parentArtifactId: sourceArtifact.parentTurnId }
      : {}),
    userText: sourceArtifact.input!.raw,
    actionKind: sourceArtifact.input!.kind,
    ...(sourceArtifact.input!.timeAdvance
      ? { timeAdvance: { ...sourceArtifact.input!.timeAdvance } }
      : {}),
    beforeTurnSession,
  };
}

/**
 * Atomically materializes a sibling settlement from the source artifact's
 * before-turn projection. Historical variants remain immutable ledger facts;
 * only the selected projection changes in the returned session.
 */
export function settlePlayWorldSettlementRetry(
  input: SettlePlayWorldSettlementRetryInput,
): SettledPlayWorldSettlementRetry {
  if (
    !Number.isSafeInteger(input.expectedSessionRevision) ||
    input.expectedSessionRevision < 0
  ) {
    throw new PlayWorldSettlementRetryError(
      'invalidRevision',
      'Play retry expectedSessionRevision must be a non-negative integer.',
    );
  }

  const facts = materializePlayTurnFacts(input.session);
  const currentRevision = resolvePlaySessionRevision(
    input.session,
    facts.turnArtifacts,
  );
  if (input.expectedSessionRevision !== currentRevision) {
    throw new PlayWorldSettlementRetryError(
      'revisionConflict',
      `Play retry revision conflict: expected ${input.expectedSessionRevision}, current ${currentRevision}.`,
    );
  }

  const preparation = preparePlayWorldSettlementRetry(
    input.session,
    input.sourceArtifactId,
  );
  const next = settlePlayWorldRefereeResponse({
    session: preparation.beforeTurnSession,
    userText: preparation.userText,
    actionKind: preparation.actionKind,
    ...(preparation.timeAdvance
      ? { timeAdvance: preparation.timeAdvance }
      : {}),
    refereeResponse: input.refereeResponse,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });

  // Re-run the full ledger and selected-projection validator before exposing a
  // retry result. Validation failures leave the caller's input untouched.
  materializePlayTurnFacts(next);
  const retryArtifactId = next.selectedTurnIds.at(-1);
  const retryArtifact = retryArtifactId
    ? next.turnArtifacts.find((artifact) => artifact.id === retryArtifactId)
    : undefined;
  if (
    !retryArtifact ||
    retryArtifact.artifactKind !== 'worldSettlement' ||
    retryArtifact.parentTurnId !== preparation.parentArtifactId
  ) {
    throw new Error('Play retry did not produce the expected sibling settlement.');
  }

  return {
    session: next,
    sourceArtifactId: preparation.sourceArtifactId,
    retryArtifactId: retryArtifact.id,
    ...(preparation.parentArtifactId
      ? { parentArtifactId: preparation.parentArtifactId }
      : {}),
  };
}

function normalizeRetryArtifactId(value: string): string {
  try {
    return assertSafePlayTurnArtifactId(value);
  } catch {
    throw new PlayWorldSettlementRetryError(
      'invalidArtifactId',
      'Invalid Play retry source artifact id.',
    );
  }
}

function assertRetryableWorldSettlement(artifact: PlayTurnArtifact): void {
  if (
    !hasCompletePlayBranchSnapshot(artifact) ||
    artifact.artifactKind !== 'worldSettlement' ||
    !artifact.input ||
    artifact.rehearsalEvidenceRefs !== undefined
  ) {
    throw new PlayWorldSettlementRetryError(
      'artifactNotRetryable',
      `Play retry requires an ordinary complete v2 worldSettlement artifact: ${artifact.id}.`,
    );
  }
}

function assertRetryBeforeSnapshotAvailable(
  sourceArtifact: PlayTurnArtifact,
  artifacts: PlayTurnArtifact[],
  branchBaseHeadId?: string,
): void {
  if (!sourceArtifact.parentTurnId) {
    if (branchBaseHeadId === undefined) {
      return;
    }
    throw new PlayWorldSettlementRetryError(
      'beforeSnapshotUnavailable',
      `Play retry artifact ${sourceArtifact.id} has no virtual branch-base predecessor.`,
    );
  }

  const parent = artifacts.find(
    (artifact) => artifact.id === sourceArtifact.parentTurnId,
  );
  if (
    parent &&
    (
      hasCompletePlayBranchSnapshot(parent) ||
      parent.id === branchBaseHeadId
    )
  ) {
    return;
  }

  throw new PlayWorldSettlementRetryError(
    'beforeSnapshotUnavailable',
    `Play retry artifact ${sourceArtifact.id} has no verifiable before-turn snapshot.`,
  );
}
