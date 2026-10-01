import type {
  CandidateChangeSet,
  WorkspaceEditCapability,
} from './candidate-change-set';
import {
  normalizeWorkspaceRelativePath,
  sha256Text,
} from './candidate-change-set';
import { parse as parseYaml } from 'yaml';
import type {
  FinalDocumentValidationContext,
  FinalDocumentValidatorId,
} from './final-document-validator';
import {
  DEFAULT_MAX_FINAL_DOCUMENT_BYTES,
  getFinalDocumentValidatorIdForPath,
  validateFinalDocument,
} from './final-document-validator';

export const DEFAULT_MAX_CHANGED_FILES = 64;
export const DEFAULT_MAX_CANDIDATE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_PATH_DEPTH = 32;

export type PathRule =
  | { kind: 'exact'; path: string }
  | { kind: 'prefix'; path: string };

export interface WorkspaceChangePolicy {
  readonly capability: WorkspaceEditCapability;
  readonly readable: readonly PathRule[];
  readonly writable: readonly PathRule[];
  readonly validators: readonly FinalDocumentValidatorId[];
  readonly maxChangedFiles: number;
  readonly maxCandidateBytes: number;
  readonly maxFileBytes: number;
  readonly maxPathDepth: number;
  readonly validationContext: Readonly<FinalDocumentValidationContext>;
  readonly expectedProjectionFingerprint?: string;
}

export interface CreateWorkspaceChangePolicyInput {
  /** This value is selected by trusted host code, never by model tool arguments. */
  capability?: unknown;
  readable?: readonly PathRule[];
  exactWritablePaths?: readonly string[];
  writablePrefixes?: readonly string[];
  referenceId?: string;
  expectedProjectionFingerprint?: string;
  expectedReferenceRunId?: string;
  expectedSourceChecksumSha256?: string;
  expectedStructureFingerprint?: string;
  maxChangedFiles?: number;
  maxCandidateBytes?: number;
  maxFileBytes?: number;
  maxPathDepth?: number;
}

const CAPABILITIES: readonly WorkspaceEditCapability[] = [
  'read-only',
  'chapter.edit',
  'character.edit',
  'world.edit',
  'state.edit',
  'timeline.edit',
  'foreshadow.edit',
  'summary.edit',
  'outline.edit',
  'novel.multi-file-edit',
  'reference.publish',
  'reference.adopt',
  'play.adopt',
];

const INTERNAL_ROOTS = new Set([
  '.git',
  '.workspace',
  '.storyforge',
  'node_modules',
]);

const READ_ONLY_OAN_RULES: readonly PathRule[] = [
  { kind: 'prefix', path: '.oan/constitution' },
  { kind: 'prefix', path: '.oan/skills' },
  { kind: 'exact', path: '.oan/workflow.yaml' },
];

const DEFAULT_VISIBLE_READ_RULES: readonly PathRule[] = [
  { kind: 'prefix', path: 'chapters' },
  { kind: 'prefix', path: 'characters' },
  { kind: 'prefix', path: 'world' },
  { kind: 'prefix', path: 'state' },
  { kind: 'prefix', path: 'timeline' },
  { kind: 'prefix', path: 'foreshadow' },
  { kind: 'prefix', path: 'summaries' },
  { kind: 'prefix', path: 'outline' },
  ...READ_ONLY_OAN_RULES,
];

const FAMILY_PREFIX_VALIDATORS = new Map<string, readonly FinalDocumentValidatorId[]>([
  ['chapters', ['chapter-markdown']],
  ['characters', ['character-object']],
  ['world', ['world-object']],
  ['state', ['state-yaml']],
  ['timeline', ['timeline-yaml']],
  ['foreshadow', ['foreshadow-yaml']],
  ['summaries', ['summary-markdown']],
  ['outline', ['outline-markdown']],
]);

/**
 * Builds an immutable, turn-scoped policy. Unknown or missing capabilities are
 * intentionally reduced to read-only and cannot retain caller-provided writes.
 */
export function createWorkspaceChangePolicy(
  input: CreateWorkspaceChangePolicyInput = {},
): WorkspaceChangePolicy {
  const capability = normalizeHostSelectedCapability(input.capability);
  const maxChangedFiles = positiveInteger(
    input.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES,
    'maxChangedFiles',
  );
  const maxCandidateBytes = positiveInteger(
    input.maxCandidateBytes ?? DEFAULT_MAX_CANDIDATE_BYTES,
    'maxCandidateBytes',
  );
  const maxFileBytes = positiveInteger(
    input.maxFileBytes ?? DEFAULT_MAX_FINAL_DOCUMENT_BYTES,
    'maxFileBytes',
  );
  if (maxFileBytes > maxCandidateBytes) {
    throw new Error('maxFileBytes must not exceed maxCandidateBytes.');
  }
  const maxPathDepth = positiveInteger(
    input.maxPathDepth ?? DEFAULT_MAX_PATH_DEPTH,
    'maxPathDepth',
  );

  const requestedExact = normalizeWritePaths(input.exactWritablePaths ?? [], 'exact');
  const requestedPrefixes = normalizeWritePaths(input.writablePrefixes ?? [], 'prefix');
  const writable = capability === 'read-only'
    ? []
    : resolveWritableRules(capability, requestedExact, requestedPrefixes, input.referenceId);
  const validators = validatorsForWritableRules(writable, input.referenceId);
  const callerReadable = input.readable === undefined
    ? DEFAULT_VISIBLE_READ_RULES
    : input.readable;
  const readable = dedupeAndSortRules([
    ...callerReadable.map((rule) => normalizePathRule(rule, 'read')),
    ...writable,
  ]);

  const expectedProjectionFingerprint = input.expectedProjectionFingerprint === undefined
    ? undefined
    : requireSha256(input.expectedProjectionFingerprint, 'expectedProjectionFingerprint');
  const referenceId = input.referenceId === undefined
    ? undefined
    : requireSafeSegment(input.referenceId, 'referenceId');
  const validationContext: FinalDocumentValidationContext = Object.freeze({
    maxFileBytes,
    ...(referenceId ? { referenceId } : {}),
    ...(input.expectedReferenceRunId
      ? { expectedReferenceRunId: requireSafeId(input.expectedReferenceRunId, 'expectedReferenceRunId') }
      : {}),
    ...(input.expectedSourceChecksumSha256
      ? { expectedSourceChecksumSha256: requireSha256(input.expectedSourceChecksumSha256, 'expectedSourceChecksumSha256') }
      : {}),
    ...(input.expectedStructureFingerprint
      ? { expectedStructureFingerprint: requireSha256(input.expectedStructureFingerprint, 'expectedStructureFingerprint') }
      : {}),
  });

  return Object.freeze({
    capability,
    readable: Object.freeze(readable),
    writable: Object.freeze(writable),
    validators: Object.freeze(validators),
    maxChangedFiles,
    maxCandidateBytes,
    maxFileBytes,
    maxPathDepth,
    validationContext,
    ...(expectedProjectionFingerprint ? { expectedProjectionFingerprint } : {}),
  });
}

export function normalizeHostSelectedCapability(value: unknown): WorkspaceEditCapability {
  return typeof value === 'string' && CAPABILITIES.includes(value as WorkspaceEditCapability)
    ? value as WorkspaceEditCapability
    : 'read-only';
}

export function normalizePathRule(
  rule: PathRule,
  access: 'read' | 'write' = 'write',
): PathRule {
  if (!rule || typeof rule !== 'object' || (rule.kind !== 'exact' && rule.kind !== 'prefix')) {
    throw new Error('Workspace path rule must be exact or prefix.');
  }
  const path = assertSafeWorkspacePolicyPath(rule.path, access);
  return Object.freeze({ kind: rule.kind, path });
}

export function assertSafeWorkspacePolicyPath(
  value: string,
  access: 'read' | 'write' = 'write',
): string {
  const path = normalizeWorkspaceRelativePath(value);
  const segments = path.split('/');
  if (segments.length > DEFAULT_MAX_PATH_DEPTH) {
    throw new Error(`Workspace path is too deep: ${path}.`);
  }
  const hidden = segments.find((segment) => segment.startsWith('.'));
  if (hidden) {
    const allowedRead = access === 'read' && (
      path === '.oan/workflow.yaml'
      || path === '.oan/constitution'
      || path.startsWith('.oan/constitution/')
      || path === '.oan/skills'
      || path.startsWith('.oan/skills/')
    );
    if (!allowedRead) throw new Error(`Hidden or internal workspace path is forbidden: ${path}.`);
  }
  if (INTERNAL_ROOTS.has(segments[0]) || path.startsWith('.oan/sessions/')) {
    throw new Error(`Hidden or internal workspace path is forbidden: ${path}.`);
  }
  return path;
}

export function pathMatchesRule(value: string, rule: PathRule): boolean {
  try {
    const path = assertSafeWorkspacePolicyPath(value, 'read');
    const normalizedRule = normalizePathRule(rule, 'read');
    return normalizedRule.kind === 'exact'
      ? path === normalizedRule.path
      : path === normalizedRule.path || path.startsWith(`${normalizedRule.path}/`);
  } catch {
    return false;
  }
}

export function pathMatchesAnyRule(value: string, rules: readonly PathRule[]): boolean {
  return rules.some((rule) => pathMatchesRule(value, rule));
}

export function assertPathAllowedByRules(
  value: string,
  rules: readonly PathRule[],
  label = 'Workspace path',
): string {
  const path = assertSafeWorkspacePolicyPath(value, 'write');
  if (!pathMatchesAnyRule(path, rules)) {
    throw new Error(`${label} is outside the turn-scoped policy: ${path}.`);
  }
  return path;
}

export function assertPathReadableByPolicy(
  value: string,
  policy: WorkspaceChangePolicy,
): string {
  const path = assertSafeWorkspacePolicyPath(value, 'read');
  if (!pathMatchesAnyRule(path, policy.readable)) {
    throw new Error(`Workspace path is not readable in this turn: ${path}.`);
  }
  return path;
}

export function assertPathWritableByPolicy(
  value: string,
  policy: WorkspaceChangePolicy,
): string {
  return assertPathAllowedByRules(value, policy.writable, 'Workspace write path');
}

/**
 * Re-applies capability, limits and whole-document validation after VFS
 * reconciliation. Diff text and command history are intentionally ignored.
 */
export function validateCandidateChangeSetAgainstPolicy(
  changeSet: CandidateChangeSet,
  policy: WorkspaceChangePolicy,
): CandidateChangeSet {
  if (changeSet.source.capability !== policy.capability) {
    throw new Error(
      `Candidate capability ${changeSet.source.capability} does not match host policy ${policy.capability}.`,
    );
  }
  if (policy.capability === 'read-only' || policy.writable.length === 0) {
    throw new Error('Read-only workspace policy cannot authorize candidate changes.');
  }
  if (changeSet.changes.length > policy.maxChangedFiles) {
    throw new Error(`Candidate changes exceed the ${policy.maxChangedFiles}-file policy limit.`);
  }
  if (
    policy.expectedProjectionFingerprint
    && changeSet.projectionFingerprint !== policy.expectedProjectionFingerprint
  ) {
    throw new Error('Candidate projection fingerprint is stale for this host policy.');
  }

  let candidateBytes = 0;
  const paths = new Set<string>();
  for (const change of changeSet.changes) {
    const path = assertPathWritableByPolicy(change.path, policy);
    const depth = path.split('/').length;
    if (depth > policy.maxPathDepth) throw new Error(`Candidate path is too deep: ${path}.`);
    if (paths.has(path)) throw new Error(`Candidate contains duplicate path: ${path}.`);
    paths.add(path);

    const validator = getFinalDocumentValidatorIdForPath(path);
    if (!validator || !policy.validators.includes(validator)) {
      throw new Error(`Candidate path has no policy-bound final validator: ${path}.`);
    }
    if (change.operation === 'delete') continue;
    candidateBytes += change.draft.byteLength;
    if (change.draft.byteLength > policy.maxFileBytes) {
      throw new Error(`Candidate file exceeds the ${policy.maxFileBytes}-byte policy limit: ${path}.`);
    }
    const validated = validateFinalDocument({
      path,
      content: change.draft.content,
      validator,
      context: policy.validationContext,
    });
    if (
      validated.byteLength !== change.draft.byteLength
      || validated.sha256 !== change.draft.sha256
    ) {
      throw new Error(`Candidate draft metadata does not match final content: ${path}.`);
    }
  }
  if (candidateBytes > policy.maxCandidateBytes) {
    throw new Error(
      `Candidate content exceeds the ${policy.maxCandidateBytes}-byte policy limit.`,
    );
  }

  if (policy.capability === 'reference.publish') {
    validateReferencePublicationInventory(changeSet, policy);
  }
  return changeSet;
}

function resolveWritableRules(
  capability: Exclude<WorkspaceEditCapability, 'read-only'>,
  exact: readonly PathRule[],
  prefixes: readonly PathRule[],
  rawReferenceId: string | undefined,
): PathRule[] {
  const requested = dedupeAndSortRules([...exact, ...prefixes]);
  switch (capability) {
    case 'chapter.edit':
      return requireBoundedRules(requested, (rule) =>
        rule.kind === 'exact' && getFinalDocumentValidatorIdForPath(rule.path) === 'chapter-markdown', capability);
    case 'character.edit':
      return requireBoundedRules(requested, (rule) => {
        if (!rule.path.startsWith('characters/')) return false;
        if (rule.kind === 'exact') return getFinalDocumentValidatorIdForPath(rule.path) === 'character-object';
        return /^characters\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:\/.+)?$/u.test(rule.path);
      }, capability);
    case 'world.edit':
      return requireBoundedRules(requested, (rule) => {
        if (!rule.path.startsWith('world/')) return false;
        if (rule.kind === 'exact') return getFinalDocumentValidatorIdForPath(rule.path) === 'world-object';
        return rule.path !== 'world';
      }, capability);
    case 'state.edit':
      return narrowedFamilyRules(requested, 'state', 'state-yaml', capability);
    case 'timeline.edit':
      return narrowedFamilyRules(requested, 'timeline', 'timeline-yaml', capability);
    case 'foreshadow.edit':
      return narrowedFamilyRules(requested, 'foreshadow', 'foreshadow-yaml', capability);
    case 'summary.edit':
      return narrowedFamilyRules(requested, 'summaries', 'summary-markdown', capability);
    case 'outline.edit':
      return narrowedFamilyRules(requested, 'outline', 'outline-markdown', capability);
    case 'novel.multi-file-edit':
      if (requested.length > 0) {
        return requireBoundedRules(requested, isSupportedNovelRule, capability);
      }
      return [...FAMILY_PREFIX_VALIDATORS.keys()].map((path) => Object.freeze({
        kind: 'prefix' as const,
        path,
      }));
    case 'reference.publish': {
      const referenceId = rawReferenceId === undefined
        ? undefined
        : requireSafeSegment(rawReferenceId, 'referenceId');
      if (!referenceId) return [];
      if (requested.length > 0) {
        return requireBoundedRules(requested, (rule) =>
          rule.kind === 'exact'
          && getFinalDocumentValidatorIdForPath(rule.path) === 'reference-publication'
          && (
            rule.path === 'examples/references.yaml'
            || rule.path.startsWith(`examples/references/${referenceId}/`)
          ), capability);
      }
      return [
        Object.freeze({ kind: 'exact' as const, path: 'examples/references.yaml' }),
        Object.freeze({ kind: 'prefix' as const, path: `examples/references/${referenceId}` }),
      ];
    }
    case 'reference.adopt':
    case 'play.adopt':
      return requireBoundedRules(requested, (rule) =>
        rule.kind === 'exact'
        && isSupportedNovelFile(rule.path), capability);
  }
}

function narrowedFamilyRules(
  requested: readonly PathRule[],
  root: string,
  validator: FinalDocumentValidatorId,
  capability: WorkspaceEditCapability,
): PathRule[] {
  if (requested.length === 0) return [Object.freeze({ kind: 'prefix', path: root })];
  return requireBoundedRules(requested, (rule) => {
    if (rule.kind === 'exact') return getFinalDocumentValidatorIdForPath(rule.path) === validator;
    return rule.path === root || rule.path.startsWith(`${root}/`);
  }, capability);
}

function requireBoundedRules(
  rules: readonly PathRule[],
  predicate: (rule: PathRule) => boolean,
  capability: WorkspaceEditCapability,
): PathRule[] {
  if (rules.length === 0) return [];
  const invalid = rules.find((rule) => !predicate(rule));
  if (invalid) {
    throw new Error(`Writable rule ${invalid.kind}:${invalid.path} cannot be granted to ${capability}.`);
  }
  return [...rules];
}

function isSupportedNovelRule(rule: PathRule): boolean {
  if (rule.kind === 'exact') return isSupportedNovelFile(rule.path);
  const root = rule.path.split('/')[0];
  return FAMILY_PREFIX_VALIDATORS.has(root);
}

function isSupportedNovelFile(path: string): boolean {
  const validator = getFinalDocumentValidatorIdForPath(path);
  return validator !== undefined && validator !== 'reference-publication';
}

function validatorsForWritableRules(
  rules: readonly PathRule[],
  referenceId: string | undefined,
): FinalDocumentValidatorId[] {
  const validators = new Set<FinalDocumentValidatorId>();
  for (const rule of rules) {
    if (rule.kind === 'exact') {
      const validator = getFinalDocumentValidatorIdForPath(rule.path);
      if (!validator) throw new Error(`Writable file family has no complete validator: ${rule.path}.`);
      validators.add(validator);
      continue;
    }
    if (
      referenceId
      && rule.path === `examples/references/${referenceId}`
    ) {
      validators.add('reference-publication');
      continue;
    }
    const root = rule.path.split('/')[0];
    const family = FAMILY_PREFIX_VALIDATORS.get(root);
    if (!family) throw new Error(`Writable prefix has no complete validator family: ${rule.path}.`);
    family.forEach((validator) => validators.add(validator));
  }
  return [...validators].sort();
}

function normalizeWritePaths(
  paths: readonly string[],
  kind: PathRule['kind'],
): PathRule[] {
  if (!Array.isArray(paths)) throw new Error(`Workspace ${kind} write paths must be an array.`);
  return paths.map((path) => normalizePathRule({ kind, path }, 'write'));
}

function dedupeAndSortRules(rules: readonly PathRule[]): PathRule[] {
  const unique = new Map<string, PathRule>();
  for (const rule of rules) unique.set(`${rule.kind}:${rule.path}`, rule);
  return [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
}

function validateReferencePublicationInventory(
  changeSet: CandidateChangeSet,
  policy: WorkspaceChangePolicy,
): void {
  const referenceId = policy.validationContext.referenceId;
  if (!referenceId) throw new Error('Reference publication policy is missing its bounded referenceId.');
  const draftByPath = new Map(changeSet.changes
    .filter((change) => change.operation !== 'delete')
    .map((change) => [change.path, change.draft.content]));
  const manifestPath = `examples/references/${referenceId}/deconstruction-manifest.yaml`;
  const manifestContent = draftByPath.get(manifestPath);

  // CandidateChangeSet intentionally carries only changed files, not the full
  // final publication view. A trusted producer/store owns required-file and
  // retained-file closure. When the manifest is among the changed files, this
  // gate still verifies every simultaneously changed inventoried output.
  if (!manifestContent) return;

  // The individual validators already proved these are YAML mappings. Parsing
  // here only joins the manifest inventory to immutable candidate bytes.
  const manifest = parseSimpleYamlRecord(manifestContent, manifestPath);
  const outputs = manifest.outputs;
  if (!Array.isArray(outputs)) throw new Error('Reference publication manifest has no output inventory.');
  const manifestSource = manifest.sourceChecksumSha256;
  for (const output of outputs) {
    if (!isRecord(output) || typeof output.path !== 'string' || typeof output.checksumSha256 !== 'string') {
      throw new Error('Reference publication manifest output inventory is invalid.');
    }
    const target = output.path.startsWith(`examples/references/${referenceId}/`)
      ? output.path
      : `examples/references/${referenceId}/${output.path}`;
    const content = draftByPath.get(target);
    if (content === undefined) continue;
    if (sha256Text(content) !== output.checksumSha256) {
      throw new Error(`Reference publication inventory checksum is stale for ${target}.`);
    }
    if (
      output.sourceChecksumSha256 !== undefined
      && output.sourceChecksumSha256 !== manifestSource
    ) {
      throw new Error(`Reference publication inventory source is stale for ${target}.`);
    }
  }
}

function parseSimpleYamlRecord(content: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parseYaml(content);
  } catch (error) {
    throw new Error(`Cannot inspect ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Error(`${label} must be a YAML mapping.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function requireSafeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) || value.includes('..')) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireSafeId(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,179}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireSha256(value: string, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
