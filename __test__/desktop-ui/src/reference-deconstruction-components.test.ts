// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReferenceDeconstructionPanel from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceDeconstructionPanel.vue';
import ReferenceList from '../../../apps/desktop-ui/src/components/workspace/ReferenceList.vue';
import ReferenceContextSelectionPanel from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceContextSelectionPanel.vue';
import ReferenceDiagnostics from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceDiagnostics.vue';
import ReferenceFullDeconstructionProgress from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceFullDeconstructionProgress.vue';
import ReferencePublishReview from '../../../apps/desktop-ui/src/components/workspace/reference/ReferencePublishReview.vue';
import ReferenceQuickPreview from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceQuickPreview.vue';
import {
  approvedReferenceRun,
  entryReferenceContextFixture,
  failedFullReferenceRun,
  previewReferenceRun,
  publishedReferenceFixture,
  publishingReferenceRun,
  referenceFixture,
  referencePublicationFixture,
  reviewReadyReferenceRun,
  runningFullReferenceRun,
} from './support/referenceDeconstructionFixture';

describe('Reference D0-D5 components', () => {
  it('keeps enabled preference, analysis status and context eligibility visibly separate', async () => {
    const reference = referenceFixture();
    const wrapper = mount(ReferenceList, {
      props: {
        references: [reference],
        updatingId: '',
        selectedId: '',
        selectionDisabled: false,
      },
    });

    expect(wrapper.text()).toContain('Preference enabled');
    expect(wrapper.text()).toContain('Analysis');
    expect(wrapper.text()).toContain('notAnalyzed');
    expect(wrapper.text()).toContain('Writing context');
    expect(wrapper.text()).toContain('Not eligible');
    expect(wrapper.text()).toContain('Boundary confidence');
    expect(wrapper.text()).toContain('high');

    await button(wrapper, 'Open').trigger('click');
    await button(wrapper, 'Disable').trigger('click');

    expect(wrapper.emitted('select')).toEqual([[reference]]);
    expect(wrapper.emitted('toggleEnabled')).toEqual([[reference]]);
  });

  it('shows bounded evidence and all no-copy guardrails without exposing source internals', () => {
    const run = previewReferenceRun();
    const wrapper = mount(ReferenceQuickPreview, {
      props: {
        preview: run.preview!,
        evidence: run.evidence,
      },
    });

    expect(wrapper.text()).toContain('Quick Preview');
    expect(wrapper.text()).toContain('0001 · lines 4-22');
    expect(wrapper.text()).toContain('Do not copy');
    expect(wrapper.text()).toContain('Differentiation requirements');
    expect(wrapper.text()).toContain('Differentiation prompts');
    expect(wrapper.text()).toContain('Canon contamination warnings');
    expect(wrapper.text()).not.toContain('chunk-0001-0001');
    expect(wrapper.text()).not.toContain('a'.repeat(64));
    expect(wrapper.html()).not.toContain('v-html');
  });

  it('starts a high-confidence detected range with one click and no override flag', async () => {
    const wrapper = mountPanel({ canStart: true });

    await button(wrapper, 'Analyze preview').trigger('click');

    expect(wrapper.emitted('startPreview')).toEqual([[undefined]]);
    expect(wrapper.text()).toContain('boundary confidence high');
  });

  it('requires a second local confirmation for a low-confidence detected range', async () => {
    const wrapper = mountPanel({
      reference: referenceFixture({
        chapterCount: 8,
        structureConfidence: 'low',
      }),
      canStart: true,
    });

    expect(wrapper.text()).toContain('Boundary confidence low');
    expect(wrapper.text()).toContain('detected first 3 chapter(s) out of 8');
    await button(wrapper, 'Analyze preview').trigger('click');
    expect(wrapper.emitted('startPreview')).toBeUndefined();

    await button(wrapper, 'Confirm detected first 3 chapters').trigger('click');
    expect(wrapper.emitted('startPreview')).toEqual([[true]]);
  });

  it('requires two explicit clicks before full approval and never starts a unit automatically', async () => {
    const run = previewReferenceRun();
    const wrapper = mountPanel({ run, canApprove: true });

    expect(wrapper.text()).toContain('does not publish artifacts');
    expect(wrapper.text()).toContain('start a chapter unit automatically');
    await button(wrapper, 'Continue full deconstruction').trigger('click');
    expect(wrapper.emitted('approveFull')).toBeUndefined();
    expect(button(wrapper, 'Confirm full deconstruction').exists()).toBe(true);

    await button(wrapper, 'Confirm full deconstruction').trigger('click');
    expect(wrapper.emitted('approveFull')).toHaveLength(1);

    await wrapper.setProps({
      run: approvedReferenceRun(),
      canApprove: false,
      canAdvanceFull: true,
    });
    expect(wrapper.text()).toContain('Full Deconstruction');
    expect(wrapper.text()).toContain('0/5 units');
    expect(wrapper.text()).toContain('No full-analysis attempt has started');
    expect(button(wrapper, 'Run next unit').exists()).toBe(true);
  });

  it('offers one explicit retry for interrupted preview and reconciliation for unknown truth', async () => {
    const run = {
      ...previewReferenceRun(),
      preview: undefined,
      evidence: [],
      diagnostics: [],
      status: 'interrupted' as const,
    };
    const wrapper = mountPanel({
      run,
      canAdvance: true,
      needsReconcile: true,
      indeterminate: true,
    });

    expect(wrapper.text()).toContain('no proven terminal result');
    await button(wrapper, 'Retry bounded preview').trigger('click');
    await button(wrapper, 'Reconcile run').trigger('click');
    expect(wrapper.emitted('advancePreview')).toHaveLength(1);
    expect(wrapper.emitted('reconcile')).toHaveLength(1);
  });

  it('explains why blocking diagnostics disable full approval', () => {
    const run = previewReferenceRun();
    const blockingDiagnostic = {
      ...run.diagnostics[0]!,
      severity: 'error' as const,
      blocking: true,
    };
    run.diagnostics = [blockingDiagnostic];
    run.preview = { ...run.preview!, diagnostics: [blockingDiagnostic] };
    const wrapper = mountPanel({ run, canApprove: false });

    expect(wrapper.text()).toContain('1 blocking diagnostic(s) must be resolved');
    expect(button(wrapper, 'Continue full deconstruction').attributes('disabled')).toBeDefined();
  });

  it('presents coverage and attempt history while emitting only explicit full-run actions', async () => {
    const run = runningFullReferenceRun();
    const wrapper = mount(ReferenceFullDeconstructionProgress, {
      props: {
        full: run.full!,
        status: run.status,
        advancing: false,
        pausing: false,
        resuming: false,
        retrying: false,
        canAdvance: true,
        canPause: true,
        canResume: false,
        canRetry: false,
      },
    });

    expect(wrapper.text()).toContain('20%');
    expect(wrapper.text()).toContain('1/5 units');
    expect(wrapper.text()).toContain('1/2 chapters');
    expect(wrapper.text()).toContain('Chapter analysis');
    expect(wrapper.text()).toContain('Attempt 1 · completed');

    await button(wrapper, 'Run next unit').trigger('click');
    await button(wrapper, 'Pause between units').trigger('click');
    expect(wrapper.emitted('advance')).toHaveLength(1);
    expect(wrapper.emitted('pause')).toHaveLength(1);
  });

  it('emits the failed unit identity for an explicit retry and explains the separate advance', async () => {
    const run = failedFullReferenceRun();
    const wrapper = mount(ReferenceFullDeconstructionProgress, {
      props: {
        full: run.full!,
        status: run.status,
        advancing: false,
        pausing: false,
        resuming: false,
        retrying: false,
        canAdvance: false,
        canPause: false,
        canResume: false,
        canRetry: true,
      },
    });

    expect(wrapper.text()).toContain('Retry only requeues this unit');
    expect(wrapper.text()).toContain('separate explicit advance');
    await button(wrapper, 'Retry failed unit').trigger('click');
    expect(wrapper.emitted('retry')).toEqual([['chapter-0001']]);
  });

  it('shows review-ready as analysis-complete but not published', async () => {
    const run = reviewReadyReferenceRun();
    const wrapper = mountPanel({
      run,
      canPublish: true,
    });

    expect(wrapper.text()).toContain('Analysis ready for review');
    expect(wrapper.text()).toContain('Analysis quality: warned');
    expect(wrapper.text()).toContain('the reference bundle has not been published');
    expect(wrapper.text()).toContain('Analysis ready to publish');
    expect(wrapper.text()).toContain('Create publish PendingAction');
    expect(button(wrapper, 'Create publish PendingAction').attributes('disabled')).toBeDefined();
    const warningDetails = wrapper.get('details');
    (warningDetails.element as HTMLDetailsElement).open = true;
    await warningDetails.trigger('toggle');
    expect(button(wrapper, 'Create publish PendingAction').attributes('disabled')).toBeUndefined();
  });

  it('reviews the complete publishing candidate and hands approval to the global PendingAction', async () => {
    const run = publishingReferenceRun();
    const publication = run.publication!;
    const wrapper = mount(ReferencePublishReview, {
      props: {
        publication,
        status: run.status,
        sourceChecksumSha256: run.sourceChecksumSha256,
        pipelineVersion: run.pipelineVersion,
        capabilityVersion: run.capabilityVersion,
        coveragePercent: 100,
        qualityStatus: run.full!.analysisQuality!.status,
        diagnostics: run.diagnostics,
        publishing: false,
        canPublish: false,
      },
    });

    expect(wrapper.text()).toContain('examples/references/reference-1/context/index.yaml');
    expect(wrapper.text()).toContain('writingStyle 1');
    expect(wrapper.text()).toContain('Consequence-first hook');
    expect(wrapper.text()).toContain('Warnings1');
    expect(wrapper.text()).toContain('Review 1 non-blocking warning(s)');
    expect(wrapper.text()).toContain('preview.low-sample');
    expect(wrapper.text()).toContain(publication.candidateFingerprint);
    expect(wrapper.text()).not.toContain('chunk-0001-0001');

    await button(wrapper, 'Review PendingAction').trigger('click');
    expect(wrapper.emitted('reviewPendingAction')).toEqual([
      ['pending-reference-publish-1'],
    ]);
    expect(wrapper.text()).toContain('Awaiting an explicit global approval decision');
  });

  it('explains entry-level inclusion, omission, budget, and the distilled-only boundary', () => {
    const wrapper = mount(ReferenceContextSelectionPanel, {
      props: {
        selection: entryReferenceContextFixture(),
      },
    });

    expect(wrapper.text()).toContain('distilled only');
    expect(wrapper.text()).toContain('142 / 240 tokens');
    expect(wrapper.text()).toContain('4 entry cap');
    expect(wrapper.text()).toContain('Differentiation');
    expect(wrapper.text()).toContain('Reference One · Consequence-first hook');
    expect(wrapper.text()).toContain('hooks · 68 tokens');
    expect(wrapper.text()).toContain('capabilityMatch: Hook intent and capability matched.');
    expect(wrapper.text()).toContain('Tags opening, consequence');
    expect(wrapper.text()).toContain('pacing-1');
    expect(wrapper.text()).toMatch(/entry\s+· pacing/u);
    expect(wrapper.text()).toContain('tokenBudgetExceeded');
    expect(wrapper.text()).toContain('reference');
    expect(wrapper.text()).not.toContain('unexpected source read');
  });

  it('shows the current published inventory after reopening without an active run', () => {
    const wrapper = mountPanel({
      reference: publishedReferenceFixture(),
    });

    expect(wrapper.text()).toContain('Published Selector Entries');
    expect(wrapper.text()).toContain('5 current distilled entries');
    expect(wrapper.text()).toContain('writingStyle 1');
    expect(wrapper.text()).toContain('Context eligible');
    expect(wrapper.text()).toContain('e'.repeat(64));
  });

  it('filters diagnostics by severity, stage, and chapter while retaining blocking context', async () => {
    const failed = failedFullReferenceRun();
    const wrapper = mount(ReferenceDiagnostics, {
      props: {
        diagnostics: [
          ...failed.diagnostics,
          {
            id: 'style-info',
            severity: 'info',
            code: 'style.uncertainty',
            message: 'Style coverage is still provisional.',
            blocking: false,
            evidenceRefs: [],
            stageId: 'styleProfile',
            chapterId: '0002',
          },
        ],
      },
    });
    const [severity, stage, chapter] = wrapper.findAll('select');

    expect(wrapper.text()).toContain('prevent full approval or review-ready quality completion');
    await severity!.setValue('error');
    expect(wrapper.text()).toContain('full.provider_failed');
    expect(wrapper.text()).not.toContain('preview.low-sample');

    await severity!.setValue('all');
    await stage!.setValue('quickPreview');
    expect(wrapper.text()).toContain('preview.low-sample');
    expect(wrapper.text()).not.toContain('style.uncertainty');

    await stage!.setValue('all');
    await chapter!.setValue('0002');
    expect(wrapper.text()).toContain('style.uncertainty');
    expect(wrapper.text()).not.toContain('full.provider_failed');
  });
});

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(ReferenceDeconstructionPanel, {
    props: {
      reference: referenceFixture(),
      run: undefined,
      loadingActiveRun: false,
      creating: false,
      advancing: false,
      cancelling: false,
      approving: false,
      pausing: false,
      resuming: false,
      retrying: false,
      publishing: false,
      reconciling: false,
      indeterminate: false,
      error: '',
      canStart: false,
      canAdvance: false,
      canAdvanceFull: false,
      canPause: false,
      canResume: false,
      canRetry: false,
      canCancel: false,
      canApprove: false,
      canPublish: false,
      needsReconcile: false,
      ...overrides,
    },
  });
}

function button(wrapper: ReturnType<typeof mount>, label: string) {
  const match = wrapper.findAll('button').find((item) => item.text() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}
