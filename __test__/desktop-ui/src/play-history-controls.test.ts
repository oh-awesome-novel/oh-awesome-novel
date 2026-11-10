// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';

import PlayHistoryControls from '../../../apps/desktop-ui/src/components/play/PlayHistoryControls.vue';
import type { PlayCheckpointSummary } from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';

describe('PlayHistoryControls', () => {
  it('renders one parent-ordered worldline rooted at the explicit initial world', () => {
    const wrapper = mountControls();
    const nodeIds = wrapper.findAll('[data-worldline-checkpoint]').map((node) =>
      node.attributes('data-worldline-checkpoint'));

    expect(nodeIds).toEqual([
      'initial-world',
      'turn-ancestor',
      'turn-current',
      'turn-variant',
    ]);
    expect(wrapper.get('.play-history-heading').text()).toContain('世界线');
    expect(wrapper.find('.play-history-group').exists()).toBe(false);
    expect(wrapper.get('[data-worldline-checkpoint="initial-world"]').text()).toContain(
      '初始世界',
    );
    expect(wrapper.get('[data-worldline-checkpoint="turn-variant"]').text()).toContain(
      '保留的另一结果',
    );
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Current scene');
    expect(wrapper.get('.play-history-controls').attributes('aria-busy')).toBe('false');
    expect(wrapper.get('[role="status"]').text()).toBe('History ready.');
    wrapper.unmount();
  });

  it('focuses inline confirmation and returns focus after cancelling initial restore', async () => {
    const wrapper = mountControls();
    const restore = wrapper.get(
      '.play-history-restore[data-checkpoint-id="initial-world"]',
    );

    await restore.trigger('click');
    await flushPromises();

    const confirm = wrapper.get('.play-history-confirm');
    expect(document.activeElement).toBe(confirm.element);
    expect(wrapper.get('.play-history-confirmation').text()).toContain(
      '回到初始世界？',
    );
    expect(wrapper.get('.play-history-confirmation').text()).toContain(
      '之后的回合会保留为其他结果，不会删除。',
    );

    await confirm.trigger('keydown', { key: 'Escape' });
    await flushPromises();

    expect(wrapper.find('.play-history-confirmation').exists()).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('.play-history-restore[data-checkpoint-id="initial-world"]').element,
    );
    wrapper.unmount();
  });

  it('emits checkpoint ids only after confirmation and disables restore while blocked', async () => {
    const wrapper = mountControls({ blocked: true });
    const restore = wrapper.get(
      '.play-history-restore[data-checkpoint-id="turn-variant"]',
    );

    expect(restore.attributes('disabled')).toBeDefined();
    await wrapper.setProps({ blocked: false });
    await restore.trigger('click');
    await flushPromises();

    await wrapper.setProps({ blocked: true });
    expect(wrapper.get('.play-history-confirm').attributes('disabled')).toBeDefined();
    await wrapper.get('.play-history-confirm').trigger('click');
    expect(wrapper.emitted('restore')).toBeUndefined();

    await wrapper.setProps({ blocked: false });
    await wrapper.get('.play-history-confirm').trigger('click');

    expect(wrapper.emitted('restore')).toEqual([['turn-variant']]);
    expect(wrapper.find('.play-history-confirmation').exists()).toBe(false);

    await wrapper.setProps({ busyArtifactId: 'turn-variant' });
    expect(wrapper.get('.play-history-controls').attributes('aria-busy')).toBe('true');
    expect(wrapper.get('[role="status"]').text()).toBe('正在回到这里…');
    wrapper.unmount();
  });

  it('confirms Retry inline and keeps the prior outcome visible as a variant', async () => {
    const wrapper = mountControls();
    const retry = wrapper.get(
      '.play-history-retry[data-checkpoint-id="turn-current"]',
    );

    await retry.trigger('click');
    await flushPromises();

    const confirm = wrapper.get('.play-history-confirm');
    expect(document.activeElement).toBe(confirm.element);
    expect(wrapper.get('.play-history-confirmation').text()).toContain(
      '从这一回合开始前重演？',
    );
    expect(wrapper.get('.play-history-confirmation').text()).toContain(
      '现有结果会保留为另一个结果',
    );

    await confirm.trigger('click');
    expect(wrapper.emitted('retry')).toEqual([['turn-current']]);
    wrapper.unmount();
  });

  it('sends optional retry guidance, trims it, and blocks guidance over 500 characters', async () => {
    const wrapper = mountControls();
    await wrapper.get('.play-history-retry[data-checkpoint-id="turn-current"]').trigger('click');
    await flushPromises();
    const box = wrapper.get<HTMLTextAreaElement>('.play-retry-guidance');
    expect(wrapper.get('.play-history-confirmation').text()).toContain('这次希望有什么不同（可选）');
    expect(wrapper.get('.play-history-confirmation').text()).toContain('参与者视角看不到');

    await box.setValue('字'.repeat(501));
    expect(box.attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('.play-history-confirm').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('最多 500 字，当前 501 字。');

    await box.setValue('  别让她这么快妥协。  ');
    await wrapper.get('.play-history-confirm').trigger('click');
    expect(wrapper.emitted('retry')).toEqual([['turn-current', '别让她这么快妥协。']]);

    // A fresh confirmation starts empty again.
    await wrapper.setProps({ sessionRevision: 8 });
    await wrapper.get('.play-history-retry[data-checkpoint-id="turn-current"]').trigger('click');
    await flushPromises();
    expect(wrapper.get<HTMLTextAreaElement>('.play-retry-guidance').element.value).toBe('');
    await wrapper.get('.play-history-confirm').trigger('click');
    expect(wrapper.emitted('retry')?.at(-1)).toEqual(['turn-current']);
    wrapper.unmount();
  });

  it('shows retry guidance only in the Director view, never in the Player view', async () => {
    const checkpoints = createCheckpoints().map((checkpoint) => checkpoint.checkpointId === 'turn-variant'
      ? { ...checkpoint, retryGuidance: '让守卫更早出现。' }
      : checkpoint);
    const player = mountControls({ checkpoints });
    expect(player.text()).not.toContain('让守卫更早出现。');
    expect(player.find('.play-worldline-guidance').exists()).toBe(false);
    expect(player.html()).not.toContain('让守卫更早出现');
    player.unmount();

    const director = mountControls({ checkpoints, directorLens: true });
    expect(director.get('[data-worldline-checkpoint="turn-variant"] .play-worldline-guidance').text())
      .toContain('让守卫更早出现。');
    director.unmount();
  });

  it('returns focus to the stable worldline node after Restore succeeds', async () => {
    const wrapper = mountControls();
    const checkpointId = 'turn-variant';

    await wrapper.get(
      `.play-history-restore[data-checkpoint-id="${checkpointId}"]`,
    ).trigger('click');
    await flushPromises();
    await wrapper.get('.play-history-confirm').trigger('click');
    await wrapper.setProps({
      busyArtifactId: checkpointId,
      notice: '',
    });
    await wrapper.setProps({
      busyArtifactId: '',
      sessionRevision: 8,
      notice: 'Worldline restored.',
    });
    await flushPromises();

    const node = wrapper.get(`[data-worldline-checkpoint="${checkpointId}"]`);
    const status = wrapper.get('[role="status"]');
    expect(document.activeElement).toBe(node.element);
    expect(node.attributes('tabindex')).toBe('-1');
    expect(status.attributes('aria-live')).toBe('polite');
    expect(status.text()).toBe('Worldline restored.');
    wrapper.unmount();
  });

  it('returns focus to the retained outcome node after Retry succeeds', async () => {
    const wrapper = mountControls();
    const checkpointId = 'turn-current';

    await wrapper.get(
      `.play-history-retry[data-checkpoint-id="${checkpointId}"]`,
    ).trigger('click');
    await flushPromises();
    await wrapper.get('.play-history-confirm').trigger('click');
    await wrapper.setProps({
      retryingArtifactId: checkpointId,
      notice: '',
    });
    await wrapper.setProps({
      retryingArtifactId: '',
      sessionRevision: 8,
      notice: 'Retry committed; the previous result remains a variant.',
    });
    await flushPromises();

    const node = wrapper.get(`[data-worldline-checkpoint="${checkpointId}"]`);
    const status = wrapper.get('[role="status"]');
    expect(document.activeElement).toBe(node.element);
    expect(status.attributes('aria-atomic')).toBe('true');
    expect(status.text()).toContain('previous result remains a variant');
    wrapper.unmount();
  });

  it('emits normalized names and keeps ids and revisions in folded details', async () => {
    const wrapper = mountControls();
    const currentNode = wrapper.get('[data-worldline-checkpoint="turn-current"]');
    const technicalDetails = currentNode.get('.play-worldline-technical');

    expect(technicalDetails.attributes('open')).toBeUndefined();
    expect(technicalDetails.text()).toContain('turn-current');
    expect(technicalDetails.text()).toContain('Revision');
    expect(technicalDetails.text()).toContain('会话 revision 7');

    await currentNode.get('.play-worldline-name').trigger('click');
    await flushPromises();

    const input = currentNode.get('input');
    expect(document.activeElement).toBe(input.element);
    await input.setValue('  Station lockdown  ');
    await currentNode.get('form').trigger('submit');

    expect(wrapper.emitted('name')).toEqual([
      ['turn-current', 'Station lockdown'],
    ]);
    wrapper.unmount();
  });

  it('returns focus to the named worldline node after naming succeeds', async () => {
    const wrapper = mountControls();
    const checkpointId = 'turn-current';
    const node = wrapper.get(`[data-worldline-checkpoint="${checkpointId}"]`);

    await node.get('.play-worldline-name').trigger('click');
    await flushPromises();
    await node.get('input').setValue('Station lockdown');
    await node.get('form').trigger('submit');
    await wrapper.setProps({
      namingCheckpointId: checkpointId,
      notice: '',
    });
    await wrapper.setProps({
      namingCheckpointId: '',
      sessionRevision: 8,
      notice: '存档点已命名。',
    });
    await flushPromises();

    const stableNode = wrapper.get(
      `[data-worldline-checkpoint="${checkpointId}"]`,
    );
    const status = wrapper.get('[role="status"]');
    expect(document.activeElement).toBe(stableNode.element);
    expect(status.attributes('aria-live')).toBe('polite');
    expect(status.text()).toBe('存档点已命名。');
    wrapper.unmount();
  });

  it('disables Retry without a provider and announces active Retry and naming work', async () => {
    const wrapper = mountControls({
      retryDisabled: true,
      retryDisabledReason: 'Configure a provider to Retry.',
    });
    const retry = wrapper.get(
      '.play-history-retry[data-checkpoint-id="turn-current"]',
    );

    expect(retry.attributes('disabled')).toBeDefined();
    expect(retry.attributes('title')).toBe('Configure a provider to Retry.');
    expect(wrapper.text()).toContain('Configure a provider to Retry.');

    await wrapper.setProps({
      retryDisabled: false,
      retryingArtifactId: 'turn-current',
    });
    expect(wrapper.get('[role="status"]').text()).toContain(
      '正在从原回合开始前重演',
    );
    expect(wrapper.get('[role="status"]').text()).toContain('会保留为另一个结果');

    await wrapper.setProps({
      retryingArtifactId: '',
      namingCheckpointId: 'turn-current',
    });
    expect(wrapper.get('.play-history-controls').attributes('aria-busy')).toBe('true');
    expect(wrapper.get('[role="status"]').text()).toBe(
      '正在保存存档点名称…',
    );
    wrapper.unmount();
  });
});

function mountControls(overrides: Partial<{
  checkpoints: PlayCheckpointSummary[];
  sessionRevision: number;
  loading: boolean;
  busyArtifactId: string;
  retryingArtifactId: string;
  namingCheckpointId: string;
  retryDisabled: boolean;
  retryDisabledReason: string;
  blocked: boolean;
  notice: string;
  directorLens: boolean;
}> = {}) {
  return mount(PlayHistoryControls, {
    attachTo: document.body,
    props: {
      checkpoints: createCheckpoints(),
      sessionRevision: 7,
      loading: false,
      busyArtifactId: '',
      blocked: false,
      notice: 'History ready.',
      ...overrides,
    },
  });
}

function createCheckpoints(): PlayCheckpointSummary[] {
  const checkpoints = [{
    checkpointId: 'turn-current',
    kind: 'turn',
    artifactId: 'turn-current',
    parentCheckpointId: 'turn-ancestor',
    selectedTurnIds: ['turn-ancestor', 'turn-current'],
    depth: 2,
    revision: 7,
    worldTurn: 7,
    committedAt: '2026-07-15T08:00:00.000Z',
    preview: 'Current scene',
    status: 'current',
    restorable: false,
    retryable: true,
    canonical: false,
  }, {
    checkpointId: 'turn-variant',
    kind: 'turn',
    artifactId: 'turn-variant',
    parentCheckpointId: 'initial-world',
    selectedTurnIds: ['turn-variant'],
    depth: 1,
    revision: 5,
    worldTurn: 5,
    committedAt: '2026-07-15T07:30:00.000Z',
    preview: 'Alternate reply',
    status: 'variant',
    restorable: true,
    retryable: true,
    canonical: false,
  }, {
    checkpointId: 'turn-ancestor',
    kind: 'turn',
    artifactId: 'turn-ancestor',
    parentCheckpointId: 'initial-world',
    selectedTurnIds: ['turn-ancestor'],
    depth: 1,
    revision: 4,
    worldTurn: 4,
    committedAt: '2026-07-15T07:00:00.000Z',
    preview: 'Before the reveal',
    name: 'Crossroads',
    status: 'selectedAncestor',
    restorable: true,
    retryable: true,
    canonical: false,
  }, {
    checkpointId: 'initial-world',
    kind: 'initialWorld',
    selectedTurnIds: [],
    depth: 0,
    revision: 0,
    worldTurn: 0,
    committedAt: '2026-07-15T06:00:00.000Z',
    preview: '初始世界',
    status: 'selectedAncestor',
    restorable: true,
    retryable: false,
    canonical: false,
  }];
  return checkpoints as unknown as PlayCheckpointSummary[];
}
