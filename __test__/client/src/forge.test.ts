import { describe, expect, it, vi } from 'vitest';
import { createForgeClientMethods, parseForgeDraft } from '@oh-awesome-novel/client';
const draft = { schemaVersion: 1, id: 'forge-one', revision: 0, idea: '夜城', stage: 'discuss', reply: '', questions: [], brief: { title: '', readiness: 0, items: [], openPoints: [] } };
describe('Forge client boundaries', () => {
  it('rejects malformed provenance, revisions, readiness and paths', () => {
    expect(parseForgeDraft(draft)).toEqual(draft);
    for (const changed of [{ revision: -1 }, { id: '../secret' }, { brief: { ...draft.brief, readiness: 101 } }, { brief: { ...draft.brief, items: [{ key: 'lead', label: 'Lead', value: 'x', by: 'model' }] } }]) expect(() => parseForgeDraft({ ...draft, ...changed })).toThrow();
  });
  it('sends exact revision and workspace for proposal and parses the response', async () => {
    const request = vi.fn().mockResolvedValue({ draft: { ...draft, pendingActionId: 'pa-one' }, pendingActionId: 'pa-one' });
    const api = createForgeClientMethods(request); await api.proposeForgeDraft('forge-one', { expectedRevision: 0, expectedWorkspaceRoot: '/novel' });
    expect(request).toHaveBeenCalledWith('/api/forge/drafts/forge-one/propose', { method: 'POST', body: { expectedRevision: 0, expectedWorkspaceRoot: '/novel' } });
    expect(() => api.readForgeDraft('bad/path')).toThrow();
  });
});
