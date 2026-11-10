<script setup lang="ts">
import { computed } from 'vue';

import type {
  ReferenceMaterialAdoptionDecision,
  ReferenceMaterialAdoptionPendingActionResult,
  ReferenceMaterialAdoptionPreview,
} from '../../../composables/useWorkspaceApi';
import { DECISION_LABELS } from './referenceMaterialLabels';

const props = defineProps<{
  preview?: ReferenceMaterialAdoptionPreview;
  noChangeDecisions: readonly ReferenceMaterialAdoptionDecision[];
  pendingAction?: ReferenceMaterialAdoptionPendingActionResult['pendingAction'];
  confirming: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  review: [pendingActionId: string];
  clear: [];
}>();

const decisions = computed(() =>
  props.preview?.decisions ?? props.noChangeDecisions,
);
</script>

<template>
  <section
    v-if="preview || noChangeDecisions.length"
    class="material-adoption-preview"
    aria-label="采纳预览"
  >
    <div class="material-adoption-preview-heading">
      <div>
        <h4>采纳预览</h4>
        <p>只包含你选中的材料 · 作品文件此时仍未改动。</p>
      </div>
      <button class="ghost-button tight-button" type="button" @click="emit('clear')">
        返回修改这一批
      </button>
    </div>

    <p v-if="preview?.warnings.length" class="material-adoption-warning">
      这次发布带有 {{ preview.warnings.length }} 条提示。创建审批前请核对下面的处理方式和 diff。
    </p>

    <ul class="material-adoption-decisions">
      <li v-for="decision in decisions" :key="decision.targetId">
        <span class="status-pill">{{ DECISION_LABELS[decision.decision] }}</span>
        <div>
          <strong>{{ decision.targetFile }}</strong>
          <small v-if="decision.targetPath">YAML 路径 {{ decision.targetPath }}</small>
          <small>涉及 {{ decision.entryIds.length }} 条材料</small>
          <p>原因：{{ decision.reason }}</p>
        </div>
      </li>
    </ul>

    <template v-if="preview">
      <div class="material-adoption-targets">
        <span>将改动的文件</span>
        <code v-for="change in preview.changes" :key="change.path">
          {{ DECISION_LABELS[change.operation] }} · {{ change.path }}
        </code>
      </div>
      <pre aria-label="采纳 diff">{{ preview.diff }}</pre>
      <p class="material-adoption-boundary">
        这只是预览。点击下面的确认后才会创建审批项，接受审批后才会写入文件。
      </p>
      <button
        v-if="!pendingAction"
        class="primary-button tight-button"
        type="button"
        :disabled="confirming"
        @click="emit('confirm')"
      >
        {{ confirming ? '正在创建审批项…' : '确认并创建审批项' }}
      </button>
    </template>
    <p v-else class="material-adoption-boundary">
      所有目标都被跳过，或内容已与现有文件一致，没有创建审批项。
    </p>

    <section v-if="pendingAction" class="material-adoption-pending">
      <div>
        <strong>审批项 {{ pendingAction.id }}</strong>
        <p>在审批面板接受之前，作品文件保持不变。</p>
      </div>
      <button
        class="primary-button tight-button"
        type="button"
        @click="emit('review', pendingAction.id)"
      >
        去审批
      </button>
    </section>
  </section>
</template>

<style scoped>
.material-adoption-preview,
.material-adoption-targets,
.material-adoption-pending > div {
  display: grid;
  gap: 8px;
}

.material-adoption-preview {
  padding: 10px;
  border: 1px solid rgb(37 99 235);
  border-radius: 8px;
  background: rgb(239 246 255);
}

.material-adoption-preview-heading,
.material-adoption-pending,
.material-adoption-decisions li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.material-adoption-preview-heading h4,
.material-adoption-preview-heading p,
.material-adoption-decisions,
.material-adoption-decisions p,
.material-adoption-boundary,
.material-adoption-warning,
.material-adoption-pending p {
  margin: 0;
}

.material-adoption-preview-heading p,
.material-adoption-decisions small,
.material-adoption-boundary,
.material-adoption-pending p {
  color: rgb(71 85 105);
  font-size: 12px;
}

.material-adoption-warning {
  padding: 8px;
  border-radius: 6px;
  background: rgb(254 243 199);
  color: rgb(146 64 14);
}

.material-adoption-decisions {
  display: grid;
  gap: 7px;
  padding: 0;
  list-style: none;
}

.material-adoption-decisions li {
  justify-content: flex-start;
}

.material-adoption-decisions li div {
  min-width: 0;
}

.material-adoption-decisions strong,
.material-adoption-decisions small {
  display: block;
  overflow-wrap: anywhere;
}

.material-adoption-targets code {
  overflow-wrap: anywhere;
}

.material-adoption-preview pre {
  max-height: 360px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: 6px;
  background: rgb(15 23 42);
  color: rgb(226 232 240);
  font-size: 11px;
  white-space: pre-wrap;
}

:global([data-theme="dark"]) .material-adoption-preview {
  background: rgb(30 58 138 / 25%);
}

:global([data-theme="dark"]) .material-adoption-preview-heading p,
:global([data-theme="dark"]) .material-adoption-decisions small,
:global([data-theme="dark"]) .material-adoption-boundary,
:global([data-theme="dark"]) .material-adoption-pending p {
  color: rgb(163 163 163);
}
</style>
