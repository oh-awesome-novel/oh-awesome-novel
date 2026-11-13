// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const api = vi.hoisted(() => ({
  listPortraitImages: vi.fn(),
  importPortraitImage: vi.fn(),
  readImageAsset: vi.fn(),
  listUnreferencedImageAssets: vi.fn(),
  deleteImageAsset: vi.fn(),
  getCharacterPortraits: vi.fn(),
  proposeCharacterPortraits: vi.fn(),
}));
vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import ImageAssetPanel from '../../../apps/desktop-ui/src/components/assets/ImageAssetPanel.vue';
import ImageAssetView from '../../../apps/desktop-ui/src/components/assets/ImageAssetView.vue';

const normal = { path: 'assets/portraits/nian/normal.png', name: 'normal.png', bytes: 2048, mime: 'image/png' };
const broken = { path: 'assets/portraits/nian/broken.png', name: 'broken.png', bytes: 7, problem: '文件不是可识别的 PNG、JPEG 或 WebP 图片，可能已损坏。' };

describe('image asset view', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    let counter = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:image-${++counter}`), revokeObjectURL: vi.fn() }));
  });

  it('shows the original image and releases it when the path changes or the view goes away', async () => {
    api.readImageAsset.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    const wrapper = mount(ImageAssetView, { props: { path: normal.path, alt: '念念 · 平常' } });
    expect(wrapper.find('.image-asset-placeholder').text()).toContain('正在载入');
    await flushPromises();
    expect(wrapper.get('img').attributes()).toMatchObject({ src: 'blob:image-1', alt: '念念 · 平常' });
    expect(wrapper.emitted('state')).toEqual([['loading'], ['ready']]);

    await wrapper.setProps({ path: 'assets/portraits/nian/angry.png' });
    await flushPromises();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1');
    expect(wrapper.get('img').attributes('src')).toBe('blob:image-2');
    wrapper.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-2');
  });

  it('shows a placeholder with the reason when the referenced image is missing or damaged', async () => {
    api.readImageAsset.mockRejectedValueOnce(new Error('图片文件不存在。图片不随 Git 同步，换一台机器后需要重新放入。'));
    const wrapper = mount(ImageAssetView, { props: { path: normal.path, alt: '念念 · 平常' } });
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    const placeholder = wrapper.get('.image-asset-placeholder');
    expect(placeholder.text()).toContain('念念 · 平常');
    expect(placeholder.text()).toContain('图片不随 Git 同步');
    expect(placeholder.attributes('aria-label')).toContain('图片文件不存在');
    expect(wrapper.emitted('state')!.at(-1)).toEqual(['unavailable', expect.stringContaining('不存在')]);

    // The file comes back: the same path with a new revision loads again.
    api.readImageAsset.mockResolvedValueOnce(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    await wrapper.setProps({ revision: 2 });
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('image asset panel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:image'), revokeObjectURL: vi.fn() }));
    api.readImageAsset.mockImplementation(async (path: string) => {
      if (path === broken.path) throw new Error(broken.problem);
      return new Blob([new Uint8Array([1])], { type: 'image/png' });
    });
    api.listPortraitImages.mockResolvedValue({ directory: 'assets/portraits/nian', images: [broken, normal] });
    // The portrait form below the images has its own tests; here the character simply has no roster profile.
    api.getCharacterPortraits.mockImplementation(async (characterId: string) => ({ characterId, path: `characters/${characterId}/roster-profile.yaml`, profile: null }));
  });

  function file(name: string, size = 3): File {
    return new File([new Uint8Array(size)], name, { type: 'image/png' });
  }
  async function pick(wrapper: ReturnType<typeof mount>, files: File[]): Promise<void> {
    const input = wrapper.get<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: files });
    await input.trigger('change');
    await flushPromises();
    await flushPromises();
  }

  it("lists a character's images, with damaged files explained instead of failing", async () => {
    const wrapper = mount(ImageAssetPanel, { props: { characterIds: ['nian', 'lu'], workspaceRoot: '/novel' } });
    await flushPromises();
    expect(api.listPortraitImages).toHaveBeenCalledWith('nian');
    expect(wrapper.text()).toContain('不进 Git');
    expect(wrapper.text()).toContain('assets/portraits/nian/');
    const items = wrapper.findAll('.image-asset-grid li');
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toContain('可能已损坏');
    expect(items[0]!.find('img').exists()).toBe(false);
    expect(items[1]!.get('img').attributes('alt')).toBe('normal.png');

    await wrapper.get('input[list]').setValue('lu');
    await flushPromises();
    expect(api.listPortraitImages).toHaveBeenLastCalledWith('lu');
    await wrapper.get('input[list]').setValue('../x');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('角色编号');
    expect(wrapper.get<HTMLInputElement>('input[type="file"]').element.disabled).toBe(true);
    expect(api.listPortraitImages).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('imports picked files one by one and reports renames, reuse, limits and refusals', async () => {
    api.importPortraitImage
      .mockResolvedValueOnce({ image: normal, reused: false, gitIgnored: true })
      .mockResolvedValueOnce({ image: { ...normal, path: 'assets/portraits/nian/normal-2.png', name: 'normal-2.png' }, reused: false, gitIgnored: true })
      .mockResolvedValueOnce({ image: normal, reused: true, gitIgnored: true })
      .mockRejectedValueOnce(new Error('文件内容是 JPEG，与扩展名 .png 不一致。'));
    const wrapper = mount(ImageAssetPanel, { props: { characterIds: ['nian'], workspaceRoot: '/novel' } });
    await flushPromises();
    await pick(wrapper, [file('normal.png'), file('normal.png'), file('copy.png'), file('wrong.png'), file('huge.png', 16 * 1024 * 1024 + 1)]);

    expect(api.importPortraitImage).toHaveBeenCalledTimes(4);
    expect(api.importPortraitImage.mock.calls[0]).toEqual(['nian', { name: 'normal.png', data: expect.any(File) }]);
    expect(wrapper.findAll('.image-asset-notices li').map(item => item.text())).toEqual([
      'normal.png：已导入。',
      'normal.png：已导入为 normal-2.png。',
      'copy.png：内容与已有的 normal.png 相同，没有重复保存。',
      'wrong.png：文件内容是 JPEG，与扩展名 .png 不一致。',
      'huge.png：超过 16 MiB 的上限，没有导入。',
    ]);
    // The list is read again after the import.
    expect(api.listPortraitImages).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('lists unreferenced images on request and deletes one only after a second click', async () => {
    api.listUnreferencedImageAssets.mockResolvedValue({ images: [normal] });
    api.deleteImageAsset.mockResolvedValue({ deleted: normal.path });
    const wrapper = mount(ImageAssetPanel, { props: { characterIds: ['nian'], workspaceRoot: '/novel' } });
    await flushPromises();
    expect(api.listUnreferencedImageAssets).not.toHaveBeenCalled();

    const section = wrapper.get('.image-asset-unreferenced');
    await section.get('header button').trigger('click');
    await flushPromises();
    expect(section.findAll('li')).toHaveLength(1);
    const remove = () => section.findAll('li button').find(button => /删除/.test(button.text()))!;
    await remove().trigger('click');
    expect(api.deleteImageAsset).not.toHaveBeenCalled();
    expect(remove().text()).toBe('确认删除这张图片');
    await section.findAll('li button').find(button => button.text() === '取消')!.trigger('click');
    expect(remove().text()).toBe('删除');

    await remove().trigger('click');
    await remove().trigger('click');
    await flushPromises();
    expect(api.deleteImageAsset).toHaveBeenCalledWith(normal.path);
    expect(section.text()).toContain('没有未被引用的图片');

    // A refusal from the host is shown, and the image stays listed.
    api.listUnreferencedImageAssets.mockResolvedValue({ images: [normal] });
    api.deleteImageAsset.mockRejectedValueOnce(new Error('这张图片仍被正式文件引用，不能删除。'));
    await section.get('header button').trigger('click');
    await flushPromises();
    await remove().trigger('click');
    await remove().trigger('click');
    await flushPromises();
    expect(wrapper.get('.image-asset-error').text()).toContain('仍被正式文件引用');
    expect(section.findAll('li')).toHaveLength(1);
    wrapper.unmount();
  });
});
