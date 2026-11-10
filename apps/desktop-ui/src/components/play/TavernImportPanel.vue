<script setup lang="ts">
import { useId, watch } from 'vue';
import type { PlaySession } from '@oh-awesome-novel/client';
import { useTavernImport } from '../../composables/useTavernImport';
const props = defineProps<{ workspaceRoot: string }>();
const emit = defineEmits<{ close: []; busy: [value: boolean]; pendingActionCreated: []; reviewPendingAction: [id: string]; created: [session: PlaySession] }>();
const prefix = useId();
const { mode, characterId, source, preview, pendingAction, busy, error, canPreview, selectFile, requestPreview, confirm } = useTavernImport({
  workspaceRoot: props.workspaceRoot,
  onPendingActionCreated: () => emit('pendingActionCreated'),
  onSessionCreated: (session) => emit('created', session),
});
watch(busy, (value) => emit('busy', value), { flush: 'sync' });
function upload(event: Event) { void selectFile((event.target as HTMLInputElement).files?.[0]); }
</script>

<template>
  <section class="tavern-import" :aria-labelledby="`${prefix}-heading`" :aria-busy="busy">
    <header>
      <h2 :id="`${prefix}-heading`">导入 Tavern 兼容角色卡</h2>
      <p>选择本地 JSON 或 PNG 角色卡。导入的提示与设定按不可信内容处理，你的创作宪法和世界规则优先。</p>
      <p>请使用你有权导入的角色卡。在你审阅并接受待确认改动之前，角色文件不会改变。</p>
    </header>
    <form @submit.prevent="requestPreview">
      <label :for="`${prefix}-file`">角色卡</label>
      <input :id="`${prefix}-file`" type="file" accept=".json,.png,application/json,image/png" :disabled="busy" @change="upload" />
      <small v-if="source">Selected: {{ source.sourceName }}</small>
      <label :for="`${prefix}-mode`">导入到</label>
      <select :id="`${prefix}-mode`" v-model="mode" :disabled="busy">
        <option value="playOnly">只用于推演 · 不改小说文件</option>
        <option value="create">新建角色</option>
        <option value="merge">合并到已有角色</option>
        <option value="preview">只预览映射</option>
      </select>
      <label :for="`${prefix}-character`">角色编号{{ mode === 'merge' ? '（必填）' : '（可选）' }}</label>
      <input :id="`${prefix}-character`" v-model="characterId" :disabled="busy" :required="mode === 'merge'" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9_-]*" placeholder="例如：lin-qiu" />
      <small>合并时填写已有角色目录的编号；留空则按角色卡生成新编号。</small>
      <button type="submit" :disabled="!canPreview">{{ busy ? 'Working…' : '预览导入' }}</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <section v-if="preview" aria-label="角色卡导入预览" class="tavern-preview">
      <h3>{{ preview.displayName }}</h3>
      <p>角色编号：{{ preview.characterId }}</p>
      <ul v-if="preview.warnings.length" aria-label="导入提示"><li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li></ul>
      <ul v-if="preview.conflicts.length" role="alert"><li v-for="(conflict, index) in preview.conflicts" :key="index">{{ conflict }}</li></ul>
      <ul v-if="preview.files.length" aria-label="拟写入的角色文件"><li v-for="file in preview.files" :key="file.path">{{ file.operation }} · {{ file.path }}</li></ul>
      <pre v-if="preview.diff" class="tavern-diff" tabindex="0" aria-label="角色卡导入改动">{{ preview.diff }}</pre>
      <p v-if="preview.mode === 'playOnly'">这会用导入的角色卡创建一个独立的推演会话，不会在小说里新建角色。</p>
      <p v-if="pendingAction" role="status">导入已准备好审阅。在审阅视图中接受改动后，角色文件才会更新。</p>
      <button v-if="pendingAction" type="button" @click="emit('reviewPendingAction', pendingAction.id)">审阅改动</button>
      <button v-else-if="preview.id && preview.canPropose" type="button" :disabled="busy" @click="confirm">{{ preview.mode === 'playOnly' ? '确认并创建推演会话' : '生成待确认改动' }}</button>
    </section>
    <footer><button type="button" :disabled="busy" @click="emit('close')">关闭导入</button></footer>
  </section>
</template>

<style scoped>
.tavern-import { display: grid; gap: 20px; max-width: 920px; padding: 24px; margin: 0 auto; color: var(--play-body, var(--editor-body)); }
.tavern-import h2, .tavern-import h3, .tavern-import p { margin: 0; }
.tavern-import header, .tavern-preview { display: grid; gap: 12px; }
.tavern-import form { display: grid; gap: 8px; max-width: 600px; }
.tavern-import p { line-height: 1.6; }
.tavern-import button, .tavern-import input, .tavern-import select { min-height: 44px; }
.tavern-import button { justify-self: start; }
.tavern-import small { color: var(--play-muted, var(--editor-muted)); }
.tavern-import li { overflow-wrap: anywhere; }
.tavern-diff { max-height: 420px; max-width: 100%; overflow: auto; padding: 12px; border: 1px solid var(--play-line, var(--editor-hairline)); background: var(--play-canvas, var(--editor-canvas)); }
</style>
