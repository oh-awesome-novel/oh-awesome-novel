<script setup lang="ts">
import { computed, shallowRef, useId, watch } from 'vue';
import { IMAGE_ASSET_MAX_BYTES } from '@oh-awesome-novel/client';
import type { ImageAssetEntry } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import CharacterPortraitForm from './CharacterPortraitForm.vue';
import ImageAssetView from './ImageAssetView.vue';

/**
 * The author's view of the image asset folder: per-character portraits, importing local
 * files, the portrait form, and cleaning up images nothing refers to. A formal file only
 * changes through the pending change the portrait form proposes.
 */
const props = defineProps<{
  /** Character folder ids found under `characters/`. */
  characterIds: string[];
  workspaceRoot: string;
}>();
const emit = defineEmits<{
  close: [];
  pendingActionCreated: [];
  reviewPendingAction: [pendingActionId: string];
}>();

const api = useWorkspaceApi();
const prefix = useId();
const characterId = shallowRef(props.characterIds[0] ?? '');
const directory = shallowRef('');
const images = shallowRef<ImageAssetEntry[]>([]);
const loading = shallowRef(false);
const importing = shallowRef(false);
const error = shallowRef('');
const notices = shallowRef<string[]>([]);
const copied = shallowRef('');
const unreferenced = shallowRef<ImageAssetEntry[]>();
const unreferencedLoading = shallowRef(false);
const confirmingDelete = shallowRef('');
const deleting = shallowRef('');
let listGeneration = 0;

const validCharacter = computed(() => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(characterId.value));
const busy = computed(() => loading.value || importing.value || Boolean(deleting.value));

function message(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : String(cause);
}
function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

async function refresh(): Promise<void> {
  const generation = ++listGeneration;
  error.value = '';
  if (!validCharacter.value) { images.value = []; directory.value = ''; return; }
  loading.value = true;
  try {
    const result = await api.listPortraitImages(characterId.value);
    if (generation !== listGeneration) return;
    directory.value = result.directory;
    images.value = result.images;
  } catch (cause) {
    if (generation === listGeneration) { images.value = []; error.value = message(cause); }
  } finally {
    if (generation === listGeneration) loading.value = false;
  }
}
watch(characterId, () => { notices.value = []; void refresh(); }, { immediate: true });

/** Copies the picked local files into the character's folder; each file reports its own outcome. */
async function importFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length || !validCharacter.value || importing.value) return;
  importing.value = true;
  error.value = '';
  const results: string[] = [];
  let gitIgnored = true;
  try {
    for (const file of files) {
      if (file.size > IMAGE_ASSET_MAX_BYTES) { results.push(`${file.name}：超过 16 MiB 的上限，没有导入。`); continue; }
      try {
        const result = await api.importPortraitImage(characterId.value, { name: file.name, data: file });
        gitIgnored &&= result.gitIgnored;
        results.push(result.reused
          ? `${file.name}：内容与已有的 ${result.image.name} 相同，没有重复保存。`
          : result.image.name === file.name
            ? `${file.name}：已导入。`
            : `${file.name}：已导入为 ${result.image.name}。`);
      } catch (cause) {
        results.push(`${file.name}：${message(cause)}`);
      }
    }
    if (!gitIgnored) results.push('提醒：无法确认 Git 已忽略 assets/ 目录，提交前请检查。');
    notices.value = results;
    unreferenced.value = undefined;
    await refresh();
  } finally {
    importing.value = false;
  }
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
    copied.value = path;
  } catch {
    copied.value = '';
    error.value = `无法写入剪贴板，请手动复制：${path}`;
  }
}

async function loadUnreferenced(): Promise<void> {
  unreferencedLoading.value = true;
  error.value = '';
  confirmingDelete.value = '';
  try {
    unreferenced.value = (await api.listUnreferencedImageAssets()).images;
  } catch (cause) {
    error.value = message(cause);
  } finally {
    unreferencedLoading.value = false;
  }
}

/** Deletion is one image at a time and needs a second, explicit click. */
async function remove(path: string): Promise<void> {
  if (confirmingDelete.value !== path) { confirmingDelete.value = path; return; }
  deleting.value = path;
  error.value = '';
  try {
    await api.deleteImageAsset(path);
    unreferenced.value = unreferenced.value?.filter(image => image.path !== path);
    await refresh();
  } catch (cause) {
    error.value = message(cause);
  } finally {
    deleting.value = '';
    confirmingDelete.value = '';
  }
}
</script>

<template>
  <section class="image-asset-panel" :aria-labelledby="`${prefix}-heading`" :aria-busy="busy">
    <header>
      <h2 :id="`${prefix}-heading`">图片资源</h2>
      <button type="button" @click="emit('close')">关闭</button>
    </header>
    <p>
      图片放在工作区的 <code>assets/</code> 文件夹里，不进 Git，也不会发给模型。换一台机器克隆工作区后图片不会跟来，需要重新放入。
      小说文件里只记录图片路径；修改路径仍要经过待确认改动的审批。
    </p>

    <div class="image-asset-toolbar">
      <label :for="`${prefix}-character`">角色</label>
      <input
        :id="`${prefix}-character`"
        v-model.trim="characterId"
        :list="`${prefix}-characters`"
        maxlength="100"
        placeholder="角色目录编号，例如 nian"
        :disabled="importing"
      />
      <datalist :id="`${prefix}-characters`">
        <option v-for="id in characterIds" :key="id" :value="id" />
      </datalist>
      <label class="image-asset-import" :class="{ disabled: !validCharacter || importing }">
        <span>{{ importing ? '正在导入…' : '导入图片' }}</span>
        <input
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          :aria-label="`导入图片到 ${characterId || '角色'}`"
          :disabled="!validCharacter || importing"
          @change="importFiles"
        />
      </label>
    </div>
    <p v-if="characterId && !validCharacter" role="alert">角色编号只能包含字母、数字、“_”和“-”。</p>
    <small v-else-if="directory">立绘目录：<code>{{ directory }}/</code> · 支持 PNG、JPEG、WebP，单张不超过 16 MiB。导入只新增文件，不会覆盖已有图片。</small>

    <p v-if="error" class="image-asset-error" role="alert">{{ error }}</p>
    <ul v-if="notices.length" class="image-asset-notices" role="status">
      <li v-for="notice in notices" :key="notice">{{ notice }}</li>
    </ul>

    <p v-if="validCharacter && !loading && !images.length" class="image-asset-empty">这个角色还没有图片。</p>
    <ul class="image-asset-grid" aria-label="角色图片">
      <li v-for="image in images" :key="image.path">
        <div class="image-asset-thumb"><ImageAssetView :path="image.path" :alt="image.name" :revision="image.bytes" /></div>
        <code>{{ image.path }}</code>
        <small>{{ formatBytes(image.bytes) }}<template v-if="image.problem"> · {{ image.problem }}</template></small>
        <button type="button" @click="copyPath(image.path)">{{ copied === image.path ? '已复制路径' : '复制路径' }}</button>
      </li>
    </ul>

    <CharacterPortraitForm
      v-if="validCharacter"
      :character-id="characterId"
      :workspace-root="workspaceRoot"
      :images="images"
      @pending-action-created="emit('pendingActionCreated')"
      @review-pending-action="emit('reviewPendingAction', $event)"
    />

    <section class="image-asset-unreferenced" aria-label="未被引用的图片">
      <header>
        <h3>未被引用的图片</h3>
        <button type="button" :disabled="unreferencedLoading || Boolean(deleting)" @click="loadUnreferenced">
          {{ unreferencedLoading ? '正在检查…' : unreferenced ? '重新检查' : '检查' }}
        </button>
      </header>
      <small>没有被任何章节、角色、世界观等正式文件提到路径的图片。系统不会自动删除，是否删除由你决定；删除后无法从 Git 找回。</small>
      <p v-if="unreferenced && !unreferenced.length">没有未被引用的图片。</p>
      <ul v-if="unreferenced?.length">
        <li v-for="image in unreferenced" :key="image.path">
          <code>{{ image.path }}</code>
          <small>{{ formatBytes(image.bytes) }}</small>
          <button type="button" :disabled="Boolean(deleting)" @click="remove(image.path)">
            {{ deleting === image.path ? '正在删除…' : confirmingDelete === image.path ? '确认删除这张图片' : '删除' }}
          </button>
          <button v-if="confirmingDelete === image.path" type="button" @click="confirmingDelete = ''">取消</button>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.image-asset-panel { display:grid; align-content:start; gap:12px; padding:16px 20px; font-size:13px; }
.image-asset-panel > header, .image-asset-unreferenced > header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.image-asset-panel h2 { margin:0; font-size:16px; }
.image-asset-panel h3 { margin:0; font-size:13px; }
.image-asset-panel p { margin:0; line-height:1.6; }
.image-asset-panel button, .image-asset-import { padding:5px 10px; border:1px solid var(--play-line, #c9c9c9); border-radius:4px; background:var(--play-canvas, transparent); color:inherit; font:inherit; font-size:12px; cursor:pointer; }
.image-asset-panel button:disabled, .image-asset-import.disabled { opacity:.5; cursor:default; }
.image-asset-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.image-asset-toolbar input:not([type='file']) { min-width:220px; padding:5px 8px; border:1px solid var(--play-line, #c9c9c9); border-radius:4px; background:transparent; color:inherit; }
.image-asset-import { position:relative; overflow:hidden; }
.image-asset-import input { position:absolute; inset:0; opacity:0; cursor:inherit; }
.image-asset-import:focus-within { outline:1px solid var(--play-focus, currentcolor); outline-offset:1px; }
.image-asset-error { color:var(--play-danger, #b42318); }
.image-asset-notices { margin:0; padding-left:18px; }
.image-asset-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:12px; margin:0; padding:0; list-style:none; }
.image-asset-grid li { display:grid; gap:6px; padding:10px; border:1px solid var(--play-line, #c9c9c9); border-radius:6px; }
.image-asset-thumb { display:grid; place-items:center; height:180px; overflow:hidden; }
.image-asset-thumb :deep(.image-asset) { max-height:180px; }
.image-asset-panel code { font-size:11px; overflow-wrap:anywhere; }
.image-asset-unreferenced { display:grid; gap:8px; padding-top:12px; border-top:1px solid var(--play-line, #c9c9c9); }
.image-asset-unreferenced ul { display:grid; gap:6px; margin:0; padding:0; list-style:none; }
.image-asset-unreferenced li { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.image-asset-unreferenced li code { margin-right:auto; }
</style>
