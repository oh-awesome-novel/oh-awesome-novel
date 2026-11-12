// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { PlayCharacterCheckReportView } from '@oh-awesome-novel/client';

import PlayCharacterCheckPanel from '../../../apps/desktop-ui/src/components/play/PlayCharacterCheckPanel.vue';
import PlayTranscript from '../../../apps/desktop-ui/src/components/play/PlayTranscript.vue';
import PlayWorldlineNode from '../../../apps/desktop-ui/src/components/play/PlayWorldlineNode.vue';
import PlayRehearsalStepPanel from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayRehearsalStepPanel.vue';
import PlayDirectorInterventionPanel from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayDirectorInterventionPanel.vue';
import { usePlayCharacterCheck } from '../../../apps/desktop-ui/src/composables/usePlayCharacterCheck';
import type { PlayRehearsalStepView } from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

const finding = {
  id: 'finding-1', characterRef: 'shen-yan', character: '沈砚', category: 'voice' as const, quote: '我把所有计划都告诉你吧',
  segmentId: 'message-2', evidence: '沈砚说话极少。', evidenceSource: '角色卡（characters/shen-yan/profile.md）', note: '她不会主动解释。',
};
const report = (patch: Partial<PlayCharacterCheckReportView> = {}): PlayCharacterCheckReportView => ({
  schemaVersion: 1, id: 'character-check-1', sessionId: 'play', target: { kind: 'turn', turnId: 'turn-artifact-1' }, lens: 'player',
  branchTurnIds: ['turn-artifact-1'], narrativeHash: 'a'.repeat(64), createdAt: '2026-11-12T00:00:00.000Z',
  characters: [{ ref: 'shen-yan', name: '沈砚', status: 'referenced' }], findings: [finding], discardedCount: 0, omissions: [], stale: false,
  ...patch,
});
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find((item) => item.text() === text)!;

describe('PlayCharacterCheckPanel', () => {
  it('shows both quotes and offers the two exits for a current report', async () => {
    const wrapper = mount(PlayCharacterCheckPanel, { props: { reports: [report({ discardedCount: 2 })], lens: 'player', targetLabels: { 'turn-artifact-1': '第 1 回合' } } });
    expect(wrapper.text()).toContain('第 1 回合');
    expect(wrapper.get('.play-character-check-quote').text()).toContain(finding.quote);
    expect(wrapper.get('.play-character-check-evidence').text()).toContain(finding.evidence);
    expect(wrapper.get('.play-character-check-discarded').text()).toContain('已丢弃 2 条意见');
    await button(wrapper, '带着这条意见重演').trigger('click');
    await button(wrapper, '记为观察笔记').trigger('click');
    expect(wrapper.emitted('retryWith')?.[0]).toEqual([expect.objectContaining({ id: 'character-check-1' }), finding]);
    expect(wrapper.emitted('note')).toHaveLength(1);
  });

  it('disables the Retry exit on a stale report and never offers it as current advice', async () => {
    const wrapper = mount(PlayCharacterCheckPanel, { props: { reports: [report({ stale: true })], lens: 'player' } });
    expect(wrapper.get('.play-character-check-stale').text()).toContain('已过期');
    const retry = button(wrapper, '带着这条意见重演');
    expect(retry.attributes('disabled')).toBeDefined();
    await retry.trigger('click');
    expect(wrapper.emitted('retryWith')).toBeUndefined();
  });

  it('says "no reference" instead of "no problem" for characters without material', () => {
    const wrapper = mount(PlayCharacterCheckPanel, { props: { lens: 'director', reports: [report({
      findings: [], characters: [{ ref: 'improvised:店小二', name: '店小二', status: 'noReference' }, { ref: 'lin', name: '林默', status: 'omitted' }],
      omissions: ['未纳入 林默 的角色卡（characters/lin/profile.md）（9000 字），超出本次检查的输入上限。'],
    })] } });
    expect(wrapper.text()).toContain('无可对照资料：店小二');
    expect(wrapper.text()).toContain('这不代表没有问题');
    expect(wrapper.text()).toContain('资料未纳入：林默');
    expect(wrapper.text()).toContain('未纳入 林默 的角色卡');
    expect(wrapper.find('.play-character-check-clean').exists()).toBe(false);
  });

  it('hides the observation exit for rehearsal reports', () => {
    const wrapper = mount(PlayCharacterCheckPanel, { props: { reports: [report()], lens: 'director', canNote: false } });
    expect(button(wrapper, '记为观察笔记')).toBeUndefined();
  });
});

describe('check entry points', () => {
  it('offers the check only on committed narrative messages', async () => {
    const wrapper = mount(PlayTranscript, { props: {
      title: 't', sceneStart: 's', announcement: '', checkable: true,
      turns: [
        { id: 'message-1', speaker: 'user', content: '走近她', createdAt: '2026-11-12T00:00:00.000Z' },
        { id: 'message-2', speaker: 'world-referee', content: '沈砚笑了。', createdAt: '2026-11-12T00:00:01.000Z' },
        { id: 'message-3', speaker: 'director', content: '导演记录', createdAt: '2026-11-12T00:00:02.000Z' },
        { speaker: 'world-referee', content: '没有编号的旧消息', createdAt: '2026-11-12T00:00:03.000Z' },
      ],
    } });
    expect(wrapper.findAll('[data-check-message]').map((item) => item.attributes('data-check-message'))).toEqual(['message-2']);
    await wrapper.get('[data-check-message]').trigger('click');
    expect(wrapper.emitted('checkCharacter')).toEqual([['message-2']]);
    await wrapper.setProps({ checkingMessageId: 'message-2' });
    expect(wrapper.get('[data-check-message]').text()).toBe('正在检查…');
    expect(wrapper.get('[data-check-message]').attributes('disabled')).toBeDefined();
  });

  it('opens the guided Retry box prefilled and editable, without retrying', async () => {
    const checkpoint = {
      checkpointId: 'turn-artifact-1', kind: 'turn' as const, artifactId: 'turn-artifact-1', selectedTurnIds: ['turn-artifact-1'], depth: 1,
      revision: 1, worldTurn: 1, committedAt: '2026-11-12T00:00:00.000Z', preview: '走近她', status: 'current' as const,
      restorable: false, retryable: true, canonical: false as const,
    };
    const wrapper = mount(PlayWorldlineNode, { attachTo: document.body, props: { checkpoint, sessionRevision: 1, loading: false, busyCheckpointId: '', blocked: false } });
    expect(wrapper.find('.play-retry-guidance').exists()).toBe(false);
    await wrapper.setProps({ retryDraft: { checkpointId: 'other-turn', guidance: '不是这里', nonce: 1 } });
    expect(wrapper.find('.play-retry-guidance').exists()).toBe(false);
    await wrapper.setProps({ retryDraft: { checkpointId: 'turn-artifact-1', guidance: '沈砚的这句不太像本人。', nonce: 2 } });
    await flushPromises();
    expect(wrapper.get<HTMLTextAreaElement>('.play-retry-guidance').element.value).toBe('沈砚的这句不太像本人。');
    expect(wrapper.emitted('retry')).toBeUndefined();
    await wrapper.get('.play-retry-guidance').setValue('改写后的要求');
    await wrapper.get('.play-history-confirm').trigger('click');
    expect(wrapper.emitted('retry')).toEqual([['turn-artifact-1', '改写后的要求']]);
    wrapper.unmount();
  });

  const steps: PlayRehearsalStepView[] = [
    { id: 'step-1', participantRef: 'p', participantName: '沈砚', status: 'provisional', blocks: [{ id: 'b1', kind: 'characterSpeech', content: '我全都告诉你。', projection: 'transcript' }] },
    { id: 'step-0', participantRef: 'p', participantName: '沈砚', status: 'superseded', blocks: [{ id: 'b0', kind: 'characterSpeech', content: '旧结果。', projection: 'transcript' }] },
  ];

  it('offers the check on live rehearsal steps only', async () => {
    const wrapper = mount(PlayRehearsalStepPanel, { props: { steps, canStop: false } });
    expect(wrapper.findAll('[data-check-step]').map((item) => item.attributes('data-check-step'))).toEqual(['step-1']);
    await wrapper.get('[data-check-step]').trigger('click');
    expect(wrapper.emitted('checkStep')).toEqual([['step-1']]);
  });

  it('seeds the rehearsal redirect form with editable director intent', async () => {
    const wrapper = mount(PlayDirectorInterventionPanel, { attachTo: document.body, props: {
      mode: 'modify', steps, participants: [], activeStepRef: 'step-1', busy: false,
      redirectSeed: { stepRef: 'step-1', intent: '沈砚的这句不太像本人。', nonce: 1 },
    } });
    await flushPromises();
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('沈砚的这句不太像本人。');
    expect(wrapper.emitted('submit')).toBeUndefined();
    await button(wrapper, '应用干预').trigger('click');
    expect(wrapper.emitted('submit')?.[0]).toEqual([expect.objectContaining({ kind: 'redirectStep', stepRef: 'step-1', directorIntent: '沈砚的这句不太像本人。' })]);
    wrapper.unmount();
  });
});

describe('usePlayCharacterCheck', () => {
  function harness(client: Parameters<typeof usePlayCharacterCheck>[0]['client']) {
    const lens = shallowRef<'player' | 'director'>('player');
    const branchKey = shallowRef('a');
    let state!: ReturnType<typeof usePlayCharacterCheck>;
    const wrapper = mount(defineComponent({
      setup() {
        state = usePlayCharacterCheck({ client, scope: computed(() => ({ sessionId: 'play', lens: lens.value, branchKey: branchKey.value })), blocked: shallowRef(false) });
        return () => h('div');
      },
    }));
    return { wrapper, state, lens, branchKey };
  }

  it('loads one lens at a time and clears the other lens before switching', async () => {
    const director = report({ id: 'director-report', lens: 'director' });
    const listPlayCharacterChecks = vi.fn(async (_id: string, lens: string) => lens === 'director' ? [director] : [report()]);
    const { state, lens, branchKey } = harness({ listPlayCharacterChecks, requestPlayCharacterCheck: vi.fn() });
    await flushPromises();
    expect(state.reports.value.map((item) => item.lens)).toEqual(['player']);
    lens.value = 'director';
    await Promise.resolve();
    // Nothing of the previous lens stays on screen while the next one loads.
    expect(state.reports.value).toEqual([]);
    await flushPromises();
    expect(state.reports.value.map((item) => item.id)).toEqual(['director-report']);
    lens.value = 'player';
    await Promise.resolve();
    expect(state.reports.value).toEqual([]);
    await flushPromises();
    expect(JSON.stringify(state.reports.value)).not.toContain('director-report');
    // A branch change re-reads stale flags.
    branchKey.value = 'b';
    await flushPromises();
    expect(listPlayCharacterChecks).toHaveBeenLastCalledWith('play', 'player');
    expect(listPlayCharacterChecks).toHaveBeenCalledTimes(4);
  });

  it('keeps no report when the check fails or is cancelled', async () => {
    let reject!: (error: Error) => void;
    const requestPlayCharacterCheck = vi.fn((_id: string, _input: unknown, signal?: AbortSignal) => new Promise<PlayCharacterCheckReportView>((_resolve, fail) => {
      reject = fail;
      signal?.addEventListener('abort', () => fail(new Error('aborted')));
    }));
    const { state } = harness({ listPlayCharacterChecks: vi.fn(async () => []), requestPlayCharacterCheck });
    await flushPromises();
    const failed = state.check({ kind: 'turnMessage', messageId: 'message-2' });
    expect(state.running.value).toEqual({ kind: 'turnMessage', messageId: 'message-2' });
    // One click, one call: a second click while running is ignored.
    expect(await state.check({ kind: 'turnMessage', messageId: 'message-2' })).toBe(false);
    reject(new Error('模型返回的检查结果不是有效的 JSON。'));
    expect(await failed).toBe(false);
    expect(state.error.value).toContain('没有保存任何报告');
    expect(state.reports.value).toEqual([]);

    const cancelled = state.check({ kind: 'turnMessage', messageId: 'message-2' });
    state.cancel();
    expect(await cancelled).toBe(false);
    expect(state.running.value).toBeUndefined();
    expect(state.reports.value).toEqual([]);
    expect(requestPlayCharacterCheck).toHaveBeenCalledTimes(2);
  });
});
