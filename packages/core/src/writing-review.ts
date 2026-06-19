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
  'Use chapter.createDraft for replacement prose only when the user asks for a rewrite.',
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
