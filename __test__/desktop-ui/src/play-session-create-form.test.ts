// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PlaySessionCreateForm from '../../../apps/desktop-ui/src/components/play/PlaySessionCreateForm.vue';

describe('PlaySessionCreateForm world motion seeds', () => {
  it('creates optional visible branch-base pressure and agenda seeds', async () => {
    const wrapper = mount(PlaySessionCreateForm, { props: { creating: false } });

    await field(wrapper, '标题').setValue('Last train');
    await field(wrapper, '开场场景').setValue('Midnight at the station.');
    await field(wrapper, 'Pressure').setValue('The last train is leaving');
    await field(wrapper, '下一后果').setValue('The witness leaves.');
    await field(wrapper, 'Agenda 所有者').setValue('Station guard');
    await field(wrapper, 'Agenda 目标').setValue('Seal every exit');
    await field(wrapper, '下一步').setValue('Lock the east gate');
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(false);
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('create')?.[0]?.[0]).toMatchObject({
      worldMomentum: {
        pressures: [{
          id: 'pressure-1',
          kind: 'deadline',
          label: 'The last train is leaving',
          status: 'active',
          nextConsequence: 'The witness leaves.',
          visibility: 'playerVisible',
        }],
        agendas: [{
          id: 'agenda-1',
          ownerEntityId: 'Station guard',
          goal: 'Seal every exit',
          nextMove: 'Lock the east gate',
          status: 'active',
          visibility: 'playerVisible',
          updatedAtTurnId: 'branch-base',
        }],
      },
    });
  });
});

function field(
  wrapper: ReturnType<typeof mount>,
  label: string,
) {
  const control = wrapper.findAll('label').find((candidate) =>
    candidate.find('span').text() === label,
  )?.find('input, textarea, select');
  if (!control?.exists()) {
    throw new Error(`Missing form field: ${label}`);
  }
  return control;
}
