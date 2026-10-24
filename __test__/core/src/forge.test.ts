import { describe, expect, it } from 'vitest';
import { forgeChunkKeys, parseForgeEntityWriterResponse, formatForgeWriterPrompt, applyForgeBriefEdits, createEmptyForgeBrief, parseForgeDiscussResponse, parseForgeJson, parseForgePlan, parseForgeWriterResponse, parseForgeDraft, formatForgePlanPrompt, type ForgePlan } from '@oh-awesome-novel/core';

function response(brief: unknown): string {
  const questions = [1, 2].map(i => ({ id: `q${i}`, title: '她怎么回应？', why: '确定你们的关系', kind: 'single', options: [{ label: '冷静', sample: '最后一班船，走吗？' }, { label: '关心', sample: '你先上船，我殿后。' }] }));
  return `<reply>先一起确定关系。</reply><questions>${JSON.stringify(questions)}</questions><brief>${JSON.stringify(brief)}</brief>`;
}
function plan(): ForgePlan {
  return { title: '渡口', characters: [{ id: 'lin', name: '林', aliases: [], palette: { base: '害怕失约', mainTones: [{ name: '克制', behaviors: ['遇到催促先核对时刻', '遇到危机先找出口'] }], accents: [{ name: '护短', behaviors: ['同伴落后会停步', '同伴受伤会包扎'] }] }, facets: (['normal', 'pressure', 'private'] as const).map(kind => ({ kind, trigger: '船靠岸', state: '警觉', dialogue: ['走吧。', '看脚下。', '我等你。', '船来了。', '票在这里。'], habitualAction: '捏住船票' })), clarifications: [{ trait: '克制', meaning: '先观察', when: '陌生环境', not: '冷漠' }], desire: { goal: '过河', obstacle: '船将离岸', cost: '舍弃行李' }, choice: { dilemma: '同伴或行李', decision: '拉住同伴', sacrifice: '丢下行李', consequence: '两人上船' }, resources: [{ name: '票', initial: '两张', cost: '每人一张', settlement: '上船验票' }] }], world: { kind: 'fictional', premise: '夜渡', rules: ['末班船不回头'], factions: ['船行'], history: ['桥断了'] }, places: [{ id: 'pier', name: '渡口', appearance: '旧栈桥', atmosphere: '冷雨', characters: ['lin'], events: ['末班船靠岸'] }], opening: '空船上的钟自己响了。\n林攥紧船票。\n“上船，还是留在这里？”' };
}
describe('guided Forge contracts', () => {
  it('keeps author locks and attribution through three discussions and derives readiness', () => {
    let brief = applyForgeBriefEdits(createEmptyForgeBrief(), [{ key: 'stage', value: '渡口', locked: true }]);
    for (const key of ['lead', 'bond', 'tone'] as const) {
      const parsed = parseForgeDiscussResponse(response({ title: '渡口', readiness: 100, items: [{ key: 'stage', label: '舞台', value: '夜城', by: 'assistant' }, { key, label: key, value: '新的建议', by: 'user', locked: true }], openPoints: [] }), brief);
      expect(parsed.questions.every(q => q.options.every(o => o.sample))).toBe(true);
      expect(parsed.brief.items.find(i => i.key === 'stage')).toMatchObject({ value: '渡口', by: 'user', locked: true });
      expect(parsed.brief.items.find(i => i.key === key)).toMatchObject({ by: 'assistant', locked: false });
      brief = parsed.brief;
    }
    // The four core slots (stage, lead, bond, tone) are what makes a sketch plan-ready.
    expect(brief.readiness).toBe(75);
  });
  it('attributes only complete host-evidenced statements and preserves prior author facts', () => {
    const previous = applyForgeBriefEdits(createEmptyForgeBrief(), [{ key: 'stage', value: '不是夜城，而是渡口', locked: false }]);
    const parsed = parseForgeDiscussResponse(response({ title: '渡口', readiness: 100, items: [
      { key: 'stage', label: '舞台', value: '夜城', by: 'user' },
      { key: 'lead', label: '角色', value: '我等你。', by: 'assistant' },
      { key: 'bond', label: '关系', value: '朋友', by: 'user' },
      { key: 'tone', label: '语调', value: '冷漠', by: 'user' },
    ], openPoints: [] }), previous, ['我等你。', '不是朋友', '并不冷漠']);
    expect(parsed.brief.items.find(i => i.key === 'stage')).toMatchObject({ value: '不是夜城，而是渡口', by: 'user', locked: false });
    expect(parsed.brief.items.find(i => i.key === 'lead')).toMatchObject({ value: '我等你。', by: 'user' });
    expect(parsed.brief.items.find(i => i.key === 'bond')?.by).toBe('assistant');
    expect(parsed.brief.items.find(i => i.key === 'tone')?.by).toBe('assistant');
    const omitted = parseForgeDiscussResponse(response(createEmptyForgeBrief()), parsed.brief);
    expect(omitted.brief.items.find(i => i.key === 'lead')?.by).toBe('user');
    const edited = applyForgeBriefEdits(parsed.brief, [{ key: 'stage', value: '改在桥头' }]);
    expect(edited.items.find(i => i.key === 'stage')?.value).toBe('改在桥头');
  });
  it('accepts a new complete author answer for unlocked facts while locks still win', () => {
    const previous = applyForgeBriefEdits(createEmptyForgeBrief(), [
      {key:'tone',value:'冷静',locked:false}, {key:'stage',value:'渡口',locked:true},
    ]);
    const reply = response({title:'渡口',readiness:100,items:[
      {key:'tone',label:'语气',value:'热情',by:'assistant'},
      {key:'stage',label:'舞台',value:'桥头',by:'assistant'},
    ],openPoints:[]});
    const inferred = parseForgeDiscussResponse(reply,previous);
    expect(inferred.brief.items.find(item=>item.key==='tone')?.value).toBe('冷静');
    const confirmed = parseForgeDiscussResponse(reply,previous,['热情','桥头']);
    expect(confirmed.brief.items.find(item=>item.key==='tone')).toMatchObject({value:'热情',by:'user',locked:false});
    expect(confirmed.brief.items.find(item=>item.key==='stage')).toMatchObject({value:'渡口',by:'user',locked:true});
  });
  it('rejects duplicate XML blocks, missing samples and invalid readiness', () => {
    const text = response(createEmptyForgeBrief());
    expect(() => parseForgeDiscussResponse(text + '<reply>x</reply>')).toThrow();
    expect(() => parseForgeDiscussResponse(text.replaceAll('"sample":', '"absent":'))).toThrow();
    expect(() => parseForgeDiscussResponse(response({ ...createEmptyForgeBrief(), readiness: 101 }))).toThrow();
  });
  it('tolerates fenced JSON and trailing commas without changing literal dialogue', () => {
    expect(parseForgeJson('```json\n{"line":"等一等,}","items":[1,],}\n```')).toEqual({ line: '等一等,}', items: [1] });
  });
  it('enforces taste sample length and allows an author to unlock their own item', () => {
    const text = response(createEmptyForgeBrief()).replaceAll('"kind":"single"', '"kind":"taste"');
    expect(() => parseForgeDiscussResponse(text)).toThrow('60–120');
    const locked = applyForgeBriefEdits(createEmptyForgeBrief(), [{ key: 'stage', value: '渡口', locked: true }]);
    const edited = applyForgeBriefEdits(locked, [{ key: 'stage', value: '桥头', locked: false }]);
    expect(edited.items[0]).toMatchObject({ value: '桥头', locked: false, by: 'user' });
    expect(locked.items[0].value).toBe('渡口');
  });
  it('validates complete depth, technique cards, ids and distinct facets', () => {
    expect(parseForgePlan(JSON.stringify(plan()))).toEqual(plan());
    const invalid = plan(); invalid.characters[0].facets[0].dialogue = ['一句'];
    expect(() => parseForgePlan(invalid)).toThrow();
    const traversal = plan(); traversal.places[0].id = '../outside';
    expect(() => parseForgePlan(traversal)).toThrow();
    expect(formatForgePlanPrompt(createEmptyForgeBrief())).toContain('T04');
  });
  it('locking keeps the author of an assistant proposal; only changed text becomes the author\'s', () => {
    const proposed = { title: '渡口', readiness: 0, openPoints: [], items: [{ key: 'bond' as const, label: '关系', value: '欠债搭档', by: 'assistant' as const, locked: false }] };
    expect(applyForgeBriefEdits(proposed, [{ key: 'bond', value: '欠债搭档', locked: true }]).items[0]).toMatchObject({ by: 'assistant', locked: true });
    expect(applyForgeBriefEdits(proposed, [{ key: 'bond', value: '同门', locked: true }]).items[0]).toMatchObject({ by: 'user', locked: true });
  });
  it('writes character and place blocks per object id', () => {
    const p = plan();
    expect(forgeChunkKeys(p)).toEqual(['world', ...p.places.map(place => `places:${place.id}`), 'characters:lin', 'facets:lin', 'clarifications:lin', 'opening']);
    expect(formatForgeWriterPrompt(p, 'facets')).toContain('<content id="lin">');
    expect(parseForgeEntityWriterResponse('<content id="lin">林的三面</content>', ['lin'])).toEqual({ lin: '林的三面' });
    expect(() => parseForgeEntityWriterResponse('<content>林</content>', ['lin'])).toThrow();
    expect(() => parseForgeEntityWriterResponse('<content id="lin">a</content><content id="lin">b</content>', ['lin'])).toThrow();
  });
  it('requires one bounded writer block and coherent persisted stages', () => {
    expect(parseForgeWriterResponse('<content># 渡口\n- 夜雨</content>')).toBe('# 渡口\n- 夜雨');
    expect(() => parseForgeWriterResponse('just text')).toThrow();
    expect(() => parseForgeDraft({ schemaVersion: 1, id: 'draft', revision: 0, idea: '渡口', stage: 'proposed', brief: createEmptyForgeBrief(), questions: [], reply: '' })).toThrow();
    // A draft written with one combined block per kind returns to the plan stage to be rewritten per object.
    const legacy = Object.fromEntries(['world', 'places', 'characters', 'facets', 'clarifications', 'opening'].map(kind => [kind, kind]));
    const restored = parseForgeDraft({ schemaVersion: 1, id: 'draft', revision: 3, idea: '渡口', stage: 'written', brief: createEmptyForgeBrief(), questions: [], reply: '', plan: plan(), chunks: legacy });
    expect(restored.stage).toBe('plan');
    expect(restored.chunks).toBeUndefined();
  });
});
