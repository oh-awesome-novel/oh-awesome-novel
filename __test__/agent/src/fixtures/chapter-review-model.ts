import { MockLanguageModelV4 } from 'ai/test';
import { reviewResponse } from '../../../core/src/fixtures/chapter-review';
export function reviewModel() {
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
  return new MockLanguageModelV4({ doGenerate: async options => {
    const user = options.prompt.findLast(message => message.role === 'user')!;
    if (user.role !== 'user') throw new Error('Missing prompt');
    const text = user.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
    const payload = JSON.parse(text.split('\n').at(-1)!);
    const response = payload.source ? reviewResponse(payload.source, payload.basis) : payload.anchors.map((anchor: { id: string }) => ({ anchorId: anchor.id, text: '她犹豫片刻，才露出微笑。' }));
    return { content: [{ type: 'text', text: JSON.stringify(response) }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
  } });
}
