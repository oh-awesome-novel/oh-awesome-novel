// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';

import PlayRehearsalWorkspace from '../../../apps/desktop-ui/src/components/play/rehearsal/PlayRehearsalWorkspace.vue';
import type {
  PlayRehearsalActorQueueItem,
  PlayRehearsalControlCapabilities,
  PlayRehearsalResultView,
  PlaySceneMemoryView,
  PlayRehearsalStepView,
} from '../../../apps/desktop-ui/src/components/play/rehearsal/types';

describe('PlayRehearsalWorkspace', () => {
  it('composes queue, safe perception and provisional/selected/committed steps', async () => {
    const wrapper = mountWorkspace();

    expect(wrapper.get('[aria-label="场景试演工作区"]').attributes('aria-busy')).toBe('false');
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Ivo');
    expect(wrapper.get('.play-rehearsal-step[data-status="provisional"]').text()).toContain(
      '临时 · 尚未提交',
    );
    expect(wrapper.get('.play-rehearsal-step[data-status="selected"]').text()).toContain(
      '已采用 · 仅限本次试演',
    );
    expect(wrapper.get('.play-rehearsal-step[data-status="committed"]').text()).toContain('已提交');
    expect(wrapper.get('.play-rehearsal-inspector').text()).toContain('The train leaves at midnight.');
    expect(wrapper.text()).not.toContain('Hidden command from the mayor');
    expect(wrapper.get('.play-rehearsal-workspace-announcement').text()).toBe(
      'Draft prepared for Ivo.',
    );

    await button(wrapper, '停止步骤').trigger('click');
    await button(wrapper, '采用').trigger('click');
    await button(wrapper, '重演').trigger('click');
    expect(wrapper.emitted('stopStep')).toHaveLength(1);
    expect(wrapper.emitted('accept')).toEqual([['step-ivo-draft']]);
    expect(wrapper.emitted('retry')).toEqual([['step-ivo-draft']]);

    await button(wrapper, '完成试演').trigger('click');
    await flushPromises();
    await button(wrapper, '确认完成').trigger('click');
    expect(wrapper.emitted('finish')).toHaveLength(1);
    wrapper.unmount();
  });

  it('starts an attempt explicitly and presents only committed result truth', async () => {
    const wrapper = mountWorkspace({
      attempt: undefined,
      steps: [],
      stepRun: undefined,
      capabilities: {
        ...fullCapabilities(),
        canStartAttempt: true,
        canGenerateStep: false,
        canStopStep: false,
        canAccept: false,
        canRetry: false,
        canFinish: false,
        canCancel: false,
      },
    });

    await button(wrapper, '开始试演').trigger('click');
    expect(wrapper.emitted('startAttempt')).toHaveLength(1);

    await wrapper.setProps({
      attempt: {
        id: 'attempt-1',
        revision: 4,
        status: 'committed',
        selectedStepRefs: ['step-mara-selected'],
        selectedHeadRef: 'step-mara-selected',
      },
      steps: committedSteps(),
      result: committedResult(),
      capabilities: {
        ...fullCapabilities(),
        canAccept: false,
        canRetry: false,
        canFinish: false,
        canCancel: false,
      },
      announcement: 'Rehearsal committed once.',
    });

    expect(wrapper.get('[data-status="committed"].play-rehearsal-result').text()).toContain(
      '试演结果',
    );
    expect(wrapper.text()).toContain('Revision 4 · turn-rehearsal-1');
    expect(wrapper.text()).toContain('Mara keeps the letter hidden.');
    expect(wrapper.find('.play-director-controls').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens each typed intervention panel from the seven Director controls', async () => {
    const wrapper = mountWorkspace();
    const controls = wrapper.get('.play-director-control-row');

    expect(controls.findAll('button').map((control) => control.text())).toEqual([
      '采用',
      '修改',
      '重演',
      '插入角色',
      '授予认知',
      '完成试演',
      '取消',
    ]);

    await button(wrapper, '修改').trigger('click');
    expect(wrapper.get('.play-director-intervention-panel h2').text()).toBe(
      '修改角色步骤',
    );
    await button(wrapper, '返回').trigger('click');

    await button(wrapper, '插入角色').trigger('click');
    expect(wrapper.get('.play-director-intervention-panel h2').text()).toBe(
      '插入角色',
    );
    await button(wrapper, '返回').trigger('click');

    await button(wrapper, '授予认知').trigger('click');
    expect(wrapper.get('.play-director-intervention-panel h2').text()).toBe(
      '授予参与者认知',
    );
    wrapper.unmount();
  });

  it('shows superseded suffix and stagnation without changing the selected prefix', () => {
    const wrapper = mountWorkspace({
      attempt: {
        id: 'attempt-1',
        revision: 7,
        status: 'prepared',
        currentParticipantRef: 'ivo',
        selectedStepRefs: ['step-mara-selected'],
        selectedHeadRef: 'step-mara-selected',
        supersededStepRefs: ['step-old-ivo', 'step-old-guard'],
        stagnation: {
          consecutiveNoMaterialSteps: 3,
          threshold: 3,
          warning: true,
        },
      },
    });
    const notices = wrapper.findAll('.play-rehearsal-workspace-notice');

    expect(notices).toHaveLength(2);
    expect(notices[0]!.text()).toContain('有 2 个较早的步骤结果已被替换');
    expect(notices[0]!.text()).toContain('只使用当前选定的步骤');
    expect(notices[1]!.text()).toContain('连续 3 个步骤没有实质变化');
    expect(notices[1]!.text()).toContain('不必强行制造冲突');
    expect(wrapper.get('.play-rehearsal-step[data-status="selected"]').text()).toContain(
      'Mara hides the letter.',
    );
    wrapper.unmount();
  });

  it('renders current and stale Scene Memory and forwards lens, refresh and rebuild', async () => {
    const wrapper = mountWorkspace({ memory: currentMemory() });
    const memory = wrapper.get('.play-scene-memory-panel');

    expect(memory.text()).toContain('current clue retained for rehearsal');
    expect(memory.text()).toContain('2 turn refs · 1 event refs');
    expect(memory.find('.play-scene-memory-stale').exists()).toBe(false);

    await memory.findAll('button').find((control) => control.text() === '参与者')!.trigger('click');
    await memory.findAll('button').find((control) => control.text() === '刷新')!.trigger('click');
    await memory.findAll('button').find((control) => control.text() === '重建')!.trigger('click');

    expect(wrapper.emitted('updateLens')).toEqual([['player']]);
    expect(wrapper.emitted('refreshMemory')).toHaveLength(1);
    expect(wrapper.emitted('rebuildMemory')).toHaveLength(1);

    await wrapper.setProps({
      memory: {
        ...currentMemory(),
        status: 'stale',
        staleReasons: ['selected path changed', 'source hash changed'],
      },
    });
    expect(wrapper.get('.play-scene-memory-stale').text()).toContain(
      'selected path changed、source hash changed',
    );
    wrapper.unmount();
  });

  it('scrubs player-unknown facts and grants from the Player inspector lens', async () => {
    const wrapper = mountWorkspace({
      lens: 'director',
      perception: {
        participantRef: 'ivo',
        visibleFacts: ['The train leaves at midnight.', 'The mayor ordered the signal changed.'],
        visibleFactVisibilities: ['playerVisible', 'playerUnknown'],
        behaviorAnchors: ['Ivo never abandons an unfinished promise.'],
        observedBlockLabels: [],
        grantedKnowledge: [{
          id: 'grant-visible',
          summary: 'Mara carries the public timetable.',
          provenanceLabel: '当前分支已有的依据',
          visibility: 'playerVisible',
        }, {
          id: 'grant-hidden',
          summary: 'The stationmaster is working for the mayor.',
          provenanceLabel: '作者提供的推演事实',
          visibility: 'playerUnknown',
        }],
      },
    });

    expect(wrapper.text()).toContain('The mayor ordered the signal changed.');
    expect(wrapper.text()).toContain('The stationmaster is working for the mayor.');

    await wrapper.setProps({ lens: 'player' });

    expect(wrapper.text()).toContain('The train leaves at midnight.');
    expect(wrapper.text()).toContain('Mara carries the public timetable.');
    expect(wrapper.text()).not.toContain('The mayor ordered the signal changed.');
    expect(wrapper.text()).not.toContain('The stationmaster is working for the mayor.');
    wrapper.unmount();
  });
});

function mountWorkspace(
  overrides: Record<string, unknown> = {},
) {
  return mount(PlayRehearsalWorkspace, {
    attachTo: document.body,
    props: {
      scene: {
        title: 'Last train',
        opening: 'The doors begin to close.',
        location: 'Platform nine',
        atmosphere: 'Tense',
        objective: 'Test whether Mara tells the truth.',
        risk: 'The witness leaves.',
      },
      clock: { turn: 3, revision: 3, anchor: '23:50' },
      attempt: {
        id: 'attempt-1',
        revision: 3,
        status: 'running',
        currentParticipantRef: 'ivo',
        selectedStepRefs: ['step-mara-selected'],
        selectedHeadRef: 'step-mara-selected',
      },
      queue: actorQueue(),
      steps: activeSteps(),
      stepRun: {
        id: 'run-step-ivo',
        phase: 'prepared',
        statusMessage: 'Actor step prepared · not selected',
      },
      perception: {
        participantRef: 'ivo',
        visibleFacts: ['The train leaves at midnight.'],
        behaviorAnchors: ['Ivo never abandons an unfinished promise.'],
        observedBlockLabels: ['Mara looked toward the signal box.'],
      },
      visibleEvents: [{
        id: 'event-visible',
        title: 'Final boarding call',
        summary: 'The platform bell rings.',
      }],
      capabilities: fullCapabilities(),
      providerConfigured: true,
      busy: false,
      announcement: 'Draft prepared for Ivo.',
      ...overrides,
    },
  });
}

function actorQueue(): PlayRehearsalActorQueueItem[] {
  return [
    { participantRef: 'mara', displayName: 'Mara', status: 'selected' },
    { participantRef: 'ivo', displayName: 'Ivo', status: 'current', currentGoal: 'Recover the letter' },
    { participantRef: 'guard', displayName: 'Guard', status: 'waiting' },
  ];
}

function activeSteps(): PlayRehearsalStepView[] {
  return [
    step('step-old', 'Guard', 'committed', 'The guard checks the clock.'),
    step('step-mara-selected', 'Mara', 'selected', 'Mara hides the letter.'),
    step('step-ivo-draft', 'Ivo', 'provisional', 'Ivo reaches for the door.'),
  ];
}

function committedSteps(): PlayRehearsalStepView[] {
  return [step('step-mara-selected', 'Mara', 'committed', 'Mara hides the letter.')];
}

function step(
  id: string,
  participantName: string,
  status: PlayRehearsalStepView['status'],
  content: string,
): PlayRehearsalStepView {
  return {
    id,
    participantRef: participantName.toLowerCase(),
    participantName,
    status,
    blocks: [{
      id: `${id}-block`,
      kind: 'characterAction',
      speakerName: participantName,
      content,
      projection: 'transcript',
    }],
  };
}

function fullCapabilities(): PlayRehearsalControlCapabilities {
  return {
    canStartAttempt: false,
    canGenerateStep: false,
    canStopStep: true,
    canAccept: true,
    canModify: true,
    canRetry: true,
    canInsertActor: true,
    canGrantKnowledge: true,
    canFinish: true,
    canCancel: true,
  };
}

function currentMemory(): PlaySceneMemoryView {
  return {
    id: 'memory-director-3',
    lens: 'director',
    status: 'current',
    revision: 3,
    builtAt: '2026-07-20T12:00:00.000Z',
    staleReasons: [],
    items: [{
      id: 'memory-item-clue',
      kind: 'knowledge',
      summary: 'current clue retained for rehearsal',
      provenanceLabel: '2 turn refs · 1 event refs · 1 evidence refs · 1 source refs',
    }],
  };
}

function committedResult(): PlayRehearsalResultView {
  return {
    artifactRef: 'turn-rehearsal-1',
    revision: 4,
    summary: 'Mara keeps the letter hidden.',
    blocks: [{
      id: 'result-block',
      kind: 'characterAction',
      speakerName: 'Mara',
      content: 'Mara keeps the letter hidden.',
      projection: 'transcript',
    }],
    eventSummaries: ['The final boarding bell rings.'],
    stateChanges: [{ label: 'letter.owner', before: 'Ivo', after: 'Mara' }],
  };
}

function button(
  wrapper: ReturnType<typeof mountWorkspace>,
  label: string,
) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
