<script setup lang="ts">
import type { ReferenceMaterialAdoptionRecords } from '../../../composables/useWorkspaceApi';
import { DECISION_LABELS, MATERIAL_KIND_LABELS } from './referenceMaterialLabels';

defineProps<{
  records?: ReferenceMaterialAdoptionRecords;
  error: string;
}>();

const emit = defineEmits<{ review: [pendingActionId: string] }>();

const STATUS_LABELS = { pending: '等待审批', accepted: '已接受', rejected: '已拒绝' } as const;
</script>

<template>
  <details class="material-adoption-records">
    <summary>
      采用记录
      <template v-if="records">（{{ records.records.length }}）</template>
    </summary>
    <p v-if="error" class="material-records-note" role="status">
      读不到采用记录：{{ error }}。这不影响继续采用。
    </p>
    <template v-else-if="records">
      <p class="material-records-note">
        记录来自仍保留的审批数据。已清理的审批不会出现在这里，所以没有记录不代表从未采用过。
      </p>
      <p v-if="!records.records.length" class="material-records-note">这份参考还没有采用记录。</p>
      <ul>
        <li v-for="record in records.records" :key="record.pendingActionId">
          <div class="material-record-heading">
            <span class="status-pill">{{ STATUS_LABELS[record.status] }}</span>
            <time :datetime="record.createdAt">{{ new Date(record.createdAt).toLocaleString() }}</time>
            <small v-if="record.commit">提交 {{ record.commit.slice(0, 8) }}</small>
            <small v-if="!record.currentPublication">来自较早的一次发布</small>
            <button
              v-if="record.status === 'pending'"
              class="ghost-button tight-button"
              type="button"
              @click="emit('review', record.pendingActionId)"
            >
              去审批
            </button>
          </div>
          <p v-if="record.entryEvidence === 'missing'" class="material-records-note">
            条目明细已缺失，只能确定它涉及这些文件：
            <code v-for="target in record.targets" :key="target.path">
              {{ DECISION_LABELS[target.operation] }} {{ target.path }}
            </code>
          </p>
          <ul v-else>
            <li v-for="entry in record.entries" :key="entry.entryId">
              {{ DECISION_LABELS[entry.decision] }} · {{ MATERIAL_KIND_LABELS[entry.materialKind] }} ·
              {{ entry.title }} → <code>{{ entry.targetFile }}</code>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </details>
</template>

<style scoped>
.material-adoption-records {
  font-size: 12px;
}

.material-adoption-records summary {
  cursor: pointer;
  font-weight: 600;
}

.material-adoption-records ul {
  display: grid;
  gap: 6px;
  margin: 6px 0 0;
  padding-left: 18px;
}

.material-records-note {
  margin: 6px 0 0;
  color: rgb(100 116 139);
}

.material-record-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
