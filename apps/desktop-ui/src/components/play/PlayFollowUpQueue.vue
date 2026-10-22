<script setup lang="ts">
import { shallowRef } from 'vue';

import type { PlayFollowUpControls } from '../../composables/usePlayFollowUpQueue';

const props = defineProps<{
  controls: PlayFollowUpControls;
  canSteer: boolean;
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
    class="play-follow-up-queue"
    aria-label="排队的行动"
  >
    <p v-if="controls.notice" class="play-follow-up-notice" role="status">{{ controls.notice }}</p>
    <ol v-if="controls.items.length" class="play-follow-up-list">
      <li v-for="(item, index) in controls.items" :key="item.id" class="play-follow-up-item">
        <template v-if="editingId === item.id">
          <textarea v-model="editingText" rows="2" aria-label="编辑排队的行动" />
          <div class="play-follow-up-actions">
            <button type="button" @click="saveEdit">保存</button>
            <button type="button" @click="editingId = ''">取消</button>
          </div>
        </template>
        <template v-else>
          <span class="play-follow-up-index">排队 {{ index + 1 }} · {{ item.actionKind }}</span>
          <p class="play-follow-up-text">{{ item.userText }}</p>
          <div class="play-follow-up-actions">
            <button
              v-if="canSteer"
              type="button"
              title="停止当前未提交的回合，把这条补充进去后重新生成"
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
            <button type="button" @click="startEdit(item.id, item.userText)">编辑</button>
            <button type="button" @click="controls.remove(item.id)">删除</button>
          </div>
        </template>
      </li>
    </ol>
    <button
      v-if="controls.paused && !running && controls.items.length"
      class="play-follow-up-resume"
      type="button"
      @click="controls.resume()"
    >
      继续发送
    </button>
  </section>
</template>

<style scoped>
.play-follow-up-queue {
  display: grid;
  gap: 6px;
  font-size: 12px;
}

.play-follow-up-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-follow-up-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px dashed var(--play-line, var(--editor-hairline));
}

.play-follow-up-item textarea {
  grid-column: 1 / 3;
  width: 100%;
  font: inherit;
}

.play-follow-up-index,
.play-follow-up-notice {
  color: var(--play-muted, var(--editor-muted));
}

.play-follow-up-notice,
.play-follow-up-text {
  margin: 0;
}

.play-follow-up-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-follow-up-actions {
  display: flex;
  gap: 4px;
}

.play-follow-up-actions button,
.play-follow-up-resume {
  font-size: 11px;
}

.play-follow-up-resume {
  justify-self: start;
}
</style>
