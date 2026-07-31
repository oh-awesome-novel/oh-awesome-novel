import {
  fingerprintReferenceMaterialAdoptionContext,
  prepareReferenceMaterialAdoptionContext,
  readReferenceMaterialAdoptionCatalog,
} from '@oh-awesome-novel/core';
import type {
  LlmProviderConfig,
  ReferenceMaterialAdoptionCatalog,
  ReferenceMaterialAdoptionDecision,
  ReferenceMaterialAdoptionSelection,
} from '@oh-awesome-novel/core';
import {
  createReferenceMaterialAdoptionPatches,
  prepareWriteIntentPreview,
  promoteWriteIntentPreview,
  readPendingAction,
} from '@oh-awesome-novel/tools';
import type {
  ReferenceMaterialAdoptionPendingActionOrigin,
  WriteIntentPendingAction,
} from '@oh-awesome-novel/tools';
import {
  generateReferenceMaterialAdoption,
} from '@oh-awesome-novel/agent';
import type {
  ReferenceDeconstructionModelResolver,
  ReferenceMaterialAdoptionGenerationResult,
} from '@oh-awesome-novel/agent';

import {
  assertReferenceMaterialAdoptionPreviewCurrent,
  createStoredReferenceMaterialAdoptionPreview,
  projectReferenceMaterialAdoptionPreview,
  promoteStoredReferenceMaterialAdoptionPreview,
  readStoredReferenceMaterialAdoptionPreview,
  writeStoredReferenceMaterialAdoptionPreview,
} from './reference-material-adoption-preview.js';
import type {
  ReferenceMaterialAdoptionPreviewEnvelope,
  StoredReferenceMaterialAdoptionPreview,
} from './reference-material-adoption-preview.js';

export interface ReferenceMaterialAdoptionModelRuntime {
  providerConfig: LlmProviderConfig;
  resolveModel: ReferenceDeconstructionModelResolver;
}

export interface CreateReferenceMaterialAdoptionControllerOptions {
  getWorkspaceRoot(): string;
  getModelRuntime(): Promise<ReferenceMaterialAdoptionModelRuntime>;
  runAdoption?: (
    input: Parameters<typeof generateReferenceMaterialAdoption>[0],
  ) => Promise<ReferenceMaterialAdoptionGenerationResult>;
}

export interface ReferenceMaterialAdoptionNoChanges {
  status: 'noChanges';
  referenceId: string;
  referenceTitle: string;
  catalogFingerprint: string;
  decisions: Array<Omit<ReferenceMaterialAdoptionDecision, 'draft'>>;
  warnings: ReferenceMaterialAdoptionCatalog['warnings'];
  canonicalUnchanged: true;
}

export type ReferenceMaterialAdoptionPreviewResult =
  | { status: 'ready'; preview: ReferenceMaterialAdoptionPreviewEnvelope }
  | ReferenceMaterialAdoptionNoChanges;

export interface ReferenceMaterialAdoptionPendingActionResult {
  pendingAction: Pick<WriteIntentPendingAction,
    'id' | 'title' | 'description' | 'touchedFiles' | 'diff' | 'createdAt' | 'status'>;
}

export interface ReferenceMaterialAdoptionController {
  readCatalog(referenceId: string): Promise<{ catalog: ReferenceMaterialAdoptionCatalog }>;
  createPreview(
    referenceId: string,
    input: {
      catalogFingerprint: string;
      selections: readonly ReferenceMaterialAdoptionSelection[];
    },
  ): Promise<ReferenceMaterialAdoptionPreviewResult>;
  createPendingAction(
    referenceId: string,
    previewId: string,
    input: { fingerprint: string },
  ): Promise<ReferenceMaterialAdoptionPendingActionResult>;
  assertPendingActionCurrent(
    pendingActionId: string,
    origin: ReferenceMaterialAdoptionPendingActionOrigin,
  ): Promise<void>;
}

export class ReferenceMaterialAdoptionRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalidRequest'
      | 'providerNotConfigured'
      | 'generationFailed'
      | 'stalePreview',
  ) {
    super(message);
    this.name = 'ReferenceMaterialAdoptionRequestError';
  }
}

export function createReferenceMaterialAdoptionController(
  options: CreateReferenceMaterialAdoptionControllerOptions,
): ReferenceMaterialAdoptionController {
  const runAdoption = options.runAdoption ?? generateReferenceMaterialAdoption;
  const locks = new Map<string, Promise<void>>();

  async function withReferenceLock<T>(referenceId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${options.getWorkspaceRoot()}\u0000${referenceId}`;
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === tail) locks.delete(key);
    }
  }

  async function readCatalog(referenceId: string) {
    return {
      catalog: await readReferenceMaterialAdoptionCatalog(
        options.getWorkspaceRoot(),
        referenceId,
      ),
    };
  }

  async function createPreview(
    referenceId: string,
    input: {
      catalogFingerprint: string;
      selections: readonly ReferenceMaterialAdoptionSelection[];
    },
  ): Promise<ReferenceMaterialAdoptionPreviewResult> {
    return withReferenceLock(referenceId, async () => {
      const workspaceRoot = options.getWorkspaceRoot();
      const context = await prepareReferenceMaterialAdoptionContext({
        workspaceRoot,
        referenceId,
        catalogFingerprint: input.catalogFingerprint,
        selections: input.selections,
      });
      let runtime: ReferenceMaterialAdoptionModelRuntime;
      try {
        runtime = await options.getModelRuntime();
      } catch (error) {
        throw new ReferenceMaterialAdoptionRequestError(
          error instanceof Error ? error.message : String(error),
          'providerNotConfigured',
        );
      }
      const generated = await runAdoption({
        context,
        providerConfig: runtime.providerConfig,
        resolveModel: runtime.resolveModel,
      });
      if (generated.status !== 'completed') {
        throw new ReferenceMaterialAdoptionRequestError(
          generated.status === 'failed'
            ? generated.error.message
            : generated.reason ?? 'Reference Material adoption was aborted.',
          'generationFailed',
        );
      }
      const patches = createReferenceMaterialAdoptionPatches(context, generated.plan);
      const decisions = generated.plan.decisions.map(({ draft: _draft, ...decision }) =>
        structuredClone(decision));
      if (!patches.length) {
        return {
          status: 'noChanges',
          referenceId: context.referenceId,
          referenceTitle: context.referenceTitle,
          catalogFingerprint: context.catalogFingerprint,
          decisions,
          warnings: structuredClone(context.warnings),
          canonicalUnchanged: true,
        };
      }
      const prepared = await prepareWriteIntentPreview({
        workspaceRoot,
        toolName: 'reference.adoptMaterials',
        args: {
          title: `Adopt Story Materials from ${context.referenceTitle}`,
          description: [
            `Adopt ${context.targets.flatMap((target) => target.entries).length} selected Story Material entries`,
            `from reference ${context.referenceId} into ${patches.length} workspace target(s).`,
            `Published warnings: ${context.warnings.length}.`,
          ].join(' '),
          patches,
        },
      });
      if (!prepared.diff.trim()) {
        return {
          status: 'noChanges',
          referenceId: context.referenceId,
          referenceTitle: context.referenceTitle,
          catalogFingerprint: context.catalogFingerprint,
          decisions: decisions.map((decision) => ({
            ...decision,
            decision: 'skip' as const,
            reason: 'Generated target already matches the current workspace baseline.',
          })),
          warnings: structuredClone(context.warnings),
          canonicalUnchanged: true,
        };
      }
      const stored = createStoredReferenceMaterialAdoptionPreview({
        context,
        plan: generated.plan,
        preparedWriteIntent: prepared,
      });
      await writeStoredReferenceMaterialAdoptionPreview(workspaceRoot, stored, {
        create: true,
      });
      return { status: 'ready', preview: projectReferenceMaterialAdoptionPreview(stored) };
    });
  }

  async function createPendingAction(
    referenceId: string,
    previewId: string,
    input: { fingerprint: string },
  ): Promise<ReferenceMaterialAdoptionPendingActionResult> {
    return withReferenceLock(referenceId, async () => {
      const workspaceRoot = options.getWorkspaceRoot();
      const stored = await readStoredReferenceMaterialAdoptionPreview(
        workspaceRoot,
        previewId,
      );
      if (
        stored.context.referenceId !== referenceId
        || stored.previewFingerprint !== input.fingerprint
        || stored.status !== 'prepared'
      ) {
        throw new ReferenceMaterialAdoptionRequestError(
          'Reference Material adoption preview fingerprint is stale.',
          'stalePreview',
        );
      }
      try {
        await assertReferenceMaterialAdoptionPreviewCurrent(workspaceRoot, stored);
      } catch (error) {
        throw new ReferenceMaterialAdoptionRequestError(
          error instanceof Error ? error.message : String(error),
          'stalePreview',
        );
      }
      const origin: ReferenceMaterialAdoptionPendingActionOrigin = {
        kind: 'referenceMaterialAdoption',
        referenceId,
        manifestRevision: stored.context.manifestRevision,
        sourceChecksumSha256: stored.context.sourceChecksumSha256,
        catalogFingerprint: stored.context.catalogFingerprint,
        contextFingerprint: stored.contextFingerprint,
        previewFingerprint: stored.previewFingerprint,
      };
      const pendingAction = await promoteWriteIntentPreview({
        workspaceRoot,
        preview: stored.preparedWriteIntent,
        origin,
      });
      await writeStoredReferenceMaterialAdoptionPreview(
        workspaceRoot,
        promoteStoredReferenceMaterialAdoptionPreview(stored, pendingAction),
      );
      return {
        pendingAction: {
          id: pendingAction.id,
          title: pendingAction.title,
          description: pendingAction.description,
          touchedFiles: [...pendingAction.touchedFiles],
          diff: pendingAction.diff,
          createdAt: pendingAction.createdAt,
          status: pendingAction.status,
        },
      };
    });
  }

  async function assertPendingActionCurrent(
    pendingActionId: string,
    origin: ReferenceMaterialAdoptionPendingActionOrigin,
  ): Promise<void> {
    const workspaceRoot = options.getWorkspaceRoot();
    const stored = await readStoredReferenceMaterialAdoptionPreview(
      workspaceRoot,
      pendingActionId,
    );
    const live = await readPendingAction({ workspaceRoot, id: pendingActionId });
    if (
      stored.status !== 'promoted'
      || !stored.pendingAction
      || live.status !== 'pending'
      || live.origin?.kind !== 'referenceMaterialAdoption'
      || stableSerialize(live) !== stableSerialize(stored.pendingAction)
      || origin.referenceId !== stored.context.referenceId
      || origin.manifestRevision !== stored.context.manifestRevision
      || origin.sourceChecksumSha256 !== stored.context.sourceChecksumSha256
      || origin.catalogFingerprint !== stored.context.catalogFingerprint
      || origin.contextFingerprint !== stored.contextFingerprint
      || origin.previewFingerprint !== stored.previewFingerprint
      || fingerprintReferenceMaterialAdoptionContext(stored.context)
        !== stored.contextFingerprint
    ) {
      throw new ReferenceMaterialAdoptionRequestError(
        'Reference Material adoption PendingAction is stale.',
        'stalePreview',
      );
    }
    try {
      await assertReferenceMaterialAdoptionPreviewCurrent(workspaceRoot, stored);
    } catch (error) {
      throw new ReferenceMaterialAdoptionRequestError(
        error instanceof Error ? error.message : String(error),
        'stalePreview',
      );
    }
  }

  return {
    readCatalog,
    createPreview,
    createPendingAction,
    assertPendingActionCurrent,
  };
}

export function toReferenceMaterialAdoptionErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (error instanceof ReferenceMaterialAdoptionRequestError) {
    return {
      status: error.code === 'stalePreview' ? 409 : error.code === 'providerNotConfigured' ? 422 : 400,
      body: { error: error.message, code: error.code },
    };
  }
  const code = (error as NodeJS.ErrnoException).code;
  return {
    status: code === 'ENOENT' ? 404 : 422,
    body: {
      error: error instanceof Error ? error.message : String(error),
      code: code === 'ENOENT' ? 'notFound' : 'validationFailed',
    },
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
