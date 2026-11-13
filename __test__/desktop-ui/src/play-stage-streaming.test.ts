// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { PlayTurnStreamEvent } from '@oh-awesome-novel/client';
import PlaySessionCreateForm from '../../../apps/desktop-ui/src/components/play/PlaySessionCreateForm.vue';
import PlayTranscript from '../../../apps/desktop-ui/src/components/play/PlayTranscript.vue';
import VisualNovelStage from '../../../apps/desktop-ui/src/components/play/VisualNovelStage.vue';
import VisualNovelTextBox from '../../../apps/desktop-ui/src/components/play/VisualNovelTextBox.vue';
import { projectContextTrace } from '../../../apps/desktop-ui/src/composables/usePlaySessionHistoryWindow';
import { usePlayTurnStream, type PlayTurnStreamClient } from '../../../apps/desktop-ui/src/composables/usePlayTurnStream';

const base = { sessionId: 'play-1', turnId: 'run-1' };
let sequence = 0;
function event<T extends PlayTurnStreamEvent['type']>(type: T, payload: Record<string, unknown> = {}): PlayTurnStreamEvent {
  sequence += 1;
  return { type, eventId: `run-1:${sequence}`, sequence, ...base, ...payload } as PlayTurnStreamEvent;
}
const started = () => event('play.turn.started', { baseRevision: 0, expectedArtifactId: 'turn-artifact-1' });
const delta = (text: string, markup?: unknown) => event('play.narrative.delta', { delta: text, provisional: true, ...(markup ? { markup } : {}) });
const failed = () => event('play.turn.failed', { error: { code: 'invalid_settlement', message: 'Settlement validation failed.', retryable: true } });
const submitInput = { sessionId: 'play-1', baseRevision: 0, userText: '推门', actionKind: 'do' as const };

function client(stream: PlayTurnStreamClient['streamPlayWorldRefereeTurn']): PlayTurnStreamClient & { retry: ReturnType<typeof vi.fn> } {
  // Its own mock: wrapping `stream` would share that mock's call list.
  const retry = vi.fn(async function* () { yield started(); yield failed(); });
  return {
    streamPlayWorldRefereeTurn: stream,
    retryPlayWorldRefereeTurn: retry as unknown as PlayTurnStreamClient['retryPlayWorldRefereeTurn'],
    cancelPlayWorldRefereeTurn: async () => ({ status: 'cancelled', committed: false, turnId: 'run-1' }),
    retry,
  };
}

describe('turn presentation and draft markup in the stream composable', () => {
  beforeEach(() => { sequence = 0; });

  it('names the stage only for a turn sent from the stage, and fixes it when the request is made', async () => {
    let mode: 'stage' | 'workbench' = 'workbench';
    const stream = vi.fn(async function* () {
      yield started();
      // Switching the view while the turn runs does not start another request.
      mode = mode === 'stage' ? 'workbench' : 'stage';
      yield failed();
    });
    const api = client(stream);
    const flow = usePlayTurnStream({ client: api, onCommitted: vi.fn(), presentation: () => mode });

    await flow.submit(submitInput);
    // The workbench is the server default: the request is exactly what it was before.
    expect(stream.mock.calls[0]![1]).toEqual({ userText: '推门', actionKind: 'do', baseRevision: 0 });

    sequence = 0;
    await flow.submit(submitInput);
    expect(stream.mock.calls[1]![1]).toEqual({ userText: '推门', actionKind: 'do', baseRevision: 0, presentation: 'stage' });
    expect(stream).toHaveBeenCalledTimes(2);

    sequence = 0;
    mode = 'stage';
    await flow.retry({ ...submitInput, artifactId: 'turn-artifact-1' });
    expect(api.retry.mock.calls[0]![2]).toEqual({ baseRevision: 0, presentation: 'stage' });
  });

  it('collects tagged draft lines with the draft and drops them when the draft is withdrawn', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const flow = usePlayTurnStream({
      client: client(async function* () {
        yield started();
        yield delta('念念放下灯。\n');
        yield delta('“你又迟到了！”\n', [{ line: 1, speakerId: 'nian', speaker: '念念', portraitId: 'angry' }]);
        yield delta('“抱歉。”\n', [{ line: 2, speakerId: 'lin', speaker: '林师兄' }]);
        await gate;
        yield failed();
      }),
      onCommitted: vi.fn(),
    });
    const outcome = flow.submit(submitInput);
    await vi.waitFor(() => expect(flow.run.value?.provisionalText).toBe('念念放下灯。\n“你又迟到了！”\n“抱歉。”\n'));
    expect(flow.run.value?.provisionalMarkup).toEqual([
      { line: 1, speakerId: 'nian', speaker: '念念', portraitId: 'angry' },
      { line: 2, speakerId: 'lin', speaker: '林师兄' },
    ]);
    release();
    await expect(outcome).resolves.toBe('failed');
    expect(flow.run.value).toMatchObject({ phase: 'failed', provisionalText: '' });
    expect(flow.run.value).not.toHaveProperty('provisionalMarkup');
  });
});

const roster = [
  { id: 'nian', name: '念念', aliases: [], looks: {} },
  { id: 'lin', name: '林师兄', aliases: [], looks: {} },
];
const portraitSets = {
  nian: { default: 'calm', skipped: [], items: [
    { id: 'calm', label: '平静', description: '垂着眼。' },
    { id: 'angry', label: '生气', description: '皱眉瞪人。' },
  ] },
};
function mountStage(props: Record<string, unknown> = {}) {
  return mount(VisualNovelStage, {
    attachTo: document.body,
    props: { sessionId: 'a', scene: '客栈', turns: [], choices: [], disabled: false, roster, portraitSets, ...props },
  });
}
const shown = (wrapper: ReturnType<typeof mountStage>) => wrapper.findComponent(VisualNovelTextBox).props('beat')?.text;
/** Every sentence the text box showed while time passed, in order, without consecutive duplicates. */
async function play(wrapper: ReturnType<typeof mountStage>, ms: number, seen: string[]): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 25) {
    await vi.advanceTimersByTimeAsync(25);
    const text = shown(wrapper);
    if (text && seen.at(-1) !== text) seen.push(text);
  }
}

describe('stage draft queue', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('plays sentences that arrive all at once one after another, without skipping or repeating', async () => {
    const wrapper = mountStage({ draftAction: '推门', draft: '' });
    const seen: string[] = [shown(wrapper)!];
    await wrapper.setProps({ draft: '第一句。第二句。第三句。' });
    await play(wrapper, 6000, seen);
    expect(seen).toEqual(['推门', '第一句。', '第二句。', '第三句。']);
    expect(wrapper.find('.vn-status').text()).toContain('尚未保存');
    wrapper.unmount();
  });

  it('plays sentences that arrive slowly in the same order and waits on the last one', async () => {
    const wrapper = mountStage({ draftAction: '推门', draft: '' });
    const seen: string[] = [shown(wrapper)!];
    await play(wrapper, 2000, seen);
    await wrapper.setProps({ draft: '第一句。' });
    await play(wrapper, 3000, seen);
    // Nothing follows yet: the queue stays on the newest sentence.
    expect(seen).toEqual(['推门', '第一句。']);
    await wrapper.setProps({ draft: '第一句。第二句。' });
    await play(wrapper, 3000, seen);
    await wrapper.setProps({ draft: '第一句。第二句。第三句。' });
    await play(wrapper, 3000, seen);
    expect(seen).toEqual(['推门', '第一句。', '第二句。', '第三句。']);
    wrapper.unmount();
  });

  it('does not interrupt the sentence being typed when a new one arrives', async () => {
    const wrapper = mountStage({ draft: '这是正在打字的第一句话。' });
    await vi.advanceTimersByTimeAsync(100);
    const typed = wrapper.find('.vn-textbox span').text();
    expect(typed.length).toBeGreaterThan(1);
    expect(typed.length).toBeLessThan('这是正在打字的第一句话。'.length);
    await wrapper.setProps({ draft: '这是正在打字的第一句话。第二句。' });
    expect(shown(wrapper)).toBe('这是正在打字的第一句话。');
    expect(wrapper.find('.vn-textbox span').text().startsWith(typed)).toBe(true);
    wrapper.unmount();
  });

  it('takes the draft down when the turn fails and stops advancing', async () => {
    const committed = { id: 'turn-a', speaker: 'world-referee', content: '旧的一句。', createdAt: '2026-01-01T08:00:00.000Z' };
    const wrapper = mountStage({ turns: [committed], draftAction: '推门', draft: '第一句。第二句。' });
    await vi.advanceTimersByTimeAsync(400);
    await wrapper.setProps({ draft: undefined, draftAction: undefined });
    expect(wrapper.find('.vn-status').exists()).toBe(false);
    const seen: string[] = [];
    await play(wrapper, 4000, seen);
    expect(seen).toEqual(['旧的一句。']);
    wrapper.unmount();
  });
});

describe('stage markup on the stage and in the workbench', () => {
  beforeEach(() => {
    localStorage.setItem('oan:play:stage-reading', JSON.stringify({ typewriter: false }));
  });

  const tagged = {
    id: 'turn-a', speaker: 'world-referee', createdAt: '2026-01-01T08:00:00.000Z',
    content: '灯灭了。\n“你又迟到了！”\n“抱歉。”\n“算了。”',
    stageSnapshot: {
      sceneId: '客栈',
      activeCharacters: [{ characterId: 'nian', name: '念念', position: 'left' as const }, { characterId: 'lin', name: '林师兄', position: 'right' as const }],
      beats: [
        { text: '灯灭了。', speaker: '', isDialogue: false },
        { text: '“你又迟到了！”', speaker: '念念', isDialogue: true, speakerId: 'nian', portraitId: 'angry', source: 'markup' as const },
        { text: '“抱歉。”', speaker: '林师兄', isDialogue: true, speakerId: 'lin', source: 'markup' as const },
        { text: '“算了。”', speaker: '念念', isDialogue: true, speakerId: 'nian', source: 'markup' as const },
      ],
    },
  };

  it('shows the tagged speaker and switches to the portrait the referee chose', async () => {
    const wrapper = mountStage({ turns: [tagged] });
    const nian = () => wrapper.findAll('.vn-cast > span').find(item => item.text().includes('念念'))!;
    expect(nian().attributes('title')).toContain('平静');
    expect(nian().classes()).not.toContain('speaking');

    await wrapper.get('.vn-textbox').trigger('click');
    expect(shown(wrapper)).toBe('“你又迟到了！”');
    expect(wrapper.find('.vn-name').text()).toBe('念念');
    expect(nian().attributes('title')).toContain('生气');
    expect(nian().classes()).toContain('speaking');

    await wrapper.get('.vn-textbox').trigger('click');
    expect(wrapper.find('.vn-name').text()).toBe('林师兄');
    expect(nian().classes()).not.toContain('speaking');
    // A later line without a portrait keeps the one already on stage.
    await wrapper.get('.vn-textbox').trigger('click');
    expect(nian().attributes('title')).toContain('生气');
    wrapper.unmount();
  });

  it('uses the tagged lines of a draft instead of guessing the speaker', async () => {
    const wrapper = mountStage({
      draft: '灯灭了。\n“你又迟到了！”\n',
      draftMarkup: [{ line: 1, speakerId: 'nian', speaker: '念念', portraitId: 'angry' }],
    });
    await wrapper.get('.vn-textbox').trigger('click');
    expect(shown(wrapper)).toBe('“你又迟到了！”');
    expect(wrapper.find('.vn-name').text()).toBe('念念');
    expect(wrapper.find('.vn-cast > span').attributes('title')).toContain('生气');
    wrapper.unmount();
  });

  it('lists the tagged speakers beside the text in the workbench and reports fallbacks in the trace', () => {
    const wrapper = mount(PlayTranscript, { props: { title: 'Stage', sceneStart: '客栈', turns: [tagged], announcement: '' } });
    expect(wrapper.findAll('.play-turn-markup li').map(item => item.text())).toEqual(['念念 · angry', '林师兄', '念念']);
    expect(wrapper.find('.play-turn p').text()).not.toContain('@');
    wrapper.unmount();

    const view = projectContextTrace({
      schemaVersion: 1, sessionId: 'play-1', sessionRevision: 1, artifactId: 'turn-artifact-1', createdAt: '2026-01-01T08:00:00.000Z',
      transcriptWindow: { kind: 'transcript', availableCount: 2, selectedCount: 2, selectedIds: [], omittedCount: 0, limit: 12 },
      eventWindow: { kind: 'event', availableCount: 0, selectedCount: 0, selectedIds: [], omittedCount: 0, limit: 8 },
      sources: [],
      stageMarkupNotices: [{ kind: 'unknownPortrait', count: 2, sample: 'nian[smirk]' }, { kind: 'malformed', count: 1, sample: '@lin[oops' }],
      canonical: false,
    }, false);
    expect(view.stageMarkupNotices).toEqual([
      '演出标注：2 行标了不存在的立绘（如 nian[smirk]），已改用默认立绘。',
      '演出标注：1 行标注格式不完整（如“@lin[oops”），已按旁白处理。',
    ]);
  });

  it('offers stage markup when a session is created and leaves it out unless ticked', async () => {
    const wrapper = mount(PlaySessionCreateForm, { props: { creating: false } });
    const inputs = wrapper.findAll('label').filter(label => !label.classes().includes('play-stage-markup-option'));
    await inputs.find(label => label.text().startsWith('标题'))!.find('input').setValue('雨夜');
    await inputs.find(label => label.text().startsWith('开场场景'))!.find('textarea').setValue('客栈。');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('create')![0]![0]).not.toHaveProperty('stageMarkup');
    await wrapper.get('.play-stage-markup-option input').setValue(true);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('create')![1]![0]).toMatchObject({ stageMarkup: true });
    wrapper.unmount();
  });
});
