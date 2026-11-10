<script setup lang="ts">
import { PLAY_AGENDA_STATUS_LABELS, PLAY_PRESSURE_KIND_LABELS } from '../../composables/playTerms';
import type { PlayAgenda, PlayPressure } from '../../composables/useWorkspaceApi';

const props = defineProps<{
  pressures: PlayPressure[];
  agendas: PlayAgenda[];
}>();

function pressureLevel(pressure: PlayPressure): string | undefined {
  if (pressure.level === undefined || pressure.threshold === undefined) {
    return undefined;
  }

  return `level ${pressure.level} / threshold ${pressure.threshold}`;
}
</script>

<template>
  <section
    v-if="props.pressures.length || props.agendas.length"
    class="play-hud-section play-world-momentum"
    aria-label="世界动向"
  >
    <h3><span aria-hidden="true">[+]</span> 世界动向</h3>

    <div v-if="props.pressures.length" class="play-momentum-group">
      <span class="play-momentum-group-label">进行中的压力</span>
      <article v-for="pressure in props.pressures" :key="pressure.id">
        <div class="play-momentum-title">
          <strong>{{ pressure.label }}</strong>
          <span>{{ PLAY_PRESSURE_KIND_LABELS[pressure.kind] ?? pressure.kind }}</span>
        </div>
        <span v-if="pressureLevel(pressure)" class="play-momentum-level">
          {{ pressureLevel(pressure) }}
        </span>
        <p v-if="pressure.nextConsequence">
          <span>下一步后果</span>
          {{ pressure.nextConsequence }}
        </p>
      </article>
    </div>

    <div v-if="props.agendas.length" class="play-momentum-group">
      <span class="play-momentum-group-label">NPC / 势力动向</span>
      <article v-for="agenda in props.agendas" :key="agenda.id">
        <div class="play-momentum-title">
          <strong>{{ agenda.ownerEntityId }}</strong>
          <span>{{ PLAY_AGENDA_STATUS_LABELS[agenda.status] ?? agenda.status }}</span>
        </div>
        <p><span>目标</span> {{ agenda.goal }}</p>
        <p v-if="agenda.nextMove"><span>下一步</span> {{ agenda.nextMove }}</p>
        <p v-if="agenda.blockers.length"><span>受阻于</span> {{ agenda.blockers.join(' · ') }}</p>
      </article>
    </div>
  </section>
</template>
