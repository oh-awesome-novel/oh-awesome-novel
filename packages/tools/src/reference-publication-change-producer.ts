import {
  assertReferenceDeconstructionPublicationCandidate,
} from '@oh-awesome-novel/core';
import type {
  ReferenceDeconstructionPublicationCandidate,
} from '@oh-awesome-novel/core';
import { parse as parseYaml } from 'yaml';

import type { CandidateFileSnapshot } from './candidate-change-set';
import {
  CandidateChangeSetBuilder,
  finalizeDeterministicChangeProposal,
  normalizeExactTargetSet,
} from './deterministic-change-producers';
import type {
  DeterministicChangeProposal,
  TrustedDeterministicProducerContext,
} from './deterministic-change-producers';
import type { PendingActionOrigin } from './pending-action-types';
import { parsePendingActionOrigin } from './pending-action-types';
import { createWorkspaceChangePolicy } from './workspace-change-policy';

export const REFERENCE_PUBLICATION_CHANGE_PRODUCER =
  'reference-deconstruction-publish' as const;

export type ReferencePublicationOrigin = Extract<
  PendingActionOrigin,
  { kind: 'referenceDeconstructionPublish' }
>;

export interface CreateReferencePublicationChangeProposalInput {
  publication: ReferenceDeconstructionPublicationCandidate;
  context: TrustedDeterministicProducerContext<ReferencePublicationOrigin>;
}

/**
 * Compiles the core publication candidate's final files directly to one
 * CandidateChangeSet. No legacy patch operation, shell command, or Accept-time replay
 * is retained: the candidate bytes are the draft bytes.
 */
export function createReferencePublicationChangeProposal(
  input: CreateReferencePublicationChangeProposalInput,
): DeterministicChangeProposal<ReferencePublicationOrigin> | undefined {
  const publication = assertReferenceDeconstructionPublicationCandidate(
    structuredClone(input.publication),
  );
  const origin = requirePublicationOrigin(input.context.origin, publication);
  const allowedTargets = normalizeExactTargetSet(
    publication.files.map((file) => file.path),
  );
  const baselineFiles = requireBoundedBaselines(
    input.context.baselineFiles,
    allowedTargets,
    'Reference publication',
  );
  const manifest = readManifestFingerprints(publication);
  const policy = createWorkspaceChangePolicy({
    capability: 'reference.publish',
    referenceId: publication.referenceId,
    exactWritablePaths: allowedTargets,
    expectedProjectionFingerprint: input.context.projectionFingerprint,
    expectedReferenceRunId: publication.runId,
    expectedSourceChecksumSha256: manifest.sourceChecksumSha256,
    expectedStructureFingerprint: manifest.structureFingerprint,
    maxChangedFiles: allowedTargets.length,
  });
  const builder = new CandidateChangeSetBuilder({
    sessionId: input.context.sessionId,
    producer: REFERENCE_PUBLICATION_CHANGE_PRODUCER,
    capability: 'reference.publish',
    repository: input.context.repository,
    baselineFiles,
    projectionFingerprint: input.context.projectionFingerprint,
    createdAt: input.context.createdAt ?? publication.preparedAt,
  });
  for (const file of publication.files) {
    builder.write(file.path, file.content);
  }
  return finalizeDeterministicChangeProposal({
    builder,
    finalizedAt: input.context.finalizedAt,
    policy,
    origin,
    allowedTargets,
  });
}

function requirePublicationOrigin(
  value: ReferencePublicationOrigin,
  publication: ReferenceDeconstructionPublicationCandidate,
): ReferencePublicationOrigin {
  const parsed = parsePendingActionOrigin(value);
  if (
    parsed.kind !== 'referenceDeconstructionPublish'
    || parsed.referenceId !== publication.referenceId
    || parsed.runId !== publication.runId
    || parsed.runRevision !== publication.runRevision
    || parsed.candidateFingerprint !== publication.candidateFingerprint
  ) {
    throw new Error('Reference publication origin does not match its candidate.');
  }
  return parsed;
}

function requireBoundedBaselines(
  snapshots: readonly CandidateFileSnapshot[],
  allowedTargets: readonly string[],
  label: string,
): CandidateFileSnapshot[] {
  const allowed = new Set(allowedTargets);
  const seen = new Set<string>();
  return snapshots.map((snapshot) => {
    if (!allowed.has(snapshot.path)) {
      throw new Error(`${label} baseline escaped its exact targets: ${snapshot.path}.`);
    }
    if (seen.has(snapshot.path)) {
      throw new Error(`${label} contains duplicate baseline ${snapshot.path}.`);
    }
    seen.add(snapshot.path);
    return { ...snapshot };
  });
}

function readManifestFingerprints(
  publication: ReferenceDeconstructionPublicationCandidate,
): { sourceChecksumSha256: string; structureFingerprint: string } {
  const path = `examples/references/${publication.referenceId}/deconstruction-manifest.yaml`;
  const file = publication.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error('Reference publication candidate has no manifest.');
  const value = parseYaml(file.content) as unknown;
  if (!isRecord(value)) throw new Error('Reference publication manifest must be a mapping.');
  return {
    sourceChecksumSha256: requireSha256(
      value.sourceChecksumSha256,
      'Reference publication source checksum',
    ),
    structureFingerprint: requireSha256(
      value.structureFingerprint,
      'Reference publication structure fingerprint',
    ),
  };
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
