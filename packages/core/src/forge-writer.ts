import { forgeString } from './forge-discuss.js';
import { FORGE_CHUNK_KINDS, forgeChunkEntityIds, isForgeEntityChunkKind, type ForgeChunkKind, type ForgePlan } from './forge-types.js';
const instructions: Record<ForgeChunkKind, string> = {
  world: '世界框架、与常识不同的规则、势力与历史。',
  places: '逐一写出地点的样子、氛围、在场人物和常发事件。',
  characters: '逐一写角色档案、性格调色盘、具体场景行为、即时欲望与选择代价，以及资源初态、消耗、收益兑现条件。',
  facets: '逐一写角色常态面、压力面、私密面的触发、身心状态、习惯动作，每面保留5至10句纯台词。',
  clarifications: '逐一写特质真正含义、出现条件、绝不意味着什么。',
  opening: '前三行出现异常或悬念，让角色凭行动台词出场，末尾给作者明确的话头或行动入口。',
};
export function formatForgeWriterPrompt(plan: ForgePlan, kind: ForgeChunkKind): string {
  if (!FORGE_CHUNK_KINDS.includes(kind)) throw new Error('Unknown Forge chunk.');
  const ids = forgeChunkEntityIds(plan, kind);
  const output = isForgeEntityChunkKind(kind)
    ? `每个${kind === 'places' ? '地点' : '角色'}单独成块，按 id 输出 ${ids.map(id => `<content id="${id}">正文</content>`).join('')}；每块只写该对象自己的内容，不提其他对象的块，不写一级标题。`
    : '输出 <content>正文</content>。';
  return `只撰写已由作者核准方案中的“${kind}”块。${instructions[kind]}\n以紧凑 Markdown 小标题和 YAML 风格缩进条目组织，不输出代码围栏、额外设定或分析过程。严格保留已核准的事实、资源代价和台词。避免表情、声线、模糊词等套话。模型输出只是草稿，不能声称已经保存。${output}方案数据：\n${JSON.stringify(plan)}`;
}
function contentBlocks(text: string): Array<{ id?: string; body: string }> {
  if (text.length > 200_000) throw new Error('Forge chunk too large.');
  return [...text.matchAll(/<content(?:\s+id="([a-z0-9][a-z0-9_-]*)")?\s*>([\s\S]*?)<\/content\s*>/gi)].map(match => ({ ...(match[1] ? { id: match[1] } : {}), body: forgeString(match[2], 100_000) }));
}
export function parseForgeWriterResponse(text: string): string {
  const blocks = contentBlocks(text);
  if (blocks.length !== 1) throw new Error('Expected one content block.');
  return blocks[0]!.body;
}
/** One block per expected id, in plan order; a missing, extra or repeated id rejects the chunk. */
export function parseForgeEntityWriterResponse(text: string, ids: readonly string[]): Record<string, string> {
  const blocks = contentBlocks(text);
  if (blocks.length !== ids.length || blocks.some(block => !block.id) || new Set(blocks.map(block => block.id)).size !== blocks.length
    || ids.some(id => !blocks.some(block => block.id === id))) throw new Error(`Expected one content block for each of: ${ids.join(', ')}.`);
  return Object.fromEntries(ids.map(id => [id, blocks.find(block => block.id === id)!.body]));
}
