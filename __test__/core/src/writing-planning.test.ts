import { describe, expect, it } from 'vitest';

import {
  formatChapterContractMarkdown,
  formatPreWriteCheckMarkdown,
  formatVolumePlanningPacketMarkdown,
  type ChapterContract,
  type PreWriteCheck,
  type VolumePlanningPacket,
} from '@oh-awesome-novel/core';

describe('writing planning artifacts', () => {
  it('formats a lightweight chapter contract without volume-level gates', () => {
    const contract: ChapterContract = {
      chapterId: '0001/0004',
      titleCandidate: '雨夜来信',
      currentTask: '让女主发现旧信并决定离开港口',
      pov: 'heroine',
      coreConflict: '信件真相与她当前身份相冲突',
      sceneDirection: '港口雨夜，低声对峙',
      cast: [
        {
          characterId: 'heroine',
          name: '林雾',
          role: 'POV',
          stateBefore: '受伤但保持警惕',
        },
      ],
      hooks: [
        {
          hookId: 'black_mark',
          title: '黑印记',
          operation: 'advance',
          note: '只推进，不解释来源',
        },
      ],
      endingChange: '女主决定追查信件来源',
      forbiddenMoves: ['不要揭示幕后主使', '不要治好旧伤'],
    };

    const markdown = formatChapterContractMarkdown(contract);

    expect(markdown).toContain('## 本章契约');
    expect(markdown).toContain('- chapter id: 0001/0004');
    expect(markdown).toContain('black_mark 黑印记 [advance]');
    expect(markdown).not.toContain('CBN');
    expect(markdown).not.toContain('CPNs');
    expect(markdown).not.toContain('CEN');
  });

  it('formats volume planning with heavier structural nodes', () => {
    const packet: VolumePlanningPacket = {
      granularity: 'volume',
      volumeId: '0002',
      titleCandidate: '北境长夜',
      readerPromise: '秘密代价逐步公开',
      conflictLadder: ['失踪', '追查', '背叛', '公开代价'],
      informationGapChanges: ['读者知道代价，主角不知道'],
      keyBeats: ['抵达北境', '第一次失败'],
      characterArcs: ['heroine: 从逃避到主动承担'],
      foreshadowDebt: ['black_mark'],
      payoffWindows: ['0002/0006-0002/0008'],
      cbn: '卷级中心转折',
      cpns: ['代价初显', '盟友背叛'],
      cen: '卷尾选择',
    };

    const markdown = formatVolumePlanningPacketMarkdown(packet);

    expect(markdown).toContain('## 卷级规划');
    expect(markdown).toContain('### CBN / CPNs / CEN');
    expect(markdown).toContain('卷级中心转折');
  });

  it('formats a short PRE_WRITE_CHECK before chapter.createDraft', () => {
    const check: PreWriteCheck = {
      chapterContractAligned: true,
      contextScope: ['constitution', 'previousChapterEnding', 'latestState'],
      currentAnchor: '上一章停在女主收到旧信',
      pendingHooks: ['black_mark'],
      secretsToWithhold: ['旧信真正寄件人'],
      riskScan: {
        ooc: false,
        informationLeak: true,
        worldRuleConflict: false,
        resourceDrift: false,
        genericAiPhrasing: true,
        notes: ['避免解释性独白'],
      },
      writeTool: 'chapter.createDraft',
    };

    const markdown = formatPreWriteCheckMarkdown(check);

    expect(markdown).toContain('## PRE_WRITE_CHECK');
    expect(markdown).toContain('- 写入方式: chapter.createDraft');
    expect(markdown).toContain('- 信息越界: risk');
    expect(markdown).toContain('- AI 味高危: risk');
  });
});
