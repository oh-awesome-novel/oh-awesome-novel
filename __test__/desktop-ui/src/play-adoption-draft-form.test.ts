// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vite-plus/test';

import PlayAdoptionDraftForm from '../../../apps/desktop-ui/src/components/play/PlayAdoptionDraftForm.vue';
import type {
  PlayAdoptionPendingActionView,
  PlayAdoptionPreviewView,
} from '../../../apps/desktop-ui/src/composables/usePlayAdoptionPreview';

describe('PlayAdoptionDraftForm', () => {
  it('fills typed forms for four targets, shows a read-only JSON view, real diff and explicit Review', async () => {
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

    expect(document.activeElement).toBe(wrapper.get('[aria-label="带回写作"]').element);
    const targetSelect = wrapper.findAll('select')[0]!;
    expect(targetSelect.findAll('option').map((option) => option.attributes('value')))
      .toEqual(['chapterDraft', 'state', 'timeline', 'foreshadow']);
    expect(targetSelect.findAll('option').map((option) => option.text()))
      .toEqual(['章节草稿', '状态', '时间线', '伏笔']);
    expect(wrapper.text()).toContain('建议');
    expect(wrapper.text()).toContain('推荐');
    expect(wrapper.text()).toContain('写入章节 Markdown');
    expect(wrapper.text()).toContain('目标章节');
    expect(wrapper.text()).toContain('0001/0001');
    expect(wrapper.text()).not.toContain('Editable JSON payload');
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('The public gate is locked.');
    expect(wrapper.get('[aria-label="将提交的 JSON（只读）"]').text()).toContain('"chapterId": "0001/0001"');
    expect(wrapper.get('[aria-label="改动 diff 预览"]').text()).toContain('+The public gate is locked.');
    expect(wrapper.text()).toContain('还没有创建待确认改动');
    expect(wrapper.text()).toContain('正式文件没有变化');
    expect(wrapper.get('[aria-live="polite"]').attributes('role')).toBe('status');

    await button(wrapper, '确认并创建待确认改动').trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);

    // Editing a field invalidates the preview until it is regenerated.
    await wrapper.get('textarea').setValue('');
    expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('请填写正文。');
    expect(button(wrapper, '确认并创建待确认改动').attributes('disabled')).toBeDefined();

    await targetSelect.setValue('state');
    expect(wrapper.text()).toContain('写入状态 YAML');
    expect(wrapper.text()).toContain('字段与新值');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('preview')?.at(-1)).toEqual([{
      target: 'state',
      payload: {
        file: 'characters.yaml',
        path: 'characters.heroine',
        value: { location: 'east gate' },
      },
    }]);
    await button(wrapper, '添加一行').trigger('click');
    const rowInputs = wrapper.findAll('.play-adoption-row input');
    await rowInputs[2]!.setValue('mood');
    await rowInputs[3]!.setValue('wary');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('preview')?.at(-1)?.[0]).toMatchObject({
      payload: { value: { location: 'east gate', mood: 'wary' } },
    });
    await rowInputs[2]!.setValue('bad key');
    expect(wrapper.text()).toContain('字段名只能包含文字、数字、下划线或连字符。');

    await targetSelect.setValue('timeline');
    for (const label of ['世界内时间', '事件', '参与者', '地点']) expect(wrapper.text()).toContain(label);
    await targetSelect.setValue('foreshadow');
    for (const label of ['伏笔描述', '埋设位置', '预期回收条件']) expect(wrapper.text()).toContain(label);

    const pendingAction: PlayAdoptionPendingActionView = {
      id: 'pa_adoption_1',
      title: 'Adopt Play evidence',
      description: 'Prepare the chapter change.',
      changes: [{
        operation: 'update',
        path: 'chapters/0001/0001.md',
        oldHash: 'a'.repeat(64),
        newHash: 'b'.repeat(64),
      }],
      diff: preview.diff,
      createdAt: '2026-07-16T05:00:00.000Z',
      status: 'pending',
    };
    await wrapper.setProps({ pendingAction });
    expect(wrapper.text()).toContain('pa_adoption_1');
    expect(wrapper.text()).toContain('在审阅中接受之前，正式文件不会改变。');

    await button(wrapper, '去审阅').trigger('click');
    expect(wrapper.emitted('review')?.at(-1)).toEqual(['pa_adoption_1']);

    await wrapper.get('[aria-label="带回写作"]').trigger('keydown', {
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
      recommended: true,
      reason: 'Append the selected evidence to a chapter draft.',
      defaultPayload: {
        chapterId: '0001/0001',
        content: 'The public gate is locked.',
      },
    }, {
      target: 'state',
      recommended: false,
      reason: 'Record the lasting location state.',
      defaultPayload: {
        file: 'characters.yaml',
        path: 'characters.heroine',
        value: { location: 'east gate' },
      },
    }, {
      target: 'timeline',
      recommended: false,
      reason: 'Record a dated event.',
      defaultPayload: {
        event: { summary: 'The public gate is locked.' },
      },
    }, {
      target: 'foreshadow',
      recommended: false,
      reason: 'Preserve it as a future callback.',
      defaultPayload: {
        item: { summary: 'The public gate is locked.' },
      },
    }],
    target: 'chapterDraft',
    payload: {
      chapterId: '0001/0001',
      content: 'The public gate is locked.',
    },
    changes: [{
      operation: 'update',
      path: 'chapters/0001/0001.md',
      oldHash: 'a'.repeat(64),
      newHash: 'b'.repeat(64),
    }],
    diff: '--- a/chapters/0001.md\n+++ b/chapters/0001.md\n+The public gate is locked.',
    fingerprint: 'd'.repeat(64),
    canonicalUnchanged: true,
  };
}
