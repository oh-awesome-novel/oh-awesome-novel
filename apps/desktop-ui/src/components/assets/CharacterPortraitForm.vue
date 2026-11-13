<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch } from 'vue';
import type { CharacterPortraitForm, CharacterPortraitItem, CharacterPortraitMissingImage, ImageAssetEntry } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
import ImageAssetView from './ImageAssetView.vue';

/**
 * Edits one character's prepared portraits: a description for each, optionally an image from
 * the asset folder, and which one is the default. Saving only proposes a change to the
 * character's roster profile; the file changes when the author accepts it.
 */
const props = defineProps<{
  characterId: string;
  workspaceRoot: string;
  /** Images already in this character's asset folder, offered as choices. */
  images: ImageAssetEntry[];
}>();
const emit = defineEmits<{
  pendingActionCreated: [];
  reviewPendingAction: [pendingActionId: string];
}>();

const MAX_ITEMS = 24;
const PORTRAIT_ID = /^[A-Za-z0-9_-]{1,32}$/;
const NAME_COLOR = /^#[0-9a-fA-F]{6}$/;

/** One row of the form. `source` keeps the fields the form does not show. */
interface Row {
  key: number;
  id: string;
  label: string;
  description: string;
  usage: string;
  image: string;
  positive: string;
  negative: string;
  source?: CharacterPortraitItem;
}

const api = useWorkspaceApi();
const prefix = useId();
const form = shallowRef<CharacterPortraitForm>();
const rows = ref<Row[]>([]);
const defaultKey = shallowRef(0);
const nameColor = shallowRef('');
const loading = shallowRef(false);
const saving = shallowRef(false);
const error = shallowRef('');
const proposedId = shallowRef('');
const missing = shallowRef<CharacterPortraitMissingImage[]>([]);
let nextKey = 1;
let generation = 0;

const profile = computed(() => form.value?.profile ?? null);
const imageChoices = computed(() => props.images.filter(image => image.mime));
/** The first problem that keeps the form from being saved, in the author's words. */
const problem = computed(() => {
  const ids = new Set<string>();
  for (const [index, row] of rows.value.entries()) {
    const name = `第 ${index + 1} 套立绘`;
    if (!PORTRAIT_ID.test(row.id)) return `${name}的编号只能用 1 到 32 个字母、数字、“_”或“-”。`;
    if (ids.has(row.id)) return `立绘编号“${row.id}”重复了。`;
    ids.add(row.id);
    if (!row.label.trim()) return `${name}还没有名称。`;
    if (Array.from(row.label.trim()).length > 16) return `${name}的名称不能超过 16 个字。`;
    if (!row.description.trim()) return `${name}还没有文字描述。`;
    if (Array.from(row.description.trim()).length > 500) return `${name}的描述不能超过 500 个字。`;
    if (Array.from(row.usage.trim()).length > 200) return `${name}的适用场合不能超过 200 个字。`;
    if (!row.positive.trim() && row.negative.trim()) return `${name}只填了反向提示词；请补上提示词，或清空反向提示词。`;
  }
  if (nameColor.value && !NAME_COLOR.test(nameColor.value)) return '名字牌颜色要写成 #RRGGBB，例如 #E9C983。';
  return '';
});
const canSave = computed(() => Boolean(profile.value) && !saving.value && !loading.value && !problem.value);

function message(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : String(cause);
}

function toRow(item: CharacterPortraitItem): Row {
  return {
    key: nextKey++,
    id: item.id,
    label: item.label,
    description: item.description,
    usage: item.usage ?? '',
    image: item.image ?? '',
    positive: item.prompt?.positive ?? '',
    negative: item.prompt?.negative ?? '',
    source: item,
  };
}

async function load(): Promise<void> {
  const current = ++generation;
  loading.value = true;
  error.value = '';
  proposedId.value = '';
  missing.value = [];
  try {
    const result = await api.getCharacterPortraits(props.characterId);
    if (current !== generation) return;
    form.value = result;
    const set = result.profile?.portraits;
    rows.value = (set?.items ?? []).map(toRow);
    defaultKey.value = rows.value.find(row => row.id === set?.default)?.key ?? rows.value[0]?.key ?? 0;
    nameColor.value = result.profile?.nameColor ?? '';
    missing.value = result.profile?.missingImages ?? [];
  } catch (cause) {
    if (current !== generation) return;
    form.value = undefined;
    rows.value = [];
    error.value = message(cause);
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.characterId, props.workspaceRoot], () => { void load(); }, { immediate: true });

function addRow(image = ''): void {
  if (rows.value.length >= MAX_ITEMS) return;
  let number = rows.value.length + 1;
  while (rows.value.some(row => row.id === `portrait-${number}`)) number += 1;
  const row: Row = { key: nextKey++, id: `portrait-${number}`, label: '', description: '', usage: '', image, positive: '', negative: '' };
  rows.value.push(row);
  if (rows.value.length === 1) defaultKey.value = row.key;
}

function removeRow(key: number): void {
  rows.value = rows.value.filter(row => row.key !== key);
  if (defaultKey.value === key) defaultKey.value = rows.value[0]?.key ?? 0;
}

function toItem(row: Row): CharacterPortraitItem {
  const positive = row.positive.trim();
  const negative = row.negative.trim();
  const sameImage = row.source?.image === (row.image || undefined);
  return {
    id: row.id,
    label: row.label.trim(),
    description: row.description.trim(),
    ...(row.usage.trim() ? { usage: row.usage.trim() } : {}),
    ...(row.image ? { image: row.image } : {}),
    ...(positive ? {
      prompt: {
        positive,
        ...(negative ? { negative } : {}),
        ...(row.source?.prompt?.useCharacterTags === undefined ? {} : { useCharacterTags: row.source.prompt.useCharacterTags }),
      },
    } : {}),
    // A generation record describes one image; it does not follow the row to a different file.
    ...(row.source?.generation && sameImage && row.image ? { generation: row.source.generation } : {}),
  };
}

async function save(): Promise<void> {
  const current = profile.value;
  if (!current || !canSave.value) return;
  saving.value = true;
  error.value = '';
  proposedId.value = '';
  try {
    const items = rows.value.map(toItem);
    const result = await api.proposeCharacterPortraits(props.characterId, {
      expectedWorkspaceRoot: props.workspaceRoot,
      sourceHash: current.sourceHash,
      portraits: items.length
        ? { default: rows.value.find(row => row.key === defaultKey.value)?.id ?? items[0]!.id, items }
        : null,
      nameColor: nameColor.value || null,
    });
    proposedId.value = result.pendingActionId;
    missing.value = result.missingImages;
    emit('pendingActionCreated');
  } catch (cause) {
    error.value = message(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="portrait-form" :aria-labelledby="`${prefix}-heading`" :aria-busy="loading || saving">
    <header>
      <h3 :id="`${prefix}-heading`">角色立绘<template v-if="profile"> · {{ profile.name }}</template></h3>
      <button type="button" :disabled="loading || saving" @click="load">重新载入</button>
    </header>
    <small>
      每套立绘先写文字描述，图片可以以后再配。没有图片时舞台显示剪影和这段描述。
      保存不会直接改文件，而是生成一条待确认改动，你确认后才写入名册。
    </small>

    <p v-if="error" class="portrait-form-error" role="alert">{{ error }}</p>
    <p v-if="loading">正在载入…</p>
    <p v-else-if="form && !profile" role="note">
      这个角色还没有名册文件 <code>{{ form.path }}</code>，立绘无法保存。可以先用设定工坊生成角色，或自己建立这个文件。
    </p>

    <template v-if="profile && !loading">
      <p v-if="profile.legacyRefImagePath && !rows.length" class="portrait-form-legacy" role="note">
        这个角色还在用旧的单张图片 <code>{{ profile.legacyRefImagePath }}</code>，仍然照常显示。
        建立立绘后，舞台会改用这里的默认立绘；旧图片不会被删除或改动。
      </p>

      <p v-if="!rows.length" class="portrait-form-empty">还没有立绘。</p>
      <ol class="portrait-form-rows">
        <li v-for="(row, index) in rows" :key="row.key">
          <div class="portrait-form-preview">
            <ImageAssetView v-if="row.image" :path="row.image" :alt="row.label || row.id" />
            <span v-else class="portrait-form-silhouette" role="img" :aria-label="`${row.label || row.id}：还没有图片`">剪影</span>
          </div>
          <div class="portrait-form-fields">
            <label>
              <span>名称</span>
              <input v-model="row.label" maxlength="16" placeholder="例如 常服" :aria-label="`第 ${index + 1} 套立绘名称`" />
            </label>
            <label>
              <span>编号</span>
              <input v-model.trim="row.id" maxlength="32" :aria-label="`第 ${index + 1} 套立绘编号`" />
            </label>
            <label class="wide">
              <span>文字描述</span>
              <textarea v-model="row.description" rows="2" maxlength="500" placeholder="这套立绘里人物的样子、穿着、神态" :aria-label="`第 ${index + 1} 套立绘描述`"></textarea>
            </label>
            <label class="wide">
              <span>适用场合（可不填）</span>
              <input v-model="row.usage" maxlength="200" placeholder="例如 日常、校内" :aria-label="`第 ${index + 1} 套立绘适用场合`" />
            </label>
            <label class="wide">
              <span>图片（可不选）</span>
              <select v-model="row.image" :aria-label="`第 ${index + 1} 套立绘图片`">
                <option value="">不配图片，显示剪影</option>
                <option v-if="row.image && !imageChoices.some(image => image.path === row.image)" :value="row.image">{{ row.image }}（文件不在本机）</option>
                <option v-for="image in imageChoices" :key="image.path" :value="image.path">{{ image.name }}</option>
              </select>
            </label>
            <details class="wide">
              <summary>生图提示词（可不填）</summary>
              <label>
                <span>提示词</span>
                <textarea v-model="row.positive" rows="2" maxlength="2000" :aria-label="`第 ${index + 1} 套立绘提示词`"></textarea>
              </label>
              <label>
                <span>反向提示词</span>
                <textarea v-model="row.negative" rows="2" maxlength="2000" :aria-label="`第 ${index + 1} 套立绘反向提示词`"></textarea>
              </label>
            </details>
            <div class="portrait-form-row-actions wide">
              <label class="portrait-form-default">
                <input v-model="defaultKey" type="radio" :name="`${prefix}-default`" :value="row.key" />
                <span>默认立绘</span>
              </label>
              <button type="button" @click="removeRow(row.key)">移除这套</button>
            </div>
          </div>
        </li>
      </ol>

      <div class="portrait-form-actions">
        <button type="button" :disabled="rows.length >= MAX_ITEMS" @click="addRow()">添加一套立绘</button>
        <label class="portrait-form-color">
          <span>名字牌颜色（可不填）</span>
          <input v-model.trim="nameColor" maxlength="7" placeholder="#E9C983" aria-label="名字牌颜色" />
          <span v-if="NAME_COLOR.test(nameColor)" class="portrait-form-swatch" :style="{ background: nameColor }" aria-hidden="true"></span>
        </label>
        <button type="button" class="primary" :disabled="!canSave" @click="save">{{ saving ? '正在生成…' : '保存为待确认改动' }}</button>
      </div>
      <p v-if="problem" class="portrait-form-problem" role="note">{{ problem }}</p>

      <ul v-if="missing.length" class="portrait-form-missing" role="status">
        <li v-for="item in missing" :key="item.id">
          提醒：立绘“{{ item.id }}”的图片 <code>{{ item.image }}</code> 现在读不到（{{ item.reason }}）。可以照常保存，舞台会先显示剪影。
        </li>
      </ul>
      <p v-if="proposedId" class="portrait-form-proposed" role="status">
        已生成待确认改动，名册文件还没有变。
        <button type="button" @click="emit('reviewPendingAction', proposedId)">去查看并确认</button>
      </p>
    </template>
  </section>
</template>

<style scoped>
.portrait-form { display:grid; gap:10px; padding-top:12px; border-top:1px solid var(--play-line, #c9c9c9); }
.portrait-form > header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.portrait-form h3 { margin:0; font-size:13px; }
.portrait-form p { margin:0; line-height:1.6; }
.portrait-form button, .portrait-form input, .portrait-form select, .portrait-form textarea { padding:5px 8px; border:1px solid var(--play-line, #c9c9c9); border-radius:4px; background:var(--play-canvas, transparent); color:inherit; font:inherit; font-size:12px; }
.portrait-form button { cursor:pointer; }
.portrait-form button:disabled { opacity:.5; cursor:default; }
.portrait-form button.primary { font-weight:600; }
.portrait-form-error { color:var(--play-danger, #b42318); }
.portrait-form-rows { display:grid; gap:10px; margin:0; padding:0; list-style:none; }
.portrait-form-rows > li { display:grid; grid-template-columns:120px minmax(0, 1fr); gap:12px; padding:10px; border:1px solid var(--play-line, #c9c9c9); border-radius:6px; }
.portrait-form-preview { display:grid; place-items:center; height:150px; overflow:hidden; }
.portrait-form-preview :deep(.image-asset) { max-height:150px; }
.portrait-form-silhouette { display:grid; place-items:center; width:84px; height:130px; border:1px dashed currentcolor; border-radius:42px 42px 8px 8px; opacity:.6; font-size:11px; }
.portrait-form-fields { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; }
.portrait-form-fields label, .portrait-form-fields details label { display:grid; gap:3px; }
.portrait-form-fields label > span { font-size:11px; opacity:.75; }
.portrait-form-fields .wide { grid-column:1 / -1; }
.portrait-form-fields textarea { resize:vertical; line-height:1.5; }
.portrait-form-fields details { display:grid; gap:6px; }
.portrait-form-fields summary { cursor:pointer; font-size:12px; }
.portrait-form-row-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.portrait-form-fields label.portrait-form-default { display:flex; align-items:center; gap:6px; }
.portrait-form-fields label.portrait-form-default > span { font-size:12px; opacity:1; }
.portrait-form-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.portrait-form-actions .primary { margin-left:auto; }
.portrait-form-color { display:flex; align-items:center; gap:6px; font-size:12px; }
.portrait-form-color input { width:90px; }
.portrait-form-swatch { width:16px; height:16px; border:1px solid var(--play-line, #c9c9c9); border-radius:3px; }
.portrait-form-problem { font-size:12px; opacity:.85; }
.portrait-form-missing { margin:0; padding-left:18px; }
.portrait-form-proposed { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.portrait-form code { font-size:11px; overflow-wrap:anywhere; }
@media (max-width: 720px) {
  .portrait-form-rows > li { grid-template-columns:1fr; }
  .portrait-form-fields { grid-template-columns:1fr; }
}
</style>
