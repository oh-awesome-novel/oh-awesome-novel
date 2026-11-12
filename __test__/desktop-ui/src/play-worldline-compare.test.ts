// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vite-plus/test';
import PlayWorldlineCompare from '../../../apps/desktop-ui/src/components/play/PlayWorldlineCompare.vue';

const checkpoints = [
  { checkpointId: 'initial-world', kind: 'initialWorld', status: 'selectedAncestor', preview: 'Initial world' },
  { checkpointId: 'turn-artifact-1', kind: 'turn', status: 'current', preview: '往左' },
  { checkpointId: 'turn-artifact-2', kind: 'turn', status: 'variant', preview: '往右' },
];
const result = {
  sessionId: 'compare', revision: 2, lens: 'player', page: 0, pageSize: 40, canonical: false,
  left: { checkpointId: 'turn-artifact-1', turnCount: 1, divergentTurnCount: 1, clock: { turn: 1, revision: 1 } },
  right: { checkpointId: 'turn-artifact-2', turnCount: 1, divergentTurnCount: 1, clock: { turn: 1, revision: 2 } },
  commonAncestor: 'initial-world', sections: [{ kind: 'actions', total: 41, items: [{ key: '0', label: '第一步', left: '往左', right: '往右' }] }],
};
function mountPanel(comparePlayWorldlines = vi.fn().mockResolvedValue(result)) {
  const wrapper = mount(PlayWorldlineCompare, { props: {
    sessionId: 'compare', workspaceKey: '/workspace', revision: 2, lens: 'player', checkpoints: checkpoints as never,
    api: { comparePlayWorldlines },
  } });
  return { wrapper, comparePlayWorldlines };
}
async function choose(wrapper: ReturnType<typeof mountPanel>['wrapper']) {
  await wrapper.findAll('select')[0]!.setValue('turn-artifact-1');
  await wrapper.findAll('select')[1]!.setValue('turn-artifact-2');
  await wrapper.get('.compare-selectors').trigger('submit'); await flushPromises();
}
it('compares only after selection and confirmation, pages, names and switches through explicit actions', async () => {
  const { wrapper, comparePlayWorldlines } = mountPanel();
  expect(comparePlayWorldlines).not.toHaveBeenCalled();
  await choose(wrapper);
  expect(comparePlayWorldlines).toHaveBeenCalledWith('compare', { left: 'turn-artifact-1', right: 'turn-artifact-2', lens: 'player', page: 0 }, expect.any(AbortSignal));
  expect(wrapper.text()).toContain('共同起点：初始世界');
  const sides = wrapper.findAll('.compare-sides article');
  await sides[1]!.findAll('button')[0]!.trigger('click');
  expect(wrapper.emitted('restore')).toBeUndefined();
  await wrapper.get('.compare-confirm button:last-child').trigger('click');
  expect(wrapper.emitted('restore')).toEqual([['turn-artifact-2']]);
  await sides[0]!.get('input').setValue('我选的路线');
  await sides[0]!.get('form').trigger('submit');
  expect(wrapper.emitted('name')).toEqual([['turn-artifact-1', '我选的路线']]);
  await sides[1]!.findAll('button').at(-1)!.trigger('click');
  await wrapper.get('.compare-confirm button:last-child').trigger('click');
  expect(wrapper.emitted('outcome')).toEqual([['turn-artifact-2']]);
  await wrapper.get('nav button:last-child').trigger('click');
  expect(comparePlayWorldlines.mock.calls.at(-1)?.[1].page).toBe(1);
  wrapper.unmount();
});
it('immediately discards Director results and ignores late requests across lens/session/workspace/revision changes', async () => {
  let resolve!: (value: unknown) => void;
  const request = vi.fn(() => new Promise(r => { resolve = r; }));
  const { wrapper } = mountPanel(request as never);
  await wrapper.setProps({ lens: 'director' }); await choose(wrapper);
  await wrapper.setProps({ lens: 'player' });
  resolve({ ...result, lens: 'director', sections: [{ kind: 'state', total: 1, items: [{ key: 's', label: 'SECRET', left: 'SECRET' }] }] });
  await flushPromises(); expect(wrapper.text()).not.toContain('SECRET');
  for (const changed of [{ revision: 3 }, { sessionId: 'other' }, { workspaceKey: '/other' }]) {
    await choose(wrapper); await wrapper.setProps(changed); resolve(result); await flushPromises();
    expect(wrapper.find('.compare-sides').exists()).toBe(false);
  }
  wrapper.unmount();
});
it('clears results after busy or source changes and surfaces unavailable/error results without stale actions', async () => {
  const { wrapper, comparePlayWorldlines } = mountPanel();
  await choose(wrapper); await wrapper.setProps({ disabled: true });
  expect(wrapper.find('.compare-sides').exists()).toBe(false);
  await wrapper.setProps({ disabled: false });
  comparePlayWorldlines.mockResolvedValue({ ...result, unavailableReason: '旧节点无完整快照', sections: [] });
  await choose(wrapper); expect(wrapper.text()).toContain('旧节点无完整快照');
  expect(wrapper.find('.compare-sides').exists()).toBe(false);
  comparePlayWorldlines.mockRejectedValue(new Error('读取失败'));
  await choose(wrapper); expect(wrapper.get('[role="alert"]').text()).toBe('读取失败');
  wrapper.unmount();
});

it('keeps a same-revision read across transient background loading without exposing busy actions', async () => {
  let resolve!: (value: unknown) => void;
  const { wrapper } = mountPanel(vi.fn(() => new Promise(r => { resolve = r; })) as never);
  await choose(wrapper);
  await wrapper.setProps({ disabled: true });
  resolve(result); await flushPromises();
  expect(wrapper.find('.compare-sides').exists()).toBe(false);
  await wrapper.setProps({ disabled: false });
  expect(wrapper.find('.compare-sides').exists()).toBe(true);
  await wrapper.setProps({ checkpoints: checkpoints.map(node => ({ ...node, status: node.checkpointId === 'turn-artifact-2' ? 'current' : 'variant' })) as never });
  expect(wrapper.find('.compare-sides').exists()).toBe(false);
  wrapper.unmount();
});
