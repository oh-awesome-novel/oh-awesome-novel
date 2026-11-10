// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vite-plus/test';

import ReferenceMaterialAdoptionPanel from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceMaterialAdoptionPanel.vue';
import ReferenceMaterialEntrySelector from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceMaterialEntrySelector.vue';
import { useReferenceMaterialAdoption } from '../../../apps/desktop-ui/src/composables/useReferenceMaterialAdoption';
import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionPreflight,
  ReferenceMaterialAdoptionRecords,
} from '@oh-awesome-novel/client';

const baseProps = {
  noChangeDecisions: [],
  loading: false,
  previewing: false,
  confirming: false,
  error: '',
};

describe('Reference Material adoption UI', () => {
  it('selects a published entry, exposes its controlled target, and asks for a preflight first', async () => {
    const wrapper = mount(ReferenceMaterialAdoptionPanel, {
      props: { ...baseProps, catalog: catalogFixture() },
    });

    expect(wrapper.text()).toContain('已发布的参考材料只是依据，不是作品事实');
    expect(wrapper.text()).toContain('Rain gate');
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.get('.material-target-fields input[type="text"]').element).toHaveProperty(
      'value',
      'world/adopted/world-entry.md',
    );
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('preflight')).toEqual([[[{
      entryId: 'world-entry',
      targetFile: 'world/adopted/world-entry.md',
    }]]]);
    // Nothing is generated until the preflight is ready and the author asks.
    expect(wrapper.emitted('generate')).toBeUndefined();
  });

  it('explains a blocked batch next to its entry and only generates from a ready preflight', async () => {
    const wrapper = mount(ReferenceMaterialAdoptionPanel, {
      props: { ...baseProps, catalog: catalogFixture(), preflight: preflightFixture('blocked') },
    });
    await wrapper.get('input[type="checkbox"]').setValue(true);

    expect(wrapper.get('.material-entry-issues').text()).toContain('目标路径不合法');
    expect(wrapper.get('[aria-label="采纳预检结果"]').text()).toContain('这一批还不能生成预览');
    const generate = () => wrapper.get<HTMLButtonElement>('.material-preflight button');
    expect(generate().element.disabled).toBe(true);

    // Remapping the target invalidates the preflight.
    await wrapper.get('.material-target-fields input[type="text"]').setValue('world/magic/gate.md');
    expect(wrapper.emitted('selectionChange')).toHaveLength(2);

    await wrapper.setProps({ preflight: preflightFixture('ready') });
    expect(wrapper.get('[aria-label="采纳预检结果"]').text()).toContain('修改');
    expect(wrapper.get('[aria-label="采纳预检结果"]').text()).toContain('已存在，将在现有内容上修改');
    await generate().trigger('click');
    expect(wrapper.emitted('generate')).toEqual([[]]);
  });

  it('makes the diff and second confirmation boundary explicit before review, and keeps the batch', async () => {
    const wrapper = mount(ReferenceMaterialAdoptionPanel, {
      props: { ...baseProps, catalog: catalogFixture() },
    });
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('.material-target-fields input[type="text"]').setValue('world/magic/gate.md');
    await wrapper.setProps({
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
          targetFile: 'world/magic/gate.md',
          entryIds: ['world-entry'],
          decision: 'create',
          reason: 'Controlled destination.',
        }],
        warnings: [],
        changes: [{ operation: 'create', path: 'world/magic/gate.md', newHash: 'f'.repeat(64) }],
        diff: 'diff --git a/world/magic/gate.md b/world/magic/gate.md',
        fingerprint: 'e'.repeat(64),
        createdAt: '2026-08-01T00:00:00.000Z',
        canonicalUnchanged: true,
      },
    });

    const preview = wrapper.get('[aria-label="采纳预览"]');
    expect(preview.text()).toContain('作品文件此时仍未改动');
    expect(preview.text()).toContain('新增');
    expect(preview.text()).toContain('原因：Controlled destination.');
    expect(preview.get('pre').text()).toContain('world/magic/gate.md');
    await preview.get('button.primary-button').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([[]]);

    // Going back does not lose the selection or the remapped target.
    await wrapper.setProps({ preview: undefined });
    expect(wrapper.get<HTMLInputElement>('input[type="checkbox"]').element.checked).toBe(true);
    expect(wrapper.get<HTMLInputElement>('.material-target-fields input[type="text"]').element.value)
      .toBe('world/magic/gate.md');
  });

  it('shows adoption records, their coverage limit, and records whose entry details are gone', async () => {
    const records: ReferenceMaterialAdoptionRecords = {
      referenceId: 'ref-adoption',
      coverage: 'retainedReviewDataOnly',
      records: [
        {
          pendingActionId: 'pa_1111-aaaa',
          status: 'accepted',
          createdAt: '2026-11-10T00:00:00.000Z',
          commit: 'abcdef123456',
          currentPublication: true,
          targets: [{ operation: 'create', path: 'world/magic/gate.md' }],
          entryEvidence: 'available',
          entries: [{
            entryId: 'world-entry', title: 'Rain gate', materialKind: 'world',
            targetFile: 'world/magic/gate.md', decision: 'create',
          }],
        },
        {
          pendingActionId: 'pa_2222-bbbb',
          status: 'pending',
          createdAt: '2026-11-09T00:00:00.000Z',
          currentPublication: false,
          targets: [{ operation: 'update', path: 'outline/main.md' }],
          entryEvidence: 'missing',
          entries: [],
        },
      ],
    };
    const wrapper = mount(ReferenceMaterialAdoptionPanel, {
      props: { ...baseProps, catalog: catalogFixture(), records },
    });

    const list = wrapper.get('.material-adoption-records');
    expect(list.text()).toContain('没有记录不代表从未采用过');
    expect(list.text()).toContain('提交 abcdef12');
    expect(list.text()).toContain('条目明细已缺失');
    expect(list.text()).toContain('来自较早的一次发布');
    // The entry itself says where it was adopted to.
    expect(wrapper.get('.material-entry-toggle small').text()).toContain('已采用到 world/magic/gate.md');
    await list.get('button').trigger('click');
    expect(wrapper.emitted('review')).toEqual([['pa_2222-bbbb']]);

    await wrapper.setProps({ records: undefined, recordsError: 'offline' });
    expect(wrapper.get('.material-adoption-records').text()).toContain('这不影响继续采用');
  });
});

describe('Reference Material entry selector with a large catalog', () => {
  it('filters and pages 500 entries without losing the selection', async () => {
    const catalog = largeCatalogFixture(500);
    const wrapper = mount(ReferenceMaterialEntrySelector, { props: { catalog, disabled: false } });
    const cards = () => wrapper.findAll('.material-entry-card');
    const summary = () => wrapper.get('.material-filter-summary').text();

    expect(cards()).toHaveLength(30);
    await wrapper.findAll('button').find((button) => button.text().includes('再显示'))!.trigger('click');
    expect(cards()).toHaveLength(60);

    await wrapper.get('input[type="search"]').setValue('entry-0499');
    expect(cards()).toHaveLength(1);
    await wrapper.get('input[type="checkbox"]').setValue(true);

    const [kind, confidence, flag] = wrapper.findAll('select');
    await wrapper.get('input[type="search"]').setValue('');
    await kind!.setValue('characters');
    await confidence!.setValue('low');
    expect(summary()).toContain('符合筛选 50 条');
    expect(summary()).toContain('已选 1 / 64');
    expect(summary()).toContain('1 条已选不在当前筛选结果中');

    await wrapper.findAll('button').find((button) => button.text() === '选中筛选结果')!.trigger('click');
    expect(summary()).toContain('已选 51 / 64');
    await kind!.setValue('all');
    await confidence!.setValue('all');
    await wrapper.findAll('button').find((button) => button.text() === '选中筛选结果')!.trigger('click');
    // Bulk selection stops at the batch limit.
    expect(summary()).toContain('已选 64 / 64');

    await flag!.setValue('selected');
    expect(summary()).toContain('符合筛选 64 条');
    await wrapper.get('form').trigger('submit');
    const emitted = wrapper.emitted('preflight')![0]![0] as Array<{ entryId: string }>;
    expect(emitted).toHaveLength(64);
    expect(emitted.map((selection) => selection.entryId)).toContain('entry-0499');

    await flag!.setValue('uncertain');
    expect(summary()).toContain('符合筛选 100 条');
  });

  it('resets the batch when another catalog arrives', async () => {
    const wrapper = mount(ReferenceMaterialEntrySelector, {
      props: { catalog: largeCatalogFixture(5), disabled: false },
    });
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.setProps({ catalog: { ...largeCatalogFixture(5), fingerprint: 'd'.repeat(64) } });
    expect(wrapper.get('.material-filter-summary').text()).toContain('已选 0 / 64');
  });
});

describe('useReferenceMaterialAdoption preflight flow', () => {
  function createClient() {
    return {
      getReferenceMaterialAdoptionCatalog: vi.fn(async (referenceId: string) => ({
        catalog: { ...catalogFixture(), referenceId },
        targetSuggestions: {
          world: [], characters: [], relationships: [], outline: [], timeline: [], truncated: false,
        },
      })),
      preflightReferenceMaterialAdoption: vi.fn(async () => ({ preflight: preflightFixture('ready') })),
      listReferenceMaterialAdoptionRecords: vi.fn(async (referenceId: string) => ({
        referenceId, records: [], coverage: 'retainedReviewDataOnly' as const,
      })),
      createReferenceMaterialAdoptionPreview: vi.fn(async () => ({
        status: 'noChanges' as const,
        referenceId: 'ref-adoption',
        referenceTitle: 'Adoption Reference',
        catalogFingerprint: 'c'.repeat(64),
        decisions: [],
        warnings: [],
        canonicalUnchanged: true as const,
      })),
      createReferenceMaterialAdoptionPendingAction: vi.fn(),
    };
  }
  const batch = [{ entryId: 'world-entry', targetFile: 'world/magic/gate.md' }];

  it('previews exactly the preflighted batch, and not after the batch changed', async () => {
    const client = createClient();
    const adoption = useReferenceMaterialAdoption({ client });
    await adoption.load('ref-adoption');
    expect(client.listReferenceMaterialAdoptionRecords).toHaveBeenCalledWith('ref-adoption');

    expect(await adoption.requestPreflightedPreview()).toBe(false);
    expect(await adoption.requestPreflight(batch)).toBe(true);
    adoption.clearPreflight();
    expect(await adoption.requestPreflightedPreview()).toBe(false);
    expect(client.createReferenceMaterialAdoptionPreview).not.toHaveBeenCalled();

    await adoption.requestPreflight(batch);
    expect(await adoption.requestPreflightedPreview()).toBe(true);
    expect(client.createReferenceMaterialAdoptionPreview).toHaveBeenCalledWith('ref-adoption', {
      catalogFingerprint: 'c'.repeat(64),
      selections: batch,
    });
  });

  it('never previews a blocked batch', async () => {
    const client = createClient();
    client.preflightReferenceMaterialAdoption.mockResolvedValue({ preflight: preflightFixture('blocked') });
    const adoption = useReferenceMaterialAdoption({ client });
    await adoption.load('ref-adoption');
    await adoption.requestPreflight(batch);
    expect(adoption.preflight.value?.status).toBe('blocked');
    expect(await adoption.requestPreflightedPreview()).toBe(false);
    expect(client.createReferenceMaterialAdoptionPreview).not.toHaveBeenCalled();
  });

  it('drops a late preflight after switching reference', async () => {
    const client = createClient();
    let release!: (value: { preflight: ReferenceMaterialAdoptionPreflight }) => void;
    client.preflightReferenceMaterialAdoption.mockImplementationOnce(() =>
      new Promise((resolve) => { release = resolve; }));
    const adoption = useReferenceMaterialAdoption({ client });
    await adoption.load('ref-adoption');
    const pending = adoption.requestPreflight(batch);
    await adoption.load('ref-other');
    release({ preflight: preflightFixture('ready') });
    expect(await pending).toBe(false);
    await flushPromises();
    expect(adoption.preflight.value).toBeUndefined();
    expect(adoption.preflighting.value).toBe(false);
    expect(adoption.catalog.value?.referenceId).toBe('ref-other');
  });

  it('keeps adoption usable when records cannot be read', async () => {
    const client = createClient();
    client.listReferenceMaterialAdoptionRecords.mockRejectedValue(new Error('offline'));
    const adoption = useReferenceMaterialAdoption({ client });
    await adoption.load('ref-adoption');
    expect(adoption.recordsError.value).toBe('offline');
    expect(adoption.error.value).toBe('');
    expect(await adoption.requestPreflight(batch)).toBe(true);
  });
});

function preflightFixture(status: 'ready' | 'blocked'): ReferenceMaterialAdoptionPreflight {
  return {
    schemaVersion: 1,
    referenceId: 'ref-adoption',
    catalogFingerprint: 'c'.repeat(64),
    status,
    selectionCount: 1,
    targetCount: status === 'ready' ? 1 : 0,
    materialChars: 45,
    limits: { selections: 64, targets: 32, largeBatchChars: 120000 },
    targets: status === 'ready'
      ? [{ materialKind: 'world', targetFile: 'world/magic/gate.md', entryIds: ['world-entry'], operation: 'update' }]
      : [],
    issues: status === 'ready'
      ? [{
          code: 'existingTarget', severity: 'notice', entryIds: ['world-entry'],
          targetFile: 'world/magic/gate.md', message: 'world/magic/gate.md 已存在，将在现有内容上修改，不会新建。',
        }]
      : [{
          code: 'illegalTargetPath', severity: 'error', entryIds: ['world-entry'],
          targetFile: '../outside.md', message: '「Rain gate」的目标路径不合法。',
        }],
  };
}

function largeCatalogFixture(count: number): ReferenceMaterialAdoptionCatalog {
  const kinds = ['world', 'characters', 'relationships', 'outline', 'timeline'] as const;
  const confidences = ['high', 'medium', 'low'] as const;
  const base = catalogFixture();
  return {
    ...base,
    entries: Array.from({ length: count }, (_, index) => {
      const materialKind = kinds[Math.floor(index / (count / kinds.length))] ?? 'timeline';
      const id = `entry-${String(index).padStart(4, '0')}`;
      return {
        ...base.entries[0]!,
        id,
        materialKind,
        title: `Title ${id}`,
        content: `Content for ${id}.`,
        confidence: confidences[index % 2 === 0 ? 2 : index % 3 === 0 ? 0 : 1],
        ...(index % 5 === 0 ? { uncertainty: 'Source is ambiguous.' } : {}),
        sourcePath: `materials/${materialKind}.yaml` as const,
      };
    }),
  };
}

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
