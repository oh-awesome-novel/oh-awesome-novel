import { describe, expect, it } from 'vitest';

import {
  assembleNovelAgentMessages,
  createBaselineNovelAgentContextPackage,
  createNovelAgentSystemPrompt,
  createRuntimeTurnInput,
  inferNovelAgentCapability,
} from '@oh-awesome-novel/agent';
import { PriorityRuntimeContextBuilder } from '@oh-awesome-novel/runtime';
import type { NovelCopilotCapabilityId } from '@oh-awesome-novel/agent';

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
  it('keeps the no-reminder assembly byte-for-byte unchanged', () => {
    const baseline = assembleNovelAgentMessages({
      ...baseInput,
      capability: 'novel.write_chapter',
      skill: {
        name: 'novel-copilot',
        system: 'Shared skill prompt.',
      },
    });
    const disabled = assembleNovelAgentMessages({
      ...baseInput,
      capability: 'novel.write_chapter',
      skill: {
        name: 'novel-copilot',
        system: 'Shared skill prompt.',
      },
      writingProfile: profileWithReminders([]),
    });

    expect(disabled).toEqual(baseline);
  });

  it('assembles a golden commercial review prompt with one shared skill', () => {
    const assembly = assembleNovelAgentMessages({
      request: '/审稿 第一章',
      workspace: { workspaceRoot: '/novel' },
      capability: 'novel.review_chapter',
      skill: {
        name: 'novel-copilot',
        system: 'SHARED_SKILL_BASELINE',
      },
      writingProfile: profileWithReminders(['originality', 'aiVoice']),
      selectedContext: [{
        kind: 'selected',
        title: 'Accepted Chapter',
        content: 'CURRENT_PROJECT_TRUTH',
      }],
    });
    const messages = new PriorityRuntimeContextBuilder().build({
      doneMessages: [],
      curMessages: assembly.messages,
      context: assembly.context,
      skill: assembly.skill,
    });
    const modelSystem = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    expect(modelSystem.match(/SHARED_SKILL_BASELINE/gu)).toHaveLength(1);
    expect(modelSystem).toMatchInlineSnapshot(`
      "# Skill Prompt: novel-copilot

      SHARED_SKILL_BASELINE

      # Writing Reminders: Active fixed fragments

      Apply only the following fixed, non-blocking Writing reminders.
      They do not authorize direct writes, do not change PendingAction approval, and do not add new context sources.

      - Originality reminder: Keep the premise execution, scene progression, phrasing, and imagery independently expressed and meaningfully differentiated. Do not copy identifiable wording, proprietary names, or a reference work scene sequence. This is a non-blocking writing reminder, not a similarity verdict.
      - AI-voice reminder: During review or requested revision, identify mechanical sentence patterns, empty summaries, generic transitions, repetitive abstractions, and excessively symmetrical phrasing. Report concrete, non-blocking suggestions and do not rewrite prose unless the user explicitly requests a revision.

      # Selected Context: Accepted Chapter

      CURRENT_PROJECT_TRUTH

      You are the oh-awesome-novel Copilot for a filesystem-first novel workspace.
      Use tools to inspect or edit the active workspace.
      Do not operate outside the active workspace.
      Do not target hidden files or hidden directories.
      Prefer structured workspace context over broad file loading.
      Workspace root: /novel
      Active skill: novel-copilot"
    `);
  });

  it('maps each fixed reminder only to the frozen capability table', () => {
    const mappings: Record<string, NovelCopilotCapabilityId[]> = {
      originality: [
        'novel.plan_outline',
        'novel.plan_volume',
        'novel.plan_chapter',
        'novel.write_chapter',
        'novel.review_chapter',
      ],
      aiVoice: [
        'novel.review_chapter',
        'novel.revise_chapter',
      ],
      characterConsistency: [
        'novel.plan_chapter',
        'novel.write_chapter',
        'novel.review_chapter',
        'novel.generate_character_card',
        'novel.settle_chapter',
      ],
      adaptationFreedom: [
        'novel.plan_outline',
        'novel.plan_volume',
        'novel.plan_chapter',
        'novel.generate_character_card',
      ],
    };
    const fragments: Record<string, string> = {
      originality: 'Originality reminder:',
      aiVoice: 'AI-voice reminder:',
      characterConsistency: 'Character-consistency reminder:',
      adaptationFreedom: 'Adaptation-freedom reminder:',
    };
    const capabilities: NovelCopilotCapabilityId[] = [
      'novel.generate_character_card',
      'novel.plan_outline',
      'novel.plan_volume',
      'novel.plan_chapter',
      'novel.write_chapter',
      'novel.review_chapter',
      'novel.revise_chapter',
      'novel.settle_chapter',
      'novel.update_state',
      'novel.plan_foreshadow',
      'novel.de_ai',
      'novel.play_scene',
      'novel.import_tavern_character',
      'novel.deconstruct_reference',
    ];

    for (const [reminder, allowed] of Object.entries(mappings)) {
      const profile = profileWithReminders([reminder]);
      for (const capability of capabilities) {
        const assembly = assembleNovelAgentMessages({
          ...baseInput,
          capability,
          writingProfile: profile,
        });
        const reminderText = assembly.context
          .find((item) => item.kind === 'reminder')?.content;
        expect(Boolean(reminderText?.includes(fragments[reminder]!)))
          .toBe(allowed.includes(capability));
      }
    }
  });

  it('injects no reminder when capability inference fails', () => {
    const assembly = assembleNovelAgentMessages({
      ...baseInput,
      request: '随便聊聊',
      writingProfile: profileWithReminders([
        'originality',
        'aiVoice',
        'characterConsistency',
        'adaptationFreedom',
      ]),
    });

    expect(assembly.context.some((item) => item.kind === 'reminder')).toBe(false);
  });

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

  it('traces entry-level distilled references and preserves protected warnings', () => {
    const contextPackage = createBaselineNovelAgentContextPackage({
      request: '/写下一章 请继续',
      workspace: baseInput.workspace,
      createdAt: '2026-07-26T00:00:00.000Z',
      referenceSelection: {
        tokenBudget: 1_000,
        maxReferences: 2,
        maxEntries: 4,
        usedTokens: 80,
        originalSourceRead: false,
        noCopyWarnings: ['Do not copy source expression.', 'Shared warning.'],
        differentiationWarnings: ['Shared warning.', 'Change premise and causality.'],
        included: [{
          id: 'distilled-entry-1',
          referenceId: 'reference-1',
          referenceTitle: 'Reference One',
          entryTitle: 'Pressure turn',
          category: 'pacing',
          path: 'examples/references/reference-1/distilled/pacing.md',
          tags: ['pressure'],
          capabilityIds: ['novel.write_chapter'],
          reason: 'entry supports capability novel.write_chapter',
          reasonCode: 'capabilityMatch',
          budgetLayer: 'L2',
          semanticBoundary: 'compressible',
          estimatedTokens: 80,
          content: 'A transformed technique note.',
        }],
        omitted: [{
          scope: 'entry',
          referenceId: 'reference-1',
          referenceTitle: 'Reference One',
          entryId: 'distilled-entry-2',
          entryTitle: 'Unrelated hook',
          category: 'hooks',
          reason: 'entry does not match the current task',
          budgetLayer: 'L2',
          deconstructionStatus: 'completed',
          contextEligible: false,
          reasonCode: 'taskMismatch',
          estimatedTokens: 60,
        }],
      },
    });

    expect(contextPackage?.selected).toContainEqual(expect.objectContaining({
      sourceId: 'referenceDistilled',
      title: 'Reference One / Pressure turn',
      path: 'examples/references/reference-1/distilled/pacing.md',
    }));
    expect(contextPackage?.omitted).toContainEqual(expect.objectContaining({
      sourceId: 'referenceDistilled',
      title: 'Reference One / Unrelated hook',
    }));
    expect(contextPackage?.trace).toContainEqual(expect.objectContaining({
      sourceId: 'referenceDistilled',
      outcome: 'selected',
      path: 'examples/references/reference-1/distilled/pacing.md',
    }));
    expect(contextPackage?.minimalMemory.recentFacts).toEqual(expect.arrayContaining([
      'Do not copy source expression.',
      'Shared warning.',
      'Change premise and causality.',
    ]));
    expect(contextPackage?.minimalMemory.recentFacts.filter((item) =>
      item === 'Shared warning.')).toHaveLength(1);
    expect(contextPackage?.minimalMemory.styleNotes).toEqual([
      'Change premise and causality.',
      'Do not copy source expression.',
      'Shared warning.',
    ]);
    expect(contextPackage?.ruleStack).toContainEqual(expect.objectContaining({
      id: 'reference-distilled-boundary',
      sourceId: 'referenceDistilled',
      label: expect.stringContaining('untrusted'),
    }));
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

function profileWithReminders(
  reminders: string[],
) {
  return {
    version: 1 as const,
    id: 'testProfile',
    displayName: 'Test Profile',
    description: 'Test fixed reminder combination.',
    deconstruction: { outputs: ['techniques'] as Array<'techniques'> },
    writingReminders: {
      originality: reminders.includes('originality'),
      aiVoice: reminders.includes('aiVoice'),
      characterConsistency: reminders.includes('characterConsistency'),
      adaptationFreedom: reminders.includes('adaptationFreedom'),
    },
  };
}
