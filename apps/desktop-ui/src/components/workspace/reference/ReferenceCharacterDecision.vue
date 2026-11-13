<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  CharacterAdoptionDecision,
  ReferenceCharacterMatch,
  ReferenceMaterialAdoptionEntry,
} from "@oh-awesome-novel/client";
const props = defineProps<{
  match: ReferenceCharacterMatch;
  entry: ReferenceMaterialAdoptionEntry;
  characters: Array<{ id: string; name: string }>;
  disabled: boolean;
  decision?: CharacterAdoptionDecision;
}>();
const emit = defineEmits<{ decide: [decision: CharacterAdoptionDecision]; remove: [] }>();
const kind = ref<"same" | "different">("same");
const characterId = ref("");
const existing = computed(() =>
  props.match.matches.find((c) => c.characterId === characterId.value),
);
watch(
  () => [props.match.entryId, props.match.materialHash],
  () => {
    kind.value = props.decision?.kind ?? "same";
    characterId.value =
      props.decision?.characterId ??
      props.match.recordedCharacterId ??
      props.match.matches[0]?.characterId ??
      props.characters[0]?.id ??
      "";
  },
  { immediate: true },
);
function changeKind() {
  characterId.value =
    kind.value === "different"
      ? props.match.suggestedCharacterId
      : (props.match.recordedCharacterId ??
        props.match.matches[0]?.characterId ??
        props.characters[0]?.id ??
        "");
}
</script>
<template>
  <section class="character-decision" aria-label="人物对照与裁定">
    <strong>{{
      match.stale
        ? "材料已变化，请重新确认人物对应"
        : match.recordedCharacterId
          ? `已记录对应：${match.recordedCharacterId}`
          : match.matches.length
            ? "可能是已有人物"
            : "也可以手动指定已有角色"
    }}</strong>
    <div class="character-comparison">
      <article>
        <h5>来料：{{ entry.title }}</h5>
        <p>{{ entry.content }}</p>
        <p v-for="detail in entry.details" :key="detail">{{ detail }}</p>
      </article>
      <article>
        <h5>已有角色：{{ existing?.name ?? characterId }}</h5>
        <p v-if="!existing">选择后确认并再次预检，可读取该角色的文件对照。</p>
        <details v-for="file in existing?.files" :key="file.path" open>
          <summary>{{ file.path }}{{ file.truncated ? "（仅显示前 8000 字）" : "" }}</summary>
          <pre>{{ file.content }}</pre>
        </details>
      </article>
    </div>
    <label
      >人物裁定<select
        v-model="kind"
        :disabled="disabled"
        aria-label="人物裁定"
        @change="changeKind"
      >
        <option value="same">同一人物，合并到已有角色</option>
        <option value="different">不同人物，另建角色</option>
      </select></label
    >
    <label v-if="kind === 'same'"
      >已有角色<select v-model="characterId" :disabled="disabled" aria-label="合并目标角色">
        <option v-for="character in characters" :key="character.id" :value="character.id">
          {{ character.name }} · {{ character.id }}
        </option>
      </select></label
    >
    <label v-else
      >新角色 ID<input
        v-model="characterId"
        :disabled="disabled"
        aria-label="新角色 ID"
        maxlength="100"
    /></label>
    <button
      type="button"
      :disabled="disabled || !characterId"
      @click="emit('decide', { kind, characterId, materialHash: match.materialHash })"
    >
      确认人物裁定
    </button>
    <button type="button" :disabled="disabled" @click="emit('remove')">本次不处理</button>
    <p v-if="decision">
      已选择{{ decision.kind === "same" ? "同一人物" : "不同人物" }}：{{
        decision.characterId
      }}。请重新预检。
    </p>
  </section>
</template>
<style scoped>
.character-decision {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #94a3b880;
  border-radius: 6px;
}
.character-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
article {
  min-width: 0;
}
h5 {
  margin: 0;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
}
label {
  display: grid;
  gap: 6px;
}
@media (max-width: 640px) {
  .character-comparison {
    grid-template-columns: 1fr;
  }
}
</style>
