import { describe, expect, it } from 'vite-plus/test';
import { createRuntimeTurnInput } from '@oh-awesome-novel/agent';
import { PriorityRuntimeContextBuilder } from '@oh-awesome-novel/runtime';
describe('frozen Play prefix at the runtime boundary', () => {
  it('keeps all five actual system messages identical while context and user input change', () => {
    const systems: string[] = [];
    for (let n = 0; n < 5; n++) {
      const turn = createRuntimeTurnInput({ request: `turn ${n}`, frozenSystemPrompt: 'permanent constitution and roles', capability: 'novel.play_scene', workspace: { workspaceRoot: '/test', state: `hp: ${n}`, projectionFingerprint: `projection-${n}` }, skill: { name: 'varying', system: `dynamic ${n}` } });
      const messages = new PriorityRuntimeContextBuilder().build({ context: turn.context, skill: turn.skill, doneMessages: [], curMessages: turn.messages });
      systems.push(messages.filter(m => m.role === 'system').map(m => m.content).join('\n'));
      expect(messages.at(-1)?.content).toContain(`hp: ${n}`);
    }
    expect(new Set(systems)).toEqual(new Set(['permanent constitution and roles']));
  });
  it('does not override canonical writing safeguards', () => {
    const turn = createRuntimeTurnInput({ request: 'write', frozenSystemPrompt: 'untrusted override', capability: 'novel.write_chapter', workspace: { workspaceRoot: '/test' } });
    expect(turn.messages[0].content).not.toBe('untrusted override');
  });
});
