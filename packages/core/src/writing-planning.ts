import type { NovelCopilotSandboxProposalContract } from './novel-copilot-skill.js';

export type PlanningGranularity = 'outline' | 'volume' | 'chapter' | 'keyChapter';

export type HookPlanOperation = 'create' | 'mention' | 'advance' | 'resolve' | 'defer';

export interface ChapterContractCastEntry {
  characterId: string;
  name?: string;
  role?: string;
  stateBefore: string;
}

export interface ChapterContractHook {
  hookId?: string;
  title: string;
  operation: HookPlanOperation;
  note?: string;
}

export interface ChapterContract {
  chapterId: string;
  titleCandidate?: string;
  currentTask: string;
  pov: string;
  coreConflict: string;
  sceneDirection?: string;
  cast: ChapterContractCastEntry[];
  hooks: ChapterContractHook[];
  endingChange: string;
  forbiddenMoves: string[];
}

export interface ChapterPlanningPacket {
  granularity: 'chapter' | 'keyChapter';
  contract: ChapterContract;
  notes?: string[];
}

export interface OutlinePlanningPacket {
  granularity: 'outline';
  title: string;
  readerPromise?: string;
  arcs: string[];
  keyBeats: string[];
  foreshadowDebt: string[];
  notes?: string[];
}

export interface VolumePlanningPacket {
  granularity: 'volume';
  volumeId?: string;
  titleCandidate?: string;
  readerPromise?: string;
  conflictLadder: string[];
  informationGapChanges: string[];
  keyBeats: string[];
  characterArcs: string[];
  foreshadowDebt: string[];
  payoffWindows: string[];
  cbn?: string;
  cpns?: string[];
  cen?: string;
  notes?: string[];
}

export type PlanningPacket =
  | OutlinePlanningPacket
  | VolumePlanningPacket
  | ChapterPlanningPacket;

/**
 * Planning stays conversational/session-local by default. This separate
 * contract exists only when the user explicitly asks to persist the plan.
 */
export interface PlanningSandboxProposal {
  userRequestedPersistence: true;
  granularity: PlanningGranularity;
  sandboxProposal: NovelCopilotSandboxProposalContract<'outline.edit'>;
}

export interface PreWriteRiskScan {
  ooc: boolean;
  informationLeak: boolean;
  worldRuleConflict: boolean;
  resourceDrift: boolean;
  genericAiPhrasing: boolean;
  notes?: string[];
}

export interface PreWriteCheck {
  chapterContractAligned: boolean;
  contextScope: string[];
  currentAnchor: string;
  pendingHooks: string[];
  secretsToWithhold: string[];
  riskScan: PreWriteRiskScan;
  sandboxProposal: NovelCopilotSandboxProposalContract<'chapter.edit'>;
}

export const formatChapterContractMarkdown = (
  contract: ChapterContract,
): string => [
  '## 本章契约',
  '',
  `- chapter id: ${contract.chapterId}`,
  `- title candidate: ${contract.titleCandidate ?? '未定'}`,
  `- 当前任务: ${contract.currentTask}`,
  `- POV: ${contract.pov}`,
  `- 核心冲突: ${contract.coreConflict}`,
  `- 场景方向: ${contract.sceneDirection ?? '未定'}`,
  '',
  '### 关键出场角色与状态前置',
  formatList(contract.cast.map(formatCastEntry)),
  '',
  '### Hooks',
  formatList(contract.hooks.map(formatHookEntry)),
  '',
  `### 章尾必须发生的改变\n${contract.endingChange}`,
  '',
  '### 禁止事项',
  formatList(contract.forbiddenMoves),
].join('\n');

export const formatVolumePlanningPacketMarkdown = (
  packet: VolumePlanningPacket,
): string => [
  '## 卷级规划',
  '',
  `- volume id: ${packet.volumeId ?? '未定'}`,
  `- title candidate: ${packet.titleCandidate ?? '未定'}`,
  `- reader promise: ${packet.readerPromise ?? '未定'}`,
  '',
  '### 冲突阶梯',
  formatList(packet.conflictLadder),
  '',
  '### 信息差变化',
  formatList(packet.informationGapChanges),
  '',
  '### Key Beats',
  formatList(packet.keyBeats),
  '',
  '### 卷级角色成长段',
  formatList(packet.characterArcs),
  '',
  '### 伏笔债',
  formatList(packet.foreshadowDebt),
  '',
  '### 回收窗口',
  formatList(packet.payoffWindows),
  '',
  '### CBN / CPNs / CEN',
  `- CBN: ${packet.cbn ?? '未定'}`,
  `- CPNs: ${packet.cpns?.join('; ') ?? '未定'}`,
  `- CEN: ${packet.cen ?? '未定'}`,
  '',
  '### Notes',
  formatList(packet.notes ?? []),
].join('\n');

export const formatPlanningSandboxProposalMarkdown = (
  proposal: PlanningSandboxProposal,
): string => {
  if (proposal.userRequestedPersistence !== true) {
    throw new Error('Planning persistence proposal requires an explicit user request.');
  }
  if (proposal.sandboxProposal.capability !== 'outline.edit') {
    throw new Error('Planning persistence proposal must use outline.edit capability.');
  }

  return [
    '## 规划保存提案契约',
    '',
    '- 用户已明确要求保存: yes',
    `- 规划粒度: ${proposal.granularity}`,
    `- 虚拟编辑能力: ${proposal.sandboxProposal.capability}`,
    `- 预览工具: ${proposal.sandboxProposal.previewTool}`,
    `- 提案工具: ${proposal.sandboxProposal.proposalTool}`,
    `- canonical 写入边界: ${proposal.sandboxProposal.canonicalWriteBoundary}`,
    '',
    '### Target Paths',
    formatList(proposal.sandboxProposal.targetPaths),
  ].join('\n');
};

export const formatPreWriteCheckMarkdown = (
  check: PreWriteCheck,
): string => [
  '## PRE_WRITE_CHECK',
  '',
  `- 本章契约对齐: ${check.chapterContractAligned ? 'yes' : 'no'}`,
  `- 当前锚点: ${check.currentAnchor}`,
  `- 虚拟编辑能力: ${check.sandboxProposal.capability}`,
  `- 预览工具: ${check.sandboxProposal.previewTool}`,
  `- 提案工具: ${check.sandboxProposal.proposalTool}`,
  `- canonical 写入边界: ${check.sandboxProposal.canonicalWriteBoundary}`,
  '',
  '### 目标文件',
  formatList(check.sandboxProposal.targetPaths),
  '',
  '### 上下文范围',
  formatList(check.contextScope),
  '',
  '### 待处理 hooks',
  formatList(check.pendingHooks),
  '',
  '### 暂不暴露的信息',
  formatList(check.secretsToWithhold),
  '',
  '### 风险扫描',
  `- OOC: ${formatRisk(check.riskScan.ooc)}`,
  `- 信息越界: ${formatRisk(check.riskScan.informationLeak)}`,
  `- 世界规则冲突: ${formatRisk(check.riskScan.worldRuleConflict)}`,
  `- 战力/资源漂移: ${formatRisk(check.riskScan.resourceDrift)}`,
  `- AI 味高危: ${formatRisk(check.riskScan.genericAiPhrasing)}`,
  '',
  '### 风险备注',
  formatList(check.riskScan.notes ?? []),
].join('\n');

function formatCastEntry(entry: ChapterContractCastEntry): string {
  const displayName = entry.name ? `${entry.characterId} (${entry.name})` : entry.characterId;
  const role = entry.role ? ` role=${entry.role}` : '';
  return `${displayName}${role}: ${entry.stateBefore}`;
}

function formatHookEntry(entry: ChapterContractHook): string {
  const id = entry.hookId ? `${entry.hookId} ` : '';
  const note = entry.note ? ` - ${entry.note}` : '';
  return `${id}${entry.title} [${entry.operation}]${note}`;
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function formatRisk(value: boolean): string {
  return value ? 'risk' : 'clear';
}
