// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import PlayGuidedStartWizard from '../../../apps/desktop-ui/src/components/play/launch/PlayGuidedStartWizard.vue';
import type {
  FileTreeNode,
  PlaySession,
} from '../../../apps/desktop-ui/src/composables/useWorkspaceApi';
import type {
  PlayGuidedStartApi,
  PlayLaunchDiagnostic,
  PlayLaunchPackage,
  PlayLaunchPackagePreviewInput,
  PlayLaunchSourceStatus,
} from '../../../apps/desktop-ui/src/composables/usePlayGuidedStart';

const files: FileTreeNode[] = [
  {
    name: 'chapters',
    path: 'chapters',
    type: 'directory',
    children: [{
      name: 'chapter-01.md',
      path: 'chapters/chapter-01.md',
      type: 'file',
    }],
  },
  {
    name: 'characters',
    path: 'characters',
    type: 'directory',
    children: [{
      name: 'mara',
      path: 'characters/mara',
      type: 'directory',
      children: [{
        name: 'profile.md',
        path: 'characters/mara/profile.md',
        type: 'file',
      }],
    }],
  },
  {
    name: 'timeline.yaml',
    path: 'timeline/main.yaml',
    type: 'file',
  },
];

describe('Play Guided Start', () => {
  it('keeps all writes behind Review and builds its preview from real tree roles', async () => {
    const calls: string[] = [];
    const previewPlayLaunchPackage = vi.fn(async (input: PlayLaunchPackagePreviewInput) => {
      calls.push('preview');
      return { launchPackage: buildPreview(input) };
    });
    const createPlayLaunchPackage = vi.fn(async (launchPackage: PlayLaunchPackage) => {
      calls.push('create');
      return { launchPackage, files: ['play-setups/setup-1/setup.yaml'] };
    });
    const session = { id: 'session-1', schemaVersion: 5 } as unknown as PlaySession;
    const startPlaySessionFromLaunchPackage = vi.fn(async () => {
      calls.push('start');
      return { session, files: ['play-sessions/session-1/session.yaml'] };
    });
    const api: PlayGuidedStartApi = {
      previewPlayLaunchPackage,
      createPlayLaunchPackage,
      startPlaySessionFromLaunchPackage,
    };
    const wrapper = mount(PlayGuidedStartWizard, {
      attachTo: document.body,
      props: { purpose: 'sceneRehearsal', files, api },
    });

    expect(wrapper.findAll('nav li').map((item) => item.text())).toEqual([
      '1 Sources',
      '2 Entry',
      '3 Identity',
      '4 Cast',
      '5 Review',
    ]);
    expect(wrapper.text()).toContain('chapter');
    expect(wrapper.text()).toContain('character');
    expect(wrapper.text()).toContain('timeline');

    await selectSource(wrapper, 'chapters/chapter-01.md');
    await selectSource(wrapper, 'characters/mara/profile.md');
    const characterSourceId = sourceCheckbox(
      wrapper,
      'characters/mara/profile.md',
    ).element.getAttribute('value');
    await wrapper.get('.guided-step').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[aria-current="step"]').text()).toContain('Entry');
    expect(document.activeElement).toBe(wrapper.get('.step-panel').element);
    expect(calls).toEqual([]);

    await fillEntry(wrapper);
    await wrapper.get('.guided-entry').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Identity');
    expect(calls).toEqual([]);

    await wrapper.get('[name="guided-director-purpose"]').setValue('Test whether Mara protects the witness.');
    await wrapper.get('.guided-identity').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Cast');
    expect(calls).toEqual([]);

    await wrapper.get('[name="guided-participant-1-name"]').setValue('Mara');
    await wrapper.get('[name="guided-participant-1-goal"]').setValue('Protect the witness');
    await wrapper.get('[name="guided-participant-1-source"]').setValue(
      characterSourceId,
    );
    await wrapper.get('[name="guided-participant-1-knowledge"]').setValue('The last train leaves at midnight.');
    await wrapper.get('.guided-cast').trigger('submit');
    await flushPromises();

    expect(calls).toEqual(['preview']);
    expect(createPlayLaunchPackage).not.toHaveBeenCalled();
    expect(startPlaySessionFromLaunchPackage).not.toHaveBeenCalled();
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Review');
    expect(document.activeElement).toBe(wrapper.get('.step-panel').element);
    expect(wrapper.text()).toContain('Nothing has been created yet');
    expect(wrapper.text()).toContain('chapters/chapter-01.md');
    expect(wrapper.text()).toContain('Chapter one evidence excerpt.');
    expect(wrapper.text()).toContain('a'.repeat(64));

    const previewInput = previewPlayLaunchPackage.mock.calls[0]![0];
    expect(previewInput.startMode).toBe('guided');
    expect(previewInput.sources.map((source) => source.role)).toEqual([
      'chapter',
      'character',
    ]);
    expect(previewInput.participantRoles[0]).toMatchObject({
      displayName: 'Mara',
      canonicalCharacterRef: 'mara',
      sourceRefs: [expect.any(String)],
      initialKnowledge: [{
        fact: 'The last train leaves at midnight.',
        sourceRefs: [],
      }],
    });

    await buttonNamed(wrapper, 'Start Scene Rehearsal').trigger('click');
    await flushPromises();

    expect(calls).toEqual(['preview', 'create', 'start']);
    expect(wrapper.emitted('created')).toEqual([[session]]);
    expect(startPlaySessionFromLaunchPackage).toHaveBeenCalledWith({
      launchPackageId: 'setup-1',
    });
    wrapper.unmount();
  });

  it('blocks confirmation when preview diagnostics report a missing or stale source', async () => {
    const diagnostic: PlayLaunchDiagnostic = {
      id: 'diagnostic-stale-1',
      code: 'staleSource',
      severity: 'error',
      message: 'Source changed after preview.',
      path: 'chapters/chapter-01.md',
      expectedContentHash: 'a'.repeat(64),
      actualContentHash: 'b'.repeat(64),
    };
    const previewPlayLaunchPackage = vi.fn(async (input: PlayLaunchPackagePreviewInput) => ({
      launchPackage: buildPreview(input, [diagnostic], 'missing'),
    }));
    const createPlayLaunchPackage = vi.fn(async (launchPackage: PlayLaunchPackage) => ({ launchPackage }));
    const startPlaySessionFromLaunchPackage = vi.fn(async () => ({
      session: { id: 'session-1' } as unknown as PlaySession,
    }));
    const wrapper = mount(PlayGuidedStartWizard, {
      props: {
        purpose: 'sceneRehearsal',
        files,
        api: {
          previewPlayLaunchPackage,
          createPlayLaunchPackage,
          startPlaySessionFromLaunchPackage,
        },
      },
    });

    await reachReview(wrapper);

    expect(wrapper.text()).toContain('Source changed after preview.');
    expect(wrapper.text()).toContain('Missing — select or restore this file');
    expect(wrapper.text()).toContain('a'.repeat(64));
    expect(wrapper.text()).toContain('b'.repeat(64));
    expect(buttonNamed(wrapper, 'Start Scene Rehearsal').attributes('disabled')).toBeDefined();
    expect(createPlayLaunchPackage).not.toHaveBeenCalled();
    expect(startPlaySessionFromLaunchPackage).not.toHaveBeenCalled();
  });

  it('creates an Immersive Journey from a player identity with an empty cast', async () => {
    const previewPlayLaunchPackage = vi.fn(async (input: PlayLaunchPackagePreviewInput) => ({
      launchPackage: buildPreview(input),
    }));
    const createPlayLaunchPackage = vi.fn(async (launchPackage: PlayLaunchPackage) => ({
      launchPackage,
      files: ['play-setups/setup-1/setup.yaml'],
    }));
    const session = { id: 'journey-1', schemaVersion: 4 } as unknown as PlaySession;
    const startPlaySessionFromLaunchPackage = vi.fn(async () => ({
      session,
      files: ['play-sessions/journey-1/session.yaml'],
    }));
    const wrapper = mount(PlayGuidedStartWizard, {
      props: {
        purpose: 'immersiveJourney',
        files,
        api: {
          previewPlayLaunchPackage,
          createPlayLaunchPackage,
          startPlaySessionFromLaunchPackage,
        },
      },
    });

    await selectSource(wrapper, 'chapters/chapter-01.md');
    await wrapper.get('.guided-step').trigger('submit');
    await flushPromises();
    await fillEntry(wrapper);
    await wrapper.get('.guided-entry').trigger('submit');
    await flushPromises();
    await wrapper.get('[name="guided-player-persona"]').setValue('A traveler who knows only the public history.');
    await wrapper.get('.guided-identity').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('No cast is required for an immersive entry.');
    await wrapper.get('.guided-cast').trigger('submit');
    await flushPromises();

    expect(previewPlayLaunchPackage).toHaveBeenCalledTimes(1);
    expect(createPlayLaunchPackage).not.toHaveBeenCalled();
    expect(startPlaySessionFromLaunchPackage).not.toHaveBeenCalled();
    expect(previewPlayLaunchPackage.mock.calls[0]![0]).toMatchObject({
      purpose: 'immersiveJourney',
      startMode: 'guided',
      identity: {
        kind: 'player',
        persona: 'A traveler who knows only the public history.',
      },
      participantRoles: [],
    });

    await buttonNamed(wrapper, 'Start Immersive Journey').trigger('click');
    await flushPromises();

    expect(createPlayLaunchPackage).toHaveBeenCalledTimes(1);
    expect(startPlaySessionFromLaunchPackage).toHaveBeenCalledWith({
      launchPackageId: 'setup-1',
    });
    expect(wrapper.emitted('created')).toEqual([[session]]);
  });

  it('requires at least one participant for Scene Rehearsal', async () => {
    const previewPlayLaunchPackage = vi.fn(async (input: PlayLaunchPackagePreviewInput) => ({
      launchPackage: buildPreview(input),
    }));
    const wrapper = mount(PlayGuidedStartWizard, {
      props: {
        purpose: 'sceneRehearsal',
        files,
        api: createApi(previewPlayLaunchPackage),
      },
    });

    await reachCast(wrapper);
    await wrapper.get('[aria-label="Remove participant 1"]').trigger('click');
    await wrapper.get('.guided-cast').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[aria-current="step"]').text()).toContain('Cast');
    expect(wrapper.text()).toContain('requires at least one participant');
    expect(previewPlayLaunchPackage).not.toHaveBeenCalled();
  });

  it('invalidates Review after a create/start failure so retry requires a new preview', async () => {
    const previewPlayLaunchPackage = vi.fn(async (input: PlayLaunchPackagePreviewInput) => ({
      launchPackage: buildPreview(input),
    }));
    const createPlayLaunchPackage = vi.fn(async () => {
      throw new Error('Setup write failed.');
    });
    const wrapper = mount(PlayGuidedStartWizard, {
      props: {
        purpose: 'sceneRehearsal',
        files,
        api: {
          previewPlayLaunchPackage,
          createPlayLaunchPackage,
          startPlaySessionFromLaunchPackage: vi.fn(),
        },
      },
    });

    await reachReview(wrapper);
    await buttonNamed(wrapper, 'Start Scene Rehearsal').trigger('click');
    await flushPromises();

    expect(wrapper.get('[aria-current="step"]').text()).toContain('Cast');
    expect(wrapper.text()).toContain('Setup write failed.');
    expect(wrapper.text()).toContain('Preview again before retrying.');
    expect(previewPlayLaunchPackage).toHaveBeenCalledTimes(1);
  });
});

function createApi(
  previewPlayLaunchPackage: PlayGuidedStartApi['previewPlayLaunchPackage'],
): PlayGuidedStartApi {
  return {
    previewPlayLaunchPackage,
    createPlayLaunchPackage: async (launchPackage) => ({ launchPackage }),
    startPlaySessionFromLaunchPackage: async () => ({
      session: { id: 'session-1' } as unknown as PlaySession,
    }),
  };
}

async function reachCast(wrapper: VueWrapper): Promise<void> {
  await selectSource(wrapper, 'chapters/chapter-01.md');
  await wrapper.get('.guided-step').trigger('submit');
  await flushPromises();
  await fillEntry(wrapper);
  await wrapper.get('.guided-entry').trigger('submit');
  await flushPromises();
  await wrapper.get('[name="guided-director-purpose"]').setValue('Test the scene.');
  await wrapper.get('.guided-identity').trigger('submit');
  await flushPromises();
}

async function reachReview(wrapper: VueWrapper): Promise<void> {
  await reachCast(wrapper);
  await wrapper.get('[name="guided-participant-1-name"]').setValue('Mara');
  await wrapper.get('[name="guided-participant-1-goal"]').setValue('Protect the witness');
  await wrapper.get('.guided-cast').trigger('submit');
  await flushPromises();
}

async function fillEntry(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('[name="guided-title"]').setValue('Last train');
  await wrapper.get('[name="guided-entry-label"]').setValue('Platform confrontation');
  await wrapper.get('[name="guided-opening"]').setValue('The doors begin to close.');
  await wrapper.get('[name="guided-location"]').setValue('Platform nine');
  await wrapper.get('[name="guided-objective"]').setValue('Test whether Mara tells the truth.');
}

async function selectSource(wrapper: VueWrapper, path: string): Promise<void> {
  await sourceCheckbox(wrapper, path).setValue(true);
}

function sourceCheckbox(wrapper: VueWrapper, path: string) {
  const item = wrapper.findAll('.source-tree li').find((candidate) =>
    candidate.text().includes(path));
  if (!item) throw new Error(`Missing source option: ${path}`);
  return item.get('input[type="checkbox"]');
}

function buttonNamed(wrapper: VueWrapper, name: string) {
  const button = wrapper.findAll('button').find((candidate) =>
    candidate.text().includes(name));
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function buildPreview(
  input: PlayLaunchPackagePreviewInput,
  diagnostics: readonly PlayLaunchDiagnostic[] = [],
  firstStatus: PlayLaunchSourceStatus = 'ready',
): PlayLaunchPackage {
  return {
    schemaVersion: 1,
    id: 'setup-1',
    createdAt: input.createdAt ?? '2026-07-16T00:00:00.000Z',
    title: input.title,
    purpose: input.purpose,
    startMode: 'guided',
    eventPolicy: {
      simulationMode: input.simulationMode,
      density: input.density,
    },
    sourceBase: {
      activatedSources: input.sources.map((source, index) => ({
        ...source,
        ...(source.role === 'character' ? { objectId: 'mara' } : {}),
        reason: source.reason ?? 'Guided Start source',
        budgetLayer: source.role === 'chapter' ? 'L2' : 'L1',
        semanticBoundary: 'compressible',
        trust: 'canonical',
        status: index === 0 ? firstStatus : 'ready',
        ...(index === 0 && firstStatus !== 'ready'
          ? {}
          : {
              contentHash: index === 0 ? 'a'.repeat(64) : 'c'.repeat(64),
              excerpt: index === 0
                ? 'Chapter one evidence excerpt.'
                : 'Character evidence excerpt.',
            }),
      })),
    },
    entryPoint: input.entryPoint,
    identity: input.identity,
    participantRoles: input.participantRoles,
    diagnostics,
    canonical: false,
  };
}
