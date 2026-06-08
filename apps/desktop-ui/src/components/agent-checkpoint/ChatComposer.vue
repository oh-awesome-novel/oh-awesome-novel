<script setup lang="ts">
const model = defineModel<string>({ required: true });

defineProps<{
  disabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
}>();

function submit() {
  if (!model.value.trim()) {
    return;
  }

  emit('submit');
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      v-model="model"
      class="composer-input"
      rows="3"
      :disabled="disabled"
      placeholder="Ask the checkpoint agent..."
    />
    <button class="primary-button" type="submit" :disabled="disabled || !model.trim()">
      Send
    </button>
  </form>
</template>
