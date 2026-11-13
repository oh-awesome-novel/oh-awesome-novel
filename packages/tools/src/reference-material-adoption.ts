import { parse as parseYaml } from 'yaml';
import type {
  ReferenceMaterialAdoptionContext,
  ReferenceMaterialAdoptionPlan,
} from '@oh-awesome-novel/core';
import {
  createReferenceMaterialAdoptionPlan,
  fingerprintReferenceMaterialAdoptionContext,
} from '@oh-awesome-novel/core';

import {
  DEFAULT_CREATED_FILE_MODE,
  sha256Text,
} from './candidate-change-set';
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
import { compileYamlSetFinalDocument } from './deterministic-yaml';

export const REFERENCE_MATERIAL_ADOPTION_CHANGE_PRODUCER =
  'reference-material-adoption' as const;

export type ReferenceMaterialChangeOrigin = Extract<
  PendingActionOrigin,
  { kind: 'referenceMaterialAdoption' }
>;

export interface CreateReferenceMaterialAdoptionChangeProposalInput {
  adoptionContext: ReferenceMaterialAdoptionContext;
  plan: ReferenceMaterialAdoptionPlan;
  context: TrustedDeterministicProducerContext<ReferenceMaterialChangeOrigin>;
}

/**
 * New-schema Reference Material compiler.  In particular, timeline yamlSet
 * decisions are resolved against their captured baseline here and stored as a
 * complete final YAML document; Accept never re-executes the YAML operation.
 */
export function createReferenceMaterialAdoptionChangeProposal(
  input: CreateReferenceMaterialAdoptionChangeProposalInput,
): DeterministicChangeProposal<ReferenceMaterialChangeOrigin> | undefined {
  const adoptionContext = structuredClone(input.adoptionContext);
  const plan = normalizeAdoptionPlan(adoptionContext, input.plan);
  const origin = requireAdoptionOrigin(input.context.origin, adoptionContext);
  const baselineFiles = requireAdoptionBaselines(
    adoptionContext,
    input.context.baselineFiles,
  );
  const activeDecisions = plan.decisions.filter((decision) => decision.decision !== 'skip');
  if (activeDecisions.length === 0) return undefined;
  const allowedTargets = normalizeExactTargetSet(
    activeDecisions.map((decision) => decision.targetFile),
  );
  const policy = createWorkspaceChangePolicy({
    capability: 'reference.adopt',
    exactWritablePaths: allowedTargets,
    expectedProjectionFingerprint: input.context.projectionFingerprint,
    maxChangedFiles: allowedTargets.length,
  });
  const builder = new CandidateChangeSetBuilder({
    sessionId: input.context.sessionId,
    producer: REFERENCE_MATERIAL_ADOPTION_CHANGE_PRODUCER,
    capability: 'reference.adopt',
    repository: input.context.repository,
    baselineFiles,
    projectionFingerprint: input.context.projectionFingerprint,
    createdAt: input.context.createdAt,
  });
  const targetById = new Map(adoptionContext.targets.map((target) => [target.id, target]));
  for (const decision of activeDecisions) {
    const target = targetById.get(decision.targetId);
    if (!target || decision.draft === undefined) {
      throw new Error('Reference Material adoption plan does not match its context.');
    }
    const preserveBaseline = adoptionContext.characterAdoption?.mergeFiles.includes(target.targetFile) && target.targetExisted;
    const content = target.materialKind === 'timeline'
      ? compileTimelineYamlSet(target.baseline, target.targetPath!, decision.draft)
      : preserveBaseline ? `${decision.draft.trimEnd()}\n` : normalizeFinalText(decision.draft);
    if (preserveBaseline && !content.startsWith(target.baseline.trimEnd())) throw new Error('合并候选必须完整保留已有角色正文，再追加来源说法。');
    const relationRows = adoptionContext.characterAdoption?.relationships.filter(row => row.targetFile === target.targetFile);
    if (relationRows?.length) {
      const parsed = parseYaml(content) as { relationships?: Record<string, unknown> };
      const before = target.baseline ? parseYaml(target.baseline) as { relationships?: Record<string, unknown> } : {};
      const ids = new Set(relationRows.flatMap(row => row.characters.map(person => person.characterId)));
      const priorIds = Object.keys(before.relationships ?? {});
      for (const id of ids) {
        const metadataTarget = adoptionContext.targets.find(t => t.targetFile === `characters/${id}/meta.yaml`);
        if (metadataTarget && !metadataTarget.targetExisted && !activeDecisions.some(d => d.targetId === metadataTarget.id)) throw new Error('关系依赖的角色被跳过，请先采用角色。');
      }
      for (const [id, previous] of Object.entries(before.relationships ?? {})) {
        const next = parsed?.relationships?.[id];
        if (typeof previous === 'object' && previous !== null && typeof next === 'object' && next !== null) {
          for (const [key, value] of Object.entries(previous)) {
            const after = (next as Record<string, unknown>)[key];
            if (key === 'notes' && typeof value === 'string' && typeof after === 'string' && after.startsWith(value)) continue;
            if (JSON.stringify(after) !== JSON.stringify(value)) throw new Error('关系合并不能覆盖既有说法；请保留原字段，把新增或矛盾说法追加到 notes。');
          }
        } else if (JSON.stringify(next) !== JSON.stringify(previous)) throw new Error('关系合并不能删除或覆盖已有关系。');
      }
      if (!parsed?.relationships || Array.isArray(parsed.relationships) || Object.keys(parsed.relationships).some(id => !ids.has(id) && !priorIds.includes(id)) || [...ids, ...priorIds].some(id => !Object.hasOwn(parsed.relationships!, id))) throw new Error('关系候选必须使用作者确认的角色 ID，并保留已有关系。');
    }
    builder.write(
      target.targetFile,
      content,
      baselineFiles.find((file) => file.path === target.targetFile)?.mode
        ?? DEFAULT_CREATED_FILE_MODE,
    );
  }
  return finalizeDeterministicChangeProposal({
    builder,
    finalizedAt: input.context.finalizedAt,
    policy,
    origin,
    allowedTargets,
  });
}

function normalizeAdoptionPlan(
  context: ReferenceMaterialAdoptionContext,
  plan: ReferenceMaterialAdoptionPlan,
): ReferenceMaterialAdoptionPlan {
  if (!plan || !Array.isArray(plan.decisions)) {
    throw new Error('Reference Material adoption plan is invalid.');
  }
  return createReferenceMaterialAdoptionPlan(context, {
    targets: plan.decisions.map((decision) => ({
      targetId: decision.targetId,
      decision: decision.decision,
      reason: decision.reason,
      draft: decision.draft ?? null,
    })),
  });
}

function requireAdoptionOrigin(
  value: ReferenceMaterialChangeOrigin,
  context: ReferenceMaterialAdoptionContext,
): ReferenceMaterialChangeOrigin {
  const parsed = parsePendingActionOrigin(value);
  const contextFingerprint = fingerprintReferenceMaterialAdoptionContext(context);
  if (
    parsed.kind !== 'referenceMaterialAdoption'
    || parsed.referenceId !== context.referenceId
    || parsed.manifestRevision !== context.manifestRevision
    || parsed.sourceChecksumSha256 !== context.sourceChecksumSha256
    || parsed.contextFingerprint !== contextFingerprint
  ) {
    throw new Error('Reference Material adoption origin does not match its context.');
  }
  return parsed;
}

function requireAdoptionBaselines(
  context: ReferenceMaterialAdoptionContext,
  snapshots: readonly CandidateFileSnapshot[],
): CandidateFileSnapshot[] {
  const targets = new Map(context.targets.map((target) => [target.targetFile, target]));
  if (targets.size !== context.targets.length) {
    throw new Error('Reference Material adoption target files must be unique.');
  }
  const snapshotByPath = new Map<string, CandidateFileSnapshot>();
  for (const snapshot of snapshots) {
    const target = targets.get(snapshot.path);
    if (!target) {
      throw new Error(
        `Reference Material adoption baseline escaped its exact targets: ${snapshot.path}.`,
      );
    }
    if (snapshotByPath.has(snapshot.path)) {
      throw new Error(`Duplicate Reference Material baseline: ${snapshot.path}.`);
    }
    if (!target.targetExisted) {
      throw new Error(`Reference Material target unexpectedly exists: ${snapshot.path}.`);
    }
    if (
      snapshot.content !== target.baseline
      || sha256Text(snapshot.content) !== target.baselineChecksumSha256
    ) {
      throw new Error(`Reference Material baseline is stale: ${snapshot.path}.`);
    }
    snapshotByPath.set(snapshot.path, { ...snapshot });
  }
  for (const target of context.targets) {
    if (sha256Text(target.baseline) !== target.baselineChecksumSha256) {
      throw new Error(`Reference Material context baseline is corrupt: ${target.targetFile}.`);
    }
    if (target.targetExisted !== snapshotByPath.has(target.targetFile)) {
      throw new Error(`Reference Material baseline existence is stale: ${target.targetFile}.`);
    }
    if (!target.targetExisted && target.baseline !== '') {
      throw new Error(`Missing Reference Material target has a non-empty baseline: ${target.targetFile}.`);
    }
  }
  return [...snapshotByPath.values()];
}

function compileTimelineYamlSet(
  baseline: string,
  rawPath: string,
  draft: string,
): string {
  let value: unknown;
  try {
    value = JSON.parse(draft) as unknown;
  } catch {
    throw new Error('Timeline adoption draft must be JSON for its YAML path.');
  }
  return compileYamlSetFinalDocument(baseline, rawPath, value);
}

function normalizeFinalText(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed}\n` : '';
}
