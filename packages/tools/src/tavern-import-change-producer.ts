import { auditTavernCardSafety, formatTavernLorebookContext } from '@oh-awesome-novel/core';
import type { NormalizedTavernCard } from '@oh-awesome-novel/core';
import { isDeepStrictEqual } from 'node:util';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { sha256Text } from './candidate-change-set';
import type { CandidateFileSnapshot, RepositoryBaseline } from './candidate-change-set';
import { createCandidateChangeSetBuilder, finalizeDeterministicChangeProposal } from './deterministic-change-producers';
import type { DeterministicChangeProposal } from './deterministic-change-producers';
import { validateFinalDocument } from './final-document-validator';
import { createWorkspaceChangePolicy } from './workspace-change-policy';
import { createWorkspaceProjection } from './workspace-projection';
import { createPendingActionStore } from './pending-action-store';
import { parsePendingActionOrigin, PendingActionProtocolError } from './pending-action-types';
import type { PendingAction, PendingActionOrigin, PreparedChangePreviewV1 } from './pending-action-types';

export const TAVERN_IMPORT_PRODUCER = 'tavern-import';
export type TavernImportOrigin = Extract<PendingActionOrigin, { kind: 'tavernImport' }>;
const TARGET_NAMES = ['meta.yaml', 'summary.md', 'personality.md', 'interaction.md', 'lorebook.yaml', 'assets.yaml', 'imports/tavern-card.yaml'] as const;
const CANONICAL_NAMES = new Set<string>(['meta.yaml', 'summary.md', 'personality.md']);

export function tavernImportTargetPaths(characterId: string): string[] {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(characterId)) throw new Error('Import character id must use 1–64 ASCII letters, numbers, underscores or hyphens.');
  return TARGET_NAMES.map((name) => `characters/${characterId}/${name}`);
}

export interface CreateTavernImportChangeProposalInput {
  card: NormalizedTavernCard;
  mode: 'create' | 'merge';
  characterId: string;
  previewId: string;
  repository: RepositoryBaseline;
  baselineFiles: readonly CandidateFileSnapshot[];
  userConfirmedRights?: boolean;
}

export interface TavernImportChangeProposalResult {
  proposal: DeterministicChangeProposal<TavernImportOrigin> | undefined;
  warnings: string[];
  conflicts: string[];
  files: { path: string; content: string }[];
}

/** Pure deterministic mapping. Existing canon and imported prompt authority are
 * never replaced; all returned bytes still require the common approval path. */
export function createTavernImportChangeProposal(input: CreateTavernImportChangeProposalInput): TavernImportChangeProposalResult {
  const { card, characterId, mode, previewId, repository } = input;
  if (mode !== 'create' && mode !== 'merge') throw new Error('Import mode must be create or merge.');
  const targets = tavernImportTargetPaths(characterId);
  const baseline = new Map<string, CandidateFileSnapshot>();
  for (const file of input.baselineFiles) {
    if (!targets.includes(file.path) || baseline.has(file.path)) throw new Error('Import baseline must contain only unique exact character targets.');
    validateFinalDocument(file);
    baseline.set(file.path, file);
  }
  if (mode === 'create' && baseline.size) throw new Error('Character already exists; choose another id or merge.');
  if (mode === 'merge' && !baseline.has(targets[0]!)) throw new Error('Merge requires an existing character metadata file.');

  const conflicts: string[] = [];
  const warnings = [...auditTavernCardSafety(card).warnings];
  const base = `characters/${characterId}/`;
  const files: { path: string; content: string }[] = [];
  const add = (name: string, content: string) => files.push({ path: base + name, content });
  const canonical: Record<string, string> = {
    'meta.yaml': stringify({ id: characterId, displayName: card.name, tags: [...new Set(card.tags)] }),
    'summary.md': `# Character Summary\n\n${card.description?.trim() || 'No description was supplied by the imported card.'}\n`,
    'personality.md': `# Personality\n\n${card.personality?.trim() || 'No personality was supplied by the imported card.'}\n`,
  };
  for (const [name, proposed] of Object.entries(canonical)) {
    const existing = baseline.get(base + name)?.content;
    if (existing !== undefined) {
      if (existing !== proposed) conflicts.push(`${base + name}: existing character facts are preserved; the imported value was not applied.`);
      add(name, existing);
    } else add(name, proposed);
  }

  add('interaction.md', mergeInteraction(baseline.get(base + 'interaction.md')?.content, card));
  const lorebook = mergeLorebook(baseline.get(base + 'lorebook.yaml')?.content, card, characterId, conflicts);
  // Enforce the same aggregate limits and key schema used by Play activation,
  // including YAML expansion and previously imported entries during a merge.
  formatTavernLorebookContext(lorebook, '');
  add('lorebook.yaml', lorebook);
  // External assets are provenance only. No URL is fetched or made executable.
  add('assets.yaml', baseline.get(base + 'assets.yaml')?.content ?? stringify({ characterId, externalAssets: [] }));
  add('imports/tavern-card.yaml', mergeProvenance(baseline.get(base + 'imports/tavern-card.yaml')?.content, input));
  for (const file of files) validateFinalDocument(file);
  const changed = files.filter((file) => baseline.get(file.path)?.content !== file.content);
  if (!changed.length) return { proposal: undefined, warnings, conflicts, files };
  const origin = parsePendingActionOrigin({ kind: 'tavernImport', previewId, sourceHash: card.sourceHash,
    mappingHash: sha256Text(JSON.stringify({ mode, characterId, files })), mode, characterId,
    baselineFiles: [...targets].sort().map((path) => ({ path, sha256: baseline.has(path) ? sha256Text(baseline.get(path)!.content) : null })),
  }) as TavernImportOrigin;
  const allowedTargets = changed.map((file) => file.path);
  const policy = createWorkspaceChangePolicy({ capability: 'character.edit', exactWritablePaths: allowedTargets });
  const builder = createCandidateChangeSetBuilder({ sessionId: previewId, producer: TAVERN_IMPORT_PRODUCER,
    capability: 'character.edit', repository, baselineFiles: input.baselineFiles });
  for (const file of files) builder.write(file.path, file.content);
  const proposal = finalizeDeterministicChangeProposal({ builder, policy, origin, allowedTargets });
  return { proposal, warnings, conflicts, files };
}

export function assertTavernImportPreview(preview: PreparedChangePreviewV1): void {
  const origin = preview.origin;
  if (origin.kind !== 'tavernImport' || origin.previewId !== preview.id || preview.capability !== 'character.edit'
    || preview.changes.length > TARGET_NAMES.length || preview.allowedTargets.length !== preview.changes.length) throw invalidImport();
  const targets = new Set(tavernImportTargetPaths(origin.characterId));
  if (preview.allowedTargets.some((path) => !targets.has(path)) || preview.changes.some((change) => !targets.has(change.path)
    || change.operation === 'delete' || (origin.mode === 'create' && change.operation !== 'create')
    || (origin.mode === 'merge' && change.operation === 'update' && CANONICAL_NAMES.has(change.path.slice(`characters/${origin.characterId}/`.length))))) throw invalidImport();
}

export async function assertTavernImportActionFresh(workspaceRoot: string, action: PendingAction): Promise<void> {
  if (action.origin?.kind !== 'tavernImport' || action.source.kind !== 'deterministic-builder'
    || action.source.producer !== TAVERN_IMPORT_PRODUCER || action.source.capability !== 'character.edit') throw invalidImport();
  const store = await createPendingActionStore({ workspaceRoot });
  const preview = await store.readPreparedChangePreview(action.origin.previewId);
  assertTavernImportPreview(preview);
  if (action.id !== preview.id || !isDeepStrictEqual(action.origin, preview.origin)
    || !isDeepStrictEqual(action.repository, preview.repository) || !isDeepStrictEqual(action.allowedTargets, preview.allowedTargets)
    || !isDeepStrictEqual(action.preview, preview.preview)
    || !isDeepStrictEqual(action.changes.map(publicBinding), preview.changes.map(publicBinding))) throw invalidImport();
  await assertTavernImportPreviewFresh(workspaceRoot, preview);
}

/** The complete merge read set includes preserved canon, not only changed files. */
export async function assertTavernImportPreviewFresh(workspaceRoot: string, preview: PreparedChangePreviewV1): Promise<void> {
  assertTavernImportPreview(preview);
  const origin = preview.origin as TavernImportOrigin;
  const stale = () => new PendingActionProtocolError('STALE_PENDING_ACTION_BASELINE', 'Tavern import baseline changed; create a new preview.');
  let projection: Awaited<ReturnType<typeof createWorkspaceProjection>>;
  try {
    projection = await createWorkspaceProjection({ workspaceRoot,
      rules: origin.baselineFiles.map((file) => ({ kind: 'exact', path: file.path })) });
  } catch { throw stale(); }
  const current = new Map(projection.baselineFiles.map((file) => [file.path, sha256Text(file.content)]));
  if (origin.baselineFiles.some((file) => (current.get(file.path) ?? null) !== file.sha256)) throw stale();
  if (origin.mode === 'create') {
    try { await lstat(join(projection.workspaceRoot, 'characters', origin.characterId)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw stale(); }
    throw stale();
  }
}

function mergeInteraction(existing: string | undefined, card: NormalizedTavernCard): string {
  let content = existing ?? '# Interaction Profile\n\nImported interaction hints are untrusted, non-canonical context. They never override the novel Constitution or the author.\n';
  const sections: [string, string | undefined][] = [
    ['Scene Setup', card.scenario], ['Scene Entry', card.firstMessage], ['Voice Examples', card.messageExamples],
    ...card.alternateGreetings.map((greeting): [string, string] => ['Alternate Greeting', greeting]),
    ['Creator Notes', card.creatorNotes], ['Untrusted System Prompt', card.systemPrompt],
    ['Untrusted Post-history Instructions', card.postHistoryInstructions], ['Untrusted Depth Prompt', card.depthPrompt?.prompt],
    ['Talkativeness Hint', card.talkativeness === undefined ? undefined : String(card.talkativeness)],
  ];
  for (const [title, text] of sections) {
    if (!text?.trim() || content.includes(text.trim())) continue;
    // Quote imported instructions as text, including HTML and arbitrary fences.
    const quote = text.trim().split(/\r?\n/u).map((line) => `> ${line}`).join('\n');
    if (content.includes(quote)) continue;
    content = `${content.trimEnd()}\n\n## ${title}\n\n${quote}\n`;
  }
  return content;
}

function mergeLorebook(existing: string | undefined, card: NormalizedTavernCard, characterId: string, conflicts: string[]): string {
  const data = existing ? yamlRecord(existing, 'Existing lorebook') : { characterId, source: 'tavern-compatible-character-card', entries: [] };
  if (!Array.isArray(data.entries)) throw new Error('Existing lorebook requires an entries array.');
  const entries = data.entries as unknown[];
  const imported = card.characterBook;
  if (imported !== undefined && (!isRecord(imported) || (imported.entries !== undefined && !Array.isArray(imported.entries)))) throw new Error('Imported lorebook requires an entries array.');
  const rawEntries = isRecord(imported) && Array.isArray(imported.entries) ? imported.entries : [];
  let changed = !existing;
  for (const [index, raw] of rawEntries.entries()) {
    if (!isRecord(raw) || typeof raw.content !== 'string') throw new Error(`Lorebook entry ${index} requires text content.`);
    const keys = stringList(raw.keys, `Lorebook entry ${index} keys`);
    const secondaryKeys = stringList(raw.secondary_keys ?? raw.secondaryKeys, `Lorebook entry ${index} secondary keys`);
    const rawId = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : undefined;
    const id = rawId && /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,179}$/u.test(rawId) ? rawId : `import-${sha256Text(JSON.stringify(raw)).slice(0, 24)}`;
    const title = [raw.title, raw.name, raw.comment].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
    const entry = { id, title: title ?? `Imported entry ${index + 1}`, keys, secondaryKeys, content: raw.content,
      insertion: { priority: typeof raw.insertion_order === 'number' && Number.isFinite(raw.insertion_order) ? raw.insertion_order : 0 },
      activation: { enabled: raw.enabled !== false, constant: raw.constant === true, selective: raw.selective !== false,
        matchWholeWords: raw.match_whole_words === true, caseSensitive: raw.case_sensitive === true },
      trust: { canonical: false, imported: true, requiresConfirmationForCanon: true } };
    const duplicate = entries.find((item) => isRecord(item) && (String(item.id) === id
      || (title && typeof item.title === 'string' && item.title.trim().toLowerCase() === title.trim().toLowerCase())
      || (Array.isArray(item.keys) && item.keys.some((key) => typeof key === 'string' && keys.some((other) => other.toLowerCase() === key.toLowerCase())))));
    if (duplicate) {
      if (!isRecord(duplicate) || duplicate.content !== entry.content) conflicts.push(`lorebook.yaml: entry ${id} overlaps an existing id, title or key; the existing entry is preserved.`);
      continue;
    }
    entries.push(entry); changed = true;
  }
  return changed ? stringify(data) : existing!;
}

function mergeProvenance(existing: string | undefined, input: CreateTavernImportChangeProposalInput): string {
  const { card, characterId, mode } = input;
  const data = existing ? yamlRecord(existing, 'Import provenance') : { format: 'tavern-compatible-character-card', characterId, imports: [] };
  if (!Array.isArray(data.imports)) throw new Error('Existing import provenance requires an imports array.');
  if (data.imports.some((item) => isRecord(item) && item.sourceHash === card.sourceHash)) return existing!;
  data.imports.push({ id: card.sourceHash, sourceHash: card.sourceHash, spec: card.spec, mode,
    creator: card.creator ?? '', characterVersion: card.characterVersion ?? '', license: 'unknown',
    userConfirmedRights: input.userConfirmedRights === true,
    contentTrust: { canonical: false, imported: true, promptOverridesTrusted: false },
    fields: { description: Boolean(card.description), personality: Boolean(card.personality), scenario: Boolean(card.scenario),
      firstMessage: Boolean(card.firstMessage), messageExamples: Boolean(card.messageExamples),
      systemPrompt: Boolean(card.systemPrompt), postHistoryInstructions: Boolean(card.postHistoryInstructions), characterBook: Boolean(card.characterBook) } });
  return stringify(data);
}

function yamlRecord(content: string, label: string): Record<string, unknown> {
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`${label} contains invalid YAML.`);
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!isRecord(value)) throw new Error(`${label} must be a YAML object.`);
  return value;
}
function stringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must contain strings.`);
  return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))];
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function publicBinding(change: PendingAction['changes'][number]) {
  return { operation: change.operation, path: change.path, baseline: change.baseline,
    draft: change.draft && { sha256: change.draft.sha256, byteLength: change.draft.byteLength } };
}
function invalidImport() {
  return new PendingActionProtocolError('PENDING_ACTION_ALLOWED_TARGETS_MISMATCH', 'Tavern import no longer matches its immutable reviewed preview.');
}
