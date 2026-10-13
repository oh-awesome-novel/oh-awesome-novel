import { computed, onBeforeUnmount, readonly, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type { OanClient, PlaySession } from '@oh-awesome-novel/client';

export function usePlayObservation(options: {
  client: Pick<OanClient, 'addPlayObservation'>;
  session: Readonly<Ref<PlaySession | undefined>>;
  blocked: Readonly<Ref<boolean>>;
  onSaved(): Promise<void>;
}) {
  const open = shallowRef(false);
  const summary = shallowRef('');
  const evidence = shallowRef('');
  const sourceTurnId = shallowRef('');
  const saving = shallowRef(false);
  const error = shallowRef('');
  const notice = shallowRef('');
  let epoch = 0;
  // Only committed messages in the currently displayed selected window are
  // eligible. Never infer evidence from events, hidden state or provisional text.
  const sources = computed(() => (options.session.value?.transcript ?? [])
    .filter((turn): turn is typeof turn & { id: string } => Boolean(turn.id))
    .map((turn) => ({
      id: turn.id,
      label: `${turn.speaker}: ${turn.content.replace(/\s+/gu, ' ').slice(0, 100)}`,
    })));
  const canSave = computed(() => open.value && !options.blocked.value &&
    summary.value.trim().length > 0 && evidence.value.trim().length > 0 &&
    sources.value.some((source) => source.id === sourceTurnId.value));

  watch(() => options.session.value?.id, () => {
    epoch++;
    reset();
    saving.value = false;
    notice.value = '';
  }, { flush: 'sync' });
  onBeforeUnmount(() => { epoch++; });

  function reset() {
    open.value = false;
    summary.value = '';
    evidence.value = '';
    sourceTurnId.value = '';
    error.value = '';
  }
  function start() {
    if (options.blocked.value || !sources.value.length) return;
    reset();
    notice.value = '';
    sourceTurnId.value = sources.value.at(-1)!.id;
    open.value = true;
  }
  function cancel() {
    if (!saving.value) reset();
  }
  async function save() {
    const session = options.session.value;
    if (!session || session.schemaVersion !== 4 || !canSave.value || saving.value) return;
    const current = epoch;
    let persisted = false;
    saving.value = true;
    error.value = '';
    try {
      await options.client.addPlayObservation(session.id, {
        summary: summary.value.trim(),
        evidence: evidence.value.trim(),
        sourceTurnIds: [sourceTurnId.value],
        baseRevision: session.revision,
      });
      persisted = true;
      if (current !== epoch) return;
      reset();
      notice.value = 'Observation saved as your Play-local note. Bring it to writing to review a proposed change.';
      await options.onSaved();
    } catch (caught) {
      if (current !== epoch) return;
      const detail = caught instanceof Error ? caught.message : String(caught);
      error.value = persisted
        ? `The observation was saved, but the session could not be refreshed: ${detail}`
        : detail;
    } finally {
      if (current === epoch) saving.value = false;
    }
  }
  return {
    open: readonly(open), summary, evidence, sourceTurnId,
    saving: readonly(saving), error: readonly(error), notice: readonly(notice),
    sources, canSave, start, cancel, save,
  };
}
