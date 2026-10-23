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
const labels: Record<string, string> = { title:'标题', characters:'角色', name:'姓名', id:'标识', palette:'性格调色盘', base:'底色', mainTones:'主色调', accents:'点缀', facets:'三面性', normal:'常态面', pressure:'压力面', private:'私密面', trigger:'触发条件', state:'身心状态', dialogue:'纯台词', habit:'习惯动作', clarifications:'特质边界', stage:'舞台', rules:'规则', places:'地点', opening:'开场白', desire:'当前欲望', goal:'即时目标', cost:'代价', choice:'主动选择', resources:'资源账本', world:'世界', techniques:'故事动力', description:'描述', initial:'初态', consumption:'消耗', reward:'收益', behaviors:'场景行为' };
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
