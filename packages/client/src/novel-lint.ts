import type { NovelLintScan, LintReplacement } from '@oh-awesome-novel/core';
function record(value:unknown,keys:string[]):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('Invalid LINT response.');
  const result=value as Record<string,unknown>;
  if(Object.keys(result).length!==keys.length||keys.some(key=>!Object.hasOwn(result,key))) throw new Error('Invalid LINT response fields.');
  return result;
}
function string(value:unknown):asserts value is string { if(typeof value!=='string'||value.includes('\0')) throw new Error('Invalid LINT text.'); }
function hash(value:unknown):asserts value is string {string(value);if(!/^[a-f0-9]{64}$/u.test(value))throw new Error('Invalid LINT source hash.');}
function integer(value:unknown):asserts value is number {if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('Invalid LINT location.');}
export function parseNovelLintScan(value:unknown):NovelLintScan {
  const scan=record(record(value,['scan']).scan,['sourceHash','anchors','hits']); hash(scan.sourceHash);
  if(!Array.isArray(scan.anchors)||!Array.isArray(scan.hits)||scan.hits.length>5000) throw new Error('Invalid LINT scan.');
  const anchors=new Map<string,{start:number;end:number;text:string}>();
  for(const raw of scan.anchors) {
    const p=record(raw,['anchorId','index','start','end','text','sourceHash']);
    for(const key of ['anchorId','text','sourceHash'])string(p[key]);for(const key of ['index','start','end'])integer(p[key]);
    if(p.sourceHash!==scan.sourceHash||Number(p.start)>Number(p.end)||String(p.text).length!==Number(p.end)-Number(p.start)||anchors.has(String(p.anchorId)))throw new Error('Invalid LINT anchor.');
    anchors.set(String(p.anchorId),{start:Number(p.start),end:Number(p.end),text:String(p.text)});
  }
  const ids=new Set<string>();
  for(const raw of scan.hits) {
    const h=record(raw,['hitId','anchorId','ruleId','name','offset','end','line','original','suggestionHint']);
    for(const key of ['hitId','anchorId','ruleId','name','original','suggestionHint'])string(h[key]);for(const key of ['offset','end','line'])integer(h[key]);
    const p=anchors.get(String(h.anchorId));
    if(!p||Number(h.offset)<p.start||Number(h.end)>p.end||Number(h.line)<1||!String(h.original)||[...String(h.original)].length>=30||p.text.slice(Number(h.offset)-p.start,Number(h.end)-p.start)!==h.original||ids.has(String(h.hitId)))throw new Error('Invalid LINT hit evidence.');ids.add(String(h.hitId));
  }
  return scan as unknown as NovelLintScan;
}
export function parseNovelLintReview(value:unknown):{sourceHash:string;replacements:LintReplacement[]} {
  const result=record(value,['sourceHash','replacements']);hash(result.sourceHash);if(!Array.isArray(result.replacements)||result.replacements.length>5000)throw new Error('Invalid LINT suggestions.');
  const ids=new Set<string>();for(const raw of result.replacements){const item=record(raw,['hitId','anchorId','original','suggestion']);for(const key of ['hitId','anchorId','original','suggestion'])string(item[key]);
    if(!String(item.original)||[...String(item.original)].length>=30||[...String(item.suggestion)].length>120||/[\r\n]/u.test(String(item.suggestion))||ids.has(String(item.hitId)))throw new Error('Invalid LINT suggestion.');ids.add(String(item.hitId));}
  return result as unknown as {sourceHash:string;replacements:LintReplacement[]};
}
