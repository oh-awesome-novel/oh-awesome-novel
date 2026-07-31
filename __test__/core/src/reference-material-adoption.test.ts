import { describe, expect, it } from 'vitest';

import {
  createReferenceMaterialAdoptionPlan,
  fingerprintReferenceMaterialAdoptionContext,
} from '@oh-awesome-novel/core';
import type {
  ReferenceMaterialAdoptionContext,
  ReferenceMaterialAdoptionTargetGroup,
  ReferenceStoryMaterialKind,
} from '@oh-awesome-novel/core';

describe('Reference Material adoption plan', () => {
  it('binds every model decision to its selected target and strips no baseline metadata', () => {
    const context = adoptionContext([
      target('new-world', 'world', 'world/adopted/rain.md', false),
      target('existing-outline', 'outline', 'outline/main.md', true),
      target('skip-character', 'characters', 'characters/keeper/summary.md', true),
    ]);

    const plan = createReferenceMaterialAdoptionPlan(context, {
      targets: [
        {
          targetId: 'new-world',
          decision: 'create',
          reason: 'A selected setting fact has a controlled destination.',
          draft: '# Rain Gate\n',
        },
        {
          targetId: 'existing-outline',
          decision: 'update',
          reason: 'Merge one selected structural beat while preserving the baseline.',
          draft: '# Outline\n\nExisting beat.\n\nNew transformed beat.\n',
        },
        {
          targetId: 'skip-character',
          decision: 'skip',
          reason: 'The selected interpretation is too uncertain for canon.',
          draft: null,
        },
      ],
    });

    expect(plan.decisions).toMatchObject([
      { targetId: 'new-world', decision: 'create', entryIds: ['entry-new-world'] },
      { targetId: 'existing-outline', decision: 'update', entryIds: ['entry-existing-outline'] },
      { targetId: 'skip-character', decision: 'skip', entryIds: ['entry-skip-character'] },
    ]);
    expect(plan.decisions[2]).not.toHaveProperty('draft');
    expect(fingerprintReferenceMaterialAdoptionContext(context)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('fails closed when create/update disagrees with the target baseline', () => {
    const context = adoptionContext([
      target('existing-world', 'world', 'world/adopted/rain.md', true),
    ]);

    expect(() => createReferenceMaterialAdoptionPlan(context, {
      targets: [{
        targetId: 'existing-world',
        decision: 'create',
        reason: 'Forged baseline decision.',
        draft: '# Replacement\n',
      }],
    })).toThrow(/does not match target baseline/u);
  });
});

function adoptionContext(
  targets: ReferenceMaterialAdoptionTargetGroup[],
): ReferenceMaterialAdoptionContext {
  return {
    schemaVersion: 1,
    referenceId: 'ref-adoption',
    referenceTitle: 'Bounded Reference',
    catalogFingerprint: 'a'.repeat(64),
    manifestRevision: 3,
    sourceChecksumSha256: 'b'.repeat(64),
    materialFiles: [{
      materialKind: 'world',
      path: 'materials/world.yaml',
      checksumSha256: 'c'.repeat(64),
      sourceRunId: 'run-material',
    }],
    warnings: [],
    targets,
  };
}

function target(
  id: string,
  materialKind: ReferenceStoryMaterialKind,
  targetFile: string,
  targetExisted: boolean,
): ReferenceMaterialAdoptionTargetGroup {
  const baseline = targetExisted ? '# Existing\n' : '';
  return {
    id,
    materialKind,
    targetFile,
    targetExisted,
    baseline,
    baselineChecksumSha256: targetExisted ? 'd'.repeat(64) : 'e'.repeat(64),
    entries: [{
      id: `entry-${id}`,
      materialKind,
      title: 'Selected entry',
      content: 'A bounded transformed material fact.',
      details: [],
      assertionType: 'fact',
      confidence: 'high',
      evidenceRefs: ['evidence-1'],
      sourceFindingRefs: ['finding-1'],
      sourcePath: `materials/${materialKind}.yaml`,
    }],
  };
}
