import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NOVEL_COPILOT_ALLOWED_TOOLS,
  NOVEL_COPILOT_CAPABILITIES,
  NOVEL_COPILOT_QUICK_COMMANDS,
  NOVEL_COPILOT_SANDBOX_EDIT_CAPABILITIES,
  createNovelCopilotSandboxProposalContract,
  createDefaultNovelCopilotSkill,
  loadNovelCopilotSkill,
  parseNovelCopilotSandboxProposalContract,
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
  'bash',
  'readFile',
  'writeFile',
  'workspace.previewChanges',
  'workspace.proposeChanges',
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

  it('exposes product capability metadata without turning it into tools', () => {
    expect(NOVEL_COPILOT_CAPABILITIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'novel.play_scene',
          status: 'available',
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

  it('keeps allowed tools limited to projected reads and sandbox editing', () => {
    expect([...NOVEL_COPILOT_ALLOWED_TOOLS]).toEqual(implementedToolNames);
  });

  it('requires PRE_WRITE_CHECK before chapter drafting', () => {
    const skill = createDefaultNovelCopilotSkill();
    const writeNextCommand = skill.quickCommands.find(
      (command) => command.id === 'chapter.writeNext',
    );

    expect(writeNextCommand?.prompt).toContain('PRE_WRITE_CHECK');
    expect(skill.system).toContain('PRE_WRITE_CHECK');
    expect(skill.system).toContain('fixed in-memory projection');
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
    expect(skill.system).toContain('Planning remains assistant or session output');
  });

  it('makes review report-only and separates it from settlement', () => {
    const skill = createDefaultNovelCopilotSkill();
    const reviewCommand = skill.quickCommands.find(
      (command) => command.id === 'chapter.review',
    );

    expect(reviewCommand?.prompt).toContain('默认只输出 report-only');
    expect(reviewCommand?.prompt).toContain('默认只输出 report-only');
    expect(skill.system).toContain('Review is report-only by default.');
  });

  it('protects plot facts when reducing AI-like prose', () => {
    const skill = createDefaultNovelCopilotSkill();
    const deAiCommand = skill.quickCommands.find(
      (command) => command.id === 'chapter.deAi',
    );

    expect(deAiCommand?.prompt).toContain('不改变剧情事实');
    expect(skill.system).toContain('De-AI work may change expression');
    expect(skill.system).toContain('never plot facts, chronology');
  });

  it('returns fresh command and capability arrays for each default skill', () => {
    const first = createDefaultNovelCopilotSkill();
    const second = createDefaultNovelCopilotSkill();

    expect(first.quickCommands).not.toBe(second.quickCommands);
    expect(first.quickCommands[0]).not.toBe(second.quickCommands[0]);
    expect(first.capabilities).not.toBe(second.capabilities);
    expect(first.capabilities[0]).not.toBe(second.capabilities[0]);
  });

  it('uses the sandbox contract as the only default skill', () => {
    const skill = createDefaultNovelCopilotSkill();

    expect(skill.allowedTools).toEqual([...NOVEL_COPILOT_ALLOWED_TOOLS]);
    expect(skill.allowedTools).toEqual(expect.arrayContaining([
      'bash',
      'readFile',
      'writeFile',
      'workspace.previewChanges',
      'workspace.proposeChanges',
    ]));
    expect(skill.system).toContain('fixed in-memory projection');
    expect(skill.system).toContain('/workspace');
    expect(skill.system).toContain('workspace.previewChanges');
    expect(skill.system).toContain('workspace.proposeChanges');
    expect(skill.system).toContain('Human Accept');
    expect(
      skill.quickCommands.find((command) => command.id === 'chapter.writeNext')?.prompt,
    ).toContain('固定内存工作区');
  });

  it('creates a host-selected, path-bounded sandbox proposal contract', () => {
    expect(NOVEL_COPILOT_SANDBOX_EDIT_CAPABILITIES).toContain('chapter.edit');
    const contract = createNovelCopilotSandboxProposalContract({
      capability: 'chapter.edit',
      targetPaths: ['chapters/0001/0004.md'],
    });

    expect(contract).toEqual({
      environment: 'fixed-in-memory-workspace',
      capability: 'chapter.edit',
      targetPaths: ['chapters/0001/0004.md'],
      previewTool: 'workspace.previewChanges',
      proposalTool: 'workspace.proposeChanges',
      canonicalWriteBoundary: 'human-accept',
    });
    expect(() => createNovelCopilotSandboxProposalContract({
      capability: 'chapter.edit',
      targetPaths: ['../escape.md'],
    })).toThrow('workspace-relative POSIX');
    expect(() => createNovelCopilotSandboxProposalContract({
      capability: 'chapter.edit',
      targetPaths: ['chapters/a.md', 'chapters/a.md'],
    })).toThrow('unique');
    expect(parseNovelCopilotSandboxProposalContract(contract)).toEqual(contract);
    expect(() => parseNovelCopilotSandboxProposalContract({
      ...contract,
      proposalTool: 'workspace.invalidProposal',
    })).toThrow('unsupported boundary');
    expect(() => parseNovelCopilotSandboxProposalContract({
      ...contract,
      extra: true,
    })).toThrow('unknown or missing fields');
  });

  it('loads the sandbox skill through the default loader', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-sandbox-skill-'));

    try {
      await mkdir(join(workspaceRoot, '.oan', 'skills'), { recursive: true });
      await writeFile(
        join(workspaceRoot, '.oan', 'skills', 'novel-copilot.md'),
        'Prefer terse scene summaries.',
        'utf-8',
      );

      const skill = await loadNovelCopilotSkill({ workspaceRoot });

      expect(skill.name).toBe('novel-copilot');
      expect(skill.system).toContain('Prefer terse scene summaries.');
      expect(skill.allowedTools).toContain('workspace.proposeChanges');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
