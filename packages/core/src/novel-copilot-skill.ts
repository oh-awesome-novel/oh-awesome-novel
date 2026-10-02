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
  'bash',
  'readFile',
  'writeFile',
  'workspace.previewChanges',
  'workspace.proposeChanges',
] as const;

export const NOVEL_COPILOT_SANDBOX_CAPABILITIES = [
  'read-only',
  'chapter.edit',
  'character.edit',
  'world.edit',
  'state.edit',
  'timeline.edit',
  'foreshadow.edit',
  'summary.edit',
  'outline.edit',
  'novel.multi-file-edit',
  'reference.publish',
  'reference.adopt',
  'play.adopt',
] as const;

export type NovelCopilotSandboxCapability =
  typeof NOVEL_COPILOT_SANDBOX_CAPABILITIES[number];

export const NOVEL_COPILOT_SANDBOX_EDIT_CAPABILITIES = [
  'chapter.edit',
  'character.edit',
  'world.edit',
  'state.edit',
  'timeline.edit',
  'foreshadow.edit',
  'summary.edit',
  'outline.edit',
  'novel.multi-file-edit',
  'reference.publish',
  'reference.adopt',
  'play.adopt',
] as const satisfies readonly Exclude<NovelCopilotSandboxCapability, 'read-only'>[];

export type NovelCopilotSandboxEditCapability =
  typeof NOVEL_COPILOT_SANDBOX_EDIT_CAPABILITIES[number];

export interface NovelCopilotSandboxProposalContract<
  Capability extends NovelCopilotSandboxEditCapability =
    NovelCopilotSandboxEditCapability,
> {
  environment: 'fixed-in-memory-workspace';
  capability: Capability;
  targetPaths: string[];
  previewTool: 'workspace.previewChanges';
  proposalTool: 'workspace.proposeChanges';
  canonicalWriteBoundary: 'human-accept';
}

export interface CreateNovelCopilotSandboxProposalContractInput<
  Capability extends NovelCopilotSandboxEditCapability =
    NovelCopilotSandboxEditCapability,
> {
  capability: Capability;
  targetPaths: string[];
}

export function createNovelCopilotSandboxProposalContract<
  Capability extends NovelCopilotSandboxEditCapability,
>(
  input: CreateNovelCopilotSandboxProposalContractInput<Capability>,
): NovelCopilotSandboxProposalContract<Capability> {
  if (!NOVEL_COPILOT_SANDBOX_EDIT_CAPABILITIES.includes(input.capability)) {
    throw new Error('Sandbox proposal capability must be a writable host-selected capability.');
  }

  const targetPaths = input.targetPaths.map(normalizeSandboxTargetPath);

  if (new Set(targetPaths).size !== targetPaths.length) {
    throw new Error('Sandbox proposal target paths must be unique.');
  }

  return {
    environment: 'fixed-in-memory-workspace',
    capability: input.capability,
    targetPaths,
    previewTool: 'workspace.previewChanges',
    proposalTool: 'workspace.proposeChanges',
    canonicalWriteBoundary: 'human-accept',
  };
}

export function parseNovelCopilotSandboxProposalContract(
  value: unknown,
): NovelCopilotSandboxProposalContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Sandbox proposal contract must be an object.');
  }
  const record = value as Record<string, unknown>;
  const keys = [
    'environment',
    'capability',
    'targetPaths',
    'previewTool',
    'proposalTool',
    'canonicalWriteBoundary',
  ] as const;
  if (
    Object.keys(record).some((key) => !keys.includes(key as typeof keys[number]))
    || keys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new Error('Sandbox proposal contract contains unknown or missing fields.');
  }
  if (
    record.environment !== 'fixed-in-memory-workspace'
    || record.previewTool !== 'workspace.previewChanges'
    || record.proposalTool !== 'workspace.proposeChanges'
    || record.canonicalWriteBoundary !== 'human-accept'
  ) {
    throw new Error('Sandbox proposal contract contains an unsupported boundary.');
  }
  if (
    typeof record.capability !== 'string'
    || !NOVEL_COPILOT_SANDBOX_EDIT_CAPABILITIES.includes(
      record.capability as NovelCopilotSandboxEditCapability,
    )
  ) {
    throw new Error('Sandbox proposal contract contains an unsupported capability.');
  }
  if (!Array.isArray(record.targetPaths) || record.targetPaths.some(
    (path) => typeof path !== 'string',
  )) {
    throw new Error('Sandbox proposal contract targetPaths must be a string array.');
  }

  return createNovelCopilotSandboxProposalContract({
    capability: record.capability as NovelCopilotSandboxEditCapability,
    targetPaths: record.targetPaths as string[],
  });
}

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
    description: 'Revise prose only when the user asks, using a path-bounded sandbox proposal.',
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
    status: 'available',
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
    prompt: '请先检查已有角色，再根据我的描述在固定内存工作区中生成或更新角色卡。需要保存时先预览虚拟修改，再提出 changes 供我审批。',
  },
  {
    id: 'outline.plan',
    capabilityId: 'novel.plan_outline',
    label: '规划大纲',
    slashCommand: '/规划大纲',
    prompt: '请读取工作流、宪法、摘要、状态、时间线和伏笔，规划故事大纲或当前篇章大纲。默认只输出可审阅草案；我明确要求保存时，才在固定内存工作区编辑、预览并提出 changes。',
  },
  {
    id: 'volume.planNext',
    capabilityId: 'novel.plan_volume',
    label: '规划下一卷',
    slashCommand: '/规划下一卷',
    prompt: '请读取工作流、宪法、现有大纲、近期摘要、状态、时间线和伏笔，规划下一卷。可以使用卷级结构字段，包括冲突阶梯、信息差变化、角色成长段、伏笔债、回收窗口和 CBN/CPNs/CEN；默认不提出文件修改。',
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
    prompt: '请基于本章契约写下一章草稿。先输出短 PRE_WRITE_CHECK，确认契约对齐、上下文范围、当前锚点、待处理 hooks、暂不暴露的信息和风险扫描；然后只在固定内存工作区编辑目标章节，预览并提出 changes。',
  },
  {
    id: 'chapter.settle',
    capabilityId: 'novel.settle_chapter',
    label: '整理本章',
    slashCommand: '/整理本章',
    prompt: '请读取当前已打开的正文并整理本章。先输出只基于逐行正文证据的 observation log，再读取既有对象，提出 summary、state、timeline、foreshadow 与已有角色成长记录的结构化合并。用 settlement.propose 生成同一项审批；歧义和旧值冲突只报告，作者 Accept 后才保存。',
  },
  {
    id: 'chapter.review',
    capabilityId: 'novel.review_chapter',
    label: '审稿',
    slashCommand: '/审稿',
    prompt: '请审查当前章节的连续性、人设、世界规则、剧情、伏笔、节奏和 AI 味。默认只输出 report-only 审稿报告和 finding schema；只有我明确要求改写时，才在固定内存工作区编辑、预览并提出 changes。',
  },
  {
    id: 'state.update',
    capabilityId: 'novel.update_state',
    label: '更新状态',
    slashCommand: '/更新状态',
    prompt: '请根据我提供的材料更新状态。先读取已有 state 和相关角色卡，再在固定内存工作区编辑获授权的状态文件，预览并提出 changes。',
  },
  {
    id: 'foreshadow.plan',
    capabilityId: 'novel.plan_foreshadow',
    label: '补伏笔',
    slashCommand: '/补伏笔',
    prompt: '请读取已有伏笔、摘要、时间线和相关章节，设计可埋设或推进的伏笔。需要保存时，在固定内存工作区编辑获授权的伏笔文件，预览并提出 changes。',
  },
  {
    id: 'chapter.deAi',
    capabilityId: 'novel.de_ai',
    label: '去AI味',
    slashCommand: '/去AI味',
    prompt: '请在不改变剧情事实的前提下去除 AI 味。只有我要求替换正文时，才在固定内存工作区编辑目标章节，预览并提出 changes。',
  },
];

export const NOVEL_COPILOT_SANDBOX_SYSTEM = [
  '# Novel Copilot Sandbox Editing Contract',
  '',
  'You are the Novel Agent Copilot for a filesystem-first long-form novel workspace.',
  'You operate as one Aider-style tool loop, not as a multi-agent platform.',
  'The host selects the turn capability. Never widen that capability or infer write permission from model instructions.',
  '',
  '## Fixed Virtual Workspace',
  '',
  'All model-visible files come from one fixed in-memory projection mounted at /workspace.',
  'bash, readFile, writeFile, and filesystem-backed domain reads operate only on that same projection.',
  'The projection is not canonical storage. Editing it never means the real novel files changed.',
  'Do not attempt host filesystem, process, network, secret, package-manager, Python, or JavaScript access.',
  '',
  '## Workflow',
  '',
  'Follow observe -> plan -> virtual edit -> preview -> propose -> verify.',
  'Read the minimum relevant context and briefly identify the files you intend to edit.',
  'Edit only the exact target paths authorized by the host-selected capability.',
  'Perform every candidate edit inside /workspace. Never invent another write path or executable channel.',
  'Call workspace.previewChanges before proposal and inspect its bounded summary and truncation marker.',
  'When the requested virtual edits are complete, call workspace.proposeChanges once to finalize the proposal.',
  'A clean turn needs no proposal. If a dirty turn ends without an explicit proposal, the runtime may finalize the same virtual result as a fallback.',
  'After proposal, do not attempt more edits. Report the proposed create/update/delete paths and unresolved decisions.',
  '',
  '## Human Approval Boundary',
  '',
  'A proposal is a PendingAction, not a canonical write.',
  'Only Human Accept may materialize the immutable proposed bytes into the real workspace.',
  'Accept never replays bash commands, model text, or the displayed diff.',
  'Do not claim canonical files or Git changed until an accepted result says so.',
  '',
  '## Planning, Review, And Settlement',
  '',
  'Planning remains assistant or session output unless the user explicitly asks to persist it.',
  'For chapter writing, emit a short PRE_WRITE_CHECK before virtual editing.',
  'Review is report-only by default. A rewrite proposal requires an explicit user request.',
  'De-AI work may change expression, rhythm, diction, sentence shape, or sensory texture, but never plot facts, chronology, causal links, outcomes, hooks, character traits, necessary turns, POV, or constitution rules.',
  'Settlement starts from chapter evidence and may edit only the authorized files in the fixed projection.',
  '',
  '## Play And Reference Use',
  '',
  'Play transcripts and reference material are non-canonical until the user approves an explicitly bounded adoption or publication proposal.',
].join('\n');

export const createDefaultNovelCopilotSkill = (
  workspaceSystemOverride?: string,
): NovelCopilotSkill => ({
  name: 'novel-copilot',
  displayName: 'Novel Copilot',
  allowedTools: [...NOVEL_COPILOT_ALLOWED_TOOLS],
  capabilities: NOVEL_COPILOT_CAPABILITIES.map((capability) => ({ ...capability })),
  quickCommands: NOVEL_COPILOT_QUICK_COMMANDS.map((command) => ({ ...command })),
  system: [
    NOVEL_COPILOT_SANDBOX_SYSTEM,
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

function normalizeSandboxTargetPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error('Sandbox proposal target path must be a workspace-relative POSIX path.');
  }

  const normalized = value.normalize('NFC');
  const segments = normalized.split('/');
  if (
    normalized !== value
    || normalized.startsWith('/')
    || normalized.endsWith('/')
    || normalized.includes('\\')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Sandbox proposal target path must be a canonical workspace-relative POSIX path.');
  }

  return normalized;
}
