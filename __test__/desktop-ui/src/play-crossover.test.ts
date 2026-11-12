// @vitest-environment happy-dom
import { effectScope } from 'vue';
import { expect, it, vi } from 'vite-plus/test';
import { usePlayGuidedStart } from '../../../apps/desktop-ui/src/composables/usePlayGuidedStart';

it('prefills only unambiguous accepted adoption targets, preserves author edits, and builds a confirmed contract', async () => {
  const scope = effectScope();
  const listReferences = vi.fn().mockResolvedValue({ references: [{ id: 'a', title: '甲作' }, { id: 'b', title: '乙作' }] });
  const listReferenceMaterialAdoptionRecords = vi.fn(async (id: string) => ({ referenceId: id, coverage: 'retainedReviewDataOnly', records: [
    { status: 'accepted', targets: [{ path: `world/${id}.md`, operation: 'create' }] },
    { status: 'pending', targets: [{ path: 'world/unaccepted.md', operation: 'create' }] },
  ] }));
  const api = { previewPlayLaunchPackage: vi.fn(), createPlayLaunchPackage: vi.fn(), startPlaySessionFromLaunchPackage: vi.fn(), listReferences, listReferenceMaterialAdoptionRecords };
  const guide = scope.run(() => usePlayGuidedStart({ api: api as never, purpose: 'immersiveJourney', tree: ['a', 'b', 'unaccepted'].map(id => ({ name: id, path: `world/${id}.md`, type: 'file' })) }))!;
  try {
    for (const source of guide.sourceOptions.value) guide.toggleSource(source.sourceId, true);
    await guide.prefillSourceWorks();
    expect(guide.crossoverWorks.value.map(work => work.title)).toEqual(['甲作', '乙作']);
    expect(guide.sourceOptions.value.find(source => source.name === 'unaccepted')?.originWork).toBeUndefined();
    expect(guide.originSuggestionNotice.value).toContain('请检查');
    expect(guide.activeSteps.value).toEqual(['sources', 'crossover', 'entry', 'identity', 'cast', 'review']);
    await guide.nextStep(); expect(guide.currentStep.value).toBe('crossover');
    guide.updateCrossover({ rulePrecedence: [{ topic: '', winner: guide.crossoverWorks.value[0]!.id, note: '' }] });
    expect(await guide.nextStep()).toBe(false);
    guide.updateCrossover({ rulePrecedence: [], fusion: 'layered', knowledge: 'shared' });
    expect(await guide.nextStep()).toBe(true);
    expect(guide.buildPreviewInput().crossover).toMatchObject({ fusion: 'layered', knowledge: 'shared' });
    guide.setSourceWork(guide.sourceOptions.value[0]!.sourceId, '作者标注');
    await guide.prefillSourceWorks();
    expect(guide.sourceOptions.value[0]!.originWork?.title).toBe('作者标注');
    guide.reset(); expect(guide.hasCrossover.value).toBe(false);
    expect(guide.buildPreviewInput()).not.toHaveProperty('crossover');
  } finally { scope.stop(); }
});
