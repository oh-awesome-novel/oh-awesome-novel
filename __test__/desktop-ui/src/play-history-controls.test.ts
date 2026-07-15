// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlayHistoryControls from '../../../apps/desktop-ui/src/components/play/PlayHistoryControls.vue';
import type { PlayCheckpointSummary } from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';

describe('PlayHistoryControls', () => {
  it('separates selected checkpoints from retained variants with textual status', () => {
    const wrapper = mountControls();
    const groups = wrapper.findAll('.play-history-group');

    expect(groups[0]?.text()).toContain('Checkpoints');
    expect(groups[0]?.text()).toContain('Current');
    expect(groups[0]?.text()).toContain('Selected path');
    expect(groups[1]?.text()).toContain('Variants');
    expect(groups[1]?.text()).toContain('Variant');
    expect(wrapper.get('[aria-current="true"]').text()).toContain('Current scene');
    expect(wrapper.get('.play-history-heading').text()).toContain('Checkpoints / Variants');
    expect(wrapper.text()).toContain('Session revision 7');
    expect(wrapper.get('.play-history-controls').attributes('aria-busy')).toBe('false');
    expect(wrapper.get('[role="status"]').text()).toBe('History ready.');
    wrapper.unmount();
  });

  it('focuses inline confirmation and returns focus to Restore on Escape', async () => {
    const wrapper = mountControls();
    const restore = wrapper.get('[data-artifact-id="turn-variant"]');

    await restore.trigger('click');
    await flushPromises();

    const confirm = wrapper.get('.play-history-confirm');
    expect(document.activeElement).toBe(confirm.element);
    expect(wrapper.get('.play-history-confirmation').text()).toContain(
      'Later turns remain variants and are not deleted.',
    );

    await confirm.trigger('keydown', { key: 'Escape' });
    await flushPromises();

    expect(wrapper.find('.play-history-confirmation').exists()).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('[data-artifact-id="turn-variant"]').element,
    );
    wrapper.unmount();
  });

  it('emits only after explicit confirmation and disables restore while blocked', async () => {
    const wrapper = mountControls({ blocked: true });
    const restore = wrapper.get('[data-artifact-id="turn-variant"]');

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
    expect(wrapper.get('[role="status"]').text()).toBe('Restoring checkpoint…');
    wrapper.unmount();
  });

  it('confirms Retry inline, explains variant preservation, and restores focus on Escape', async () => {
    const wrapper = mountControls();
    const retry = wrapper.get(
      '.play-history-retry[data-artifact-id="turn-current"]',
    );

    await retry.trigger('click');
    await flushPromises();

    const confirm = wrapper.get('.play-history-confirm');
    expect(document.activeElement).toBe(confirm.element);
    expect(wrapper.get('.play-history-confirmation').text()).toContain(
      'Retry from before this turn?',
    );
    expect(wrapper.get('.play-history-confirmation').text()).toContain(
      'existing result is preserved as a variant',
    );

    await confirm.trigger('keydown', { key: 'Escape' });
    await flushPromises();

    expect(wrapper.find('.play-history-confirmation').exists()).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('.play-history-retry[data-artifact-id="turn-current"]').element,
    );

    await wrapper.get('.play-history-retry[data-artifact-id="turn-current"]').trigger('click');
    await flushPromises();
    await wrapper.get('.play-history-confirm').trigger('click');
    expect(wrapper.emitted('retry')).toEqual([['turn-current']]);
    wrapper.unmount();
  });

  it('disables Retry without a provider and announces an active Retry', async () => {
    const wrapper = mountControls({
      retryDisabled: true,
      retryDisabledReason: 'Configure a provider to Retry.',
    });
    const retry = wrapper.get(
      '.play-history-retry[data-artifact-id="turn-current"]',
    );

    expect(retry.attributes('disabled')).toBeDefined();
    expect(retry.attributes('title')).toBe('Configure a provider to Retry.');
    expect(wrapper.text()).toContain('Configure a provider to Retry.');

    await wrapper.setProps({
      retryDisabled: false,
      retryingArtifactId: 'turn-current',
    });
    expect(wrapper.get('.play-history-controls').attributes('aria-busy')).toBe('true');
    expect(wrapper.get('[role="status"]').text()).toContain(
      'Retrying from before the original turn',
    );
    expect(wrapper.get('[role="status"]').text()).toContain('remains a variant');
    wrapper.unmount();
  });
});

function mountControls(overrides: Partial<{
  checkpoints: PlayCheckpointSummary[];
  sessionRevision: number;
  loading: boolean;
  busyArtifactId: string;
  retryingArtifactId: string;
  retryDisabled: boolean;
  retryDisabledReason: string;
  blocked: boolean;
  notice: string;
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
  const checkpoints: Array<PlayCheckpointSummary & { retryable: boolean }> = [
    {
      artifactId: 'turn-current',
      selectedTurnIds: ['turn-current'],
      revision: 7,
      worldTurn: 7,
      committedAt: '2026-07-15T08:00:00.000Z',
      preview: 'Current scene',
      status: 'current',
      restorable: false,
      retryable: true,
      canonical: false,
    },
    {
      artifactId: 'turn-ancestor',
      parentArtifactId: 'turn-before-ancestor',
      selectedTurnIds: ['turn-before-ancestor', 'turn-ancestor'],
      revision: 4,
      worldTurn: 4,
      committedAt: '2026-07-15T07:00:00.000Z',
      preview: 'Before the reveal',
      status: 'selectedAncestor',
      restorable: true,
      retryable: true,
      canonical: false,
    },
    {
      artifactId: 'turn-variant',
      parentArtifactId: 'turn-before-ancestor',
      selectedTurnIds: ['turn-before-ancestor', 'turn-variant'],
      revision: 5,
      worldTurn: 5,
      committedAt: '2026-07-15T07:30:00.000Z',
      preview: 'Alternate reply',
      status: 'variant',
      restorable: true,
      retryable: true,
      canonical: false,
    },
  ];
  return checkpoints;
}
