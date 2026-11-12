<script setup lang="ts">
import { PLAY_STAGE_READING_LIMITS } from '../../composables/usePlayStageReadingPrefs';
import type { PlayStageReadingPrefs } from '../../composables/usePlayStageReadingPrefs';

defineProps<{ prefs: Readonly<PlayStageReadingPrefs> }>();
const emit = defineEmits<{ update: [patch: Partial<PlayStageReadingPrefs>]; close: [] }>();
const limits = PLAY_STAGE_READING_LIMITS;

function number(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}
</script>
<template>
  <aside class="vn-settings" aria-label="阅读设置">
    <header>
      <strong>阅读设置</strong>
      <button type="button" @click="emit('close')">关闭</button>
    </header>
    <label>
      <span>打字效果</span>
      <input type="checkbox" :checked="prefs.typewriter" @change="emit('update', { typewriter: ($event.target as HTMLInputElement).checked })" />
    </label>
    <label>
      <span>字速 · {{ prefs.charsPerSecond }} 字/秒</span>
      <input
        type="range" aria-label="字速" :min="limits.charsPerSecond.min" :max="limits.charsPerSecond.max" step="5"
        :value="prefs.charsPerSecond" :disabled="!prefs.typewriter" @input="emit('update', { charsPerSecond: number($event) })"
      />
    </label>
    <label>
      <span>自动间隔 · {{ (prefs.autoDelayMs / 1000).toFixed(1) }} 秒</span>
      <input
        type="range" aria-label="自动间隔" :min="limits.autoDelayMs.min" :max="limits.autoDelayMs.max" step="100"
        :value="prefs.autoDelayMs" @input="emit('update', { autoDelayMs: number($event) })"
      />
    </label>
    <label>
      <span>对话框不透明度 · {{ Math.round(prefs.boxOpacity * 100) }}%</span>
      <input
        type="range" aria-label="对话框不透明度" :min="limits.boxOpacity.min * 100" :max="limits.boxOpacity.max * 100" step="5"
        :value="Math.round(prefs.boxOpacity * 100)" @input="emit('update', { boxOpacity: number($event) / 100 })"
      />
    </label>
    <small>设置保存在本机的界面偏好里，对所有会话生效。</small>
  </aside>
</template>
<style scoped>
.vn-settings { position:absolute; top:64px; right:24px; z-index:3; display:grid; gap:12px; width:min(320px, calc(100% - 48px)); padding:16px; border:1px solid #657181; border-radius:10px; background:#0d1520f5; color:#f5ebd8; font-size:13px; }
.vn-settings header { display:flex; align-items:center; justify-content:space-between; }
.vn-settings header button { padding:6px 10px; color:inherit; border:1px solid #657181; border-radius:6px; background:#283447; cursor:pointer; }
.vn-settings label { display:grid; gap:6px; }
.vn-settings label:has(input[type='checkbox']) { grid-template-columns:1fr auto; align-items:center; }
.vn-settings input[type='range'] { width:100%; }
.vn-settings small { color:#8f9bab; font-size:11px; }
</style>
