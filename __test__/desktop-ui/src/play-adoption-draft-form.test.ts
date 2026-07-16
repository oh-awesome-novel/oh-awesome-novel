// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';

import PlayAdoptionDraftForm from '../../../apps/desktop-ui/src/components/play/PlayAdoptionDraftForm.vue';
import type {
  PlayAdoptionPendingActionView,
  PlayAdoptionPreviewView,
} from '../../../apps/desktop-ui/src/composables/usePlayAdoptionPreview';

describe('PlayAdoptionDraftForm', () => {
  it('shows four server-backed targets, editable payload, real diff, and explicit Review', async () => {
    const preview = createPreview();
    const wrapper = mount(PlayAdoptionDraftForm, {
      attachTo: document.body,
      props: {
        seed: { kind: 'event', eventId: 'event-visible-1' },
        preview,
        previewing: false,
        confirming: false,
        disabled: false,
        error: '',
      },
    });
    await nextTick();

    expect(document.activeElement).toBe(wrapper.get('[aria-label="Play adoption preview"]').element);
    expect(wrapper.findAll('select option').map((option) => option.attributes('value')))
      .toEqual(['chapterDraft', 'state', 'timeline', 'foreshadow']);
    expect(wrapper.text()).toContain('Server suggestion');
    expect(wrapper.text()).toContain('recommended');
    expect(wrapper.text()).toContain('Append the selected evidence to a chapter draft.');
    expect(wrapper.text()).toContain('chapters/0001.md');
    expect(wrapper.get('[aria-label="Canonical diff preview"]').text()).toContain(
      '+The public gate is locked.',
    );
    expect(wrapper.text()).toContain('no PendingAction has been created');
    expect(wrapper.text()).toContain('canonical files are unchanged');
    expect(wrapper.get('[aria-live="polite"]').attributes('role')).toBe('status');

    await button(wrapper, 'Confirm and create PendingAction').trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);

    await wrapper.get('select').setValue('state');
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toContain(
      'characters.heroine.location',
    );
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('preview')?.at(-1)).toEqual([{
      target: 'state',
      payload: {
        file: 'characters.yaml',
        path: 'characters.heroine.location',
        value: 'east gate',
      },
    }]);

    await wrapper.get('textarea').setValue('{invalid');
    expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('Payload must be valid JSON.');

    const pendingAction: PlayAdoptionPendingActionView = {
      id: 'pa_adoption_1',
      title: 'Adopt Play evidence',
      description: 'Prepare the chapter change.',
      touchedFiles: ['chapters/0001.md'],
      diff: preview.diff,
      createdAt: '2026-07-16T05:00:00.000Z',
      status: 'pending',
    };
    await wrapper.setProps({ pendingAction });
    expect(wrapper.text()).toContain('pa_adoption_1');
    expect(wrapper.text()).toContain('Canonical files remain unchanged until Review');

    await button(wrapper, 'Review PendingAction').trigger('click');
    expect(wrapper.emitted('review')?.at(-1)).toEqual(['pa_adoption_1']);

    await wrapper.get('[aria-label="Play adoption preview"]').trigger('keydown', {
      key: 'Escape',
    });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });
});

function button(wrapper: ReturnType<typeof mount>, text: string) {
  const match = wrapper.findAll('button').find((candidate) => candidate.text() === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

function createPreview(): PlayAdoptionPreviewView {
  return {
    id: 'pa_adoption_1',
    summary: 'The public gate is locked.',
    evidence: 'The selected branch contains a visible gate-closing event.',
    visibility: 'playerVisible',
    suggestions: [{
      target: 'chapterDraft',
      toolName: 'chapter.createDraft',
      recommended: true,
      reason: 'Append the selected evidence to a chapter draft.',
      defaultPayload: {
        chapterId: '0001',
        content: 'The public gate is locked.',
      },
    }, {
      target: 'state',
      toolName: 'state.set',
      recommended: false,
      reason: 'Record the lasting location state.',
      defaultPayload: {
        file: 'characters.yaml',
        path: 'characters.heroine.location',
        value: 'east gate',
      },
    }, {
      target: 'timeline',
      toolName: 'timeline.add',
      recommended: false,
      reason: 'Record a dated event.',
      defaultPayload: {
        event: { summary: 'The public gate is locked.' },
      },
    }, {
      target: 'foreshadow',
      toolName: 'foreshadow.create',
      recommended: false,
      reason: 'Preserve it as a future callback.',
      defaultPayload: {
        item: { summary: 'The public gate is locked.' },
      },
    }],
    target: 'chapterDraft',
    payload: {
      chapterId: '0001',
      content: 'The public gate is locked.',
    },
    touchedFiles: ['chapters/0001.md'],
    diff: '--- a/chapters/0001.md\n+++ b/chapters/0001.md\n+The public gate is locked.',
    fingerprint: 'd'.repeat(64),
    canonicalUnchanged: true,
  };
}
