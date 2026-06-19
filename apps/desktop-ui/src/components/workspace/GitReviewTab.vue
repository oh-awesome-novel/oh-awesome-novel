<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';

import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import type {
  GitCommitDetail,
  GitCommitSummary,
  GitWorkspaceStatus,
} from '../../composables/useWorkspaceApi';

const api = useWorkspaceApi();
const status = shallowRef<GitWorkspaceStatus>();
const commits = shallowRef<GitCommitSummary[]>([]);
const selectedCommit = shallowRef<GitCommitDetail>();
const dirtyDiff = shallowRef('');
const loading = shallowRef(false);
const error = shallowRef('');
const commitMessage = shallowRef('chore(novel): manual quick commit');
const syncStatus = shallowRef('');

onMounted(() => {
  void refreshGit();
});

async function refreshGit() {
  loading.value = true;
  error.value = '';

  try {
    const [nextStatus, log] = await Promise.all([
      api.getGitStatus(),
      api.getGitLog(12),
    ]);
    status.value = nextStatus;
    commits.value = log.commits;
    dirtyDiff.value = nextStatus.files.length
      ? (await api.getGitDiff(nextStatus.files.map((file) => file.path))).diff
      : '';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function showCommit(hash: string) {
  error.value = '';

  try {
    selectedCommit.value = await api.getGitCommit(hash);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function quickCommit() {
  error.value = '';
  try {
    const result = await api.quickCommit({
      files: status.value?.files.map((file) => file.path),
      message: commitMessage.value,
    });
    if (result.status !== 'committed') {
      error.value = result.status === 'failed' ? result.error.message : result.reason;
      return;
    }
    await refreshGit();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function sync() {
  syncStatus.value = 'Syncing...';
  error.value = '';

  try {
    const result = await api.syncGit();
    syncStatus.value = result.status === 'synced'
      ? 'Synced'
      : `${result.step}: ${result.error.message}`;
    await refreshGit();
  } catch (caught) {
    syncStatus.value = '';
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}
</script>

<template>
  <section class="right-tab-panel" aria-label="Git history and sync">
    <div class="panel-heading">
      <h2 class="panel-title">Git</h2>
      <button class="ghost-button tight-button" type="button" @click="refreshGit">Refresh</button>
    </div>
    <p v-if="loading" class="empty-copy">Reading Git status...</p>
    <p v-if="error" class="error-copy">{{ error }}</p>

    <div v-if="status" class="git-status-stack">
      <div class="home-health-panel">
        <div class="status-block">
          <span>Source</span>
          <strong>{{ status.source }}</strong>
        </div>
        <div class="status-block">
          <span>Branch</span>
          <strong>{{ status.branch ?? '-' }}</strong>
        </div>
        <div class="status-block">
          <span>Status</span>
          <strong>{{ status.status }}</strong>
        </div>
        <div class="status-block">
          <span>Dirty files</span>
          <strong>{{ status.files.length }}</strong>
        </div>
      </div>

      <p v-if="status.error" class="error-copy">{{ status.error.message }}</p>

      <div v-if="status.files.length" class="git-file-list">
        <div v-for="file in status.files" :key="file.path" class="git-file-row">
          <span>{{ file.raw.slice(0, 2) }}</span>
          <strong>{{ file.path }}</strong>
        </div>
      </div>

      <pre v-if="dirtyDiff" class="diff-preview">{{ dirtyDiff }}</pre>

      <div class="quick-commit-box">
        <label class="field">
          Commit message
          <input v-model="commitMessage" class="text-input" type="text">
        </label>
        <div class="pending-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="!status.files.length"
            @click="quickCommit"
          >
            Commit dirty files
          </button>
          <button class="secondary-button" type="button" @click="sync">Sync</button>
        </div>
        <p v-if="syncStatus" class="empty-copy">{{ syncStatus }}</p>
      </div>
    </div>

    <div class="git-log-list">
      <button
        v-for="commit in commits"
        :key="commit.hash"
        class="git-log-row"
        type="button"
        @click="showCommit(commit.hash)"
      >
        <strong>{{ commit.subject }}</strong>
        <span>{{ commit.shortHash }} · {{ commit.authoredAt }}</span>
      </button>
    </div>

    <article v-if="selectedCommit" class="git-commit-detail">
      <div class="panel-heading">
        <h3 class="panel-title">{{ selectedCommit.subject }}</h3>
        <span class="status-pill">{{ selectedCommit.shortHash }}</span>
      </div>
      <div class="git-file-list">
        <div v-for="file in selectedCommit.files" :key="`${file.status}:${file.path}`" class="git-file-row">
          <span>{{ file.status }}</span>
          <strong>{{ file.path }}</strong>
        </div>
      </div>
      <pre class="diff-preview">{{ selectedCommit.diff }}</pre>
    </article>
  </section>
</template>
