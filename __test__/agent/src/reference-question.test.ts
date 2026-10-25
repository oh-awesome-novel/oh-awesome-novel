import { describe, expect, it, vi } from 'vitest';

import {
  formatReferenceQuestionPrompt,
  generateReferenceQuestionAnswer,
} from '@oh-awesome-novel/agent';
import { MockLanguageModelV3 } from 'ai/test';

const providerConfig = { id: 'mock-provider', kind: 'custom' as const, model: 'mock-model' };

function window(index: number, content: string) {
  const lineStart = index * 10 + 1;
  return {
    pointerId: `source-window-00${index}`,
    pointer: {
      referenceId: 'reference-alpha',
      sourceChecksumSha256: 'a'.repeat(64),
      chapterId: `000${index}`,
      chunkId: `000${index}-chunk-001`,
      lineStart,
      lineEnd: lineStart + content.split('\n').length - 1,
    },
    content,
    charLength: content.length,
  };
}

const windows = [
  window(0, '第一章 雨夜\n她把信藏进袖口，没有回头。'),
  window(1, '第二章 旧信\n信纸上的字迹与她的笔迹一模一样。'),
];

function scripted(steps: Array<{ content: unknown[]; finishReason: 'stop' | 'tool-calls' }>) {
  let index = 0;
  const doGenerate = vi.fn(async (_options: unknown) => {
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    return {
      content: step.content,
      finishReason: { unified: step.finishReason, raw: step.finishReason },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    };
  });
  return { model: new MockLanguageModelV3({ doGenerate } as never), doGenerate };
}

const toolCall = (toolName: string, input: unknown, id: string) => ({
  type: 'tool-call' as const,
  toolCallId: id,
  toolName,
  input: JSON.stringify(input),
});

describe('reference question exploration', () => {
  it('lists every pointer as a table of contents without source bodies', () => {
    const prompt = formatReferenceQuestionPrompt({ title: '样书', question: '伏笔怎么埋？', windows });
    expect(prompt).toContain('source-window-000 | 0000 | lines 1-2 | 第一章 雨夜');
    expect(prompt).toContain('source-window-001');
    expect(prompt).not.toContain('一模一样');
  });

  it('answers after free search and read, citing only opened pointers', async () => {
    const answer = {
      answer: '作者先让人物藏信，再在下一章揭示笔迹相同。',
      findings: [{
        observation: '藏信动作先于揭示。',
        technique: '先给动作、后给解释的延迟揭示。',
        evidenceRefs: ['source-window-000', 'source-window-001'],
      }],
      uncertainties: [],
    };
    const { model, doGenerate } = scripted([
      { content: [toolCall('searchReferenceSource', { query: '信' }, 'c1')], finishReason: 'tool-calls' },
      { content: [toolCall('readReferenceSource', { pointerId: 'source-window-001' }, 'c2')], finishReason: 'tool-calls' },
      { content: [{ type: 'text', text: JSON.stringify(answer) }], finishReason: 'stop' },
    ]);
    const result = await generateReferenceQuestionAnswer({
      referenceId: 'reference-alpha',
      title: '样书',
      question: '伏笔怎么埋？',
      windows,
      providerConfig,
      resolveModel: vi.fn(() => model),
    });
    expect(result).toMatchObject({
      status: 'completed',
      output: {
        question: '伏笔怎么埋？',
        copyRisk: false,
        evidence: [
          { pointerId: 'source-window-000', lineStart: 1, lineEnd: 2 },
          { pointerId: 'source-window-001', lineStart: 11, lineEnd: 12 },
        ],
      },
    });
    expect(doGenerate).toHaveBeenCalledTimes(3);
  });

  it('rejects answers that cite pointers the model never opened', async () => {
    const { model } = scripted([{
      content: [{
        type: 'text',
        text: JSON.stringify({
          answer: '猜测。',
          findings: [{ observation: '未读。', technique: null, evidenceRefs: ['source-window-001'] }],
          uncertainties: [],
        }),
      }],
      finishReason: 'stop',
    }]);
    const result = await generateReferenceQuestionAnswer({
      referenceId: 'reference-alpha',
      title: '样书',
      question: '伏笔怎么埋？',
      windows,
      providerConfig,
      resolveModel: vi.fn(() => model),
    });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'invalid_output' } });
  });
});
