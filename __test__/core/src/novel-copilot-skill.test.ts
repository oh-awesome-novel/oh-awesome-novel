import { describe, expect, it } from 'vitest';

import {
  NOVEL_COPILOT_ALLOWED_TOOLS,
  NOVEL_COPILOT_CAPABILITIES,
  NOVEL_COPILOT_QUICK_COMMANDS,
  createDefaultNovelCopilotSkill,
  type NovelCopilotQuickCommandId,
} from '@oh-awesome-novel/core';

const expectedQuickCommandIds: NovelCopilotQuickCommandId[] = [
  'character.generateCard',
  'outline.plan',
  'volume.planNext',
  'chapter.planNext',
  'chapter.writeNext',
  'chapter.settle',
  'chapter.review',
  'state.update',
  'foreshadow.plan',
  'chapter.deAi',
];

const implementedToolNames = [
  'character.list',
  'character.get',
  'world.search',
  'chapter.get',
  'state.get',
  'timeline.list',
  'foreshadow.list',
  'summary.get',
  'constitution.get',
  'workflow.get',
  'chapter.createDraft',
  'character.updatePersonality',
  'state.set',
  'timeline.add',
  'foreshadow.create',
  'summary.generateChapter',
];

describe('novel copilot skill contract', () => {
  it('registers vNext quick commands with capability ids', () => {
    expect(NOVEL_COPILOT_QUICK_COMMANDS.map((command) => command.id)).toEqual(
      expectedQuickCommandIds,
    );

    const slashCommands = NOVEL_COPILOT_QUICK_COMMANDS.map(
      (command) => command.slashCommand,
    );

    expect(slashCommands).toContain('/规划大纲');
    expect(slashCommands).toContain('/规划下一卷');
    expect(
      NOVEL_COPILOT_QUICK_COMMANDS.every((command) => command.capabilityId),
    ).toBe(true);
  });

  it('exposes planned capability metadata without turning it into tools', () => {
    expect(NOVEL_COPILOT_CAPABILITIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'novel.play_scene',
          status: 'planned',
          mode: 'play',
        }),
        expect.objectContaining({
          id: 'novel.import_tavern_character',
          status: 'planned',
          mode: 'reference',
        }),
        expect.objectContaining({
          id: 'novel.deconstruct_reference',
          status: 'planned',
          mode: 'reference',
        }),
      ]),
    );

    expect(NOVEL_COPILOT_ALLOWED_TOOLS).not.toContain('novel.play_scene');
    expect(NOVEL_COPILOT_ALLOWED_TOOLS).not.toContain(
      'novel.import_tavern_character',
    );
    expect(NOVEL_COPILOT_ALLOWED_TOOLS).not.toContain(
      'novel.deconstruct_reference',
    );
  });

  it('keeps allowed tools limited to implemented read and write-intent tools', () => {
    expect([...NOVEL_COPILOT_ALLOWED_TOOLS]).toEqual(implementedToolNames);
  });

  it('requires PRE_WRITE_CHECK before chapter drafting', () => {
    const skill = createDefaultNovelCopilotSkill();
    const writeNextCommand = skill.quickCommands.find(
      (command) => command.id === 'chapter.writeNext',
    );

    expect(writeNextCommand?.prompt).toContain('PRE_WRITE_CHECK');
    expect(skill.system).toContain('PRE_WRITE_CHECK');
    expect(skill.system).toContain('chapter.createDraft');
    expect(writeNextCommand?.prompt).not.toContain('precommit');
    expect(writeNextCommand?.prompt).not.toContain('postcommit');
  });

  it('keeps heavy outline structure out of ordinary chapter planning', () => {
    const skill = createDefaultNovelCopilotSkill();
    const planNextCommand = skill.quickCommands.find(
      (command) => command.id === 'chapter.planNext',
    );
    const volumeCommand = skill.quickCommands.find(
      (command) => command.id === 'volume.planNext',
    );

    expect(planNextCommand?.prompt).toContain('轻量本章契约');
    expect(planNextCommand?.prompt).not.toContain('CBN/CPNs/CEN');
    expect(volumeCommand?.prompt).toContain('CBN/CPNs/CEN');
    expect(skill.system).toContain('Do not impose those heavy fields');
    expect(skill.system).toContain('Planning outputs are assistant-visible artifacts');
  });

  it('makes review report-only and separates it from settlement', () => {
    const skill = createDefaultNovelCopilotSkill();
    const reviewCommand = skill.quickCommands.find(
      (command) => command.id === 'chapter.review',
    );

    expect(reviewCommand?.prompt).toContain('默认只输出 report-only');
    expect(reviewCommand?.prompt).toContain('不要隐式改写、整理本章或更新状态');
    expect(skill.system).toContain('/审稿 is report-only by default.');
    expect(skill.system).toContain('A review report is not settlement.');
  });

  it('protects plot facts when reducing AI-like prose', () => {
    const skill = createDefaultNovelCopilotSkill();
    const deAiCommand = skill.quickCommands.find(
      (command) => command.id === 'chapter.deAi',
    );

    expect(deAiCommand?.prompt).toContain('不改变剧情事实');
    expect(skill.system).toContain('/去AI味 is expression-level revision');
    expect(skill.system).toContain('Do not change plot facts');
    expect(skill.system).toContain('Do not change plot facts, chronology');
    expect(skill.system).toContain('hooks, character traits, key information');
  });

  it('returns fresh command and capability arrays for each default skill', () => {
    const first = createDefaultNovelCopilotSkill();
    const second = createDefaultNovelCopilotSkill();

    expect(first.quickCommands).not.toBe(second.quickCommands);
    expect(first.quickCommands[0]).not.toBe(second.quickCommands[0]);
    expect(first.capabilities).not.toBe(second.capabilities);
    expect(first.capabilities[0]).not.toBe(second.capabilities[0]);
  });
});
