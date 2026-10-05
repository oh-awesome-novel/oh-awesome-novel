import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { MANUSCRIPT_IMPORT_MAX_BYTES, type ManuscriptImportChapter, type ManuscriptImportMapping, type ManuscriptImportPreview } from '@oh-awesome-novel/client';
import { useWorkspaceApi } from './useWorkspaceApi';

export function useManuscriptImport(workspacePath: () => string, onProposed: (id: string) => void) {
  const api = useWorkspaceApi();
  const sourceName = shallowRef('旧稿.md');
  const text = shallowRef('');
  const chapters = shallowRef<ManuscriptImportChapter[]>([]);
  const mappings = shallowRef<ManuscriptImportMapping[]>([]);
  const preview = shallowRef<ManuscriptImportPreview>();
  const phase = shallowRef<'idle' | 'reading' | 'previewing' | 'proposing'>('idle');
  const error = shallowRef('');
  let sequence = 0;
  const busy = computed(() => phase.value !== 'idle');
  const sourceBytes = computed(() => new TextEncoder().encode(text.value).byteLength);
  const sourceNameError = computed(() => !sourceName.value.trim() || sourceName.value.length > 255 || !/\.md$/iu.test(sourceName.value) || /[\\/\x00-\x1f\x7f]/u.test(sourceName.value)
    ? '请填写以 .md 结尾的文件名，不包含目录。' : '');
  const mappingError = computed(() => mappings.value.some((mapping) => !Number.isInteger(mapping.volume) || mapping.volume < 1 || mapping.volume > 9999
    || !Number.isInteger(mapping.chapter) || mapping.chapter < 1 || mapping.chapter > 9999 || !mapping.title.trim() || mapping.title.length > 200 || /[\x00-\x1f\x7f]/u.test(mapping.title))
    ? '请填写 1–9999 的卷号、章号，以及 1–200 字的标题。' : '');
  const canPreview = computed(() => !busy.value && Boolean(text.value.trim()) && sourceBytes.value <= MANUSCRIPT_IMPORT_MAX_BYTES && !sourceNameError.value && !mappingError.value);

  function invalidate() { ++sequence; preview.value = undefined; error.value = ''; phase.value = 'idle'; }
  function setText(value: string) { invalidate(); text.value = value; chapters.value = []; mappings.value = []; }
  function setSourceName(value: string) { invalidate(); sourceName.value = value; }
  function updateMapping(index: number, patch: Partial<ManuscriptImportMapping>) {
    invalidate();
    mappings.value = mappings.value.map((mapping) => mapping.index === index ? { ...mapping, ...patch, index } : mapping);
  }
  async function readFile(file: File) {
    invalidate(); chapters.value = []; mappings.value = []; text.value = ''; sourceName.value = file.name;
    if (!/\.md$/iu.test(file.name)) { error.value = '请选择 .md 格式的 Markdown 文件。'; return; }
    if (file.size > MANUSCRIPT_IMPORT_MAX_BYTES) { error.value = '单次最多导入 512 KiB，请拆分原稿后分批导入。'; return; }
    const request = sequence; const workspace = workspacePath(); phase.value = 'reading';
    try {
      const bytes = await file.arrayBuffer();
      if (request !== sequence || workspace !== workspacePath()) return;
      if (bytes.byteLength > MANUSCRIPT_IMPORT_MAX_BYTES) throw new Error('单次最多导入 512 KiB，请分批导入。');
      try { text.value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error('文件不是有效的 UTF-8 编码。请另存为 UTF-8 Markdown 后重试。'); }
    } catch (cause) { if (request === sequence) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (request === sequence) phase.value = 'idle'; }
  }
  async function createPreview() {
    if (!canPreview.value) return;
    const request = ++sequence; const workspace = workspacePath();
    phase.value = 'previewing'; error.value = ''; preview.value = undefined;
    try {
      const result = await api.previewManuscriptImport({ sourceName: sourceName.value, text: text.value, expectedWorkspaceRoot: workspace,
        ...(mappings.value.length ? { mappings: mappings.value.map((mapping) => ({ ...mapping })) } : {}) });
      if (request !== sequence || workspace !== workspacePath()) return;
      preview.value = result.preview;
      chapters.value = result.preview.chapters;
      mappings.value = result.preview.chapters.map(({ index, volume, chapter, title }) => ({ index, volume, chapter, title }));
    } catch (cause) { if (request === sequence) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (request === sequence) phase.value = 'idle'; }
  }
  async function propose() {
    const reviewed = preview.value;
    if (busy.value || !reviewed?.canPropose || !reviewed.id || !reviewed.fingerprint) return;
    const request = ++sequence; const workspace = workspacePath(); phase.value = 'proposing'; error.value = '';
    try {
      const result = await api.proposeManuscriptImport(reviewed.id, { fingerprint: reviewed.fingerprint, expectedWorkspaceRoot: workspace });
      if (request !== sequence || workspace !== workspacePath()) return;
      preview.value = undefined;
      onProposed(result.pendingAction.id);
    } catch (cause) {
      if (request !== sequence || workspace !== workspacePath()) return;
      // A response can be lost after promotion persisted. Recover the known
      // action with a read; never replay a mutation or silently create another.
      try {
        const recovered = (await api.readPendingAction(reviewed.id)).pendingAction;
        if (request !== sequence || workspace !== workspacePath()) return;
        const expectedPaths = reviewed.chapters.map((chapter) => chapter.path).sort();
        if (recovered.id === reviewed.id && recovered.status === 'pending'
          && recovered.origin?.kind === 'manuscriptImport' && recovered.origin.previewId === reviewed.id
          && recovered.origin.sourceHash === reviewed.sourceHash && recovered.changes.length === expectedPaths.length
          && recovered.changes.every((change, index) => change.operation === 'create' && change.path === expectedPaths[index])) {
          preview.value = undefined;
          onProposed(recovered.id);
          return;
        }
      } catch { /* Keep the uncertain outcome visible if the read also fails. */ }
      if (request === sequence && workspace === workspacePath()) {
        preview.value = undefined;
        error.value = `${cause instanceof Error ? cause.message : String(cause)} 待审批导入可能已创建，请先检查审阅栏中的待审批列表，避免重复导入。确认未创建后，请重新预览。`;
      }
    } finally { if (request === sequence) phase.value = 'idle'; }
  }
  watch(workspacePath, () => { invalidate(); sourceName.value = '旧稿.md'; text.value = ''; chapters.value = []; mappings.value = []; }, { flush: 'sync' });
  onBeforeUnmount(() => { ++sequence; });
  return { sourceName, text, chapters, mappings, preview, phase, error, busy, sourceBytes, sourceNameError, mappingError, canPreview,
    setText, setSourceName, updateMapping, readFile, createPreview, propose };
}
