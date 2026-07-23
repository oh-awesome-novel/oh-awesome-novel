// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listReferences: vi.fn(),
  importReference: vi.fn(),
  setReferenceEnabled: vi.fn(),
  selectReferenceContext: vi.fn(),
  createReferenceDeconstructionRun: vi.fn(),
  getReferenceDeconstructionRun: vi.fn(),
  getActiveReferenceDeconstructionRun: vi.fn(),
  advanceReferenceDeconstructionRun: vi.fn(),
  cancelReferenceDeconstructionRun: vi.fn(),
  approveFullReferenceDeconstructionRun: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import ReferenceImportTab from '../../../apps/desktop-ui/src/components/workspace/ReferenceImportTab.vue';
import {
  approvedReferenceRun,
  createdReferenceRun,
  mutationResult,
  previewReferenceRun,
  referenceContextFixture,
  referenceFixture,
} from './support/referenceDeconstructionFixture';

describe('References product D0/D1 journey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listReferences.mockResolvedValue({ references: [referenceFixture()] });
    api.getActiveReferenceDeconstructionRun.mockResolvedValue({ run: null });
    api.selectReferenceContext.mockResolvedValue({ selection: referenceContextFixture() });
  });

  it('moves from imported/not-analyzed through bounded preview to explicit full approval', async () => {
    let createKey = '';
    let advanceKey = '';
    api.createReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      input: { idempotencyKey: string },
    ) => {
      createKey = input.idempotencyKey;
      return mutationResult(createdReferenceRun(createKey), createKey);
    });
    api.advanceReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
      options?: { signal?: AbortSignal },
    ) => {
      expect(options?.signal?.aborted).toBe(false);
      advanceKey = input.idempotencyKey;
      return mutationResult(previewReferenceRun(createKey, advanceKey), advanceKey);
    });
    api.approveFullReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
    ) => mutationResult(
      approvedReferenceRun(createKey, advanceKey, input.idempotencyKey),
      input.idempotencyKey,
    ));

    const wrapper = mount(ReferenceImportTab);
    await flushPromises();

    expect(wrapper.text()).toContain('1 enabled preferences · 0 context eligible · 1 total');
    expect(wrapper.text()).toContain('notAnalyzed');
    expect(wrapper.text()).toContain('No eligible reference context selected.');
    expect(wrapper.text()).toContain('Omitted L2 · notAnalyzed');
    expect(api.selectReferenceContext).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'novel.write_chapter',
      tokenBudget: 1500,
      maxReferences: 3,
    }));

    await button(wrapper, 'Analyze preview').trigger('click');
    await flushPromises();

    expect(api.createReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(api.createReferenceDeconstructionRun.mock.calls[0]?.[1])
      .not.toHaveProperty('confirmDetectedRange');
    expect(api.advanceReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Preview ready');
    expect(wrapper.text()).toContain('A bounded preview of the opening pressure');
    expect(wrapper.text()).toContain('Do not copy source wording');

    await button(wrapper, 'Continue full deconstruction').trigger('click');
    expect(api.approveFullReferenceDeconstructionRun).not.toHaveBeenCalled();
    await button(wrapper, 'Confirm full deconstruction').trigger('click');
    await flushPromises();

    expect(api.approveFullReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Full analysis approved');
    expect(wrapper.text()).toContain('D2 chapter processing is not part of this slice');
    expect(wrapper.text()).toContain('has not started');
    expect(wrapper.text()).not.toContain('chunk-0001-0001');
    wrapper.unmount();
  });

  it('requires two clicks and sends an explicit range confirmation for low confidence', async () => {
    api.listReferences.mockResolvedValue({
      references: [referenceFixture({
        chapterCount: 7,
        structureConfidence: 'low',
      })],
    });
    let createKey = '';
    api.createReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      input: { idempotencyKey: string; confirmDetectedRange?: true },
    ) => {
      createKey = input.idempotencyKey;
      return mutationResult(createdReferenceRun(createKey), createKey);
    });
    api.advanceReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
    ) => mutationResult(
      previewReferenceRun(createKey, input.idempotencyKey),
      input.idempotencyKey,
    ));

    const wrapper = mount(ReferenceImportTab);
    await flushPromises();

    expect(wrapper.text()).toContain('Boundary confidence low');
    expect(wrapper.text()).toContain('detected first 3 chapter(s) out of 7');
    await button(wrapper, 'Analyze preview').trigger('click');
    expect(api.createReferenceDeconstructionRun).not.toHaveBeenCalled();

    await button(wrapper, 'Confirm detected first 3 chapters').trigger('click');
    await flushPromises();

    expect(api.createReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(api.createReferenceDeconstructionRun.mock.calls[0]?.[1])
      .toMatchObject({ confirmDetectedRange: true });
    expect(wrapper.text()).toContain('Preview ready');
    wrapper.unmount();
  });
});

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const match = wrapper.findAll('button').find((item) => item.text() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}
