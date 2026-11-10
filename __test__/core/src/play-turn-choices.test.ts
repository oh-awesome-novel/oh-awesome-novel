import { describe, expect, it } from 'vite-plus/test';

import {
  PLAY_TURN_CHOICE_RULE,
  createPlaySessionDraft,
  formatPlayWorldRefereeTurnContext,
  getPlayFrozenSystemPrompt,
  parsePlayTurnChoice,
  parsePlayTurnChoices,
} from '@oh-awesome-novel/core';

describe('Play turn choice options', () => {
  it('reads each type tag into a typed action and hides the tag', () => {
    expect(parsePlayTurnChoice('[say] 问她昨晚去了哪里')).toEqual({ text: '问她昨晚去了哪里', actionKind: 'say', typed: true });
    expect(parsePlayTurnChoice('[look] 检查门锁')).toMatchObject({ text: '检查门锁', actionKind: 'look' });
    expect(parsePlayTurnChoice('[move] 退到走廊')).toMatchObject({ text: '退到走廊', actionKind: 'move' });
    expect(parsePlayTurnChoice('[do] 把信塞回抽屉')).toMatchObject({ text: '把信塞回抽屉', actionKind: 'do' });
    expect(parsePlayTurnChoice('【说】先道歉')).toEqual({ text: '先道歉', actionKind: 'say', typed: true });
    expect(parsePlayTurnChoice('  [ SAY ]  hello ')).toEqual({ text: 'hello', actionKind: 'say', typed: true });
  });

  it('takes a wait duration only when the tag states a valid one', () => {
    expect(parsePlayTurnChoice('[wait 30m] 等她冷静下来')).toEqual({
      text: '等她冷静下来', actionKind: 'wait', timeAdvance: { amount: 30, unit: 'minute' }, typed: true,
    });
    expect(parsePlayTurnChoice('[wait 2h] 守在门外').timeAdvance).toEqual({ amount: 2, unit: 'hour' });
    expect(parsePlayTurnChoice('[等 1天] 等消息').timeAdvance).toEqual({ amount: 1, unit: 'day' });
    // No stated duration, zero, or more than a year: the author picks the duration.
    for (const value of ['[wait] 等到天亮', '[wait 0m] 等一下', '[wait 400d] 等很久', '[wait 999999h] 等']) {
      const choice = parsePlayTurnChoice(value);
      expect(choice.actionKind).toBe('wait');
      expect(choice).not.toHaveProperty('timeAdvance');
    }
  });

  it('falls back to the wording for untagged, unknown or malformed tags', () => {
    expect(parsePlayTurnChoice('等到天亮')).toEqual({ text: '等到天亮', actionKind: 'wait', typed: false });
    expect(parsePlayTurnChoice('询问店主')).toEqual({ text: '询问店主', actionKind: 'say', typed: false });
    expect(parsePlayTurnChoice('推开门')).toEqual({ text: '推开门', actionKind: 'do', typed: false });
    // Unknown kind, a tag with no action, and a duration on a non-wait tag keep their text verbatim.
    expect(parsePlayTurnChoice('[run] 逃跑')).toEqual({ text: '[run] 逃跑', actionKind: 'do', typed: false });
    expect(parsePlayTurnChoice('[say]')).toEqual({ text: '[say]', actionKind: 'do', typed: false });
    expect(parsePlayTurnChoice('[say 5m] 开口')).toEqual({ text: '[say 5m] 开口', actionKind: 'do', typed: false });
    expect(parsePlayTurnChoice(`[do] ${'长'.repeat(5000)}`).text).toHaveLength(5000);
  });

  it('drops blank entries from a list', () => {
    expect(parsePlayTurnChoices(['[say] 开口', '   ', '转身离开']).map(choice => choice.text)).toEqual(['开口', '转身离开']);
  });

  it('asks for options in the turn tail and never in the frozen prefix', () => {
    const session = createPlaySessionDraft({
      id: 'play-choices',
      title: 'Choices',
      sceneStart: '雨夜的渡口。',
      characters: ['林雾'],
      userPersona: 'traveller',
      createdAt: '2026-11-10T00:00:00.000Z',
    });

    expect(formatPlayWorldRefereeTurnContext(session, { actionKind: 'do' }).requirements).toContain(PLAY_TURN_CHOICE_RULE);
    expect(getPlayFrozenSystemPrompt(session)).not.toContain('Choice options');
  });
});
