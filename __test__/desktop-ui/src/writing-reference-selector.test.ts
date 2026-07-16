// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { PlayWritingReferenceAttachment } from '@oh-awesome-novel/client';

import WritingReferenceSelector from '../../../apps/desktop-ui/src/components/workspace/WritingReferenceSelector.vue';

describe('WritingReferenceSelector', () => {
  it('lists attachment status and enforces the eight-reference request limit', async () => {
    const attachments = [
      ...Array.from({ length: 9 }, (_, index) =>
        createAttachment(`active-${index + 1}`, 'active')),
      createAttachment('detached-1', 'detached'),
      createAttachment('stale-1', 'stale'),
    ];
    const selectedAttachmentIds = attachments.slice(0, 8).map((attachment) => attachment.id);
    const wrapper = mount(WritingReferenceSelector, {
      props: {
        attachments,
        selectedAttachmentIds,
        loading: false,
        error: '',
        disabled: false,
      },
    });

    expect(wrapper.text()).toContain('已选择 8 / 8 个');
    expect(wrapper.text()).toContain('active');
    expect(wrapper.text()).toContain('detached');
    expect(wrapper.text()).toContain('stale');
    expect(wrapper.findAll('.writing-reference-option')).toHaveLength(11);
    expect(checkbox(wrapper, 'active-1').element.checked).toBe(true);
    expect(checkbox(wrapper, 'active-1').element.disabled).toBe(false);
    expect(checkbox(wrapper, 'active-9').element.disabled).toBe(true);
    expect(checkbox(wrapper, 'detached-1').element.disabled).toBe(true);
    expect(checkbox(wrapper, 'stale-1').element.disabled).toBe(true);

    await checkbox(wrapper, 'active-1').setValue(false);
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['active-1']);
    await wrapper.get('button[aria-label="Refresh Play Writing References"]').trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
  });

  it('announces loading and errors without enabling selection', () => {
    const attachment = createAttachment('active-1', 'active');
    const loading = mount(WritingReferenceSelector, {
      props: {
        attachments: [attachment],
        selectedAttachmentIds: [],
        loading: true,
        error: '',
        disabled: false,
      },
    });
    expect(loading.get('[role="status"]').attributes('aria-live')).toBe('polite');
    expect(loading.text()).toContain('正在读取');

    const failed = mount(WritingReferenceSelector, {
      props: {
        attachments: [attachment],
        selectedAttachmentIds: [],
        loading: false,
        error: 'attachment list unavailable',
        disabled: false,
      },
    });
    expect(failed.get('[role="alert"]').text()).toBe('attachment list unavailable');
  });
});

function checkbox(wrapper: ReturnType<typeof mount>, id: string) {
  return wrapper.get<HTMLInputElement>(
    `input[aria-label="Use Writing Reference ${id} (${id.startsWith('detached')
      ? 'detached'
      : id.startsWith('stale') ? 'stale' : 'active'})"]`,
  );
}

function createAttachment(
  id: string,
  status: PlayWritingReferenceAttachment['status'],
): PlayWritingReferenceAttachment {
  return {
    schemaVersion: 1,
    id,
    sessionId: 'play-1',
    reportRef: '.workspace/play-sessions/play-1/reports/outcome.yaml',
    reportFingerprint: 'a'.repeat(64),
    selectedOutcomeItemRefs: [`item-${id}`],
    selectedArtifactTurnRefs: ['turn-public'],
    evidenceClosureRefs: ['artifact:turn-public'],
    sourceSnapshots: [],
    status,
    createdAt: '2026-07-16T00:00:00.000Z',
    ...(status === 'detached'
      ? { detachedAt: '2026-07-16T01:00:00.000Z' }
      : {}),
  };
}
