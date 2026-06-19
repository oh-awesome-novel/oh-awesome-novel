<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { BookOpen, PenLine, Sparkles, UsersRound } from '@lucide/vue';

import type {
  WorkspaceOnboardingInput,
  WorkspaceSummary,
} from '../../composables/useWorkspaceApi';

type StartGoal = 'characters' | 'outline' | 'opening' | 'chapter';

interface OnboardingFinishPayload extends WorkspaceOnboardingInput {
  prompt: string;
}

const props = defineProps<{
  workspace: WorkspaceSummary;
  providerConfigured: boolean;
  saving: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  skip: [];
  finish: [payload: OnboardingFinishPayload];
  configureProvider: [];
}>();

const stepIndex = shallowRef(0);
const novelName = shallowRef(props.workspace.novelName || props.workspace.name);
const inspiration = shallowRef('');
const characterBrief = shallowRef('');
const includeLead = shallowRef(true);
const includePartner = shallowRef(true);
const includeAntagonist = shallowRef(false);
const startGoal = shallowRef<StartGoal>('characters');

const steps = [
  { id: 'identity', title: '小说名', description: '先给作品一个可变的代号。' },
  { id: 'spark', title: '基础灵感', description: '写下题材、情绪或一句故事火种。' },
  { id: 'cast', title: '生成角色', description: '决定 Copilot 第一轮要补哪些角色卡。' },
  { id: 'start', title: '开始编写', description: '选择下一步进入规划还是正文。' },
] as const;

const currentStep = computed(() => steps[stepIndex.value]);
const isLastStep = computed(() => stepIndex.value === steps.length - 1);
const characterPlan = computed(() => {
  const selected = [
    includeLead.value ? '主角角色卡' : '',
    includePartner.value ? '关键搭档/关系角色卡' : '',
    includeAntagonist.value ? '对手或阻力角色卡' : '',
  ].filter(Boolean);
  const brief = characterBrief.value.trim();

  return [selected.join('、'), brief].filter(Boolean).join('；');
});
const finishLabel = computed(() => (
  props.providerConfigured ? '放到 Copilot 输入框' : '保存并配置 Provider'
));

function goToStep(index: number) {
  stepIndex.value = index;
}

function nextStep() {
  if (isLastStep.value) {
    finish();
    return;
  }

  stepIndex.value += 1;
}

function previousStep() {
  stepIndex.value = Math.max(0, stepIndex.value - 1);
}

function finish() {
  const payload: OnboardingFinishPayload = {
    novelName: novelName.value.trim(),
    inspiration: inspiration.value.trim(),
    characterSeed: characterPlan.value,
    startGoal: startGoal.value,
    skipped: false,
    prompt: buildPrompt(),
  };

  emit('finish', payload);
}

function buildPrompt(): string {
  const command = {
    characters: '/生成角色卡',
    outline: '/规划下一章',
    opening: '/写下一章',
    chapter: '/写下一章',
  } satisfies Record<StartGoal, string>;
  const goalCopy = {
    characters: '请先查重并生成核心角色卡建议。',
    outline: '请先把第一章/下一章的目标、冲突、场景和结尾钩子规划出来。',
    opening: '请基于灵感写一个开场章节草稿，但只能创建 PendingAction。',
    chapter: '请开始写第一章/下一章草稿，但只能创建 PendingAction。',
  } satisfies Record<StartGoal, string>;

  return `${command[startGoal.value]}

这是一个刚创建的 OAN workspace，请按 novel-copilot workflow 工作。

小说名：${novelName.value.trim() || props.workspace.name}
基础灵感：${inspiration.value.trim() || '尚未填写，请先追问或给出 3 个可选方向。'}
角色方向：${characterPlan.value || '请从基础灵感中推导 2-3 个核心角色。'}
本轮目标：${goalCopy[startGoal.value]}

要求：
- 先读取 workflow、constitution、summary、state、timeline、foreshadow。
- 涉及人物时先查已有角色卡，避免重复创建。
- 不要直接写真实文件；正文、角色卡、设定或状态更新都必须通过 PendingAction 提出。
- 如果 workspace 还缺少 constitution 或世界观基础，请先给出最小可用建议。`;
}
</script>

<template>
  <section class="onboarding-guide" aria-label="新建 workspace 引导">
    <header class="onboarding-header">
      <div>
        <p class="eyebrow">New Workspace</p>
        <h2 class="onboarding-title">一步一步开始这本小说</h2>
        <p class="empty-copy">这些内容会保存到 workspace config，并整理成 Copilot 的第一条写作请求。</p>
      </div>
      <button class="ghost-button" type="button" :disabled="saving" @click="emit('skip')">
        跳过
      </button>
    </header>

    <div class="onboarding-layout">
      <nav class="onboarding-steps" aria-label="引导步骤">
        <button
          v-for="(step, index) in steps"
          :key="step.id"
          class="onboarding-step"
          :class="{ 'onboarding-step-active': index === stepIndex }"
          type="button"
          @click="goToStep(index)"
        >
          <span>{{ index + 1 }}</span>
          <strong>{{ step.title }}</strong>
          <small>{{ step.description }}</small>
        </button>
      </nav>

      <div class="onboarding-card">
        <div v-if="currentStep.id === 'identity'" class="onboarding-section">
          <BookOpen class="onboarding-section-icon" :size="24" aria-hidden="true" />
          <div>
            <h3 class="onboarding-section-title">小说名字</h3>
            <p class="empty-copy">可以先写临时代号，后续仍然可以改。</p>
          </div>
          <label class="field field-wide">
            <span>作品名</span>
            <input
              v-model="novelName"
              class="text-input"
              type="text"
              placeholder="例如 雾港来信"
            >
          </label>
        </div>

        <div v-else-if="currentStep.id === 'spark'" class="onboarding-section">
          <Sparkles class="onboarding-section-icon" :size="24" aria-hidden="true" />
          <div>
            <h3 class="onboarding-section-title">基础灵感</h3>
            <p class="empty-copy">写一句梗概、题材组合、角色困境，或者你想要的阅读感。</p>
          </div>
          <label class="field field-wide">
            <span>灵感笔记</span>
            <textarea
              v-model="inspiration"
              class="text-input onboarding-textarea"
              rows="7"
              placeholder="例如：海港城市、失踪十年的来信、一个不愿继承家族书店的女主。"
            ></textarea>
          </label>
        </div>

        <div v-else-if="currentStep.id === 'cast'" class="onboarding-section">
          <UsersRound class="onboarding-section-icon" :size="24" aria-hidden="true" />
          <div>
            <h3 class="onboarding-section-title">生成角色</h3>
            <p class="empty-copy">选择第一轮要让 Copilot 补齐的角色卡方向。</p>
          </div>
          <div class="onboarding-choice-grid" role="group" aria-label="角色生成范围">
            <label class="onboarding-check">
              <input v-model="includeLead" type="checkbox">
              <span>主角角色卡</span>
            </label>
            <label class="onboarding-check">
              <input v-model="includePartner" type="checkbox">
              <span>关键搭档/关系角色</span>
            </label>
            <label class="onboarding-check">
              <input v-model="includeAntagonist" type="checkbox">
              <span>对手或阻力角色</span>
            </label>
          </div>
          <label class="field field-wide">
            <span>角色补充</span>
            <textarea
              v-model="characterBrief"
              class="text-input onboarding-textarea"
              rows="5"
              placeholder="例如：女主擅长修旧书，但害怕离开熟悉街区；旧友带着秘密回到港口。"
            ></textarea>
          </label>
        </div>

        <div v-else class="onboarding-section">
          <PenLine class="onboarding-section-icon" :size="24" aria-hidden="true" />
          <div>
            <h3 class="onboarding-section-title">开始编写</h3>
            <p class="empty-copy">选择 Copilot 第一轮更偏向角色、规划，还是直接草拟开场。</p>
          </div>
          <div class="onboarding-goals" role="radiogroup" aria-label="开始方式">
            <label class="onboarding-goal">
              <input v-model="startGoal" type="radio" value="characters">
              <strong>先生成角色卡</strong>
              <span>适合灵感还松散，先把人物关系定住。</span>
            </label>
            <label class="onboarding-goal">
              <input v-model="startGoal" type="radio" value="outline">
              <strong>规划第一章</strong>
              <span>先定目标、冲突、场景和结尾钩子。</span>
            </label>
            <label class="onboarding-goal">
              <input v-model="startGoal" type="radio" value="opening">
              <strong>写一个开场</strong>
              <span>让 Copilot 提出首章草稿 PendingAction。</span>
            </label>
            <label class="onboarding-goal">
              <input v-model="startGoal" type="radio" value="chapter">
              <strong>开始写章节</strong>
              <span>已有方向时直接进入章节草稿。</span>
            </label>
          </div>
        </div>

        <p v-if="error" class="error-copy">{{ error }}</p>

        <footer class="onboarding-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="saving || stepIndex === 0"
            @click="previousStep"
          >
            上一步
          </button>
          <button
            v-if="!providerConfigured && isLastStep"
            class="secondary-button"
            type="button"
            :disabled="saving"
            @click="emit('configureProvider')"
          >
            先配置 Provider
          </button>
          <button class="primary-button onboarding-primary" type="button" :disabled="saving" @click="nextStep">
            {{ isLastStep ? finishLabel : '下一步' }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>
