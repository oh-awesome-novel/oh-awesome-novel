// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vite-plus/test';

import PlayTranscript from '../../../apps/desktop-ui/src/components/play/PlayTranscript.vue';
import type { PlayProvisionalTurn } from '../../../apps/desktop-ui/src/composables/usePlayTurnStream';

describe('PlayTranscript', () => {
  it('keeps the ordinary provisional turn presentation unchanged', () => {
    const wrapper = mountTranscript({
      ...createProvisional(),
      intent: 'submit',
    });

    expect(wrapper.get('.play-turn-provisional header').text()).toContain('裁判');
    expect(wrapper.get('.play-turn-provisional header').text()).toContain(
      '生成中 · 尚未提交',
    );
    expect(wrapper.find('.play-retry-source').exists()).toBe(false);
    wrapper.unmount();
  });

  it('labels Retry and shows the original action with variant-preservation truth', () => {
    const wrapper = mountTranscript({
      ...createProvisional(),
      intent: 'retry',
      retrySourceArtifactId: 'turn-source',
      userText: '推开生锈的门',
    });

    expect(wrapper.get('.play-turn-provisional header').text()).toContain(
      '重演 · 生成中 · 尚未提交',
    );
    expect(wrapper.get('.play-retry-source').text()).toContain('按原行动重演');
    expect(wrapper.get('.play-retry-source').text()).toContain('推开生锈的门');
    expect(wrapper.get('.play-retry-source').text()).toContain(
      '旧结果会保留为另一个结果。',
    );
    wrapper.unmount();
  });
});

function mountTranscript(provisional: PlayProvisionalTurn) {
  return mount(PlayTranscript, {
    props: {
      title: 'Station',
      sceneStart: 'Rain hits the roof.',
      turns: [],
      provisional,
      announcement: provisional.statusMessage,
    },
  });
}

function createProvisional(): PlayProvisionalTurn {
  return {
    localId: 'local-1',
    turnId: 'run-1',
    sessionId: 'play-1',
    baseRevision: 1,
    userText: '等',
    actionKind: 'wait',
    intent: 'submit',
    phase: 'streaming',
    provisionalText: 'Footsteps approach.',
    statusMessage: '生成中 · 尚未提交',
  };
}
