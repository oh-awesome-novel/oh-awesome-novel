<script setup lang="ts">
import { computed, useId } from 'vue';

import type { PlayRelativeTimeAdvance } from '../../composables/useWorkspaceApi';

const timeAdvance = defineModel<PlayRelativeTimeAdvance | undefined>('timeAdvance', {
  required: true,
});

defineProps<{
  disabled: boolean;
}>();

const hintId = useId();

const presets: Array<{
  label: string;
  value: PlayRelativeTimeAdvance;
}> = [
  { label: '10 分钟', value: { amount: 10, unit: 'minute' } },
  { label: '1 小时', value: { amount: 1, unit: 'hour' } },
  { label: '1 天', value: { amount: 1, unit: 'day' } },
];

const amount = computed(() => timeAdvance.value?.amount ?? '');
const unit = computed(() => timeAdvance.value?.unit ?? 'minute');
const maximumAmount = computed<number>(() => {
  switch (unit.value) {
    case 'minute': return 525_600;
    case 'hour': return 8_760;
    case 'day': return 365;
    default: return 525_600;
  }
});

function selectPreset(value: PlayRelativeTimeAdvance) {
  timeAdvance.value = { ...value };
}

function updateAmount(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximumAmount.value) {
    timeAdvance.value = undefined;
    return;
  }

  timeAdvance.value = { amount: value, unit: unit.value };
}

function updateUnit(event: Event) {
  const value = (event.target as HTMLSelectElement).value as PlayRelativeTimeAdvance['unit'];
  const currentAmount = timeAdvance.value?.amount;
  const maximum = value === 'minute' ? 525_600 : value === 'hour' ? 8_760 : 365;
  timeAdvance.value = {
    amount: Number.isSafeInteger(currentAmount) &&
      (currentAmount ?? 0) > 0 &&
      (currentAmount ?? 0) <= maximum
      ? currentAmount as number
      : 1,
    unit: value,
  };
}

function isSelected(value: PlayRelativeTimeAdvance): boolean {
  return timeAdvance.value?.amount === value.amount && timeAdvance.value.unit === value.unit;
}
</script>

<template>
  <section class="play-time-advance" aria-label="推进世界时间">
    <div class="play-time-advance-heading">
      <div>
        <strong>推进时间</strong>
        <span>回合提交成功后，世界才会前进。</span>
      </div>
      <span aria-hidden="true">[time +]</span>
    </div>

    <div class="play-time-presets" aria-label="常用等待时长">
      <button
        v-for="preset in presets"
        :key="`${preset.value.amount}-${preset.value.unit}`"
        type="button"
        :aria-pressed="isSelected(preset.value)"
        :disabled="disabled"
        @click="selectPreset(preset.value)"
      >
        {{ preset.label }}
      </button>
    </div>

    <div class="play-time-custom">
      <label>
        <span>自定义时长</span>
        <input
          :value="amount"
          type="number"
          min="1"
          :max="maximumAmount"
          step="1"
          inputmode="numeric"
          :disabled="disabled"
          :aria-describedby="hintId"
          @input="updateAmount"
        >
      </label>
      <label>
        <span class="visually-hidden">时间单位</span>
        <select :value="unit" :disabled="disabled" @change="updateUnit">
          <option value="minute">分钟</option>
          <option value="hour">小时</option>
          <option value="day">天</option>
        </select>
      </label>
    </div>

    <p :id="hintId">
      实际推进以上方时长为准；输入文字只描述等待意图。绝对世界时间需要世界时间规则后才会启用。
    </p>
  </section>
</template>
