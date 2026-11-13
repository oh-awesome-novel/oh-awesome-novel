<script setup lang="ts">
import { ref, shallowRef, watch } from "vue";
import type { OanClient, RegisteredWork, WorkRegistryView } from "@oh-awesome-novel/client";
import { useWorkspaceApi } from "../../composables/useWorkspaceApi";
const props = defineProps<{
  workspaceRoot: string;
  api?: Pick<OanClient, "getWorkRegistry" | "proposeWorkRegistry">;
}>();
const emit = defineEmits<{
  reviewPendingAction: [id: string];
  pendingActionCreated: [];
  close: [];
}>();
const api = props.api ?? useWorkspaceApi();
const view = shallowRef<WorkRegistryView>();
const works = ref<Array<RegisteredWork & { aliasText: string; referenceText: string }>>([]);
const origins = ref<Record<string, string>>({});
const busy = ref(false),
  error = ref(""),
  pending = ref("");
let epoch = 0;
async function load() {
  const current = ++epoch;
  busy.value = true;
  error.value = "";
  pending.value = "";
  view.value = undefined;
  try {
    const next = await api.getWorkRegistry();
    if (current !== epoch) return;
    view.value = next;
    works.value = (next.registry?.works ?? []).map((work) => ({
      ...work,
      aliasText: (work.aliases ?? []).join(", "),
      referenceText: (work.referenceIds ?? []).join(", "),
    }));
    origins.value = Object.fromEntries(
      next.attributions.map((item) => [item.path, item.originWorkId ?? ""]),
    );
  } catch (caught) {
    if (current === epoch) error.value = String(caught instanceof Error ? caught.message : caught);
  } finally {
    if (current === epoch) busy.value = false;
  }
}
const list = (text: string) =>
  text
    .split(/[,，]/u)
    .map((s) => s.trim())
    .filter(Boolean);
async function save() {
  if (!view.value || busy.value) return;
  const current = ++epoch;
  busy.value = true;
  error.value = "";
  try {
    const result = await api.proposeWorkRegistry({
      expectedWorkspaceRoot: props.workspaceRoot,
      fingerprint: view.value.fingerprint,
      edit: {
        registry: {
          version: 1,
          works: works.value.map((work) => ({
            id: work.id.trim(),
            title: work.title.trim(),
            aliases: list(work.aliasText),
            referenceIds: list(work.referenceText),
          })),
        },
        attributions: view.value.attributions
          .filter((item) => (item.originWorkId ?? "") !== origins.value[item.path])
          .map((item) => ({ path: item.path, originWorkId: origins.value[item.path] || null })),
      },
    });
    if (current !== epoch) return;
    pending.value = result.pendingActionId;
    emit("pendingActionCreated");
  } catch (caught) {
    if (current === epoch) error.value = String(caught instanceof Error ? caught.message : caught);
  } finally {
    if (current === epoch) busy.value = false;
  }
}
watch(
  () => props.workspaceRoot,
  () => {
    void load();
  },
  { immediate: true },
);
</script>
<template>
  <section class="work-registry" aria-label="作品登记与归属">
    <header>
      <h2>作品登记与归属</h2>
      <button type="button" @click="emit('close')">关闭</button>
    </header>
    <p>登记原作、绑定参考作品，并标注角色与世界设定。保存后先审阅 diff，接受后才生效。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="pending" role="status">
      已创建审批，作品文件尚未修改。<button
        type="button"
        @click="emit('reviewPendingAction', pending)"
      >
        审阅归属修改
      </button>
    </p>
    <form v-if="view" @submit.prevent="save">
      <fieldset :disabled="busy || Boolean(pending)">
        <legend>原作清单</legend>
        <div v-for="(work, index) in works" :key="index" class="work-row">
          <label
            >作品 ID<input
              v-model="work.id"
              required
              maxlength="100"
              :readonly="
                Boolean(
                  view.registry?.works[index] &&
                  view.registry.works.some((old) => old.id === work.id),
                )
              "
              placeholder="work-a"
          /></label>
          <label>作品名称<input v-model="work.title" required maxlength="120" /></label>
          <label>别名（逗号分隔）<input v-model="work.aliasText" /></label>
          <label>参考作品 ID（逗号分隔）<input v-model="work.referenceText" /></label>
          <button type="button" @click="works.splice(index, 1)">移除作品</button>
        </div>
        <button
          type="button"
          :disabled="works.length >= 200"
          @click="works.push({ id: '', title: '', aliasText: '', referenceText: '' })"
        >
          添加作品
        </button>
      </fieldset>
      <fieldset :disabled="busy || Boolean(pending)">
        <legend>对象归属</legend>
        <p>未标注与原创都可以使用；一个角色只归属一部本源作品。</p>
        <label v-for="item in view.attributions" :key="item.path" class="attribution-row"
          >{{ item.label }}<small>{{ item.path }}</small>
          <select v-model="origins[item.path]" :aria-label="`${item.path} 所属作品`">
            <option value="">未标注 / 原创</option>
            <option value="original">原创</option>
            <option
              v-for="work in works.filter((w) => w.id && w.title)"
              :key="work.id"
              :value="work.id"
            >
              {{ work.title }}
            </option>
          </select>
        </label>
      </fieldset>
      <button type="submit" :disabled="busy || Boolean(pending)">生成归属审批</button>
    </form>
    <button type="button" :disabled="busy" @click="load">
      {{ busy ? "处理中…" : "重新载入" }}
    </button>
  </section>
</template>
<style scoped>
.work-registry {
  display: grid;
  gap: 12px;
  padding: 20px;
  overflow: auto;
  color: inherit;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h2,
p {
  margin: 0;
}
form,
fieldset {
  display: grid;
  gap: 12px;
}
fieldset {
  border: 1px solid #94a3b880;
  border-radius: 8px;
}
.work-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-block: 8px;
  border-bottom: 1px solid #94a3b840;
}
label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
input,
select {
  padding: 7px;
  min-width: 160px;
  color: inherit;
  background: transparent;
  border: 1px solid #94a3b880;
  border-radius: 4px;
}
.attribution-row {
  grid-template-columns: minmax(140px, 1fr) minmax(160px, 1fr);
  align-items: center;
}
small {
  grid-column: 1;
  overflow-wrap: anywhere;
  opacity: 0.7;
}
select {
  grid-column: 2;
  grid-row: span 2;
}
[role="alert"] {
  color: #dc2626;
}
@media (max-width: 640px) {
  .attribution-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
