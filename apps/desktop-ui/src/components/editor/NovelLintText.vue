<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { scanLocalNovelLint } from '@oh-awesome-novel/core/novel-lint-rules';
import type { LocalLintHit } from '@oh-awesome-novel/core/novel-lint-rules';
const props=withDefaults(defineProps<{text:string;enabled?:boolean}>(),{enabled:true});
const hits=shallowRef<LocalLintHit[]>([]);
let timer:ReturnType<typeof setTimeout>|undefined;
watch(()=>[props.text,props.enabled],()=>{
  clearTimeout(timer);hits.value=[];
  if(props.enabled)timer=setTimeout(()=>{hits.value=scanLocalNovelLint(props.text);},180);
},{immediate:true});
onBeforeUnmount(()=>clearTimeout(timer));
const parts=computed(()=>{
  const result:Array<{text:string;hint?:string}>=[];let offset=0;
  for(const hit of hits.value){
    // Advisory overlaps share one highlight; approval still validates each exact host span.
    if(hit.offset<offset)continue;
    if(hit.offset>offset)result.push({text:props.text.slice(offset,hit.offset)});
    result.push({text:props.text.slice(hit.offset,hit.end),hint:`${hit.name}：${hit.suggestionHint}`});offset=hit.end;
  }
  if(offset<props.text.length)result.push({text:props.text.slice(offset)});
  return result;
});
</script>
<template><template v-for="(part,index) in parts" :key="index"><mark v-if="part.hint" class="novel-lint-hit" :title="part.hint" :aria-label="`${part.text}，${part.hint}`">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></template>
<style scoped>
.novel-lint-hit{color:inherit;background:color-mix(in srgb,#e4b95e 24%,transparent);text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:#996f17;text-underline-offset:3px;border-radius:2px}
</style>
