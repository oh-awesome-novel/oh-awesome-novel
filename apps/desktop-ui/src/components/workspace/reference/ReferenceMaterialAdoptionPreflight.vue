<script setup lang="ts">
import { computed } from 'vue';

import type { ReferenceMaterialAdoptionPreflight } from '../../../composables/useWorkspaceApi';
import { DECISION_LABELS, MATERIAL_KIND_LABELS } from './referenceMaterialLabels';

const props = defineProps<{
  preflight: ReferenceMaterialAdoptionPreflight;
  /** The batch being previewed is generating; the button must not start a second call. */
  busy: boolean;
}>();

const emit = defineEmits<{ generate: [] }>();

const errors = computed(() => props.preflight.issues.filter((issue) => issue.severity === 'error'));
const notices = computed(() => props.preflight.issues.filter((issue) => issue.severity === 'notice'));
</script>

<template>
  <section class="material-preflight" aria-label="采纳预检结果">
    <h4>
      {{ preflight.status === 'ready' ? '预检通过，可以生成预览' : '这一批还不能生成预览' }}
    </h4>
    <p class="material-preflight-summary">
      {{ preflight.selectionCount }} 条材料 → {{ preflight.targetCount }} 个目标文件 ·
      约 {{ preflight.materialChars }} 字。预检没有调用模型，也没有改动任何文件。
    </p>

    <ul v-if="errors.length" class="material-preflight-errors" aria-label="需要先解决的问题">
      <li v-for="(issue, index) in errors" :key="`${issue.code}-${index}`">{{ issue.message }}</li>
    </ul>
    <p v-if="errors.length" class="material-preflight-summary">
      在上方修改对应条目的目标文件，或把它移出这一批，然后重新预检。
    </p>

    <ul v-if="preflight.targets.length" class="material-preflight-targets" aria-label="目标文件">
      <li v-for="target in preflight.targets" :key="target.targetFile">
        <span class="status-pill">{{ DECISION_LABELS[target.operation] }}</span>
        <code>{{ target.targetFile }}</code>
        <small>
          {{ MATERIAL_KIND_LABELS[target.materialKind] }} · {{ target.entryIds.length }} 条
          <template v-if="target.targetPath"> · YAML 路径 {{ target.targetPath }}</template>
        </small>
      </li>
    </ul>

    <ul v-if="notices.length" class="material-preflight-notices" aria-label="提示">
      <li v-for="(issue, index) in notices" :key="`${issue.code}-${index}`">{{ issue.message }}</li>
    </ul>

    <button
      class="primary-button tight-button"
      type="button"
      :disabled="busy || preflight.status !== 'ready'"
      @click="emit('generate')"
    >
      {{ busy ? '正在生成预览…' : '生成采纳预览' }}
    </button>
  </section>
</template>

<style scoped>
.material-preflight {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgb(203 213 225);
  border-radius: 8px;
}

.material-preflight h4,
.material-preflight p,
.material-preflight ul {
  margin: 0;
}

.material-preflight-summary,
.material-preflight-targets small {
  color: rgb(100 116 139);
  font-size: 12px;
}

.material-preflight-errors,
.material-preflight-notices {
  padding-left: 18px;
  font-size: 12px;
}

.material-preflight-errors {
  color: rgb(185 28 28);
}

.material-preflight-notices {
  color: rgb(180 83 9);
}

.material-preflight-targets {
  display: grid;
  gap: 4px;
  padding: 0;
  list-style: none;
}

.material-preflight-targets li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

:global([data-theme="dark"]) .material-preflight {
  border-color: rgb(64 64 64);
}
</style>
