import { describe, expect, it } from 'vitest';

import {
  assembleNovelAgentMessages,
  createBaselineNovelAgentContextPackage,
  createNovelAgentSystemPrompt,
  createRuntimeTurnInput,
  inferNovelAgentCapability,
} from '@oh-awesome-novel/agent';

const baseInput = {
  request: '帮我检查女主状态',
  workspace: {
    workspaceRoot: '/novel',
    constitution: '单女主，不机械降神。',
    workflow: 'name: lightnovel',
    summaries: ['第一章摘要'],
    state: 'characters.heroine.hp: injured',
    timeline: 'event_001',
    foreshadow: 'black_mark',
  },
};

describe('Novel agent message assembly', () => {
  it('creates a filesystem-first system prompt without hidden planning language', () => {
    const prompt = createNovelAgentSystemPrompt({
      ...baseInput,
      skill: {
        name: 'review',
      },
    });

    expect(prompt).toContain('filesystem-first novel workspace');
    expect(prompt).toContain('Workspace root: /novel');
    expect(prompt).toContain('Active skill: review');
    expect(prompt).not.toContain('planner');
    expect(prompt).not.toContain('autonomous');
  });

  it('assembles messages and structured context from a core snapshot', () => {
    const assembly = assembleNovelAgentMessages({
      ...baseInput,
      priorMessages: [{ role: 'assistant', content: '上一轮回答' }],
      selectedContext: [
        {
          kind: 'selected',
          title: 'Scene 1',
          content: '选中的正文',
        },
      ],
      skill: {
        name: 'review',
        system: '保持人物不 OOC。',
      },
    });

    expect(assembly.messages.map((message) => message.role)).toEqual([
      'system',
      'assistant',
      'user',
    ]);
    expect(assembly.messages.at(-1)?.content).toBe('帮我检查女主状态');
    expect(assembly.context.map((item) => item.kind)).toEqual([
      'constitution',
      'workflow',
      'summary',
      'state',
      'timeline',
      'foreshadow',
      'selected',
    ]);
    expect(assembly.skill?.name).toBe('review');
  });

  it('injects context package summaries as selected model context', () => {
    const assembly = assembleNovelAgentMessages({
      ...baseInput,
      contextPackage: {
        id: 'ctx-1',
        capability: 'novel.write_chapter',
        createdAt: '2026-06-19T00:00:00.000Z',
        selected: [
          {
            sourceId: 'constitution',
            reason: 'protect story rules',
            budgetLayer: 'L0',
            semanticBoundary: 'protected',
          },
        ],
        omitted: [
          {
            sourceId: 'playTranscript',
            reason: 'not adopted as truth',
            budgetLayer: 'L3',
            semanticBoundary: 'excluded',
          },
        ],
        trace: [
          {
            id: 'trace-1',
            type: 'workspaceSnapshot',
            sourceId: 'constitution',
            reason: 'loaded from workspace snapshot',
            budgetLayer: 'L0',
            semanticBoundary: 'protected',
            outcome: 'selected',
            createdAt: '2026-06-19T00:00:00.000Z',
          },
        ],
        minimalMemory: {
          characters: ['heroine'],
          hooks: [],
          worldRules: [],
          recentFacts: [],
          styleNotes: [],
        },
        ruleStack: [],
      },
    });

    const contextPackageItem = assembly.context.find(
      (item) => item.title === 'Context Package Summary',
    );

    expect(contextPackageItem).toMatchObject({
      kind: 'selected',
    });
    expect(contextPackageItem?.content).toContain('Context Package: ctx-1');
    expect(contextPackageItem?.content).toContain('constitution [L0/protected]');
    expect(contextPackageItem?.content).toContain('playTranscript [L3/excluded]');
  });

  it('creates Runtime turn input without tools or filesystem access', () => {
    const abortController = new AbortController();
    const turnInput = createRuntimeTurnInput({
      ...baseInput,
      abortSignal: abortController.signal,
    });

    expect(turnInput.messages?.at(0)).toMatchObject({
      role: 'system',
    });
    expect(turnInput.context?.map((item) => item.kind)).toContain('state');
    expect(turnInput.abortSignal).toBe(abortController.signal);
    expect(turnInput).not.toHaveProperty('tools');
  });

  it('infers writing capability and builds a baseline context package', () => {
    expect(inferNovelAgentCapability('/写下一章 请继续')).toBe('novel.write_chapter');

    const contextPackage = createBaselineNovelAgentContextPackage({
      request: '/写下一章 请继续',
      workspace: baseInput.workspace,
      createdAt: '2026-06-19T00:00:00.000Z',
    });

    expect(contextPackage).toMatchObject({
      capability: 'novel.write_chapter',
    });
    expect(contextPackage?.selected.map((source) => source.sourceId))
      .toContain('constitution');
    expect(contextPackage?.trace.map((trace) => trace.outcome))
      .toContain('selected');
  });
});
