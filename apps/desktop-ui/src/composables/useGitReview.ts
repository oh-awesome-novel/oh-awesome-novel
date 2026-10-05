import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import type { GitCommitDetail, GitCommitPreview, GitCommitSummary, GitWorkspaceStatus } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from './useWorkspaceApi';

/** Owns one workspace's review credential and suppresses every stale response. */
export function useGitReview(workspacePath: () => string) {
  const api = useWorkspaceApi();
  const status = shallowRef<GitWorkspaceStatus>();
  const commits = shallowRef<GitCommitSummary[]>([]);
  const selectedCommit = shallowRef<GitCommitDetail>();
  const dirtyDiff = shallowRef('');
  const loading = shallowRef(false);
  const error = shallowRef('');
  const commitMessage = shallowRef('chore(novel): manual quick commit');
  const syncStatus = shallowRef('');
  const preview = shallowRef<GitCommitPreview>();
  const retryIndex = shallowRef(false);
  let sequence = 0;
  let detailSequence = 0;
  const dirtyFiles = computed(() => status.value?.files.flatMap((file) => file.originalPath ? [file.originalPath, file.path] : [file.path]) ?? []);
  const previewReady = computed(() => Boolean(preview.value));
  async function refreshGit() {
    if (loading.value) return;
    const request = ++sequence; const workspace = workspacePath();
    loading.value = true; error.value = ''; preview.value = undefined; dirtyDiff.value = ''; retryIndex.value = false;
    try {
      const next = await api.getGitStatus();
      if (request !== sequence || workspace !== workspacePath()) return;
      status.value = next;
      const nextCommits = next.head ? (await api.getGitLog(12)).commits : [];
      if (request !== sequence || workspace !== workspacePath()) return;
      commits.value = nextCommits;
      const files = next.files.flatMap((file) => file.originalPath ? [file.originalPath, file.path] : [file.path]);
      const result = files.length ? await api.getGitDiff(files) : { diff: '', preview: null };
      if (request !== sequence || workspace !== workspacePath()) return;
      dirtyDiff.value = result.diff; preview.value = result.preview ?? undefined;
    } catch (cause) { if (request === sequence && workspace === workspacePath()) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (request === sequence) loading.value = false; }
  }
  async function quickCommit() {
    const reviewed = preview.value;
    if (!reviewed || loading.value) return;
    const request = ++sequence; const workspace = workspacePath();
    loading.value = true; error.value = '';
    try {
      const result = await api.quickCommit({ files: [...reviewed.files], message: commitMessage.value,
        previewId: reviewed.id, previewFingerprint: reviewed.fingerprint });
      if (request !== sequence || workspace !== workspacePath()) return;
      if (result.status !== 'committed') {
        preview.value = undefined;
        error.value = `${result.status === 'failed' ? result.error.message : result.reason} Refresh and review again before committing.`;
        return;
      }
      if (result.warning) { retryIndex.value = true; error.value = result.warning.message; return; }
      preview.value = undefined; loading.value = false; await refreshGit();
    } catch (cause) {
      if (request === sequence && workspace === workspacePath()) {
        preview.value = undefined;
        error.value = `${cause instanceof Error ? cause.message : String(cause)} Refresh Git status and review again before committing.`;
      }
    } finally { if (request === sequence) loading.value = false; }
  }
  async function showCommit(hash: string) {
    const request = ++detailSequence; const workspace = workspacePath();
    try { const result = await api.getGitCommit(hash); if (request === detailSequence && workspace === workspacePath()) selectedCommit.value = result; }
    catch (cause) { if (request === detailSequence && workspace === workspacePath()) error.value = cause instanceof Error ? cause.message : String(cause); }
  }
  async function sync() {
    if (loading.value) return;
    const request = ++sequence; const workspace = workspacePath();
    loading.value = true; preview.value = undefined; error.value = ''; syncStatus.value = 'Syncing...';
    try {
      const result = await api.syncGit();
      if (request !== sequence || workspace !== workspacePath()) return;
      syncStatus.value = result.status === 'synced' ? 'Synced' : `${result.step}: ${result.error.message}`;
      loading.value = false; await refreshGit();
    } catch (cause) { if (request === sequence && workspace === workspacePath()) { syncStatus.value = ''; error.value = cause instanceof Error ? cause.message : String(cause); } }
    finally { if (request === sequence) loading.value = false; }
  }
  watch(workspacePath, () => {
    ++sequence; ++detailSequence; status.value = undefined; commits.value = []; selectedCommit.value = undefined;
    preview.value = undefined; dirtyDiff.value = ''; loading.value = false; retryIndex.value = false; syncStatus.value = '';
    void refreshGit();
  }, { immediate: true, flush: 'sync' });
  onBeforeUnmount(() => { ++sequence; ++detailSequence; });
  return { status, commits, selectedCommit, dirtyDiff, loading, error, commitMessage, syncStatus, previewReady, dirtyFiles, retryIndex, refreshGit, quickCommit, showCommit, sync };
}
