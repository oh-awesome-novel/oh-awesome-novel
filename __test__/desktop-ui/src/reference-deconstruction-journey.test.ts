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
  pauseReferenceDeconstructionRun: vi.fn(),
  resumeReferenceDeconstructionRun: vi.fn(),
  retryReferenceDeconstructionRun: vi.fn(),
  cancelReferenceDeconstructionRun: vi.fn(),
  approveFullReferenceDeconstructionRun: vi.fn(),
  publishReferenceDeconstructionRun: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import ReferenceImportTab from '../../../apps/desktop-ui/src/components/workspace/ReferenceImportTab.vue';
import {
  approvedReferenceRun,
  createdReferenceRun,
  entryReferenceContextFixture,
  failedFullReferenceRun,
  mutationResult,
  pausedFullReferenceRun,
  publishedReferenceFixture,
  publishingReferenceRun,
  previewReferenceRun,
  referenceContextFixture,
  referenceFixture,
  referencePublishPendingActionFixture,
  reviewReadyReferenceRun,
  retriedFullReferenceRun,
  runningFullReferenceRun,
} from './support/referenceDeconstructionFixture';

describe('References product D0-D5 journey', () => {
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
    expect(wrapper.text()).toContain('0/6 units');
    expect(wrapper.text()).toContain('Run next unit');
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

  it('advances one full unit, then pauses and resumes without hidden continuation', async () => {
    const approved = approvedReferenceRun();
    const running = runningFullReferenceRun();
    const paused = pausedFullReferenceRun();
    api.getActiveReferenceDeconstructionRun.mockResolvedValue({ run: approved });
    api.advanceReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
    ) => mutationResult({
      ...running,
      mutationReceipts: [
        ...approved.mutationReceipts,
        {
          ...running.mutationReceipts.at(-1)!,
          idempotencyKey: input.idempotencyKey,
        },
      ],
    }, input.idempotencyKey));
    api.pauseReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
    ) => mutationResult({
      ...paused,
      mutationReceipts: [
        ...running.mutationReceipts,
        {
          ...paused.mutationReceipts.at(-1)!,
          idempotencyKey: input.idempotencyKey,
        },
      ],
    }, input.idempotencyKey));
    api.resumeReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
    ) => mutationResult({
      ...running,
      runRevision: 5,
      receiptCount: 6,
      mutationReceipts: [
        ...paused.mutationReceipts,
        {
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: 'f'.repeat(64),
          resultingRunRevision: 5,
          resultStatus: 'fullRunning',
        },
      ],
      updatedAt: '2026-07-22T00:05:00.000Z',
    }, input.idempotencyKey));

    const wrapper = mount(ReferenceImportTab);
    await flushPromises();

    await button(wrapper, 'Run next unit').trigger('click');
    await flushPromises();
    expect(api.advanceReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('1/6 units');
    expect(wrapper.text()).toContain('Attempt 1 · completed');

    await button(wrapper, 'Pause between units').trigger('click');
    await flushPromises();
    expect(api.pauseReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Full analysis paused');
    expect(api.advanceReferenceDeconstructionRun).toHaveBeenCalledTimes(1);

    await button(wrapper, 'Resume full analysis').trigger('click');
    await flushPromises();
    expect(api.resumeReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(api.advanceReferenceDeconstructionRun).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Run next unit');
    wrapper.unmount();
  });

  it('requeues a failed unit without executing it until the next explicit advance', async () => {
    const failed = failedFullReferenceRun();
    const retried = retriedFullReferenceRun();
    api.getActiveReferenceDeconstructionRun.mockResolvedValue({ run: failed });
    api.retryReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
    ) => mutationResult({
      ...retried,
      mutationReceipts: [
        ...failed.mutationReceipts,
        {
          ...retried.mutationReceipts.at(-1)!,
          idempotencyKey: input.idempotencyKey,
        },
      ],
    }, input.idempotencyKey));

    const wrapper = mount(ReferenceImportTab);
    await flushPromises();

    await button(wrapper, 'Retry failed unit').trigger('click');
    await flushPromises();

    expect(api.retryReferenceDeconstructionRun).toHaveBeenCalledWith(
      'reference-1',
      'run-1',
      expect.objectContaining({ unitId: 'chapter-0001' }),
    );
    expect(api.advanceReferenceDeconstructionRun).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Run next unit');
    wrapper.unmount();
  });

  it('hands a review-ready candidate to global approval and reopens on entry-level truth', async () => {
    const reviewReady = reviewReadyReferenceRun();
    api.getActiveReferenceDeconstructionRun.mockResolvedValue({ run: reviewReady });
    api.publishReferenceDeconstructionRun.mockImplementation(async (
      _referenceId: string,
      _runId: string,
      input: { idempotencyKey: string },
    ) => {
      const run = publishingReferenceRun(input.idempotencyKey);
      return {
        run,
        receipt: run.mutationReceipts.at(-1)!,
        replayed: false,
        pendingAction: referencePublishPendingActionFixture(),
      };
    });

    const wrapper = mount(ReferenceImportTab);
    await flushPromises();

    expect(wrapper.text()).toContain('Analysis ready to publish');
    const warningDetails = wrapper.get('details');
    (warningDetails.element as HTMLDetailsElement).open = true;
    await warningDetails.trigger('toggle');
    await button(wrapper, 'Create publish PendingAction').trigger('click');
    await flushPromises();

    expect(api.publishReferenceDeconstructionRun).toHaveBeenCalledWith(
      'reference-1',
      'run-1',
      expect.objectContaining({
        baseRunRevision: reviewReady.runRevision,
        idempotencyKey: expect.any(String),
      }),
    );
    expect(wrapper.emitted('reviewPendingAction')).toEqual([
      ['pending-reference-publish-1'],
    ]);
    expect(wrapper.text()).toContain('Publish Review');
    expect(wrapper.text()).toContain('5');
    expect(wrapper.text()).toContain('Approval pending');
    wrapper.unmount();

    api.listReferences.mockResolvedValue({
      references: [publishedReferenceFixture()],
    });
    api.getActiveReferenceDeconstructionRun.mockResolvedValue({ run: null });
    api.selectReferenceContext.mockResolvedValue({
      selection: entryReferenceContextFixture(),
    });

    const reopened = mount(ReferenceImportTab);
    await flushPromises();

    expect(reopened.text()).toContain('1 context eligible');
    expect(reopened.text()).toContain('Published Selector Entries');
    expect(reopened.text()).toContain('5 current distilled entries');
    expect(reopened.text()).toContain('Reference One · Consequence-first hook');
    expect(reopened.text()).toContain('distilled only');
    expect(reopened.text()).toContain('142 / 240 tokens');
    expect(reopened.text()).not.toContain('chunk-0001-0001');
    reopened.unmount();
  });
});

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const match = wrapper.findAll('button').find((item) => item.text() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}
