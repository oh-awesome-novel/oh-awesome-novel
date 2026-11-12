<script setup lang="ts">
import { computed, useId } from 'vue';

import { PLAY_CHARACTER_CHECK_CATEGORY_LABELS } from '@oh-awesome-novel/client';
import type {
  PlayCharacterCheckFinding,
  PlayCharacterCheckReportView,
  PlayCharacterCheckTarget,
} from '@oh-awesome-novel/client';

const props = withDefaults(defineProps<{
  reports: readonly PlayCharacterCheckReportView[];
  /** A check is in flight. */
  running?: boolean;
  error?: string;
  lens: 'player' | 'director';
  /** Display names for report targets, keyed by turn id or step ref. */
  targetLabels?: Readonly<Record<string, string>>;
  /** Why "带着这条意见重演" is unavailable right now, apart from staleness. */
  retryDisabledReason?: string;
  /** Scene Rehearsal sessions have no observation notes. */
  canNote?: boolean;
  disabled?: boolean;
}>(), {
  running: false,
  error: '',
  targetLabels: () => ({}),
  retryDisabledReason: '',
  canNote: true,
  disabled: false,
});

const emit = defineEmits<{
  retryWith: [report: PlayCharacterCheckReportView, finding: PlayCharacterCheckFinding];
  note: [report: PlayCharacterCheckReportView, finding: PlayCharacterCheckFinding];
  focusTarget: [target: PlayCharacterCheckTarget];
  cancel: [];
}>();

const headingId = `${useId()}-play-character-check-heading`;
// Newest first: the report the author just asked for is the one they are looking for.
const ordered = computed(() => [...props.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

function targetKey(target: PlayCharacterCheckTarget): string {
  return target.kind === 'turn' ? target.turnId : target.stepRef;
}
function targetLabel(target: PlayCharacterCheckTarget): string {
  return props.targetLabels[targetKey(target)] ?? (target.kind === 'turn' ? '一个回合' : '一个试演步骤');
}
function namesWith(report: PlayCharacterCheckReportView, status: 'referenced' | 'noReference' | 'omitted'): string {
  return report.characters.filter((character) => character.status === status).map((character) => character.name).join('、');
}
function retryTitle(report: PlayCharacterCheckReportView): string {
  if (report.stale) return '这份报告已过期：当前分支不再经过它检查的内容。';
  return props.retryDisabledReason;
}
</script>

<template>
  <section class="play-character-check" :aria-labelledby="headingId" :aria-busy="running">
    <header>
      <div>
        <span>仅供参考 · 不打分 · 不改动推演</span>
        <h2 :id="headingId">角色贴合度</h2>
      </div>
      <small>{{ lens === 'director' ? '导演视角' : '参与者视角' }}</small>
    </header>

    <p v-if="running" class="play-character-check-running" role="status">
      正在检查…这是一次只读的模型调用。
      <button type="button" @click="emit('cancel')">取消</button>
    </p>
    <p v-if="error" class="play-character-check-error" role="alert">{{ error }}</p>
    <p v-if="!ordered.length && !running" class="play-character-check-empty">
      还没有检查报告。在一个已提交的回合或试演步骤上点“检查角色贴合度”，模型会指出哪句话不像这个角色，并附上角色资料里的依据。
    </p>

    <article
      v-for="report in ordered"
      :key="report.id"
      class="play-character-check-report"
      :data-stale="report.stale"
      :data-character-check-report="targetKey(report.target)"
    >
      <header>
        <button type="button" class="play-character-check-target" @click="emit('focusTarget', report.target)">
          {{ targetLabel(report.target) }}
        </button>
        <span v-if="report.stale" class="play-character-check-stale">已过期 · 分支已改变</span>
      </header>

      <p v-if="namesWith(report, 'noReference')" class="play-character-check-unreferenced">
        无可对照资料：{{ namesWith(report, 'noReference') }}。会话没有冻结这些角色的资料，所以没有检查，这不代表没有问题。
      </p>
      <p v-if="namesWith(report, 'omitted')" class="play-character-check-unreferenced">
        资料未纳入：{{ namesWith(report, 'omitted') }}。这些角色的资料超出了单次检查的输入上限，所以没有检查。
      </p>
      <ul v-if="report.omissions.length" class="play-character-check-omissions">
        <li v-for="omission in report.omissions" :key="omission">{{ omission }}</li>
      </ul>
      <p v-if="report.discardedCount" class="play-character-check-discarded">
        已丢弃 {{ report.discardedCount }} 条意见：引用的原句或依据无法在材料中逐字找到。
      </p>

      <p v-if="!report.findings.length && namesWith(report, 'referenced')" class="play-character-check-clean">
        对照 {{ namesWith(report, 'referenced') }} 的资料，没有保留下来的意见。
      </p>

      <ol v-if="report.findings.length" class="play-character-check-findings">
        <li v-for="finding in report.findings" :key="finding.id">
          <div class="play-character-check-finding-head">
            <strong>{{ finding.character }}</strong>
            <span>{{ PLAY_CHARACTER_CHECK_CATEGORY_LABELS[finding.category] }}</span>
          </div>
          <blockquote class="play-character-check-quote">
            <small>叙述原句</small>
            {{ finding.quote }}
          </blockquote>
          <blockquote class="play-character-check-evidence">
            <small>依据 · {{ finding.evidenceSource }}</small>
            {{ finding.evidence }}
          </blockquote>
          <p>{{ finding.note }}</p>
          <div class="play-character-check-actions">
            <button
              type="button"
              :disabled="disabled || report.stale || Boolean(retryDisabledReason)"
              :title="retryTitle(report)"
              @click="emit('retryWith', report, finding)"
            >带着这条意见重演</button>
            <button
              v-if="canNote"
              type="button"
              :disabled="disabled"
              @click="emit('note', report, finding)"
            >记为观察笔记</button>
          </div>
        </li>
      </ol>
    </article>
  </section>
</template>

<style scoped>
.play-character-check {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
  font-size: 12px;
}

.play-character-check > header,
.play-character-check-report > header,
.play-character-check-finding-head,
.play-character-check-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.play-character-check > header span,
.play-character-check > header small,
.play-character-check-finding-head span,
.play-character-check blockquote small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-character-check h2 {
  margin: 0;
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.play-character-check p {
  margin: 0;
  line-height: 1.6;
}

.play-character-check-empty,
.play-character-check-clean,
.play-character-check-discarded,
.play-character-check-unreferenced,
.play-character-check-omissions {
  color: var(--play-muted, var(--editor-muted));
}

.play-character-check-omissions {
  margin: 0;
  padding-inline-start: 16px;
}

.play-character-check-error {
  color: var(--play-danger, var(--editor-danger));
}

.play-character-check-report {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

.play-character-check-report[data-stale="true"] {
  border-style: dashed;
  opacity: .75;
}

.play-character-check-stale {
  color: var(--play-danger, var(--editor-danger));
  font-size: 10px;
}

.play-character-check-target {
  padding: 0;
  border: 0;
  background: none;
  color: var(--play-ink, var(--editor-ink));
  font-weight: 600;
  text-align: start;
  text-decoration: underline;
  cursor: pointer;
}

.play-character-check-findings {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.play-character-check-findings li {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-character-check-finding-head strong {
  color: var(--play-ink, var(--editor-ink));
}

.play-character-check blockquote {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 6px 8px;
  border-inline-start: 2px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  white-space: pre-wrap;
  line-height: 1.6;
}

.play-character-check-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.play-character-check-actions button,
.play-character-check-running button {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-ink, var(--editor-ink));
}

.play-character-check-actions button:disabled {
  opacity: .55;
}
</style>
