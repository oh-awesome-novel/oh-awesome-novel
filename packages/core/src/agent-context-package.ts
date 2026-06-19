import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { stringify } from 'yaml';

import type { NovelCopilotCapabilityId } from './novel-copilot-skill.js';

export type ContextBudgetLayer = 'L0' | 'L1' | 'L2' | 'L3';

export type SemanticBoundary = 'protected' | 'compressible' | 'excluded';

export const CONTEXT_SOURCE_IDS = [
  'workflow',
  'constitution',
  'chapterContract',
  'previousChapterEnding',
  'latestState',
  'characters',
  'worldRules',
  'foreshadowLedger',
  'timeline',
  'styleGuide',
  'referenceDistilled',
  'playTranscript',
] as const;

export type ContextSourceId = typeof CONTEXT_SOURCE_IDS[number];

export interface ContextSourceRef {
  sourceId: ContextSourceId | string;
  reason: string;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: SemanticBoundary;
  path?: string;
  title?: string;
}

export type ContextTraceType =
  | 'workspaceSnapshot'
  | 'toolCall'
  | 'userSelectedContext'
  | 'omittedSource'
  | 'compression';

export type ContextTraceOutcome =
  | 'selected'
  | 'omitted'
  | 'compressed'
  | 'read'
  | 'pendingAction'
  | 'failed';

export interface ContextTraceEntry {
  id: string;
  type: ContextTraceType;
  reason: string;
  outcome: ContextTraceOutcome;
  createdAt: string;
  sourceId?: ContextSourceId | string;
  toolName?: string;
  path?: string;
  budgetLayer?: ContextBudgetLayer;
  semanticBoundary?: SemanticBoundary;
}

export interface MinimalMemory {
  characters: string[];
  hooks: string[];
  worldRules: string[];
  recentFacts: string[];
  styleNotes: string[];
}

export interface RuleStackEntry {
  id: string;
  label: string;
  priority: number;
  sourceId?: ContextSourceId | string;
}

export interface ContextPackage {
  id: string;
  capability: NovelCopilotCapabilityId;
  createdAt: string;
  selected: ContextSourceRef[];
  omitted: ContextSourceRef[];
  trace: ContextTraceEntry[];
  minimalMemory: MinimalMemory;
  ruleStack: RuleStackEntry[];
}

export interface MinimalMemoryInput {
  characters?: string[];
  hooks?: string[];
  worldRules?: string[];
  recentFacts?: string[];
  styleNotes?: string[];
}

export interface CreateContextPackageDraftInput {
  id?: string;
  capability: NovelCopilotCapabilityId;
  createdAt?: string;
  selected?: ContextSourceRef[];
  omitted?: ContextSourceRef[];
  trace?: ContextTraceEntry[];
  minimalMemory?: MinimalMemoryInput;
  ruleStack?: RuleStackEntry[];
}

export interface WriteContextPackageArtifactInput {
  workspaceRoot: string;
  sessionId: string;
  contextPackage: ContextPackage;
}

export const createContextPackageDraft = (
  input: CreateContextPackageDraftInput,
): ContextPackage => {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const contextPackage: ContextPackage = {
    id: input.id ?? createContextPackageId(createdAt),
    capability: input.capability,
    createdAt,
    selected: input.selected?.map(assertContextSourceRef) ?? [],
    omitted: input.omitted?.map(assertContextSourceRef) ?? [],
    trace: input.trace?.map(assertContextTraceEntry) ?? [],
    minimalMemory: deriveMinimalMemory(input.minimalMemory),
    ruleStack: [...(input.ruleStack ?? [])],
  };

  return assertContextPackage(contextPackage);
};

export const addSelectedSource = (
  contextPackage: ContextPackage,
  source: ContextSourceRef,
): ContextPackage =>
  assertContextPackage({
    ...contextPackage,
    selected: [...contextPackage.selected, assertContextSourceRef(source)],
    trace: contextPackage.trace ?? [],
  });

export const addOmittedSource = (
  contextPackage: ContextPackage,
  source: ContextSourceRef,
): ContextPackage =>
  assertContextPackage({
    ...contextPackage,
    omitted: [...contextPackage.omitted, assertContextSourceRef(source)],
    trace: contextPackage.trace ?? [],
  });

export const deriveMinimalMemory = (
  input: MinimalMemoryInput = {},
): MinimalMemory => ({
  characters: dedupeCompact(input.characters),
  hooks: dedupeCompact(input.hooks),
  worldRules: dedupeCompact(input.worldRules),
  recentFacts: dedupeCompact(input.recentFacts),
  styleNotes: dedupeCompact(input.styleNotes),
});

export const formatContextPackageSummary = (
  contextPackage: ContextPackage,
): string => {
  const selected = contextPackage.selected.length
    ? contextPackage.selected.map(formatSourceRef).join('\n')
    : '- none';
  const omitted = contextPackage.omitted.length
    ? contextPackage.omitted.map(formatSourceRef).join('\n')
    : '- none';
  const trace = contextPackage.trace?.length
    ? contextPackage.trace.map(formatTraceEntry).join('\n')
    : '- none';

  return [
    `Context Package: ${contextPackage.id}`,
    `Capability: ${contextPackage.capability}`,
    '',
    'Selected sources:',
    selected,
    '',
    'Omitted sources:',
    omitted,
    '',
    'Trace:',
    trace,
    '',
    'Minimal memory:',
    `- characters: ${formatInlineList(contextPackage.minimalMemory.characters)}`,
    `- hooks: ${formatInlineList(contextPackage.minimalMemory.hooks)}`,
    `- worldRules: ${formatInlineList(contextPackage.minimalMemory.worldRules)}`,
    `- recentFacts: ${formatInlineList(contextPackage.minimalMemory.recentFacts)}`,
    `- styleNotes: ${formatInlineList(contextPackage.minimalMemory.styleNotes)}`,
  ].join('\n');
};

export const writeContextPackageArtifact = async (
  input: WriteContextPackageArtifactInput,
): Promise<string> => {
  const filePath = resolveContextPackageArtifactPath(
    input.workspaceRoot,
    input.sessionId,
  );
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, stringify(input.contextPackage), 'utf-8');

  return filePath;
};

export const resolveContextPackageArtifactPath = (
  workspaceRoot: string,
  sessionId: string,
): string => {
  assertSafeSessionId(sessionId);

  const workspace = resolve(workspaceRoot);
  const artifactPath = resolve(
    workspace,
    '.workspace',
    'sessions',
    sessionId,
    'context-package.yaml',
  );
  const artifactRelativePath = relative(workspace, artifactPath);

  if (
    artifactRelativePath.startsWith('..') ||
    artifactRelativePath === '' ||
    artifactRelativePath.includes(`..${sep}`)
  ) {
    throw new Error('Context package artifact must stay inside workspace.');
  }

  return artifactPath;
};

function assertContextPackage(contextPackage: ContextPackage): ContextPackage {
  for (const source of [...contextPackage.selected, ...contextPackage.omitted]) {
    assertContextSourceRef(source);
  }

  for (const trace of contextPackage.trace ?? []) {
    assertContextTraceEntry(trace);
  }

  return contextPackage;
}

function assertContextSourceRef(source: ContextSourceRef): ContextSourceRef {
  if (!source.reason.trim()) {
    throw new Error(`Context source ${source.sourceId} requires a reason.`);
  }

  return {
    ...source,
    reason: source.reason.trim(),
  };
}

function assertContextTraceEntry(trace: ContextTraceEntry): ContextTraceEntry {
  if (!trace.id.trim()) {
    throw new Error('Context trace entry requires an id.');
  }

  if (!trace.reason.trim()) {
    throw new Error(`Context trace ${trace.id} requires a reason.`);
  }

  return {
    ...trace,
    id: trace.id.trim(),
    reason: trace.reason.trim(),
  };
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) {
    throw new Error('Invalid session id for context package artifact.');
  }

  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    throw new Error('Invalid session id for context package artifact.');
  }
}

function createContextPackageId(createdAt: string): string {
  return `ctx-${createdAt.replaceAll(/[^A-Za-z0-9]/g, '').slice(0, 20)}`;
}

function dedupeCompact(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function formatSourceRef(source: ContextSourceRef): string {
  const path = source.path ? ` path=${source.path}` : '';
  return `- ${source.sourceId} [${source.budgetLayer}/${source.semanticBoundary}]${path}: ${source.reason}`;
}

function formatTraceEntry(trace: ContextTraceEntry): string {
  const source = trace.sourceId ? ` ${trace.sourceId}` : '';
  const tool = trace.toolName ? ` tool=${trace.toolName}` : '';
  const path = trace.path ? ` path=${trace.path}` : '';
  const boundary = trace.budgetLayer && trace.semanticBoundary
    ? ` [${trace.budgetLayer}/${trace.semanticBoundary}]`
    : '';

  return `- ${trace.type}/${trace.outcome}${source}${boundary}${tool}${path}: ${trace.reason}`;
}

function formatInlineList(values: string[]): string {
  return values.length ? values.join('; ') : 'none';
}
