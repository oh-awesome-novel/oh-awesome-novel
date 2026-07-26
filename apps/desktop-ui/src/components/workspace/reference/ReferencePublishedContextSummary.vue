<script setup lang="ts">
import { computed } from 'vue';

import type { ReferenceWorkSummary } from '../../../composables/useWorkspaceApi';

type ReferencePublishedContextView = NonNullable<
  ReferenceWorkSummary['publishedContext']
>;

const props = defineProps<{
  context: ReferencePublishedContextView;
  enabled: boolean;
  contextEligible: boolean;
}>();

const categories = computed(() =>
  Object.entries(props.context.categoryCounts).map(([category, count]) => ({
    category,
    count,
  })),
);
</script>

<template>
  <section class="reference-published-context" aria-label="Published reference entries">
    <div class="reference-section-heading">
      <div>
        <h4>Published Selector Entries</h4>
        <p>
          {{ context.entryCount }} current distilled entries · run {{ context.runId }}
        </p>
      </div>
      <span class="status-pill">
        {{ contextEligible ? 'Context eligible' : enabled ? 'Not eligible' : 'Disabled' }}
      </span>
    </div>
    <div class="reference-category-counts">
      <span v-for="item in categories" :key="item.category">
        {{ item.category }} {{ item.count }}
      </span>
    </div>
    <p class="reference-published-fingerprint">
      Context fingerprint {{ context.fingerprint }}
    </p>
  </section>
</template>

<style scoped>
.reference-published-context {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgb(22 163 74);
  border-radius: 8px;
  background: rgb(240 253 244);
}

.reference-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.reference-section-heading h4,
.reference-section-heading p,
.reference-published-fingerprint {
  margin: 0;
}

.reference-section-heading p,
.reference-published-fingerprint {
  overflow-wrap: anywhere;
  color: rgb(71 85 105);
  font-size: 12px;
}

.reference-category-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reference-category-counts span {
  padding: 3px 6px;
  border-radius: 999px;
  background: rgb(220 252 231);
  font-size: 12px;
}

.reference-published-fingerprint {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

:global([data-theme="dark"]) .reference-published-context {
  border-color: rgb(34 197 94);
  background: rgb(20 83 45 / 25%);
}

:global([data-theme="dark"]) .reference-section-heading p,
:global([data-theme="dark"]) .reference-published-fingerprint {
  color: rgb(163 163 163);
}

:global([data-theme="dark"]) .reference-category-counts span {
  background: rgb(20 83 45);
}
</style>
