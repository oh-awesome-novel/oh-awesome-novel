import {
  DEFAULT_CREATED_FILE_MODE,
  createCandidateChangeSet,
  fingerprintFileSnapshots,
  normalizeWorkspaceRelativePath,
} from './candidate-change-set';
import type {
  CandidateChangeSet,
  CandidateFileSnapshot,
  RepositoryBaseline,
  WorkspaceEditCapability,
} from './candidate-change-set';
import type { PendingActionOrigin } from './pending-action-types';
import type { WorkspaceChangePolicy } from './workspace-change-policy';
import { validateCandidateChangeSetAgainstPolicy } from './workspace-change-policy';

export interface CandidateChangeSetBuilderOptions {
  sessionId: string;
  producer: string;
  capability: WorkspaceEditCapability;
  repository: RepositoryBaseline;
  baselineFiles: readonly CandidateFileSnapshot[];
  /**
   * Fingerprint of the trusted, fixed projection used by the producer.  A
   * deterministic workflow commonly reads more source files than the target
   * baselines alone, so callers should pass the host projection fingerprint
   * instead of reducing freshness to the writable files.
   */
  projectionFingerprint?: string;
  createdAt?: string;
}

export interface TrustedDeterministicProducerContext<
  TOrigin extends PendingActionOrigin = PendingActionOrigin,
> {
  sessionId: string;
  repository: RepositoryBaseline;
  projectionFingerprint: string;
  baselineFiles: readonly CandidateFileSnapshot[];
  origin: TOrigin;
  createdAt?: string;
  finalizedAt?: string;
}

export interface DeterministicChangeProposal<
  TOrigin extends PendingActionOrigin = PendingActionOrigin,
> {
  candidate: CandidateChangeSet;
  policy: WorkspaceChangePolicy;
  origin: TOrigin;
  /** Exact, trusted host-selected targets; never inferred from model input. */
  allowedTargets: readonly string[];
}

export class CandidateChangeSetBuilder {
  private readonly options: CandidateChangeSetBuilderOptions;
  private readonly files = new Map<string, CandidateFileSnapshot>();
  private finalized = false;

  constructor(options: CandidateChangeSetBuilderOptions) {
    this.options = options;
    for (const snapshot of options.baselineFiles) {
      const path = normalizeWorkspaceRelativePath(snapshot.path);
      if (this.files.has(path)) {
        throw new Error(`Duplicate deterministic baseline path: ${path}`);
      }
      this.files.set(path, {
        path,
        content: snapshot.content,
        mode: snapshot.mode ?? DEFAULT_CREATED_FILE_MODE,
      });
    }
  }

  write(pathValue: string, content: string, mode?: number): this {
    this.assertOpen();
    const path = normalizeWorkspaceRelativePath(pathValue);
    const existing = this.files.get(path);
    this.files.set(path, {
      path,
      content,
      mode: mode ?? existing?.mode ?? DEFAULT_CREATED_FILE_MODE,
    });
    return this;
  }

  delete(pathValue: string): this {
    this.assertOpen();
    this.files.delete(normalizeWorkspaceRelativePath(pathValue));
    return this;
  }

  finalize(finalizedAt?: string): CandidateChangeSet | undefined {
    this.assertOpen();
    this.finalized = true;
    return createCandidateChangeSet({
      sessionId: this.options.sessionId,
      createdAt: this.options.createdAt,
      finalizedAt,
      projectionFingerprint: this.options.projectionFingerprint
        ?? fingerprintFileSnapshots(this.options.baselineFiles),
      repository: this.options.repository,
      source: {
        kind: 'deterministic-builder',
        producer: this.options.producer,
        capability: this.options.capability,
      },
      baselineFiles: this.options.baselineFiles,
      finalFiles: [...this.files.values()],
    });
  }

  private assertOpen(): void {
    if (this.finalized) {
      throw new Error('CandidateChangeSetBuilder is already finalized.');
    }
  }
}

export function createCandidateChangeSetBuilder(
  options: CandidateChangeSetBuilderOptions,
): CandidateChangeSetBuilder {
  return new CandidateChangeSetBuilder(options);
}

/**
 * Final common gate for deterministic producers.  The returned object is the
 * complete hand-off required by PreparedChangePreview/PendingAction storage:
 * immutable final bytes, the same exact policy used during compilation, and
 * the independently authenticated workflow origin.
 */
export function finalizeDeterministicChangeProposal<
  TOrigin extends PendingActionOrigin,
>(input: {
  builder: CandidateChangeSetBuilder;
  finalizedAt?: string;
  policy: WorkspaceChangePolicy;
  origin: TOrigin;
  allowedTargets: readonly string[];
}): DeterministicChangeProposal<TOrigin> | undefined {
  const allowedTargets = normalizeExactTargetSet(input.allowedTargets);
  const candidate = input.builder.finalize(input.finalizedAt);
  if (!candidate) return undefined;
  validateCandidateChangeSetAgainstPolicy(candidate, input.policy);
  const allowed = new Set(allowedTargets);
  const escaped = candidate.changes.find((change) => !allowed.has(change.path));
  if (escaped) {
    throw new Error(
      `Deterministic candidate escaped its exact target set: ${escaped.path}.`,
    );
  }
  return Object.freeze({
    candidate,
    policy: input.policy,
    origin: input.origin,
    allowedTargets: Object.freeze(allowedTargets),
  });
}

export function normalizeExactTargetSet(paths: readonly string[]): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('Deterministic producer requires at least one exact target.');
  }
  const normalized = paths.map(normalizeWorkspaceRelativePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Deterministic producer target paths must be unique.');
  }
  return normalized.sort(comparePaths);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
