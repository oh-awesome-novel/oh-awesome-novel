import { describe, expect, it, vi } from 'vite-plus/test';
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
  it('supports selections in discuss, chunks in update, and deleteForgeDraft', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ draft: { ...draft, revision: 1 } })
      .mockResolvedValueOnce({ draft: { ...draft, revision: 2, chunks: { opening: '夜。' } } })
      .mockResolvedValueOnce({ ok: true });
    const api = createForgeClientMethods(request);
    await api.discussForgeDraft('forge-one', {
      expectedRevision: 0,
      expectedWorkspaceRoot: '/novel',
      message: '好',
      selections: [{ questionId: 'q1', optionIndices: [0] }],
    });
    expect(request).toHaveBeenCalledWith('/api/forge/drafts/forge-one/discuss', {
      method: 'POST',
      body: { expectedRevision: 0, expectedWorkspaceRoot: '/novel', message: '好', selections: [{ questionId: 'q1', optionIndices: [0] }] },
    });
    await api.updateForgeDraft('forge-one', {
      expectedRevision: 1,
      expectedWorkspaceRoot: '/novel',
      chunks: { opening: '夜。' },
    });
    expect(request).toHaveBeenCalledWith('/api/forge/drafts/forge-one', {
      method: 'PATCH',
      body: { expectedRevision: 1, expectedWorkspaceRoot: '/novel', chunks: { opening: '夜。' } },
    });
    const del = await api.deleteForgeDraft('forge-one');
    expect(del).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith('/api/forge/drafts/forge-one', { method: 'DELETE' });
  });
});
