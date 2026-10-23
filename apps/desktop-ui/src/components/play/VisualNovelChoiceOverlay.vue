<script setup lang="ts">
defineProps<{ choices: string[]; disabled: boolean }>();
defineEmits<{ choose: [text: string] }>();
</script>
<template><div class="vn-choices" aria-label="行动选项"><button v-for="(choice, index) in choices.slice(0, 9)" :key="`${index}-${choice}`" type="button" :disabled="disabled" @click="$emit('choose', choice)">{{ index + 1 }} · {{ choice }}</button></div></template>
<style scoped>.vn-choices { display:grid; gap:10px; max-width:560px; margin:24px auto; }.vn-choices button { padding:12px 20px; background:#1e293bee; color:#f5e7c6; border:1px solid #8d7c57; border-radius:8px; text-align:left; }.vn-choices button:disabled { opacity:.5; }</style>
