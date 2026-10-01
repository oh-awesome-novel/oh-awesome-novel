import { parseDocument } from 'yaml';

import type { CandidateFileSnapshot } from './candidate-change-set';
import { normalizeWorkspaceRelativePath } from './candidate-change-set';
import type { WorkspaceProjectionPathRule } from './workspace-projection';

/** Host-only closure needed to check both forward references and deleted targets. */
export const NOVEL_REFERENCE_PROJECTION_RULES: readonly WorkspaceProjectionPathRule[] = Object.freeze(
  ['chapters', 'characters', 'world', 'state', 'timeline', 'foreshadow']
    .map((path) => Object.freeze({ kind: 'prefix' as const, path })),
);

type Namespace = 'character' | 'chapter' | 'world' | 'event' | 'arc' | 'foreshadow';
interface TreeChange {
  path: string;
  operation: 'create' | 'update' | 'delete';
  content?: string;
}
interface StructuredDocument {
  path: string;
  value: Record<string, unknown>;
}

const EXPLICIT_REFERENCES: Record<string, Namespace> = {
  characterRef: 'character', characterRefs: 'character',
  chapterRef: 'chapter', chapterRefs: 'chapter',
  worldRef: 'world', worldRefs: 'world',
  locationRef: 'world', locationRefs: 'world',
  eventRef: 'event', eventRefs: 'event',
  arcRef: 'arc', arcRefs: 'arc',
  foreshadowRef: 'foreshadow', foreshadowRefs: 'foreshadow',
};
const DOMAIN_REFERENCES: Record<string, Namespace> = {
  characterId: 'character', characterIds: 'character', relatedCharacters: 'character',
  chapter: 'chapter', chapterId: 'chapter', firstChapter: 'chapter', resolvedChapter: 'chapter',
  worldId: 'world', locationId: 'world', eventId: 'event', arcId: 'arc', foreshadowId: 'foreshadow',
};
const ARRAY_REFERENCE_FIELDS = new Set([
  'characterRefs', 'chapterRefs', 'worldRefs', 'locationRefs', 'eventRefs', 'arcRefs',
  'foreshadowRefs', 'characterIds', 'relatedCharacters', 'characters', 'locations',
]);

export function isNovelReferencePath(path: string): boolean {
  return /^(?:chapters|characters|world|state|timeline|foreshadow)\//u.test(path);
}

/**
 * Checks the complete final reference graph, including unchanged referencers.
 * The host must supply all six canonical roots from a safe, bounded snapshot.
 * Single-document schema validation remains the candidate validator's job.
 */
export function validateFinalObjectTreeReferences(input: {
  baselineFiles: readonly CandidateFileSnapshot[];
  changes: readonly TreeChange[];
}): void {
  if (!input.changes.some((change) => isNovelReferencePath(change.path))) return;
  const files = new Map<string, string>();
  for (const file of input.baselineFiles) {
    const path = normalizeWorkspaceRelativePath(file.path);
    if (files.has(path)) throw new Error(`Duplicate final object tree path: ${path}.`);
    files.set(path, file.content);
  }
  for (const change of input.changes) {
    const path = normalizeWorkspaceRelativePath(change.path);
    if (change.operation === 'delete') files.delete(path);
    else {
      if (change.content === undefined) throw new Error(`Missing final object content: ${path}.`);
      files.set(path, change.content);
    }
  }

  const ids: Record<Namespace, Map<string, string>> = {
    character: new Map(), chapter: new Map(), world: new Map(),
    event: new Map(), arc: new Map(), foreshadow: new Map(),
  };
  const documents: StructuredDocument[] = [];
  const register = (namespace: Namespace, id: string, path: string, shared = false): void => {
    const previous = ids[namespace].get(id);
    if (!shared && previous !== undefined && previous !== path) {
      throw new Error(`Duplicate ${namespace} id ${id} in ${previous} and ${path}.`);
    }
    ids[namespace].set(id, path);
  };
  for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isNovelReferencePath(path)) continue;
    const chapter = /^chapters\/(\d{4})\/(\d{4})\.md$/u.exec(path);
    const character = /^characters\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/.+\.(?:md|yaml)$/u.exec(path);
    const world = /^world\/(.+)\.(?:md|yaml)$/u.exec(path);
    if (chapter && chapter[2] !== '0000') register('chapter', `${chapter[1]}/${chapter[2]}`, path);
    if (character) register('character', character[1]!, path, true);
    if (world) register('world', world[1]!, path);
    const value = structuredValue(path, content);
    if (!value) continue;
    documents.push({ path, value });
    if (path.startsWith('timeline/')) {
      for (const key of ['events', 'arcs', 'timeline']) {
        const collection = value[key];
        if (!Array.isArray(collection)) continue;
        for (const item of collection) {
          if (isRecord(item) && typeof item.id === 'string') {
            register(key === 'arcs' ? 'arc' : 'event', item.id, path);
          }
        }
      }
    }
    if (path.startsWith('foreshadow/')) {
      for (const key of ['foreshadow', 'active', 'resolved', 'entries']) {
        const collection = value[key];
        if (!Array.isArray(collection)) continue;
        for (const item of collection) {
          if (isRecord(item) && typeof item.id === 'string') register('foreshadow', item.id, path);
        }
      }
    }
  }

  const reference = (namespace: Namespace, value: unknown, field: string, path: string): void => {
    if (typeof value !== 'string' || !ids[namespace].has(value)) {
      throw new Error(`Document contains unknown ${namespace} reference ${field}=${String(value)}: ${path}.`);
    }
  };
  for (const { path, value } of documents) {
    const domain = /^(?:state|timeline|foreshadow)\//u.test(path);
    const visit = (current: unknown): void => {
      if (Array.isArray(current)) { current.forEach(visit); return; }
      if (!isRecord(current)) return;
      for (const [field, child] of Object.entries(current)) {
        const namespace = Object.hasOwn(EXPLICIT_REFERENCES, field)
          ? EXPLICIT_REFERENCES[field]
          : domain && Object.hasOwn(DOMAIN_REFERENCES, field) ? DOMAIN_REFERENCES[field] : undefined;
        if (namespace) {
          if (ARRAY_REFERENCE_FIELDS.has(field)) {
            if (!Array.isArray(child)) throw new Error(`Reference field ${field} must be an array: ${path}.`);
            child.forEach((entry) => reference(namespace, entry, field, path));
          } else reference(namespace, child, field, path);
        }
        visit(child);
      }
    };
    visit(value);
    // These domain-specific names are references only in their documented location.
    if (path.startsWith('chapters/')) {
      for (const [field, namespace] of [['characters', 'character'], ['locations', 'world']] as const) {
        const entries = value[field];
        if (entries === undefined) continue;
        if (!Array.isArray(entries)) throw new Error(`Reference field ${field} must be an array: ${path}.`);
        entries.forEach((entry) => reference(namespace, entry, field, path));
      }
    }
    if (path.startsWith('characters/') && value.firstAppearance !== undefined) {
      reference('chapter', value.firstAppearance, 'firstAppearance', path);
    }
    if (path.startsWith('world/') && value.parentId !== undefined) {
      reference('world', value.parentId, 'parentId', path);
    }
    if (path.startsWith('state/') && isRecord(value.characters)) {
      for (const id of Object.keys(value.characters)) reference('character', id, 'characters key', path);
    }
  }
}

function structuredValue(path: string, content: string): Record<string, unknown> | undefined {
  let yaml: string;
  if (path.endsWith('.yaml')) yaml = content;
  else if (path.endsWith('.md')) {
    const lines = content.replace(/\r\n/gu, '\n').split('\n');
    if (lines[0] !== '---') return undefined;
    const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
    if (end < 0) throw new Error(`Unterminated reference frontmatter: ${path}.`);
    yaml = lines.slice(1, end).join('\n');
  } else return undefined;
  const document = parseDocument(yaml, { uniqueKeys: true, prettyErrors: false });
  if (document.errors.length) throw new Error(`Cannot inspect final object references in ${path}: ${document.errors[0]!.message}`);
  const value: unknown = document.toJS({ maxAliasCount: 100 });
  if (!isRecord(value)) throw new Error(`Reference document must be a mapping: ${path}.`);
  // Alias expansion, nesting and traversal must stay bounded even for unchanged files.
  let nodes = 0;
  const inspect = (item: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 32) throw new Error(`Reference document is too complex: ${path}.`);
    if (Array.isArray(item)) item.forEach((child) => inspect(child, depth + 1));
    else if (isRecord(item)) Object.values(item).forEach((child) => inspect(child, depth + 1));
  };
  inspect(value, 0);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
