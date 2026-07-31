// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import type { DOMWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getWritingProfiles: vi.fn(),
  createWritingProfile: vi.fn(),
  cloneWritingProfile: vi.fn(),
  updateWritingProfile: vi.fn(),
  deleteWritingProfile: vi.fn(),
  activateWritingProfile: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import WritingProfileCard from '../../../apps/desktop-ui/src/components/workspace/writing-profile/WritingProfileCard.vue';
import WritingProfileManagerTab from '../../../apps/desktop-ui/src/components/workspace/writing-profile/WritingProfileManagerTab.vue';
import WritingProfileSummary from '../../../apps/desktop-ui/src/components/workspace/writing-profile/WritingProfileSummary.vue';
import type {
  WritingProfile,
  WritingProfileState,
} from '@oh-awesome-novel/client';

describe('Writing Profile UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const state = profileState();
    api.createWritingProfile.mockResolvedValue({ state });
    api.cloneWritingProfile.mockResolvedValue({ state });
    api.updateWritingProfile.mockResolvedValue({ state });
    api.deleteWritingProfile.mockResolvedValue({ state });
    api.activateWritingProfile.mockResolvedValue({ state });
  });

  it('shows the active Profile reminder summary in Writing', () => {
    const wrapper = mount(WritingProfileSummary, {
      props: { state: profileState() },
    });

    expect(wrapper.text()).toContain('Writing Profile：商业写作');
    expect(wrapper.text()).toContain('Outputs：抽象技法');
    expect(wrapper.text()).toContain('Reminders：独立表达、AI 味审查');
    expect(wrapper.text()).not.toContain('reference source');
  });

  it('keeps built-in cards read-only while allowing cloning', () => {
    const item = profileState().profiles[0]!;
    const wrapper = mount(WritingProfileCard, {
      props: {
        item,
        busy: false,
        deleteConfirming: false,
      },
    });

    expect(wrapper.text()).toContain('内置只读');
    expect(wrapper.text()).not.toContain('编辑');
    expect(wrapper.text()).not.toContain('删除');
    expect(button(wrapper, '克隆').exists()).toBe(true);
  });

  it('creates a fixed-field custom Profile and emits the strict server state', async () => {
    const wrapper = mount(WritingProfileManagerTab, {
      props: {
        state: profileState(),
        loading: false,
        loadError: '',
      },
    });

    await button(wrapper, '新建').trigger('click');
    const inputs = wrapper.findAll('input[type="text"]');
    await inputs[0]!.setValue('custom-profile');
    await inputs[1]!.setValue('自定义写作');
    await wrapper.find('textarea').setValue('组合固定拆书输出和提醒。');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(api.createWritingProfile).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      id: 'custom-profile',
      displayName: '自定义写作',
      deconstruction: { outputs: ['techniques'] },
      writingReminders: {
        originality: false,
        aiVoice: false,
        characterConsistency: false,
        adaptationFreedom: false,
      },
    }));
    expect(wrapper.emitted('stateChanged')).toHaveLength(1);
  });

  it('clones a complete preset and activates another Profile explicitly', async () => {
    const wrapper = mount(WritingProfileManagerTab, {
      props: {
        state: profileState(),
        loading: false,
        loadError: '',
      },
    });
    const fanfictionCard = wrapper.findAll('.writing-profile-card')
      .find((card) => card.text().includes('同人二创写作'))!;

    await button(fanfictionCard, '克隆').trigger('click');
    await wrapper.find('input[type="text"]').setValue('fanfiction-copy');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(api.cloneWritingProfile).toHaveBeenCalledWith(
      'fanfictionWriting',
      expect.objectContaining({ id: 'fanfiction-copy' }),
    );

    await button(fanfictionCard, '设为当前').trigger('click');
    await flushPromises();
    expect(api.activateWritingProfile).toHaveBeenCalledWith('fanfictionWriting');
  });
});

function profileState(): WritingProfileState {
  const commercial = profile({
    id: 'commercialWriting',
    displayName: '商业写作',
    outputs: ['techniques'],
    reminders: ['originality', 'aiVoice'],
  });
  const fanfiction = profile({
    id: 'fanfictionWriting',
    displayName: '同人二创写作',
    outputs: ['world', 'characters', 'relationships', 'outline', 'timeline'],
    reminders: ['characterConsistency', 'adaptationFreedom'],
  });
  return {
    activeProfileId: commercial.id,
    activeProfile: commercial,
    profiles: [
      { profile: commercial, builtIn: true, active: true },
      { profile: fanfiction, builtIn: true, active: false },
    ],
    fallbackUsed: false,
    profileErrors: [],
    summary: {
      profileId: commercial.id,
      displayName: commercial.displayName,
      outputs: [...commercial.deconstruction.outputs],
      reminders: ['originality', 'aiVoice'],
    },
  };
}

function profile(input: {
  id: string;
  displayName: string;
  outputs: WritingProfile['deconstruction']['outputs'];
  reminders: Array<keyof WritingProfile['writingReminders']>;
}): WritingProfile {
  return {
    version: 1,
    id: input.id,
    displayName: input.displayName,
    description: `${input.displayName} preset.`,
    deconstruction: { outputs: input.outputs },
    writingReminders: {
      originality: input.reminders.includes('originality'),
      aiVoice: input.reminders.includes('aiVoice'),
      characterConsistency: input.reminders.includes('characterConsistency'),
      adaptationFreedom: input.reminders.includes('adaptationFreedom'),
    },
  };
}

function button(
  wrapper: { findAll(selector: string): DOMWrapper<Element>[] },
  label: string,
): DOMWrapper<Element> {
  return wrapper.findAll('button').find((candidate) =>
    candidate.text().trim() === label)!;
}
