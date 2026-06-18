<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue';

defineProps<{
  theme: 'light' | 'dark';
}>();

const emit = defineEmits<{
  toggleTheme: [];
}>();
</script>

<template>
  <section class="settings-main" aria-label="设置">
    <header class="settings-page-header">
      <div>
        <p class="eyebrow">Settings</p>
        <h1 class="settings-title">设置</h1>
      </div>
    </header>

    <div class="settings-section">
      <div class="settings-section-heading">
        <h2 class="panel-title">外观</h2>
        <p class="empty-copy">控制启动器和桌面工作台的显示主题。</p>
      </div>

      <div class="settings-option-row">
        <div class="settings-option-copy">
          <strong>主题</strong>
          <span>{{ theme === 'dark' ? '深色模式' : '浅色模式' }}</span>
        </div>
        <button
          class="theme-choice-button"
          type="button"
          role="switch"
          :aria-checked="theme === 'dark'"
          @click="emit('toggleTheme')"
        >
          <Sun v-if="theme === 'light'" :size="16" aria-hidden="true" />
          <Moon v-else :size="16" aria-hidden="true" />
          <span>{{ theme === 'dark' ? 'Dark' : 'Light' }}</span>
        </button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-heading">
        <h2 class="panel-title">即将支持</h2>
        <p class="empty-copy">后续可以在这里扩展编辑器、快捷键、模型和工作区行为等配置。</p>
      </div>
    </div>
  </section>
</template>
