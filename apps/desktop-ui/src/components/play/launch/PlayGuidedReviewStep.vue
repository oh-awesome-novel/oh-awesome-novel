<script setup lang="ts">
import type { DeepReadonly } from 'vue';

import type { PlaySessionPurpose } from '../../../composables/useWorkspaceApi';
import type { PlayLaunchPackage } from '../../../composables/usePlayGuidedStart';

import PlayLaunchDiagnostics from './PlayLaunchDiagnostics.vue';

const { purpose, preview, requestError, creating, canStart, disabled } = defineProps<{
  purpose: PlaySessionPurpose;
  preview: DeepReadonly<PlayLaunchPackage>;
  requestError?: string;
  creating: boolean;
  canStart: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  back: [];
  confirm: [];
  cancel: [];
}>();

function sourceStatus(
  source: DeepReadonly<PlayLaunchPackage['sourceBase']['activatedSources'][number]>,
): string {
  if (source.status === 'ready') return 'Ready';
  if (source.status === 'missing') return 'Missing — select or restore this file';
  return 'Invalid — replace this source';
}
</script>

<template>
  <section class="guided-review" aria-labelledby="guided-review-heading">
    <header>
      <span>Step 5 / 5</span>
      <h2 id="guided-review-heading">Review</h2>
      <p>Inspect the source evidence before creating any Play truth.</p>
    </header>

    <p class="not-created"><strong>Nothing has been created yet.</strong> This is a read-only Launch Package preview.</p>
    <p v-if="requestError" class="request-error" role="alert">{{ requestError }}</p>

    <dl class="summary-grid">
      <div>
        <dt>Title</dt>
        <dd>{{ preview.title }}</dd>
      </div>
      <div>
        <dt>Purpose</dt>
        <dd>{{ purpose === 'sceneRehearsal' ? 'Scene Rehearsal' : 'Immersive Journey' }}</dd>
      </div>
      <div>
        <dt>Entry</dt>
        <dd>{{ preview.entryPoint.label }}</dd>
      </div>
      <div>
        <dt>Identity</dt>
        <dd>{{ preview.identity.kind === 'director' ? 'Director Lens' : 'Player Lens' }}</dd>
      </div>
      <div>
        <dt>World activity</dt>
        <dd>{{ preview.eventPolicy.simulationMode }} · {{ preview.eventPolicy.density }}</dd>
      </div>
      <div>
        <dt>Participants</dt>
        <dd>{{ preview.participantRoles.length }}</dd>
      </div>
    </dl>

    <section class="source-evidence" aria-labelledby="guided-review-sources-heading">
      <h3 id="guided-review-sources-heading">Source evidence</h3>
      <ul>
        <li v-for="source in preview.sourceBase.activatedSources" :key="source.sourceId">
          <details :open="source.status !== 'ready'">
            <summary>
              <span>
                <strong>{{ source.path }}</strong>
                <small>{{ source.role }} · {{ sourceStatus(source) }}</small>
              </span>
            </summary>
            <dl>
              <template v-if="source.objectId">
                <dt>Object</dt>
                <dd>{{ source.objectId }}</dd>
              </template>
              <template v-if="source.contentHash">
                <dt>SHA-256</dt>
                <dd class="source-hash">{{ source.contentHash }}</dd>
              </template>
              <template v-if="source.excerpt !== undefined">
                <dt>Excerpt</dt>
                <dd><pre>{{ source.excerpt }}</pre></dd>
              </template>
            </dl>
          </details>
        </li>
      </ul>
    </section>

    <PlayLaunchDiagnostics :diagnostics="preview.diagnostics" />

    <p v-if="!canStart" class="blocked-notice">
      Start is blocked until every source is ready and all error diagnostics are resolved.
    </p>

    <footer>
      <button type="button" :disabled="disabled || creating" @click="emit('cancel')">Cancel</button>
      <div>
        <button type="button" :disabled="disabled || creating" @click="emit('back')">Back to Cast</button>
        <button
          class="primary"
          type="button"
          :disabled="disabled || creating || !canStart"
          @click="emit('confirm')"
        >
          {{ creating ? 'Starting…' : purpose === 'sceneRehearsal' ? 'Start Scene Rehearsal' : 'Start Immersive Journey' }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.guided-review,
.guided-review > header,
.source-evidence,
.source-evidence ul {
  display: grid;
  gap: 12px;
}

.guided-review > header {
  gap: 4px;
}

h2,
h3,
p {
  margin: 0;
}

h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

h3 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.guided-review > header > span,
.guided-review > header p,
dt,
summary small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.not-created,
.blocked-notice,
.request-error {
  padding: 9px 10px;
  border-left: 3px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  font-size: 12px;
}

.request-error,
.blocked-notice {
  color: var(--play-danger, var(--editor-danger));
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  background: var(--play-line, var(--editor-hairline));
}

.summary-grid > div {
  display: grid;
  gap: 3px;
  padding: 9px;
  background: var(--play-surface, var(--editor-surface));
}

dd {
  margin: 0;
}

.source-evidence ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.source-evidence li {
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

summary {
  padding: 9px;
  cursor: pointer;
}

summary > span {
  display: inline-grid;
  gap: 2px;
  margin-left: 5px;
}

details > dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 10px;
  margin: 0;
  padding: 0 10px 10px;
}

.source-hash {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

pre {
  max-height: 170px;
  overflow: auto;
  margin: 0;
  padding: 8px;
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}

footer,
footer > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

button {
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}

@media (max-width: 680px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
