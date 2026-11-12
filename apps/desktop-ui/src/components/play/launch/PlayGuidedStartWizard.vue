<script setup lang="ts">
import { computed, nextTick, onMounted, useId, useTemplateRef } from 'vue';

import type {
  FileTreeNode,
  PlaySession,
  PlaySessionPurpose,
} from '../../../composables/useWorkspaceApi';
import { useWorkspaceApi } from '../../../composables/useWorkspaceApi';
import {
  usePlayGuidedStart,
  type PlayGuidedReuseSeed,
  type PlayGuidedStartApi,
  type PlayGuidedStartStep,
} from '../../../composables/usePlayGuidedStart';
import PlayGuidedCrossoverStep from './PlayGuidedCrossoverStep.vue';
import PlayGuidedCanonBeats from './PlayGuidedCanonBeats.vue';
import PlayGuidedCastStep from './PlayGuidedCastStep.vue';
import PlayGuidedEntryStep from './PlayGuidedEntryStep.vue';
import PlayGuidedIdentityStep from './PlayGuidedIdentityStep.vue';
import PlayGuidedReviewStep from './PlayGuidedReviewStep.vue';
import PlayGuidedSourcesStep from './PlayGuidedSourcesStep.vue';

const props = withDefaults(defineProps<{
  purpose: PlaySessionPurpose;
  files: readonly FileTreeNode[];
  filesLoading?: boolean;
  filesError?: string;
  api?: PlayGuidedStartApi;
  disabled?: boolean;
  /** Another session's frozen opening to prefill from. Read once on mount. */
  seed?: PlayGuidedReuseSeed;
}>(), {
  api: undefined,
  seed: undefined,
  disabled: false,
  filesLoading: false,
  filesError: undefined,
});

const emit = defineEmits<{
  created: [session: PlaySession];
  cancel: [];
  openForge: [];
}>();

const workspaceApi = useWorkspaceApi();
const api: PlayGuidedStartApi = props.api ?? workspaceApi;
const {
  currentStep,
  activeSteps, hasCrossover, crossoverWorks, crossoverDraft, setSourceWork, updateCrossover, prefillSourceWorks, originSuggestionsLoading, originSuggestionNotice,
  sourceOptions,
  selectedSourceIds,
  selectedSources,
  characterSources,
  entryDraft,
  identityDraft,
  participants,
  errors,
  preview,
  previewing,
  creating,
  requestError,
  announcement,
  canStart,
  timelineSources,
  canonBeats,
  canonCandidates,
  canonBeatLimitReached,
  protagonistKnowsCanon,
  loadCanonCandidates,
  isCanonCandidateSelected,
  toggleCanonCandidate,
  addManualCanonBeat,
  removeCanonBeat,
  setProtagonistKnowsCanon,
  reuseSourceTitle,
  reuseChecks,
  applySeed,
  previewSeededLaunch,
  toggleSource,
  updateEntry,
  toggleEntrySource,
  updateIdentity,
  addParticipant,
  removeParticipant,
  updateParticipant,
  nextStep,
  previousStep,
  confirm,
  reset,
} = usePlayGuidedStart({
  api,
  purpose: () => props.purpose,
  tree: () => props.files,
});

const headingId = `${useId()}-guided-start-heading`;
const stepPanel = useTemplateRef<HTMLDivElement>('stepPanel');
const busy = computed(() =>
  props.disabled
    || props.filesLoading
    || Boolean(props.filesError)
    || previewing.value
    || creating.value);
const stepLabels: Record<PlayGuidedStartStep, string> = { sources: '来源', crossover: '融合契约', entry: '入场', identity: '身份', cast: '人物', review: '确认' };
const steps = computed(() => activeSteps.value.map(id => ({ id, label: stepLabels[id] })));

const reuseStatusLabels = {
  changed: '内容已变化',
  missing: '文件已不存在',
  invalid: '文件现在无法使用',
} as const;

onMounted(async () => {
  if (!props.seed) return;
  applySeed(props.seed);
  if (!props.filesLoading && !props.filesError && await previewSeededLaunch()) {
    await focusStepPanel();
  }
});

async function advance(): Promise<void> {
  if (await nextStep()) await focusStepPanel();
}

async function back(): Promise<void> {
  if (previousStep()) await focusStepPanel();
}

async function start(): Promise<void> {
  const session = await confirm();
  if (session) emit('created', session);
  else await focusStepPanel();
}

function cancel(): void {
  reset();
  emit('cancel');
}

async function focusStepPanel(): Promise<void> {
  await nextTick();
  stepPanel.value?.focus();
}
</script>

<template>
  <section
    class="guided-start"
    :aria-labelledby="headingId"
    :aria-busy="filesLoading || previewing || creating"
  >
    <header class="wizard-heading">
      <div>
        <span>{{ purpose === 'sceneRehearsal' ? '场景试演' : '沉浸推演' }}</span>
        <h1 :id="headingId">引导开局</h1>
      </div>
      <span>有来源依据 · 推演内 · 不属于正式文件</span>
    </header>

    <nav aria-label="引导开局进度">
      <ol>
        <li
          v-for="(step, index) in steps"
          :key="step.id"
          :class="{ current: currentStep === step.id }"
          :aria-current="currentStep === step.id ? 'step' : undefined"
        >
          <span>{{ index + 1 }}</span>
          {{ step.label }}
        </li>
      </ol>
    </nav>

    <aside v-if="reuseSourceTitle" class="reuse-notice" aria-label="开局复用">
      <p>
        已用「{{ reuseSourceTitle }}」的开局预填，来源已按当前文件重新核对。
        确认后创建的是全新会话，与原会话互不影响。
      </p>
      <ul v-if="reuseChecks.length" class="reuse-checks">
        <li v-for="check in reuseChecks" :key="check.sourceId">
          <code>{{ check.path }}</code>
          <span>{{ reuseStatusLabels[check.status] }}</span>
          <template v-if="check.status === 'missing'">
            <span>已从本次开局移除</span>
          </template>
          <template v-else-if="check.selected">
            <span>{{ check.status === 'changed' ? '将沿用现在的内容' : '保留会导致无法创建' }}</span>
            <button
              type="button"
              :disabled="busy"
              @click="toggleSource(check.sourceId, false)"
            >
              移除此来源
            </button>
          </template>
          <span v-else>已移除</span>
        </li>
      </ul>
    </aside>

    <p v-if="requestError && currentStep !== 'review'" class="request-error" role="alert">
      {{ requestError }} 请重新预览后再试。
    </p>
    <p v-if="filesLoading && currentStep === 'sources'" class="source-status" role="status">
      正在载入工作区文件…
    </p>
    <p v-else-if="filesError && currentStep === 'sources'" class="request-error" role="alert">
      {{ filesError }}
    </p>

    <div ref="stepPanel" class="step-panel" tabindex="-1">
      <PlayGuidedSourcesStep
        v-if="currentStep === 'sources'"
        :sources="sourceOptions"
        :selected-source-ids="selectedSourceIds"
        :has-crossover="hasCrossover"
        :suggestions-loading="originSuggestionsLoading"
        :suggestion-notice="originSuggestionNotice"
        @set-work="setSourceWork"
        @prefill="prefillSourceWorks"
        :error="errors.sources"
        :disabled="busy"
        @toggle="toggleSource"
        @next="advance"
        @cancel="cancel"
      />
      <PlayGuidedCrossoverStep
        v-else-if="currentStep === 'crossover'"
        :works="crossoverWorks" :draft="crossoverDraft" :disabled="busy" :error="errors.crossover"
        @update="updateCrossover" @back="back" @next="advance" @cancel="cancel"
      />
      <PlayGuidedEntryStep
        v-else-if="currentStep === 'entry'"
        :draft="entryDraft"
        :sources="selectedSources"
        :errors="errors"
        :disabled="busy"
        @update="updateEntry"
        @toggle-source="toggleEntrySource"
        @back="back"
        @next="advance"
        @cancel="cancel"
      >
        <!-- Canon beats exist only for an Immersive Journey. -->
        <PlayGuidedCanonBeats
          v-if="purpose === 'immersiveJourney'"
          :timeline-sources="timelineSources"
          :beats="canonBeats"
          :candidates="canonCandidates"
          :protagonist-knows-canon="protagonistKnowsCanon"
          :limit-reached="canonBeatLimitReached"
          :disabled="busy"
          :is-selected="isCanonCandidateSelected"
          @load="loadCanonCandidates"
          @toggle="toggleCanonCandidate"
          @add-manual="addManualCanonBeat"
          @remove="removeCanonBeat"
          @set-knows="setProtagonistKnowsCanon"
        />
      </PlayGuidedEntryStep>
      <PlayGuidedIdentityStep
        v-else-if="currentStep === 'identity'"
        :purpose="purpose"
        :draft="identityDraft"
        :errors="errors"
        :disabled="busy"
        @update="updateIdentity"
        @back="back"
        @next="advance"
        @cancel="cancel"
      />
      <PlayGuidedCastStep
        v-else-if="currentStep === 'cast'"
        :purpose="purpose"
        :participants="participants"
        :character-sources="characterSources"
        :errors="errors"
        :disabled="busy"
        @update-participant="updateParticipant"
        @add-participant="addParticipant"
        @remove-participant="removeParticipant"
        @back="back"
        @next="advance"
        @cancel="cancel"
        @open-forge="emit('openForge')"
      />
      <PlayGuidedReviewStep
        v-else-if="preview"
        :purpose="purpose"
        :preview="preview"
        :request-error="requestError"
        :creating="creating"
        :can-start="canStart"
        :disabled="disabled"
        @back="back"
        @confirm="start"
        @cancel="cancel"
      />
    </div>

    <p class="announcement" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </p>
  </section>
</template>

<style scoped>
.guided-start {
  display: grid;
  min-width: 0;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
}

.wizard-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
}

.wizard-heading div {
  display: grid;
  gap: 2px;
}

.wizard-heading span,
.wizard-heading > span {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.wizard-heading h1 {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

nav {
  padding: 0 16px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

nav ol {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}

nav li {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 5px;
  border-bottom: 2px solid transparent;
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

nav li > span {
  font-variant-numeric: tabular-nums;
}

nav .current {
  border-bottom-color: var(--play-ink, var(--editor-ink));
  color: var(--play-ink, var(--editor-ink));
  font-weight: 700;
}

.step-panel {
  padding: 18px;
  outline: none;
}

.step-panel:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: -3px;
}

.request-error {
  margin: 12px 18px 0;
  padding: 8px 10px;
  border-left: 3px solid var(--play-danger, var(--editor-danger));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-danger, var(--editor-danger));
  font-size: 12px;
}

.reuse-notice {
  display: grid;
  gap: 6px;
  margin: 12px 18px 0;
  padding: 8px 10px;
  border-left: 3px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  font-size: 12px;
}

.reuse-notice p,
.reuse-checks {
  margin: 0;
  padding: 0;
  list-style: none;
}

.reuse-checks li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}

.reuse-checks span {
  color: var(--play-muted, var(--editor-muted));
}

.source-status {
  margin: 12px 18px 0;
  color: var(--play-muted, var(--editor-muted));
  font-size: 12px;
}

.announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .guided-start,
  .guided-start * {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

@media (max-width: 680px) {
  .wizard-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  nav {
    overflow-x: auto;
  }

  nav ol {
    min-width: 500px;
  }

  .step-panel {
    padding: 12px;
  }
}
</style>
