import { describe, expect, it, vi } from 'vite-plus/test';

import { createOanClient } from '@oh-awesome-novel/client';

const answer = {
  question: '悬念怎么留？',
  answer: '用未解释的选择。',
  findings: [{ observation: '选择没有解释。', evidenceRefs: ['p-1'] }],
  uncertainties: [],
  evidence: [{ pointerId: 'p-1', chapterId: '0002', lineStart: 3, lineEnd: 4 }],
  copyRisk: false,
};

function clientReturning(body: unknown) {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  return { client: createOanClient({ backendBaseUrl: 'http://backend.test', fetch: fetcher }), fetcher };
}

describe('reference question client', () => {
  it('posts a trimmed question and parses the evidence-backed answer', async () => {
    const { client, fetcher } = clientReturning({ status: 'completed', answer });
    await expect(client.askReferenceQuestion('reference-1', '  悬念怎么留？ ')).resolves.toEqual({
      status: 'completed',
      answer,
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe('http://backend.test/api/workspace/references/reference-1/questions');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ question: '悬念怎么留？' });
  });

  it('rejects empty questions and answers citing unresolved pointers', async () => {
    const { client } = clientReturning({
      status: 'completed',
      answer: { ...answer, findings: [{ observation: 'x', evidenceRefs: ['missing'] }] },
    });
    expect(() => client.askReferenceQuestion('reference-1', '   ')).toThrow();
    await expect(client.askReferenceQuestion('reference-1', 'q')).rejects.toThrow(/Invalid reference question/u);
  });

  it('passes failures through', async () => {
    const error = { code: 'invalid_output', message: 'did not pass', retryable: false };
    const { client } = clientReturning({ status: 'failed', error });
    await expect(client.askReferenceQuestion('reference-1', 'q')).resolves.toEqual({ status: 'failed', error });
  });
});
