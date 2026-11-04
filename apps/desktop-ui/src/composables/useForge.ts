import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue';
import type { ForgeBrief, ForgeDraft } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from './useWorkspaceApi';

/** The paths listed by a `forge_files_changed` handoff refusal, if that is what `cause` is. */
export function forgeChangedPaths(cause: unknown): string[] | undefined {
  const value = cause as { code?: unknown; details?: { paths?: unknown } } | undefined;
  if (value?.code !== 'forge_files_changed' || !Array.isArray(value.details?.paths)) return undefined;
  return value.details.paths.filter((path): path is string => typeof path === 'string');
}

export function useForge(options: {
  workspaceRoot: Ref<string>;
  onPendingAction(id: string): void;
  onPlaySession(id: string): void;
  onWritingReferences(paths: string[]): void;
}) {
  const api = useWorkspaceApi();
  const draft = shallowRef<ForgeDraft>();
  const drafts = shallowRef<ForgeDraft[]>([]);
  const busy = shallowRef(false);
  const error = shallowRef('');
  const accepted = shallowRef(false);
  const pendingStatus = shallowRef('');
  /** Accepted files the author edited after review; handoff waits for an explicit confirmation. */
  const changedFiles = shallowRef<string[]>([]);
  let epoch = 0;
  const canHandoff = computed(() => accepted.value && !busy.value);
  onBeforeUnmount(() => { epoch++; });
  watch(options.workspaceRoot, () => { epoch++; changedFiles.value = []; draft.value = undefined; drafts.value = []; accepted.value = false; pendingStatus.value = ''; busy.value = false; error.value = ''; void refreshList(); }, { immediate: true });
  async function run(action: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true; error.value = '';
    const current = epoch;
    try { await action(); }
    catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (current === epoch) busy.value = false; }
  }
  async function refreshList() {
    const current = epoch;
    await run(async () => { const result = await api.listForgeDrafts(); if (current === epoch) drafts.value = result.drafts; });
  }
  async function read(id: string) {
    const current = epoch;
    await run(async () => { const result = await api.readForgeDraft(id); if (current === epoch) { draft.value = result.draft; accepted.value = false; pendingStatus.value = ''; changedFiles.value = []; } });
    if (current === epoch) await refreshApproval();
  }
  async function deleteDraft(id: string) {
    const selected = draft.value?.id === id ? draft.value : drafts.value.find(d => d.id === id);
    if (!selected) return;
    const current = epoch;
    await run(async () => {
      await api.deleteForgeDraft(id, { expectedRevision: selected.revision, expectedWorkspaceRoot: options.workspaceRoot.value });
      if (current === epoch) {
        drafts.value = drafts.value.filter(d => d.id !== id);
        if (draft.value?.id === id) {
          draft.value = undefined;
          accepted.value = false;
          pendingStatus.value = '';
        }
      }
    });
  }
  async function create(idea: string) {
    const current = epoch;
    await run(async () => { const result = await api.createForgeDraft({ idea, expectedWorkspaceRoot: options.workspaceRoot.value }); if (current === epoch) { draft.value = result.draft; accepted.value = false; pendingStatus.value = ''; drafts.value = [result.draft, ...drafts.value]; } });
  }
  async function mutate(action: 'discuss' | 'update' | 'plan' | 'write' | 'propose', extra: {
    selection?: {questionId: string; optionIndices: number[]};
    selections?: Array<{questionId: string; optionIndices: number[]}>;
    message?: string;
    brief?: ForgeBrief;
    plan?: Record<string, unknown>;
    chunks?: Record<string, string>;
    force?: boolean;
  } = {}) {
    const selected = draft.value; if (!selected) return;
    const current = epoch;
    const input = { expectedRevision: selected.revision, expectedWorkspaceRoot: options.workspaceRoot.value };
    await run(async () => {
      const result = action === 'discuss' ? await api.discussForgeDraft(selected.id, {
          ...input,
          message: extra.message ?? '',
          ...(extra.selections ? { selections: extra.selections } : extra.selection ? { selections: [extra.selection] } : {}),
        })
        : action === 'update' ? await api.updateForgeDraft(selected.id, {
            ...input,
            ...(extra.plan ? { plan: extra.plan } : {}),
            ...(extra.chunks ? { chunks: extra.chunks } : {}),
            ...(extra.brief ? { edits: extra.brief.items.filter(item => { const before = selected.brief.items.find(candidate => candidate.key === item.key); return !before || before.value !== item.value || before.locked !== item.locked; }).map(({ key, value, label, locked }) => ({ key, value, label, ...(locked !== undefined ? { locked } : {}) })) } : {}),
          })
        : action === 'plan' ? await api.planForgeDraft(selected.id, input)
        : action === 'write' ? await api.writeForgeDraft(selected.id, { ...input, ...(extra.force ? { force: true } : {}) })
        : await api.proposeForgeDraft(selected.id, input);
      if (current !== epoch) return;
      draft.value = result.draft; accepted.value = false; pendingStatus.value = '';
      drafts.value = drafts.value.map(item => item.id === result.draft.id ? result.draft : item);
      if (action === 'propose' && result.draft.pendingActionId) options.onPendingAction(result.draft.pendingActionId);
    });
  }
  async function refreshApproval() {
    const id = draft.value?.pendingActionId; if (!id) return;
    const current = epoch;
    await run(async () => { const result = await api.readPendingAction(id); if (current === epoch && draft.value?.pendingActionId === id) { accepted.value = result.pendingAction.status === 'accepted'; pendingStatus.value = result.pendingAction.status; } });
  }
  async function handoff(mode: 'play' | 'writing', acceptChangedFiles = false) {
    const selected = draft.value; if (!selected || !canHandoff.value) return;
    const current = epoch;
    await run(async () => {
      let result;
      try {
        result = await api.handoffForgeDraft(selected.id, { expectedRevision: selected.revision, expectedWorkspaceRoot: options.workspaceRoot.value, mode, ...(acceptChangedFiles ? { acceptChangedFiles: true } : {}) });
      } catch (cause) {
        const paths = forgeChangedPaths(cause);
        if (paths && current === epoch) changedFiles.value = paths;
        throw cause;
      }
      if (current !== epoch) return;
      changedFiles.value = [];
      draft.value = result.draft;
      if (mode === 'play' && result.sessionId) options.onPlaySession(result.sessionId);
      if (mode === 'writing') options.onWritingReferences(result.sourcePaths ?? []);
    });
  }
  return { draft, drafts, busy, error, accepted, pendingStatus, changedFiles, canHandoff, refreshList, read, create, deleteDraft, mutate, refreshApproval, handoff };
}
