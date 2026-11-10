<script setup lang="ts">
import { PLAY_EVENT_DENSITY_LABELS, PLAY_SIMULATION_MODE_LABELS } from '../../composables/playTerms';
import PlayWorldMomentum from './PlayWorldMomentum.vue';
import { comparePlayIsoWorldTime } from '@oh-awesome-novel/client';
import type {
  PlayActivatedSource,
  PlayAgenda,
  PlayEventPolicy,
  PlayPressure,
  PlayScheduledEvent,
  PlayWorldClock,
} from '../../composables/useWorkspaceApi';
import type { PlayStateEntryView } from '../../composables/usePlayWorkspace';

const props = defineProps<{
  clock: PlayWorldClock;
  policy: PlayEventPolicy;
  sceneStart: string;
  characters: string[];
  stateEntries: PlayStateEntryView[];
  scheduledEvents: PlayScheduledEvent[];
  pressures: PlayPressure[];
  agendas: PlayAgenda[];
  sources: PlayActivatedSource[];
}>();

function sourceName(source: PlayActivatedSource): string {
  return source.path ?? source.sourceId;
}

function triggerLabel(event: PlayScheduledEvent): string {
  switch (event.trigger.type) {
    case 'nextTurn':
      return '下一回合';
    case 'afterTurns':
      return `${event.trigger.turns} 回合后`;
    case 'flagEquals':
      return `${event.trigger.path} = ${String(event.trigger.value)}`;
    case 'atWorldTime':
      return `于 ${event.trigger.value}`;
    case 'manual':
      return '手动触发';
  }
}

function timeTriggerStatus(event: PlayScheduledEvent): string | undefined {
  if (event.trigger.type !== 'atWorldTime') return undefined;
  if (event.trigger.format !== 'iso8601') {
    return '待定：这个时间没有可比较的明确格式。';
  }
  const comparison = comparePlayIsoWorldTime(props.clock.anchor ?? '', event.trigger.value);
  if (comparison === undefined) return '待定：世界时钟需要带时区的 ISO 日期时间。';
  return comparison >= 0
    ? '下一回合结算时到期。'
    : '已启用 ISO 时间；每回合开始时对照已提交的时钟检查。';
}
</script>

<template>
  <section class="play-hud" aria-label="世界面板">
    <header class="play-hud-heading">
      <div>
        <span>世界面板</span>
        <h2>{{ clock.anchor || `第 ${clock.turn} 回合` }}</h2>
      </div>
      <span class="play-hud-marker" aria-hidden="true">[clock]</span>
    </header>

    <div class="play-hud-clock">
      <strong>第 {{ clock.turn }} 回合</strong>
      <span>revision {{ clock.revision }}</span>
      <span v-if="clock.elapsed">+ {{ clock.elapsed }}</span>
    </div>

    <div class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> 场景与人物</h3>
      <p>{{ sceneStart }}</p>
      <div class="play-chip-list">
        <span v-for="character in characters" :key="character">{{ character }}</span>
        <span v-if="characters.length === 0">没有固定人物</span>
      </div>
    </div>

    <div class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> 世界活跃度</h3>
      <dl class="play-policy-grid">
        <div><dt>模式</dt><dd>{{ PLAY_SIMULATION_MODE_LABELS[policy.simulationMode] ?? policy.simulationMode }}</dd></div>
        <div><dt>事件密度</dt><dd>{{ PLAY_EVENT_DENSITY_LABELS[policy.density] ?? policy.density }}</dd></div>
        <div><dt>幕后事件</dt><dd>{{ policy.allowOffscreen ? '开' : '关' }}</dd></div>
        <div><dt>隐藏事件</dt><dd>{{ policy.allowHidden ? '开' : '关' }}</dd></div>
        <div><dt>每回合上限</dt><dd>{{ policy.maxExternalEventsPerTurn }}</dd></div>
      </dl>
    </div>

    <PlayWorldMomentum :pressures="pressures" :agendas="agendas" />

    <div v-if="stateEntries.length" class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> 推演内状态</h3>
      <dl class="play-state-list">
        <div v-for="entry in stateEntries" :key="entry.key">
          <dt>{{ entry.key }}</dt>
          <dd>{{ entry.value }}</dd>
        </div>
      </dl>
    </div>

    <div v-if="scheduledEvents.length" class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> 计划中的变化</h3>
      <div class="play-source-list play-schedule-list">
        <article v-for="event in scheduledEvents" :key="event.id">
          <strong>{{ event.label }}</strong>
          <span>{{ triggerLabel(event) }} · 优先级 {{ event.priority ?? 0 }}</span>
          <span v-if="timeTriggerStatus(event)">{{ timeTriggerStatus(event) }}</span>
          <p>{{ event.template.summary }}</p>
        </article>
      </div>
    </div>

    <div class="play-hud-section">
      <h3><span aria-hidden="true">[+]</span> 启用的来源</h3>
      <div v-if="sources.length" class="play-source-list">
        <article v-for="source in sources" :key="source.sourceId">
          <strong>{{ sourceName(source) }}</strong>
          <span>{{ source.trust }} · {{ source.budgetLayer }}</span>
          <p>{{ source.reason }}</p>
        </article>
      </div>
      <p v-else class="play-muted-copy">这个会话没有记录启用的来源。</p>
    </div>
  </section>
</template>
