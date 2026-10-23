import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { scanNovelLint, validateNovelLintReplacements } from '@oh-awesome-novel/core';
import type { LintReplacement } from '@oh-awesome-novel/core';
import { createWorkspaceProjection, createNovelLintChangeProposal, novelLintCapability, readRepositoryBaseline } from '@oh-awesome-novel/tools';
import type { PendingActionStore } from '@oh-awesome-novel/tools';
export function createNovelLintHandlers(input:{ getWorkspaceRoot():string; getStore(root:string):Promise<PendingActionStore>;
  review(source:string,sourceHash:string,signal:AbortSignal,workspaceRoot:string,sourcePath:string):Promise<LintReplacement[]> }) {
  async function handle(context:Context,operation:'scan'|'review'|'propose'):Promise<Response> {
    try {
      const root = input.getWorkspaceRoot();
      if (Number(context.req.header('content-length')??0)>1024*1024) throw new Error('LINT request too large.');
      const raw = await context.req.text(); if(raw.length>1024*1024) throw new Error('LINT request too large.');
      const body:unknown = JSON.parse(raw);
      if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error('Invalid LINT request.');
      const request = body as Record<string,unknown>;
      if(typeof request.path!=='string' || request.expectedWorkspaceRoot!==root) throw new Error('Workspace changed; scan again.');
      novelLintCapability(request.path);
      const projection = await createWorkspaceProjection({workspaceRoot:root,rules:[{kind:'exact',path:request.path}]});
      const baseline = projection.baselineFiles.find(file=>file.path===request.path);
      if(!baseline) throw new Error('LINT source not found.');
      const scan=scanNovelLint(baseline.content);
      if(operation==='scan') return context.json({scan});
      if(request.sourceHash!==scan.sourceHash) return context.json({error:{code:'stale_lint_source',message:'Source changed; scan again.'}},409);
      if(operation==='review') {
        const replacements=await input.review(baseline.content,scan.sourceHash,context.req.raw.signal,root,request.path);
        await projection.assertFresh();
        if(root!==input.getWorkspaceRoot()) throw new Error('Workspace changed; scan again.');
        return context.json({sourceHash:scan.sourceHash,replacements:validateNovelLintReplacements(baseline.content,scan.sourceHash,replacements)});
      }
      const replacements=validateNovelLintReplacements(baseline.content,scan.sourceHash,request.replacements);
      await projection.assertFresh();
      if(context.req.raw.signal.aborted) throw new Error('LINT proposal cancelled.');
      const id=`pa_${randomUUID()}`;
      const proposal=createNovelLintChangeProposal({path:request.path,sourceHash:scan.sourceHash,replacements,repository:await readRepositoryBaseline(root),baselineFiles:[baseline],sessionId:id});
      if(!proposal) throw new Error('Select at least one changed suggestion.');
      if(root!==input.getWorkspaceRoot()) throw new Error('Workspace changed; scan again.');
      const store=await input.getStore(root);
      await store.prepareChangePreview({id,candidate:proposal.candidate,origin:proposal.origin,allowedTargets:proposal.allowedTargets});
      const pendingAction=await store.promotePreparedChangePreview({id,title:'微创去套话',description:'仅替换已选择的原文命中；请审查差异后确认。',source:{kind:'deterministic-builder',producer:'novel-lint',capability:novelLintCapability(request.path)},origin:proposal.origin,allowedTargets:proposal.allowedTargets});
      return context.json({pendingAction});
    } catch(error) { return context.json({error:{code:'invalid_lint_request',message:error instanceof Error?error.message:String(error)}},400); }
  }
  return {scan:(c:Context)=>handle(c,'scan'),review:(c:Context)=>handle(c,'review'),propose:(c:Context)=>handle(c,'propose')};
}
