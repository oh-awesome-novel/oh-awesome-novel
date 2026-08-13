import {
  normalizePlayAdoptionBusinessTarget,
} from '@oh-awesome-novel/core';
import type { PlayAdoptionTarget } from '@oh-awesome-novel/core';

import {
  DEFAULT_CREATED_FILE_MODE,
} from './candidate-change-set';
import type { CandidateFileSnapshot } from './candidate-change-set';
import {
  CandidateChangeSetBuilder,
  finalizeDeterministicChangeProposal,
} from './deterministic-change-producers';
import type {
  DeterministicChangeProposal,
  TrustedDeterministicProducerContext,
} from './deterministic-change-producers';
import {
  compileYamlAppendFinalDocument,
  compileYamlSetFinalDocument,
} from './deterministic-yaml';
import type { PendingActionOrigin } from './pending-action-types';
import { parsePendingActionOrigin } from './pending-action-types';
import { createWorkspaceChangePolicy } from './workspace-change-policy';

export const PLAY_ADOPTION_CHANGE_PRODUCER = 'play-adoption' as const;

export type PlayAdoptionChangeOrigin = Extract<
  PendingActionOrigin,
  { kind: 'playAdoption' }
>;

export interface PlayAdoptionSourceBinding {
  sessionId: string;
  branchId: string;
  sourceRevision: number;
  previewFingerprint: string;
}

export interface CreatePlayAdoptionChangeProposalInput {
  target: PlayAdoptionTarget;
  payload: Record<string, unknown>;
  source: PlayAdoptionSourceBinding;
  context: TrustedDeterministicProducerContext<PlayAdoptionChangeOrigin>;
}

/** Compile one reviewed Play business payload into one exact final-file change. */
export function createPlayAdoptionChangeProposal(
  input: CreatePlayAdoptionChangeProposalInput,
): DeterministicChangeProposal<PlayAdoptionChangeOrigin> | undefined {
  const businessTarget = normalizePlayAdoptionBusinessTarget({
    target: input.target,
    payload: input.payload,
  });
  const origin = requirePlayOrigin(input.context.origin, input.source);
  const baseline = requirePlayBaseline(
    input.context.baselineFiles,
    businessTarget.targetFile,
  );
  if (businessTarget.target === 'chapterDraft') {
    if (businessTarget.mode === 'create' && baseline) {
      throw new Error(`Play chapter adoption target already exists: ${businessTarget.targetFile}.`);
    }
    if (businessTarget.mode === 'replace' && !baseline) {
      throw new Error(`Play chapter adoption replacement target is missing: ${businessTarget.targetFile}.`);
    }
  }
  const policy = createWorkspaceChangePolicy({
    capability: 'play.adopt',
    exactWritablePaths: [businessTarget.targetFile],
    expectedProjectionFingerprint: input.context.projectionFingerprint,
    maxChangedFiles: 1,
  });
  const builder = new CandidateChangeSetBuilder({
    sessionId: input.context.sessionId,
    producer: PLAY_ADOPTION_CHANGE_PRODUCER,
    capability: 'play.adopt',
    repository: input.context.repository,
    baselineFiles: baseline ? [baseline] : [],
    projectionFingerprint: input.context.projectionFingerprint,
    createdAt: input.context.createdAt,
  });
  const finalContent = businessTarget.operation === 'replace-file'
    ? businessTarget.content
    : businessTarget.operation === 'yaml-set'
      ? compileYamlSetFinalDocument(
          baseline?.content ?? '',
          businessTarget.path,
          businessTarget.value,
        )
      : compileYamlAppendFinalDocument(
          requireExistingCollectionBaseline(baseline, businessTarget.targetFile),
          businessTarget.path,
          businessTarget.value,
        );
  builder.write(
    businessTarget.targetFile,
    finalContent,
    baseline?.mode ?? DEFAULT_CREATED_FILE_MODE,
  );
  return finalizeDeterministicChangeProposal({
    builder,
    finalizedAt: input.context.finalizedAt,
    policy,
    origin,
    allowedTargets: [businessTarget.targetFile],
  });
}

function requirePlayOrigin(
  value: PlayAdoptionChangeOrigin,
  source: PlayAdoptionSourceBinding,
): PlayAdoptionChangeOrigin {
  const parsed = parsePendingActionOrigin(value);
  if (
    parsed.kind !== 'playAdoption'
    || parsed.sessionId !== source.sessionId
    || parsed.branchId !== source.branchId
    || parsed.sourceRevision !== source.sourceRevision
    || parsed.previewFingerprint !== source.previewFingerprint
  ) {
    throw new Error('Play adoption origin does not match its trusted source binding.');
  }
  return parsed;
}

function requirePlayBaseline(
  snapshots: readonly CandidateFileSnapshot[],
  targetFile: string,
): CandidateFileSnapshot | undefined {
  if (snapshots.length > 1) {
    throw new Error('Play adoption accepts only its one exact target baseline.');
  }
  const snapshot = snapshots[0];
  if (snapshot && snapshot.path !== targetFile) {
    throw new Error(`Play adoption baseline escaped its exact target: ${snapshot.path}.`);
  }
  return snapshot ? { ...snapshot } : undefined;
}

function requireExistingCollectionBaseline(
  snapshot: CandidateFileSnapshot | undefined,
  path: string,
): string {
  if (!snapshot) {
    throw new Error(`Play collection adoption target is missing: ${path}.`);
  }
  return snapshot.content;
}
