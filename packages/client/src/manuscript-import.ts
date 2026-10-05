export interface ManuscriptImportMapping {
  index: number;
  volume: number;
  chapter: number;
  title: string;
}

export interface ManuscriptImportInput {
  sourceName: string;
  text: string;
  expectedWorkspaceRoot: string;
  mappings?: ManuscriptImportMapping[];
}

export interface ManuscriptImportChapter extends ManuscriptImportMapping {
  path: string;
  sourceStartLine: number;
  sourceEndLine: number;
  sourceBytes: number;
}

export interface ManuscriptImportPreview {
  id: string | null;
  fingerprint: string | null;
  sourceName: string;
  sourceHash: string;
  sourceBytes: number;
  chapters: ManuscriptImportChapter[];
  conflicts: Array<{ index: number; path: string; reason: 'exists' | 'duplicate' }>;
  warnings: string[];
  canPropose: boolean;
  diff: string;
}

export interface ManuscriptImportPreviewResult { preview: ManuscriptImportPreview }
export interface ManuscriptImportProposalInput { fingerprint: string; expectedWorkspaceRoot: string }
export const MANUSCRIPT_IMPORT_MAX_BYTES = 512 * 1024;

function invalid(): never { throw new Error('Invalid manuscript import data.'); }
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(result, key))
    || Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return result;
}
function string(value: unknown, max: number, nonempty = true): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) return invalid();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return invalid();
  return Number(value);
}
function hash(value: unknown): string {
  const result = string(value, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) invalid();
  return result;
}
function sourceName(value: unknown): string {
  const result = string(value, 255);
  if (!/\.md$/iu.test(result) || /[\\/\x00-\x1f\x7f]/u.test(result)) invalid();
  return result;
}
function mapping(value: Record<string, unknown>, expectedIndex: number): ManuscriptImportMapping {
  const index = integer(value.index, 0, 63);
  const volume = integer(value.volume, 1, 9999);
  const chapter = integer(value.chapter, 1, 9999);
  const title = string(value.title, 200);
  if (index !== expectedIndex || /[\x00-\x1f\x7f]/u.test(title)) invalid();
  return { index, volume, chapter, title };
}
export function assertManuscriptImportInput(value: unknown): asserts value is ManuscriptImportInput {
  const input = record(value, ['sourceName', 'text', 'expectedWorkspaceRoot'], ['mappings']);
  sourceName(input.sourceName);
  const content = string(input.text, MANUSCRIPT_IMPORT_MAX_BYTES);
  const bytes = new TextEncoder().encode(content);
  if (content.includes('\0') || bytes.byteLength > MANUSCRIPT_IMPORT_MAX_BYTES
    || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== content) invalid();
  string(input.expectedWorkspaceRoot, 4096);
  if (Object.hasOwn(input, 'mappings')) {
    if (!Array.isArray(input.mappings) || !input.mappings.length || input.mappings.length > 64) invalid();
    (input.mappings as unknown[]).forEach((item, index) => mapping(record(item, ['index', 'volume', 'chapter', 'title']), index));
  }
}
export function assertManuscriptImportProposal(id: unknown, value: unknown): asserts value is ManuscriptImportProposalInput {
  if (!/^pa_[0-9a-f-]{36}$/u.test(string(id, 160))) invalid();
  const input = record(value, ['fingerprint', 'expectedWorkspaceRoot']);
  hash(input.fingerprint); string(input.expectedWorkspaceRoot, 4096);
}
export function parseManuscriptImportPreviewResult(value: unknown): ManuscriptImportPreviewResult {
  const envelope = record(value, ['preview']);
  const preview = record(envelope.preview, ['id', 'fingerprint', 'sourceName', 'sourceHash', 'sourceBytes', 'chapters', 'conflicts', 'warnings', 'canPropose', 'diff']);
  sourceName(preview.sourceName); hash(preview.sourceHash);
  const bytes = integer(preview.sourceBytes, 1, MANUSCRIPT_IMPORT_MAX_BYTES);
  if (!Array.isArray(preview.chapters) || !preview.chapters.length || preview.chapters.length > 64
    || !Array.isArray(preview.conflicts) || preview.conflicts.length > 128
    || !Array.isArray(preview.warnings) || preview.warnings.length > 128
    || typeof preview.canPropose !== 'boolean') invalid();
  let previousLine = 0;
  let chapterBytes = 0;
  const chapters = (preview.chapters as unknown[]).map((item, index) => {
    const chapter = record(item, ['index', 'volume', 'chapter', 'title', 'path', 'sourceStartLine', 'sourceEndLine', 'sourceBytes']);
    const mapped = mapping(chapter, index);
    const target = `chapters/${String(mapped.volume).padStart(4, '0')}/${String(mapped.chapter).padStart(4, '0')}.md`;
    if (chapter.path !== target) invalid();
    const start = integer(chapter.sourceStartLine, 1, MANUSCRIPT_IMPORT_MAX_BYTES + 1);
    const end = integer(chapter.sourceEndLine, start, MANUSCRIPT_IMPORT_MAX_BYTES + 1);
    if (start !== previousLine + 1) invalid();
    previousLine = end;
    chapterBytes += integer(chapter.sourceBytes, 1, bytes);
    return chapter;
  });
  if (chapterBytes !== bytes) invalid();
  const seenConflicts = new Set<string>();
  for (const item of preview.conflicts as unknown[]) {
    const conflict = record(item, ['index', 'path', 'reason']);
    const index = integer(conflict.index, 0, chapters.length - 1);
    if (conflict.path !== chapters[index]?.path || !['exists', 'duplicate'].includes(String(conflict.reason))) invalid();
    const key = `${index}:${conflict.reason}`;
    if (seenConflicts.has(key)) invalid();
    seenConflicts.add(key);
  }
  for (const item of preview.warnings as unknown[]) string(item, 4096);
  string(preview.diff, 4 * 1024 * 1024, false);
  if (preview.canPropose) {
    if ((preview.conflicts as unknown[]).length || !/^pa_[0-9a-f-]{36}$/u.test(string(preview.id, 160))) invalid();
    hash(preview.fingerprint);
    const paths = chapters.map((chapter) => chapter.path);
    if (new Set(paths).size !== paths.length) invalid();
  } else if (preview.id !== null || preview.fingerprint !== null || !(preview.conflicts as unknown[]).length) invalid();
  return value as ManuscriptImportPreviewResult;
}
