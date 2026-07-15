<script setup lang="ts">
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
    aria-label="World momentum"
  >
    <h3><span aria-hidden="true">[+]</span> World momentum</h3>

    <div v-if="props.pressures.length" class="play-momentum-group">
      <span class="play-momentum-group-label">Active pressures</span>
      <article v-for="pressure in props.pressures" :key="pressure.id">
        <div class="play-momentum-title">
          <strong>{{ pressure.label }}</strong>
          <span>{{ pressure.kind }}</span>
        </div>
        <span v-if="pressureLevel(pressure)" class="play-momentum-level">
          {{ pressureLevel(pressure) }}
        </span>
        <p v-if="pressure.nextConsequence">
          <span>Next consequence</span>
          {{ pressure.nextConsequence }}
        </p>
      </article>
    </div>

    <div v-if="props.agendas.length" class="play-momentum-group">
      <span class="play-momentum-group-label">NPC / faction agendas</span>
      <article v-for="agenda in props.agendas" :key="agenda.id">
        <div class="play-momentum-title">
          <strong>{{ agenda.ownerEntityId }}</strong>
          <span>{{ agenda.status }}</span>
        </div>
        <p><span>Goal</span> {{ agenda.goal }}</p>
        <p v-if="agenda.nextMove"><span>Next move</span> {{ agenda.nextMove }}</p>
        <p v-if="agenda.blockers.length"><span>Blocked by</span> {{ agenda.blockers.join(' · ') }}</p>
      </article>
    </div>
  </section>
</template>
