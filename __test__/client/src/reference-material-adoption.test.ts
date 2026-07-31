import { describe, expect, it } from 'vitest';

import {
  assertReferenceMaterialAdoptionPreviewInput,
  parseReferenceMaterialAdoptionCatalogEnvelope,
  parseReferenceMaterialAdoptionPreviewResult,
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
    }, 'ref-adoption');

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
