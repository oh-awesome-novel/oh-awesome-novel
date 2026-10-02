import { createHash } from 'node:crypto';
import { isMap, parseDocument } from 'yaml';
import type { ChapterSettlementDomainChange, ChapterSettlementObservation, ChapterSettlementObservationLog } from '@oh-awesome-novel/core';
import type { CandidateFileSnapshot } from './candidate-change-set';
import { validateFinalDocument } from './final-document-validator';

export const SETTLEMENT_DOMAIN_PATHS = ['state/characters.yaml', 'timeline/events.yaml', 'foreshadow/active.yaml', 'foreshadow/resolved.yaml'] as const;
type RecordValue = Record<string, unknown>;
class MergeConflict extends Error {}

/** Compiles typed evidence into a fixed in-memory object tree, without filesystem I/O. */
export function compileChapterSettlementDomains(log: ChapterSettlementObservationLog, baselines: readonly CandidateFileSnapshot[]) {
  let files = new Map(baselines.map((file) => [file.path, file.content]));
  const readPaths = new Set<string>(SETTLEMENT_DOMAIN_PATHS);
  const conflicts: string[] = [];
  const excluded = new Set(log.unresolvedObservationIds ?? []);
  const byObservation = new Map<string, ChapterSettlementDomainChange[]>();
  for (const change of log.domainChanges ?? []) {
    byObservation.set(change.observationId, [...(byObservation.get(change.observationId) ?? []), change]);
  }
  for (const observation of log.observations) {
    if (observation.confidence !== 'high' || excluded.has(observation.id)) continue;
    const draft = new Map(files);
    try {
      for (const change of byObservation.get(observation.id) ?? []) {
        applyChange(draft, readPaths, log, observation, change);
      }
      files = draft;
    } catch (error) {
      if (!(error instanceof MergeConflict)) throw error;
      excluded.add(observation.id);
      conflicts.push(`[${observation.id}] ${error.message}`);
    }
  }
  return { files, readPaths, conflicts, excluded };
}

function applyChange(files: Map<string, string>, readPaths: Set<string>, log: ChapterSettlementObservationLog,
  observation: ChapterSettlementObservation, change: ChapterSettlementDomainChange): void {
  const requireCharacter = (characterId: string, matchSubject = false) => {
    const paths = [...files.keys()].filter((path) => path.startsWith(`characters/${characterId}/`) && /\.(?:md|yaml)$/u.test(path));
    paths.forEach((path) => readPaths.add(path));
    if (!paths.length) throw new MergeConflict(`Unknown character ${characterId}; select an existing character identity.`);
    if (matchSubject) {
      if (observation.subject === characterId) return;
      const identities = new Set([characterId]);
      const meta = files.get(`characters/${characterId}/meta.yaml`);
      if (meta !== undefined) {
        try {
          validateFinalDocument({ path: `characters/${characterId}/meta.yaml`, content: meta });
          const value = record(parseDocument(meta).toJS({ maxAliasCount: 100 }));
          for (const name of [value.name, value.displayName, ...(Array.isArray(value.aliases) ? value.aliases : [])]) {
            if (typeof name === 'string') identities.add(name);
          }
        } catch { throw new MergeConflict(`Character ${characterId} metadata is not a valid identity source.`); }
      }
      if (!identities.has(observation.subject)) throw new MergeConflict(`Observation subject does not match character ${characterId}'s stable ID, name or aliases.`);
      for (const [otherPath, otherContent] of files) {
        const other = /^characters\/([^/]+)\/meta\.yaml$/u.exec(otherPath)?.[1];
        if (!other || other === characterId) continue;
        readPaths.add(otherPath);
        try {
          validateFinalDocument({ path: otherPath, content: otherContent });
          const value = record(parseDocument(otherContent).toJS({ maxAliasCount: 100 }));
          if ([other, value.name, value.displayName, ...(Array.isArray(value.aliases) ? value.aliases : [])].includes(observation.subject)) {
            throw new MergeConflict(`Observation subject matches more than one character; use an unambiguous stable ID.`);
          }
        } catch (error) {
          if (error instanceof MergeConflict) throw error;
          throw new MergeConflict('Another character has invalid metadata; name uniqueness cannot be established.');
        }
      }
    }
  };
  if (change.domain === 'state') {
    requireCharacter(change.characterId, true);
    const path = 'state/characters.yaml';
    const doc = yaml(files, path, 'characters: {}\n');
    const root = record(doc.toJS());
    if (!Object.hasOwn(root, 'characters')) throw new MergeConflict('Existing global state has no characters mapping; review its layout instead of adding a second state representation.');
    const characters = root.characters === undefined ? {} : record(root.characters);
    const character = characters[change.characterId] === undefined ? {} : record(characters[change.characterId]);
    const sources = root.settlementSources === undefined ? {} : record(root.settlementSources);
    const characterSources = sources[change.characterId] === undefined ? {} : record(sources[change.characterId]);
    const previous = characterSources[change.field] === undefined ? undefined : record(characterSources[change.field]);
    const id = evidenceId(log, observation, `state:${change.characterId}:${change.field}`);
    if (previous) {
      if (typeof previous.chapterRef !== 'string' || !/^(?!0000)\d{4}\/(?!0000)\d{4}$/u.test(previous.chapterRef)
        || typeof previous.id !== 'string' || typeof previous.sourceHash !== 'string') throw new MergeConflict('Existing state provenance is not a supported settlement record.');
      if (previous.chapterRef > log.chapterId) throw new MergeConflict(`A later chapter already settled ${change.characterId}.${change.field}; earlier chapters cannot roll it back.`);
      if (previous.id === id) {
        if (character[change.field] === change.value && previous.value === change.value) return;
        throw new MergeConflict(`Previously settled ${change.characterId}.${change.field} was changed; preserve the current value.`);
      }
    }
    const exists = Object.hasOwn(character, change.field);
    if (change.expectedValue === null ? exists : !exists || character[change.field] !== change.expectedValue) {
      throw new MergeConflict(`Expected value does not match ${change.characterId}.${change.field}; preserve the current value.`);
    }
    doc.setIn(['characters', change.characterId, change.field], change.value);
    doc.setIn(['settlementSources', change.characterId, change.field], { ...evidence(log, observation, id), value: change.value });
    save(files, path, doc.toString());
    return;
  }
  if (change.domain === 'timeline') {
    const path = 'timeline/events.yaml';
    const doc = yaml(files, path, 'events: []\n');
    const events = collection(doc.toJS(), 'events');
    const id = evidenceId(log, observation, 'event');
    const existing = events.find((entry) => entry.id === id);
    if (existing) {
      if (existing.chapter === log.chapterId && existing.title === change.title && existing.time === change.time && existing.description === observation.observation) return;
      throw new MergeConflict('Existing timeline event with this evidence differs; review the event instead of duplicating it.');
    }
    if (events.some((entry) => { const chapter = entry.chapter ?? entry.chapterRef; return typeof chapter === 'string' && chapter > log.chapterId; })) {
      throw new MergeConflict('Timeline already contains a later chapter; appending this earlier chapter would misorder events.');
    }
    const order = events.reduce((max, entry) => Math.max(max, typeof entry.order === 'number' ? entry.order : typeof entry.sequence === 'number' ? entry.sequence : 0), 0) + 1;
    if (!Number.isSafeInteger(order)) throw new MergeConflict('Timeline ordering has exhausted its integer range.');
    doc.addIn(['events'], { id, order, chapter: log.chapterId, title: change.title, time: change.time, description: observation.observation,
      settlementEvidence: evidence(log, observation, id) });
    save(files, path, doc.toString());
    return;
  }
  if (change.domain === 'character') {
    requireCharacter(change.characterId, true);
    const path = `characters/${change.characterId}/growth.md`;
    readPaths.add(path);
    const id = evidenceId(log, observation, `character:${change.characterId}`);
    const block = `<!-- oan:settlement:${id} -->\n## Chapter ${log.chapterId} evidence\n\n${markdownText(observation.observation)}\n\nSource SHA-256: ${log.sourceHash}; lines ${observation.evidence.startLine}-${observation.evidence.endLine}\n\n${observation.evidence.quote.split('\n').map((line) => `> ${markdownText(line)}`).join('\n')}\n<!-- /oan:settlement:${id} -->`;
    save(files, path, appendManagedBlock(files.get(path) ?? `# Character growth\n`, id, block, true));
    return;
  }
  const activePath = 'foreshadow/active.yaml';
  const resolvedPath = 'foreshadow/resolved.yaml';
  const activeDoc = yaml(files, activePath, 'active: []\n');
  const resolvedDoc = yaml(files, resolvedPath, 'resolved: []\n');
  const active = collection(activeDoc.toJS(), 'active');
  const resolved = collection(resolvedDoc.toJS(), 'resolved');
  const activeIndex = active.findIndex((entry) => entry.id === change.hookId);
  const resolvedIndex = resolved.findIndex((entry) => entry.id === change.hookId);
  if (activeIndex >= 0 && resolvedIndex >= 0) throw new MergeConflict('Hook identity occurs in both lifecycle ledgers.');
  const existing = active[activeIndex] ?? resolved[resolvedIndex];
  const id = evidenceId(log, observation, `hook:${change.hookId}:${change.operation}`);
  const history = existing?.settlementHistory === undefined ? [] : records(existing.settlementHistory);
  const recorded = history.find((entry) => entry.id === id);
  if (recorded) {
    if (recorded.operation === change.operation && recorded.observation === observation.observation
      && (change.operation !== 'create' || (existing?.description === change.description && JSON.stringify(existing?.relatedCharacters ?? []) === JSON.stringify(change.relatedCharacters)))) return;
    throw new MergeConflict('The existing hook evidence differs from this settlement.');
  }
  const historyEntry = { ...evidence(log, observation, id), operation: change.operation, observation: observation.observation };
  if (change.operation === 'create') {
    change.relatedCharacters.forEach((characterId) => requireCharacter(characterId));
    if (existing) throw new MergeConflict(`Hook ${change.hookId} already exists; creation cannot replace it.`);
    activeDoc.addIn(['active'], { id: change.hookId, status: 'active', firstChapter: log.chapterId,
      description: change.description, relatedCharacters: change.relatedCharacters, settlementHistory: [historyEntry] });
    save(files, activePath, activeDoc.toString());
    return;
  }
  if (!existing || activeIndex < 0) throw new MergeConflict(`Hook ${change.hookId} is absent or already resolved; no lifecycle change was applied.`);
  if (existing.status !== change.expectedStatus) throw new MergeConflict(`Expected status does not match hook ${change.hookId}.`);
  if ((typeof existing.firstChapter === 'string' && existing.firstChapter > log.chapterId)
    || history.some((entry) => typeof entry.chapterRef === 'string' && entry.chapterRef > log.chapterId)) {
    throw new MergeConflict(`A later chapter already settled hook ${change.hookId}; earlier chapters cannot change its lifecycle.`);
  }
  activeDoc.setIn(['active', activeIndex, 'settlementHistory'], [...history, historyEntry]);
  if (change.operation === 'resolve') {
    activeDoc.setIn(['active', activeIndex, 'status'], 'resolved');
    activeDoc.setIn(['active', activeIndex, 'resolvedChapter'], log.chapterId);
    const node = activeDoc.getIn(['active', activeIndex], true);
    if (!isMap(node)) throw new MergeConflict('Hook record must be a mapping.');
    resolvedDoc.addIn(['resolved'], node.clone());
    activeDoc.deleteIn(['active', activeIndex]);
    save(files, resolvedPath, resolvedDoc.toString());
  } else if (change.operation === 'advance' || change.operation === 'defer') {
    activeDoc.setIn(['active', activeIndex, 'status'], change.operation === 'advance' ? 'developing' : 'dormant');
  }
  save(files, activePath, activeDoc.toString());
}

export function appendManagedBlock(content: string, id: string, block: string, allowRelocatedEvidence = false): string {
  const start = `<!-- oan:settlement:${id} -->`;
  const end = `<!-- /oan:settlement:${id} -->`;
  const offset = content.indexOf(start);
  if (offset >= 0) {
    const endOffset = content.indexOf(end, offset);
    const comparable = (value: string) => allowRelocatedEvidence ? value.replace(/^Source SHA-256: [a-f0-9]{64}; lines \d+-\d+$/mu, 'Source evidence (same quote)') : value;
    if (content.indexOf(start, offset + start.length) >= 0 || endOffset < 0
      || comparable(content.slice(offset, endOffset + end.length)) !== comparable(block)) throw new MergeConflict('Existing managed evidence was edited; preserve author content and review the conflict.');
    return content;
  }
  if (content.includes(end)) throw new MergeConflict('Existing evidence markers are incomplete.');
  return `${content}${content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'}${block}\n`;
}
export function isSettlementMergeConflict(error: unknown): error is Error { return error instanceof MergeConflict; }
export function markdownText(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function evidenceId(log: ChapterSettlementObservationLog, observation: ChapterSettlementObservation, key: string): string {
  return `settlement-${createHash('sha256').update(JSON.stringify([log.chapterId, key, observation.category, observation.subject, observation.evidence.quote])).digest('hex').slice(0, 24)}`;
}
function evidence(log: ChapterSettlementObservationLog, observation: ChapterSettlementObservation, id: string) {
  return { id, chapterRef: log.chapterId, sourceHash: log.sourceHash, observationId: observation.id, evidence: observation.evidence };
}
function yaml(files: Map<string, string>, path: string, initial: string) {
  const content = files.get(path) ?? initial;
  try {
    validateFinalDocument({ path, content });
    const doc = parseDocument(content, { uniqueKeys: true });
    record(doc.toJS({ maxAliasCount: 100 }));
    return doc;
  } catch (error) { throw new MergeConflict(`Cannot merge ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}
function save(files: Map<string, string>, path: string, content: string) {
  try { validateFinalDocument({ path, content }); }
  catch (error) { throw new MergeConflict(`Cannot merge ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  files.set(path, content);
}
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MergeConflict('Existing settlement target has an incompatible structured value.');
  return value as RecordValue;
}
function records(value: unknown): RecordValue[] {
  if (!Array.isArray(value)) throw new MergeConflict('Existing settlement collection must be an array.');
  return value.map(record);
}
function collection(value: unknown, key: string): RecordValue[] { return records(record(value)[key]); }
