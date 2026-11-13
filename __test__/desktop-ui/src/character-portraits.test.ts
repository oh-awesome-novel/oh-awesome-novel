// @vitest-environment happy-dom

import { createHash } from 'node:crypto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { computed, shallowRef } from 'vue';

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

import CharacterPortraitForm from '../../../apps/desktop-ui/src/components/assets/CharacterPortraitForm.vue';
import ImageAssetPanel from '../../../apps/desktop-ui/src/components/assets/ImageAssetPanel.vue';
import PlayStageShell from '../../../apps/desktop-ui/src/components/play/PlayStageShell.vue';
import VisualNovelStage from '../../../apps/desktop-ui/src/components/play/VisualNovelStage.vue';
import type { PlayWorkspaceState } from '../../../apps/desktop-ui/src/composables/usePlayWorkspace';

const HASH = 'a'.repeat(64);
const ORIGINAL = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const REPLACED = new Uint8Array([137, 80, 78, 71, 9, 9, 9]);
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const images = [
  { path: 'assets/portraits/nian/casual.png', name: 'casual.png', bytes: 2048, mime: 'image/png' },
  { path: 'assets/portraits/nian/uniform.png', name: 'uniform.png', bytes: 4096, mime: 'image/png' },
  { path: 'assets/portraits/nian/broken.png', name: 'broken.png', bytes: 7, problem: '可能已损坏。' },
];
const portraits = {
  default: 'casual',
  items: [
    { id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/casual.png', generation: { provider: 'local', seed: 42 } },
    { id: 'night', label: '夜行', description: '黑色斗篷遮住半张脸。', prompt: { positive: 'black cloak', useCharacterTags: true } },
  ],
};
function formResponse(profile: Record<string, unknown> | null = {}) {
  return {
    characterId: 'nian',
    path: 'characters/nian/roster-profile.yaml',
    profile: profile && { name: '念念', sourceHash: HASH, portraits, nameColor: null, legacyRefImagePath: null, missingImages: [], ...profile },
  };
}
function mountForm() {
  return mount(CharacterPortraitForm, { attachTo: document.body, props: { characterId: 'nian', workspaceRoot: '/novel', images } });
}
const saveButton = (wrapper: ReturnType<typeof mountForm>) => wrapper.findAll('button').find(button => button.text().includes('保存为待确认改动'))!;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:image'), revokeObjectURL: vi.fn() }));
  api.readImageAsset.mockResolvedValue(new Blob([ORIGINAL], { type: 'image/png' }));
  api.listPortraitImages.mockResolvedValue({ directory: 'assets/portraits/nian', images });
});

describe('character portrait form', () => {
  it('edits three portraits, one without an image, and saves them as a change awaiting approval', async () => {
    api.getCharacterPortraits.mockResolvedValue(formResponse());
    api.proposeCharacterPortraits.mockResolvedValue({
      pendingActionId: 'pa_1', targetPath: 'characters/nian/roster-profile.yaml',
      missingImages: [{ id: 'uniform', image: 'assets/portraits/nian/uniform.png', reason: '图片文件不存在。' }],
    });
    const wrapper = mountForm();
    await flushPromises();
    expect(wrapper.findAll('.portrait-form-rows > li')).toHaveLength(2);
    // The imageless portrait is a silhouette in the form too; damaged files are not offered as choices.
    expect(wrapper.findAll('.portrait-form-silhouette')).toHaveLength(1);
    expect(wrapper.findAll('.portrait-form-rows > li')[0]!.findAll('option').map(option => option.text())).toEqual(['不配图片，显示剪影', 'casual.png', 'uniform.png']);

    await wrapper.findAll('button').find(button => button.text() === '添加一套立绘')!.trigger('click');
    const added = wrapper.findAll('.portrait-form-rows > li')[2]!;
    // A new portrait cannot be saved until it has a name and a description.
    expect(saveButton(wrapper).element.disabled).toBe(true);
    expect(wrapper.get('.portrait-form-problem').text()).toContain('第 3 套立绘还没有名称');
    await added.get('input[aria-label="第 3 套立绘名称"]').setValue('制服');
    await added.get('input[aria-label="第 3 套立绘编号"]').setValue('uniform');
    await added.get('textarea[aria-label="第 3 套立绘描述"]').setValue('  深蓝制服，领口别着校徽。 ');
    await added.get('input[aria-label="第 3 套立绘适用场合"]').setValue('校内');
    await added.get('select').setValue('assets/portraits/nian/uniform.png');
    await added.get('input[type="radio"]').setValue(true);
    await wrapper.get('input[aria-label="名字牌颜色"]').setValue('gold');
    expect(wrapper.get('.portrait-form-problem').text()).toContain('#RRGGBB');
    await wrapper.get('input[aria-label="名字牌颜色"]').setValue('#E9C983');
    expect(wrapper.find('.portrait-form-problem').exists()).toBe(false);

    await saveButton(wrapper).trigger('click');
    await flushPromises();
    expect(api.proposeCharacterPortraits).toHaveBeenCalledWith('nian', {
      expectedWorkspaceRoot: '/novel',
      sourceHash: HASH,
      nameColor: '#E9C983',
      portraits: {
        default: 'uniform',
        items: [
          // Fields the form does not show survive the round trip.
          portraits.items[0],
          portraits.items[1],
          { id: 'uniform', label: '制服', description: '深蓝制服，领口别着校徽。', usage: '校内', image: 'assets/portraits/nian/uniform.png' },
        ],
      },
    });
    expect(wrapper.emitted('pendingActionCreated')).toHaveLength(1);
    expect(wrapper.get('.portrait-form-proposed').text()).toContain('名册文件还没有变');
    // A missing image is a reminder beside a successful save.
    expect(wrapper.get('.portrait-form-missing').text()).toContain('可以照常保存');
    await wrapper.get('.portrait-form-proposed button').trigger('click');
    expect(wrapper.emitted('reviewPendingAction')).toEqual([['pa_1']]);
    wrapper.unmount();
  });

  it('drops the generation record when a portrait is pointed at another image, and removes the section when empty', async () => {
    api.getCharacterPortraits.mockResolvedValue(formResponse());
    api.proposeCharacterPortraits.mockResolvedValue({ pendingActionId: 'pa_2', targetPath: 'characters/nian/roster-profile.yaml', missingImages: [] });
    const wrapper = mountForm();
    await flushPromises();
    await wrapper.findAll('.portrait-form-rows > li')[0]!.get('select').setValue('assets/portraits/nian/uniform.png');
    await saveButton(wrapper).trigger('click');
    await flushPromises();
    expect(api.proposeCharacterPortraits.mock.calls[0]![1].portraits.items[0]).toEqual({
      id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/uniform.png',
    });

    for (const button of wrapper.findAll('button').filter(item => item.text() === '移除这套')) await button.trigger('click');
    expect(wrapper.text()).toContain('还没有立绘');
    await saveButton(wrapper).trigger('click');
    await flushPromises();
    expect(api.proposeCharacterPortraits.mock.calls[1]![1]).toMatchObject({ portraits: null, nameColor: null });
    wrapper.unmount();
  });

  it('explains a missing roster profile, an old single image, and a refused save', async () => {
    api.getCharacterPortraits.mockResolvedValueOnce(formResponse(null));
    const bare = mountForm();
    await flushPromises();
    expect(bare.text()).toContain('还没有名册文件');
    expect(bare.text()).toContain('characters/nian/roster-profile.yaml');
    expect(bare.findAll('button').some(button => button.text().includes('保存'))).toBe(false);
    bare.unmount();

    api.getCharacterPortraits.mockResolvedValue(formResponse({ portraits: null, legacyRefImagePath: 'characters/nian/normal.png' }));
    api.proposeCharacterPortraits.mockRejectedValue(new Error('名册文件已被修改，请重新载入后再保存。'));
    const legacy = mountForm();
    await flushPromises();
    expect(legacy.get('.portrait-form-legacy').text()).toContain('characters/nian/normal.png');
    expect(legacy.get('.portrait-form-legacy').text()).toContain('旧图片不会被删除');
    await legacy.findAll('button').find(button => button.text() === '添加一套立绘')!.trigger('click');
    await legacy.get('input[aria-label="第 1 套立绘名称"]').setValue('常服');
    await legacy.get('textarea[aria-label="第 1 套立绘描述"]').setValue('米色开衫。');
    await saveButton(legacy).trigger('click');
    await flushPromises();
    expect(legacy.get('[role="alert"]').text()).toContain('请重新载入');
    expect(legacy.emitted('pendingActionCreated')).toBeUndefined();
    // Reloading reads the file again.
    await legacy.findAll('button').find(button => button.text() === '重新载入')!.trigger('click');
    await flushPromises();
    expect(api.getCharacterPortraits).toHaveBeenCalledTimes(3);
    legacy.unmount();
  });

  it('sits in the image asset panel and passes the approval events on', async () => {
    api.getCharacterPortraits.mockResolvedValue(formResponse());
    api.proposeCharacterPortraits.mockResolvedValue({ pendingActionId: 'pa_3', targetPath: 'characters/nian/roster-profile.yaml', missingImages: [] });
    const wrapper = mount(ImageAssetPanel, { attachTo: document.body, props: { characterIds: ['nian'], workspaceRoot: '/novel' } });
    await flushPromises();
    const form = wrapper.getComponent(CharacterPortraitForm);
    expect(form.props()).toMatchObject({ characterId: 'nian', workspaceRoot: '/novel', images });
    await form.get('input[aria-label="第 1 套立绘名称"]').setValue('便服');
    await form.findAll('button').find(button => button.text().includes('保存为待确认改动'))!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('pendingActionCreated')).toHaveLength(1);
    await form.get('.portrait-form-proposed button').trigger('click');
    expect(wrapper.emitted('reviewPendingAction')).toEqual([['pa_3']]);
    wrapper.unmount();
  });
});

describe('prepared portraits on the stage', () => {
  const roster = [
    { id: 'nian', name: '念念', aliases: [], looks: { nameColor: '#E9C983' } },
    { id: 'lu', name: '陆', aliases: [] },
    { id: 'old', name: '老周', aliases: [] },
  ];
  const cast = [
    { characterId: 'nian', name: '念念', position: 'left' as const },
    { characterId: 'lu', name: '陆', position: 'center' as const },
    { characterId: 'old', name: '老周', position: 'right' as const },
  ];
  const turn = {
    id: 'turn-a', speaker: 'world-referee', content: '“回来。”', createdAt: '2026-01-01T08:00:00.000Z',
    stageSnapshot: { sceneId: '客栈', activeCharacters: cast, beats: [{ text: '“回来。”', speaker: '念念', isDialogue: true }] },
  };
  const LEGACY = 'data:image/png;base64,iVBORw0KGgo=';
  function sets(hash: string | undefined) {
    return {
      nian: { default: 'casual', items: [{ id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/casual.png', ...(hash ? { sha256: hash } : {}) }, { id: 'night', label: '夜行', description: '黑色斗篷。' }], skipped: [] },
      lu: { default: 'coat', items: [{ id: 'coat', label: '风衣', description: '灰色长风衣，领子竖起。' }], skipped: [] },
    };
  }
  function mountStage(portraitSets: unknown) {
    return mount(VisualNovelStage, {
      attachTo: document.body,
      props: { sessionId: 'a', scene: '客栈', turns: [turn], choices: [], disabled: false, roster, portraits: { old: LEGACY, nian: LEGACY }, portraitSets },
    });
  }

  it('shows the default image as the original file, a silhouette with its description, and the old single image', async () => {
    const wrapper = mountStage(sets(sha(ORIGINAL)));
    await vi.waitFor(() => expect(wrapper.findAll('.vn-cast > span')[0]!.find('img').exists()).toBe(true));
    const [nian, lu, old] = wrapper.findAll('.vn-cast > span');
    // The prepared set wins over the launch-time data URL, and the image comes from the asset folder.
    expect(api.readImageAsset).toHaveBeenCalledWith('assets/portraits/nian/casual.png');
    expect(api.readImageAsset).toHaveBeenCalledTimes(1);
    expect(nian!.get('img').attributes()).toMatchObject({ src: 'blob:image', alt: '念念（常服）' });
    expect(nian!.text()).not.toContain('开局后已更换');
    expect(nian!.attributes('title')).toBe('常服：米色开衫，袖口挽起。');
    expect(lu!.find('img').exists()).toBe(false);
    expect(lu!.get('.vn-silhouette').attributes('aria-label')).toBe('陆（风衣）的剪影：灰色长风衣，领子竖起。');
    expect(lu!.text()).toContain('陆');
    expect(old!.get('img').attributes('src')).toBe(LEGACY);
    wrapper.unmount();
  });

  it('marks an image replaced since the session started, and falls back to a silhouette with the reason when it is gone', async () => {
    api.readImageAsset.mockResolvedValue(new Blob([REPLACED], { type: 'image/png' }));
    const replaced = mountStage(sets(sha(ORIGINAL)));
    // Native WebCrypto work can outlive a fixed number of promise flushes.
    await vi.waitFor(() => expect(replaced.findAll('.vn-cast > span')[0]!.find('img').exists()).toBe(true));
    const changed = replaced.findAll('.vn-cast > span')[0]!;
    expect(changed.get('img').attributes('src')).toBe('blob:image');
    expect(changed.text()).toContain('开局后已更换');
    replaced.unmount();

    api.readImageAsset.mockRejectedValue(new Error('图片文件不存在。图片不随 Git 同步，换一台机器后需要重新放入。'));
    const gone = mountStage(sets(sha(ORIGINAL)));
    await flushPromises();
    await flushPromises();
    const missing = gone.findAll('.vn-cast > span')[0]!;
    expect(missing.find('img').exists()).toBe(false);
    expect(missing.get('.vn-silhouette').attributes('aria-label')).toContain('米色开衫');
    expect(missing.get('.vn-portrait-note').text()).toContain('图片不随 Git 同步');
    gone.unmount();
  });

  it('behaves as before for a session that recorded no portrait sets', async () => {
    const wrapper = mountStage(undefined);
    await flushPromises();
    const spans = wrapper.findAll('.vn-cast > span');
    expect(spans[0]!.get('img').attributes('src')).toBe(LEGACY);
    expect(spans[1]!.find('img').exists()).toBe(false);
    expect(spans[1]!.find('.vn-silhouette').exists()).toBe(false);
    expect(spans[1]!.text()).toBe('陆');
    expect(api.readImageAsset).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('tells the author which portraits a session left out', async () => {
    const session = {
      schemaVersion: 4, id: 'play-1', title: 'Station', sceneStart: '客栈', characters: ['念念'], transcript: [turn], revision: 1,
      metadataExtensions: {
        characterRoster: roster,
        characterPortraitSets: { nian: { ...sets(undefined).nian, skipped: ['p9', 'p10'] } },
      },
    };
    const state = {
      actionKind: shallowRef('do'), displaySession: computed(() => session), selectedSession: computed(() => session),
      sending: shallowRef(false), interactionBlocked: computed(() => false), historyCheckpoints: shallowRef([]), historyNotice: shallowRef(''),
      historyWindow: { transcript: shallowRef(undefined), loadingEarlierTranscript: shallowRef(false), loadEarlierTranscript: vi.fn() },
      canStop: shallowRef(false), canSteer: computed(() => false), followUpControls: computed(() => ({ items: [], notice: '', paused: false })),
      provisionalTurn: shallowRef(undefined), turnAnnouncement: shallowRef(''), timeAdvance: shallowRef(undefined), suggestedActions: computed(() => []),
      userText: shallowRef(''), retryCheckpoint: vi.fn(), restoreCheckpoint: vi.fn(), stopTurn: vi.fn(), steerTurn: vi.fn(), submitChoice: vi.fn(), submitTurn: vi.fn(),
    } as unknown as PlayWorkspaceState;
    const wrapper = mount(PlayStageShell, { attachTo: document.body, props: { play: state, providerConfigured: true } });
    await flushPromises();
    const note = wrapper.findAll('[role="note"]').find(item => item.text().includes('没有带入'))!;
    expect(note.text()).toContain('每个角色最多带 8 套立绘');
    expect(note.text()).toContain('念念有 2 套');
    await note.get('button').trigger('click');
    expect(wrapper.text()).not.toContain('没有带入');
    wrapper.unmount();
  });
});
