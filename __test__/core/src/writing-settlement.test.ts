import { describe, expect, it } from 'vitest';

import {
  SETTLEMENT_HOOK_OPERATIONS,
  formatSettlementBundleMarkdown,
  type SettlementBundle,
} from '@oh-awesome-novel/core';

describe('writing settlement workflow', () => {
  it('formats observation log before patch proposals', () => {
    const bundle: SettlementBundle = {
      chapterId: '0001/0003',
      fulfillment: ['女主离开港口'],
      ambiguities: ['旧信寄件人尚未揭示'],
      observations: {
        chapterId: '0001/0003',
        observations: [
          {
            category: 'injury',
            subject: 'heroine',
            observation: '旧伤在雨夜复发',
            evidence: '她按住肋侧，呼吸发颤。',
            confidence: 'high',
            location: 'chapters/0001/0003.md#scene-1',
          },
        ],
        unresolvedAmbiguities: ['寄件人身份'],
      },
      patches: [
        {
          domain: 'state',
          target: 'state/characters.yaml characters.heroine.injury',
          reason: '章节正文显示伤势复发',
          evidence: '她按住肋侧，呼吸发颤。',
          confidence: 'high',
        },
      ],
      summary: {
        chapterId: '0001/0003',
        content: '女主收到旧信并决定离开港口。',
        evidence: '章尾决定。',
      },
      stateChanges: [
        {
          entity: 'heroine',
          field: 'locationIntent',
          oldValue: 'stay_port',
          newValue: 'leave_port',
          evidence: '章尾决定离开。',
          confidence: 'high',
        },
      ],
      timelineEvents: [
        {
          title: '女主收到旧信',
          time: '0001/0003',
          summary: '旧信改变了下一步行动。',
          evidence: '旧信被拆开。',
        },
      ],
      foreshadowChanges: [
        {
          hookId: 'black_mark',
          title: '黑印记',
          operation: 'advance',
          evidence: '雨水中印记发热。',
        },
      ],
      characterUpdates: [
        {
          characterId: 'heroine',
          section: 'growth',
          change: '开始主动追查旧信。',
          evidence: '章尾行动选择。',
        },
      ],
      nextChapterHandoff: ['从离港前夜开始'],
      unresolvedAmbiguity: ['寄件人身份需要用户决定'],
    };

    const markdown = formatSettlementBundleMarkdown(bundle);

    expect(markdown.indexOf('## Observation Log')).toBeLessThan(
      markdown.indexOf('## Settlement Bundle'),
    );
    expect(markdown.indexOf('### Evidence-Only Observations')).toBeLessThan(
      markdown.indexOf('### Patch Proposals'),
    );
    expect(markdown).toContain('[state] state/characters.yaml');
    expect(markdown).toContain('寄件人身份需要用户决定');
  });

  it('defines the hook operation taxonomy used by settlement', () => {
    expect(SETTLEMENT_HOOK_OPERATIONS).toEqual([
      'create',
      'mention',
      'advance',
      'resolve',
      'defer',
    ]);
  });
});
