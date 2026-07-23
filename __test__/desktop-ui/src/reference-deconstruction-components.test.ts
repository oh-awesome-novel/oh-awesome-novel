// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ReferenceDeconstructionPanel from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceDeconstructionPanel.vue';
import ReferenceList from '../../../apps/desktop-ui/src/components/workspace/ReferenceList.vue';
import ReferenceQuickPreview from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceQuickPreview.vue';
import {
  previewReferenceRun,
  referenceFixture,
} from './support/referenceDeconstructionFixture';

describe('Reference D0/D1 components', () => {
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

  it('requires two explicit clicks before full approval and states that D2 did not start', async () => {
    const run = previewReferenceRun();
    const wrapper = mountPanel({ run, canApprove: true });

    await button(wrapper, 'Continue full deconstruction').trigger('click');
    expect(wrapper.emitted('approveFull')).toBeUndefined();
    expect(button(wrapper, 'Confirm full deconstruction').exists()).toBe(true);

    await button(wrapper, 'Confirm full deconstruction').trigger('click');
    expect(wrapper.emitted('approveFull')).toHaveLength(1);

    await wrapper.setProps({
      run: {
        ...run,
        status: 'fullApproved',
        runRevision: 2,
        fullApprovedAt: '2026-07-22T00:02:00.000Z',
      },
      canApprove: false,
    });
    expect(wrapper.text()).toContain('D2 chapter processing is not part of this slice');
    expect(wrapper.text()).toContain('has not started');
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
      reconciling: false,
      indeterminate: false,
      error: '',
      canStart: false,
      canAdvance: false,
      canCancel: false,
      canApprove: false,
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
