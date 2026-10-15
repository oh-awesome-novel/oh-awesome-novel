<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { ChatStatus, UIMessage } from 'ai';
import { resolveSummarySelection } from '@oh-awesome-novel/client';

import AgentUsageInspector from '../agent-checkpoint/AgentUsageInspector.vue';
import AgentTimeline from '../agent-checkpoint/AgentTimeline.vue';
import ChatComposer from '../agent-checkpoint/ChatComposer.vue';
import CompactApprovalTray from '../agent-checkpoint/CompactApprovalTray.vue';
import PendingActionPanel from '../agent-checkpoint/PendingActionPanel.vue';
import WritingReferenceSelector from './WritingReferenceSelector.vue';
import WritingProfileSummary from './writing-profile/WritingProfileSummary.vue';
import { useAgentTimeline } from '../../composables/useAgentTimeline';
import type {
  PlayWritingReferenceAttachment,
  WritingProfileState,
} from '../../composables/useWorkspaceApi';
import type { PendingActionView } from '../../composables/useAgentCheckpointChat';

const props = defineProps<{
  workspaceKey?: string;
  activeFilePath?: string;
  providerConfigured: boolean;
  queuedPrompt: string;
  chatStatus: ChatStatus;
  chatInput: string;
  chatMessages: UIMessage[];
  chatPendingActions: PendingActionView[];
  pendingActions: PendingActionView[];
  pendingActionsLoading: boolean;
  pendingActionsError: string;
  rightPanelShown: boolean;
  writingReferenceAttachments: PlayWritingReferenceAttachment[];
  selectedWritingReferenceAttachmentIds: string[];
  writingReferencesLoading: boolean;
  writingReferencesError: string;
  writingProfileState?: WritingProfileState;
  writingProfilesError: string;
  unsettledChapters?: string[];
}>();

const emit = defineEmits<{
  openSource: [path: string];
  updateChatInput: [input: string];
  sendChatInput: [];
  stopChat: [];
  promptConsumed: [];
  configureProvider: [];
  acceptPendingAction: [action: PendingActionView];
  rejectPendingAction: [action: PendingActionView];
  quickCommitPendingAction: [action: PendingActionView];
  reviewPendingAction: [action: PendingActionView];
  openPendingActionDiff: [action: PendingActionView];
  refreshWritingReferences: [];
  toggleWritingReference: [id: string];
  settleChapter: [path: string];
}>();

const inputModel = computed({
  get: () => props.chatInput,
  set: (value: string) => emit('updateChatInput', value),
});
const messages = computed(() => props.chatMessages);
const { items: timelineItems } = useAgentTimeline(messages);

type PendingDecision = 'accepting' | 'rejecting' | 'accepted' | 'rejected';

const decisions = reactive<Record<string, PendingDecision>>({});
const decisionErrors = reactive<Record<string, string>>({});
const quickCommands = [
  { id: 'outline.plan', label: '规划大纲', prompt: '/规划大纲' },
  { id: 'volume.planNext', label: '规划下一卷', prompt: '/规划下一卷' },
  { id: 'chapter.planNext', label: '规划下一章', prompt: '/规划下一章' },
  { id: 'chapter.writeNext', label: '写下一章', prompt: '/写下一章' },
  { id: 'chapter.settle', label: '整理本章', prompt: '/整理本章' },
  { id: 'summary.volume', label: '整理本卷', prompt: '/整理本卷' },
  { id: 'summary.global', label: '整理全书', prompt: '/整理全书' },
  { id: 'character.generateCard', label: '生成角色卡', prompt: '/生成角色卡 ' },
  { id: 'chapter.review', label: '审稿', prompt: '/审稿' },
  { id: 'state.update', label: '更新状态', prompt: '/更新状态' },
  { id: 'foreshadow.plan', label: '补伏笔', prompt: '/补伏笔' },
  { id: 'chapter.deAi', label: '去AI味', prompt: '/去AI味' },
];
const availableQuickCommands = computed(() => {
  let volumeHint = '';
  try { resolveSummarySelection('volume', props.activeFilePath ? [props.activeFilePath] : []); }
  catch (error) { volumeHint = (error as Error).message; }
  return quickCommands.map((command) => command.id === 'summary.volume' && volumeHint
    ? { ...command, disabledReason: volumeHint } : command);
});
const CHAPTER_PATH = /^chapters\/\d{4}\/(?!0000\.md$)\d{4}\.md$/u;

// Chapter lifecycle: an accepted chapter without a current summary needs
// /整理本章 before the next one, otherwise memory falls behind the text.
const chapterGuide = computed(() => {
  if (!props.unsettledChapters) return undefined;
  const unsettled = props.unsettledChapters;
  const active = props.activeFilePath && CHAPTER_PATH.test(props.activeFilePath) ? props.activeFilePath : '';
  if (active && unsettled.includes(active)) {
    return { text: `${active} 已定稿但尚未整理。`, steps: [
      { label: '整理本章', settle: active },
      { label: '审稿', prompt: '/审稿' },
    ] };
  }
  if (unsettled.length) {
    return { text: `${unsettled.length} 章尚未整理，最早的是 ${unsettled[0]}。`, steps: [
      { label: '整理这一章', settle: unsettled[0]! },
    ] };
  }
  if (active) {
    return { text: '本章已整理。', steps: [
      { label: '写下一章', prompt: '/写下一章' },
      { label: '规划下一章', prompt: '/规划下一章' },
    ] };
  }
  return undefined;
});

function runGuideStep(step: { settle?: string; prompt?: string }) {
  if (step.settle) emit('settleChapter', step.settle);
  else if (step.prompt) emit('updateChatInput', step.prompt);
}

const decoratedPendingActions = computed(() =>
  mergePendingActions(props.pendingActions, props.chatPendingActions).map((action) => ({
    ...action,
    decision: decisions[action.id],
    decisionError: decisionErrors[action.id],
  })),
);
watch(
  () => props.queuedPrompt,
  (prompt) => {
    if (!prompt) {
      return;
    }

    emit('updateChatInput', prompt);
    emit('promptConsumed');
  },
);

watch(
  () => props.pendingActions.map((action) => action.id).join('|'),
  () => {
    for (const id of Object.keys(decisions)) {
      if (!props.pendingActions.some((action) => action.id === id)) {
        delete decisions[id];
      }
    }
  },
);

function acceptPendingAction(action: PendingActionView) {
  decisions[action.id] = 'accepting';
  decisionErrors[action.id] = '';
  emit('acceptPendingAction', action);
}

function rejectPendingAction(action: PendingActionView) {
  decisions[action.id] = 'rejecting';
  decisionErrors[action.id] = '';
  emit('rejectPendingAction', action);
}

function mergePendingActions(
  storedActions: PendingActionView[],
  streamedActions: PendingActionView[],
): PendingActionView[] {
  const actions = new Map<string, PendingActionView>();

  for (const action of streamedActions) {
    actions.set(action.id, action);
  }

  // The persisted, strictly parsed store view is authoritative when a stale
  // stream event and a terminal decision share an id.
  for (const action of storedActions) {
    actions.set(action.id, action);
  }

  return [...actions.values()];
}
</script>

<template>
  <section class="copilot-panel" aria-label="Agent Copilot">
    <button
      v-if="chatStatus !== 'ready'"
      class="secondary-button tight-button copilot-stop-button"
      type="button"
      @click="emit('stopChat')"
    >
      停止
    </button>

    <WritingProfileSummary
      :state="writingProfileState"
      :error="writingProfilesError"
    />

    <div v-if="!providerConfigured" class="provider-disabled">
      <strong>Copilot 当前不可用</strong>
      <p>配置 provider 后才能发起 agent 请求；文件浏览保持可用。</p>
      <button class="primary-button" type="button" @click="emit('configureProvider')">
        配置 Provider
      </button>
    </div>

    <template v-else>
      <AgentTimeline :items="timelineItems" />
      <AgentUsageInspector :key="workspaceKey" :messages="chatMessages" @open-source="emit('openSource', $event)" />
      <CompactApprovalTray
        v-if="!rightPanelShown"
        :actions="decoratedPendingActions"
        @accept="acceptPendingAction"
        @reject="rejectPendingAction"
        @review="emit('reviewPendingAction', $event)"
      />
      <div v-else-if="decoratedPendingActions.length > 0" class="copilot-review-hint">
        <span>{{ decoratedPendingActions.length }} PendingAction</span>
        <button class="ghost-button tight-button" type="button" @click="emit('reviewPendingAction', decoratedPendingActions[0])">
          Open review
        </button>
      </div>
      <p v-if="pendingActionsLoading" class="empty-copy">正在同步 PendingAction…</p>
      <p v-if="pendingActionsError" class="error-copy">{{ pendingActionsError }}</p>
      <PendingActionPanel
        v-if="!rightPanelShown && decoratedPendingActions.length > 0"
        :actions="decoratedPendingActions"
        @accept="acceptPendingAction"
        @reject="rejectPendingAction"
        @quick-commit="emit('quickCommitPendingAction', $event)"
        @review="emit('reviewPendingAction', $event)"
        @open-diff="emit('openPendingActionDiff', $event)"
      />
      <div v-if="chapterGuide" class="copilot-chapter-guide" role="status">
        <span>{{ chapterGuide.text }}</span>
        <button
          v-for="step in chapterGuide.steps"
          :key="step.label"
          class="ghost-button tight-button"
          type="button"
          :disabled="chatStatus !== 'ready'"
          @click="runGuideStep(step)"
        >
          {{ step.label }}
        </button>
      </div>
      <WritingReferenceSelector
        :attachments="writingReferenceAttachments"
        :selected-attachment-ids="selectedWritingReferenceAttachmentIds"
        :loading="writingReferencesLoading"
        :error="writingReferencesError"
        :disabled="chatStatus !== 'ready'"
        @refresh="emit('refreshWritingReferences')"
        @toggle="emit('toggleWritingReference', $event)"
      />
      <ChatComposer
        v-model="inputModel"
        :disabled="chatStatus !== 'ready'"
        :quick-commands="availableQuickCommands"
        :quick-commands-disabled="!providerConfigured"
        @configure-model="emit('configureProvider')"
        @submit="emit('sendChatInput')"
      />
    </template>
  </section>
</template>


<style scoped>
.copilot-chapter-guide {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  color: var(--editor-muted, inherit);
}
</style>
