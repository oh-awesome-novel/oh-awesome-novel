import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ReferenceMaterialAdoptionContext,
  ReferenceMaterialAdoptionPlan,
} from '@oh-awesome-novel/core';
import {
  acceptPendingAction,
  createReferenceMaterialAdoptionPatches,
  prepareWriteIntentPreview,
  promoteWriteIntentPreview,
} from '@oh-awesome-novel/tools';

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('Reference Material SemanticPatch adoption', () => {
  it('maps the five material domains to controlled SemanticPatch targets', () => {
    const context = adoptionContext();
    const plan = adoptionPlan(context);

    expect(createReferenceMaterialAdoptionPatches(context, plan)).toEqual([
      {
        kind: 'object',
        domain: 'world',
        entityId: 'adopted',
        file: 'rain.md',
        operation: 'replaceFile',
        value: '# Rain\n',
      },
      {
        kind: 'object',
        domain: 'character',
        entityId: 'keeper',
        file: 'summary.md',
        operation: 'replaceFile',
        value: '# Keeper\n',
      },
      {
        kind: 'object',
        domain: 'character',
        entityId: 'keeper',
        file: 'relationships.yaml',
        operation: 'replaceFile',
        value: 'relationships: []\n',
      },
      {
        kind: 'narrative',
        domain: 'outline',
        file: 'main.md',
        operation: 'replaceFile',
        value: '# Outline\n',
      },
      {
        kind: 'collection',
        domain: 'timeline',
        file: 'events.yaml',
        operation: 'yamlSet',
        path: 'events',
        value: [{ id: 'event-1', title: 'Rain gate changes' }],
      },
    ]);
  });

  it('keeps canonical files unchanged through preview and promotion, then writes only on Accept', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-material-adoption-'));
    tempRoots.push(workspaceRoot);
    const context = adoptionContext();
    const patches = createReferenceMaterialAdoptionPatches(context, adoptionPlan(context));
    const targetFiles = context.targets.map((target) => target.targetFile);
    const targetPaths = targetFiles.map((target) => join(workspaceRoot, target));

    const preview = await prepareWriteIntentPreview({
      workspaceRoot,
      toolName: 'reference.adoptMaterials',
      args: {
        title: 'Adopt selected material',
        description: 'One bounded selected entry.',
        patches,
      },
    });
    await expect(Promise.all(targetPaths.map(readOptional))).resolves.toEqual(
      targetPaths.map(() => undefined),
    );
    expect(preview.diff).toContain('b/world/adopted/rain.md');
    expect(preview.touchedFiles).toEqual(targetFiles);

    const pending = await promoteWriteIntentPreview({ workspaceRoot, preview });
    await expect(Promise.all(targetPaths.map(readOptional))).resolves.toEqual(
      targetPaths.map(() => undefined),
    );
    expect(pending.status).toBe('pending');

    await acceptPendingAction({
      workspaceRoot,
      id: pending.id,
      autoCommitOnAccept: false,
    });
    await expect(readFile(targetPaths[0]!, 'utf8')).resolves.toBe('# Rain\n');
    await expect(readFile(targetPaths[1]!, 'utf8')).resolves.toBe('# Keeper\n');
    await expect(readFile(targetPaths[2]!, 'utf8')).resolves.toBe('relationships: []\n');
    await expect(readFile(targetPaths[3]!, 'utf8')).resolves.toBe('# Outline\n');
    await expect(readFile(targetPaths[4]!, 'utf8')).resolves.toContain('Rain gate changes');
  });
});

function adoptionContext(): ReferenceMaterialAdoptionContext {
  const specs = [
    ['world-target', 'world', 'world/adopted/rain.md', undefined],
    ['character-target', 'characters', 'characters/keeper/summary.md', undefined],
    ['relationship-target', 'relationships', 'characters/keeper/relationships.yaml', undefined],
    ['outline-target', 'outline', 'outline/main.md', undefined],
    ['timeline-target', 'timeline', 'timeline/events.yaml', 'events'],
  ] as const;
  return {
    schemaVersion: 1,
    referenceId: 'ref-adoption',
    referenceTitle: 'Adoption Reference',
    catalogFingerprint: 'a'.repeat(64),
    manifestRevision: 2,
    sourceChecksumSha256: 'b'.repeat(64),
    materialFiles: [],
    warnings: [],
    targets: specs.map(([id, materialKind, targetFile, targetPath]) => ({
      id,
      materialKind,
      targetFile,
      ...(targetPath ? { targetPath } : {}),
      targetExisted: false,
      baseline: '',
      baselineChecksumSha256: 'c'.repeat(64),
      entries: [{
        id: `entry-${id}`,
        materialKind,
        title: id,
        content: 'Selected bounded material.',
        details: [],
        assertionType: 'fact',
        confidence: 'high',
        evidenceRefs: ['pointer-1'],
        sourceFindingRefs: ['finding-1'],
        sourcePath: `materials/${materialKind}.yaml`,
      }],
    })),
  };
}

function adoptionPlan(context: ReferenceMaterialAdoptionContext): ReferenceMaterialAdoptionPlan {
  const drafts = [
    '# Rain\n',
    '# Keeper\n',
    'relationships: []\n',
    '# Outline\n',
    JSON.stringify([{ id: 'event-1', title: 'Rain gate changes' }]),
  ];
  return {
    decisions: context.targets.map((target, index) => ({
      targetId: target.id,
      materialKind: target.materialKind,
      targetFile: target.targetFile,
      ...(target.targetPath ? { targetPath: target.targetPath } : {}),
      entryIds: target.entries.map((entry) => entry.id),
      decision: 'create',
      reason: 'Selected material has a controlled destination.',
      draft: drafts[index]!,
    })),
  };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
