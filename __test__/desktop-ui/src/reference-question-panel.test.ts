// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ReferenceQuestionPanel from '../../../apps/desktop-ui/src/components/workspace/reference/ReferenceQuestionPanel.vue';
import { referenceFixture } from './support/referenceDeconstructionFixture';

describe('ReferenceQuestionPanel', () => {
  it('asks a question and renders the answer with evidence lines and copy warning', async () => {
    const reference = referenceFixture();
    const ask = vi.fn(async () => ({
      status: 'completed' as const,
      answer: {
        question: 'How is the twist hidden?',
        answer: 'Action first, explanation later.',
        findings: [{ observation: 'The letter is hidden.', technique: 'Delayed reveal.', evidenceRefs: ['p-1'] }],
        uncertainties: ['Only two chapters were read.'],
        evidence: [{ pointerId: 'p-1', chapterId: '0002', lineStart: 3, lineEnd: 4 }],
        copyRisk: true,
      },
    }));
    const wrapper = mount(ReferenceQuestionPanel, { props: { reference, ask } });

    await wrapper.get('textarea').setValue('  How is the twist hidden?  ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(ask).toHaveBeenCalledWith(reference.id, 'How is the twist hidden?', { signal: expect.any(AbortSignal) });
    expect(wrapper.text()).toContain('Action first, explanation later.');
    expect(wrapper.text()).toContain('0002 · L3-4');
    expect(wrapper.text()).toContain('Delayed reveal.');
    expect(wrapper.text()).toContain('repeats the source verbatim');
  });

  it('shows a failed answer as an error', async () => {
    const ask = vi.fn(async () => ({
      status: 'failed' as const,
      error: { code: 'invalid_output', message: 'Answer did not pass evidence validation.', retryable: false },
    }));
    const wrapper = mount(ReferenceQuestionPanel, { props: { reference: referenceFixture(), ask } });
    await wrapper.get('textarea').setValue('Why?');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('evidence validation');
  });
});
