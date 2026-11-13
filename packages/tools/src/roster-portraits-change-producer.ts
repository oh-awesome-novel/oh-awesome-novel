import { isMap, parseDocument } from 'yaml';
import { normalizeRosterCharacter, normalizeRosterPortraitSet } from '@oh-awesome-novel/core';
import type { RosterPortraitSet } from '@oh-awesome-novel/core';
import type { CandidateChangeSet, CandidateFileSnapshot, RepositoryBaseline } from './candidate-change-set';
import { createCandidateChangeSetBuilder } from './deterministic-change-producers';
import { createWorkspaceChangePolicy, validateCandidateChangeSetAgainstPolicy } from './workspace-change-policy';

export const ROSTER_PORTRAITS_PRODUCER = 'roster-portraits';

export function rosterProfilePath(characterId: string): string {
  if (typeof characterId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(characterId)) throw new Error('Invalid character id.');
  return `characters/${characterId}/roster-profile.yaml`;
}

export interface RosterPortraitsEdit {
  /** The portrait set to write; null removes the `portraits` section. */
  portraits: RosterPortraitSet | null;
  /** `#RRGGBB`; null removes `looks.nameColor`. */
  nameColor: string | null;
}

/**
 * Rewrites only `portraits` and `looks.nameColor` in a character's roster profile; every other
 * key, and the author's comments, stay as they are.
 */
export function applyRosterPortraitsEdit(source: string, characterId: string, edit: RosterPortraitsEdit): string {
  const document = parseDocument(source);
  if (document.errors.length || !isMap(document.contents)) throw new Error('Roster profile is not a readable YAML mapping.');
  const before = normalizeRosterCharacter(document.toJS());
  if (before.id !== characterId) throw new Error('Roster identity differs from its directory.');
  if (edit.portraits === null) document.delete('portraits');
  else document.set('portraits', document.createNode(orderedPortraitSet(normalizeRosterPortraitSet(edit.portraits))));
  if (edit.nameColor === null) document.deleteIn(['looks', 'nameColor']);
  else document.setIn(['looks', 'nameColor'], edit.nameColor);
  const content = document.toString({ lineWidth: 0, flowCollectionPadding: false });
  // The same rules the final validator applies, checked before a candidate exists.
  normalizeRosterCharacter(parseDocument(content).toJS());
  return content;
}

/**
 * The roster profile as model context sees it: without the stage-only `portraits` and
 * `looks.nameColor`. A profile that has neither is returned byte for byte.
 */
export function stripRosterStageFields(source: string): string {
  const document = parseDocument(source);
  if (document.errors.length || !isMap(document.contents)) return source;
  if (!document.has('portraits') && !document.hasIn(['looks', 'nameColor'])) return source;
  document.delete('portraits');
  document.deleteIn(['looks', 'nameColor']);
  return document.toString({ lineWidth: 0, flowCollectionPadding: false });
}

export function createRosterPortraitsChangeProposal(input: {
  characterId: string;
  edit: RosterPortraitsEdit;
  repository: RepositoryBaseline;
  baselineFiles: readonly CandidateFileSnapshot[];
  sessionId: string;
}): { candidate: CandidateChangeSet; targetPath: string } | undefined {
  const targetPath = rosterProfilePath(input.characterId);
  if (input.baselineFiles.length !== 1 || input.baselineFiles[0]?.path !== targetPath) throw new Error('Portrait edit requires exactly the character roster profile.');
  const content = applyRosterPortraitsEdit(input.baselineFiles[0].content, input.characterId, input.edit);
  const policy = createWorkspaceChangePolicy({ capability: 'character.edit', exactWritablePaths: [targetPath] });
  const builder = createCandidateChangeSetBuilder({
    sessionId: input.sessionId, producer: ROSTER_PORTRAITS_PRODUCER, capability: 'character.edit',
    repository: input.repository, baselineFiles: input.baselineFiles,
  });
  builder.write(targetPath, content);
  const candidate = builder.finalize();
  if (!candidate) return undefined;
  validateCandidateChangeSetAgainstPolicy(candidate, policy);
  if (candidate.changes.length !== 1 || candidate.changes[0]!.path !== targetPath || candidate.changes[0]!.operation !== 'update') {
    throw new Error('Portrait edit escaped its roster profile.');
  }
  return { candidate, targetPath };
}

/** Stable key order so the same form state always produces the same YAML. */
function orderedPortraitSet(set: RosterPortraitSet): RosterPortraitSet {
  return {
    default: set.default,
    items: set.items.map(item => ({
      id: item.id,
      label: item.label,
      description: item.description,
      ...(item.usage ? { usage: item.usage } : {}),
      ...(item.image ? { image: item.image } : {}),
      ...(item.prompt ? { prompt: {
        positive: item.prompt.positive,
        ...(item.prompt.negative ? { negative: item.prompt.negative } : {}),
        ...(item.prompt.useCharacterTags === undefined ? {} : { useCharacterTags: item.prompt.useCharacterTags }),
      } } : {}),
      ...(item.generation ? { generation: item.generation } : {}),
    })),
  };
}
