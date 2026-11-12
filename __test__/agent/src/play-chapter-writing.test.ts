import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { generatePlayChapterDraft } from '@oh-awesome-novel/agent';

type ProviderPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;
const draft = { title: '雨夜', paragraphs: [{ text: '沈砚推开客栈的门。', sourceItemIds: ['item-1'] }] };
function streaming(text: string) {
  const parts: ProviderPart[] = [
    { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } },
  ];
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...parts], initialDelayInMs: null, chunkDelayInMs: null }) }) });
}
async function generate(text: string) {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-chapter-'));
  try {
    return await generatePlayChapterDraft({ workspaceRoot: root, providerConfig: { id: 'test', kind: 'custom', model: 'test', baseUrl: 'https://provider.example/v1' }, resolveModel: () => streaming(text),
      targetPath: 'chapters/0001/0002.md', intent: { mustKeep: '', mayChange: '', pov: '', goal: '', length: '' }, items: [{ id: 'item-1', kind: 'event', summary: '沈砚进入客栈' }], context: [], abortSignal: new AbortController().signal });
  } finally { await rm(root, { recursive: true, force: true }); }
}
it('accepts a chapter draft whether or not the model wraps the JSON in a Markdown fence', async () => {
  expect(await generate(JSON.stringify(draft))).toEqual(draft);
  expect(await generate(`\`\`\`json\n${JSON.stringify(draft, null, 2)}\n\`\`\`\n`)).toEqual(draft);
  expect(await generate(`\`\`\`\n${JSON.stringify(draft)}\n\`\`\``)).toEqual(draft);
});
it('still rejects a fenced answer that is not a valid draft', async () => {
  await expect(generate('```json\n{"title":"雨夜"}\n```')).rejects.toThrow();
  await expect(generate('好的，以下是章节：{"title":"雨夜"}')).rejects.toThrow();
});
