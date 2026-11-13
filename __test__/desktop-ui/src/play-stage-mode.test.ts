// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { computed, shallowRef } from 'vue';

import type {
  PlayCheckpointSummary,
  PlaySession,
  PlayTurnArtifact,
  PlayTurnStreamEvent,
  PlayTurnStreamOptions,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  listPlaySessions: vi.fn(),
  listPlaySessionSummaries: vi.fn(),
  getPlaySession: vi.fn(),
  getPlaySessionDetail: vi.fn(),
  listPlayContextTraces: vi.fn(),
  getPlaySourceDrift: vi.fn(),
  listPlayCheckpoints: vi.fn(),
  streamPlayWorldRefereeTurn: vi.fn(),
  retryPlayWorldRefereeTurn: vi.fn(),
  cancelPlayWorldRefereeTurn: vi.fn(),
  restorePlayCheckpoint: vi.fn(),
  requestPlayExtraSuggestions: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayEventFeed from '../../../apps/desktop-ui/src/components/play/PlayEventFeed.vue';
import PlayStageActionBar from '../../../apps/desktop-ui/src/components/play/PlayStageActionBar.vue';
import PlayStageShell from '../../../apps/desktop-ui/src/components/play/PlayStageShell.vue';
import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';
import VisualNovelTextBox from '../../../apps/desktop-ui/src/components/play/VisualNovelTextBox.vue';
import { usePlayPresentationMode } from '../../../apps/desktop-ui/src/composables/usePlayPresentationMode';
import type { PlayWorkspaceState } from '../../../apps/desktop-ui/src/composables/usePlayWorkspace';
import { installLegacyPlayReadModelMocks } from './support/playReadModelMock';

const WORKSPACE = '/novels/alpha';
const MODE_KEY = `oan:play:presentation-mode:${WORKSPACE}`;

type TurnInput = { userText: string; actionKind?: string; baseRevision?: number; delivery?: string };

describe('Play presentation mode preference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the workbench and remembers the choice per session outside the workspace files', () => {
    const selected = shallowRef('play-1');
    const first = usePlayPresentationMode(WORKSPACE, selected);
    expect(first.mode.value).toBe('workbench');
    expect(first.hasPreference('play-1')).toBe(false);

    first.setMode('stage');
    expect(first.mode.value).toBe('stage');
    selected.value = 'play-2';
    expect(first.mode.value).toBe('workbench');

    expect(JSON.parse(localStorage.getItem(MODE_KEY)!)).toEqual({ 'play-1': 'stage' });
    const reopened = usePlayPresentationMode(WORKSPACE, shallowRef('play-1'));
    expect(reopened.mode.value).toBe('stage');
    expect(usePlayPresentationMode('/novels/other', shallowRef('play-1')).mode.value).toBe('workbench');
  });

  it('ignores a damaged preference record', () => {
    localStorage.setItem(MODE_KEY, '{"play-1":"cinema","play-2":"stage"');
    expect(usePlayPresentationMode(WORKSPACE, shallowRef('play-2')).mode.value).toBe('workbench');
    localStorage.setItem(MODE_KEY, '{"play-1":"cinema","play-2":"stage"}');
    const mode = usePlayPresentationMode(WORKSPACE, shallowRef('play-1'));
    expect(mode.mode.value).toBe('workbench');
    expect(mode.hasPreference('play-2')).toBe(true);
  });
});

describe('PlayWorkspace stage and workbench modes', () => {
  let session: PlaySession;

  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    installLegacyPlayReadModelMocks(api);
    session = createSession(1);
    api.listPlaySessions.mockImplementation(async () => ({ sessions: [session] }));
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
    api.cancelPlayWorldRefereeTurn.mockResolvedValue({ status: 'cancelled', committed: false, turnId: 'run-1' });
  });

  it('keeps the draft, the provisional text and the running turn across switches and commits once', async () => {
    const calls: TurnInput[] = [];
    const streaming = deferred<void>();
    const release = deferred<void>();
    session = { ...createSession(1), suggestedActions: ['[look] 检查门锁'] };
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* (
      _id: string,
      input: TurnInput,
      options?: PlayTurnStreamOptions,
    ) {
      calls.push(input);
      options?.onTurnId?.('run-1');
      yield startedEvent('run-1', input.baseRevision ?? 0);
      yield deltaEvent('run-1', '雨还在下。');
      streaming.resolve();
      await release.promise;
      session = createSession(2);
      yield committedEvent('run-1', session);
    });
    const wrapper = mountWorkspace();
    await flushPromises();
    expect(wrapper.find('.play-stage-shell').exists()).toBe(false);

    await wrapper.get('.play-composer textarea').setValue('推开门');
    await wrapper.get('.play-composer').trigger('submit');
    await streaming.promise;
    await flushPromises();
    await wrapper.get('.play-composer textarea').setValue('下一步');
    const requestsBeforeSwitch = totalReadCalls();

    await switchMode(wrapper, '舞台');
    expect(wrapper.get('.play-stage-shell').text()).toContain('正在演出草稿 · 尚未保存');
    // The author's own action leads the turn on stage; the draft follows it.
    expect(wrapper.findComponent(VisualNovelTextBox).props('beat')).toMatchObject({ speaker: '你', text: '推开门', player: true });
    await wrapper.get('.vn-stage').trigger('keydown', { key: ' ' });
    await wrapper.get('.vn-stage').trigger('keydown', { key: ' ' });
    expect(wrapper.findComponent(VisualNovelTextBox).props('beat')?.text).toContain('雨还在下');
    expect(wrapper.get<HTMLTextAreaElement>('#play-stage-action-input').element.value).toBe('下一步');
    // An unsaved draft offers no options.
    expect(wrapper.find('.vn-choices').exists()).toBe(false);
    expect(wrapper.get<HTMLElement>('.play-workbench-shell').element.style.display).toBe('none');

    await wrapper.get('#play-stage-action-input').setValue('下一步，慢一点');
    await switchMode(wrapper, '专业');
    expect(wrapper.find('.play-stage-shell').exists()).toBe(false);
    expect(wrapper.get<HTMLTextAreaElement>('.play-composer textarea').element.value).toBe('下一步，慢一点');
    expect(wrapper.get('.play-transcript').text()).toContain('雨还在下');

    await switchMode(wrapper, '舞台');
    // Switching reads nothing and calls no model.
    expect(totalReadCalls()).toBe(requestsBeforeSwitch);
    expect(calls).toHaveLength(1);

    release.resolve();
    await flushPromises();
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userText: '推开门', baseRevision: 1 });
    expect(wrapper.get<HTMLTextAreaElement>('#play-stage-action-input').element.value).toBe('下一步，慢一点');
    expect(JSON.parse(localStorage.getItem(MODE_KEY)!)).toEqual({ 'play-1': 'stage' });
    wrapper.unmount();
  });

  it('plays from the stage by keyboard: an option, an edited option and an own action', async () => {
    localStorage.setItem(MODE_KEY, JSON.stringify({ 'play-1': 'stage' }));
    const calls: Array<TurnInput & { timeAdvance?: unknown }> = [];
    const options = ['[say] 问她昨晚去了哪里', '[wait] 守在门外', '[look] 检查门锁'];
    session = { ...createSession(1), suggestedActions: options };
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* (
      _id: string,
      input: TurnInput,
      streamOptions?: PlayTurnStreamOptions,
    ) {
      calls.push(input);
      const turnId = `run-${calls.length}`;
      streamOptions?.onTurnId?.(turnId);
      yield startedEvent(turnId, input.baseRevision ?? 0);
      session = { ...createSession((input.baseRevision ?? 0) + 1), suggestedActions: options };
      yield committedEvent(turnId, session);
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    // The session opens on the stage; the workbench is not even mounted.
    const stage = wrapper.get('.vn-stage');
    expect(wrapper.find('.play-workbench-shell').exists()).toBe(false);
    expect(wrapper.find('.play-composer').exists()).toBe(false);
    expect(document.activeElement).toBe(stage.element);

    await stage.trigger('keydown', { key: '1' });
    await flushPromises();
    await flushPromises();
    expect(calls[0]).toMatchObject({ userText: '问她昨晚去了哪里', actionKind: 'say', baseRevision: 1 });

    // "改一改" moves the option into the stage input with its action kind.
    await wrapper.findAll('.vn-choice-edit')[2]!.trigger('click');
    await flushPromises();
    const input = wrapper.get<HTMLTextAreaElement>('#play-stage-action-input');
    expect(input.element.value).toBe('检查门锁');
    expect(document.activeElement).toBe(input.element);
    // Digits typed into the input are text, not options.
    await input.trigger('keydown', { key: '1' });
    expect(calls).toHaveLength(1);
    await input.setValue('检查门锁，不碰把手');
    await input.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    await flushPromises();
    expect(calls[1]).toMatchObject({ userText: '检查门锁，不碰把手', actionKind: 'look', baseRevision: 2 });
    expect(wrapper.find('#play-stage-action-input').exists()).toBe(false);

    // A wait without a stated duration asks for the duration in the stage input instead of leaving the stage.
    await stage.trigger('keydown', { key: '2' });
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(wrapper.get<HTMLTextAreaElement>('#play-stage-action-input').element.value).toBe('守在门外');
    expect(wrapper.get('.play-stage-kinds button[aria-pressed="true"]').text()).toBe('等');

    // Escape closes the input and hands focus back to the stage.
    await wrapper.get('#play-stage-action-input').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(wrapper.find('#play-stage-action-input').exists()).toBe(false);
    expect(document.activeElement).toBe(stage.element);

    // "自己写" keeps a real draft; here the draft is just the untouched option, so it starts empty.
    await wrapper.get('.vn-choice-own').trigger('click');
    await flushPromises();
    const own = wrapper.get<HTMLTextAreaElement>('#play-stage-action-input');
    expect(own.element.value).toBe('');
    await wrapper.findAll('.play-stage-kinds button').find(button => button.text() === '做')!.trigger('click');
    await own.setValue('翻窗进去');
    await wrapper.get('.play-stage-input').trigger('submit');
    await flushPromises();
    await flushPromises();
    expect(calls[2]).toMatchObject({ userText: '翻窗进去', actionKind: 'do', baseRevision: 3 });

    // Space / Enter on another stage button stays that button's own key.
    const history = wrapper.findAll('.vn-stage header button').find(button => button.text() === '回看')!;
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    history.element.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it('stops, queues and steers a running turn from the stage', async () => {
    localStorage.setItem(MODE_KEY, JSON.stringify({ 'play-1': 'stage' }));
    const calls: TurnInput[] = [];
    const firstStreaming = deferred<void>();
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* (
      _id: string,
      input: TurnInput,
      options?: PlayTurnStreamOptions,
    ) {
      calls.push(input);
      const turnId = `run-${calls.length}`;
      options?.onTurnId?.(turnId);
      yield startedEvent(turnId, input.baseRevision ?? 0);
      if (calls.length === 1) {
        firstStreaming.resolve();
        await abortedBy(options?.signal);
        return;
      }
      session = createSession(2);
      yield committedEvent(turnId, session);
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('.play-stage-write').trigger('click');
    await wrapper.get('#play-stage-action-input').setValue('Open the door');
    await wrapper.get('#play-stage-action-input').trigger('keydown', { key: 'Enter', metaKey: true });
    await firstStreaming.promise;
    await flushPromises();
    expect(wrapper.get<HTMLButtonElement>('.play-stage-stop').element.disabled).toBe(false);

    // While the turn runs the same small entry offers queueing and steering.
    expect(wrapper.get('.play-stage-write').text()).toBe('插话 / 排队');
    await wrapper.get('.play-stage-write').trigger('click');
    await wrapper.get('#play-stage-action-input').setValue('then look around');
    await wrapper.get('.play-stage-input').trigger('submit');
    await flushPromises();
    expect(wrapper.get('.play-stage-queue summary').text()).toContain('1 条');
    expect(calls).toHaveLength(1);

    await wrapper.get('#play-stage-action-input').setValue('quietly');
    await wrapper.get('#play-stage-action-input').trigger('keydown', { key: 'Enter', altKey: true });
    await flushPromises();
    await flushPromises();
    expect(api.cancelPlayWorldRefereeTurn).toHaveBeenCalledWith('play-1', 'run-1');
    expect(calls[1]).toMatchObject({ userText: 'Open the door\n\n补充：quietly', baseRevision: 1, delivery: 'steer' });
    wrapper.unmount();
  });

  it('stops a running turn and keeps its action as the draft', async () => {
    localStorage.setItem(MODE_KEY, JSON.stringify({ 'play-1': 'stage' }));
    const streaming = deferred<void>();
    api.streamPlayWorldRefereeTurn.mockImplementation(async function* (
      _id: string,
      input: TurnInput,
      options?: PlayTurnStreamOptions,
    ) {
      options?.onTurnId?.('run-1');
      yield startedEvent('run-1', input.baseRevision ?? 0);
      streaming.resolve();
      await abortedBy(options?.signal);
    });
    const wrapper = mountWorkspace();
    await flushPromises();
    await wrapper.get('.play-stage-write').trigger('click');
    await wrapper.get('#play-stage-action-input').setValue('Open the door');
    await wrapper.get('.play-stage-input').trigger('submit');
    await streaming.promise;
    await flushPromises();

    await wrapper.get('.play-stage-stop').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(api.cancelPlayWorldRefereeTurn).toHaveBeenCalledWith('play-1', 'run-1');
    expect(api.streamPlayWorldRefereeTurn).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.play-stage-stop').exists()).toBe(false);
    await wrapper.get('.play-stage-write').trigger('click');
    expect(wrapper.get<HTMLTextAreaElement>('#play-stage-action-input').element.value).toBe('Open the door');
    wrapper.unmount();
  });

  it('retries the last turn and jumps to a checkpoint from the stage', async () => {
    localStorage.setItem(MODE_KEY, JSON.stringify({ 'play-1': 'stage' }));
    session = createBranchedSession();
    const root: PlayCheckpointSummary = {
      ...createCheckpoint('turn-root', 'selectedAncestor', 1),
      name: '进站之前',
      retryGuidance: 'DIRECTOR-ONLY-NOTE',
      restorable: true,
      retryable: false,
    };
    const checkpoints = [root, createCheckpoint('turn-source', 'current', 2)];
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints });
    api.retryPlayWorldRefereeTurn.mockImplementation(async function* () {
      yield { ...startedEvent('retry-run-1', 2), expectedArtifactId: 'turn-sibling', retry: { sourceArtifactId: 'turn-source', parentArtifactId: 'turn-root' } };
      yield failedEvent('retry-run-1');
    });
    api.restorePlayCheckpoint.mockImplementation(async () => {
      session = { ...session, revision: 3, selectedTurnIds: ['turn-root'], transcript: session.turnArtifacts[0]!.messages };
      return { session, checkpoints, restoredCheckpointId: 'turn-root' };
    });
    const wrapper = mountWorkspace();
    await flushPromises();
    await flushPromises();

    const jump = wrapper.get<HTMLSelectElement>('.play-stage-jump select');
    expect(jump.text()).toContain('进站之前');
    expect(wrapper.get('.play-stage-shell').text()).not.toContain('DIRECTOR-ONLY-NOTE');

    await wrapper.get('.play-stage-retry').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(api.retryPlayWorldRefereeTurn).toHaveBeenCalledWith(
      'play-1',
      'turn-source',
      // A turn sent from the stage asks for sentence-by-sentence streaming.
      { baseRevision: 2, presentation: 'stage' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await wrapper.get('.play-stage-write').trigger('click');
    await wrapper.get('#play-stage-action-input').setValue('a draft for the old branch');
    await jump.setValue('turn-root');
    await flushPromises();
    await flushPromises();
    expect(api.restorePlayCheckpoint).toHaveBeenCalledWith('play-1', 'turn-root', { baseRevision: 2 });
    // Changing branch clears the draft, as it does in the workbench.
    expect(wrapper.get<HTMLTextAreaElement>('#play-stage-action-input').element.value).toBe('');
    wrapper.unmount();
  });

  it('closes the Director lens on entering the stage and shows no hidden content there', async () => {
    session = createHiddenContentSession();
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('button[role="switch"]').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(PlayEventFeed).props('showSpoilers')).toBe(true);
    expect(wrapper.text()).toContain('HIDDEN-STATE-MUST-NOT-LEAK');

    await switchMode(wrapper, '舞台');
    await flushPromises();
    // The hidden workbench drops to the Player view too, so nothing on the page holds Director data.
    expect(wrapper.findComponent(PlayEventFeed).props('showSpoilers')).toBe(false);
    expect(wrapper.text()).not.toContain('HIDDEN-STATE-MUST-NOT-LEAK');
    expect(wrapper.text()).not.toContain('Trap the witness');
    expect(wrapper.get('.play-stage-shell').find('button[role="switch"]').exists()).toBe(false);
    expect(wrapper.get('.play-stage-shell').text()).not.toContain('导演');

    await switchMode(wrapper, '专业');
    expect(wrapper.findComponent(PlayEventFeed).props('showSpoilers')).toBe(false);
    wrapper.unmount();
  });

  it('opens a handed-over session on the stage unless the author already chose a mode for it', async () => {
    const handedOver = mount(PlayWorkspace, {
      attachTo: document.body,
      props: { workspace: workspaceSummary(), providerConfigured: true, requestedSessionId: 'play-1' },
    });
    await flushPromises();
    await flushPromises();
    expect(handedOver.find('.play-stage-shell').exists()).toBe(true);
    await switchMode(handedOver, '专业');
    handedOver.unmount();

    const reopened = mount(PlayWorkspace, {
      attachTo: document.body,
      props: { workspace: workspaceSummary(), providerConfigured: true, requestedSessionId: 'play-1' },
    });
    await flushPromises();
    await flushPromises();
    expect(reopened.find('.play-stage-shell').exists()).toBe(false);
    expect(reopened.find('.play-composer').exists()).toBe(true);
    reopened.unmount();
  });
});

describe('PlayStageShell', () => {
  it('plays a Scene Rehearsal session back read-only', async () => {
    const play = fakePlayState({
      ...createSession(1),
      schemaVersion: 5,
      suggestedActions: ['[do] 不该出现的选项'],
      transcript: [{ id: 'm-1', speaker: 'world-referee', content: '车门开始关闭。', createdAt: '2026-07-15T00:00:01.000Z' }],
    } as unknown as PlaySession);
    const wrapper = mount(PlayStageShell, { attachTo: document.body, props: { play, providerConfigured: true } });
    await flushPromises();

    expect(wrapper.findComponent(VisualNovelTextBox).props('beat')?.text).toContain('车门开始关闭');
    expect(wrapper.findComponent(PlayStageActionBar).exists()).toBe(false);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('.vn-choice-own').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('不该出现的选项');
    expect(wrapper.text()).toContain('只读回放');

    await wrapper.get('.vn-stage').trigger('keydown', { key: '1' });
    expect(play.submitChoice).not.toHaveBeenCalled();
    expect(play.submitTurn).not.toHaveBeenCalled();

    await wrapper.findAll('.vn-stage header button').find(button => button.text() === '专业模式')!.trigger('click');
    expect(wrapper.emitted('exit')).toHaveLength(1);
    wrapper.unmount();
  });
});

function totalReadCalls(): number {
  return api.listPlaySessionSummaries.mock.calls.length + api.getPlaySessionDetail.mock.calls.length
    + api.getPlaySession.mock.calls.length + api.listPlayCheckpoints.mock.calls.length
    + api.listPlayContextTraces.mock.calls.length + api.getPlaySourceDrift.mock.calls.length;
}

async function switchMode(wrapper: ReturnType<typeof mountWorkspace>, label: '舞台' | '专业'): Promise<void> {
  await wrapper.findAll('.play-mode-switch button').find(button => button.text() === label)!.trigger('click');
  await flushPromises();
}

function workspaceSummary(): WorkspaceSummary {
  return { name: 'alpha', novelName: 'Alpha', path: WORKSPACE, valid: true };
}

function mountWorkspace() {
  return mount(PlayWorkspace, {
    attachTo: document.body,
    props: { workspace: workspaceSummary(), providerConfigured: true },
  });
}

/** Just enough shared state for the stage shell; every action is a spy. */
function fakePlayState(session: PlaySession) {
  const state = {
    actionKind: shallowRef('do'),
    displaySession: computed(() => session),
    selectedSession: computed(() => session),
    sending: shallowRef(false),
    interactionBlocked: computed(() => false),
    historyCheckpoints: shallowRef([]),
    historyNotice: shallowRef(''),
    historyWindow: {
      transcript: shallowRef(undefined),
      loadingEarlierTranscript: shallowRef(false),
      loadEarlierTranscript: vi.fn(),
    },
    canStop: shallowRef(false),
    canSteer: computed(() => false),
    followUpControls: computed(() => ({ items: [], notice: '', paused: false })),
    provisionalTurn: shallowRef(undefined),
    turnAnnouncement: shallowRef(''),
    timeAdvance: shallowRef(undefined),
    suggestedActions: computed(() => [{ id: 's-1', label: '不该出现的选项', userText: '不该出现的选项', actionKind: 'do' }]),
    userText: shallowRef(''),
    retryCheckpoint: vi.fn(),
    restoreCheckpoint: vi.fn(),
    stopTurn: vi.fn(),
    steerTurn: vi.fn(),
    submitChoice: vi.fn(),
    submitTurn: vi.fn(),
  };
  return state as unknown as PlayWorkspaceState & Pick<typeof state, 'submitChoice' | 'submitTurn'>;
}

function createSession(revision: number): PlaySession {
  return {
    schemaVersion: 4,
    id: 'play-1',
    title: 'Station',
    createdAt: '2026-07-15T00:00:00.000Z',
    revision,
    sceneStart: 'Rain hits the roof.',
    characters: [],
    transcript: [],
    turnArtifacts: [],
    selectedTurnIds: [],
    branchSnapshotRequiredFromRevision: 0,
    branchBaseSnapshot: {
      worldClock: { turn: 0, revision: 0 },
      playLocalState: {},
      playLocalStateVisibility: {},
      scheduledEvents: [],
      suggestedActions: [],
    },
    metadataExtensions: {},
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock: { turn: revision, revision },
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      allowOffscreen: true,
      allowHidden: true,
      maxExternalEventsPerTurn: 2,
    },
    events: [],
    scheduledEvents: [],
    suggestedActions: [],
    activatedSources: [],
    observations: [],
    adoptionCandidates: [],
  };
}

function createHiddenContentSession(): PlaySession {
  return {
    ...createSession(1),
    playLocalState: {
      visibleSignal: 'PLAYER-VISIBLE-STATE',
      hiddenSignal: 'HIDDEN-STATE-MUST-NOT-LEAK',
      worldMomentum: {
        pressures: [],
        agendas: [{
          id: 'agenda-hidden',
          ownerEntityId: 'Hidden command',
          goal: 'Trap the witness',
          nextMove: 'Seal the platform',
          blockers: [],
          status: 'active',
          visibility: 'playerUnknown',
          updatedAtTurnId: 'turn-1',
        }],
      },
    },
    playLocalStateVisibility: {
      visibleSignal: 'playerVisible',
      hiddenSignal: 'playerUnknown',
      worldMomentum: 'playerUnknown',
    },
  };
}

function createBranchedSession(): PlaySession {
  const artifacts = [createArtifact('turn-root', undefined, 'Root'), createArtifact('turn-source', 'turn-root', 'Source')];
  return {
    ...createSession(2),
    turnArtifacts: artifacts,
    selectedTurnIds: ['turn-root', 'turn-source'],
    transcript: artifacts.flatMap(artifact => artifact.messages),
  };
}

function createArtifact(id: string, parentTurnId: string | undefined, label: string): PlayTurnArtifact {
  const revision = parentTurnId ? 2 : 1;
  return {
    schemaVersion: 2,
    artifactKind: 'worldSettlement',
    branchSnapshotVersion: 1,
    id,
    revision,
    parentTurnId,
    input: { kind: 'do', raw: `${label} action` },
    messages: [
      { id: `${id}-user`, speaker: 'user', content: `${label} action`, createdAt: '2026-07-15T00:00:00.000Z' },
      { id: `${id}-assistant`, speaker: 'world-referee', content: `${label} result`, createdAt: '2026-07-15T00:00:01.000Z' },
    ],
    worldClock: { turn: revision, revision },
    eventIds: [],
    dueScheduledEventIds: [],
    scheduledEventIds: [],
    scheduledEventSnapshots: [],
    playLocalStateSnapshot: {},
    playLocalStateVisibilitySnapshot: {},
    observationIds: [],
    stateDelta: {},
    suggestedActions: [],
    committedAt: '2026-07-15T00:00:02.000Z',
    canonical: false,
  };
}

function createCheckpoint(
  artifactId: string,
  status: PlayCheckpointSummary['status'],
  revision: number,
): PlayCheckpointSummary {
  return {
    checkpointId: artifactId,
    kind: 'turn',
    artifactId,
    selectedTurnIds: artifactId === 'turn-root' ? ['turn-root'] : ['turn-root', artifactId],
    depth: revision,
    revision,
    worldTurn: revision,
    committedAt: '2026-07-15T00:00:02.000Z',
    preview: `${artifactId} result`,
    status,
    restorable: false,
    retryable: true,
    canonical: false,
  };
}

function startedEvent(turnId: string, baseRevision: number): PlayTurnStreamEvent {
  return {
    type: 'play.turn.started',
    eventId: `${turnId}:1`,
    sequence: 1,
    sessionId: 'play-1',
    turnId,
    baseRevision,
    expectedArtifactId: `artifact-${turnId}`,
  };
}

function deltaEvent(turnId: string, delta: string): PlayTurnStreamEvent {
  return {
    type: 'play.narrative.delta',
    eventId: `${turnId}:2`,
    sequence: 2,
    sessionId: 'play-1',
    turnId,
    delta,
    provisional: true,
  };
}

function committedEvent(turnId: string, committed: PlaySession): PlayTurnStreamEvent {
  return {
    type: 'play.turn.committed',
    eventId: `${turnId}:3`,
    sequence: 3,
    sessionId: 'play-1',
    turnId,
    artifactId: `artifact-${turnId}`,
    revision: committed.revision,
    session: committed,
  };
}

function failedEvent(turnId: string): PlayTurnStreamEvent {
  return {
    type: 'play.turn.failed',
    eventId: `${turnId}:2`,
    sequence: 2,
    sessionId: 'play-1',
    turnId,
    error: { code: 'invalid_settlement', message: 'Settlement failed.', retryable: true },
  };
}

function abortedBy(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
