// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref, shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { measureRenderedUsagePresentation, useUsagePresentation } from '../../../apps/desktop-ui/src/composables/useUsagePresentation';
import type { UsagePresentationRun } from '../../../apps/desktop-ui/src/composables/useUsagePresentation';

const api = vi.hoisted(() => ({ recordPlayUsagePresentation: vi.fn(), recordReferenceUsagePresentation: vi.fn() }));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));
const operation = (): UsagePresentationRun => ({ localId: 'local-one', scope: { domain: 'play', sessionId: 'play-one' }, operationId: 'operation-one', startedAtMs: 100, finished: false, responseIds: ['message-new'] });
const roots: HTMLElement[] = [];
function stage(html: string) { const root = document.createElement('section'); root.innerHTML = html; document.body.append(root); roots.push(root); return root; }

describe('client-observed first rendered response', () => {
  beforeEach(() => { vi.resetAllMocks(); api.recordPlayUsagePresentation.mockResolvedValue({}); });
  afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) root.remove(); });
  it('ignores status and old messages, then observes the matching visible response', () => {
    const root = stage('<p>正在生成…</p><p data-usage-message="message-old">旧正文</p>');
    expect(measureRenderedUsagePresentation(operation(), root, 900)).toBeUndefined();
    root.insertAdjacentHTML('beforeend', '<p data-usage-operation="operation-one">新正文</p>');
    expect(measureRenderedUsagePresentation(operation(), root, 900)).toEqual({ operationId: 'operation-one', elapsedMs: 800 });
    root.remove();
    expect(measureRenderedUsagePresentation(operation(), root, 900)).toBeUndefined();
  });
  it.each([
    ['hidden', '<div hidden>', '</div>'],
    ['aria-hidden', '<div aria-hidden="true">', '</div>'],
    ['display-none', '<div style="display:none">', '</div>'],
    ['visibility-hidden', '<div style="visibility:hidden">', '</div>'],
    ['closed-details', '<details><summary>展开正文</summary>', '</details>'],
  ])('does not count a response hidden by %s', (_name, before, after) => {
    const root = stage(`${before}<p data-usage-message="message-new">新正文</p>${after}`);
    expect(measureRenderedUsagePresentation(operation(), root, 900)).toBeUndefined();
    const node = root.querySelector('p')!; root.append(node);
    expect(measureRenderedUsagePresentation(operation(), root, 900)?.elapsedMs).toBe(800);
  });
  it('persists the first rendered sample once, after the actual call reaches a terminal state', async () => {
    let clock = 300; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const run = shallowRef<UsagePresentationRun>(operation()); const text = ref('');
    const component = defineComponent({
      setup() {
        const root = shallowRef<HTMLElement>();
        useUsagePresentation({ identity: () => 'workspace-one:play-one', run: () => run.value, element: () => root.value });
        return { root, text };
      },
      template: '<section ref="root"><p data-usage-operation="operation-one">{{ text }}</p></section>',
    });
    const wrapper = mount(component, { attachTo: document.body });
    try {
      await flushPromises(); expect(api.recordPlayUsagePresentation).not.toHaveBeenCalled();
      text.value = '首段正文'; await flushPromises();
      expect(api.recordPlayUsagePresentation).not.toHaveBeenCalled();
      clock = 900; run.value = { ...run.value, finished: true }; await flushPromises();
      expect(api.recordPlayUsagePresentation).toHaveBeenCalledWith('play-one', { operationId: 'operation-one', elapsedMs: 200 });
      text.value = '后续正文'; await flushPromises();
      expect(api.recordPlayUsagePresentation).toHaveBeenCalledTimes(1);
    } finally { wrapper.unmount(); }
  });
});
