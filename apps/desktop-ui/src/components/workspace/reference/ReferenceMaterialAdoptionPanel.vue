<script setup lang="ts">
import ReferenceMaterialAdoptionPreflight from './ReferenceMaterialAdoptionPreflight.vue';
import ReferenceMaterialAdoptionPreview from './ReferenceMaterialAdoptionPreview.vue';
import ReferenceMaterialAdoptionRecords from './ReferenceMaterialAdoptionRecords.vue';
import ReferenceMaterialEntrySelector from './ReferenceMaterialEntrySelector.vue';
import type {
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionDecision,
  ReferenceMaterialAdoptionPendingActionResult,
  ReferenceMaterialAdoptionPreflight as AdoptionPreflight,
  ReferenceMaterialAdoptionPreview as AdoptionPreview,
  ReferenceMaterialAdoptionRecords as AdoptionRecords,
  ReferenceMaterialAdoptionSelection,
  ReferenceMaterialAdoptionTargetSuggestions,
} from '../../../composables/useWorkspaceApi';

defineProps<{
  catalog?: ReferenceMaterialAdoptionCatalog;
  targetSuggestions?: ReferenceMaterialAdoptionTargetSuggestions;
  preflight?: AdoptionPreflight;
  records?: AdoptionRecords;
  recordsError?: string;
  preview?: AdoptionPreview;
  noChangeDecisions: readonly ReferenceMaterialAdoptionDecision[];
  pendingAction?: ReferenceMaterialAdoptionPendingActionResult['pendingAction'];
  loading: boolean;
  preflighting?: boolean;
  previewing: boolean;
  confirming: boolean;
  error: string;
}>();

const emit = defineEmits<{
  preflight: [selections: ReferenceMaterialAdoptionSelection[]];
  selectionChange: [];
  generate: [];
  confirm: [];
  review: [pendingActionId: string];
  clear: [];
}>();
</script>

<template>
  <section class="reference-material-adoption-panel" aria-label="采用拆书材料">
    <div class="panel-heading">
      <div>
        <h3 class="panel-title">采用拆书材料</h3>
        <p class="empty-copy">
          把选中的已发布材料写进作品文件；先预检，再看 diff，最后在审批里接受。
        </p>
      </div>
      <span class="status-pill">
        {{ loading ? '读取中' : preflighting ? '预检中' : previewing ? '生成预览中' : confirming ? '创建审批中' : '手动' }}
      </span>
    </div>

    <p class="material-adoption-boundary">
      已发布的参考材料只是依据，不是作品事实。在审批里接受之前，不会写入任何文件。
    </p>
    <p v-if="error" class="error-copy" role="alert">{{ error }}</p>
    <p v-if="loading" class="empty-copy">正在读取当前已发布的材料…</p>

    <template v-else-if="catalog">
      <p v-if="catalog.warnings.length" class="material-adoption-warning">
        这次发布带有 {{ catalog.warnings.length }} 条不阻断的提示。采用时保留不确定说明，接受前核对最终 diff。
      </p>
      <!-- Kept mounted while a preview is open, so returning from it keeps the author's batch. -->
      <div v-show="!preview && !noChangeDecisions.length && !pendingAction" class="material-adoption-compose">
        <ReferenceMaterialEntrySelector
          :catalog="catalog"
          :target-suggestions="targetSuggestions"
          :issues="preflight?.issues"
          :records="records?.records"
          :disabled="Boolean(preflighting) || previewing || confirming"
          @preflight="emit('preflight', $event)"
          @change="emit('selectionChange')"
        />
        <ReferenceMaterialAdoptionPreflight
          v-if="preflight"
          :preflight="preflight"
          :busy="previewing"
          @generate="emit('generate')"
        />
      </div>
      <ReferenceMaterialAdoptionPreview
        v-if="preview || noChangeDecisions.length || pendingAction"
        :preview="preview"
        :no-change-decisions="noChangeDecisions"
        :pending-action="pendingAction"
        :confirming="confirming"
        @confirm="emit('confirm')"
        @review="emit('review', $event)"
        @clear="emit('clear')"
      />
      <ReferenceMaterialAdoptionRecords
        :records="records"
        :error="recordsError ?? ''"
        @review="emit('review', $event)"
      />
    </template>
  </section>
</template>

<style scoped>
.reference-material-adoption-panel,
.material-adoption-compose {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 10px;
}

.material-adoption-boundary,
.material-adoption-warning {
  margin: 0;
  font-size: 12px;
}

.material-adoption-boundary {
  color: rgb(71 85 105);
}

.material-adoption-warning {
  padding: 8px;
  border-radius: 6px;
  background: rgb(254 243 199);
  color: rgb(146 64 14);
}

:global([data-theme="dark"]) .reference-material-adoption-panel {
  border-color: rgb(64 64 64);
}

:global([data-theme="dark"]) .material-adoption-boundary {
  color: rgb(163 163 163);
}
</style>
