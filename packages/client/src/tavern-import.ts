export type TavernImportMode = 'preview' | 'create' | 'merge' | 'playOnly';
export interface TavernImportInput {
  sourceName: string;
  format: 'json' | 'png';
  content: string;
  mode: TavernImportMode;
  characterId?: string;
  expectedWorkspaceRoot: string;
}
export interface TavernImportConfirmation { fingerprint: string; expectedWorkspaceRoot: string }
export interface TavernImportPreview {
  id: string | null;
  fingerprint: string | null;
  sourceName: string;
  sourceHash: string;
  displayName: string;
  characterId: string;
  mode: TavernImportMode;
  files: Array<{ path: string; operation: 'create' | 'update' }>;
  warnings: string[];
  conflicts: string[];
  diff: string;
  canPropose: boolean;
}
export const TAVERN_JSON_MAX_BYTES = 1024 * 1024;
export const TAVERN_PNG_MAX_BYTES = 10 * 1024 * 1024;
const modes = ['preview', 'create', 'merge', 'playOnly'];
const targetNames = ['meta.yaml', 'summary.md', 'personality.md', 'interaction.md', 'lorebook.yaml', 'assets.yaml', 'imports/tavern-card.yaml'];
function invalid(): never { throw new Error('Invalid Tavern character import data.'); }
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(result, key)) || Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return result;
}
function text(value: unknown, max = 4096, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0')) invalid();
  return value;
}
function hash(value: unknown): string { const result = text(value, 64); if (!/^[a-f0-9]{64}$/u.test(result)) invalid(); return result; }
function id(value: unknown): string { const result = text(value, 160); if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(result)) invalid(); return result; }
function sourceName(value: unknown): void { if (/[\\/\x00-\x1f\x7f]/u.test(text(value, 200))) invalid(); }
export function assertTavernImportInput(value: unknown): asserts value is TavernImportInput {
  const input = record(value, ['sourceName', 'format', 'content', 'mode', 'expectedWorkspaceRoot'], ['characterId']);
  sourceName(input.sourceName); text(input.expectedWorkspaceRoot);
  if (!modes.includes(String(input.mode)) || !['json', 'png'].includes(String(input.format))) invalid();
  if (input.characterId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id(input.characterId))) invalid();
  if (input.mode === 'merge' && !input.characterId) invalid();
  const content = text(input.content, input.format === 'png' ? Math.ceil(TAVERN_PNG_MAX_BYTES / 3) * 4 : TAVERN_JSON_MAX_BYTES);
  if (input.format === 'json' && new TextEncoder().encode(content).length > TAVERN_JSON_MAX_BYTES) invalid();
  if (input.format === 'png' && (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(content))) invalid();
}
export function assertTavernImportConfirmation(previewId: unknown, value: unknown): asserts value is TavernImportConfirmation {
  if (!/^(?:pa|tp)_[0-9a-f-]{36}$/u.test(id(previewId))) invalid(); const input = record(value, ['fingerprint', 'expectedWorkspaceRoot']); hash(input.fingerprint); text(input.expectedWorkspaceRoot);
}
export function parseTavernImportPreview(value: unknown): { preview: TavernImportPreview } {
  const envelope = record(value, ['preview']);
  const p = record(envelope.preview, ['id', 'fingerprint', 'sourceName', 'sourceHash', 'displayName', 'characterId', 'mode', 'files', 'warnings', 'conflicts', 'diff', 'canPropose']);
  sourceName(p.sourceName); hash(p.sourceHash); text(p.displayName, 512); const character = id(p.characterId);
  if (character.length > 64) invalid();
  if (!modes.includes(String(p.mode)) || typeof p.canPropose !== 'boolean' || !Array.isArray(p.files) || p.files.length > 32) invalid();
  const paths = new Set<string>();
  for (const file of p.files) {
    const f = record(file, ['path', 'operation']); const path = text(f.path, 512);
    if (!['create', 'update'].includes(String(f.operation)) || !targetNames.some((name) => path === `characters/${character}/${name}`) || paths.has(path) || (p.mode === 'create' && f.operation !== 'create')) invalid();
    paths.add(path);
  }
  for (const list of [p.warnings, p.conflicts]) { if (!Array.isArray(list) || list.length > 256) invalid(); list.forEach((item) => text(item)); }
  text(p.diff, 4 * 1024 * 1024, true);
  if ((p.id === null) !== (p.fingerprint === null)) invalid();
  if (p.id !== null) { if (!(p.mode === 'playOnly' ? /^tp_[0-9a-f-]{36}$/u : /^pa_[0-9a-f-]{36}$/u).test(id(p.id))) invalid(); hash(p.fingerprint); }
  if (p.mode === 'preview' && (p.id !== null || p.canPropose)) invalid();
  if (p.mode === 'playOnly' && p.files.length) invalid();
  if (p.canPropose && (!p.id || !['create', 'merge', 'playOnly'].includes(String(p.mode)))) invalid();
  return { preview: p as unknown as TavernImportPreview };
}
