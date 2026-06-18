import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface NovelCopilotQuickCommand {
  id: string;
  label: string;
  slashCommand: string;
  prompt: string;
}

export interface NovelCopilotSkill {
  name: string;
  system: string;
  allowedTools: string[];
  quickCommands: NovelCopilotQuickCommand[];
}

export interface LoadNovelCopilotSkillOptions {
  workspaceRoot: string;
}

const NOVEL_COPILOT_SKILL_FILE = join('.oan', 'skills', 'novel-copilot.md');

export const NOVEL_COPILOT_ALLOWED_TOOLS = [
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
] as const;

export const NOVEL_COPILOT_QUICK_COMMANDS: NovelCopilotQuickCommand[] = [
  {
    id: 'character.generateCard',
    label: '生成角色卡',
    slashCommand: '/生成角色卡',
    prompt: '请先检查已有角色，再根据我的描述生成或更新角色卡。涉及写入时只创建 PendingAction。',
  },
  {
    id: 'chapter.planNext',
    label: '规划下一章',
    slashCommand: '/规划下一章',
    prompt: '请读取工作流、宪法、摘要、状态、时间线和伏笔，规划下一章的目标、场景序列、角色出场、钩子和结尾变化。',
  },
  {
    id: 'chapter.writeNext',
    label: '写下一章',
    slashCommand: '/写下一章',
    prompt: '请基于当前上下文写下一章草稿。必须先读取必要角色卡和前章内容，正文只能通过 chapter.createDraft 创建 PendingAction。',
  },
  {
    id: 'chapter.settle',
    label: '整理本章',
    slashCommand: '/整理本章',
    prompt: '请读取目标章节并整理本章，生成章节摘要、角色状态、时间线和伏笔变更的 PendingAction。',
  },
  {
    id: 'chapter.review',
    label: '审稿',
    slashCommand: '/审稿',
    prompt: '请审查当前章节的连续性、人设、节奏、伏笔和 AI 味。除非我要求改写，否则只给审稿意见。',
  },
  {
    id: 'state.update',
    label: '更新状态',
    slashCommand: '/更新状态',
    prompt: '请根据我提供的材料更新状态。先读取已有 state 和相关角色卡，写入只能通过 state.set PendingAction。',
  },
  {
    id: 'foreshadow.plan',
    label: '补伏笔',
    slashCommand: '/补伏笔',
    prompt: '请读取已有伏笔、摘要、时间线和相关章节，设计可埋设或推进的伏笔。需要写入时只创建 PendingAction。',
  },
  {
    id: 'chapter.deAi',
    label: '去AI味',
    slashCommand: '/去AI味',
    prompt: '请在不改变剧情事实的前提下去除 AI 味。需要替换正文时只通过 chapter.createDraft 创建 PendingAction。',
  },
];

export const createDefaultNovelCopilotSkill = (
  workspaceSystemOverride?: string,
): NovelCopilotSkill => ({
  name: 'novel-copilot',
  allowedTools: [...NOVEL_COPILOT_ALLOWED_TOOLS],
  quickCommands: NOVEL_COPILOT_QUICK_COMMANDS,
  system: [
    '# Novel Copilot Skill',
    '',
    'You are the Novel Agent Copilot for a filesystem-first long-form novel workspace.',
    'You operate as one Aider-style tool loop, not as a multi-agent platform.',
    '',
    '## Workflow',
    '',
    'Follow these phases on every turn: observe -> plan -> draft/propose -> verify -> settle.',
    '',
    '## Observe',
    '',
    'Before making writing decisions, read the minimum relevant filesystem context.',
    'Always prefer workflow.get, constitution.get, summary.get, state.get, timeline.list, and foreshadow.list when the task affects novel continuity.',
    'Use character.list and character.get before changing character voice, motivation, relationship, state, or role.',
    'Use world.search before relying on world rules, factions, locations, power systems, creatures, or setting facts.',
    'Use chapter.get when continuing, reviewing, settling, or rewriting chapter text.',
    '',
    '## Plan',
    '',
    'Briefly explain what you will do and which domains or files you expect to touch before calling write-intent tools.',
    'Do not reveal hidden chain of thought.',
    '',
    '## Draft Or Propose',
    '',
    'Never write real target files directly.',
    'All file changes must be proposed as PendingActions through write-intent tools.',
    'Use chapter.createDraft for chapter prose, summary.generateChapter for summaries, state.set for state, timeline.add for plot events, foreshadow.create for hooks, and character.updatePersonality for scoped character-card updates.',
    'Do not claim a file has changed until the user accepts the PendingAction.',
    '',
    '## Verify',
    '',
    'Before finishing, check that required context was read, proposed changes match the user-facing plan, and risky ambiguity is reported.',
    '',
    '## Settle',
    '',
    'When a chapter is completed, reviewed, or explicitly settled, propose a settlement bundle: chapter summary, changed character state, timeline events, and foreshadow updates.',
    'If evidence is insufficient, say what could not be determined instead of inventing facts.',
    '',
    workspaceSystemOverride
      ? `## Workspace Skill Extension\n\n${workspaceSystemOverride}`
      : '',
  ].filter(Boolean).join('\n'),
});

export async function loadNovelCopilotSkill(
  options: LoadNovelCopilotSkillOptions,
): Promise<NovelCopilotSkill> {
  const workspaceOverride = await readWorkspaceSkillOverride(options.workspaceRoot);

  return createDefaultNovelCopilotSkill(workspaceOverride);
}

async function readWorkspaceSkillOverride(
  workspaceRoot: string,
): Promise<string | undefined> {
  try {
    return await readFile(join(workspaceRoot, NOVEL_COPILOT_SKILL_FILE), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}
