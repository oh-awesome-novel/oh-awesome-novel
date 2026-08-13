import { describe, expect, it } from 'vitest';

import {
  DE_AI_PROTECTION_RULES,
  createNovelCopilotSandboxProposalContract,
  formatDeAiProtectionRulesMarkdown,
  formatReviewReportMarkdown,
  formatReviewSandboxProposalMarkdown,
  type ReviewDimensionResult,
  type ReviewFinding,
  type ReviewSandboxProposal,
} from '@oh-awesome-novel/core';

describe('writing review workflow', () => {
  it('formats findings by severity and includes dimension passes', () => {
    const findings: ReviewFinding[] = [
      {
        severity: 'high',
        category: 'character',
        location: 'chapters/0001/0003.md#scene-2',
        evidence: '女主突然公开求助。',
        issue: '与当前戒备状态冲突。',
        suggestedFix: '改为试探式求证。',
        needsUserDecision: true,
        blocking: false,
      },
    ];
    const dimensions: ReviewDimensionResult[] = [
      {
        category: 'continuity',
        status: 'pass',
        summary: '时间线连续。',
      },
      {
        category: 'character',
        status: 'issues',
        summary: '存在 OOC 风险。',
      },
    ];

    const report = formatReviewReportMarkdown(findings, dimensions);

    expect(report).toContain('### Dimension Pass');
    expect(report).toContain('- continuity: pass - 时间线连续。');
    expect(report).toContain('#### high');
    expect(report).toContain('needsUserDecision: yes');
    expect(report).not.toContain('Settlement Bundle');
  });

  it('exposes de-AI protection rules without allowing fact deletion', () => {
    const markdown = formatDeAiProtectionRulesMarkdown();

    expect(DE_AI_PROTECTION_RULES).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Do not change plot facts'),
        expect.stringContaining('Do not delete hooks'),
      ]),
    );
    expect(markdown).toContain('去 AI 味保护规则');
    expect(markdown).toContain('chapter.edit sandbox proposal');
  });

  it('requires an explicit user rewrite request for a review sandbox proposal', () => {
    const proposal: ReviewSandboxProposal = {
      userRequestedRewrite: true,
      findingLocations: ['chapters/0001/0003.md#scene-2'],
      sandboxProposal: createNovelCopilotSandboxProposalContract({
        capability: 'chapter.edit',
        targetPaths: ['chapters/0001/0003.md'],
      }),
    };

    const markdown = formatReviewSandboxProposalMarkdown(proposal);

    expect(markdown).toContain('用户已明确要求改写: yes');
    expect(markdown).toContain('chapter.edit');
    expect(markdown).toContain('workspace.previewChanges');
    expect(markdown).toContain('workspace.proposeChanges');
    expect(markdown).toContain('chapters/0001/0003.md');
  });
});
