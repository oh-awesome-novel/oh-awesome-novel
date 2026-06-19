import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const NOVEL_COPILOT_CAPABILITY_IDS = [
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
] as const;

export type NovelCopilotCapabilityId = typeof NOVEL_COPILOT_CAPABILITY_IDS[number];

export type NovelCopilotCapabilityMode =
  | 'planning'
  | 'writing'
  | 'review'
  | 'revision'
  | 'settlement'
  | 'state'
  | 'hook'
  | 'play'
  | 'reference';

export type NovelCopilotCapabilityStatus = 'available' | 'planned';

export interface NovelCopilotCapability {
  id: NovelCopilotCapabilityId;
  label: string;
  mode: NovelCopilotCapabilityMode;
  status: NovelCopilotCapabilityStatus;
  description: string;
}

export type NovelCopilotQuickCommandId =
  | 'character.generateCard'
  | 'outline.plan'
  | 'volume.planNext'
  | 'chapter.planNext'
  | 'chapter.writeNext'
  | 'chapter.settle'
  | 'chapter.review'
  | 'state.update'
  | 'foreshadow.plan'
  | 'chapter.deAi';

export interface NovelCopilotQuickCommand {
  id: NovelCopilotQuickCommandId;
  capabilityId: NovelCopilotCapabilityId;
  label: string;
  slashCommand: string;
  prompt: string;
}

export interface NovelCopilotSkill {
  name: string;
  displayName: string;
  system: string;
  allowedTools: string[];
  capabilities: NovelCopilotCapability[];
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

export const NOVEL_COPILOT_CAPABILITIES: NovelCopilotCapability[] = [
  {
    id: 'novel.generate_character_card',
    label: 'Generate Character Card',
    mode: 'state',
    status: 'available',
    description: 'Create or update a character-card draft from user notes or story context.',
  },
  {
    id: 'novel.plan_outline',
    label: 'Plan Outline',
    mode: 'planning',
    status: 'available',
    description: 'Create a project or arc outline without committing canonical facts by default.',
  },
  {
    id: 'novel.plan_volume',
    label: 'Plan Volume',
    mode: 'planning',
    status: 'available',
    description: 'Create a volume-level plan with heavier structure only when the user asks for it.',
  },
  {
    id: 'novel.plan_chapter',
    label: 'Plan Chapter',
    mode: 'planning',
    status: 'available',
    description: 'Create a light chapter contract for the next chapter.',
  },
  {
    id: 'novel.write_chapter',
    label: 'Write Chapter',
    mode: 'writing',
    status: 'available',
    description: 'Draft chapter prose after a short PRE_WRITE_CHECK and propose it as a PendingAction.',
  },
  {
    id: 'novel.review_chapter',
    label: 'Review Chapter',
    mode: 'review',
    status: 'available',
    description: 'Report review findings without implicit rewrite or settlement.',
  },
  {
    id: 'novel.revise_chapter',
    label: 'Revise Chapter',
    mode: 'revision',
    status: 'available',
    description: 'Revise prose only when the user asks, using chapter.createDraft for proposed changes.',
  },
  {
    id: 'novel.settle_chapter',
    label: 'Settle Chapter',
    mode: 'settlement',
    status: 'available',
    description: 'Convert chapter evidence into observation log and settlement PendingActions.',
  },
  {
    id: 'novel.update_state',
    label: 'Update State',
    mode: 'state',
    status: 'available',
    description: 'Propose state updates with evidence and old/new value summaries.',
  },
  {
    id: 'novel.plan_foreshadow',
    label: 'Plan Foreshadow',
    mode: 'hook',
    status: 'available',
    description: 'Plan or persist foreshadow items without inventing unsupported facts.',
  },
  {
    id: 'novel.de_ai',
    label: 'De-AI Prose',
    mode: 'revision',
    status: 'available',
    description: 'Reduce generic AI phrasing while preserving plot facts.',
  },
  {
    id: 'novel.play_scene',
    label: 'Play Scene',
    mode: 'play',
    status: 'planned',
    description: 'Run a roleplay sandbox session separate from canonical truth.',
  },
  {
    id: 'novel.import_tavern_character',
    label: 'Import Tavern-Compatible Character',
    mode: 'reference',
    status: 'planned',
    description: 'Import Tavern-compatible character cards into OAN character-card structure.',
  },
  {
    id: 'novel.deconstruct_reference',
    label: 'Deconstruct Reference Work',
    mode: 'reference',
    status: 'planned',
    description: 'Analyze reference works as non-canonical inspiration sources.',
  },
];

export const NOVEL_COPILOT_QUICK_COMMANDS: NovelCopilotQuickCommand[] = [
  {
    id: 'character.generateCard',
    capabilityId: 'novel.generate_character_card',
    label: '生成角色卡',
    slashCommand: '/生成角色卡',
    prompt: '请先检查已有角色，再根据我的描述生成或更新角色卡。涉及写入时只创建 PendingAction。',
  },
  {
    id: 'outline.plan',
    capabilityId: 'novel.plan_outline',
    label: '规划大纲',
    slashCommand: '/规划大纲',
    prompt: '请读取工作流、宪法、摘要、状态、时间线和伏笔，规划故事大纲或当前篇章大纲。默认只输出可审阅的大纲草案；除非我要求保存，否则不要创建写入 PendingAction。',
  },
  {
    id: 'volume.planNext',
    capabilityId: 'novel.plan_volume',
    label: '规划下一卷',
    slashCommand: '/规划下一卷',
    prompt: '请读取工作流、宪法、现有大纲、近期摘要、状态、时间线和伏笔，规划下一卷。可以使用卷级结构字段，包括冲突阶梯、信息差变化、角色成长段、伏笔债、回收窗口和 CBN/CPNs/CEN；默认不要写入真实目标文件。',
  },
  {
    id: 'chapter.planNext',
    capabilityId: 'novel.plan_chapter',
    label: '规划下一章',
    slashCommand: '/规划下一章',
    prompt: '请读取工作流、宪法、摘要、状态、时间线、伏笔和前章，输出轻量本章契约：chapter id/title candidate、当前任务、POV、核心冲突或场景方向、关键出场角色与状态前置、涉及 hook、章尾必须发生的改变和禁止事项。',
  },
  {
    id: 'chapter.writeNext',
    capabilityId: 'novel.write_chapter',
    label: '写下一章',
    slashCommand: '/写下一章',
    prompt: '请基于本章契约写下一章草稿。先输出短 PRE_WRITE_CHECK，确认契约对齐、上下文范围、当前锚点、待处理 hooks、暂不暴露的信息和风险扫描；正文只能通过 chapter.createDraft 创建 PendingAction。',
  },
  {
    id: 'chapter.settle',
    capabilityId: 'novel.settle_chapter',
    label: '整理本章',
    slashCommand: '/整理本章',
    prompt: '请读取目标章节并整理本章。先输出只基于正文证据的 observation log，再生成 settlement bundle，并通过 summary.generateChapter、state.set、timeline.add、foreshadow.create 等工具提出 PendingAction。',
  },
  {
    id: 'chapter.review',
    capabilityId: 'novel.review_chapter',
    label: '审稿',
    slashCommand: '/审稿',
    prompt: '请审查当前章节的连续性、人设、世界规则、剧情、伏笔、节奏和 AI 味。默认只输出 report-only 审稿报告和 finding schema，不要隐式改写、整理本章或更新状态；只有我明确要求时才提出 rewrite 或 settlement PendingAction。',
  },
  {
    id: 'state.update',
    capabilityId: 'novel.update_state',
    label: '更新状态',
    slashCommand: '/更新状态',
    prompt: '请根据我提供的材料更新状态。先读取已有 state 和相关角色卡，写入只能通过 state.set PendingAction。',
  },
  {
    id: 'foreshadow.plan',
    capabilityId: 'novel.plan_foreshadow',
    label: '补伏笔',
    slashCommand: '/补伏笔',
    prompt: '请读取已有伏笔、摘要、时间线和相关章节，设计可埋设或推进的伏笔。需要写入时只创建 PendingAction。',
  },
  {
    id: 'chapter.deAi',
    capabilityId: 'novel.de_ai',
    label: '去AI味',
    slashCommand: '/去AI味',
    prompt: '请在不改变剧情事实的前提下去除 AI 味。需要替换正文时只通过 chapter.createDraft 创建 PendingAction。',
  },
];

export const createDefaultNovelCopilotSkill = (
  workspaceSystemOverride?: string,
): NovelCopilotSkill => ({
  name: 'novel-copilot',
  displayName: 'Novel Copilot',
  allowedTools: [...NOVEL_COPILOT_ALLOWED_TOOLS],
  capabilities: NOVEL_COPILOT_CAPABILITIES.map((capability) => ({ ...capability })),
  quickCommands: NOVEL_COPILOT_QUICK_COMMANDS.map((command) => ({ ...command })),
  system: [
    '# Novel Copilot Skill',
    '',
    'You are the Novel Agent Copilot for a filesystem-first long-form novel workspace.',
    'You operate as one Aider-style tool loop, not as a multi-agent platform.',
    '',
    '## Workflow',
    '',
    'Follow these phases on every turn: observe -> plan -> draft/propose -> verify. Enter settle only when the user explicitly asks to settle, organize a completed chapter, or adopt accepted chapter changes.',
    'Keep capability ids stable in user-visible reports when useful: novel.plan_outline, novel.plan_volume, novel.plan_chapter, novel.write_chapter, novel.review_chapter, novel.revise_chapter, novel.settle_chapter, novel.update_state, novel.plan_foreshadow, novel.de_ai, novel.play_scene, novel.import_tavern_character, novel.deconstruct_reference.',
    'Play and reference capabilities are product contracts, not permission to create a multi-agent runtime or canonicalize non-canonical material.',
    '',
    '## Observe',
    '',
    'Before making writing decisions, read the minimum relevant filesystem context.',
    'Always prefer workflow.get, constitution.get, summary.get, state.get, timeline.list, and foreshadow.list when the task affects novel continuity.',
    'Use character.list and character.get before changing character voice, motivation, relationship, state, or role.',
    'Use world.search before relying on world rules, factions, locations, power systems, creatures, or setting facts.',
    'Use chapter.get when continuing, reviewing, settling, or rewriting chapter text.',
    'For writing, review, settlement, reference, and Play-related tasks, be able to explain selected sources, omitted sources, and the reason each source was in or out of scope.',
    'A context package is an explanatory artifact only; never treat it as the source of canonical story truth.',
    '',
    '## Plan',
    '',
    'Briefly explain what you will do and which domains or files you expect to touch before calling write-intent tools.',
    'Do not reveal hidden chain of thought.',
    'For /规划下一章, output a light chapter contract: chapter id/title candidate, current task, POV, core conflict or scene direction, key cast and starting states, hooks to add/advance/mention/resolve/defer, ending change, and forbidden moves.',
    'For /规划大纲 and /规划下一卷, you may use heavier outline fields such as conflict ladder, information-gap changes, key beats, volume-level character arcs, foreshadow debt, payoff windows, and CBN/CPNs/CEN. Do not impose those heavy fields on ordinary single-chapter writing.',
    '',
    '## Draft Or Propose',
    '',
    'Never write real target files directly.',
    'All file changes must be proposed as PendingActions through write-intent tools.',
    'Use chapter.createDraft for chapter prose, summary.generateChapter for summaries, state.set for state, timeline.add for plot events, foreshadow.create for hooks, and character.updatePersonality for scoped character-card updates.',
    'Do not claim a file has changed until the user accepts the PendingAction.',
    'For /写下一章, output a short PRE_WRITE_CHECK before chapter.createDraft. It must cover chapter-contract alignment, context scope, current anchor, pending hooks, secrets not to reveal yet, and risks such as OOC, information leaks, world-rule conflicts, resource drift, or generic AI phrasing.',
    '',
    '## Review',
    '',
    '/审稿 is report-only by default.',
    'A review may read context and produce findings, but must not rewrite prose, settle the chapter, update state, create timeline events, or create foreshadow items unless the user explicitly asks for those actions.',
    'Use findings with severity, category, location, evidence, issue, suggestedFix, needsUserDecision, and blocking when relevant.',
    'Include dimension passes for checked areas with no issue, so a clean dimension is visible instead of silently omitted.',
    '',
    '## Verify',
    '',
    'Before finishing, check that requested output exists as assistant text or PendingAction, required context was read, proposed changes match the user-facing plan, no direct write occurred, and risky ambiguity is reported.',
    'For long or resumable tasks, summarize the key input sources, output artifacts, proposed patch list, timestamp, and unresolved questions so a session artifact can be recorded by the caller.',
    '',
    '## Settle',
    '',
    'When a chapter is explicitly settled, organized, or adopted after acceptance, first produce an evidence-only observation log from the chapter text.',
    'Then propose a settlement bundle: fulfillment, ambiguities, observations, patches, chapter summary, state changes with oldValue/newValue/evidence/confidence, timeline events, foreshadow changes, scoped character-card updates, next-chapter handoff, and unresolved ambiguity.',
    'If evidence is insufficient, say what could not be determined instead of inventing facts.',
    'A review report is not settlement. Do not treat /审稿 as a settlement trigger unless the user explicitly asks to organize, persist, update state, or apply review findings.',
    '',
    '## Play And Reference Use',
    '',
    'Play Mode is a separate sandbox experience. Play transcripts and play-local state are not canonical truth unless the user asks to adopt specific observations through PendingActions.',
    'Reference deconstruction and Tavern-compatible imports are reference/useful-input workflows. They may inform OAN artifacts, but imported or deconstructed material must be transformed into OAN structures and remain non-canonical until accepted by the user.',
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
