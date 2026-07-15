<script setup lang="ts">
import { computed, shallowRef } from 'vue';

import type {
  PlayAgenda,
  PlayEventDensity,
  PlayPressure,
  PlaySimulationMode,
} from '../../composables/useWorkspaceApi';
import type {
  PlaySessionCreateInput,
  PlayWorldMomentum,
} from '../../composables/usePlayWorkspace';

defineProps<{
  creating: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  create: [input: PlaySessionCreateInput];
}>();

const title = shallowRef('');
const sceneStart = shallowRef('');
const userPersona = shallowRef('');
const characters = shallowRef('');
const simulationMode = shallowRef<PlaySimulationMode>('reactiveWorld');
const density = shallowRef<PlayEventDensity>('balanced');
const pressureKind = shallowRef<PlayPressure['kind']>('deadline');
const pressureLabel = shallowRef('');
const pressureNextConsequence = shallowRef('');
const agendaOwner = shallowRef('');
const agendaGoal = shallowRef('');
const agendaNextMove = shallowRef('');
const pressureSeedTouched = computed(() =>
  pressureLabel.value.trim().length > 0 || pressureNextConsequence.value.trim().length > 0,
);
const pressureSeedValid = computed(() =>
  !pressureSeedTouched.value || (
    pressureLabel.value.trim().length > 0 &&
    pressureNextConsequence.value.trim().length > 0
  ),
);
const agendaSeedTouched = computed(() =>
  agendaOwner.value.trim().length > 0 ||
  agendaGoal.value.trim().length > 0 ||
  agendaNextMove.value.trim().length > 0,
);
const agendaSeedValid = computed(() =>
  !agendaSeedTouched.value || (
    agendaOwner.value.trim().length > 0 && agendaGoal.value.trim().length > 0
  ),
);
const canCreate = computed(() =>
  title.value.trim().length > 0 &&
  sceneStart.value.trim().length > 0 &&
  pressureSeedValid.value &&
  agendaSeedValid.value,
);

function submitCreate() {
  if (!canCreate.value) {
    return;
  }

  const worldMomentum = buildWorldMomentum();
  emit('create', {
    title: title.value.trim(),
    sceneStart: sceneStart.value.trim(),
    userPersona: userPersona.value.trim() || undefined,
    characters: splitCharacters(characters.value),
    eventPolicy: {
      simulationMode: simulationMode.value,
      density: density.value,
    },
    ...(worldMomentum ? { worldMomentum } : {}),
  });
}

function buildWorldMomentum(): PlayWorldMomentum | undefined {
  const pressures: PlayPressure[] = pressureSeedTouched.value
    ? [{
        id: 'pressure-1',
        kind: pressureKind.value,
        label: pressureLabel.value.trim(),
        status: 'active',
        causeRefs: ['branch-base'],
        nextConsequence: pressureNextConsequence.value.trim(),
        visibility: 'playerVisible',
      }]
    : [];
  const agendas: PlayAgenda[] = agendaSeedTouched.value
    ? [{
        id: 'agenda-1',
        ownerEntityId: agendaOwner.value.trim(),
        goal: agendaGoal.value.trim(),
        nextMove: agendaNextMove.value.trim() || undefined,
        blockers: [],
        status: 'active',
        visibility: 'playerVisible',
        updatedAtTurnId: 'branch-base',
      }]
    : [];

  return pressures.length || agendas.length ? { pressures, agendas } : undefined;
}

function splitCharacters(value: string): string[] {
  return value
    .split(/\r?\n|,/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
</script>

<template>
  <form class="play-create-form" @submit.prevent="submitCreate">
    <label>
      <span>标题</span>
      <input v-model="title" class="text-input" type="text" placeholder="雨夜码头">
    </label>
    <label>
      <span>开场场景</span>
      <textarea v-model="sceneStart" class="text-input" rows="3" placeholder="从一个可行动的瞬间开始"></textarea>
    </label>
    <label>
      <span>玩家身份</span>
      <input v-model="userPersona" class="text-input" type="text" placeholder="可选">
    </label>
    <label>
      <span>在场角色</span>
      <textarea v-model="characters" class="text-input" rows="2" placeholder="每行一个角色"></textarea>
    </label>
    <div class="play-policy-fields">
      <label>
        <span>世界模式</span>
        <select v-model="simulationMode" class="text-input">
          <option value="conversation">Conversation</option>
          <option value="reactiveWorld">Reactive world</option>
          <option value="activeWorld">Active world</option>
        </select>
      </label>
      <label>
        <span>事件密度</span>
        <select v-model="density" class="text-input">
          <option value="quiet">Quiet</option>
          <option value="balanced">Balanced</option>
          <option value="volatile">Volatile</option>
        </select>
      </label>
    </div>
    <fieldset class="play-world-seed-fields">
      <legend>World motion seeds <small>可选</small></legend>
      <p>为新世界提供一个正在逼近的压力，或一个 NPC / 组织的下一步。</p>

      <div class="play-world-seed-grid">
        <label>
          <span>Pressure 类型</span>
          <select v-model="pressureKind" class="text-input">
            <option value="deadline">Deadline</option>
            <option value="pursuit">Pursuit</option>
            <option value="factionProject">Faction project</option>
            <option value="environment">Environment</option>
            <option value="rumor">Rumor</option>
            <option value="relationship">Relationship</option>
          </select>
        </label>
        <label>
          <span>Pressure</span>
          <input
            v-model="pressureLabel"
            class="text-input"
            type="text"
            placeholder="午夜前必须交出证据"
            :aria-invalid="pressureSeedTouched && !pressureSeedValid"
          >
        </label>
        <label class="play-world-seed-wide">
          <span>下一后果</span>
          <input
            v-model="pressureNextConsequence"
            class="text-input"
            type="text"
            placeholder="报社停止等待并撤走联络人"
            :aria-invalid="pressureSeedTouched && !pressureSeedValid"
          >
        </label>
        <p
          v-if="pressureSeedTouched && !pressureSeedValid"
          class="play-world-seed-error"
          role="alert"
        >
          Pressure seed 需要名称和下一后果。
        </p>

        <label>
          <span>Agenda 所有者</span>
          <input
            v-model="agendaOwner"
            class="text-input"
            type="text"
            placeholder="守卫队"
            :aria-invalid="agendaSeedTouched && !agendaSeedValid"
          >
        </label>
        <label>
          <span>Agenda 目标</span>
          <input
            v-model="agendaGoal"
            class="text-input"
            type="text"
            placeholder="控制车站出入口"
            :aria-invalid="agendaSeedTouched && !agendaSeedValid"
          >
        </label>
        <label class="play-world-seed-wide">
          <span>下一步</span>
          <input
            v-model="agendaNextMove"
            class="text-input"
            type="text"
            placeholder="封锁东侧入口"
          >
        </label>
        <p
          v-if="agendaSeedTouched && !agendaSeedValid"
          class="play-world-seed-error"
          role="alert"
        >
          Agenda seed 需要所有者和目标。
        </p>
      </div>
    </fieldset>
    <div class="play-create-actions">
      <button class="ghost-button tight-button" type="button" :disabled="creating" @click="emit('cancel')">
        Cancel
      </button>
      <button class="primary-button tight-button" type="submit" :disabled="creating || !canCreate">
        {{ creating ? 'Creating…' : 'Create session' }}
      </button>
    </div>
  </form>
</template>
