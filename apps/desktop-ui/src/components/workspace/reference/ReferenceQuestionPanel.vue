<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue';

import type {
  ReferenceQuestionAnswer,
  ReferenceQuestionResult,
  ReferenceWorkSummary,
} from '../../../composables/useWorkspaceApi';

const props = defineProps<{
  reference?: ReferenceWorkSummary;
  ask: (
    referenceId: string,
    question: string,
    options: { signal: AbortSignal },
  ) => Promise<ReferenceQuestionResult>;
}>();

const question = shallowRef('');
const asking = shallowRef(false);
const error = shallowRef('');
const answer = shallowRef<ReferenceQuestionAnswer>();
let controller: AbortController | undefined;

watch(() => props.reference?.id, () => {
  stop();
  answer.value = undefined;
  error.value = '';
});
onBeforeUnmount(stop);

function stop(): void {
  controller?.abort();
  controller = undefined;
}

async function submit(): Promise<void> {
  const reference = props.reference;
  const text = question.value.trim();
  if (!reference || !text || asking.value) return;
  stop();
  const current = new AbortController();
  controller = current;
  asking.value = true;
  error.value = '';
  answer.value = undefined;
  try {
    const result = await props.ask(reference.id, text, { signal: current.signal });
    if (controller !== current) return;
    if (result.status === 'completed') answer.value = result.answer;
    else if (result.status === 'failed') error.value = result.error.message;
    else error.value = 'The question was stopped.';
  } catch (caught) {
    if (controller !== current) return;
    error.value = caught instanceof Error ? caught.message : 'The question could not be answered.';
  } finally {
    if (controller === current) {
      controller = undefined;
      asking.value = false;
    }
  }
}

function cancel(): void {
  stop();
  asking.value = false;
  error.value = 'The question was stopped.';
}

function lines(pointerId: string): string {
  const entry = answer.value?.evidence.find((item) => item.pointerId === pointerId);
  return entry ? `${entry.chapterId} · L${entry.lineStart}-${entry.lineEnd}` : pointerId;
}
</script>

<template>
  <section class="reference-question-panel" aria-label="Ask about this reference">
    <div class="panel-heading">
      <div>
        <h3 class="panel-title">Ask about this reference</h3>
        <p class="empty-copy">
          The model searches and reads the source on its own to answer one craft question. The
          answer is advisory and nothing is saved.
        </p>
      </div>
      <span class="status-pill">{{ asking ? 'Exploring' : 'Read-only' }}</span>
    </div>

    <p v-if="!reference" class="empty-copy">Select a reference to ask about it.</p>
    <form v-else class="reference-question-form" @submit.prevent="submit">
      <textarea
        v-model="question"
        class="reference-question-input"
        rows="3"
        maxlength="1000"
        :disabled="asking"
        aria-label="Question"
        placeholder="For example: how does the author hide the twist in the first ten chapters?"
      />
      <div class="reference-question-actions">
        <button
          type="submit"
          class="primary-button tight-button"
          :disabled="asking || !question.trim()"
        >
          {{ asking ? 'Exploring…' : 'Ask' }}
        </button>
        <button
          v-if="asking"
          type="button"
          class="secondary-button tight-button"
          @click="cancel"
        >
          Stop
        </button>
      </div>
    </form>

    <p v-if="error" class="error-copy" role="alert">{{ error }}</p>

    <article v-if="answer" class="reference-question-answer">
      <p v-if="answer.copyRisk" class="reference-question-warning">
        Part of this answer repeats the source verbatim. Rephrase it before using it in your own
        writing.
      </p>
      <p class="reference-question-text">{{ answer.answer }}</p>
      <ul v-if="answer.findings.length" class="reference-question-findings">
        <li v-for="(finding, index) in answer.findings" :key="index">
          <p>{{ finding.observation }}</p>
          <p v-if="finding.technique" class="reference-question-technique">
            {{ finding.technique }}
          </p>
          <p class="reference-question-evidence">
            Evidence: {{ finding.evidenceRefs.map(lines).join('; ') }}
          </p>
        </li>
      </ul>
      <ul v-if="answer.uncertainties.length" class="reference-question-uncertainties">
        <li v-for="(item, index) in answer.uncertainties" :key="index">{{ item }}</li>
      </ul>
    </article>
  </section>
</template>

<style scoped>
.reference-question-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(226 232 240);
  border-radius: 10px;
}

.reference-question-form,
.reference-question-answer {
  display: grid;
  gap: 8px;
}

.reference-question-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: inherit;
}

.reference-question-actions {
  display: flex;
  gap: 8px;
}

.reference-question-text {
  margin: 0;
  white-space: pre-wrap;
}

.reference-question-findings,
.reference-question-uncertainties {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}

.reference-question-findings p {
  margin: 0;
}

.reference-question-technique,
.reference-question-evidence,
.reference-question-uncertainties {
  font-size: 12px;
  color: rgb(71 85 105);
}

.reference-question-warning {
  margin: 0;
  padding: 8px;
  border-radius: 6px;
  background: rgb(254 243 199);
  color: rgb(146 64 14);
  font-size: 12px;
}

:global([data-theme="dark"]) .reference-question-panel {
  border-color: rgb(64 64 64);
}

:global([data-theme="dark"]) .reference-question-technique,
:global([data-theme="dark"]) .reference-question-evidence,
:global([data-theme="dark"]) .reference-question-uncertainties {
  color: rgb(163 163 163);
}
</style>
