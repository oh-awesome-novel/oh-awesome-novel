import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {afterEach,describe,it,expect} from 'vitest';
import {MockLanguageModelV4} from 'ai/test';
import {createNovelHonoApp} from '@oh-awesome-novel/backend';
import type {NovelHonoApp} from '@oh-awesome-novel/backend';
import {scanNovelLint} from '@oh-awesome-novel/core';
const git=promisify(execFile),roots:string[]=[];const path='chapters/0001/0001.md';const source='# 第一章\n\n她仿佛听见铃声。\n\n伏笔必须保留。\n';
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
function post(app:NovelHonoApp,url:string,body?:unknown){return app.request(url,{method:'POST',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'oan-lint-'));roots.push(root);await mkdir(join(root,'chapters/0001'),{recursive:true});await mkdir(join(root,'.oan'));await writeFile(join(root,'.oan/config.yaml'),'version: 1\nnovelName: Test\ngit:\n  autoCommitOnAccept: false\n');await writeFile(join(root,path),source);await writeFile(join(root,'.gitignore'),'.workspace/\n');
 await git('git',['init','-b','main',root]);await git('git',['-C',root,'config','user.name','Test']);await git('git',['-C',root,'config','user.email','test@example.test']);await git('git',['-C',root,'add','.']);await git('git',['-C',root,'-c','commit.gpgsign=false','commit','-m','baseline']);
 const scan=scanNovelLint(source),hit=scan.hits[0]!;const replacement={hitId:hit.hitId,anchorId:hit.anchorId,original:hit.original,suggestion:'确实'};
 const model=new MockLanguageModelV4({doGenerate:async()=>({content:[{type:'text' as const,text:JSON.stringify([replacement])}],finishReason:{unified:'stop' as const,raw:'stop'},usage:{inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}},warnings:[]})});
 const app=createNovelHonoApp({workspaceRoot:root,providerConfig:{id:'lint-test',kind:'custom',model:'lint-test'},resolveModel:()=>model});
 return {root,app,scan,replacement,input:{path,expectedWorkspaceRoot:root}};
}
describe('Novel LINT approval journey',()=>{
 it('scans, obtains exact model suggestions, proposes selected span, reloads and accepts',async()=>{
  const {root,app,input,scan}=await fixture();const scanned=await post(app,'/api/workspace/novel-lint/scan',input);expect(scanned.status).toBe(200);expect((await scanned.json()).scan.hits).toHaveLength(1);
  const reviewed=await post(app,'/api/workspace/novel-lint/review',{...input,sourceHash:scan.sourceHash});expect(reviewed.status,await reviewed.clone().text()).toBe(200);const review=await reviewed.json();
  const proposed=await post(app,'/api/workspace/novel-lint/propose',{...input,...review});expect(proposed.status,await proposed.clone().text()).toBe(200);const {pendingAction}=await proposed.json();expect(JSON.stringify(pendingAction)).not.toContain('draftPath');expect(await readFile(join(root,path),'utf8')).toBe(source);
  const reopened=createNovelHonoApp({workspaceRoot:root});const accepted=await post(reopened,`/api/workspace/pending-actions/${pendingAction.id}/accept`);expect(accepted.status,await accepted.clone().text()).toBe(200);expect(await readFile(join(root,path),'utf8')).toBe(source.replace('仿佛','确实'));
 });
 it('rejects stale scans and stale pending baselines without modifying author bytes',async()=>{
  const {root,app,input,scan,replacement}=await fixture();const request={...input,sourceHash:scan.sourceHash,replacements:[replacement]};
  const response=await post(app,'/api/workspace/novel-lint/propose',request);expect(response.status,await response.clone().text()).toBe(200);const {pendingAction}=await response.json();
  await writeFile(join(root,path),source+'作者新增。');expect((await post(app,'/api/workspace/novel-lint/propose',request)).status).toBe(409);
  const accepted=await post(app,`/api/workspace/pending-actions/${pendingAction.id}/accept`);expect(accepted.status).not.toBe(200);expect(await readFile(join(root,path),'utf8')).toBe(source+'作者新增。');
 });
 it('rejects forged quote, traversal and cross paragraph replacements; cancel keeps original',async()=>{
  const {root,app,input,scan,replacement}=await fixture();for(const replacements of [[{...replacement,original:'胡编'}],[{...replacement,suggestion:'新\n段'}]])expect((await post(app,'/api/workspace/novel-lint/propose',{...input,sourceHash:scan.sourceHash,replacements})).status).toBe(400);
  expect((await post(app,'/api/workspace/novel-lint/scan',{...input,path:'chapters/../../.oan/config.yaml'})).status).toBe(400);
  const response=await post(app,'/api/workspace/novel-lint/propose',{...input,sourceHash:scan.sourceHash,replacements:[replacement]});const {pendingAction}=await response.json();expect((await post(app,`/api/workspace/pending-actions/${pendingAction.id}/reject`)).status).toBe(200);expect(await readFile(join(root,path),'utf8')).toBe(source);
 });
});
