<script setup lang="ts">
import { useId } from 'vue';

import type { PlayRehearsalResultView } from './types';

const { result } = defineProps<{
  result: Readonly<PlayRehearsalResultView>;
}>();

const headingId = `${useId()}-rehearsal-result-heading`;
</script>

<template>
  <section class="play-rehearsal-result" :aria-labelledby="headingId" data-status="committed">
    <header>
      <div>
        <span>[committed]</span>
        <h2 :id="headingId">Rehearsal Result</h2>
      </div>
      <span>Revision {{ result.revision }} · {{ result.artifactRef }}</span>
    </header>

    <p class="play-rehearsal-result-summary">{{ result.summary }}</p>

    <section v-if="result.blocks.length">
      <h3>Selected narrative</h3>
      <ul>
        <li v-for="block in result.blocks" :key="block.id">
          <span>{{ block.speakerName || block.kind }}</span>
          <p>{{ block.content }}</p>
        </li>
      </ul>
    </section>

    <section v-if="result.eventSummaries.length">
      <h3>World events</h3>
      <ul>
        <li v-for="(event, index) in result.eventSummaries" :key="`${index}:${event}`">{{ event }}</li>
      </ul>
    </section>

    <section v-if="result.stateChanges.length">
      <h3>State changes</h3>
      <dl>
        <div v-for="change in result.stateChanges" :key="change.label">
          <dt>{{ change.label }}</dt>
          <dd><template v-if="change.before !== undefined">{{ change.before }} → </template>{{ change.after }}</dd>
        </div>
      </dl>
    </section>
  </section>
</template>

<style scoped>
.play-rehearsal-result {
  display: grid;
  gap: 12px;
  padding: 13px;
  border: 1px double var(--play-success, var(--editor-success));
  border-left-width: 3px;
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-result > header,
.play-rehearsal-result > header > div {
  display: flex;
  align-items: center;
}

.play-rehearsal-result > header {
  justify-content: space-between;
  gap: 10px;
}

.play-rehearsal-result > header > div {
  gap: 7px;
}

.play-rehearsal-result > header span,
.play-rehearsal-result li > span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-result :where(h2, h3, p, ul, dl) {
  margin: 0;
}

.play-rehearsal-result h2,
.play-rehearsal-result h3 {
  color: var(--play-ink, var(--editor-ink));
}

.play-rehearsal-result h2 {
  font-size: 13px;
}

.play-rehearsal-result h3 {
  font-size: 11px;
}

.play-rehearsal-result-summary {
  padding: 9px;
  border-left: 2px solid var(--play-success, var(--editor-success));
  background: var(--play-surface, var(--editor-surface));
  font-size: 11px;
  line-height: 1.55;
}

.play-rehearsal-result section {
  display: grid;
  gap: 7px;
  padding-top: 9px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-result ul,
.play-rehearsal-result dl {
  display: grid;
  gap: 6px;
  padding: 0;
  list-style: none;
}

.play-rehearsal-result li,
.play-rehearsal-result dl div {
  display: grid;
  gap: 3px;
  font-size: 10px;
  line-height: 1.5;
}

.play-rehearsal-result li p {
  white-space: pre-wrap;
}

.play-rehearsal-result dl div {
  grid-template-columns: minmax(90px, .4fr) minmax(0, 1fr);
}

.play-rehearsal-result dt {
  color: var(--play-muted, var(--editor-muted));
}

.play-rehearsal-result dd {
  margin: 0;
}
</style>
