<script setup lang="ts">
import { computed, useId } from 'vue';

import type {
  PlayRehearsalActorQueueItem,
  PlayRehearsalPerceptionView,
  PlayRehearsalSceneContractView,
  PlayRehearsalVisibleEventView,
} from './types';

const props = defineProps<{
  scene: Readonly<PlayRehearsalSceneContractView>;
  activeActor?: Readonly<PlayRehearsalActorQueueItem>;
  perception?: Readonly<PlayRehearsalPerceptionView>;
  visibleEvents: readonly Readonly<PlayRehearsalVisibleEventView>[];
  lens?: 'player' | 'director';
}>();
const scene = computed(() => props.scene);
const activeActor = computed(() => props.activeActor);
const perception = computed(() => props.perception);
const visibleEvents = computed(() => props.visibleEvents);
const lens = computed(() => props.lens ?? 'director');
const projectedVisibleFacts = computed(() =>
  (props.perception?.visibleFacts ?? []).filter((_, index) =>
    lens.value === 'director' ||
    props.perception?.visibleFactVisibilities?.[index] !== 'playerUnknown',
  ),
);
const visibleGrantedKnowledge = computed(() =>
  (props.perception?.grantedKnowledge ?? []).filter((grant) =>
    lens.value === 'director' || grant.visibility !== 'playerUnknown',
  ),
);

const emit = defineEmits<{
  updateLens: [lens: 'player' | 'director'];
}>();

const headingId = `${useId()}-rehearsal-inspector-heading`;
</script>

<template>
  <aside class="play-rehearsal-inspector" :aria-labelledby="headingId">
    <header>
      <div>
        <span>{{ lens === 'director' ? '导演视角' : '参与者视角' }}</span>
        <h2 :id="headingId">场景检查器</h2>
      </div>
      <div class="play-rehearsal-inspector-lens" role="group" aria-label="试演检查器视角">
        <button type="button" :aria-pressed="lens === 'player'" @click="emit('updateLens', 'player')">参与者</button>
        <button type="button" :aria-pressed="lens === 'director'" @click="emit('updateLens', 'director')">导演</button>
      </div>
    </header>

    <section>
      <h3>场景约定</h3>
      <dl>
        <div><dt>地点</dt><dd>{{ scene.location || '未指定' }}</dd></div>
        <div v-if="lens === 'director'"><dt>目标</dt><dd>{{ scene.objective || '未指定' }}</dd></div>
        <div v-if="lens === 'director'"><dt>风险</dt><dd>{{ scene.risk || '未指定' }}</dd></div>
        <div><dt>氛围</dt><dd>{{ scene.atmosphere || '未指定' }}</dd></div>
      </dl>
    </section>

    <section>
      <h3>当前角色</h3>
      <div v-if="activeActor" class="play-rehearsal-current-actor">
        <strong>{{ activeActor.displayName }}</strong>
        <span>{{ activeActor.position || '未指定位置' }}</span>
        <p>{{ activeActor.currentGoal || '未指定目标' }}</p>
      </div>
      <p v-else class="play-rehearsal-inspector-empty">当前没有行动中的角色。</p>
    </section>

    <section>
      <h3>允许的感知</h3>
      <p class="play-rehearsal-perception-note">
        这里只显示提供给这个角色的过滤后感知。
      </p>
      <template v-if="perception">
        <h4>可见事实</h4>
        <ul v-if="projectedVisibleFacts.length">
          <li v-for="(fact, index) in projectedVisibleFacts" :key="`${index}:${fact}`">{{ fact }}</li>
        </ul>
        <p v-else class="play-rehearsal-inspector-empty">没有提供可见事实。</p>

        <h4 v-if="lens === 'director'">行为锚点</h4>
        <ul v-if="lens === 'director' && perception.behaviorAnchors.length">
          <li v-for="(anchor, index) in perception.behaviorAnchors" :key="`${index}:${anchor}`">{{ anchor }}</li>
        </ul>
        <p v-else-if="lens === 'director'" class="play-rehearsal-inspector-empty">没有提供行为锚点。</p>

        <template v-if="visibleGrantedKnowledge.length">
          <h4>授予的认知</h4>
          <ul>
            <li v-for="grant in visibleGrantedKnowledge" :key="grant.id">
              {{ grant.summary }}
              <small v-if="lens === 'director'">{{ grant.provenanceLabel }}</small>
            </li>
          </ul>
        </template>

        <h4>已观察的段落</h4>
        <ul v-if="perception.observedBlockLabels.length">
          <li v-for="(label, index) in perception.observedBlockLabels" :key="`${index}:${label}`">{{ label }}</li>
        </ul>
        <p v-else class="play-rehearsal-inspector-empty">没有更早的段落观察。</p>

        <p v-if="lens === 'director' && perception.omissionNotice" class="play-rehearsal-omission-notice">
          {{ perception.omissionNotice }}
        </p>
      </template>
      <p v-else class="play-rehearsal-inspector-empty">感知包尚未准备。</p>
    </section>

    <section>
      <h3>可见事件</h3>
      <ul v-if="visibleEvents.length" class="play-rehearsal-visible-events">
        <li v-for="event in visibleEvents" :key="event.id">
          <strong>{{ event.title }}</strong>
          <p>{{ event.summary }}</p>
        </li>
      </ul>
      <p v-else class="play-rehearsal-inspector-empty">这次试演没有可见事件。</p>
    </section>
  </aside>
</template>

<style scoped>
.play-rehearsal-inspector {
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--play-line, var(--editor-hairline));
  background: var(--play-surface, var(--editor-surface));
  color: var(--play-body, var(--editor-body));
}

.play-rehearsal-inspector > header,
.play-rehearsal-inspector section {
  display: grid;
  gap: 8px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-inspector > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.play-rehearsal-inspector-lens {
  display: flex;
  gap: 4px;
}

.play-rehearsal-inspector > header span,
.play-rehearsal-inspector dt,
.play-rehearsal-current-actor span,
.play-rehearsal-perception-note,
.play-rehearsal-inspector-empty,
.play-rehearsal-omission-notice {
  color: var(--play-muted, var(--editor-muted));
  font-size: 10px;
}

.play-rehearsal-inspector :where(h2, h3, h4, p, dl, ul) {
  margin: 0;
}

.play-rehearsal-inspector h2 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 13px;
}

.play-rehearsal-inspector h3,
.play-rehearsal-inspector h4 {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-inspector h4 {
  margin-top: 4px;
  color: var(--play-muted, var(--editor-muted));
}

.play-rehearsal-inspector dl,
.play-rehearsal-current-actor {
  display: grid;
  gap: 6px;
}

.play-rehearsal-inspector dl div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px;
}

.play-rehearsal-inspector dd {
  margin: 0;
  font-size: 10px;
}

.play-rehearsal-current-actor {
  padding: 8px;
  border-left: 2px solid var(--play-ink, var(--editor-ink));
  background: var(--play-canvas, var(--editor-canvas));
}

.play-rehearsal-current-actor strong,
.play-rehearsal-visible-events strong {
  color: var(--play-ink, var(--editor-ink));
  font-size: 11px;
}

.play-rehearsal-current-actor p,
.play-rehearsal-inspector li,
.play-rehearsal-visible-events p {
  font-size: 10px;
  line-height: 1.5;
}

.play-rehearsal-inspector ul {
  display: grid;
  gap: 5px;
  padding-left: 16px;
}

.play-rehearsal-visible-events {
  padding: 0;
  list-style: none;
}

.play-rehearsal-visible-events li {
  display: grid;
  gap: 3px;
  padding-top: 7px;
  border-top: 1px solid var(--play-line, var(--editor-hairline));
}

.play-rehearsal-omission-notice {
  padding-top: 7px;
  border-top: 1px dotted var(--play-line, var(--editor-hairline));
}
</style>
