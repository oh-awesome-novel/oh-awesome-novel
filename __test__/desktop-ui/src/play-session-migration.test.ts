// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { expect, it, vi } from 'vite-plus/test';
import PlaySessionMigration from '../../../apps/desktop-ui/src/components/play/PlaySessionMigration.vue';
import { usePlaySessionMigration } from '../../../apps/desktop-ui/src/composables/usePlaySessionMigration';
const preview = { sessionId: 'legacy', baseRevision: 0, sourceFingerprint: 'a'.repeat(64), fromSchemaVersion: 2 as const, toSchemaVersion: 4 as const, unknownMetadataKeys: ['customField'], legacyTranscriptCount: 3, projectedTurnCount: 1, generatedTurnIds: ['legacy-turn-0001'], backupRelativePath: '.migrations/v2-to-v4/original' };
it('shows backup and retained metadata, and waits for an explicit confirmation click', async () => {
  const client = { previewPlaySessionMigration: vi.fn().mockResolvedValue({ preview }), confirmPlaySessionMigration: vi.fn().mockResolvedValue({}) };
  const onConfirmed = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(defineComponent({ setup() {
    const migration = usePlaySessionMigration({ client, selectedSessionId: ref('legacy'), onConfirmed });
    void migration.load('legacy');
    return () => migration.preview.value ? h(PlaySessionMigration, { preview: migration.preview.value, busy: migration.busy.value, error: migration.error.value, onConfirm: migration.confirm }) : h('p', migration.notice.value);
  } }));
  await flushPromises();
  expect(wrapper.text()).toContain(preview.backupRelativePath);
  expect(wrapper.text()).toContain('customField');
  expect(client.confirmPlaySessionMigration).not.toHaveBeenCalled();
  await wrapper.get('button').trigger('click'); await flushPromises();
  expect(client.confirmPlaySessionMigration).toHaveBeenCalledWith('legacy', { confirmed: true, baseRevision: 0, sourceFingerprint: preview.sourceFingerprint });
  expect(onConfirmed).toHaveBeenCalledOnce();
  expect(wrapper.text()).toContain('upgraded');
  wrapper.unmount();
});
