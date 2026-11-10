import { describe, expect, it } from 'vite-plus/test';

import {
  assertReferenceMaterialAdoptionPreflightInput,
  assertReferenceMaterialAdoptionPreviewInput,
  parseReferenceMaterialAdoptionCatalogEnvelope,
  parseReferenceMaterialAdoptionPreflightEnvelope,
  parseReferenceMaterialAdoptionPreviewResult,
  parseReferenceMaterialAdoptionRecords,
} from '@oh-awesome-novel/client';

describe('Reference Material adoption client validation', () => {
  it('accepts a bounded published catalog and rejects unsafe target paths', () => {
    const catalog = parseReferenceMaterialAdoptionCatalogEnvelope({
      catalog: {
        schemaVersion: 1,
        referenceId: 'ref-adoption',
        referenceTitle: 'Adoption Reference',
        manifestRevision: 2,
        sourceChecksumSha256: 'a'.repeat(64),
        warningSummary: { count: 0, codes: [] },
        warnings: [],
        materialFiles: [{
          materialKind: 'world',
          path: 'materials/world.yaml',
          checksumSha256: 'b'.repeat(64),
          sourceRunId: 'run-material',
        }],
        entries: [{
          id: 'world-entry',
          materialKind: 'world',
          title: 'Rain gate',
          content: 'The selected gate changes routes during rain.',
          details: [],
          assertionType: 'fact',
          confidence: 'high',
          evidenceRefs: ['pointer-1'],
          sourceFindingRefs: ['finding-1'],
          uncertainty: undefined,
          sourcePath: 'materials/world.yaml',
        }],
        fingerprint: 'c'.repeat(64),
      },
      targetSuggestions: {
        world: ['world/magic/rules.md'],
        characters: [],
        relationships: [],
        outline: [],
        timeline: [],
        truncated: false,
      },
    }, 'ref-adoption');

    expect(catalog.targetSuggestions.world).toEqual(['world/magic/rules.md']);

    expect(catalog.catalog.entries[0]?.id).toBe('world-entry');
    expect(() => assertReferenceMaterialAdoptionPreviewInput({
      catalogFingerprint: catalog.catalog.fingerprint,
      selections: [{ entryId: 'world-entry', targetFile: '../outside.md' }],
    })).toThrow(/input is invalid/u);
  });

  it('rejects a preview that claims canonical files were already changed', () => {
    expect(() => parseReferenceMaterialAdoptionPreviewResult({
      status: 'noChanges',
      referenceId: 'ref-adoption',
      referenceTitle: 'Adoption Reference',
      catalogFingerprint: 'a'.repeat(64),
      decisions: [],
      warnings: [],
      canonicalUnchanged: false,
    }, 'ref-adoption')).toThrow(/no-change response is invalid/u);
  });
});

describe('Reference Material adoption preflight and records validation', () => {
  const preflight = {
    schemaVersion: 1,
    referenceId: 'ref-adoption',
    catalogFingerprint: 'c'.repeat(64),
    status: 'blocked',
    selectionCount: 2,
    targetCount: 1,
    materialChars: 120,
    limits: { selections: 64, targets: 32, largeBatchChars: 120000 },
    targets: [],
    issues: [{
      code: 'illegalTargetPath',
      severity: 'error',
      message: '目标路径不合法。',
      entryIds: ['world-entry'],
      targetFile: '../outside.md',
    }],
  };

  it('lets an illegal target reach the preflight, which explains it instead of failing', () => {
    expect(() => assertReferenceMaterialAdoptionPreflightInput({
      catalogFingerprint: 'c'.repeat(64),
      selections: [{ entryId: 'world-entry', targetFile: '../outside.md' }],
    })).not.toThrow();
    expect(() => assertReferenceMaterialAdoptionPreflightInput({
      catalogFingerprint: 'c'.repeat(64),
      selections: Array.from({ length: 513 }, (_, index) => ({ entryId: `e${index}`, targetFile: 'a.md' })),
    })).toThrow(/input is invalid/u);

    const parsed = parseReferenceMaterialAdoptionPreflightEnvelope({ preflight }, 'ref-adoption');
    expect(parsed.preflight.issues[0]?.targetFile).toBe('../outside.md');
  });

  it('rejects a preflight for another reference, an unknown issue code, or ready with a blocking issue', () => {
    expect(() => parseReferenceMaterialAdoptionPreflightEnvelope({ preflight }, 'other-ref'))
      .toThrow(/preflight response is invalid/u);
    expect(() => parseReferenceMaterialAdoptionPreflightEnvelope({
      preflight: { ...preflight, issues: [{ ...preflight.issues[0], code: 'madeUp' }] },
    }, 'ref-adoption')).toThrow(/preflight response is invalid/u);
    expect(() => parseReferenceMaterialAdoptionPreflightEnvelope({
      preflight: { ...preflight, status: 'ready' },
    }, 'ref-adoption')).toThrow(/preflight response is invalid/u);
  });

  it('accepts records with or without entry evidence, but never entries without evidence', () => {
    const record = {
      pendingActionId: 'pa_1234-abcd',
      status: 'accepted',
      createdAt: '2026-11-10T00:00:00.000Z',
      decidedAt: '2026-11-10T00:01:00.000Z',
      commit: 'abcdef1234',
      currentPublication: true,
      targets: [{ operation: 'create', path: 'world/adopted/world-entry.md' }],
      entryEvidence: 'available',
      entries: [{
        entryId: 'world-entry',
        title: 'Rain gate',
        materialKind: 'world',
        targetFile: 'world/adopted/world-entry.md',
        decision: 'create',
      }],
    };
    const envelope = (records: unknown[]) => ({
      referenceId: 'ref-adoption', records, coverage: 'retainedReviewDataOnly',
    });

    expect(parseReferenceMaterialAdoptionRecords(envelope([
      record,
      { ...record, pendingActionId: 'pa_5678-abcd', entryEvidence: 'missing', entries: [] },
    ]), 'ref-adoption').records).toHaveLength(2);
    expect(() => parseReferenceMaterialAdoptionRecords(
      envelope([{ ...record, entryEvidence: 'missing' }]),
      'ref-adoption',
    )).toThrow(/records response is invalid/u);
    expect(() => parseReferenceMaterialAdoptionRecords(
      { ...envelope([record]), coverage: 'complete' },
      'ref-adoption',
    )).toThrow(/records response is invalid/u);
  });
});
