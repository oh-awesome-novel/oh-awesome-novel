// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const api = vi.hoisted(() => ({
  listImageProviders: vi.fn(),
  saveImageProvider: vi.fn(),
  deleteImageProvider: vi.fn(),
  checkImageProvider: vi.fn(),
}));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import ImageProviderSettings from '../../../apps/desktop-ui/src/components/workspace/ImageProviderSettings.vue';

const comfy = {
  id: 'comfyui', kind: 'comfyui', displayName: '书房的 ComfyUI', baseUrl: 'http://127.0.0.1:8188', defaultWidth: 768, defaultHeight: 1152,
  timeoutMs: 120_000, hasApiKey: false,
  workflow: { sha256: 'a'.repeat(64), mapping: { seed: { node: '3', input: 'seed' } }, slots: ['positive', 'seed'], importedAt: '2026-11-13T00:00:00.000Z' },
  lastError: { at: '2026-11-13T01:00:00.000Z', code: 'timeout', message: '生图请求超时。' },
};
const cloud = { id: 'cloud', kind: 'openai', displayName: '云端', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', defaultWidth: 1024, defaultHeight: 1024, timeoutMs: 60_000, hasApiKey: true };

async function mountSettings(providers: unknown[] = [comfy, cloud]) {
  api.listImageProviders.mockResolvedValue({ providers });
  const wrapper = mount(ImageProviderSettings, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}
const button = (wrapper: Awaited<ReturnType<typeof mountSettings>>, label: string, index = 0) =>
  wrapper.findAll('button').filter(item => item.text() === label)[index]!;

describe('image service settings', () => {
  beforeEach(() => { for (const mock of Object.values(api)) mock.mockReset(); });

  it('lists services with their last error and never shows a stored key', async () => {
    const wrapper = await mountSettings();
    const text = wrapper.text();
    expect(text).toContain('书房的 ComfyUI');
    expect(text).toContain('工作流已导入（正向提示词、种子）');
    expect(text).toContain('最近一次失败');
    expect(text).toContain('生图请求超时。');
    expect(text).toContain('gpt-image-1 · 已保存 API Key');

    await button(wrapper, '编辑', 1).trigger('click');
    const key = wrapper.get<HTMLInputElement>('[name="image-provider-key"]');
    expect(key.element.value).toBe('');
    expect(key.attributes('placeholder')).toBe('已保存；留空则不修改');
    expect(wrapper.find('[name="image-provider-workflow"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('saves an online service without resending an empty key', async () => {
    const wrapper = await mountSettings();
    await button(wrapper, '编辑', 1).trigger('click');
    await wrapper.get('[name="image-provider-model"]').setValue('gpt-image-2');
    api.saveImageProvider.mockResolvedValue({ providers: [comfy, { ...cloud, model: 'gpt-image-2' }] });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const sent = api.saveImageProvider.mock.calls[0]![0];
    expect(sent).toMatchObject({ id: 'cloud', kind: 'openai', model: 'gpt-image-2', baseUrl: 'https://api.openai.com/v1', timeoutMs: 60_000 });
    expect(sent).not.toHaveProperty('apiKey');
    expect(sent).not.toHaveProperty('workflowMapping');
    expect(wrapper.text()).toContain('已保存。');
    wrapper.unmount();
  });

  it('asks before sending prompts to a ComfyUI that is not on this machine', async () => {
    const wrapper = await mountSettings([]);
    await button(wrapper, '添加 ComfyUI').trigger('click');
    expect(wrapper.find('[name="image-provider-allow-remote"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('导入的工作流会在你的 ComfyUI 上原样执行');
    await wrapper.get('[name="image-provider-url"]').setValue('http://192.168.1.20:8188');
    const submit = wrapper.get<HTMLButtonElement>('button[type="submit"]');
    expect(submit.element.disabled).toBe(true);
    await wrapper.get('[name="image-provider-allow-remote"]').setValue(true);
    expect(submit.element.disabled).toBe(false);
    wrapper.unmount();
  });

  it('imports a workflow with its mapping and re-maps a stored one', async () => {
    const wrapper = await mountSettings();
    await button(wrapper, '编辑', 0).trigger('click');
    expect(wrapper.get<HTMLInputElement>('[name="image-provider-seed-node"]').element.value).toBe('3');
    await wrapper.get('[name="image-provider-width-node"]').setValue('5');
    await wrapper.get('[name="image-provider-width-input"]').setValue('width');
    api.saveImageProvider.mockResolvedValue({ providers: [comfy, cloud] });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    // No new file: only the mapping goes, and the stored workflow is kept.
    expect(api.saveImageProvider.mock.calls[0]![0]).toMatchObject({ workflowMapping: { seed: { node: '3', input: 'seed' }, width: { node: '5', input: 'width' } } });
    expect(api.saveImageProvider.mock.calls[0]![0]).not.toHaveProperty('workflowText');

    const file = new File(['{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"{{positive}}"}}}'], 'portrait.json', { type: 'application/json' });
    const input = wrapper.get<HTMLInputElement>('[name="image-provider-workflow"]');
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true });
    await input.trigger('change');
    await flushPromises();
    expect(wrapper.text()).toContain('已选择 portrait.json');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveImageProvider.mock.calls[1]![0].workflowText).toContain('{{positive}}');
    wrapper.unmount();
  });

  it('shows the result of a connection test and a save error as written by the server', async () => {
    const wrapper = await mountSettings();
    api.checkImageProvider.mockResolvedValue({ ok: false, message: '连不上生图服务。', latencyMs: 12 });
    await button(wrapper, '测试连通', 0).trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('连不上生图服务。');
    expect(api.checkImageProvider).toHaveBeenCalledWith('comfyui');

    await button(wrapper, '添加兼容接口').trigger('click');
    await wrapper.get('[name="image-provider-url"]').setValue('https://images.example/v1');
    await wrapper.get('[name="image-provider-model"]').setValue('paint-1');
    await wrapper.get('[name="image-provider-key"]').setValue('sk-new');
    api.saveImageProvider.mockRejectedValue(new Error('服务地址变了，请重新填写 API Key。'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.saveImageProvider.mock.calls[0]![0]).toMatchObject({ kind: 'openai-compatible', apiKey: 'sk-new', model: 'paint-1' });
    expect(wrapper.get('[role="alert"]').text()).toBe('服务地址变了，请重新填写 API Key。');
    wrapper.unmount();
  });
});
