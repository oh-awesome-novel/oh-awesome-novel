<script setup lang="ts">
const props = defineProps<{ value: unknown; label: string; busy: boolean }>();
const emit = defineEmits<{ change: [value: unknown] }>();
function replace(key: string | number, value: unknown) {
  if (Array.isArray(props.value)) { const next = [...props.value]; next[Number(key)] = value; emit('change', next); }
  else if (props.value && typeof props.value === 'object') emit('change', { ...props.value, [key]: value });
}
function move(index: number, direction: number) {
  if (!Array.isArray(props.value)) return;
  const values = [...props.value]; const target = index + direction;
  if (index < 0 || index >= values.length || target < 0 || target >= values.length) return;
  [values[index], values[target]] = [values[target], values[index]];
  emit('change', values);
}
const labels: Record<string, string> = { title:'标题', characters:'角色', name:'名称', id:'标识', aliases:'别名', palette:'性格调色盘', base:'底色', mainTones:'主色调', accents:'点缀', behaviors:'场景行为', facets:'三面性', kind:'类型', trigger:'触发条件', state:'身心状态', dialogue:'纯台词', habitualAction:'习惯动作', clarifications:'特质边界', trait:'特质', meaning:'真正含义', when:'何时出现', not:'绝不是', desire:'当前欲望', goal:'即时目标', obstacle:'阻力', cost:'代价', choice:'主动选择', dilemma:'两难', decision:'决定', sacrifice:'牺牲', consequence:'后果', resources:'资源账本', initial:'初态', settlement:'兑现条件', world:'世界', premise:'前提', rules:'规则', factions:'势力', history:'往事', places:'地点', appearance:'样子', atmosphere:'氛围', events:'常发事件', opening:'开场白' };
</script>
<template>
  <div class="plan-field">
    <label v-if="typeof value === 'string'">{{ labels[label] ?? label }}<textarea :value="value" :disabled="busy" rows="3" @input="emit('change', ($event.target as HTMLTextAreaElement).value)" /></label>
    <fieldset v-else-if="Array.isArray(value)" :disabled="busy"><legend>{{ labels[label] ?? label }}</legend>
      <div v-for="(item, index) in value" :key="index" class="array-item" draggable="true" @dragstart="($event.dataTransfer?.setData('text/plain', String(index)))" @dragover.prevent @drop.prevent="(event) => { const from = Number(event.dataTransfer?.getData('text/plain')); if (Number.isInteger(from)) move(from, index - from); }">
        <ForgePlanField :value="item" :label="`${index + 1}`" :busy="busy" @change="replace(index, $event)" />
        <button type="button" :disabled="busy || index === 0" aria-label="上移条目" @click="move(index, -1)">↑</button><button type="button" :disabled="busy || index === value.length - 1" aria-label="下移条目" @click="move(index, 1)">↓</button>
      </div>
    </fieldset>
    <fieldset v-else-if="value && typeof value === 'object'" :disabled="busy"><legend>{{ labels[label] ?? label }}</legend><ForgePlanField v-for="(item, key) in value" :key="key" :value="item" :label="String(key)" :busy="busy" @change="replace(String(key), $event)" /></fieldset>
    <p v-else>{{ labels[label] ?? label }}: {{ value }}</p>
  </div>
</template>
<style scoped>
textarea{display:block;box-sizing:border-box;width:100%;margin:6px 0;font:inherit}fieldset{min-width:0;border:1px solid var(--border-color,#ddd);border-radius:8px;padding:10px;margin:8px 0}.array-item{border-left:2px solid var(--border-color,#ddd);padding-left:10px;margin-bottom:10px}button{margin-right:8px}
</style>
