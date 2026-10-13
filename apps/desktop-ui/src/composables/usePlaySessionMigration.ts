import { readonly, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type { PlaySessionMigrationPreview, PlaySessionMigrationConfirmation } from '@oh-awesome-novel/client';

export function usePlaySessionMigration(options: {
  client: {
    previewPlaySessionMigration(id: string): Promise<{ preview: PlaySessionMigrationPreview | null }>;
    confirmPlaySessionMigration(id: string, input: PlaySessionMigrationConfirmation): Promise<unknown>;
  };
  selectedSessionId: Readonly<Ref<string>>;
  onConfirmed(): Promise<void>;
}) {
  const preview = shallowRef<PlaySessionMigrationPreview | null>(null);
  const busy = shallowRef(false);
  const error = shallowRef('');
  const notice = shallowRef('');
  let generation = 0;
  watch(options.selectedSessionId, () => { generation++; preview.value = null; error.value = ''; notice.value = ''; }, { flush: 'sync' });
  async function load(id: string): Promise<void> {
    const current = ++generation;
    const result = await options.client.previewPlaySessionMigration(id);
    if (current === generation && id === options.selectedSessionId.value) preview.value = result.preview;
  }
  async function confirm(): Promise<void> {
    const reviewed = preview.value;
    if (!reviewed || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await options.client.confirmPlaySessionMigration(reviewed.sessionId, {
        confirmed: true, baseRevision: reviewed.baseRevision, sourceFingerprint: reviewed.sourceFingerprint,
      });
      preview.value = null;
      notice.value = 'Play session upgraded. The original files were preserved in the migration backup.';
      await options.onConfirmed();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally { busy.value = false; }
  }
  return { preview: readonly(preview), busy: readonly(busy), error: readonly(error), notice: readonly(notice), load, confirm };
}
