import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { parse } from 'yaml';

import type {
  ReferenceDeconstructionConfidence,
  ReferenceDeconstructionDiagnostic,
  ReferenceDeconstructionWarningSummary,
} from './reference-deconstruction.js';
import { inspectPublishedReferenceWorkReadiness } from './reference-deconstruction-store.js';
import {
  REFERENCE_STORY_MATERIAL_ASSERTION_TYPES,
  REFERENCE_STORY_MATERIAL_KINDS,
} from './reference-story-material.js';
import type {
  ReferenceStoryMaterialAssertionType,
  ReferenceStoryMaterialKind,
} from './reference-story-material.js';

export const REFERENCE_MATERIAL_ADOPTION_SCHEMA_VERSION = 1 as const;
export const MAX_REFERENCE_MATERIAL_ADOPTION_SELECTIONS = 64 as const;
export const MAX_REFERENCE_MATERIAL_ADOPTION_TARGETS = 32 as const;
export const MAX_REFERENCE_MATERIAL_ADOPTION_BASELINE_CHARS = 512_000 as const;

export interface ReferenceMaterialAdoptionEntry {
  id: string;
  materialKind: ReferenceStoryMaterialKind;
  title: string;
  content: string;
  details: string[];
  assertionType: ReferenceStoryMaterialAssertionType;
  confidence: ReferenceDeconstructionConfidence;
  evidenceRefs: string[];
  sourceFindingRefs: string[];
  uncertainty?: string;
  sourcePath: `materials/${ReferenceStoryMaterialKind}.yaml`;
}

export interface ReferenceMaterialAdoptionCatalog {
  schemaVersion: typeof REFERENCE_MATERIAL_ADOPTION_SCHEMA_VERSION;
  referenceId: string;
  referenceTitle: string;
  manifestRevision: number;
  sourceChecksumSha256: string;
  warningSummary: ReferenceDeconstructionWarningSummary;
  warnings: ReferenceDeconstructionDiagnostic[];
  materialFiles: Array<{
    materialKind: ReferenceStoryMaterialKind;
    path: `materials/${ReferenceStoryMaterialKind}.yaml`;
    checksumSha256: string;
    sourceRunId: string;
  }>;
  entries: ReferenceMaterialAdoptionEntry[];
  fingerprint: string;
}

export interface ReferenceMaterialAdoptionSelection {
  entryId: string;
  targetFile: string;
  targetPath?: string;
}

export interface ReferenceMaterialAdoptionTargetGroup {
  id: string;
  materialKind: ReferenceStoryMaterialKind;
  targetFile: string;
  targetPath?: string;
  targetExisted: boolean;
  baseline: string;
  baselineChecksumSha256: string;
  entries: ReferenceMaterialAdoptionEntry[];
}

export interface ReferenceMaterialAdoptionContext {
  schemaVersion: typeof REFERENCE_MATERIAL_ADOPTION_SCHEMA_VERSION;
  referenceId: string;
  referenceTitle: string;
  catalogFingerprint: string;
  manifestRevision: number;
  sourceChecksumSha256: string;
  materialFiles: ReferenceMaterialAdoptionCatalog['materialFiles'];
  warnings: ReferenceDeconstructionDiagnostic[];
  targets: ReferenceMaterialAdoptionTargetGroup[];
}

export interface ReferenceMaterialAdoptionModelTarget {
  targetId: string;
  decision: 'create' | 'update' | 'skip';
  reason: string;
  draft?: string | null;
}

export interface ReferenceMaterialAdoptionModelOutput {
  targets: ReferenceMaterialAdoptionModelTarget[];
}

export interface ReferenceMaterialAdoptionDecision {
  targetId: string;
  materialKind: ReferenceStoryMaterialKind;
  targetFile: string;
  targetPath?: string;
  entryIds: string[];
  decision: 'create' | 'update' | 'skip';
  reason: string;
  draft?: string;
}

export interface ReferenceMaterialAdoptionPlan {
  decisions: ReferenceMaterialAdoptionDecision[];
}

export async function readReferenceMaterialAdoptionCatalog(
  workspaceRoot: string,
  referenceId: string,
): Promise<ReferenceMaterialAdoptionCatalog> {
  const safeReferenceId = requireSafeId(referenceId, 'referenceId');
  const readiness = await inspectPublishedReferenceWorkReadiness(
    workspaceRoot,
    safeReferenceId,
  );
  const manifest = readiness.deconstructionManifest;
  const metadata = readiness.metadata;
  if (
    readiness.status !== 'completed'
    || !manifest
    || manifest.status !== 'completed'
    || !metadata
  ) {
    throw new Error(
      `Reference ${safeReferenceId} has no accepted current Story Material publication.`,
    );
  }

  const materialOutputs = manifest.outputs.filter((output) =>
    output.kind === 'materials'
    && !output.stale
    && output.sourceChecksumSha256 === manifest.sourceChecksumSha256);
  if (!materialOutputs.length) {
    throw new Error(`Reference ${safeReferenceId} has no current Story Materials.`);
  }

  const workspaceRealpath = await realpath(workspaceRoot);
  const bundleRoot = resolve(
    workspaceRealpath,
    'examples',
    'references',
    safeReferenceId,
  );
  assertPathInside(workspaceRealpath, bundleRoot, 'Reference bundle escaped workspace.');
  const entries: ReferenceMaterialAdoptionEntry[] = [];
  const materialFiles: ReferenceMaterialAdoptionCatalog['materialFiles'] = [];

  for (const output of materialOutputs) {
    const materialKind = materialKindFromPath(output.path);
    const target = resolve(bundleRoot, output.path);
    assertPathInside(bundleRoot, target, 'Story Material path escaped its reference bundle.');
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Story Material is not a regular file: ${output.path}.`);
    }
    const targetRealpath = await realpath(target);
    assertPathInside(bundleRoot, targetRealpath, 'Story Material path escaped its bundle.');
    const content = await readFile(targetRealpath, 'utf8');
    if (sha256(content) !== output.checksumSha256) {
      throw new Error(`Story Material checksum is stale: ${output.path}.`);
    }
    const document = parseMaterialDocument(parse(content) as unknown, {
      materialKind,
      sourceRunId: output.sourceRunId,
      sourcePath: output.path as `materials/${ReferenceStoryMaterialKind}.yaml`,
    });
    entries.push(...document);
    materialFiles.push({
      materialKind,
      path: output.path as `materials/${ReferenceStoryMaterialKind}.yaml`,
      checksumSha256: output.checksumSha256,
      sourceRunId: output.sourceRunId,
    });
  }

  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error('Published Story Material entry ids must be unique across files.');
  }
  materialFiles.sort((left, right) => materialKindOrder(left.materialKind)
    - materialKindOrder(right.materialKind));
  entries.sort((left, right) => materialKindOrder(left.materialKind)
    - materialKindOrder(right.materialKind) || left.id.localeCompare(right.id));
  const catalogCore = {
    schemaVersion: REFERENCE_MATERIAL_ADOPTION_SCHEMA_VERSION,
    referenceId: safeReferenceId,
    referenceTitle: metadata.title,
    manifestRevision: manifest.revision,
    sourceChecksumSha256: manifest.sourceChecksumSha256,
    warningSummary: structuredClone(manifest.warningSummary),
    warnings: readiness.diagnostics
      .filter((diagnostic) => !diagnostic.blocking)
      .map((diagnostic) => structuredClone(diagnostic)),
    materialFiles,
    entries,
  };
  return {
    ...catalogCore,
    fingerprint: sha256(stableSerialize(catalogCore)),
  };
}

export async function prepareReferenceMaterialAdoptionContext(input: {
  workspaceRoot: string;
  referenceId: string;
  catalogFingerprint: string;
  selections: readonly ReferenceMaterialAdoptionSelection[];
}): Promise<ReferenceMaterialAdoptionContext> {
  const catalog = await readReferenceMaterialAdoptionCatalog(
    input.workspaceRoot,
    input.referenceId,
  );
  if (requireSha256(input.catalogFingerprint, 'catalogFingerprint') !== catalog.fingerprint) {
    throw new Error('Story Material catalog changed before adoption preview.');
  }
  if (
    !Array.isArray(input.selections)
    || input.selections.length < 1
    || input.selections.length > MAX_REFERENCE_MATERIAL_ADOPTION_SELECTIONS
  ) {
    throw new Error('Story Material adoption selections are invalid.');
  }
  const selectedIds = input.selections.map((selection) =>
    requireSafeId(selection.entryId, 'entryId'));
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('Story Material adoption entry selections must be unique.');
  }

  const groups = new Map<string, {
    materialKind: ReferenceStoryMaterialKind;
    targetFile: string;
    targetPath?: string;
    entries: ReferenceMaterialAdoptionEntry[];
  }>();
  for (const selection of input.selections) {
    const entry = catalog.entries.find((candidate) => candidate.id === selection.entryId);
    if (!entry) {
      throw new Error(`Story Material entry is not published: ${selection.entryId}.`);
    }
    const target = normalizeAdoptionTarget(
      entry.materialKind,
      selection.targetFile,
      selection.targetPath,
    );
    const existing = groups.get(target.targetFile);
    if (existing && (
      existing.materialKind !== entry.materialKind
      || existing.targetPath !== target.targetPath
    )) {
      throw new Error(
        `One adoption target file cannot mix material kinds or YAML paths: ${target.targetFile}.`,
      );
    }
    if (existing) {
      existing.entries.push(structuredClone(entry));
    } else {
      groups.set(target.targetFile, {
        materialKind: entry.materialKind,
        targetFile: target.targetFile,
        ...(target.targetPath ? { targetPath: target.targetPath } : {}),
        entries: [structuredClone(entry)],
      });
    }
  }
  if (groups.size > MAX_REFERENCE_MATERIAL_ADOPTION_TARGETS) {
    throw new Error('Story Material adoption has too many unique targets.');
  }

  const workspaceRealpath = await realpath(input.workspaceRoot);
  const targets: ReferenceMaterialAdoptionTargetGroup[] = [];
  for (const group of groups.values()) {
    const snapshot = await readWorkspaceTargetBaseline(
      workspaceRealpath,
      group.targetFile,
    );
    const groupCore = {
      materialKind: group.materialKind,
      targetFile: group.targetFile,
      ...(group.targetPath ? { targetPath: group.targetPath } : {}),
      entryIds: group.entries.map((entry) => entry.id).sort(),
    };
    targets.push({
      id: `target-${sha256(stableSerialize(groupCore)).slice(0, 24)}`,
      materialKind: group.materialKind,
      targetFile: group.targetFile,
      ...(group.targetPath ? { targetPath: group.targetPath } : {}),
      targetExisted: snapshot.exists,
      baseline: snapshot.content,
      baselineChecksumSha256: sha256(snapshot.content),
      entries: group.entries.sort((left, right) => left.id.localeCompare(right.id)),
    });
  }
  targets.sort((left, right) => left.targetFile.localeCompare(right.targetFile));
  const selectedMaterialKinds = new Set(targets.map((target) => target.materialKind));

  return {
    schemaVersion: REFERENCE_MATERIAL_ADOPTION_SCHEMA_VERSION,
    referenceId: catalog.referenceId,
    referenceTitle: catalog.referenceTitle,
    catalogFingerprint: catalog.fingerprint,
    manifestRevision: catalog.manifestRevision,
    sourceChecksumSha256: catalog.sourceChecksumSha256,
    materialFiles: structuredClone(catalog.materialFiles.filter((file) =>
      selectedMaterialKinds.has(file.materialKind))),
    warnings: structuredClone(catalog.warnings),
    targets,
  };
}

export function createReferenceMaterialAdoptionPlan(
  context: ReferenceMaterialAdoptionContext,
  output: unknown,
): ReferenceMaterialAdoptionPlan {
  const record = requireRecord(output, 'Reference Material adoption output');
  assertOnlyKnownFields(record, ['targets'], 'Reference Material adoption output');
  const rawTargets = requireArray(record.targets, 'adoption targets', context.targets.length);
  const normalized = rawTargets.map((value, index) =>
    normalizeModelTarget(value, index));
  if (
    new Set(normalized.map((target) => target.targetId)).size !== normalized.length
    || context.targets.some((target) =>
      !normalized.some((candidate) => candidate.targetId === target.id))
  ) {
    throw new Error('Reference Material adoption must return every target exactly once.');
  }

  const decisions: ReferenceMaterialAdoptionDecision[] = [];
  for (const target of context.targets) {
    const result = normalized.find((candidate) => candidate.targetId === target.id)!;
    if (
      result.decision === 'create' && target.targetExisted
      || result.decision === 'update' && !target.targetExisted
    ) {
      throw new Error(
        `Adoption decision ${result.decision} does not match target baseline: ${target.targetFile}.`,
      );
    }
    decisions.push({
      targetId: target.id,
      materialKind: target.materialKind,
      targetFile: target.targetFile,
      ...(target.targetPath ? { targetPath: target.targetPath } : {}),
      entryIds: target.entries.map((entry) => entry.id),
      decision: result.decision,
      reason: result.reason,
      ...(result.draft ? { draft: result.draft } : {}),
    });
    if (result.decision === 'skip') continue;
    if (!result.draft?.trim()) {
      throw new Error(`Adoption target ${target.id} requires a non-empty draft.`);
    }
  }
  return { decisions };
}

export function fingerprintReferenceMaterialAdoptionContext(
  context: ReferenceMaterialAdoptionContext,
): string {
  return sha256(stableSerialize(context));
}

function normalizeAdoptionTarget(
  materialKind: ReferenceStoryMaterialKind,
  rawTargetFile: string,
  rawTargetPath?: string,
): { targetFile: string; targetPath?: string } {
  const targetFile = safeWorkspacePath(rawTargetFile);
  const segments = targetFile.split('/');
  if (
    ['world', 'characters', 'relationships'].includes(materialKind)
    && !/^[A-Za-z0-9_-]+$/u.test(segments[1] ?? '')
  ) {
    throw new Error('World and character target ids must use letters, numbers, _ or -.');
  }
  if (materialKind === 'world') {
    if (
      segments.length < 3
      || segments[0] !== 'world'
      || !targetFile.endsWith('.md')
    ) {
      throw new Error('World material target must match world/<topic>/**/*.md.');
    }
  } else if (materialKind === 'characters') {
    if (
      segments.length < 3
      || segments[0] !== 'characters'
      || !targetFile.endsWith('.md')
    ) {
      throw new Error('Character material target must match characters/<id>/*.md.');
    }
  } else if (materialKind === 'relationships') {
    if (
      segments.length !== 3
      || segments[0] !== 'characters'
      || segments[2] !== 'relationships.yaml'
    ) {
      throw new Error(
        'Relationship material target must match characters/<id>/relationships.yaml.',
      );
    }
  } else if (materialKind === 'outline') {
    if (segments.length < 2 || segments[0] !== 'outline' || !targetFile.endsWith('.md')) {
      throw new Error('Outline material target must match outline/**/*.md.');
    }
  } else if (
    segments.length !== 2
    || segments[0] !== 'timeline'
    || !targetFile.endsWith('.yaml')
  ) {
    throw new Error('Timeline material target must match timeline/*.yaml.');
  }

  if (materialKind !== 'timeline') {
    if (rawTargetPath !== undefined) {
      throw new Error('Only timeline targets accept a YAML targetPath.');
    }
    return { targetFile };
  }
  const targetPath = requireDottedPath(rawTargetPath, 'timeline targetPath');
  return { targetFile, targetPath };
}

async function readWorkspaceTargetBaseline(
  workspaceRealpath: string,
  targetFile: string,
): Promise<{ exists: boolean; content: string }> {
  const target = resolve(workspaceRealpath, targetFile);
  assertPathInside(workspaceRealpath, target, 'Adoption target escaped workspace.');
  await assertExistingAncestorsAreDirectories(workspaceRealpath, dirname(target));
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Adoption target is not a regular file: ${targetFile}.`);
    }
    if (stat.size > MAX_REFERENCE_MATERIAL_ADOPTION_BASELINE_CHARS * 4) {
      throw new Error(`Adoption target exceeds the baseline size limit: ${targetFile}.`);
    }
    const targetRealpath = await realpath(target);
    assertPathInside(workspaceRealpath, targetRealpath, 'Adoption target escaped workspace.');
    const content = await readFile(targetRealpath, 'utf8');
    if (content.length > MAX_REFERENCE_MATERIAL_ADOPTION_BASELINE_CHARS) {
      throw new Error(`Adoption target exceeds the baseline size limit: ${targetFile}.`);
    }
    return { exists: true, content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, content: '' };
    }
    throw error;
  }
}

async function assertExistingAncestorsAreDirectories(
  workspaceRealpath: string,
  parent: string,
): Promise<void> {
  const relativeParent = parent.slice(workspaceRealpath.length).split(sep).filter(Boolean);
  let cursor = workspaceRealpath;
  for (const segment of relativeParent) {
    cursor = resolve(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Adoption target parent contains a symlink or non-directory.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function parseMaterialDocument(
  value: unknown,
  expected: {
    materialKind: ReferenceStoryMaterialKind;
    sourceRunId: string;
    sourcePath: `materials/${ReferenceStoryMaterialKind}.yaml`;
  },
): ReferenceMaterialAdoptionEntry[] {
  const record = requireRecord(value, 'Story Material document');
  assertOnlyKnownFields(record, [
    'version',
    'track',
    'runId',
    'unitId',
    'materialKind',
    'entries',
    'uncertainties',
  ], 'Story Material document');
  if (
    record.version !== 2
    || record.track !== 'storyMaterial'
    || record.runId !== expected.sourceRunId
    || record.materialKind !== expected.materialKind
    || typeof record.unitId !== 'string'
  ) {
    throw new Error(`Story Material document identity is invalid: ${expected.sourcePath}.`);
  }
  const rawEntries = requireArray(record.entries, 'Story Material entries');
  return rawEntries.map((value, index): ReferenceMaterialAdoptionEntry => {
    const entry = requireRecord(value, `Story Material entry ${index}`);
    assertOnlyKnownFields(entry, [
      'id',
      'title',
      'content',
      'details',
      'assertionType',
      'confidence',
      'evidenceRefs',
      'sourceFindingRefs',
      'uncertainty',
    ], `Story Material entry ${index}`);
    return {
      id: requireSafeId(entry.id, 'entry id'),
      materialKind: expected.materialKind,
      title: requireBoundedText(entry.title, 'entry title', 500),
      content: requireBoundedText(entry.content, 'entry content', 24_000),
      details: requireStringArray(entry.details, 'entry details', 16, 4_000),
      assertionType: requireEnum(
        entry.assertionType,
        REFERENCE_STORY_MATERIAL_ASSERTION_TYPES,
        'entry assertionType',
      ),
      confidence: requireEnum(
        entry.confidence,
        ['low', 'medium', 'high'] as const,
        'entry confidence',
      ),
      evidenceRefs: requireStringArray(entry.evidenceRefs, 'entry evidenceRefs', 64, 300, 1),
      sourceFindingRefs: requireStringArray(
        entry.sourceFindingRefs,
        'entry sourceFindingRefs',
        64,
        300,
        1,
      ),
      ...(entry.uncertainty === undefined
        ? {}
        : { uncertainty: requireBoundedText(entry.uncertainty, 'entry uncertainty', 4_000) }),
      sourcePath: expected.sourcePath,
    };
  });
}

function normalizeModelTarget(value: unknown, index: number): ReferenceMaterialAdoptionModelTarget {
  const record = requireRecord(value, `adoption target ${index}`);
  assertOnlyKnownFields(
    record,
    ['targetId', 'decision', 'reason', 'draft'],
    `adoption target ${index}`,
  );
  const decision = requireEnum(
    record.decision,
    ['create', 'update', 'skip'] as const,
    'adoption decision',
  );
  const draft = record.draft === undefined || record.draft === null
    ? undefined
    : requireBoundedText(record.draft, 'adoption draft', 512_000);
  if ((decision === 'skip') === Boolean(draft)) {
    throw new Error('Skipped adoption targets must omit draft; changed targets require draft.');
  }
  return {
    targetId: requireSafeId(record.targetId, 'targetId'),
    decision,
    reason: requireBoundedText(record.reason, 'adoption reason', 2_000),
    ...(draft ? { draft } : {}),
  };
}

function materialKindFromPath(path: string): ReferenceStoryMaterialKind {
  const match = /^materials\/(world|characters|relationships|outline|timeline)\.yaml$/u
    .exec(path);
  if (!match || !REFERENCE_STORY_MATERIAL_KINDS.includes(
    match[1] as ReferenceStoryMaterialKind,
  )) {
    throw new Error(`Reference manifest contains an invalid Story Material path: ${path}.`);
  }
  return match[1] as ReferenceStoryMaterialKind;
}

function materialKindOrder(kind: ReferenceStoryMaterialKind): number {
  return REFERENCE_STORY_MATERIAL_KINDS.indexOf(kind);
}

function safeWorkspacePath(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.includes('\\')
    || value.startsWith('/')
    || value.endsWith('/')
    || /[\0\r\n\t]/u.test(value)
  ) {
    throw new Error('Adoption targetFile must be a workspace-relative path.');
  }
  const segments = value.split('/');
  if (segments.some((segment) =>
    !segment
    || segment === '..'
    || segment.startsWith('.')
    || !/^[\p{L}\p{N}_ -]+(?:\.[A-Za-z0-9]+)?$/u.test(segment))) {
    throw new Error(`Adoption targetFile is invalid: ${value}.`);
  }
  return segments.join('/');
}

function requireDottedPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const segments = value.split('.');
  if (segments.some((segment) =>
    !/^[\p{L}\p{N}_-]+$/u.test(segment)
    || ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw new Error(`${label} is invalid.`);
  }
  return segments.join('.');
}

function requireSafeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[\p{L}\p{N}_:.-]{1,180}$/u.test(value)
    || value.includes('..')
  ) {
    throw new Error(`${label} must be a safe identifier.`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 value.`);
  }
  return value;
}

function requireBoundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} must be non-empty and at most ${max} characters.`);
  }
  return value.trim();
}

function requireStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxChars: number,
  minItems = 0,
): string[] {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new Error(`${label} is invalid.`);
  }
  const result = value.map((item) => requireBoundedText(item, label, maxChars));
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique.`);
  return result;
}

function requireArray(value: unknown, label: string, exactLength?: number): unknown[] {
  if (!Array.isArray(value) || (exactLength !== undefined && value.length !== exactLength)) {
    throw new Error(`${label} must be an array${exactLength === undefined ? '' : ` of ${exactLength} items`}.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKnownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new Error(`${label} contains unknown fields.`);
  }
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as T[number];
}

function assertPathInside(root: string, target: string, message: string): void {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(prefix)) throw new Error(message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
