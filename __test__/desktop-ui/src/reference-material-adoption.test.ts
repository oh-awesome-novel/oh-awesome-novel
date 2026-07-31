// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReferenceMaterialAdoptionPanel from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceMaterialAdoptionPanel.vue';
import type { ReferenceMaterialAdoptionCatalog } from '@oh-awesome-novel/client';

describe('Reference Material adoption UI', () => {
  it('selects a published entry, exposes its controlled target, and requests a preview', async () => {
    const wrapper = mount(ReferenceMaterialAdoptionPanel, {
      props: {
        catalog: catalogFixture(),
        noChangeDecisions: [],
        loading: false,
        previewing: false,
        confirming: false,
        error: '',
      },
    });

    expect(wrapper.text()).toContain('Published reference material is evidence, not Project Truth');
    expect(wrapper.text()).toContain('Rain gate');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.get('input[type="text"]').element).toHaveProperty(
      'value',
      'world/adopted/world-entry.md',
    );
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('preview')).toEqual([[[{
      entryId: 'world-entry',
      targetFile: 'world/adopted/world-entry.md',
    }]]]);
  });

  it('makes the diff and second confirmation boundary explicit before review', async () => {
    const wrapper = mount(ReferenceMaterialAdoptionPanel, {
      props: {
        catalog: catalogFixture(),
        preview: {
          schemaVersion: 1,
          id: 'pa_1234-abcd',
          referenceId: 'ref-adoption',
          referenceTitle: 'Adoption Reference',
          catalogFingerprint: 'c'.repeat(64),
          contextFingerprint: 'd'.repeat(64),
          manifestRevision: 2,
          sourceChecksumSha256: 'a'.repeat(64),
          decisions: [{
            targetId: 'target-world',
            materialKind: 'world',
            targetFile: 'world/adopted/world-entry.md',
            entryIds: ['world-entry'],
            decision: 'create',
            reason: 'Controlled destination.',
          }],
          warnings: [],
          touchedFiles: ['world/adopted/world-entry.md'],
          diff: 'diff --git a/world/adopted/world-entry.md b/world/adopted/world-entry.md',
          fingerprint: 'e'.repeat(64),
          createdAt: '2026-08-01T00:00:00.000Z',
          canonicalUnchanged: true,
        },
        noChangeDecisions: [],
        loading: false,
        previewing: false,
        confirming: false,
        error: '',
      },
    });

    expect(wrapper.text()).toContain('canonical workspace files are still unchanged');
    expect(wrapper.text()).toContain('Confirm and create PendingAction');
    expect(wrapper.get('pre').text()).toContain('world/adopted/world-entry.md');
    await wrapper.get('button.primary-button').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[]]);
  });
});

function catalogFixture(): ReferenceMaterialAdoptionCatalog {
  return {
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
      sourcePath: 'materials/world.yaml',
    }],
    fingerprint: 'c'.repeat(64),
  };
}
