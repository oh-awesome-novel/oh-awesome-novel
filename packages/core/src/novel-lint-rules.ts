export interface LintRule { id: string; name: string; category: 'punctuation' | 'cliche' | 'style' | 'meta' | 'translation_ese'; pattern: RegExp; description: string; suggestionHint: string }
const rule = (id: string, name: string, category: LintRule['category'], pattern: RegExp, suggestionHint: string): LintRule => ({ id, name, category, pattern, description: name, suggestionHint });
/** Independently implemented from the plan's eleven categories; matches are advice. An approved empty suggestion removes the matched phrase, so it still goes through human review. */
export const NOVEL_LINT_RULES: readonly LintRule[] = [
  rule('dash', '破折号滥用', 'punctuation', /——/gu, '调整停顿与句式'),
  rule('vague_words', '模糊词', 'style', /似乎|仿佛|宛如|如同/gu, '描述确切动作'),
  rule('facial_stock', '表情套话', 'cliche', /嘴角.{0,4}(?:上扬|勾起)|闪过一丝|温柔善良/gu, '使用具体动作'),
  rule('voice_stock', '声线套话', 'cliche', /带着.{1,8}的(?:口吻|语气)|用.{1,8}的语气/gu, '通过台词体现态度'),
  rule('stale_metaphor', '陈旧比喻', 'cliche', /心湖|泛起涟漪|投石入湖|像.{0,2}小兽/gu, '使用角色熟悉的具体事物'),
  rule('exaggerated_emotion', '夸张情绪大词', 'style', /万念俱灰|陷入(?:了)?极大的/gu, '写具体反应'),
  rule('negation_pivot', '否定转折啰嗦', 'style', /不是.{1,10}[，,]\s*(?:只是|而是)/gu, '直接叙述'),
  rule('abstract_name', '名称不具体', 'style', /某(?:城市|学校|组织|公司|地方|小镇)|那个地方/gu, '请作者确认具体名称，不编造事实'),
  rule('meta_leak', '元信息泄露', 'meta', /本卡|写作要点|戏剧(?:用途|作用)|详见|见上文/gu, '检查是否为泄露的提示词'),
  rule('distant_emotion', '隔着讲情绪', 'style', /[她他](?:感到|意识到)|对自己说|并不知道/gu, '以当下感知表现情绪'),
  rule('false_subject', '假主语/翻译腔', 'translation_ese', /一股.{0,8}(?:涌|蔓延)|被一种.{0,10}包裹|念头在.{0,4}(?:心里|心中)成形/gu, '让人物或具体事物作主语'),
];

/** Browser-safe advisory scan: no filesystem, hashes, model calls or write authority. */
export interface LocalLintHit { offset:number; end:number; name:string; original:string; suggestionHint:string }
export function scanLocalNovelLint(source:string):LocalLintHit[] {
  if(source.length>1_000_000) return [];
  const hits:LocalLintHit[]=[];
  for(const paragraph of source.matchAll(/[^\r\n]+/gu)) {
    for(const rule of NOVEL_LINT_RULES) {
      for(const found of paragraph[0].matchAll(new RegExp(rule.pattern.source,rule.pattern.flags))) {
        if([...found[0]].length>=30)continue;
        hits.push({offset:paragraph.index+found.index,end:paragraph.index+found.index+found[0].length,name:rule.name,original:found[0],suggestionHint:rule.suggestionHint});
        if(hits.length>=5000)return hits.sort((a,b)=>a.offset-b.offset||a.end-b.end);
      }
    }
  }
  return hits.sort((a,b)=>a.offset-b.offset||a.end-b.end);
}
