import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlayRehearsalActorGenerationEvent,
  PlayRehearsalActorPromptInput,
} from '@oh-awesome-novel/agent';
import type { LanguageModel } from 'ai';

const streamText = vi.fn();

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText,
}));

const {
  PLAY_REHEARSAL_ACTOR_SYSTEM_PROMPT,
  PLAY_REHEARSAL_REFEREE_SYSTEM_PROMPT,
  completePlayRehearsalReferee,
  formatPlayRehearsalActorPrompt,
  streamPlayRehearsalActorGeneration,
} = await import('@oh-awesome-novel/agent');

const providerConfig = {
  id: 'mock-provider',
  kind: 'custom' as const,
  model: 'mock-model',
};
const model = {
  provider: 'mock',
  modelId: 'mock-model',
} as LanguageModel;

describe('Play rehearsal actor generation', () => {
  beforeEach(() => {
    streamText.mockReset();
  });

  it('formats only the frozen participant-visible allowlist', () => {
    const input = createActorPromptInput();
    const valueWithForbiddenExtras = {
      ...input,
      sceneContract: {
        ...input.sceneContract,
        workspaceBaseline: 'WORKSPACE_BASELINE_MUST_NOT_LEAK',
      },
      perception: {
        ...input.perception,
        hiddenFactRefs: ['HIDDEN_FACT_REF_MUST_NOT_LEAK'],
        tools: ['workspace.read', 'workspace.write'],
      },
      selectedPriorVisibleBlocks: input.selectedPriorVisibleBlocks.map((block) => ({
        ...block,
        directorOnlyText: 'DIRECTOR_ONLY_TEXT_MUST_NOT_LEAK',
      })),
    } as unknown as PlayRehearsalActorPromptInput;

    const prompt = formatPlayRehearsalActorPrompt(valueWithForbiddenExtras);

    expect(prompt).toContain('scene-platform');
    expect(prompt).toContain('the public departure bell rang');
    expect(prompt).toContain('Mira folds the timetable.');
    expect(prompt).toContain('Find a safe exit');
    expect(prompt).not.toContain('WORKSPACE_BASELINE_MUST_NOT_LEAK');
    expect(prompt).not.toContain('HIDDEN_FACT_REF_MUST_NOT_LEAK');
    expect(prompt).not.toContain('DIRECTOR_ONLY_TEXT_MUST_NOT_LEAK');
    expect(prompt).not.toContain('workspace.read');
    expect(prompt.match(/<\/oan-play-actor-input>/gu)).toHaveLength(1);
  });

  it('fails closed when a prior block is not selected, visible, and observed', () => {
    const input = createActorPromptInput();

    expect(() => formatPlayRehearsalActorPrompt({
      ...input,
      selectedPriorVisibleBlocks: [{
        ...input.selectedPriorVisibleBlocks[0]!,
        visibleToParticipant: false,
      } as unknown as PlayRehearsalActorPromptInput['selectedPriorVisibleBlocks'][number]],
    })).toThrow('not selected participant-visible transcript data');

    expect(() => formatPlayRehearsalActorPrompt({
      ...input,
      perception: {
        ...input.perception,
        observedNarrativeBlockRefs: [],
      },
    })).toThrow('outside perception');
  });

  it('streams plain actor text with no tools or generic workspace assembly', async () => {
    const abortController = new AbortController();
    const resolveModel = vi.fn(() => model);
    streamText.mockReturnValue({
      fullStream: toAsyncIterable([
        { type: 'start' },
        { type: 'text-delta', id: 'text-1', text: '她抬眼。' },
        { type: 'text-delta', id: 'text-1', text: '“出口在哪？”' },
        { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} },
      ]),
    });

    const events = await collectEvents(streamPlayRehearsalActorGeneration({
      ...createActorPromptInput(),
      providerConfig,
      resolveModel,
      abortSignal: abortController.signal,
    }));

    expect(events).toEqual([
      { type: 'text_delta', text: '她抬眼。' },
      { type: 'text_delta', text: '“出口在哪？”' },
      { type: 'finish', text: '她抬眼。“出口在哪？”', finishReason: 'stop' },
    ]);
    expect(resolveModel).toHaveBeenCalledWith(providerConfig);
    const call = streamText.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model,
      system: PLAY_REHEARSAL_ACTOR_SYSTEM_PROMPT,
      maxRetries: 0,
      abortSignal: abortController.signal,
    });
    expect(call.prompt).toContain('the public departure bell rang');
    expect(call).not.toHaveProperty('tools');
    expect(call).not.toHaveProperty('messages');
    expect(call).not.toHaveProperty('workspace');
  });

  it('keeps actor abort distinct from provider failure', async () => {
    streamText
      .mockReturnValueOnce({
        fullStream: toAsyncIterable([
          { type: 'text-delta', id: 'text-1', text: '半句' },
          { type: 'abort', reason: 'user-stop' },
        ]),
      })
      .mockReturnValueOnce({
        fullStream: toAsyncIterable([
          { type: 'text-delta', id: 'text-2', text: '另一半' },
          { type: 'error', error: new Error('provider exploded') },
        ]),
      });
    const common = {
      ...createActorPromptInput(),
      providerConfig,
      resolveModel: vi.fn(() => model),
    };

    await expect(collectEvents(streamPlayRehearsalActorGeneration(common))).resolves.toEqual([
      { type: 'text_delta', text: '半句' },
      { type: 'abort', partialText: '半句', reason: 'user-stop' },
    ]);
    await expect(collectEvents(streamPlayRehearsalActorGeneration(common))).resolves.toEqual([
      { type: 'text_delta', text: '另一半' },
      {
        type: 'error',
        partialText: '另一半',
        error: {
          code: 'provider_error',
          message: 'provider exploded',
          retryable: true,
        },
      },
    ]);
  });

  it('does not start actor provider work for an already aborted request', async () => {
    const abortController = new AbortController();
    abortController.abort('cancel-before-start');
    const resolveModel = vi.fn(() => model);

    await expect(collectEvents(streamPlayRehearsalActorGeneration({
      ...createActorPromptInput(),
      providerConfig,
      resolveModel,
      abortSignal: abortController.signal,
    }))).resolves.toEqual([{
      type: 'abort',
      partialText: '',
      reason: 'cancel-before-start',
    }]);
    expect(resolveModel).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });
});

describe('Play rehearsal single referee completion', () => {
  beforeEach(() => {
    streamText.mockReset();
  });

  it('collects bounded raw referee text without exposing tools or workspace loading', async () => {
    const resolveModel = vi.fn(() => model);
    streamText.mockReturnValue({
      fullStream: toAsyncIterable([
        { type: 'text-delta', id: 'referee-1', text: 'Observable narrative.\n' },
        { type: 'text-delta', id: 'referee-1', text: '```oan-play-settlement\n{}\n```' },
        { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} },
      ]),
    });
    const prompt = 'FULL_HOST_REFEREE_PROMPT_WITH_FROZEN_EVIDENCE';

    await expect(completePlayRehearsalReferee({
      providerConfig,
      resolveModel,
      prompt,
      maxOutputCharacters: 128,
    })).resolves.toEqual({
      status: 'completed',
      text: 'Observable narrative.\n```oan-play-settlement\n{}\n```',
      finishReason: 'stop',
    });
    const call = streamText.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model,
      system: PLAY_REHEARSAL_REFEREE_SYSTEM_PROMPT,
      prompt,
      maxRetries: 0,
    });
    expect(call).not.toHaveProperty('tools');
    expect(call).not.toHaveProperty('messages');
    expect(call).not.toHaveProperty('workspace');
  });

  it('fails closed at the referee output bound', async () => {
    streamText.mockReturnValue({
      fullStream: toAsyncIterable([
        { type: 'text-delta', id: 'referee-1', text: '123' },
        { type: 'text-delta', id: 'referee-1', text: '45' },
      ]),
    });

    await expect(completePlayRehearsalReferee({
      providerConfig,
      resolveModel: vi.fn(() => model),
      prompt: 'Full referee prompt',
      maxOutputCharacters: 4,
    })).resolves.toEqual({
      status: 'provider_error',
      partialText: '1234',
      error: {
        code: 'response_too_large',
        message: 'Play rehearsal referee response exceeded 4 characters.',
        retryable: false,
      },
    });
  });

  it('returns distinct referee abort and provider error results', async () => {
    streamText
      .mockReturnValueOnce({
        fullStream: toAsyncIterable([
          { type: 'text-delta', id: 'referee-1', text: 'partial' },
          { type: 'abort', reason: 'step-stop' },
        ]),
      })
      .mockReturnValueOnce({
        fullStream: toAsyncIterable([
          { type: 'error', error: new Error('referee unavailable') },
        ]),
      });
    const common = {
      providerConfig,
      resolveModel: vi.fn(() => model),
      prompt: 'Full referee prompt',
    };

    await expect(completePlayRehearsalReferee(common)).resolves.toEqual({
      status: 'aborted',
      partialText: 'partial',
      reason: 'step-stop',
    });
    await expect(completePlayRehearsalReferee(common)).resolves.toEqual({
      status: 'provider_error',
      partialText: '',
      error: {
        code: 'provider_error',
        message: 'referee unavailable',
        retryable: true,
      },
    });
  });
});

function createActorPromptInput(): PlayRehearsalActorPromptInput {
  return {
    sceneContract: {
      sceneId: 'scene-platform',
      sceneRevision: 3,
      participantRefs: ['character:mira', 'character:gatekeeper'],
      worldClock: {
        turn: 4,
        revision: 4,
        anchor: 'Midnight platform',
        elapsed: 'PT20M',
      },
      location: 'Northbound platform',
      atmosphere: 'Quiet and watchful',
      trigger: 'the public departure bell rang',
      objective: 'Test whether Mira asks for help',
      risk: 'The last train may leave',
    },
    perception: {
      snapshotId: 'perception:mira:3',
      participantRef: 'character:mira',
      displayName: 'Mira',
      sceneRevision: 3,
      position: 'Beside the timetable',
      emotion: 'Uneasy',
      currentGoal: 'Find a safe exit',
      conflict: 'She distrusts the gatekeeper',
      visibleFacts: [{
        ref: 'knowledge:mira:bell',
        fact: 'the public departure bell rang',
      }],
      visibleEvents: [{
        ref: 'event:public-bell',
        title: 'Departure bell',
        summary: 'A bell echoed across the platform',
      }],
      behaviorAnchors: [{
        ref: 'anchor:mira:cautious',
        summary: 'Mira asks indirect questions before trusting strangers',
      }],
      observedNarrativeBlockRefs: ['block:prior:1'],
    },
    selectedPriorVisibleBlocks: [{
      id: 'block:prior:1',
      kind: 'characterAction',
      speakerRef: 'character:mira',
      content: 'Mira folds the timetable.',
      projection: 'transcript',
      selected: true,
      visibleToParticipant: true,
    }],
  };
}

async function collectEvents(
  events: AsyncIterable<PlayRehearsalActorGenerationEvent>,
): Promise<PlayRehearsalActorGenerationEvent[]> {
  const collected: PlayRehearsalActorGenerationEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function* toAsyncIterable<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}
