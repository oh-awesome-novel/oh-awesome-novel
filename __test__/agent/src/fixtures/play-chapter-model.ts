import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

export function chapterModel() {
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
  return new MockLanguageModelV4({ doStream: async options => {
    const user = options.prompt.findLast(message => message.role === 'user')!;
    if (user.role !== 'user') throw new Error('Missing user prompt');
    const text = user.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
    const payload = JSON.parse(text.split('\n').at(-1)!) as { selectedPlayItems: { id: string }[] };
    const reply = JSON.stringify({ title: '雨夜送伞', paragraphs: [{ text: '她把伞递了过去。两个人在雨声中站了一会儿，终于说起了各自的来处。', sourceItemIds: [payload.selectedPlayItems[0]!.id] }] });
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: reply }, { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
    ], initialDelayInMs: null, chunkDelayInMs: null }) };
  } });
}
