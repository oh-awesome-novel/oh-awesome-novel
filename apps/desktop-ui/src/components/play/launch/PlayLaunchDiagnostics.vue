<script setup lang="ts">
import type { PlayLaunchDiagnostic } from '../../../composables/usePlayGuidedStart';

defineProps<{
  diagnostics: readonly Readonly<PlayLaunchDiagnostic>[];
}>();
</script>

<template>
  <section v-if="diagnostics.length" class="diagnostics" aria-labelledby="play-launch-diagnostics-heading">
    <h3 id="play-launch-diagnostics-heading">Launch diagnostics</h3>
    <ul>
      <li
        v-for="diagnostic in diagnostics"
        :key="diagnostic.id"
        :class="`diagnostic-${diagnostic.severity}`"
        :role="diagnostic.severity === 'error' ? 'alert' : undefined"
      >
        <strong>{{ diagnostic.severity === 'error' ? 'Blocking error' : 'Warning' }}</strong>
        <span>{{ diagnostic.message }}</span>
        <small v-if="diagnostic.path">{{ diagnostic.path }}</small>
        <details v-if="diagnostic.expectedContentHash || diagnostic.actualContentHash">
          <summary>Hash comparison</summary>
          <dl>
            <template v-if="diagnostic.expectedContentHash">
              <dt>Expected</dt>
              <dd>{{ diagnostic.expectedContentHash }}</dd>
            </template>
            <template v-if="diagnostic.actualContentHash">
              <dt>Actual</dt>
              <dd>{{ diagnostic.actualContentHash }}</dd>
            </template>
          </dl>
        </details>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.diagnostics,
.diagnostics ul,
.diagnostics li {
  display: grid;
  gap: 7px;
}

h3 {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  padding: 9px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  border-left: 3px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  font-size: 12px;
}

.diagnostic-error {
  border-left-color: var(--play-danger, var(--editor-danger));
}

.diagnostic-warning strong,
small,
summary,
dt {
  color: var(--play-muted, var(--editor-muted));
}

.diagnostic-error strong {
  color: var(--play-danger, var(--editor-danger));
}

dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 8px;
  margin: 7px 0 0;
}

dd {
  min-width: 0;
  overflow-wrap: anywhere;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}
</style>
