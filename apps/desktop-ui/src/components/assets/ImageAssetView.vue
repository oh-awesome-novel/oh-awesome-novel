<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';

/**
 * Shows one image from the workspace's `assets/` folder at its original size and bytes.
 * A missing or damaged file is not an error for the page: the image's place shows why.
 */
const props = defineProps<{
  /** Workspace-relative image path as a formal file records it. */
  path: string;
  alt: string;
  /** Changes when the file behind the same path may have changed. */
  revision?: string | number;
  /** SHA-256 the image had when something recorded it; a different file gets a "replaced" mark. */
  expectedSha256?: string;
}>();
const emit = defineEmits<{ state: [state: 'loading' | 'ready' | 'unavailable', reason?: string] }>();

const api = useWorkspaceApi();
const url = shallowRef('');
const reason = shallowRef('');
const loading = shallowRef(false);
const replaced = shallowRef(false);
let generation = 0;

function release(): void {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = '';
}

async function load(): Promise<void> {
  const current = ++generation;
  release();
  reason.value = '';
  replaced.value = false;
  loading.value = true;
  emit('state', 'loading');
  try {
    const blob = await api.readImageAsset(props.path);
    if (current !== generation) return;
    const actual = props.expectedSha256 ? await sha256(blob) : undefined;
    if (current !== generation) return;
    replaced.value = Boolean(actual && actual !== props.expectedSha256);
    url.value = URL.createObjectURL(blob);
    emit('state', 'ready');
  } catch (error) {
    if (current !== generation) return;
    reason.value = error instanceof Error && error.message ? error.message : '图片无法读取。';
    emit('state', 'unavailable', reason.value);
  } finally {
    if (current === generation) loading.value = false;
  }
}

/** Undefined when this environment cannot hash; the image is then shown without the comparison. */
async function sha256(blob: Blob): Promise<string | undefined> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

watch(() => [props.path, props.revision, props.expectedSha256], () => { void load(); }, { immediate: true });
onBeforeUnmount(() => { generation += 1; release(); });
</script>

<template>
  <span v-if="url && replaced" class="image-asset-replaced">
    <img class="image-asset" :src="url" :alt="alt" />
    <small role="note" title="这张图片的内容与会话开局时记录的不同。">开局后已更换</small>
  </span>
  <img v-else-if="url" class="image-asset" :src="url" :alt="alt" />
  <span v-else class="image-asset-placeholder" role="img" :aria-label="`${alt}：${loading ? '正在载入' : reason}`" :title="reason">
    <strong>{{ alt }}</strong>
    <small>{{ loading ? '正在载入…' : reason }}</small>
  </span>
</template>

<style scoped>
.image-asset { display:block; max-width:100%; max-height:100%; object-fit:contain; }
.image-asset-replaced { position:relative; display:inline-grid; max-width:100%; max-height:100%; }
.image-asset-replaced small { position:absolute; left:4px; bottom:4px; padding:1px 6px; border-radius:4px; background:#000a; color:#fff; font-size:11px; }
.image-asset-placeholder { display:grid; align-content:center; justify-items:center; gap:4px; min-width:96px; min-height:96px; padding:10px; border:1px dashed currentcolor; border-radius:6px; text-align:center; opacity:.75; }
.image-asset-placeholder small { font-size:11px; line-height:1.4; overflow-wrap:anywhere; }
</style>
