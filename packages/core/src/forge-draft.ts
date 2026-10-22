import { forgeRecord, forgeString, forgeStrings, forgeArray, parseForgeBrief } from './forge-discuss.js';
import { parseForgePlan } from './forge-plan.js';
import { FORGE_CHUNK_KINDS, type ForgeDraft, type ForgeQuestion } from './forge-types.js';
export function parseForgeDraft(value: unknown): ForgeDraft {
  const d = forgeRecord(value);
  if (d.schemaVersion !== 1 || !Number.isSafeInteger(d.revision) || Number(d.revision) < 0 || !['discuss','plan','written','proposed'].includes(String(d.stage))) throw new Error('Invalid Forge draft version/state.');
  const id = forgeString(d.id, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid Forge draft id.');
  const questions = forgeArray(d.questions, 0, 3).map(raw => {
    const q = forgeRecord(raw);
    if (!['single', 'multi', 'taste'].includes(String(q.kind))) throw new Error('Invalid question kind.');
    return { id: forgeString(q.id, 100), title: forgeString(q.title, 300), why: forgeString(q.why, 300), kind: q.kind as ForgeQuestion['kind'], options: forgeArray(q.options, 2, 8).map(rawOption => { const o = forgeRecord(rawOption); return { label: forgeString(o.label, 100), sample: forgeString(o.sample, 1000), ...(o.detail === undefined ? {} : { detail: forgeString(o.detail, 300) }) }; }) };
  });
  if (typeof d.reply !== 'string' || d.reply.length > 20_000) throw new Error('Invalid Forge reply.');
  const draft: ForgeDraft = { schemaVersion: 1, id, revision: d.revision as number, idea: forgeString(d.idea), stage: d.stage as ForgeDraft['stage'], brief: parseForgeBrief(d.brief), questions, reply: d.reply };
  if (d.plan !== undefined) draft.plan = parseForgePlan(d.plan);
  if (d.chunks !== undefined) {
    draft.chunks = {};
    for (const [key, value] of Object.entries(forgeRecord(d.chunks))) {
      if (!(FORGE_CHUNK_KINDS as readonly string[]).includes(key)) throw new Error('Unknown Forge chunk.');
      draft.chunks[key] = forgeString(value, 100_000);
    }
  }
  if (d.pendingActionId !== undefined) draft.pendingActionId = forgeString(d.pendingActionId, 200);
  if (d.sourcePaths !== undefined) {
    draft.sourcePaths = forgeStrings(d.sourcePaths, 0, 100);
    if (draft.sourcePaths.some(path => !/^(characters|world)\/[a-zA-Z0-9_/-]+\.(md|yaml)$/.test(path) || path.includes('..'))) throw new Error('Invalid Forge source path.');
  }
  if (draft.stage !== 'discuss' && !draft.plan) throw new Error('Plan missing.');
  if (['written', 'proposed'].includes(draft.stage) && FORGE_CHUNK_KINDS.some(kind => !draft.chunks?.[kind])) throw new Error('Written chunks missing.');
  if (draft.stage === 'proposed' && !draft.pendingActionId) throw new Error('Proposal action missing.');
  return draft;
}
