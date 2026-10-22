export interface ForgeOption { label: string; detail?: string; sample?: string }
export interface ForgeQuestion { id: string; title: string; why: string; kind: 'single' | 'multi' | 'taste'; options: ForgeOption[] }
export interface ForgeBriefItem { key: string; label: string; value: string; by: 'user' | 'assistant'; locked?: boolean }
export interface ForgeBrief { title: string; readiness: number; items: ForgeBriefItem[]; openPoints: string[] }
export interface ForgeDraft {
  schemaVersion: 1; id: string; revision: number; idea: string;
  stage: 'discuss' | 'plan' | 'written' | 'proposed';
  brief: ForgeBrief; questions: ForgeQuestion[]; reply: string;
  plan?: Record<string, unknown>; chunks?: Record<string, string>;
  pendingActionId?: string; sourcePaths?: string[];
}
export interface ForgeMutation { expectedWorkspaceRoot: string; expectedRevision: number }
export interface ForgeClientMethods {
  listForgeDrafts(): Promise<{ drafts: ForgeDraft[] }>;
  readForgeDraft(id: string): Promise<{ draft: ForgeDraft }>;
  createForgeDraft(input: { idea: string; expectedWorkspaceRoot: string }): Promise<{ draft: ForgeDraft }>;
  discussForgeDraft(id: string, input: ForgeMutation & { message: string }): Promise<{ draft: ForgeDraft }>;
  updateForgeDraft(id: string, input: ForgeMutation & { edits?: Array<{ key: string; value: string; label?: string; locked?: boolean }>; plan?: Record<string, unknown> }): Promise<{ draft: ForgeDraft }>;
  planForgeDraft(id: string, input: ForgeMutation): Promise<{ draft: ForgeDraft }>;
  writeForgeDraft(id: string, input: ForgeMutation): Promise<{ draft: ForgeDraft }>;
  proposeForgeDraft(id: string, input: ForgeMutation): Promise<{ draft: ForgeDraft; pendingActionId: string }>;
  handoffForgeDraft(id: string, input: ForgeMutation & { mode: 'play' | 'writing' }): Promise<{ draft: ForgeDraft; sessionId?: string; sourcePaths?: string[] }>;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function required(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid Forge response.'); }
export function parseForgeDraft(value: unknown): ForgeDraft {
  required(record(value) && value.schemaVersion === 1 && typeof value.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(value.id)
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && typeof value.idea === 'string'
    && ['discuss', 'plan', 'written', 'proposed'].includes(String(value.stage)) && typeof value.reply === 'string');
  const brief = value.brief;
  required(record(brief) && typeof brief.title === 'string' && typeof brief.readiness === 'number'
    && Number.isFinite(brief.readiness) && brief.readiness >= 0 && brief.readiness <= 100 && strings(brief.openPoints)
    && Array.isArray(brief.items));
  for (const item of brief.items) required(record(item) && typeof item.key === 'string' && typeof item.label === 'string'
    && typeof item.value === 'string' && ['user', 'assistant'].includes(String(item.by)) && (item.locked === undefined || typeof item.locked === 'boolean'));
  required(Array.isArray(value.questions));
  for (const question of value.questions) {
    required(record(question) && typeof question.id === 'string' && typeof question.title === 'string' && typeof question.why === 'string'
      && ['single', 'multi', 'taste'].includes(String(question.kind)) && Array.isArray(question.options));
    for (const option of question.options) required(record(option) && typeof option.label === 'string'
      && (option.sample === undefined || typeof option.sample === 'string') && (option.detail === undefined || typeof option.detail === 'string'));
  }
  required(value.plan === undefined || record(value.plan));
  required(value.chunks === undefined || (record(value.chunks) && Object.values(value.chunks).every(item => typeof item === 'string')));
  required(value.pendingActionId === undefined || typeof value.pendingActionId === 'string');
  required(value.sourcePaths === undefined || strings(value.sourcePaths));
  return value as unknown as ForgeDraft;
}
export function createForgeClientMethods(request: <T>(path: string, options?: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown }) => Promise<T>): ForgeClientMethods {
  const route = (id: string) => { if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid Forge id.'); return `/api/forge/drafts/${encodeURIComponent(id)}`; };
  const envelope = (value: unknown) => { required(record(value)); return { draft: parseForgeDraft(value.draft) }; };
  const mutate = (id: string, action: string, input: unknown, method: 'POST' | 'PATCH' = 'POST') => request<unknown>(`${route(id)}${action}`, { method, body: input }).then(envelope);
  return {
    listForgeDrafts: async () => { const result = await request<unknown>('/api/forge/drafts'); required(record(result) && Array.isArray(result.drafts)); return { drafts: result.drafts.map(parseForgeDraft) }; },
    readForgeDraft: id => request<unknown>(route(id)).then(envelope),
    createForgeDraft: input => request<unknown>('/api/forge/drafts', { method: 'POST', body: input }).then(envelope),
    discussForgeDraft: (id, input) => mutate(id, '/discuss', input),
    updateForgeDraft: (id, input) => mutate(id, '', input, 'PATCH'),
    planForgeDraft: (id, input) => mutate(id, '/plan', input),
    writeForgeDraft: (id, input) => mutate(id, '/write', input),
    proposeForgeDraft: async (id, input) => { const result = await request<unknown>(`${route(id)}/propose`, { method: 'POST', body: input }); required(record(result) && typeof result.pendingActionId === 'string'); return { ...envelope(result), pendingActionId: result.pendingActionId }; },
    handoffForgeDraft: async (id, input) => {
      const result = await request<unknown>(`${route(id)}/handoff`, { method: 'POST', body: input }); required(record(result));
      required(result.sessionId === undefined || typeof result.sessionId === 'string'); required(result.sourcePaths === undefined || strings(result.sourcePaths));
      return { ...envelope(result), ...(typeof result.sessionId === 'string' ? { sessionId: result.sessionId } : {}), ...(strings(result.sourcePaths) ? { sourcePaths: result.sourcePaths } : {}) };
    },
  };
}
