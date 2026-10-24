import { describe, expect, it } from 'vitest';
import {
  createPlaySessionDraft, formatPlayTurnTail, formatPlayWorldRefereePrompt, formatPlayWorldRefereeTurnContext,
  getPlayFrozenSystemPrompt, PLAY_REFEREE_PROTOCOL_MARKER, settlePlayWorldRefereeResponse,
} from '@oh-awesome-novel/core';

function played(turns: number) {
  let s = createPlaySessionDraft({ id: 'cache-test', title: 'Cache', sceneStart: 'Gate', characters: ['阿明'] });
  for (let n = 0; n < turns; n++) s = settlePlayWorldRefereeResponse({ session: s, actionKind: 'do', userText: `action ${n}`, refereeResponse: `At gate ${n}.\n\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [], stateDelta: { step: n }, observations: [], suggestedActions: [] })}\n\`\`\`` });
  return s;
}

describe('Play frozen prefix and per-turn tail', () => {
  it('freezes the referee protocol once and keeps rules and history out of the tail', () => {
    const s = played(3);
    const prefix = getPlayFrozenSystemPrompt(s);
    expect(prefix).toContain(PLAY_REFEREE_PROTOCOL_MARKER);
    expect(prefix).toContain('Output protocol:');
    const context = formatPlayWorldRefereeTurnContext(s, { actionKind: 'wait', timeAdvance: { amount: 2, unit: 'hour' } });
    expect(context.state).toContain('Current Play-local state:');
    expect(context.state).not.toContain('Output protocol:');
    expect(context.state).not.toContain('Run a roleplay sandbox turn');
    expect(context.state).not.toContain('Recent committed transcript');
    expect(context.state).not.toContain('At gate 1.');
    expect(context.requirements).toContain('requested elapsed PT2H');
    expect(context.requirements).toContain('This is a typed wait.');
    const tail = formatPlayTurnTail(s, { world: 'lore', ...context }, 'look');
    expect(tail).toMatch(/<世界设定>\nlore\n<\/世界设定>\n<当前状态>[\s\S]*<\/当前状态>\n<本轮回合要求>[\s\S]*<\/本轮回合要求>\n<玩家输入>look<\/玩家输入>\n<本轮提醒>/u);
  });

  it('still sends the rules in the tail for a prefix frozen before the protocol block existed', () => {
    const s = played(1);
    s.metadataExtensions.frozenSystemPrompt = '# Play world referee\nlegacy prefix';
    const context = formatPlayWorldRefereeTurnContext(s);
    expect(context.state).toContain('Output protocol:');
    expect(context.state).toContain('Run a roleplay sandbox turn');
    expect(context.state).not.toContain('Recent committed transcript');
  });

  it('keeps the self-contained referee prompt complete for non-frozen callers', () => {
    const prompt = formatPlayWorldRefereePrompt(played(2));
    expect(prompt).toContain('Recent committed transcript');
    expect(prompt).toContain('Output protocol:');
  });
});
