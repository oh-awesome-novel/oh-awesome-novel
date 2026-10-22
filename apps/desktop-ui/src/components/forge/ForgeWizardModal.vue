<script setup lang="ts">
import { shallowRef, toRef } from 'vue';
import ForgeDiscussPanel from './ForgeDiscussPanel.vue';
import ForgeBriefPanel from './ForgeBriefPanel.vue';
import ForgePlanPanel from './ForgePlanPanel.vue';
import { useForge } from '../../composables/useForge';
import { useWorkspaceDialog } from '../../composables/useWorkspaceDialog';
const props = defineProps<{ workspaceRoot: string; providerConfigured: boolean }>();
const emit = defineEmits<{ close: []; configureProvider: []; pendingActionCreated: []; reviewPendingAction: [id: string]; playSessionCreated: [id: string]; writingReferencesUpdated: [paths: string[]] }>();
const panel = shallowRef<HTMLElement | null>(null);
const idea = shallowRef('');
const planDirty = shallowRef(false);
const { keydown } = useWorkspaceDialog(panel, () => emit('close'));
const { draft, drafts, busy, error, accepted, pendingStatus, canHandoff, refreshList, read, create, mutate, refreshApproval, handoff } = useForge({
  workspaceRoot: toRef(props, 'workspaceRoot'),
  onPendingAction: id => { emit('pendingActionCreated'); emit('reviewPendingAction', id); },
  onPlaySession: id => emit('playSessionCreated', id),
  onWritingReferences: paths => emit('writingReferencesUpdated', paths),
});
function select(event: Event) { const id = (event.target as HTMLSelectElement).value; if (id) void read(id); }
</script>
<template>
  <div class="forge-backdrop"><section ref="panel" role="dialog" aria-modal="true" aria-labelledby="forge-title" class="forge-wizard" @keydown="keydown">
    <header><div><h2 id="forge-title">设定共创工坊</h2><p>聊想法 · 定方案 · 动笔写 · 审查入库</p></div><button type="button" aria-label="关闭设定工坊" @click="emit('close')">关闭</button></header>
    <div class="draft-toolbar"><label for="forge-drafts">恢复草稿</label><select id="forge-drafts" :value="draft?.id ?? ''" :disabled="busy" @change="select"><option value="">选择草稿</option><option v-for="saved in drafts" :key="saved.id" :value="saved.id">{{ saved.brief.title || saved.idea }} · {{ saved.stage }}</option></select><button type="button" :disabled="busy" @click="refreshList">刷新列表</button><button v-if="draft" type="button" :disabled="busy" @click="read(draft.id)">重新载入</button></div>
    <p v-if="error" role="alert">{{ error }}；如版本已变化，请重新载入草稿后再操作。</p>
    <p v-if="busy" role="status" aria-live="polite">正在处理，草稿完成后会自动保存…</p>
    <p v-if="!providerConfigured">请先配置模型以开始共创。<button type="button" @click="emit('configureProvider')">配置模型</button></p>
    <form class="idea-form" @submit.prevent="create(idea)"><label for="forge-idea">一个角色、一处舞台，或一个模糊的想法</label><textarea id="forge-idea" v-model="idea" rows="2" :disabled="busy" /><button type="submit" :disabled="busy || !providerConfigured || !idea.trim()">开始新草稿</button></form>
    <template v-if="draft">
      <div class="forge-columns"><ForgeDiscussPanel :questions="draft.questions" :reply="draft.reply" :busy="busy || !providerConfigured" @answer="mutate('discuss', { message: $event })" /><ForgeBriefPanel :brief="draft.brief" :busy="busy" @save="mutate('update', { brief: $event })" /></div>
      <button type="button" :disabled="busy || !providerConfigured" @click="mutate('plan')">{{ draft.plan ? '重新生成方案' : '生成方案' }}</button>
      <ForgePlanPanel v-if="draft.plan" :plan="draft.plan" :busy="busy" @save="mutate('update', { plan: $event })" @dirty="planDirty = $event" />
      <button v-if="draft.plan" type="button" :disabled="busy || !providerConfigured || planDirty" @click="mutate('write')">核准方案并分块撰写</button>
      <section v-if="draft.chunks" aria-label="生成结果"><h3>撰写与质检结果</h3><details v-for="(content, name) in draft.chunks" :key="name"><summary>{{ name }}</summary><pre>{{ content }}</pre></details><button type="button" :disabled="busy || Boolean(draft.pendingActionId)" @click="mutate('propose')">定稿生成并入库：审查差异</button></section>
      <section v-if="draft.pendingActionId" aria-label="入库审批"><h3>审查与落盘</h3><p>通过现有审批面板查看逐文件差异并 Accept；拒绝不会写入设定库。</p><button type="button" @click="emit('reviewPendingAction', draft.pendingActionId)">打开审批差异</button><button type="button" :disabled="busy" @click="refreshApproval">刷新审批状态</button><button v-if="!accepted && !pendingStatus" type="button" :disabled="busy" @click="mutate('propose')">恢复审批</button><p v-if="pendingStatus" role="status">{{ accepted ? '设定已批准入库' : pendingStatus === 'rejected' ? '已拒绝，可重新修改生成' : '等待审批' }}</p>
        <button type="button" :disabled="!canHandoff" @click="handoff('play')">一键开演</button><button type="button" :disabled="!canHandoff" @click="handoff('writing')">一键入书</button>
      </section>
    </template>
  </section></div>
</template>
<style scoped>
.forge-backdrop{position:fixed;inset:0;z-index:60;background:#0008;display:grid;place-items:center;padding:20px}.forge-wizard{background:var(--surface-color,#fff);color:var(--text-color,#252525);border:1px solid var(--border-color,#ddd);border-radius:16px;width:min(1040px,100%);max-height:90vh;overflow:auto;padding:24px;box-sizing:border-box}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}h2{margin:0}.draft-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:16px 0}.forge-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;margin:20px 0}.idea-form label{display:block}textarea{width:100%;box-sizing:border-box;margin:8px 0}button{padding:8px 12px;margin:4px 8px 4px 0;border:1px solid var(--border-color,#bbb);border-radius:7px;background:var(--surface-color,#fff);color:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}[role=alert]{color:#a13535}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{padding:10px;border-bottom:1px solid var(--border-color,#ddd)}@media(max-width:720px){.forge-columns{grid-template-columns:1fr}.forge-backdrop{padding:8px}.forge-wizard{padding:16px}}
</style>
