// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CharacterStepDraft,
  PlayAttemptMutationReceipt,
  PlayRehearsalFinalizeResult,
  PlayRehearsalSessionV5,
  PlayRehearsalStepStreamEvent,
  PlayRehearsalStepStreamInput,
  PlayRehearsalStepStreamOptions,
  PlaySession,
  PlayTurnAttempt,
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
  createPlayRehearsalAttempt: vi.fn(),
  getPlayRehearsalAttempt: vi.fn(),
  streamNextPlayActorStep: vi.fn(),
  cancelPlayActorStep: vi.fn(),
  acceptPlayRehearsalStep: vi.fn(),
  finishPlayRehearsalAttempt: vi.fn(),
  cancelPlayRehearsalAttempt: vi.fn(),
  getPlayOutcomeReport: vi.fn(),
  listPlayWritingReferenceAttachments: vi.fn(),
}));

vi.mock('../../../apps/desktop-ui/src/client', () => ({ oanClient: api }));

import PlayWorkspace from '../../../apps/desktop-ui/src/components/play/PlayWorkspace.vue';
import { installLegacyPlayReadModelMocks } from './support/playReadModelMock';

describe('PlayWorkspace scene rehearsal integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    installLegacyPlayReadModelMocks(api);
    api.listPlayCheckpoints.mockResolvedValue({ checkpoints: [] });
    api.getActivePlayRehearsalAttempt.mockResolvedValue({ attempt: null });
    api.getPlayOutcomeReport.mockRejectedValue(Object.assign(new Error('missing'), {
      status: 404,
    }));
    api.listPlayWritingReferenceAttachments.mockResolvedValue({ attachments: [] });
    api.cancelPlayActorStep.mockImplementation(
      async (_sessionId: string, _attemptId: string, runId: string) => ({
        status: 'aborted',
        runId,
      }),
    );
  });

  it('creates Quick Immersive only after submit and focuses each launch step', async () => {
    const initialJourney = createJourneySession();
    const createdJourney: PlaySession = {
      ...createJourneySession(),
      id: 'play-quick-2',
      title: 'Night station',
      sceneStart: 'The last train arrives.',
    };
    api.listPlaySessions.mockResolvedValue({ sessions: [initialJourney] });
    api.createPlaySession.mockResolvedValue({ session: createdJourney });

    const wrapper = mountWorkspace();
    await flushPromises();

    const newSession = buttonContaining(wrapper, 'New session');
    newSession.element.focus();
    await newSession.trigger('click');

    expect(wrapper.get('.play-session-rail').find('.play-purpose-picker').exists()).toBe(false);
    expect(wrapper.find('.play-purpose-picker').exists()).toBe(true);
    expect(api.createPlaySession).not.toHaveBeenCalled();

    await buttonContaining(wrapper, 'Immersive Journey').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(buttonContaining(wrapper, 'Quick Start').element);
    expect(api.createPlaySession).not.toHaveBeenCalled();

    await buttonContaining(wrapper, 'Quick Start').trigger('click');
    await flushPromises();
    const form = wrapper.get('.play-create-form');
    const title = form.get('input[placeholder="雨夜码头"]');
    expect(document.activeElement).toBe(title.element);

    await title.setValue('Night station');
    await form.get('textarea[placeholder="从一个可行动的瞬间开始"]').setValue(
      'The last train arrives.',
    );
    expect(api.createPlaySession).not.toHaveBeenCalled();

    await form.trigger('submit');
    await vi.waitFor(() => expect(api.createPlaySession).toHaveBeenCalledOnce());

    const input = api.createPlaySession.mock.calls[0]![0];
    expect(input).toEqual(expect.objectContaining({
      title: 'Night station',
      sceneStart: 'The last train arrives.',
    }));
    expect(input).not.toHaveProperty('purpose');
    expect(input).not.toHaveProperty('startMode');
    await vi.waitFor(() => {
      expect(wrapper.find('.play-launch-flow').exists()).toBe(false);
    });
    wrapper.unmount();
  });

  it('runs New session through Quick Rehearsal, creation lock, rehearsal and Finish', async () => {
    const initialJourney = createJourneySession();
    const rehearsalSession = createRehearsalSession();
    const committed = createCommittedFixture(rehearsalSession);
    const createGate = deferred<{ session: PlaySession }>();
    api.listPlaySessions.mockResolvedValue({ sessions: [initialJourney] });
    api.createPlaySession.mockReturnValue(createGate.promise);
    api.createPlayRehearsalAttempt.mockResolvedValue({
      attempt: createRunningAttempt(),
    });
    api.streamNextPlayActorStep.mockImplementation(
      async function* (
        _sessionId: string,
        _attemptId: string,
        input: PlayRehearsalStepStreamInput,
        options?: PlayRehearsalStepStreamOptions,
      ): AsyncIterable<PlayRehearsalStepStreamEvent> {
        const receipt = createMutationReceipt(input.idempotencyKey, 1, 'step-1');
        const prepared = createDraftAttempt(receipt);
        options?.onStepRunId?.('step-run-quick');
        yield stepEvent('step-run-quick', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'participant-mara',
          mode: 'next',
        });
        yield stepEvent('step-run-quick', 2, {
          type: 'play.actor.step.prepared',
          attempt: prepared,
          step: prepared.steps[0]!,
          receipt,
        });
      },
    );
    api.acceptPlayRehearsalStep.mockImplementation(
      async (
        _sessionId: string,
        _attemptId: string,
        input: { idempotencyKey: string },
      ) => {
        const receipt = createMutationReceipt(input.idempotencyKey, 2, 'step-1');
        return {
          attempt: createPreparedAttempt(receipt),
          receipt,
          replayed: false,
        };
      },
    );
    api.finishPlayRehearsalAttempt.mockImplementation(
      async (
        _sessionId: string,
        _attemptId: string,
        input: { idempotencyKey: string },
      ): Promise<PlayRehearsalFinalizeResult> => ({
        ...committed,
        receipt: { ...committed.receipt, idempotencyKey: input.idempotencyKey },
        evidence: {
          ...committed.evidence,
          finalizeReceipt: {
            ...committed.evidence.finalizeReceipt,
            idempotencyKey: input.idempotencyKey,
          },
        },
        replayed: false,
      }),
    );

    const wrapper = mountWorkspace();
    await flushPromises();
    await buttonContaining(wrapper, 'New session').trigger('click');
    await buttonContaining(wrapper, 'Scene Rehearsal').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(buttonContaining(wrapper, 'Quick Start').element);
    expect(api.createPlaySession).not.toHaveBeenCalled();

    await buttonContaining(wrapper, 'Quick Start').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get('[name="scene-title"]').element);
    await wrapper.get('[name="scene-title"]').setValue('Last train');
    await wrapper.get('[name="scene-location"]').setValue('Platform nine');
    await wrapper.get('[name="scene-opening"]').setValue('The doors begin to close.');
    await wrapper.get('[name="scene-objective"]').setValue('Test whether Mara reveals the letter.');
    await wrapper.get('.play-rehearsal-step-form').trigger('submit');
    await wrapper.get('[name="actor-1-name"]').setValue('Mara');
    await wrapper.get('[name="actor-1-goal"]').setValue('Keep the letter hidden');
    await wrapper.get('[name="actor-1-knowledge"]').setValue(
      'The last train departs at midnight.',
    );
    await wrapper.get('.play-rehearsal-cast').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[aria-current="step"]').text()).toContain('Review');
    await button(wrapper, 'Start Scene Rehearsal').trigger('click');
    await vi.waitFor(() => expect(api.createPlaySession).toHaveBeenCalledOnce());

    expect(api.createPlaySession).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'sceneRehearsal',
      startMode: 'quick',
      title: 'Last train',
      characters: ['Mara'],
      sceneContract: expect.objectContaining({
        sceneId: 'scene-last-train',
        participantRefs: ['participant-1'],
      }),
    }));
    expect(wrapper.get<HTMLButtonElement>('.play-session-card').element.disabled).toBe(true);
    expect(wrapper.get('.play-session-card[aria-current="true"]').text()).toContain(
      'Quick journey',
    );

    createGate.resolve({ session: rehearsalSession });
    await vi.waitFor(() => {
      expect(wrapper.find('.play-rehearsal-workspace').exists()).toBe(true);
      expect(button(wrapper, 'Begin rehearsal attempt').attributes('disabled')).toBeUndefined();
    });
    expect(wrapper.find('.play-launch-flow').exists()).toBe(false);

    await button(wrapper, 'Begin rehearsal attempt').trigger('click');
    await button(wrapper, 'Generate current actor step').trigger('click');
    await vi.waitFor(() => {
      expect(button(wrapper, 'Accept').attributes('disabled')).toBeUndefined();
    });
    await button(wrapper, 'Accept').trigger('click');
    await vi.waitFor(() => {
      expect(button(wrapper, 'Finish').attributes('disabled')).toBeUndefined();
    });
    await button(wrapper, 'Finish').trigger('click');
    await flushPromises();
    await button(wrapper, 'Confirm Finish').trigger('click');
    await vi.waitFor(() => expect(api.finishPlayRehearsalAttempt).toHaveBeenCalledOnce());

    expect(wrapper.get('.play-rehearsal-result').text()).toContain(
      'Mara keeps the sealed letter hidden.',
    );
    wrapper.unmount();
  });

  it('runs provisional actor truth through Accept and commits only on Finish', async () => {
    const session = createRehearsalSession();
    const committed = createCommittedFixture(session);
    const streamGate = deferred<void>();
    const deltaVisible = deferred<void>();
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });
    api.createPlayRehearsalAttempt.mockResolvedValue({
      attempt: createRunningAttempt(),
    });
    api.streamNextPlayActorStep.mockImplementation(
      async function* (
        _sessionId: string,
        _attemptId: string,
        input: PlayRehearsalStepStreamInput,
        options?: PlayRehearsalStepStreamOptions,
      ): AsyncIterable<PlayRehearsalStepStreamEvent> {
        const receipt = createMutationReceipt(input.idempotencyKey, 1, 'step-1');
        const prepared = createDraftAttempt(receipt);
        options?.onStepRunId?.('step-run-1');
        yield stepEvent('step-run-1', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'participant-mara',
          mode: 'next',
        });
        yield stepEvent('step-run-1', 2, {
          type: 'play.actor.step.delta',
          delta: 'Mara reaches for the sealed letter.',
          provisional: true,
        });
        deltaVisible.resolve();
        await streamGate.promise;
        yield stepEvent('step-run-1', 3, {
          type: 'play.actor.step.prepared',
          attempt: prepared,
          step: prepared.steps[0]!,
          receipt,
        });
      },
    );
    api.acceptPlayRehearsalStep.mockImplementation(
      async (
        _sessionId: string,
        _attemptId: string,
        input: { idempotencyKey: string },
      ) => {
        const receipt = createMutationReceipt(input.idempotencyKey, 2, 'step-1');
        return {
          attempt: createPreparedAttempt(receipt),
          receipt,
          replayed: false,
        };
      },
    );
    api.finishPlayRehearsalAttempt.mockImplementation(
      async (
        _sessionId: string,
        _attemptId: string,
        input: { idempotencyKey: string },
      ): Promise<PlayRehearsalFinalizeResult> => ({
        ...committed,
        receipt: {
          ...committed.receipt,
          idempotencyKey: input.idempotencyKey,
        },
        evidence: {
          ...committed.evidence,
          finalizeReceipt: {
            ...committed.evidence.finalizeReceipt,
            idempotencyKey: input.idempotencyKey,
          },
        },
        replayed: false,
      }),
    );

    const wrapper = mountWorkspace();
    await flushPromises();
    await vi.waitFor(() => {
      expect(api.getActivePlayRehearsalAttempt).toHaveBeenCalledWith('play-rehearsal-1');
    });

    expect(wrapper.find('.play-rehearsal-workspace').exists()).toBe(true);
    expect(wrapper.find('.play-transcript').exists()).toBe(false);
    expect(wrapper.find('.play-composer').exists()).toBe(false);
    expect(wrapper.find('.play-history-controls').exists()).toBe(false);
    expect(wrapper.find('.play-adoption-panel').exists()).toBe(false);
    expect(api.listPlayCheckpoints).not.toHaveBeenCalled();

    await button(wrapper, 'Begin rehearsal attempt').trigger('click');
    await vi.waitFor(() => expect(api.createPlayRehearsalAttempt).toHaveBeenCalledWith(
      'play-rehearsal-1',
      { baseRevision: 0 },
    ));
    await button(wrapper, 'Generate current actor step').trigger('click');
    await deltaVisible.promise;
    await flushPromises();

    expect(wrapper.get('.play-rehearsal-step[data-status="provisional"]').text()).toContain(
      'Mara reaches for the sealed letter.',
    );
    expect(wrapper.get<HTMLButtonElement>('.play-create-trigger').element.disabled).toBe(true);
    expect(wrapper.get<HTMLButtonElement>('.play-session-card').element.disabled).toBe(true);
    expect(api.acceptPlayRehearsalStep).not.toHaveBeenCalled();
    expect(api.finishPlayRehearsalAttempt).not.toHaveBeenCalled();

    streamGate.resolve();
    await vi.waitFor(() => {
      expect(button(wrapper, 'Accept').attributes('disabled')).toBeUndefined();
    });
    await button(wrapper, 'Accept').trigger('click');
    await vi.waitFor(() => expect(api.acceptPlayRehearsalStep).toHaveBeenCalledOnce());

    expect(wrapper.get('.play-rehearsal-step[data-status="selected"]').text()).toContain(
      'selected · attempt-local',
    );
    expect(api.finishPlayRehearsalAttempt).not.toHaveBeenCalled();

    await button(wrapper, 'Finish').trigger('click');
    await flushPromises();
    await button(wrapper, 'Confirm Finish').trigger('click');
    await vi.waitFor(() => expect(api.finishPlayRehearsalAttempt).toHaveBeenCalledOnce());
    await flushPromises();

    expect(api.finishPlayRehearsalAttempt).toHaveBeenCalledWith(
      'play-rehearsal-1',
      'attempt-1',
      expect.objectContaining({
        baseRevision: 0,
        expectedAttemptRevision: 2,
        selectedHeadRef: 'step-1',
        idempotencyKey: expect.any(String),
      }),
    );
    expect(wrapper.get('.play-rehearsal-result').text()).toContain(
      'Mara keeps the sealed letter hidden.',
    );
    expect(wrapper.get('.play-rehearsal-result').text()).toContain(
      'Revision 1 · turn-rehearsal-1',
    );
    expect(document.activeElement).toBe(
      wrapper.get('.play-rehearsal-result-focus').element,
    );
    expect(wrapper.get('.play-session-card').text()).toContain('Turn 1 · 1 messages');
    expect(wrapper.get<HTMLButtonElement>('.play-session-card').element.disabled).toBe(false);

    const restoredBranch: PlayRehearsalSessionV5 = {
      ...committed.session,
      transcript: [],
      turnArtifacts: [],
      selectedTurnIds: [],
      rehearsalScenes: [{
        ...committed.session.rehearsalScenes[0]!,
        turns: [],
      }],
    };
    api.listPlaySessions.mockResolvedValue({ sessions: [restoredBranch] });
    await wrapper.get('button[aria-label="刷新 Play workspace"]').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('.play-rehearsal-result').exists()).toBe(false);
    });
    wrapper.unmount();
  });

  it('cancels recovery truth without replacing the committed session list entry', async () => {
    const session = createRehearsalSession();
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });
    api.getActivePlayRehearsalAttempt.mockResolvedValue({
      attempt: createRunningAttempt(),
    });
    api.cancelPlayRehearsalAttempt.mockImplementation(
      async (
        _sessionId: string,
        _attemptId: string,
        input: { idempotencyKey: string },
      ) => {
        const receipt = createMutationReceipt(input.idempotencyKey, 1, 'attempt-1');
        return {
          attempt: {
            ...createRunningAttempt(),
            attemptRevision: 1,
            status: 'cancelled' as const,
            mutationReceipts: [receipt],
          },
          receipt,
          replayed: false,
        };
      },
    );

    const wrapper = mountWorkspace();
    await vi.waitFor(() => {
      expect(button(wrapper, 'Cancel').attributes('disabled')).toBeUndefined();
    });
    await button(wrapper, 'Cancel').trigger('click');
    await flushPromises();
    await button(wrapper, 'Confirm Cancel attempt').trigger('click');
    await vi.waitFor(() => expect(api.cancelPlayRehearsalAttempt).toHaveBeenCalledOnce());

    expect(api.finishPlayRehearsalAttempt).not.toHaveBeenCalled();
    expect(wrapper.get('.play-session-card').text()).toContain('Turn 0 · 0 messages');
    expect(wrapper.find('.play-rehearsal-result').exists()).toBe(false);
    expect(button(wrapper, 'Begin rehearsal attempt').exists()).toBe(true);
    expect(document.activeElement).toBe(button(wrapper, 'Begin rehearsal attempt').element);
    expect(wrapper.get<HTMLButtonElement>('.play-session-card').element.disabled).toBe(false);
    wrapper.unmount();
  });

  it('reopens committed rehearsal truth and starts the next attempt at its revision', async () => {
    const committed = createCommittedFixture(createRehearsalSession());
    api.listPlaySessions.mockResolvedValue({ sessions: [committed.session] });
    api.createPlayRehearsalAttempt.mockResolvedValue({
      attempt: {
        ...createRunningAttempt(),
        id: 'attempt-2',
        baseRevision: 1,
      },
    });

    const wrapper = mountWorkspace();
    await vi.waitFor(() => {
      expect(wrapper.find('.play-rehearsal-result').exists()).toBe(true);
      expect(button(wrapper, 'Begin next rehearsal attempt').attributes('disabled')).toBeUndefined();
    });

    expect(wrapper.get('.play-rehearsal-result').text()).toContain(
      'Mara keeps the sealed letter hidden.',
    );
    expect(wrapper.get('.play-rehearsal-result').text()).toContain(
      'The station gate closes at the appointed time.',
    );
    expect(wrapper.get('.play-rehearsal-step[data-status="committed"]').text()).toContain(
      'Mara keeps the sealed letter hidden.',
    );
    expect(wrapper.get('.play-rehearsal-step[data-status="committed"]').text()).not.toContain(
      'The station gate closes at the appointed time.',
    );
    expect(wrapper.get('.play-actor-queue [data-status="committed"]').text()).toContain('Mara');
    expect(wrapper.get('.play-rehearsal-inspector').text()).toContain('Final boarding call');
    expect(wrapper.get('.play-rehearsal-inspector').text()).not.toContain(
      'Unselected branch alarm',
    );
    expect(wrapper.text()).not.toContain('Director-only route');
    expect(wrapper.text()).not.toContain('Unknown witness signal');
    expect(wrapper.text()).not.toContain('Hidden patrol changes course.');
    expect(wrapper.text()).toContain('secret.clue');
    expect(wrapper.text()).toContain('Platform nine code is 47');
    expect(wrapper.text()).not.toContain('secret.route');
    expect(wrapper.text()).not.toContain('secret.rumor');
    expect(wrapper.text()).not.toContain('Rumor-only signal');
    expect(wrapper.text()).not.toContain('secret.unclassified');
    expect(wrapper.text()).not.toContain('Unclassified signal');
    expect(wrapper.text()).not.toContain('worldMomentum.hidden');
    expect(wrapper.text()).not.toContain('Reserved momentum leak');
    expect(wrapper.text()).not.toContain('worldMomentum');

    await button(wrapper, 'Begin next rehearsal attempt').trigger('click');
    await vi.waitFor(() => expect(api.createPlayRehearsalAttempt).toHaveBeenCalledWith(
      'play-rehearsal-1',
      { baseRevision: 1 },
    ));

    expect(wrapper.find('.play-rehearsal-result').exists()).toBe(false);
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Mara');
    expect(wrapper.get('.play-rehearsal-inspector').text()).toContain(
      'Mara keeps the sealed letter hidden.',
    );
    wrapper.unmount();
  });

  it('offers in-place recovery when actor-step truth becomes indeterminate', async () => {
    const session = createRehearsalSession();
    let idempotencyKey = '';
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });
    api.getActivePlayRehearsalAttempt.mockResolvedValue({
      attempt: createRunningAttempt(),
    });
    api.getPlayRehearsalAttempt
      .mockRejectedValueOnce(new Error('attempt lookup temporarily unavailable'))
      .mockImplementation(async () => ({
        attempt: createDraftAttempt(createMutationReceipt(idempotencyKey, 1, 'step-1')),
      }));
    api.streamNextPlayActorStep.mockImplementation(
      async function* (
        _sessionId: string,
        _attemptId: string,
        input: PlayRehearsalStepStreamInput,
        options?: PlayRehearsalStepStreamOptions,
      ): AsyncIterable<PlayRehearsalStepStreamEvent> {
        idempotencyKey = input.idempotencyKey;
        options?.onStepRunId?.('step-run-lost');
        yield stepEvent('step-run-lost', 1, {
          type: 'play.actor.step.started',
          baseAttemptRevision: 0,
          participantRef: 'participant-mara',
          mode: 'next',
        });
        yield stepEvent('step-run-lost', 2, {
          type: 'play.actor.step.delta',
          delta: 'Mara reaches for the sealed letter.',
          provisional: true,
        });
        throw new Error('stream disconnected');
      },
    );

    const wrapper = mountWorkspace();
    await vi.waitFor(() => {
      expect(button(wrapper, 'Generate current actor step').attributes('disabled')).toBeUndefined();
    });
    await button(wrapper, 'Generate current actor step').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('.play-rehearsal-recovery').exists()).toBe(true);
    });

    expect(wrapper.get<HTMLButtonElement>('button[aria-label="刷新 Play workspace"]').element.disabled)
      .toBe(true);
    expect(button(wrapper, 'Recover attempt truth').attributes('disabled')).toBeUndefined();

    await button(wrapper, 'Recover attempt truth').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('.play-rehearsal-recovery').exists()).toBe(false);
      expect(button(wrapper, 'Accept').attributes('disabled')).toBeUndefined();
    });

    expect(api.getPlayRehearsalAttempt).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.play-rehearsal-step[data-status="provisional"]').text()).toContain(
      'Mara keeps the sealed letter hidden.',
    );
    wrapper.unmount();
  });

  it('fails closed when active-attempt lookup fails and recovers in place', async () => {
    const session = createRehearsalSession();
    api.listPlaySessions.mockResolvedValue({ sessions: [session] });
    api.getActivePlayRehearsalAttempt
      .mockRejectedValueOnce(new Error('active attempt lookup unavailable'))
      .mockResolvedValueOnce({ attempt: null });

    const wrapper = mountWorkspace();
    await vi.waitFor(() => {
      expect(wrapper.find('.play-rehearsal-recovery').exists()).toBe(true);
    });

    expect(wrapper.findAll('button').some((candidate) =>
      candidate.text() === 'Begin rehearsal attempt')).toBe(false);
    expect(wrapper.get<HTMLButtonElement>('.play-create-trigger').element.disabled).toBe(true);
    expect(wrapper.get<HTMLButtonElement>('.play-session-card').element.disabled).toBe(true);
    expect(wrapper.get<HTMLButtonElement>('button[aria-label="刷新 Play workspace"]').element.disabled)
      .toBe(true);
    expect(wrapper.find('.play-outcome-panel').exists()).toBe(true);
    expect(button(wrapper, 'Generate report').attributes('disabled')).toBeDefined();

    await button(wrapper, 'Recover attempt truth').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('.play-rehearsal-recovery').exists()).toBe(false);
      expect(button(wrapper, 'Begin rehearsal attempt').attributes('disabled')).toBeUndefined();
    });
    expect(button(wrapper, 'Generate report').attributes('disabled')).toBeUndefined();

    expect(api.getActivePlayRehearsalAttempt).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('keeps schema-v4 Quick sessions on Transcript, Composer, History and Adoption', async () => {
    api.listPlaySessions.mockResolvedValue({ sessions: [createJourneySession()] });

    const wrapper = mountWorkspace();
    await flushPromises();

    expect(wrapper.find('.play-rehearsal-workspace').exists()).toBe(false);
    expect(wrapper.find('.play-transcript').exists()).toBe(true);
    expect(wrapper.find('.play-composer').exists()).toBe(true);
    expect(wrapper.find('.play-history-controls').exists()).toBe(true);
    expect(wrapper.find('.play-adoption-panel').exists()).toBe(true);
    expect(wrapper.find('.play-outcome-panel').exists()).toBe(true);
    expect(api.getActivePlayRehearsalAttempt).not.toHaveBeenCalled();
    expect(api.listPlayCheckpoints).toHaveBeenCalledWith('play-quick-1');
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
    props: { workspace, providerConfigured: true },
  });
}

function createRehearsalSession(): PlayRehearsalSessionV5 {
  return {
    ...createSessionBase('play-rehearsal-1', 'Last train'),
    schemaVersion: 5,
    sceneStart: 'The doors begin to close.',
    characters: ['Mara'],
    sceneRehearsal: {
      schemaVersion: 1,
      sessionId: 'play-rehearsal-1',
      purpose: 'sceneRehearsal',
      startMode: 'quick',
      activeSceneRef: 'scene-last-train',
      sceneContract: {
        sceneId: 'scene-last-train',
        worldClock: { turn: 0, revision: 0 },
        clockProvenance: {
          kind: 'newSessionInitial',
          sourceRefs: [],
          authorProvidedAt: '2026-07-15T00:00:00.000Z',
        },
        location: {
          value: 'Platform nine',
          provenance: {
            kind: 'authorProvided',
            providedAt: '2026-07-15T00:00:00.000Z',
          },
        },
        trigger: {
          value: 'The doors begin to close.',
          provenance: {
            kind: 'authorProvided',
            providedAt: '2026-07-15T00:00:00.000Z',
          },
        },
        objective: {
          value: 'Test whether Mara reveals the letter.',
          provenance: {
            kind: 'authorProvided',
            providedAt: '2026-07-15T00:00:00.000Z',
          },
        },
        participantRefs: ['participant-mara'],
        orderStrategy: 'directorFixed',
      },
      participants: [{
        participantRef: 'participant-mara',
        displayName: 'Mara',
        currentGoal: 'Keep the letter hidden',
        initialKnowledgeEvidenceRefs: ['knowledge-mara'],
      }],
      initialKnowledgeEvidence: [{
        id: 'knowledge-mara',
        participantRef: 'participant-mara',
        visibility: 'playerVisible',
        fact: 'The last train departs at midnight.',
        provenance: {
          kind: 'authorProvided',
          providedAt: '2026-07-15T00:00:00.000Z',
        },
      }],
    },
    rehearsalScenes: [{
      schemaVersion: 1,
      sessionId: 'play-rehearsal-1',
      sceneId: 'scene-last-train',
      turns: [],
    }],
  };
}

function createJourneySession(): PlaySession {
  return {
    ...createSessionBase('play-quick-1', 'Quick journey'),
    schemaVersion: 4,
  };
}

function createSessionBase(id: string, title: string) {
  return {
    id,
    title,
    createdAt: '2026-07-15T00:00:00.000Z',
    revision: 0,
    sceneStart: 'A playable moment begins.',
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
    worldClock: { turn: 0, revision: 0 },
    eventPolicy: {
      simulationMode: 'reactiveWorld' as const,
      density: 'balanced' as const,
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

function createRunningAttempt(): PlayTurnAttempt {
  return {
    schemaVersion: 1,
    id: 'attempt-1',
    sessionId: 'play-rehearsal-1',
    baseRevision: 0,
    attemptRevision: 0,
    sceneBeforeRef: 'scene-last-train',
    status: 'running',
    actorOrder: ['participant-mara'],
    selectedStepRefs: [],
    dueScheduledEventIds: [],
    steps: [],
    mutationReceipts: [],
    createdAt: '2026-07-15T00:01:00.000Z',
    updatedAt: '2026-07-15T00:01:00.000Z',
  };
}

function createDraftAttempt(receipt: PlayAttemptMutationReceipt): PlayTurnAttempt {
  const step = createStep('draft');
  return {
    ...createRunningAttempt(),
    attemptRevision: 1,
    currentStepRef: step.id,
    steps: [step],
    mutationReceipts: [receipt],
  };
}

function createPreparedAttempt(
  acceptReceipt: PlayAttemptMutationReceipt,
): PlayTurnAttempt {
  const step = createStep('selected');
  return {
    ...createRunningAttempt(),
    attemptRevision: 2,
    status: 'prepared',
    selectedStepRefs: [step.id],
    selectedHeadRef: step.id,
    steps: [step],
    mutationReceipts: [
      createMutationReceipt('step-key-recorded', 1, step.id),
      acceptReceipt,
    ],
  };
}

function createStep(status: CharacterStepDraft['status']): CharacterStepDraft {
  return {
    id: 'step-1',
    attemptId: 'attempt-1',
    participantRef: 'participant-mara',
    queueIndex: 0,
    perceptionRef: 'perception-mara-0',
    intentSummary: 'Keep the letter out of sight',
    narrativeBlocks: [{
      id: 'block-1',
      kind: 'characterAction',
      speakerRef: 'participant-mara',
      content: 'Mara keeps the sealed letter hidden.',
      visibility: 'playerVisible',
      projection: 'transcript',
      eventRefs: ['event-selected'],
      sourceRefs: ['knowledge-mara'],
    }],
    settlementContribution: {
      events: [],
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      stateDelta: { 'letter.visible': false },
      observations: [],
      suggestedActions: [],
    },
    decisionBasisRefs: ['knowledge-mara'],
    status,
    createdAt: '2026-07-15T00:02:00.000Z',
  };
}

function createMutationReceipt(
  idempotencyKey: string,
  resultingAttemptRevision: number,
  resultRef: string,
): PlayAttemptMutationReceipt {
  return {
    idempotencyKey,
    requestFingerprint: `${idempotencyKey}-fingerprint`,
    resultingAttemptRevision,
    resultRef,
    responseDigest: `${idempotencyKey}-digest`,
  };
}

function createCommittedFixture(
  initial: PlayRehearsalSessionV5,
): Omit<PlayRehearsalFinalizeResult, 'replayed'> {
  const selectedStep = createStep('selected');
  const receipt = {
    idempotencyKey: 'finish-key',
    requestFingerprint: 'finish-fingerprint',
    attemptRevision: 2,
  };
  const artifact = {
    schemaVersion: 3 as const,
    artifactKind: 'worldSettlement' as const,
    branchSnapshotVersion: 1 as const,
    id: 'turn-rehearsal-1',
    revision: 1,
    input: { kind: 'do' as const, raw: 'Continue rehearsal.' },
    messages: [{
      id: 'turn-rehearsal-1-referee',
      speaker: 'world-referee',
      content: 'Mara keeps the sealed letter hidden.',
      createdAt: '2026-07-15T00:03:00.000Z',
    }],
    worldClock: { turn: 1, revision: 1 },
    eventIds: ['event-selected', 'event-hidden', 'event-hard-due'],
    dueScheduledEventIds: ['scheduled-gate-close'],
    scheduledEventIds: [],
    scheduledEventSnapshots: [],
    playLocalStateSnapshot: {
      'letter.visible': false,
      secret: {
        clue: 'Platform nine code is 47',
        route: 'north tunnel',
        rumor: 'Rumor-only signal',
        unclassified: 'Unclassified signal',
      },
      worldMomentum: { hidden: 'Reserved momentum leak' },
    },
    playLocalStateVisibilitySnapshot: {
      'letter.visible': 'playerVisible' as const,
      'secret.clue': 'playerVisible' as const,
      'secret.route': 'playerUnknown' as const,
      'secret.rumor': 'rumor' as const,
      'worldMomentum.hidden': 'playerVisible' as const,
    },
    observationIds: [],
    rehearsalEvidenceRefs: ['evidence-1'],
    stateDelta: {
      'letter.visible': false,
      secret: {
        clue: 'Platform nine code is 47',
        route: 'north tunnel',
        rumor: 'Rumor-only signal',
        unclassified: 'Unclassified signal',
      },
      worldMomentum: { hidden: 'Reserved momentum leak' },
    },
    suggestedActions: [],
    committedAt: '2026-07-15T00:03:00.000Z',
    canonical: false as const,
  };
  const committedStepBlocks = [...selectedStep.narrativeBlocks, {
    id: `world-notice-${selectedStep.id}`,
    kind: 'worldNotice' as const,
    content: 'Final boarding call: The platform bell rings for the selected branch.',
    visibility: 'playerVisible' as const,
    projection: 'transcript' as const,
    eventRefs: ['event-selected'],
    sourceRefs: [],
  }, {
    id: 'block-director-only',
    kind: 'narrator' as const,
    content: 'Director-only route through the north tunnel.',
    visibility: 'playerVisible' as const,
    projection: 'directorOnly' as const,
    eventRefs: [],
    sourceRefs: [],
  }, {
    id: 'block-player-unknown',
    kind: 'characterAction' as const,
    speakerRef: 'participant-mara',
    content: 'Unknown witness signal behind the clock.',
    visibility: 'playerUnknown' as const,
    projection: 'directorOnly' as const,
    eventRefs: ['event-hidden'],
    sourceRefs: [],
  }];
  const hostNarrativeBlocks = [{
    id: `world-notice-host-${artifact.id}`,
    kind: 'worldNotice' as const,
    content: 'The station gate closes: The station gate closes at the appointed time.',
    visibility: 'playerVisible' as const,
    projection: 'transcript' as const,
    eventRefs: ['event-hard-due'],
    sourceRefs: [],
  }];
  const evidence = {
    id: 'evidence-1',
    owningTurnArtifactId: artifact.id,
    attemptId: 'attempt-1',
    selectedStepRefs: [selectedStep.id],
    steps: [{
      stepRef: selectedStep.id,
      participantRef: selectedStep.participantRef,
      perceptionRef: selectedStep.perceptionRef,
      intentSummary: selectedStep.intentSummary,
      narrativeBlocks: committedStepBlocks,
      settlementEventRefs: ['event-selected', 'event-hidden'],
      decisionBasisRefs: selectedStep.decisionBasisRefs,
    }],
    hostNarrativeBlocks,
    narrativeBlocks: [...committedStepBlocks, ...hostNarrativeBlocks],
    finalizeReceipt: receipt,
    committedAt: artifact.committedAt,
    canonical: false as const,
  };
  const session: PlayRehearsalSessionV5 = {
    ...initial,
    revision: 1,
    worldClock: { turn: 1, revision: 1 },
    transcript: artifact.messages,
    turnArtifacts: [artifact],
    selectedTurnIds: [artifact.id],
    playLocalState: {
      'letter.visible': false,
      secret: {
        clue: 'Platform nine code is 47',
        route: 'north tunnel',
        rumor: 'Rumor-only signal',
        unclassified: 'Unclassified signal',
      },
      worldMomentum: { hidden: 'Reserved momentum leak' },
    },
    playLocalStateVisibility: {
      'letter.visible': 'playerVisible',
      'secret.clue': 'playerVisible',
      'secret.route': 'playerUnknown',
      'secret.rumor': 'rumor',
      'worldMomentum.hidden': 'playerVisible',
    },
    events: [{
      id: 'event-selected',
      turnId: artifact.id,
      sequence: 1,
      kind: 'factionActed',
      origin: 'faction',
      title: 'Final boarding call',
      summary: 'The platform bell rings for the selected branch.',
      visibility: 'playerVisible',
      cause: { reason: 'The final train is departing.' },
      worldClock: { turn: 1, revision: 1 },
      createdAt: artifact.committedAt,
      canonical: false,
    }, {
      id: 'event-hidden',
      turnId: artifact.id,
      sequence: 2,
      kind: 'factionActed',
      origin: 'faction',
      title: 'Hidden patrol order',
      summary: 'Hidden patrol changes course.',
      visibility: 'playerUnknown',
      cause: { reason: 'A concealed order redirects the patrol.' },
      worldClock: { turn: 1, revision: 1 },
      createdAt: artifact.committedAt,
      canonical: false,
    }, {
      id: 'event-hard-due',
      turnId: artifact.id,
      sequence: 3,
      kind: 'environmentChanged',
      origin: 'clock',
      title: 'The station gate closes',
      summary: 'The station gate closes at the appointed time.',
      visibility: 'playerVisible',
      cause: {
        reason: 'The scheduled station deadline became due.',
        triggerId: 'scheduled-gate-close',
      },
      worldClock: { turn: 1, revision: 1 },
      createdAt: artifact.committedAt,
      canonical: false,
    }, {
      id: 'event-unselected',
      turnId: 'turn-variant',
      sequence: 1,
      kind: 'factionActed',
      origin: 'faction',
      title: 'Unselected branch alarm',
      summary: 'An event belonging only to another branch.',
      visibility: 'playerVisible',
      cause: { reason: 'A discarded variant sounded the alarm.' },
      worldClock: { turn: 1, revision: 1 },
      createdAt: artifact.committedAt,
      canonical: false,
    }],
    rehearsalScenes: [{
      ...initial.rehearsalScenes[0]!,
      turns: [evidence],
    }],
  };
  return {
    session,
    attempt: {
      ...createPreparedAttempt(createMutationReceipt('accept-key', 2, 'step-1')),
      status: 'committed',
      committedArtifactRef: artifact.id,
      committedEvidenceRef: evidence.id,
    },
    artifact,
    evidence,
    receipt,
  };
}

type StepEventBase = Pick<
  PlayRehearsalStepStreamEvent,
  'eventId' | 'sequence' | 'sessionId' | 'attemptId' | 'stepRunId'
>;

type StepEventPayload<T = PlayRehearsalStepStreamEvent> = T extends StepEventBase
  ? Omit<T, keyof StepEventBase>
  : never;

function stepEvent(
  runId: string,
  sequence: number,
  value: StepEventPayload,
): PlayRehearsalStepStreamEvent {
  return {
    ...value,
    eventId: `${runId}:${sequence}`,
    sequence,
    sessionId: 'play-rehearsal-1',
    attemptId: 'attempt-1',
    stepRunId: runId,
  } as PlayRehearsalStepStreamEvent;
}

function button(
  wrapper: ReturnType<typeof mountWorkspace>,
  label: string,
) {
  const result = wrapper.findAll('button').find((candidate) =>
    candidate.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function buttonContaining(
  wrapper: ReturnType<typeof mountWorkspace>,
  label: string,
) {
  const result = wrapper.findAll('button').find((candidate) =>
    candidate.text().includes(label));
  if (!result) throw new Error(`Missing button containing: ${label}`);
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
