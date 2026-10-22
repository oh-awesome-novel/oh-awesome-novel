<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import type { NovelLintScan, LintReplacement } from '@oh-awesome-novel/core';
import { oanClient } from '../../client';
const props=defineProps<{path:string;workspaceRoot:string;disabled?:boolean}>();
const emit=defineEmits<{pendingActionCreated:[];reviewPendingAction:[id:string]}>();
const scan=ref<NovelLintScan>(); const suggestions=ref<LintReplacement[]>([]); const selected=ref<string[]>([]);
const busy=ref(false); const error=ref(''); let controller:AbortController|undefined;
function reset(){controller?.abort();controller=undefined;busy.value=false;scan.value=undefined;suggestions.value=[];selected.value=[];error.value='';}
watch(()=>[props.path,props.workspaceRoot],reset);onBeforeUnmount(reset);
async function request(operation:'scan'|'review'|'propose'){
  controller?.abort(); const active=new AbortController();controller=active;busy.value=true;error.value='';
  try{
    const input={path:props.path,expectedWorkspaceRoot:props.workspaceRoot};
    if(operation==='scan') { const result=await oanClient.scanNovelLint(input,{signal:active.signal}); if(active.signal.aborted)return; scan.value=result;suggestions.value=[];selected.value=[]; }
    else if(operation==='review') { const result=await oanClient.reviewNovelLint({...input,sourceHash:scan.value!.sourceHash},{signal:active.signal}); if(active.signal.aborted)return; suggestions.value=result.replacements;selected.value=result.replacements.map(item=>item.hitId); }
    else { const result=await oanClient.proposeNovelLint({...input,sourceHash:scan.value!.sourceHash,replacements:suggestions.value.filter(item=>selected.value.includes(item.hitId))},{signal:active.signal}); if(active.signal.aborted)return; emit('pendingActionCreated');emit('reviewPendingAction',result.pendingAction.id);suggestions.value=[];selected.value=[]; }
  }catch(cause){if(!active.signal.aborted)error.value=cause instanceof Error?cause.message:String(cause);}
  finally{if(controller===active){busy.value=false;controller=undefined;}}
}
</script>
<template>
  <section class="writing-lint-bar" aria-label="正文套话质检">
    <div class="lint-actions">
      <strong>套话质检</strong><span>扫描已保存正文；提示仅供作者判断。</span>
      <button type="button" :disabled="busy || disabled" @click="request('scan')">扫描</button>
      <button type="button" :disabled="busy || disabled || !scan?.hits.length" @click="request('review')">生成微创建议</button>
      <button v-if="busy" type="button" @click="reset">取消</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <details v-if="scan" :open="scan.hits.length > 0">
      <summary>{{ scan.hits.length }} 处提示</summary>
      <ul class="lint-hits"><li v-for="hit in scan.hits" :key="hit.hitId">第 {{ hit.line }} 行 · {{ hit.name }}：<mark>{{ hit.original }}</mark> — {{ hit.suggestionHint }}</li></ul>
    </details>
    <fieldset v-if="suggestions.length" :disabled="busy || disabled">
      <legend>选择局部修改，再审查文件差异</legend>
      <label v-for="item in suggestions" :key="item.hitId"><input v-model="selected" type="checkbox" :value="item.hitId"> <del>{{ item.original }}</del> → <ins>{{ item.suggestion || '删除' }}</ins></label>
      <button type="button" :disabled="!selected.length" @click="request('propose')">提交所选修改审批</button>
    </fieldset>
  </section>
</template>
<style scoped>
.writing-lint-bar{border-top:1px solid var(--border-color,#ddd);padding:12px;font-size:13px}.lint-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.lint-hits{max-height:180px;overflow:auto;padding-left:24px}fieldset{display:grid;gap:8px}mark{background:#f9e6a4;color:#30291e}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}p[role=alert]{color:#b93232}
</style>
