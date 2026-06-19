import { describe, expect, it } from 'vitest';

import {
  DE_AI_PROTECTION_RULES,
  formatDeAiProtectionRulesMarkdown,
  formatReviewReportMarkdown,
  type ReviewDimensionResult,
  type ReviewFinding,
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
    expect(markdown).toContain('chapter.createDraft');
  });
});
