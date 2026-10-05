<script setup lang="ts">
import { useGitReview } from '../../composables/useGitReview';
const props = withDefaults(defineProps<{ workspacePath?: string }>(), { workspacePath: '' });
const { status, commits, selectedCommit, dirtyDiff, loading, error, commitMessage, syncStatus, previewReady, dirtyFiles,
  retryIndex, refreshGit, showCommit, quickCommit, sync } = useGitReview(() => props.workspacePath);
</script>

<template>
  <section class="right-tab-panel" aria-label="Git history and sync">
    <div class="panel-heading">
      <h2 class="panel-title">Git</h2>
      <button class="ghost-button tight-button" type="button" :disabled="loading" @click="refreshGit">Refresh</button>
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
          <strong>{{ file.originalPath ? `${JSON.stringify(file.originalPath)} → ` : '' }}{{ JSON.stringify(file.path) }}</strong>
        </div>
      </div>

      <pre v-if="dirtyDiff" class="diff-preview">{{ dirtyDiff }}</pre>

      <div class="quick-commit-box">
        <p class="empty-copy">Commits preserve the reviewed file bytes. For Git hooks, content filters or signed commits, use your external Git editor.</p>
        <label class="field">
          Commit message
          <input v-model="commitMessage" class="text-input" type="text">
        </label>
        <div class="pending-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="loading || !previewReady || !dirtyFiles.length || !commitMessage.trim()"
            @click="quickCommit"
          >
            {{ retryIndex ? 'Retry Git index finalization' : 'Commit reviewed files' }}
          </button>
          <button class="secondary-button" type="button" :disabled="loading || !status.head || !status.available" @click="sync">Sync</button>
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
          <strong>{{ file.originalPath ? `${JSON.stringify(file.originalPath)} → ` : '' }}{{ JSON.stringify(file.path) }}</strong>
        </div>
      </div>
      <pre class="diff-preview">{{ selectedCommit.diff }}</pre>
    </article>
  </section>
</template>
