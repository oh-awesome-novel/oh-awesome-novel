import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify } from 'yaml';

import {
  createNotAnalyzedReferenceManifest,
  createReferenceDiagnostics,
  createReferenceDeconstructionPublicationCandidate,
  createReferenceProgressProjection,
  fingerprintReferenceMaterialAdoptionContext,
} from '@oh-awesome-novel/core';
import type {
  ReferenceMaterialAdoptionContext,
  ReferenceMaterialAdoptionPlan,
} from '@oh-awesome-novel/core';
import {
  createPlayAdoptionChangeProposal,
  createReferenceMaterialAdoptionChangeProposal,
  createReferencePublicationChangeProposal,
  sha256Text,
} from '@oh-awesome-novel/tools';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const REPOSITORY = { repositoryId: 'repo-1', branch: 'main', head: 'abc123' };
const CREATED_AT = '2026-08-12T00:00:00.000Z';
const FINALIZED_AT = '2026-08-12T00:00:01.000Z';

describe('deterministic domain ChangeSet producers', () => {
  it('compiles publication candidate.files into an exact reference.publish ChangeSet', () => {
    const manifest = {
      ...createNotAnalyzedReferenceManifest({
        referenceId: 'ref-1',
        sourceChecksumSha256: SHA_B,
        structureFingerprint: SHA_C,
      }),
      revision: 7,
      status: 'stale' as const,
      publishedRunId: 'run-1',
    };
    const diagnostics = createReferenceDiagnostics({
      referenceId: 'ref-1',
      sourceChecksumSha256: SHA_B,
      generatedAt: CREATED_AT,
    });
    const progress = createReferenceProgressProjection(manifest, CREATED_AT);
    const publication = createReferenceDeconstructionPublicationCandidate({
      referenceId: 'ref-1',
      runId: 'run-1',
      runRevision: 7,
      preparedAt: CREATED_AT,
      files: [{
        path: 'examples/references.yaml',
        kind: 'index',
        content: [
          'version: 1',
          'references:',
          '  - id: ref-1',
          '    bundlePath: examples/references/ref-1',
          '',
        ].join('\n'),
      }, {
        path: 'examples/references/ref-1/deconstruction-manifest.yaml',
        kind: 'manifest',
        content: stringify(manifest),
      }, {
        path: 'examples/references/ref-1/diagnostics.yaml',
        kind: 'diagnostics',
        content: stringify(diagnostics),
      }, {
        path: 'examples/references/ref-1/progress.yaml',
        kind: 'progress',
        content: stringify(progress),
      }],
      entries: [],
    });
    const proposal = createReferencePublicationChangeProposal({
      publication,
      context: {
        sessionId: 'reference-publish-1',
        repository: REPOSITORY,
        projectionFingerprint: SHA_A,
        baselineFiles: [{
          path: 'examples/references/ref-1/progress.yaml',
          content: 'version: 1\nreferenceId: ref-1\nstatus: reviewReady\n',
          mode: 0o640,
        }],
        origin: {
          kind: 'referenceDeconstructionPublish',
          referenceId: 'ref-1',
          runId: 'run-1',
          runRevision: 7,
          candidateFingerprint: publication.candidateFingerprint,
        },
        createdAt: CREATED_AT,
        finalizedAt: FINALIZED_AT,
      },
    });

    expect(proposal?.candidate.source).toEqual({
      kind: 'deterministic-builder',
      producer: 'reference-deconstruction-publish',
      capability: 'reference.publish',
    });
    expect(proposal?.candidate.projectionFingerprint).toBe(SHA_A);
    expect(proposal?.allowedTargets).toEqual(publication.files.map((file) => file.path).sort());
    expect(proposal?.candidate.changes.map((change) => [change.operation, change.path]))
      .toEqual([
        ['create', 'examples/references.yaml'],
        ['create', 'examples/references/ref-1/deconstruction-manifest.yaml'],
        ['create', 'examples/references/ref-1/diagnostics.yaml'],
        ['update', 'examples/references/ref-1/progress.yaml'],
      ]);
    expect(proposal?.candidate.changes.at(-1)?.baseline).toMatchObject({ mode: 0o640 });
  });

  it('compiles five Reference Material domains and preserves yamlSet semantics as final YAML', () => {
    const context = adoptionContext();
    const plan = adoptionPlan(context);
    const proposal = createReferenceMaterialAdoptionChangeProposal({
      adoptionContext: context,
      plan,
      context: {
        sessionId: 'reference-adopt-1',
        repository: REPOSITORY,
        projectionFingerprint: SHA_A,
        baselineFiles: context.targets.filter((target) => target.targetExisted).map((target) => ({
          path: target.targetFile,
          content: target.baseline,
          mode: 0o640,
        })),
        origin: {
          kind: 'referenceMaterialAdoption',
          referenceId: context.referenceId,
          manifestRevision: context.manifestRevision,
          sourceChecksumSha256: context.sourceChecksumSha256,
          contextFingerprint: fingerprintReferenceMaterialAdoptionContext(context),
          previewFingerprint: SHA_C,
        },
        createdAt: CREATED_AT,
        finalizedAt: FINALIZED_AT,
      },
    });

    expect(proposal?.candidate.source).toMatchObject({
      producer: 'reference-material-adoption',
      capability: 'reference.adopt',
    });
    expect(proposal?.candidate.changes.map((change) => change.path)).toEqual([
      'characters/keeper/relationships.yaml',
      'characters/keeper/summary.md',
      'outline/main.md',
      'timeline/events.yaml',
      'world/adopted/rain.md',
    ]);
    const timeline = proposal?.candidate.changes.find((change) =>
      change.path === 'timeline/events.yaml');
    expect(timeline?.operation).toBe('update');
    if (!timeline || timeline.operation === 'delete') throw new Error('Timeline change missing.');
    expect(parseYaml(timeline.draft.content)).toEqual({
      events: [{ id: 'event-1', title: 'Rain gate changes', order: 1 }],
      metadata: { retained: true },
    });
    expect(timeline.baseline).toMatchObject({
      sha256: sha256Text('events: []\nmetadata:\n  retained: true\n'),
      mode: 0o640,
    });
  });

  it('eliminates Reference Material skips and no-op final files', () => {
    const context = adoptionContext();
    const plan = adoptionPlan(context);
    plan.decisions = plan.decisions.map((decision) => ({
      ...decision,
      decision: decision.targetId === 'world-target' ? 'update' : 'skip',
      ...(decision.targetId === 'world-target' ? { draft: '# Old Rain\n' } : { draft: undefined }),
    }));
    const proposal = createReferenceMaterialAdoptionChangeProposal({
      adoptionContext: context,
      plan,
      context: {
        sessionId: 'reference-adopt-noop',
        repository: REPOSITORY,
        projectionFingerprint: SHA_A,
        baselineFiles: context.targets.filter((target) => target.targetExisted).map((target) => ({
          path: target.targetFile,
          content: target.baseline,
        })),
        origin: {
          kind: 'referenceMaterialAdoption',
          referenceId: context.referenceId,
          manifestRevision: context.manifestRevision,
          sourceChecksumSha256: context.sourceChecksumSha256,
          contextFingerprint: fingerprintReferenceMaterialAdoptionContext(context),
          previewFingerprint: SHA_C,
        },
      },
    });
    expect(proposal).toBeUndefined();
  });

  it.each([
    {
      target: 'chapterDraft' as const,
      payload: { chapterId: '0001/0002', title: 'After Rain', content: 'Scene.' },
      baseline: undefined,
      path: 'chapters/0001/0002.md',
      expected: '# After Rain\n\nScene.\n',
    },
    {
      target: 'state' as const,
      payload: { file: 'play-adoption.yaml', path: 'evidence.play_a', value: { active: true } },
      baseline: 'evidence: {}\n',
      path: 'state/play-adoption.yaml',
      expected: { evidence: { play_a: { active: true } } },
    },
    {
      target: 'timeline' as const,
      payload: { event: { id: 'play-a', title: 'Rain', order: 2 } },
      baseline: 'events:\n  - id: old\n    title: Old\n    order: 1\n',
      path: 'timeline/events.yaml',
      expected: { events: [
        { id: 'old', title: 'Old', order: 1 },
        { id: 'play-a', title: 'Rain', order: 2 },
      ] },
    },
    {
      target: 'foreshadow' as const,
      payload: { item: { id: 'play-a', description: 'Rain clue', status: 'active' } },
      baseline: 'active: []\n',
      path: 'foreshadow/active.yaml',
      expected: { active: [{ id: 'play-a', description: 'Rain clue', status: 'active' }] },
    },
  ])('compiles Play $target payload without a legacy toolName', ({
    target,
    payload,
    baseline,
    path,
    expected,
  }) => {
    const proposal = createPlayAdoptionChangeProposal({
      target,
      payload,
      source: {
        sessionId: 'play-1',
        branchId: 'branch-1',
        sourceRevision: 3,
        previewFingerprint: SHA_B,
      },
      context: {
        sessionId: `play-producer-${target}`,
        repository: REPOSITORY,
        projectionFingerprint: SHA_A,
        baselineFiles: baseline === undefined ? [] : [{ path, content: baseline }],
        origin: {
          kind: 'playAdoption',
          sessionId: 'play-1',
          branchId: 'branch-1',
          sourceRevision: 3,
          previewFingerprint: SHA_B,
        },
        createdAt: CREATED_AT,
        finalizedAt: FINALIZED_AT,
      },
    });
    const change = proposal?.candidate.changes[0];
    expect(proposal?.allowedTargets).toEqual([path]);
    expect(proposal?.candidate.source).toEqual({
      kind: 'deterministic-builder',
      producer: 'play-adoption',
      capability: 'play.adopt',
    });
    expect(change?.path).toBe(path);
    if (!change || change.operation === 'delete') throw new Error('Play change missing.');
    expect(path.endsWith('.yaml') ? parseYaml(change.draft.content) : change.draft.content)
      .toEqual(expected);
  });

  it('rejects producer origin and target/baseline substitutions', () => {
    expect(() => createPlayAdoptionChangeProposal({
      target: 'state',
      payload: { file: 'play.yaml', path: 'flag', value: true },
      source: {
        sessionId: 'play-1',
        branchId: 'branch-1',
        sourceRevision: 3,
        previewFingerprint: SHA_B,
      },
      context: {
        sessionId: 'play-substitution',
        repository: REPOSITORY,
        projectionFingerprint: SHA_A,
        baselineFiles: [{ path: 'state/other.yaml', content: 'flag: false\n' }],
        origin: {
          kind: 'playAdoption',
          sessionId: 'play-1',
          branchId: 'other-branch',
          sourceRevision: 3,
          previewFingerprint: SHA_B,
        },
      },
    })).toThrow(/origin does not match/u);
  });
});

function adoptionContext(): ReferenceMaterialAdoptionContext {
  const baselineByPath = new Map([
    ['world/adopted/rain.md', '# Old Rain\n'],
    ['characters/keeper/summary.md', ''],
    ['characters/keeper/relationships.yaml', ''],
    ['outline/main.md', ''],
    ['timeline/events.yaml', 'events: []\nmetadata:\n  retained: true\n'],
  ]);
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
    catalogFingerprint: SHA_A,
    manifestRevision: 2,
    sourceChecksumSha256: SHA_B,
    materialFiles: [],
    warnings: [],
    targets: specs.map(([id, materialKind, targetFile, targetPath]) => {
      const baseline = baselineByPath.get(targetFile)!;
      const targetExisted = baseline.length > 0;
      return {
        id,
        materialKind,
        targetFile,
        ...(targetPath ? { targetPath } : {}),
        targetExisted,
        baseline,
        baselineChecksumSha256: sha256Text(baseline),
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
      };
    }),
  };
}

function adoptionPlan(context: ReferenceMaterialAdoptionContext): ReferenceMaterialAdoptionPlan {
  const drafts = [
    '# Rain\n',
    '# Keeper\n',
    'relationships: []\n',
    '# Outline\n',
    JSON.stringify([{ id: 'event-1', title: 'Rain gate changes', order: 1 }]),
  ];
  return {
    decisions: context.targets.map((target, index) => ({
      targetId: target.id,
      materialKind: target.materialKind,
      targetFile: target.targetFile,
      ...(target.targetPath ? { targetPath: target.targetPath } : {}),
      entryIds: target.entries.map((entry) => entry.id),
      decision: target.targetExisted ? 'update' : 'create',
      reason: 'Selected material has a controlled destination.',
      draft: drafts[index]!,
    })),
  };
}
