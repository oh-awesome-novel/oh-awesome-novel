<script setup lang="ts">
import { shallowRef } from 'vue';

import type { AgentFollowUpControls } from '../../composables/useAgentFollowUpQueue';

const props = defineProps<{
  controls: AgentFollowUpControls;
  running: boolean;
}>();

const editingId = shallowRef('');
const editingText = shallowRef('');

function startEdit(id: string, text: string) {
  editingId.value = id;
  editingText.value = text;
}

function saveEdit() {
  const text = editingText.value.trim();
  if (text) props.controls.edit(editingId.value, text);
  editingId.value = '';
}
</script>

<template>
  <section
    v-if="controls.items.length || controls.notice"
    class="follow-up-queue"
    aria-label="排队消息"
  >
    <p v-if="controls.notice" class="follow-up-notice" role="status">{{ controls.notice }}</p>
    <ol v-if="controls.items.length" class="follow-up-list">
      <li v-for="(item, index) in controls.items" :key="item.id" class="follow-up-item">
        <template v-if="editingId === item.id">
          <textarea v-model="editingText" class="follow-up-edit" rows="2" aria-label="编辑排队消息" />
          <div class="follow-up-actions">
            <button type="button" @click="saveEdit">保存</button>
            <button type="button" @click="editingId = ''">取消</button>
          </div>
        </template>
        <template v-else>
          <span class="follow-up-index">排队 {{ index + 1 }}</span>
          <p class="follow-up-text">{{ item.text }}</p>
          <div class="follow-up-actions">
            <button
              v-if="running"
              type="button"
              title="让本轮下一步就看到这条消息"
              @click="controls.steer(item.id)"
            >
              转为插话
            </button>
            <button type="button" :disabled="index === 0" aria-label="上移" @click="controls.move(item.id, -1)">↑</button>
            <button
              type="button"
              :disabled="index === controls.items.length - 1"
              aria-label="下移"
              @click="controls.move(item.id, 1)"
            >
              ↓
            </button>
            <button type="button" @click="startEdit(item.id, item.text)">编辑</button>
            <button type="button" @click="controls.remove(item.id)">删除</button>
          </div>
        </template>
      </li>
    </ol>
    <button
      v-if="controls.paused && !running"
      class="follow-up-resume"
      type="button"
      @click="controls.resume()"
    >
      继续发送
    </button>
  </section>
</template>

<style scoped>
.follow-up-queue {
  display: grid;
  gap: 6px;
  font-size: 12px;
}

.follow-up-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.follow-up-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px dashed var(--editor-hairline, #d4d4d8);
  border-radius: 8px;
}

.follow-up-index,
.follow-up-notice {
  color: var(--editor-muted, #64748b);
}

.follow-up-notice,
.follow-up-text {
  margin: 0;
}

.follow-up-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.follow-up-edit {
  grid-column: 1 / 3;
  width: 100%;
  font: inherit;
}

.follow-up-actions {
  display: flex;
  gap: 4px;
}

.follow-up-actions button,
.follow-up-resume {
  font-size: 11px;
}

.follow-up-resume {
  justify-self: start;
}
</style>
