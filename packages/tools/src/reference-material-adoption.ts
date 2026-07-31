import type {
  ReferenceMaterialAdoptionContext,
  ReferenceMaterialAdoptionPlan,
} from '@oh-awesome-novel/core';

import type {
  CollectionPatch,
  NarrativePatch,
  ObjectPatch,
  SemanticPatch,
} from './apply-engine';

export function createReferenceMaterialAdoptionPatches(
  context: ReferenceMaterialAdoptionContext,
  plan: ReferenceMaterialAdoptionPlan,
): SemanticPatch[] {
  const patches: SemanticPatch[] = [];
  for (const decision of plan.decisions) {
    if (decision.decision === 'skip') continue;
    const target = context.targets.find((candidate) => candidate.id === decision.targetId);
    if (
      !target
      || !decision.draft
      || target.materialKind !== decision.materialKind
      || target.targetFile !== decision.targetFile
      || target.targetPath !== decision.targetPath
    ) {
      throw new Error('Reference Material adoption plan does not match its context.');
    }
    const segments = target.targetFile.split('/');
    if (target.materialKind === 'world') {
      patches.push({
        kind: 'object',
        domain: 'world',
        entityId: segments[1]!,
        file: segments.slice(2).join('/'),
        operation: 'replaceFile',
        value: decision.draft,
      } satisfies ObjectPatch);
    } else if (
      target.materialKind === 'characters'
      || target.materialKind === 'relationships'
    ) {
      patches.push({
        kind: 'object',
        domain: 'character',
        entityId: segments[1]!,
        file: segments.slice(2).join('/'),
        operation: 'replaceFile',
        value: decision.draft,
      } satisfies ObjectPatch);
    } else if (target.materialKind === 'outline') {
      patches.push({
        kind: 'narrative',
        domain: 'outline',
        file: segments.slice(1).join('/'),
        operation: 'replaceFile',
        value: decision.draft,
      } satisfies NarrativePatch);
    } else {
      let value: unknown;
      try {
        value = JSON.parse(decision.draft) as unknown;
      } catch {
        throw new Error(
          `Timeline adoption draft for ${target.targetFile} must be JSON for its YAML path.`,
        );
      }
      patches.push({
        kind: 'collection',
        domain: 'timeline',
        file: segments.slice(1).join('/'),
        operation: 'yamlSet',
        path: target.targetPath!,
        value,
      } satisfies CollectionPatch);
    }
  }
  const targets = patches.map((patch) => JSON.stringify(patch));
  if (new Set(targets).size !== targets.length) {
    throw new Error('Reference Material adoption produced duplicate patches.');
  }
  return patches;
}
