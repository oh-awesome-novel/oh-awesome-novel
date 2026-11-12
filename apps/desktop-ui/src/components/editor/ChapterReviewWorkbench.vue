<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { CHAPTER_REVIEW_LABELS } from '@oh-awesome-novel/client';
import type { ChapterReviewDecision, ChapterReviewView, OanClient } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from '../../composables/useWorkspaceApi';
const props = withDefaults(defineProps<{
  workspaceRoot: string; path: string; sourceVersion: string; disabled: boolean;
  api?: Pick<OanClient, 'listChapterReviews' | 'generateChapterReview' | 'readChapterReview' | 'saveChapterReviewDecisions' | 'reviseChapterReview'>;
}>(), { api: undefined });
const emit = defineEmits<{ reviewPendingAction: [id: string]; openEvidence: [input: { path: string; line: number }] }>();
const api = props.api ?? useWorkspaceApi();
const reports = shallowRef<ChapterReviewView[]>([]); const selected = shallowRef<ChapterReviewView>();
const busy = shallowRef(''); const error = shallowRef(''); const omissions = shallowRef(0); const basis = shallowRef('');
let epoch = 0; let controller: AbortController | undefined;
const selectedCount = computed(() => Object.values(selected.value?.decisions.choices ?? {}).filter(choice => choice === 'process').length);
function cancel(): void { epoch++; controller?.abort(); controller = undefined; busy.value = ''; }
function install(view: ChapterReviewView): void {
  if (view.report.path !== props.path) throw new Error('报告不属于当前章稿。');
  selected.value = view; reports.value = [view, ...reports.value.filter(item => item.report.id !== view.report.id)].slice(0, 20);
}
async function perform(kind: string, operation: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>): Promise<void> {
  cancel(); const current = ++epoch; const request = new AbortController(); controller = request; busy.value = kind; error.value = '';
  try { await operation(request.signal, () => current === epoch); } catch (cause) { if (current === epoch && !request.signal.aborted) error.value = cause instanceof Error ? cause.message : '审稿操作失败。'; }
  finally { if (current === epoch) busy.value = ''; }
}
async function load(): Promise<void> {
  selected.value = undefined; reports.value = [];
  await perform('读取报告', async (signal, current) => { const response = await api.listChapterReviews({ expectedWorkspaceRoot: props.workspaceRoot, path: props.path }, signal);
    if (!current()) return; reports.value = response.reports; omissions.value = response.omittedCount; selected.value = response.reports[0];
  });
}
async function generate(): Promise<void> {
  if (props.disabled || busy.value) return;
  await perform('只读审稿', async (signal, current) => { const response = await api.generateChapterReview({ expectedWorkspaceRoot: props.workspaceRoot, path: props.path, basisPaths: basis.value.split(/\r?\n/u).map(path => path.trim()).filter(Boolean) }, signal);
    if (current()) install(response);
  });
}
async function reopen(id: string): Promise<void> {
  await perform('读取报告', async (signal, current) => { const view = await api.readChapterReview(id, props.workspaceRoot, signal); if (current()) install(view); });
}
async function decide(id: string, choice: ChapterReviewDecision): Promise<void> {
  const view = selected.value; if (!view || busy.value || props.disabled) return;
  await perform('保存裁决', async (_signal, current) => { const next = await api.saveChapterReviewDecisions(view.report.id, { expectedWorkspaceRoot: props.workspaceRoot, revision: view.decisions.revision, choices: { ...view.decisions.choices, [id]: choice } }); if (current()) install(next); });
}
async function revise(): Promise<void> {
  const view = selected.value; if (!view || view.stale || !selectedCount.value || busy.value || props.disabled) return;
  await perform('生成局部修订', async (signal, current) => { const result = await api.reviseChapterReview(view.report.id, { expectedWorkspaceRoot: props.workspaceRoot, decisionRevision: view.decisions.revision }, signal); if (current()) emit('reviewPendingAction', result.pendingAction.id); });
}
watch(() => [props.workspaceRoot, props.path, props.sourceVersion], () => { basis.value = ''; void load(); }, { immediate: true });
onBeforeUnmount(cancel);
</script>

<template>
  <section class="chapter-review-workbench" aria-label="审稿工作台" :aria-busy="Boolean(busy)">
    <h3>审稿工作台</h3>
    <p>先只读检查，再由你选择处理、保留或待定。文学意见不打总分，也不阻止写作。</p>
    <details><summary>本次依据</summary><p>默认核对作者创作约束、世界规则和主线大纲；可补充人物或其他对象文件。</p>
      <label>其他依据文件（工作区相对路径，每行一个，最多 16 个）<textarea v-model="basis" rows="3" :disabled="Boolean(busy) || disabled"></textarea></label>
    </details>
    <div class="review-actions"><button type="button" :disabled="Boolean(busy) || disabled" @click="generate">只读审稿</button><button type="button" :disabled="Boolean(busy)" @click="load">刷新报告</button><button v-if="busy && busy !== '保存裁决'" type="button" @click="cancel">取消</button></div>
    <p v-if="busy" role="status">{{ busy }}…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="omissions">本次有 {{ omissions }} 份较早或不可读的报告未显示。</p>
    <label v-if="reports.length">打开已有报告<select :value="selected?.report.id" :disabled="Boolean(busy)" @change="reopen(($event.target as HTMLSelectElement).value)"><option v-for="item in reports" :key="item.report.id" :value="item.report.id">{{ item.report.createdAt }}{{ item.stale ? ' · 已过期' : '' }}</option></select></label>
    <template v-if="selected">
      <p>{{ selected.report.metrics.characters }} 字符 · {{ selected.report.metrics.lines }} 行 · {{ selected.report.findings.length }} 条意见</p>
      <p v-if="selected.stale" role="status">这份报告已过期：{{ selected.staleReason }} 旧裁决仍保留，修订前请重新审稿。</p>
      <p v-if="selected.report.discardedCount">有 {{ selected.report.discardedCount }} 条意见因引文或结构无法核对而未纳入。</p>
      <dl class="review-dimensions"><template v-for="dimension in selected.report.dimensions" :key="dimension.category"><dt>{{ CHAPTER_REVIEW_LABELS[dimension.category] }}</dt><dd>{{ { pass: '已检查', issues: '有问题', notChecked: '未检查' }[dimension.status] }} · {{ dimension.summary }}</dd></template></dl>
      <article v-for="finding in selected.report.findings" :key="finding.id" class="review-finding">
        <h4>{{ CHAPTER_REVIEW_LABELS[finding.category] }} · 原文第 {{ finding.anchor.line }} 行</h4>
        <blockquote>{{ finding.quote }}</blockquote><p>{{ finding.issue }}</p><p>建议：{{ finding.suggestedFix }}</p>
        <p>{{ finding.confidence === 'source-backed' ? '引文已核对，判断仍供参考。' : '文学推断，没有可核对的外部依据。' }}</p>
        <button type="button" @click="emit('openEvidence', { path, line: finding.anchor.line })">打开原文</button>
        <details><summary>依据与修订范围</summary><p>处理此问题将允许修订下列整行，其他行保持原样：</p><pre>{{ finding.anchor.text }}</pre>
          <div v-for="(citation, index) in finding.evidence" :key="index"><blockquote>{{ citation.quote }}</blockquote><button type="button" @click="emit('openEvidence', { path: citation.path, line: citation.line })">{{ citation.role === 'rule' ? '规则' : '事实依据' }}：{{ citation.path }} 第 {{ citation.line }} 行</button></div>
        </details>
        <label>本次裁决<select :aria-label="`第 ${finding.anchor.line} 行问题的裁决`" :value="selected.decisions.choices[finding.id]" :disabled="Boolean(busy) || disabled" @change="decide(finding.id, ($event.target as HTMLSelectElement).value as ChapterReviewDecision)"><option value="defer">待定</option><option value="process">处理</option><option value="keep">保留原文</option></select></label>
      </article>
      <button type="button" :disabled="Boolean(busy) || disabled || selected.stale || !selectedCount" @click="revise">仅修订选中的 {{ selectedCount }} 条问题</button>
      <p>这一步只创建待审批的局部修订，保存仍需 Accept，不自动整理事实。</p>
    </template>
  </section>
</template>

<style scoped>
.chapter-review-workbench, .review-finding, label { display: grid; gap: 8px; min-width: 0; }
.chapter-review-workbench { padding: 12px; border-top: 1px solid var(--editor-hairline); font-size: 12px; line-height: 1.5; }
h3, h4, p, dl { margin: 0; } blockquote { margin: 0; padding: 6px 10px; border-left: 2px solid var(--editor-hairline-strong); white-space: pre-wrap; }
.review-finding { padding-block: 12px; border-top: 1px solid var(--editor-hairline); }
.review-dimensions { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; } dd { margin: 0; }
.review-actions { display: flex; flex-wrap: wrap; gap: 6px; }
button, select, textarea { min-width: 0; min-height: 36px; padding: 6px; font: inherit; background: var(--editor-canvas); color: var(--editor-ink); border: 1px solid var(--editor-hairline-strong); }
button, summary { cursor: pointer; } button:disabled { cursor: default; opacity: .6; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; } [role='alert'] { color: var(--editor-danger); }
button:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--editor-focus); outline-offset: 2px; }
</style>
