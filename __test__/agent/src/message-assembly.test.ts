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

  it('includes only request-local Play writing references in context and trace', () => {
    const attachment = {
      attachmentId: 'writing-ref-1',
      sessionId: 'play-1',
      title: 'Play outcome · selected material',
      path: '.workspace/writing-references/writing-ref-1.yaml',
      content: 'Selected outcome item: the gate remained sealed.',
    };
    const assembly = assembleNovelAgentMessages({
      ...baseInput,
      playWritingReferences: [attachment],
    });
    const contextPackage = createBaselineNovelAgentContextPackage({
      request: '/写下一章 请继续',
      workspace: baseInput.workspace,
      createdAt: '2026-07-16T00:00:00.000Z',
      playWritingReferences: [attachment],
    });

    expect(assembly.context).toContainEqual({
      kind: 'selected',
      title: attachment.title,
      content: attachment.content,
    });
    expect(contextPackage?.selected).toContainEqual(expect.objectContaining({
      sourceId: 'playWritingReference',
      path: attachment.path,
    }));
    expect(contextPackage?.trace).toContainEqual(expect.objectContaining({
      type: 'userSelectedContext',
      sourceId: 'playWritingReference',
      outcome: 'selected',
    }));
    expect(contextPackage?.ruleStack).toContainEqual(expect.objectContaining({
      id: 'play-writing-reference-boundary',
      sourceId: 'playWritingReference',
    }));

    const withoutExplicitAttachment = assembleNovelAgentMessages(baseInput);
    expect(withoutExplicitAttachment.context.some((item) =>
      item.title === attachment.title)).toBe(false);
  });

  it('traces every explicitly selected Play attachment while keeping one noncanonical rule boundary', () => {
    const attachments = [
      {
        attachmentId: 'writing-ref-1',
        sessionId: 'play-1',
        title: 'Play outcome · gate',
        path: '.workspace/writing-references/writing-ref-1.yaml',
        content: 'The selected branch leaves the gate sealed.',
      },
      {
        attachmentId: 'writing-ref-2',
        sessionId: 'play-2',
        title: 'Play outcome · porter',
        path: '.workspace/writing-references/writing-ref-2.yaml',
        content: 'The selected branch leaves the porter suspicious.',
      },
    ];
    const assembly = assembleNovelAgentMessages({
      ...baseInput,
      playWritingReferences: attachments,
    });
    const runtimeInput = createRuntimeTurnInput({
      ...baseInput,
      playWritingReferences: attachments,
    });
    const contextPackage = createBaselineNovelAgentContextPackage({
      request: '/写下一章 请继续',
      workspace: baseInput.workspace,
      createdAt: '2026-07-16T00:00:00.000Z',
      playWritingReferences: attachments,
    });

    expect(assembly.context.filter((item) =>
      attachments.some((attachment) => attachment.title === item.title)))
      .toEqual(attachments.map((attachment) => ({
        kind: 'selected',
        title: attachment.title,
        content: attachment.content,
      })));
    expect(runtimeInput.context?.filter((item) =>
      item.kind === 'selected' && item.title.startsWith('Play outcome')))
      .toHaveLength(2);
    expect(contextPackage?.selected.filter((source) =>
      source.sourceId === 'playWritingReference'))
      .toEqual(attachments.map((attachment) => expect.objectContaining({
        path: attachment.path,
        title: attachment.title,
        semanticBoundary: 'compressible',
      })));
    expect(contextPackage?.trace.filter((entry) =>
      entry.sourceId === 'playWritingReference'))
      .toEqual(attachments.map((attachment) => expect.objectContaining({
        type: 'userSelectedContext',
        outcome: 'selected',
        path: attachment.path,
        reason: expect.stringContaining(attachment.attachmentId),
      })));
    expect(contextPackage?.ruleStack.filter((rule) =>
      rule.id === 'play-writing-reference-boundary'))
      .toEqual([
        expect.objectContaining({
          label: expect.stringContaining('noncanonical'),
          sourceId: 'playWritingReference',
        }),
      ]);
    expect(contextPackage?.ruleStack).toContainEqual(expect.objectContaining({
      id: 'human-approval',
      label: expect.stringContaining('PendingAction'),
    }));
    expect(JSON.stringify(contextPackage?.minimalMemory))
      .not.toContain('gate sealed');
  });

  it('does not discover active Play writing references without request-local inputs', () => {
    const contextPackage = createBaselineNovelAgentContextPackage({
      request: '/写下一章 请继续',
      workspace: baseInput.workspace,
      createdAt: '2026-07-16T00:00:00.000Z',
    });
    const runtimeInput = createRuntimeTurnInput(baseInput);

    expect(contextPackage?.selected.some((source) =>
      source.sourceId === 'playWritingReference')).toBe(false);
    expect(contextPackage?.trace.some((entry) =>
      entry.sourceId === 'playWritingReference')).toBe(false);
    expect(contextPackage?.ruleStack.some((rule) =>
      rule.id === 'play-writing-reference-boundary')).toBe(false);
    expect(runtimeInput.context?.some((item) =>
      item.title.startsWith('Play outcome'))).toBe(false);
  });
});
