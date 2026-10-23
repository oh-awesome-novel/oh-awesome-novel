import { saveCanonicalWritingSources } from './canonical-writing-selection.js';
import { selectCanonicalWritingSourcePaths } from './canonical-writing-context.js';
import { freezePlayPermanentContext } from './play-frozen-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Context } from 'hono';
import { generateForgeText } from '@oh-awesome-novel/agent';
import {
  attachPlayCharacterRoster, addPlayTranscriptTurn, applyForgeBriefEdits, applyNovelLintReplacements, createEmptyForgeBrief,
  createPlaySessionDraft, FORGE_CHUNK_KINDS, formatForgeDiscussPrompt, formatForgePlanPrompt,
  formatForgeWriterPrompt, formatNovelLintReviewPrompt, parseForgeDiscussResponse, parseForgePlan,
  parseForgeWriterResponse, scanNovelLint, writePlaySessionFiles, readPlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { ForgeDraft, ForgePlan, LlmProviderConfig } from '@oh-awesome-novel/core';
import type { AiSdkProviderResolver } from '@oh-awesome-novel/agent';
import {
  createCandidateChangeSetBuilder, createWorkspaceChangePolicy, createWorkspaceProjection,
  readRepositoryBaseline, validateCandidateChangeSetAgainstPolicy, createPendingActionStore,
} from '@oh-awesome-novel/tools';
import type { PendingAction, PendingActionStore, PreparedChangePreviewV1 } from '@oh-awesome-novel/tools';
import { assertForgeId, listForgeDrafts, readForgeDraft, saveForgeDraft, withForgeDraftLock } from './forge-store.js';

export interface ForgeHandlerOptions {
  getWorkspaceRoot(): string;
  getStore(root: string): Promise<PendingActionStore>;
  getModelRuntime(): Promise<{providerConfig: LlmProviderConfig; resolveModel: AiSdkProviderResolver}>;
  generate?(prompt: string, signal: AbortSignal): Promise<string>;
}
export function createForgeHandlers(options: ForgeHandlerOptions) {
  async function generate(prompt: string, signal: AbortSignal, workspaceRoot: string): Promise<string> {
    signal.throwIfAborted();
    if (options.getWorkspaceRoot() !== workspaceRoot) throw new Error('Workspace changed; reopen Forge.');
    if (options.generate) return options.generate(prompt, signal);
    const runtime = await options.getModelRuntime();
    return generateForgeText({prompt,workspaceRoot,providerConfig:runtime.providerConfig,resolveModel:runtime.resolveModel,abortSignal:signal});
  }
  function workspace(root: string, body: Record<string, unknown>) {
    if (options.getWorkspaceRoot() !== root || body.expectedWorkspaceRoot !== root) throw new Error('Workspace changed; reopen Forge.');
  }
  async function operation(context: Context, id: string, name: string): Promise<Response> {
    try {
      assertForgeId(id); const root = options.getWorkspaceRoot(); const body = await request(context);
      workspace(root, body);
      return await withForgeDraftLock(root, id, async () => {
        let draft = await readForgeDraft(root, id);
        if (body.expectedRevision !== draft.revision) throw new Error('Stale Forge revision; reload the draft.');
        const signal = context.req.raw.signal;
        if (name === 'handoff') {
          if (!draft.pendingActionId || !draft.plan) throw new Error('Accept the generated files before continuing.');
          const store = await options.getStore(root);
          const record = await store.readRecord(draft.pendingActionId);
          if (record.status !== 'accepted') throw new Error('Accept the generated files before continuing.');
          const sourcePaths = draft.sourcePaths ?? [];
          const current = await createWorkspaceProjection({ workspaceRoot: root, rules: sourcePaths.map(path => ({kind:'exact' as const,path})) });
          for (const change of record.action.changes) {
            if (change.operation === 'delete') throw new Error('Invalid Forge handoff.');
            const file = current.baselineFiles.find(f => f.path === change.path);
            if (!file || createHash('sha256').update(file.content).digest('hex') !== change.draft.sha256) throw new Error('Accepted Forge files changed; review the current setting before starting.');
          }
          workspace(root, body);
          if (body.mode === 'writing') {
            const selectedPaths = await saveCanonicalWritingSources(root, selectCanonicalWritingSourcePaths(sourcePaths));
            return context.json({ draft, sourcePaths: selectedPaths });
          }
          if (body.mode !== 'play') throw new Error('Unknown Forge handoff.');
          const sessionId = `play_${draft.id.slice(6)}`;
          let session = createPlaySessionDraft({ id: sessionId, title: draft.plan.title,
            sceneStart: draft.plan.opening.slice(0,2000), characters: draft.plan.characters.map(c => c.name),
            activatedSources: sourcePaths.filter(p => p.endsWith('.md')).map((path, index) => ({sourceId:`forge-${index}`,path,
              reason:'Author-approved Forge setting',contentHash:createHash('sha256').update(current.baselineFiles.find(file=>file.path===path)!.content).digest('hex'),role:path.startsWith('characters/')?'character':'world',trust:'canonical', budgetLayer:'L2', semanticBoundary:'compressible'})) });
          await attachPlayCharacterRoster(root,session);
          session = addPlayTranscriptTurn(session, { speaker: 'narrator', content: draft.chunks?.opening ?? draft.plan.opening, createdAt:new Date().toISOString() });
          session.metadataExtensions.forge = {draftId:draft.id, revision:draft.revision};
          await freezePlayPermanentContext(root,session,current.baselineFiles.filter(file=>/characters\/[^/]+\/profile\.md$/.test(file.path)).map(file=>`## ${file.path}\n${file.content}`).join('\n\n'));
          try { await writePlaySessionFiles(root, session, {expectedAbsent:true}); }
          catch (error) { const existing = await readPlaySessionFiles(root, sessionId).catch(() => undefined); if (!existing || !isDeepStrictEqual(existing.metadataExtensions.forge,session.metadataExtensions.forge)) throw error; }
          return context.json({ draft, sessionId, sourcePaths });
        }
        if (draft.pendingActionId) {
          const store = await options.getStore(root);
          const record = await store.readRecord(draft.pendingActionId).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT' || error.code === 'PENDING_ACTION_NOT_FOUND') return undefined;
            throw error;
          });
          if (!record || (record.status === 'pending' && name === 'propose')) {
            // Recover a crash between durable preview creation and promotion.
            const preview = await store.readPreparedChangePreview(draft.pendingActionId);
            await assertForgePreviewFresh(root,preview);
            await store.promotePreparedChangePreview({id:preview.id,title:'设定共创工坊：审查并入库',description:'审查角色、舞台和开场白的文件差异。',source:{kind:'deterministic-builder',producer:'setting-forge',capability:'novel.multi-file-edit'},origin:preview.origin,allowedTargets:preview.allowedTargets});
            return context.json({draft,pendingActionId:preview.id});
          }
          if (record.status === 'pending') throw new Error('Resolve the pending review before changing this draft.');
          if (record.status === 'accepted') throw new Error('This setting was accepted. Start a new draft for further changes.');
          delete draft.pendingActionId; draft.stage = draft.chunks ? 'written' : 'plan';
        }
        if (name === 'discuss') {
          const message = text(body.message, 12000);
          const authorStatements = [message];
          if (body.selection !== undefined) {
            const selection = body.selection as {questionId?: unknown; optionIndices?: unknown};
            if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('Invalid Forge selection.');
            const question = draft.questions.find(question => question.id === selection.questionId);
            const indices = selection.optionIndices;
            if (!question || !Array.isArray(indices) || indices.length < 1 || indices.length > question.options.length
              || new Set(indices).size !== indices.length || (question.kind !== 'multi' && indices.length !== 1)
              || indices.some(index => !Number.isInteger(index) || index < 0 || index >= question.options.length)) throw new Error('Invalid Forge selection.');
            // Resolve labels and samples from the current host-owned draft; request text cannot forge them.
            authorStatements.push(...indices.flatMap(index => { const option = question.options[index]!; return [option.label, option.sample, ...(option.detail ? [option.detail] : [])]; }));
          }
          const result = parseForgeDiscussResponse(await generate(`${formatForgeDiscussPrompt(draft.brief)}\n作者最初想法：${draft.idea}\n作者本轮回答：${message}\n作者已确认的完整原文表达（草图引用时保留完整原句，不截取否定句）：${JSON.stringify(authorStatements)}`,signal,root), draft.brief, authorStatements);
          draft = {...draft,...result, stage:'discuss'}; delete draft.plan; delete draft.chunks;
        } else if (name === 'edit') {
          if (body.edits !== undefined) {
            if (!Array.isArray(body.edits) || body.edits.length > 10) throw new Error('Invalid brief edits.');
            draft.brief = applyForgeBriefEdits(draft.brief, body.edits as Parameters<typeof applyForgeBriefEdits>[1]);
            delete draft.plan; draft.stage = 'discuss';
          }
          if (body.plan !== undefined) { draft.plan = parseForgePlan(body.plan); draft.stage = 'plan'; }
          delete draft.chunks;
        } else if (name === 'plan') {
          draft.plan = parseForgePlan(await generate(formatForgePlanPrompt(draft.brief),signal,root));
          draft.stage = 'plan'; delete draft.chunks;
        } else if (name === 'write') {
          if (!draft.plan) throw new Error('Review a plan before writing.');
          const plan = draft.plan;
          const chunks: Record<string,string> = {};
          // Bounded pipeline: a failed/aborted chunk never advances the stored revision.
          for (const kind of FORGE_CHUNK_KINDS) {
            let content = parseForgeWriterResponse(await generate(formatForgeWriterPrompt(plan,kind),signal,root));
            const scan = scanNovelLint(content);
            if (scan.hits.length) {
              const raw = await generate(formatNovelLintReviewPrompt(content),signal,root);
              const replacements: unknown = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/u,'').replace(/\s*```\s*$/u,''));
              content = applyNovelLintReplacements(content,scan.sourceHash,replacements);
            }
            chunks[kind] = content;
          }
          draft.chunks = chunks; draft.stage = 'written';
        } else if (name === 'propose') {
          if (!draft.plan || !draft.chunks) throw new Error('Generate and review all writing blocks first.');
          const files = forgeCanonicalFiles(draft.plan,draft.chunks);
          const projection = await createWorkspaceProjection({workspaceRoot:root,rules:files.map(f=>({kind:'exact' as const,path:f.path}))});
          // Never silently overwrite an existing character/place. World rules are shown as an explicit diff.
          const existing = new Set(projection.baselineFiles.map(f=>f.path));
          if (files.some(f=>f.path !== 'world/rules.md' && existing.has(f.path))) throw new Error('A generated character or place already exists. Change its id in the plan.');
          const id = `pa_${randomUUID()}`;
          const builder = createCandidateChangeSetBuilder({sessionId:draft.id,producer:'setting-forge',capability:'novel.multi-file-edit',repository:await readRepositoryBaseline(root),baselineFiles:projection.baselineFiles});
          for (const file of files) builder.write(file.path,file.content);
          const candidate = builder.finalize(); if (!candidate) throw new Error('No setting changes.');
          const allowedTargets = files.map(f=>f.path);
          validateCandidateChangeSetAgainstPolicy(candidate,createWorkspaceChangePolicy({capability:'novel.multi-file-edit',exactWritablePaths:allowedTargets}));
          const origin = {kind:'forge' as const,draftId:draft.id,revision:draft.revision+1,previewId:id};
          const store = await options.getStore(root);
          await store.prepareChangePreview({id,candidate,origin,allowedTargets});
          draft = {...draft,revision:origin.revision,stage:'proposed',pendingActionId:id,sourcePaths:allowedTargets};
          workspace(root,body); await saveForgeDraft(root,draft);
          await store.promotePreparedChangePreview({id,title:'设定共创工坊：审查并入库',description:'审查角色、舞台和开场白的文件差异。',source:{kind:'deterministic-builder',producer:'setting-forge',capability:'novel.multi-file-edit'},origin,allowedTargets});
          return context.json({draft,pendingActionId:id});
        } else throw new Error('Unknown Forge operation.');
        signal.throwIfAborted(); workspace(root,body);
        draft.revision += 1; await saveForgeDraft(root,draft);
        return context.json({draft});
      });
    } catch (error) { return failure(context,error); }
  }
  return {
    operation,
    async list(context: Context) { try { return context.json({drafts:await listForgeDrafts(options.getWorkspaceRoot())}); } catch(e) {return failure(context,e);} },
    async get(context: Context,id:string) { try { return context.json({draft:await readForgeDraft(options.getWorkspaceRoot(),id)}); } catch(e) {return failure(context,e);} },
    async create(context: Context) {
      try {
        const root=options.getWorkspaceRoot(); const body=await request(context); workspace(root,body);
        const idea=text(body.idea,12000); const id=`forge_${randomUUID()}`;
        const brief=applyForgeBriefEdits(createEmptyForgeBrief(),[{key:'play',label:'作者最初想法',value:idea}]);
        const draft:ForgeDraft={schemaVersion:1,id,revision:0,idea,stage:'discuss',brief,questions:[],reply:'说说你想创造的角色与舞台。'};
        const result=parseForgeDiscussResponse(await generate(`${formatForgeDiscussPrompt(brief)}\n作者想法：${idea}`,context.req.raw.signal,root),brief,[idea]);
        Object.assign(draft,result); workspace(root,body); await saveForgeDraft(root,draft); return context.json({draft},201);
      } catch(e) {return failure(context,e);}
    },
  };
}

export function forgeCanonicalFiles(plan: ForgePlan,chunks:Record<string,string>):Array<{path:string;content:string}> {
  const files:Array<{path:string;content:string}>=[];
  const markdown=(title:string,value:unknown)=>`# ${title}\n\n${typeof value==='string'?value:JSON.stringify(value,null,2)}\n`;
  for (const character of plan.characters) {
    const base=`characters/${character.id}`;
    files.push({path:`${base}/meta.yaml`,content:JSON.stringify({id:character.id,displayName:character.name,aliases:character.aliases})});
    files.push({path:`${base}/profile.md`,content:markdown(character.name,{character,writing:chunks.characters,facets:chunks.facets,clarifications:chunks.clarifications})});
    files.push({path:`${base}/summary.md`,content:markdown(character.name,`${character.desire.goal}\n${character.desire.obstacle}\n${character.desire.cost}`)});
    files.push({path:`${base}/roster-profile.yaml`,content:JSON.stringify({id:character.id,name:character.name,aliases:character.aliases,genderKind:'other',isPlayer:false,looks:{fixedBooruTags:'',outfitDescription:'',outfitTags:''}})});
  }
  for (const place of plan.places) files.push({path:`world/places/${place.id}.md`,content:markdown(place.name,{place,writing:chunks.places})});
  files.push({path:'world/rules.md',content:markdown(plan.title,{world:plan.world,writing:chunks.world})});
  files.push({path:`world/openings/${plan.characters[0]!.id}.md`,content:markdown('开场白',chunks.opening!)});
  return files;
}
export async function assertForgePreviewFresh(root:string,preview:PreparedChangePreviewV1):Promise<void> {
  const origin=preview.origin;
  if(origin.kind!=='forge'||origin.previewId!==preview.id||preview.capability!=='novel.multi-file-edit') throw new Error('Invalid Forge preview binding.');
  const draft=await readForgeDraft(root,origin.draftId);
  if(draft.revision!==origin.revision||draft.pendingActionId!==preview.id||draft.stage!=='proposed'||!isDeepStrictEqual([...draft.sourcePaths!].sort(),[...preview.allowedTargets].sort())) throw new Error('Stale Forge preview; review the setting again.');
}
export async function assertForgeActionFresh(root:string,action:PendingAction):Promise<void> {
  if(action.origin?.kind!=='forge'||action.source.kind!=='deterministic-builder'||action.source.producer!=='setting-forge') throw new Error('Invalid Forge action.');
  const store=await createPendingActionStore({workspaceRoot:root});
  const preview=await store.readPreparedChangePreview(action.origin.previewId);
  await assertForgePreviewFresh(root,preview);
  if(!isDeepStrictEqual(action.origin,preview.origin)||!isDeepStrictEqual(action.repository,preview.repository)||!isDeepStrictEqual(action.allowedTargets,preview.allowedTargets)||!isDeepStrictEqual(action.preview,preview.preview)||!isDeepStrictEqual(action.changes.map(c=>({path:c.path,operation:c.operation,baseline:c.baseline,hash:c.draft?.sha256,bytes:c.draft?.byteLength})),preview.changes.map(c=>({path:c.path,operation:c.operation,baseline:c.baseline,hash:c.draft?.sha256,bytes:c.draft?.byteLength})))) throw new Error('Forge action does not match its immutable preview.');
}
async function request(context:Context):Promise<Record<string,unknown>> {
  const reader=context.req.raw.body?.getReader(); if(!reader) throw new Error('Forge request body required.');
  const chunks:Uint8Array[]=[]; let size=0;
  try { for (;;) { const part=await reader.read(); if(part.done)break; size+=part.value.byteLength;
    if(size>2*1024*1024){await reader.cancel();throw new Error('Forge request too large.');} chunks.push(part.value);
  }} finally {reader.releaseLock();}
  const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  if(!body||typeof body!=='object'||Array.isArray(body)) throw new Error('Invalid Forge request.'); return body as Record<string,unknown>;
}
function text(value:unknown,max:number):string {if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('A bounded nonempty text value is required.');return value.trim();}
function failure(context:Context,error:unknown):Response {const message=error instanceof Error?error.message:'Forge request failed.';return context.json({error:message,code:'forge_request_failed'},/stale|changed|busy|pending review/i.test(message)?409:422);}
