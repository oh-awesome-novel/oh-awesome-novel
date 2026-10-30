import { forgeArray, forgeRecord, forgeString, forgeStrings, parseForgeJson } from './forge-discuss.js';
import type { ForgeBrief, ForgeCharacterPlan, ForgeFacet, ForgePlan, ForgeTrait } from './forge-types.js';
function id(value: unknown): string { const text = forgeString(value, 64); if (!/^[a-z0-9][a-z0-9_-]*$/.test(text)) throw new Error('Invalid Forge object id.'); return text; }
function traits(value: unknown, min: number, max: number, authorEdit = false): ForgeTrait[] {
  return forgeArray(value, min, max).map(v => {
    const t = forgeRecord(v);
    return { name: forgeString(t.name), behaviors: forgeStrings(t.behaviors, authorEdit ? 0 : 2, authorEdit ? 10 : 3) };
  });
}
function character(value: unknown, authorEdit = false): ForgeCharacterPlan {
  const c = forgeRecord(value); const p = forgeRecord(c.palette); const desire = forgeRecord(c.desire); const choice = forgeRecord(c.choice);
  const facets = forgeArray(c.facets, authorEdit ? 1 : 3, authorEdit ? 10 : 3).map(v => {
    const f = forgeRecord(v);
    const kind = String(f.kind);
    if (!authorEdit && !['normal', 'pressure', 'private'].includes(kind)) throw new Error('Invalid character facet.');
    const dialogue = forgeStrings(f.dialogue, authorEdit ? 0 : 5, authorEdit ? 30 : 10);
    if (!authorEdit && dialogue.some(line => /[（()）]|本质上/.test(line))) throw new Error('Facets require pure dialogue without retrospective explanation.');
    return { kind: (['normal', 'pressure', 'private'].includes(kind) ? kind : 'normal') as ForgeFacet['kind'], trigger: forgeString(f.trigger), state: forgeString(f.state), dialogue, habitualAction: forgeString(f.habitualAction) };
  });
  if (!authorEdit && new Set(facets.map(f => f.kind)).size !== 3) throw new Error('Three distinct facets are required.');
  return {
    id: id(c.id), name: forgeString(c.name, 100), aliases: forgeStrings(c.aliases, 0, 30),
    palette: { base: forgeString(p.base), mainTones: traits(p.mainTones, authorEdit ? 0 : 1, authorEdit ? 10 : 2, authorEdit), accents: traits(p.accents, authorEdit ? 0 : 1, authorEdit ? 10 : 5, authorEdit) }, facets,
    clarifications: forgeArray(c.clarifications, 0, 30).map(v => { const x = forgeRecord(v); return { trait: forgeString(x.trait), meaning: forgeString(x.meaning), when: forgeString(x.when), not: forgeString(x.not) }; }),
    desire: { goal: forgeString(desire.goal), obstacle: forgeString(desire.obstacle), cost: forgeString(desire.cost) },
    choice: { dilemma: forgeString(choice.dilemma), decision: forgeString(choice.decision), sacrifice: forgeString(choice.sacrifice), consequence: forgeString(choice.consequence) },
    resources: forgeArray(c.resources, 0, 30).map(v => { const x = forgeRecord(v); return { name: forgeString(x.name), initial: forgeString(x.initial), cost: forgeString(x.cost), settlement: forgeString(x.settlement) }; }),
  };
}
export function parseForgePlan(value: unknown, options?: { authorEdit?: boolean }): ForgePlan {
  const authorEdit = Boolean(options?.authorEdit);
  const p = forgeRecord(typeof value === 'string' ? parseForgeJson(value.replace(/^\s*<plan>\s*/i, '').replace(/\s*<\/plan>\s*$/i, '')) : value);
  const world = forgeRecord(p.world);
  if (world.kind !== 'real' && world.kind !== 'fictional') throw new Error('Invalid world kind.');
  const characters = forgeArray(p.characters, 1, 20).map(c => character(c, authorEdit));
  if (new Set(characters.map(c => c.id)).size !== characters.length) throw new Error('Duplicate character id.');
  const places = forgeArray(p.places, authorEdit ? 0 : 1, 30).map(v => { const x = forgeRecord(v); return { id: id(x.id), name: forgeString(x.name), appearance: forgeString(x.appearance), atmosphere: forgeString(x.atmosphere), characters: forgeStrings(x.characters), events: forgeStrings(x.events, authorEdit ? 0 : 1) }; });
  if (new Set(places.map(c => c.id)).size !== places.length) throw new Error('Duplicate place id.');
  return { title: forgeString(p.title, 200), characters, world: { kind: world.kind, premise: forgeString(world.premise), rules: forgeStrings(world.rules, authorEdit ? 0 : 1), factions: forgeStrings(world.factions, authorEdit ? 0 : 1), history: forgeStrings(world.history, authorEdit ? 0 : 1) }, places, opening: forgeString(p.opening) };
}
export function formatForgePlanPrompt(brief: ForgeBrief): string {
  return `把作者草图整理为可编辑的设定方案。尊重锁定事实。只返回 JSON（可用 <plan> 包裹）。字段如下：
{title,characters:[{id(英文slug),name,aliases:[],palette:{base,mainTones:[{name,behaviors:[2至3条具体场景行为]}],accents:[{name,behaviors:[2至3条]}]},facets:[{kind:normal|pressure|private,trigger,state,dialogue:[5至10句纯台词],habitualAction}],clarifications:[{trait,meaning,when,not}],desire:{goal,obstacle,cost},choice:{dilemma,decision,sacrifice,consequence},resources:[{name,initial,cost,settlement}]}],world:{kind:real|fictional,premise,rules:[],factions:[],history:[]},places:[{id,name,appearance,atmosphere,characters:[],events:[]}],opening}。
每个角色必须有三种不同面孔。主色调1至2个，点缀至少1个；每项衍生2至3条“遇到什么会怎样、绝不会怎样”的行为。三面性提供触发、状态、习惯动作与纯台词，勿用括号动作或“因为、本质上、其实”解释。反刻板解释写明真正含义、何时出现、绝对不是什么。
T01：写具体眼前目标、阻力与代价。T03：写人物选择怎样改变后果、牺牲什么换取什么，避免天降解围。T04：有能力、系统或有限资源时必须填写初态、消耗和兑现条件，禁止透支未来收益；没有此类设定时 resources 可为空。
世界要包含异于常识的规则、势力、历史与地点。开场前三行呈现异常、悬念或冲突，以动作台词让人物登场，给作者明确行动或答话入口。紧凑条目，不写解释性散文。草图数据：\n${JSON.stringify(brief)}`;
}
