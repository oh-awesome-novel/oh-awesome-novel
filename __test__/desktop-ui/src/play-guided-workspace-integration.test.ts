// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FileTreeNode,
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlaySession,
  WorkspaceSummary,
} from '@oh-awesome-novel/client';

const api = vi.hoisted(() => ({
  listPlaySessions: vi.fn(),
  createPlaySession: vi.fn(),
  listPlayCheckpoints: vi.fn(),
  getActivePlayRehearsalAttempt: vi.fn(),
  createPlayRehearsalAttempt: vi.fn(),
  getPlayRehearsalAttempt: vi.fn(),
  streamNextPlayActorStep: vi.fn(),
  cancelPlayActorStep: vi.fn(),
  acceptPlayRehearsalStep: vi.fn(),
  finishPlayRehearsalAttempt: vi.fn(),
  cancelPlayRehearsalAttempt: vi.fn(),
  previewPlayLaunchPackage: vi.fn(),
  createPlayLaunchPackage: vi.fn(),
  startPlaySessionFromLaunchPackage: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';

const files: FileTreeNode[] = [{
  name: 'chapters',
  path: 'chapters',
  type: 'directory',
  children: [{
    name: 'chapter-01.md',
    path: 'chapters/chapter-01.md',
    type: 'file',
  }],
}];

describe('PlayWorkspace Guided Start wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
    api.getActivePlayRehearsalAttempt.mockResolvedValue({ attempt: null });
  });

  it('registers and selects a confirmed Guided Immersive Journey', async () => {
    const initial = createJourneySession('play-existing', 'Existing journey');
    const created = createJourneySession('play-guided-journey', 'Night station');
    api.listPlaySessions.mockResolvedValue({ sessions: [initial] });
    api.previewPlayLaunchPackage.mockImplementation(
      async (input: PlayLaunchPackagePreviewInput) => ({
        launchPackage: createLaunchPreview(input),
      }),
    );
    api.createPlayLaunchPackage.mockImplementation(
      async (launchPackage: PlayLaunchPackage) => ({
        launchPackage,
        files: ['play-setups/setup-guided/setup.yaml'],
      }),
    );
    api.startPlaySessionFromLaunchPackage.mockResolvedValue({
      session: created,
      files: ['play-sessions/play-guided-journey/session.yaml'],
    });

    const wrapper = mountWorkspace();
    await flushPromises();

    await buttonContaining(wrapper, 'New session').trigger('click');
    await buttonContaining(wrapper, 'Immersive Journey').trigger('click');
    await flushPromises();
    await buttonContaining(wrapper, 'Guided Start').trigger('click');
    await flushPromises();

    expect(wrapper.find('.guided-start').exists()).toBe(true);
    expect(api.previewPlayLaunchPackage).not.toHaveBeenCalled();
    expect(api.createPlayLaunchPackage).not.toHaveBeenCalled();
    expect(api.startPlaySessionFromLaunchPackage).not.toHaveBeenCalled();

    await wrapper.get('.source-tree input[type="checkbox"]').setValue(true);
    await wrapper.get('.guided-step').trigger('submit');
    await flushPromises();
    await wrapper.get('[name="guided-title"]').setValue('Night station');
    await wrapper.get('[name="guided-entry-label"]').setValue('Last platform');
    await wrapper.get('[name="guided-opening"]').setValue('The final train arrives.');
    await wrapper.get('[name="guided-location"]').setValue('Platform nine');
    await wrapper.get('.guided-entry').trigger('submit');
    await flushPromises();
    await wrapper.get('[name="guided-player-persona"]').setValue(
      'A traveler who knows only the public timetable.',
    );
    await wrapper.get('.guided-identity').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[aria-current="step"]').text()).toContain('Cast');
    expect(api.previewPlayLaunchPackage).not.toHaveBeenCalled();
    expect(api.createPlayLaunchPackage).not.toHaveBeenCalled();
    expect(api.startPlaySessionFromLaunchPackage).not.toHaveBeenCalled();

    await wrapper.get('.guided-cast').trigger('submit');
    await flushPromises();

    expect(api.previewPlayLaunchPackage).toHaveBeenCalledOnce();
    expect(api.previewPlayLaunchPackage).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Night station',
      purpose: 'immersiveJourney',
      startMode: 'guided',
      identity: {
        kind: 'player',
        persona: 'A traveler who knows only the public timetable.',
      },
      participantRoles: [],
      sources: [expect.objectContaining({
        path: 'chapters/chapter-01.md',
        role: 'chapter',
      })],
    }));
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Review');
    expect(wrapper.text()).toContain('Chapter launch evidence.');
    expect(api.createPlayLaunchPackage).not.toHaveBeenCalled();
    expect(api.startPlaySessionFromLaunchPackage).not.toHaveBeenCalled();

    await buttonContaining(wrapper, 'Start Immersive Journey').trigger('click');
    await vi.waitFor(() => {
      expect(api.createPlayLaunchPackage).toHaveBeenCalledOnce();
      expect(api.startPlaySessionFromLaunchPackage).toHaveBeenCalledWith({
        launchPackageId: 'setup-guided',
      });
    });
    await flushPromises();

    expect(api.createPlaySession).not.toHaveBeenCalled();
    expect(wrapper.find('.play-launch-flow').exists()).toBe(false);
    expect(wrapper.find('.play-stage-center').exists()).toBe(true);
    expect(wrapper.get('.play-transcript').text()).toContain('Night station');
    expect(wrapper.findAll('.play-session-card')).toHaveLength(2);
    expect(wrapper.get('.play-session-card[aria-current="true"]').text()).toContain(
      'Night station',
    );
    expect(localStorage.getItem('oan:play:selected-session:/novels/alpha')).toBe(
      'play-guided-journey',
    );
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
    props: {
      workspace,
      providerConfigured: true,
      files,
      filesLoading: false,
    },
  });
}

function createLaunchPreview(input: PlayLaunchPackagePreviewInput): PlayLaunchPackage {
  return {
    schemaVersion: 1,
    id: 'setup-guided',
    createdAt: input.createdAt ?? '2026-07-16T00:00:00.000Z',
    title: input.title,
    purpose: input.purpose,
    startMode: 'guided',
    eventPolicy: {
      simulationMode: input.simulationMode,
      density: input.density,
    },
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
    activatedSources: [{
      sourceId: 'source-chapter',
      path: 'chapters/chapter-01.md',
      objectId: 'chapter-01',
      contentHash: 'a'.repeat(64),
      role: 'chapter',
      reason: 'Guided Start chapter source',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
      trust: 'canonical',
    }],
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
