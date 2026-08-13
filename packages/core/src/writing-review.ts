import type { NovelCopilotSandboxProposalContract } from './novel-copilot-skill.js';

export type ReviewSeverity = 'blocking' | 'high' | 'medium' | 'low';

export type ReviewCategory =
  | 'continuity'
  | 'character'
  | 'world'
  | 'plot'
  | 'hook'
  | 'pacing'
  | 'style'
  | 'evidence';

export type ReviewDimensionStatus = 'pass' | 'issues' | 'notChecked';

export interface ReviewFinding {
  severity: ReviewSeverity;
  category: ReviewCategory;
  location: string;
  evidence: string;
  issue: string;
  suggestedFix: string;
  needsUserDecision: boolean;
  blocking: boolean;
}

export interface ReviewDimensionResult {
  category: ReviewCategory;
  status: ReviewDimensionStatus;
  summary: string;
}

/**
 * A review remains report-only unless this separate, explicit contract exists.
 * The literal `true` prevents an ordinary review result from silently becoming
 * a rewrite request.
 */
export interface ReviewSandboxProposal {
  userRequestedRewrite: true;
  findingLocations: string[];
  sandboxProposal: NovelCopilotSandboxProposalContract<'chapter.edit'>;
}

export const REVIEW_DIMENSIONS: ReviewCategory[] = [
  'continuity',
  'character',
  'world',
  'plot',
  'hook',
  'pacing',
  'style',
  'evidence',
];

export const DE_AI_PROTECTION_RULES = [
  'Only change expression, rhythm, diction, sentence shape, or sensory texture.',
  'Do not change plot facts, chronology, causal links, or scene outcomes.',
  'Do not delete hooks, character traits, key information, or necessary turns.',
  'Do not overwrite constitution, established voice, POV, or style constraints.',
  'Only make a chapter.edit sandbox proposal when the user asks for a rewrite.',
] as const;

const severityOrder: ReviewSeverity[] = ['blocking', 'high', 'medium', 'low'];

export const formatReviewReportMarkdown = (
  findings: ReviewFinding[],
  dimensions: ReviewDimensionResult[],
): string => [
  '## 审稿报告',
  '',
  '### Dimension Pass',
  ...dimensions.map(formatDimension),
  '',
  '### Findings',
  ...severityOrder.flatMap((severity) => formatSeverityGroup(severity, findings)),
].join('\n');

export const formatDeAiProtectionRulesMarkdown = (): string => [
  '## 去 AI 味保护规则',
  '',
  ...DE_AI_PROTECTION_RULES.map((rule) => `- ${rule}`),
].join('\n');

export const formatReviewSandboxProposalMarkdown = (
  proposal: ReviewSandboxProposal,
): string => {
  if (proposal.userRequestedRewrite !== true) {
    throw new Error('Review rewrite proposal requires an explicit user request.');
  }
  if (proposal.sandboxProposal.capability !== 'chapter.edit') {
    throw new Error('Review rewrite proposal must use chapter.edit capability.');
  }

  return [
    '## 审稿改写提案契约',
    '',
    '- 用户已明确要求改写: yes',
    `- 虚拟编辑能力: ${proposal.sandboxProposal.capability}`,
    `- 预览工具: ${proposal.sandboxProposal.previewTool}`,
    `- 提案工具: ${proposal.sandboxProposal.proposalTool}`,
    `- canonical 写入边界: ${proposal.sandboxProposal.canonicalWriteBoundary}`,
    '',
    '### Finding Locations',
    formatList(proposal.findingLocations),
    '',
    '### Target Paths',
    formatList(proposal.sandboxProposal.targetPaths),
  ].join('\n');
};

function formatDimension(dimension: ReviewDimensionResult): string {
  return `- ${dimension.category}: ${dimension.status} - ${dimension.summary}`;
}

function formatSeverityGroup(
  severity: ReviewSeverity,
  findings: ReviewFinding[],
): string[] {
  const group = findings.filter((finding) => finding.severity === severity);

  if (!group.length) {
    return [`#### ${severity}`, '- none'];
  }

  return [
    `#### ${severity}`,
    ...group.map((finding) => [
      `- [${finding.category}] ${finding.location}`,
      `  - evidence: ${finding.evidence}`,
      `  - issue: ${finding.issue}`,
      `  - suggestedFix: ${finding.suggestedFix}`,
      `  - needsUserDecision: ${finding.needsUserDecision ? 'yes' : 'no'}`,
      `  - blocking: ${finding.blocking ? 'yes' : 'no'}`,
    ].join('\n')),
  ];
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}
