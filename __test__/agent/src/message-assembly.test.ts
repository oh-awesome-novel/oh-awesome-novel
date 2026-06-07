import { describe, expect, it } from 'vitest';

import {
  assembleNovelAgentMessages,
  createNovelAgentSystemPrompt,
  createRuntimeTurnInput,
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

  it('creates Runtime turn input without tools or filesystem access', () => {
    const turnInput = createRuntimeTurnInput(baseInput);

    expect(turnInput.messages?.at(0)).toMatchObject({
      role: 'system',
    });
    expect(turnInput.context?.map((item) => item.kind)).toContain('state');
    expect(turnInput).not.toHaveProperty('tools');
  });
});
