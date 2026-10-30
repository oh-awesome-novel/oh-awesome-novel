// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';
import PendingActionCard from '../../../apps/desktop-ui/src/components/agent-checkpoint/PendingActionCard.vue';
import DiffReviewTab from '../../../apps/desktop-ui/src/components/workspace/DiffReviewTab.vue';
import WorkspaceHome from '../../../apps/desktop-ui/src/components/workspace/WorkspaceHome.vue';
import PlayGuidedCastStep from '../../../apps/desktop-ui/src/components/play/launch/PlayGuidedCastStep.vue';

const forgeAction = (status: 'pending' | 'accepted' = 'accepted') => ({
  id: 'pa-forge-1',
  title: '设定入库：夜城',
  description: '世界与角色入库',
  status,
  createdAt: '2026-10-30T00:00:00.000Z',
  diff: 'diff --git a/world.md b/world.md',
  changes: [{ operation: 'create' as const, path: 'world.md', oldHash: null, newHash: 'a'.repeat(64) }],
  origin: {
    kind: 'forge' as const,
    draftId: 'draft-123',
    revision: 3,
    previewId: 'prev-1',
  },
});

describe('Forge post-accept banner and entry points', () => {
  it('displays handoff banner on accepted forge action in PendingActionCard and emits forgeHandoff', async () => {
    const action = forgeAction('accepted');
    const wrapper = mount(PendingActionCard, {
      props: { action },
    });

    expect(wrapper.find('.forge-handoff-banner').exists()).toBe(true);
    expect(wrapper.text()).toContain('设定已批准入库');

    const buttons = wrapper.findAll('.forge-handoff-banner button');
    const playBtn = buttons.find(b => b.text().includes('一键开演'));
    const writingBtn = buttons.find(b => b.text().includes('一键入书'));

    expect(playBtn).toBeDefined();
    expect(writingBtn).toBeDefined();

    await playBtn!.trigger('click');
    expect(wrapper.emitted('forgeHandoff')?.[0]).toEqual([{
      draftId: 'draft-123',
      revision: 3,
      mode: 'play',
    }]);

    await writingBtn!.trigger('click');
    expect(wrapper.emitted('forgeHandoff')?.[1]).toEqual([{
      draftId: 'draft-123',
      revision: 3,
      mode: 'writing',
    }]);

    wrapper.unmount();
  });

  it('does not display handoff banner when forge action is still pending in PendingActionCard', () => {
    const action = forgeAction('pending');
    const wrapper = mount(PendingActionCard, {
      props: { action },
    });

    expect(wrapper.find('.forge-handoff-banner').exists()).toBe(false);
    wrapper.unmount();
  });

  it('displays handoff banner on accepted forge action in DiffReviewTab', async () => {
    const action = forgeAction('accepted');
    const wrapper = mount(DiffReviewTab, {
      props: { actions: [action as never], selectedAction: action as never },
    });

    expect(wrapper.find('.forge-handoff-banner').exists()).toBe(true);
    const playBtn = wrapper.findAll('.forge-handoff-banner button').find(b => b.text().includes('一键开演'));
    expect(playBtn).toBeDefined();

    await playBtn!.trigger('click');
    expect(wrapper.emitted('forgeHandoff')?.[0]).toEqual([{
      draftId: 'draft-123',
      revision: 3,
      mode: 'play',
    }]);

    wrapper.unmount();
  });

  it('exposes Forge entry point in WorkspaceHome', async () => {
    const wrapper = mount(WorkspaceHome, {
      props: {
        workspace: { id: 'ws-1', name: '测试小说', path: '/novel' },
        providerConfigured: true,
      },
    });

    const forgeBtn = wrapper.findAll('.quick-action').find(b => b.text().includes('设定工坊 Forge'));
    expect(forgeBtn).toBeDefined();

    await forgeBtn!.trigger('click');
    expect(wrapper.emitted('openForge')).toHaveLength(1);
    wrapper.unmount();
  });

  it('exposes Forge entry point in PlayGuidedCastStep', async () => {
    const wrapper = mount(PlayGuidedCastStep, {
      props: {
        purpose: 'sceneRehearsal',
        participants: [],
        characterSources: [],
        errors: {},
        disabled: false,
      },
    });

    const forgeEntryBtn = wrapper.find('.forge-entry');
    expect(forgeEntryBtn.exists()).toBe(true);
    expect(forgeEntryBtn.text()).toContain('在设定工坊共创角色');

    await forgeEntryBtn.trigger('click');
    expect(wrapper.emitted('openForge')).toHaveLength(1);
    wrapper.unmount();
  });
});
