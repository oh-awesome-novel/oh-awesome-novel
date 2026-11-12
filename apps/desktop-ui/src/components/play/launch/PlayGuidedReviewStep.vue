<script setup lang="ts">
import { formatPlayWorldActivity } from '../../../composables/playTerms';
import type { DeepReadonly } from 'vue';

import type { PlaySessionPurpose } from '../../../composables/useWorkspaceApi';
import type { PlayLaunchPackage } from '../../../composables/usePlayGuidedStart';

import PlayLaunchDiagnostics from './PlayLaunchDiagnostics.vue';

const { purpose, preview, requestError, creating, canStart, disabled } = defineProps<{
  purpose: PlaySessionPurpose;
  preview: DeepReadonly<PlayLaunchPackage>;
  requestError?: string;
  creating: boolean;
  canStart: boolean;
  disabled: boolean;
}>();

const emit = defineEmits<{
  back: [];
  confirm: [];
  cancel: [];
}>();

function sourceStatus(
  source: DeepReadonly<PlayLaunchPackage['sourceBase']['activatedSources'][number]>,
): string {
  if (source.status === 'ready') return '就绪';
  if (source.status === 'missing') return '缺失 — 请重新选择或恢复这个文件';
  return '无效 — 请替换这个来源';
}
</script>

<template>
  <section class="guided-review" aria-labelledby="guided-review-heading">
    <header>
      <span>开局确认</span>
      <h2 id="guided-review-heading">确认</h2>
      <p>创建推演之前先核对来源依据。</p>
    </header>

    <p class="not-created"><strong>还没有创建任何内容。</strong> 这是开局包的只读预览。</p>
    <p v-if="requestError" class="request-error" role="alert">{{ requestError }}</p>

    <dl class="summary-grid">
      <div>
        <dt>标题</dt>
        <dd>{{ preview.title }}</dd>
      </div>
      <div>
        <dt>用途</dt>
        <dd>{{ purpose === 'sceneRehearsal' ? '场景试演' : '沉浸推演' }}</dd>
      </div>
      <div>
        <dt>入场</dt>
        <dd>{{ preview.entryPoint.label }}</dd>
      </div>
      <div>
        <dt>身份</dt>
        <dd>{{ preview.identity.kind === 'director' ? '导演视角' : '参与者视角' }}</dd>
      </div>
      <div>
        <dt>世界活跃度</dt>
        <dd>{{ formatPlayWorldActivity(preview.eventPolicy) }}</dd>
      </div>
      <div v-if="preview.entryPoint.worldTime">
        <dt>初始世界时间</dt>
        <dd>{{ preview.entryPoint.worldTime.value }}</dd>
      </div>
      <div>
        <dt>参与者</dt>
        <dd>{{ preview.participantRoles.length }}</dd>
      </div>
      <div v-if="preview.canonBeats">
        <dt>原作节点</dt>
        <dd>
          {{ preview.canonBeats.beats.length }} 条 ·
          {{ preview.canonBeats.protagonistKnowsCanon ? '穿越者知道原作' : '穿越者不知道原作' }}
        </dd>
      </div>
    </dl>

    <section v-if="preview.canonBeats" class="canon-beat-review" aria-labelledby="guided-review-canon-heading">
      <h3 id="guided-review-canon-heading">原作节点</h3>
      <ul>
        <li v-for="beat in preview.canonBeats.beats" :key="beat.id">
          <strong>{{ beat.label }}</strong>
          <span v-if="beat.expectedWhen"> · {{ beat.expectedWhen }}</span>
          <span v-if="beat.source.kind === 'sourceBacked'"> · 引自 {{ beat.source.path }}</span>
          <span v-else> · 作者提供</span>
        </li>
      </ul>
    </section>

    <section v-if="preview.crossover" aria-label="确认融合契约">
      <h3>融合契约</h3>
      <p>{{ preview.crossover.works.map(work => work.title).join('、') }} · {{ { merged: '世界融合', visitor: '单向来客', layered: '并存叠层' }[preview.crossover.fusion] }} · {{ preview.crossover.knowledge === 'isolated' ? '初始认知隔离' : '初始认知互知' }}</p>
      <ul><li v-for="(rule, index) in preview.crossover.rulePrecedence" :key="index">{{ rule.topic }}：以 {{ preview.crossover.works.find(work => work.id === rule.winner)?.title }} 为准。{{ rule.note }}</li></ul>
    </section>
    <section class="source-evidence" aria-labelledby="guided-review-sources-heading">
      <h3 id="guided-review-sources-heading">来源依据</h3>
      <ul>
        <li v-for="source in preview.sourceBase.activatedSources" :key="source.sourceId">
          <details :open="source.status !== 'ready'">
            <summary>
              <span>
                <strong>{{ source.path }}</strong>
                <small v-if="source.originWork">所属作品：{{ source.originWork.title }}</small>
                <small>{{ source.role }} · {{ sourceStatus(source) }}</small>
              </span>
            </summary>
            <dl>
              <template v-if="source.objectId">
                <dt>对象</dt>
                <dd>{{ source.objectId }}</dd>
              </template>
              <template v-if="source.contentHash">
                <dt>SHA-256</dt>
                <dd class="source-hash">{{ source.contentHash }}</dd>
              </template>
              <template v-if="source.excerpt !== undefined">
                <dt>摘录</dt>
                <dd><pre>{{ source.excerpt }}</pre></dd>
              </template>
            </dl>
          </details>
        </li>
      </ul>
    </section>

    <PlayLaunchDiagnostics :diagnostics="preview.diagnostics" />

    <p v-if="!canStart" class="blocked-notice">
      所有来源就绪、错误诊断全部处理后才能开始。
    </p>

    <footer>
      <button type="button" :disabled="disabled || creating" @click="emit('cancel')">取消</button>
      <div>
        <button type="button" :disabled="disabled || creating" @click="emit('back')">返回人物</button>
        <button
          class="primary"
          type="button"
          :disabled="disabled || creating || !canStart"
          @click="emit('confirm')"
        >
          {{ creating ? 'Starting…' : purpose === 'sceneRehearsal' ? '开始场景试演' : '开始沉浸推演' }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.guided-review,
.guided-review > header,
.source-evidence,
.source-evidence ul {
  display: grid;
  gap: 12px;
}

.guided-review > header {
  gap: 4px;
}

h2,
h3,
p {
  margin: 0;
}

h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 17px;
}

h3 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.guided-review > header > span,
.guided-review > header p,
dt,
summary small {
  color: var(--play-muted, var(--editor-muted));
  font-size: 11px;
}

.not-created,
.blocked-notice,
.request-error {
  padding: 9px 10px;
  border-left: 3px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  font-size: 12px;
}

.request-error,
.blocked-notice {
  color: var(--play-danger, var(--editor-danger));
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  background: var(--play-line, var(--editor-hairline));
}

.summary-grid > div {
  display: grid;
  gap: 3px;
  padding: 9px;
  background: var(--play-surface, var(--editor-surface));
}

dd {
  margin: 0;
}

.source-evidence ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.source-evidence li {
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
}

summary {
  padding: 9px;
  cursor: pointer;
}

summary > span {
  display: inline-grid;
  gap: 2px;
  margin-left: 5px;
}

details > dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 10px;
  margin: 0;
  padding: 0 10px 10px;
}

.source-hash {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
}

pre {
  max-height: 170px;
  overflow: auto;
  margin: 0;
  padding: 8px;
  background: var(--play-canvas, var(--editor-canvas));
  color: var(--play-body, var(--editor-body));
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}

footer,
footer > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

button {
  min-height: 34px;
  padding: 6px 11px;
  border: 1px solid var(--play-line-strong, var(--editor-hairline-strong));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.primary {
  background: var(--play-inverse, var(--editor-inverse));
  color: var(--play-on-inverse, var(--editor-on-inverse));
}

button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--play-focus, var(--editor-focus));
  outline-offset: 2px;
}

@media (max-width: 680px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
