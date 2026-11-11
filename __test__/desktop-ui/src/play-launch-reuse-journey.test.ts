// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type {
  FileTreeNode,
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlayLaunchReuseSeed,
  PlaySession,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  listPlaySessions: vi.fn(),
  listPlaySessionSummaries: vi.fn(),
  getPlaySession: vi.fn(),
  getPlaySessionDetail: vi.fn(),
  listPlayContextTraces: vi.fn(),
  getPlaySourceDrift: vi.fn(),
  createPlaySession: vi.fn(),
  listPlayCheckpoints: vi.fn(),
  getActivePlayRehearsalAttempt: vi.fn(),
  previewPlayLaunchPackage: vi.fn(),
  createPlayLaunchPackage: vi.fn(),
  startPlaySessionFromLaunchPackage: vi.fn(),
  getPlayLaunchReuseSeed: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';
import { installLegacyPlayReadModelMocks } from './support/playReadModelMock';

const files: FileTreeNode[] = [
  {
    name: 'chapters',
    path: 'chapters',
    type: 'directory',
    children: [{ name: 'chapter-01.md', path: 'chapters/chapter-01.md', type: 'file' }],
  },
  // timeline/main.md was part of the old opening but no longer exists in the tree.
];

const guidedSeed = (
  statuses: { chapter: 'unchanged' | 'changed'; timeline?: 'missing' },
): PlayLaunchReuseSeed => ({
  kind: 'guided',
  sourceSessionId: 'play-existing',
  sourceSessionTitle: 'Existing journey',
  purpose: 'immersiveJourney',
  launch: {
    title: 'Existing journey',
    purpose: 'immersiveJourney',
    startMode: 'guided',
    simulationMode: 'activeWorld',
    density: 'quiet',
    sources: [
      { sourceId: 'old-chapter', path: 'chapters/chapter-01.md', role: 'chapter', reason: 'Guided Start chapter source' },
      ...(statuses.timeline
        ? [{ sourceId: 'old-timeline', path: 'timeline/main.md', role: 'timeline' as const, reason: 'Guided Start timeline source' }]
        : []),
    ],
    entryPoint: {
      id: 'entry-guided-1',
      label: 'Last platform',
      opening: 'The final train arrives.',
      sourceRefs: ['old-chapter', ...(statuses.timeline ? ['old-timeline'] : [])],
      location: {
        value: 'Platform nine',
        provenance: { kind: 'authorProvided', providedAt: '2026-07-16T00:00:00.000Z' },
      },
    },
    identity: { kind: 'player', persona: 'A traveler.' },
    participantRoles: [],
  },
  sources: [
    {
      sourceId: 'old-chapter',
      path: 'chapters/chapter-01.md',
      role: 'chapter',
      status: statuses.chapter,
      frozenContentHash: 'a'.repeat(64),
      currentContentHash: (statuses.chapter === 'changed' ? 'b' : 'a').repeat(64),
    },
    ...(statuses.timeline
      ? [{
          sourceId: 'old-timeline',
          path: 'timeline/main.md',
          role: 'timeline' as const,
          status: 'missing' as const,
          frozenContentHash: 'c'.repeat(64),
        }]
      : []),
  ],
});

describe('Play launch reuse journey', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    installLegacyPlayReadModelMocks(api);
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
    api.getActivePlayRehearsalAttempt.mockResolvedValue({ attempt: null });
    api.previewPlayLaunchPackage.mockImplementation(
      async (input: PlayLaunchPackagePreviewInput) => ({ launchPackage: createLaunchPreview(input) }),
    );
    api.createPlayLaunchPackage.mockImplementation(
      async (launchPackage: PlayLaunchPackage) => ({ launchPackage, files: [] }),
    );
  });

  it('creates a new session from an unchanged opening without editing anything', async () => {
    const existing = createJourneySession('play-existing', 'Existing journey');
    api.listPlaySessions.mockResolvedValue({ sessions: [existing] });
    api.getPlayLaunchReuseSeed.mockResolvedValue({ seed: guidedSeed({ chapter: 'unchanged' }) });
    api.startPlaySessionFromLaunchPackage.mockResolvedValue({
      session: createJourneySession('play-again', 'Existing journey'),
      files: [],
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('.play-session-reuse').trigger('click');
    await flushPromises();

    expect(api.getPlayLaunchReuseSeed).toHaveBeenCalledWith('play-existing');
    expect(wrapper.get('.reuse-notice').text()).toContain('Existing journey');
    expect(wrapper.find('.reuse-checks').exists()).toBe(false);
    // An unchanged opening lands on Review; nothing has been written yet.
    expect(wrapper.get('[aria-current="step"]').text()).toContain('确认');
    expect(api.createPlayLaunchPackage).not.toHaveBeenCalled();
    const input = api.previewPlayLaunchPackage.mock.calls[0]![0] as PlayLaunchPackagePreviewInput;
    expect(input).toMatchObject({
      title: 'Existing journey',
      simulationMode: 'activeWorld',
      density: 'quiet',
      identity: { kind: 'player', persona: 'A traveler.' },
      entryPoint: { label: 'Last platform', opening: 'The final train arrives.' },
    });
    expect(input.id).toBeUndefined();
    expect(input.sources.map((source) => source.path)).toEqual(['chapters/chapter-01.md']);
    // Ids are re-derived for the new launch instead of reusing the old setup's ids.
    expect(input.sources[0]!.sourceId).not.toBe('old-chapter');
    expect(input.entryPoint.sourceRefs).toEqual([input.sources[0]!.sourceId]);

    await buttonContaining(wrapper, '开始沉浸推演').trigger('click');
    await vi.waitFor(() => expect(api.startPlaySessionFromLaunchPackage).toHaveBeenCalledOnce());
    await flushPromises();

    expect(api.createPlaySession).not.toHaveBeenCalled();
    expect(wrapper.find('.play-launch-flow').exists()).toBe(false);
    expect(wrapper.findAll('.play-session-card')).toHaveLength(2);
    expect(localStorage.getItem('oan:play:selected-session:/novels/alpha')).toBe('play-again');
    wrapper.unmount();
  });

  it('shows changed and missing sources before creation and lets the author remove one', async () => {
    api.listPlaySessions.mockResolvedValue({
      sessions: [createJourneySession('play-existing', 'Existing journey')],
    });
    api.getPlayLaunchReuseSeed.mockResolvedValue({
      seed: guidedSeed({ chapter: 'changed', timeline: 'missing' }),
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    await buttonContaining(wrapper, '以此开局再开一局').trigger('click');
    await flushPromises();

    // Drift keeps the author on Sources; no preview or write has happened.
    expect(wrapper.get('[aria-current="step"]').text()).toContain('来源');
    expect(api.previewPlayLaunchPackage).not.toHaveBeenCalled();
    const checks = wrapper.findAll('.reuse-checks li').map((item) => item.text());
    expect(checks).toHaveLength(2);
    expect(checks[0]).toContain('chapters/chapter-01.md');
    expect(checks[0]).toContain('内容已变化');
    expect(checks[0]).toContain('将沿用现在的内容');
    expect(checks[1]).toContain('timeline/main.md');
    expect(checks[1]).toContain('文件已不存在');
    expect(checks[1]).toContain('已从本次开局移除');
    const checkbox = wrapper.get('.source-tree input[type="checkbox"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(true);

    await buttonContaining(wrapper, '移除此来源').trigger('click');
    await flushPromises();

    expect((checkbox.element as HTMLInputElement).checked).toBe(false);
    expect(wrapper.findAll('.reuse-checks li')[0]!.text()).toContain('已移除');
    await wrapper.get('.guided-step').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[aria-current="step"]').text()).toContain('来源');
    expect(api.createPlayLaunchPackage).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('prefills the quick form from a quick session and creates an unrelated session', async () => {
    const existing = { ...createJourneySession('play-quick', 'Dock night'), metadataExtensions: {} };
    api.listPlaySessions.mockResolvedValue({ sessions: [existing] });
    api.getPlayLaunchReuseSeed.mockResolvedValue({
      seed: {
        kind: 'quickJourney',
        sourceSessionId: 'play-quick',
        sourceSessionTitle: 'Dock night',
        purpose: 'immersiveJourney',
        form: {
          title: 'Dock night',
          sceneStart: 'Fog on the dock.',
          userPersona: 'A courier.',
          characters: ['Mara', 'Ilya'],
          eventPolicy: {
            simulationMode: 'conversation',
            density: 'volatile',
            allowOffscreen: false,
            allowHidden: true,
            maxExternalEventsPerTurn: 1,
          },
        },
      } satisfies PlayLaunchReuseSeed,
    });
    api.createPlaySession.mockResolvedValue({
      session: { ...existing, id: 'play-quick-again' },
      files: [],
    });
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('.play-session-reuse').trigger('click');
    await flushPromises();

    expect(wrapper.get('.play-create-reuse').text()).toContain('Dock night');
    await wrapper.get('.play-create-form').trigger('submit');
    await flushPromises();

    expect(api.createPlaySession).toHaveBeenCalledWith({
      title: 'Dock night',
      sceneStart: 'Fog on the dock.',
      userPersona: 'A courier.',
      characters: ['Mara', 'Ilya'],
      eventPolicy: {
        simulationMode: 'conversation',
        density: 'volatile',
        allowOffscreen: false,
        allowHidden: true,
        maxExternalEventsPerTurn: 1,
      },
    });
    expect(wrapper.find('.play-launch-flow').exists()).toBe(false);
    wrapper.unmount();
  });

  it('reports an unreadable opening without opening the launch flow', async () => {
    api.listPlaySessions.mockResolvedValue({
      sessions: [createJourneySession('play-existing', 'Existing journey')],
    });
    api.getPlayLaunchReuseSeed.mockRejectedValue(new Error('setup is gone'));
    const wrapper = mountWorkspace();
    await flushPromises();

    await wrapper.get('.play-session-reuse').trigger('click');
    await flushPromises();

    expect(wrapper.find('.play-launch-flow').exists()).toBe(false);
    expect(wrapper.text()).toContain('无法读取这个会话的开局：setup is gone');
    wrapper.unmount();
  });
});

function mountWorkspace() {
  const workspace: WorkspaceSummary = {
    name: 'alpha',
    novelName: 'Alpha',
    path: '/novels/alpha',
    valid: true,
  };
  return mount(PlayWorkspace, {
    attachTo: document.body,
    props: { workspace, providerConfigured: true, files, filesLoading: false },
  });
}

function createLaunchPreview(input: PlayLaunchPackagePreviewInput): PlayLaunchPackage {
  return {
    schemaVersion: 1,
    id: 'setup-again',
    createdAt: input.createdAt ?? '2026-07-16T00:00:00.000Z',
    title: input.title,
    purpose: input.purpose,
    startMode: 'guided',
    eventPolicy: { simulationMode: input.simulationMode, density: input.density },
    sourceBase: {
      activatedSources: input.sources.map((source) => ({
        ...source,
        objectId: 'chapter-01',
        reason: source.reason ?? 'Guided Start chapter source',
        budgetLayer: 'L2',
        semanticBoundary: 'compressible',
        trust: 'canonical',
        status: 'ready',
        contentHash: 'a'.repeat(64),
        excerpt: 'Chapter launch evidence.',
      })),
    },
    entryPoint: input.entryPoint,
    identity: input.identity,
    participantRoles: input.participantRoles,
    diagnostics: [],
    canonical: false,
  };
}

function createJourneySession(id: string, title: string): PlaySession {
  return {
    schemaVersion: 4,
    id,
    title,
    createdAt: '2026-07-16T00:00:00.000Z',
    revision: 0,
    sceneStart: 'The final train arrives.',
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
    metadataExtensions: {
      playLaunch: {
        setupId: 'setup-guided',
        setupSchemaVersion: 1,
        purpose: 'immersiveJourney',
        startMode: 'guided',
      },
    },
    playLocalState: {},
    playLocalStateVisibility: {},
    worldClock: { turn: 0, revision: 0 },
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

function buttonContaining(wrapper: VueWrapper, label: string) {
  const target = wrapper.findAll('button').find((candidate) =>
    candidate.text().includes(label));
  if (!target) throw new Error(`Missing button containing: ${label}`);
  return target;
}
