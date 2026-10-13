import { computed, shallowRef, watch } from 'vue';
import { TAVERN_JSON_MAX_BYTES, TAVERN_PNG_MAX_BYTES } from '@oh-awesome-novel/client';
import type { PlaySession, TavernImportMode, TavernImportPreview, PendingActionViewV1 } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from './useWorkspaceApi';

export function useTavernImport(options: {
  workspaceRoot: string;
  onPendingActionCreated(): void;
  onSessionCreated(session: PlaySession): void;
}) {
  const api = useWorkspaceApi();
  const mode = shallowRef<TavernImportMode>('playOnly');
  const characterId = shallowRef('');
  const source = shallowRef<{ sourceName: string; format: 'json' | 'png'; content: string }>();
  const preview = shallowRef<TavernImportPreview>();
  const pendingAction = shallowRef<PendingActionViewV1>();
  const busy = shallowRef(false);
  const error = shallowRef('');
  let generation = 0;
  const canPreview = computed(() => Boolean(source.value) && (mode.value !== 'merge' || Boolean(characterId.value.trim())) && !busy.value);
  watch([mode, characterId], invalidate, { flush: 'sync' });
  function invalidate() { generation++; preview.value = undefined; pendingAction.value = undefined; error.value = ''; }
  async function selectFile(file?: File): Promise<void> {
    invalidate(); source.value = undefined;
    if (!file) return;
    const current = generation;
    busy.value = true;
    try {
      const format = /\.png$/iu.test(file.name) ? 'png' : /\.json$/iu.test(file.name) ? 'json' : undefined;
      if (!format) throw new Error('Choose a local JSON or PNG character card.');
      const limit = format === 'png' ? TAVERN_PNG_MAX_BYTES : TAVERN_JSON_MAX_BYTES;
      if (!file.size || file.size > limit) throw new Error(`The selected ${format.toUpperCase()} file must be smaller than ${limit / 1024 / 1024} MiB.`);
      const content = await readFile(file, format);
      if (current === generation) source.value = { sourceName: file.name, format, content };
    } catch (caught) { if (current === generation) error.value = message(caught); }
    finally { busy.value = false; }
  }
  async function requestPreview(): Promise<void> {
    if (!source.value || !canPreview.value) return;
    const current = ++generation; busy.value = true; error.value = ''; preview.value = undefined; pendingAction.value = undefined;
    try {
      const result = await api.previewTavernImport({ ...source.value, mode: mode.value, expectedWorkspaceRoot: options.workspaceRoot,
        ...(characterId.value.trim() ? { characterId: characterId.value.trim() } : {}) });
      if (current === generation) preview.value = result.preview;
    } catch (caught) { if (current === generation) error.value = message(caught); }
    finally { busy.value = false; }
  }
  async function confirm(): Promise<void> {
    const reviewed = preview.value;
    if (!reviewed?.id || !reviewed.fingerprint || busy.value || pendingAction.value) return;
    if (!reviewed.canPropose && reviewed.mode !== 'playOnly') return;
    busy.value = true; error.value = '';
    try {
      const input = { fingerprint: reviewed.fingerprint, expectedWorkspaceRoot: options.workspaceRoot };
      if (reviewed.mode === 'playOnly') {
        options.onSessionCreated((await api.createTavernPlaySession(reviewed.id, input)).session);
      } else {
        pendingAction.value = (await api.proposeTavernImport(reviewed.id, input)).pendingAction;
        options.onPendingActionCreated();
      }
    } catch (caught) { error.value = message(caught); }
    finally { busy.value = false; }
  }
  return { mode, characterId, source, preview, pendingAction, busy, error, canPreview, selectFile, requestPreview, confirm };
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function readFile(file: File, format: 'json' | 'png'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      try {
        if (format === 'json' && reader.result instanceof ArrayBuffer) {
          resolve(new TextDecoder('utf-8', { fatal: true }).decode(reader.result));
        } else if (format === 'png' && typeof reader.result === 'string') {
          resolve(reader.result.slice(reader.result.indexOf(',') + 1));
        } else reject(new Error('Invalid file content.'));
      } catch { reject(new Error('The JSON card must contain valid UTF-8 text.')); }
    };
    if (format === 'png') reader.readAsDataURL(file); else reader.readAsArrayBuffer(file);
  });
}
