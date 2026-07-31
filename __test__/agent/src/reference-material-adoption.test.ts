import { describe, expect, it } from 'vitest';

import {
  formatReferenceMaterialAdoptionPrompt,
  REFERENCE_MATERIAL_ADOPTION_SYSTEM_PROMPT,
} from '@oh-awesome-novel/agent';
import type { ReferenceMaterialAdoptionContext } from '@oh-awesome-novel/core';

describe('Reference Material adoption prompt boundary', () => {
  it('contains only selected structured entries and their current target baselines', () => {
    const context = selectedContext();
    const prompt = formatReferenceMaterialAdoptionPrompt(context);

    expect(prompt).toContain('selected-world-entry');
    expect(prompt).toContain('Current project baseline sentinel.');
    expect(prompt).toContain('materials/world.yaml');
    expect(prompt).not.toContain('UNSELECTED_SOURCE_SENTINEL');
    expect(prompt).not.toContain('sources/source.txt');
    expect(prompt).not.toContain('deconstruction/chunks');
    expect(REFERENCE_MATERIAL_ADOPTION_SYSTEM_PROMPT).toContain(
      'does not authorize writing',
    );
  });
});

function selectedContext(): ReferenceMaterialAdoptionContext {
  return {
    schemaVersion: 1,
    referenceId: 'ref-selected',
    referenceTitle: 'Selected Reference',
    catalogFingerprint: 'a'.repeat(64),
    manifestRevision: 2,
    sourceChecksumSha256: 'b'.repeat(64),
    materialFiles: [{
      materialKind: 'world',
      path: 'materials/world.yaml',
      checksumSha256: 'c'.repeat(64),
      sourceRunId: 'run-selected',
    }],
    warnings: [],
    targets: [{
      id: 'target-selected',
      materialKind: 'world',
      targetFile: 'world/adopted/rain.md',
      targetExisted: true,
      baseline: 'Current project baseline sentinel.\n',
      baselineChecksumSha256: 'd'.repeat(64),
      entries: [{
        id: 'selected-world-entry',
        materialKind: 'world',
        title: 'Rain gate',
        content: 'The selected gate changes routes during rain.',
        details: ['Only this selected detail may be considered.'],
        assertionType: 'fact',
        confidence: 'high',
        evidenceRefs: ['pointer-1'],
        sourceFindingRefs: ['private-finding-id'],
        sourcePath: 'materials/world.yaml',
      }],
    }],
  };
}
