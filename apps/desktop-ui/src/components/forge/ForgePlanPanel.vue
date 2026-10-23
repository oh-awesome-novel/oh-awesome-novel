<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import ForgePlanField from './ForgePlanField.vue';
const props = defineProps<{ plan: Record<string, unknown>; busy: boolean }>();
const emit = defineEmits<{ save: [plan: Record<string, unknown>]; dirty: [value: boolean] }>();
const edited = shallowRef(props.plan);
const dirty = shallowRef(false);
watch(() => props.plan, value => { edited.value = value; dirty.value = false; emit('dirty', false); });
function change(value: unknown) { edited.value = value as Record<string, unknown>; dirty.value = true; emit('dirty', true); }
</script>
<template><section aria-label="方案审查"><h3>定方案</h3><p>修改台词、边界与开场；拖拽或用上下按钮调整条目。</p><ForgePlanField :value="edited" label="方案" :busy="busy" @change="change" /><button type="button" :disabled="busy || !dirty" @click="emit('save', edited)">保存方案修改</button><p v-if="dirty" role="status">方案有未保存的修改，请先保存再撰写。</p></section></template>
