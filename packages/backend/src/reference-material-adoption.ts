import { randomUUID } from 'node:crypto';

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
  createPendingActionStore,
  createReferenceMaterialAdoptionChangeProposal,
  readRepositoryBaseline,
} from '@oh-awesome-novel/tools';
import type {
  PendingActionStore,
  PendingActionView,
  PreparedChangePreviewV1,
  SandboxPendingActionOrigin,
} from '@oh-awesome-novel/tools';
import { generateReferenceMaterialAdoption } from '@oh-awesome-novel/agent';
import type {
  ReferenceDeconstructionModelResolver,
  ReferenceMaterialAdoptionGenerationResult,
} from '@oh-awesome-novel/agent';

import {
  fingerprintCandidateProjection,
  readCandidateTargetSnapshots,
} from './candidate-snapshot.js';
import {
  assertReferenceMaterialAdoptionPreviewCurrent,
  createStoredReferenceMaterialAdoptionPreview,
  fingerprintReferenceMaterialAdoptionPreviewBinding,
  projectReferenceMaterialAdoptionPreview,
  promoteStoredReferenceMaterialAdoptionPreview,
  readStoredReferenceMaterialAdoptionPreview,
  writeStoredReferenceMaterialAdoptionPreview,
} from './reference-material-adoption-preview.js';
import type {
  ReferenceMaterialAdoptionPreviewEnvelope,
  StoredReferenceMaterialAdoptionPreview,
} from './reference-material-adoption-preview.js';

type ReferenceMaterialAdoptionOrigin = Extract<
  SandboxPendingActionOrigin,
  { kind: 'referenceMaterialAdoption' }
>;

export interface ReferenceMaterialAdoptionModelRuntime {
  providerConfig: LlmProviderConfig;
  resolveModel: ReferenceDeconstructionModelResolver;
}

export interface CreateReferenceMaterialAdoptionControllerOptions {
  getWorkspaceRoot(): string;
  getModelRuntime(): Promise<ReferenceMaterialAdoptionModelRuntime>;
  getPendingActionStore?(workspaceRoot: string): Promise<PendingActionStore>;
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
  pendingAction: PendingActionView;
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
  assertPreparedPreviewCurrent(
    previewId: string,
    origin: ReferenceMaterialAdoptionOrigin,
  ): Promise<void>;
  assertPendingActionCurrent(
    pendingActionId: string,
    origin: ReferenceMaterialAdoptionOrigin,
  ): Promise<void>;
}

export class ReferenceMaterialAdoptionRequestError extends Error {
  readonly code:
    | 'invalidRequest'
    | 'providerNotConfigured'
    | 'generationFailed'
    | 'stalePreview';

  constructor(
    message: string,
    code:
      | 'invalidRequest'
      | 'providerNotConfigured'
      | 'generationFailed'
      | 'stalePreview',
  ) {
    super(message);
    this.name = 'ReferenceMaterialAdoptionRequestError';
    this.code = code;
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

  async function getStore(workspaceRoot: string): Promise<PendingActionStore> {
    if (options.getPendingActionStore) return options.getPendingActionStore(workspaceRoot);
    return createPendingActionStore({
      workspaceRoot,
      assertOriginFresh: ({ origin, preview }) =>
        assertPreparedPreviewOriginCurrent(workspaceRoot, origin, preview),
    });
  }

  async function assertPreparedPreviewOriginCurrent(
    workspaceRoot: string,
    origin: SandboxPendingActionOrigin,
    preview: PreparedChangePreviewV1,
  ): Promise<void> {
    if (origin.kind !== 'referenceMaterialAdoption') {
      throw stalePreview('Reference Material preview has the wrong origin kind.');
    }
    const stored = await readStoredReferenceMaterialAdoptionPreview(workspaceRoot, preview.id);
    if (
      stored.id !== preview.id
      || stored.context.referenceId !== origin.referenceId
      || stored.context.manifestRevision !== origin.manifestRevision
      || stored.context.sourceChecksumSha256 !== origin.sourceChecksumSha256
      || stored.contextFingerprint !== origin.contextFingerprint
      || stored.previewFingerprint !== origin.previewFingerprint
    ) throw stalePreview('Reference Material adoption preview origin is stale.');
    projectReferenceMaterialAdoptionPreview(stored, preview);
    await assertReferenceMaterialAdoptionPreviewCurrent(workspaceRoot, stored);
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

      const decisions = generated.plan.decisions.map(({ draft: _draft, ...decision }) =>
        structuredClone(decision));
      const targetFiles = generated.plan.decisions
        .filter((decision) => decision.decision !== 'skip')
        .map((decision) => decision.targetFile);
      if (targetFiles.length === 0) return noChanges(context, decisions);

      const id = `pa_${randomUUID()}`;
      const createdAt = new Date().toISOString();
      const contextFingerprint = fingerprintReferenceMaterialAdoptionContext(context);
      const previewFingerprint = fingerprintReferenceMaterialAdoptionPreviewBinding({
        id,
        context,
        plan: generated.plan,
        createdAt,
      });
      const origin: ReferenceMaterialAdoptionOrigin = {
        kind: 'referenceMaterialAdoption',
        referenceId,
        manifestRevision: context.manifestRevision,
        sourceChecksumSha256: context.sourceChecksumSha256,
        contextFingerprint,
        previewFingerprint,
      };
      const baselineFiles = await readCandidateTargetSnapshots(workspaceRoot, targetFiles);
      const proposal = createReferenceMaterialAdoptionChangeProposal({
        adoptionContext: context,
        plan: generated.plan,
        context: {
          sessionId: `reference-adoption-${id.slice(3)}`,
          repository: await readRepositoryBaseline(workspaceRoot),
          projectionFingerprint: fingerprintCandidateProjection(baselineFiles),
          baselineFiles,
          origin,
          createdAt,
          finalizedAt: createdAt,
        },
      });
      if (!proposal) {
        return noChanges(context, decisions.map((decision) => ({
          ...decision,
          decision: 'skip' as const,
          reason: 'Generated target already matches the current workspace baseline.',
        })));
      }
      const store = await getStore(workspaceRoot);
      const prepared = await store.prepareChangePreview({
        candidate: proposal.candidate,
        origin,
        allowedTargets: proposal.allowedTargets,
        id,
        createdAt,
      });
      const stored = createStoredReferenceMaterialAdoptionPreview({
        context,
        plan: generated.plan,
        preparedChangePreview: prepared,
        createdAt,
      });
      await writeStoredReferenceMaterialAdoptionPreview(workspaceRoot, stored, { create: true });
      return {
        status: 'ready',
        preview: projectReferenceMaterialAdoptionPreview(stored, prepared),
      };
    });
  }

  async function createPendingAction(
    referenceId: string,
    previewId: string,
    input: { fingerprint: string },
  ): Promise<ReferenceMaterialAdoptionPendingActionResult> {
    return withReferenceLock(referenceId, async () => {
      const workspaceRoot = options.getWorkspaceRoot();
      const stored = await readStoredReferenceMaterialAdoptionPreview(workspaceRoot, previewId);
      if (
        stored.context.referenceId !== referenceId
        || stored.previewFingerprint !== input.fingerprint
        || stored.status !== 'prepared'
      ) throw stalePreview('Reference Material adoption preview fingerprint is stale.');
      try {
        await assertReferenceMaterialAdoptionPreviewCurrent(workspaceRoot, stored);
      } catch (error) {
        throw stalePreview(error instanceof Error ? error.message : String(error));
      }
      const store = await getStore(workspaceRoot);
      const prepared = await store.readPreparedChangePreview(previewId);
      const origin = prepared.origin;
      if (
        origin.kind !== 'referenceMaterialAdoption'
        || origin.previewFingerprint !== stored.previewFingerprint
      ) throw stalePreview('Reference Material adoption preview origin is stale.');
      const pendingAction = await store.promotePreparedChangePreview({
        id: previewId,
        title: `Adopt Story Materials from ${stored.context.referenceTitle}`,
        description: [
          `Adopt ${stored.context.targets.flatMap((target) => target.entries).length} selected Story Material entries`,
          `from reference ${stored.context.referenceId} into ${prepared.allowedTargets.length} workspace target(s).`,
          `Published warnings: ${stored.context.warnings.length}.`,
        ].join(' '),
        source: {
          kind: 'deterministic-builder',
          producer: 'reference-material-adoption',
          capability: 'reference.adopt',
        },
        origin,
        allowedTargets: prepared.allowedTargets,
      });
      await writeStoredReferenceMaterialAdoptionPreview(
        workspaceRoot,
        promoteStoredReferenceMaterialAdoptionPreview(stored, prepared, pendingAction),
      );
      return { pendingAction };
    });
  }

  async function assertPreparedPreviewCurrent(
    previewId: string,
    origin: ReferenceMaterialAdoptionOrigin,
  ): Promise<void> {
    const workspaceRoot = options.getWorkspaceRoot();
    const store = await getStoreWithoutValidator(workspaceRoot);
    const preview = await store.readPreparedChangePreview(previewId);
    if (preview.id !== previewId) {
      throw stalePreview('Reference Material adoption preview id is stale.');
    }
    await assertPreparedPreviewOriginCurrent(workspaceRoot, origin, preview);
  }

  async function assertPendingActionCurrent(
    pendingActionId: string,
    origin: ReferenceMaterialAdoptionOrigin,
  ): Promise<void> {
    const workspaceRoot = options.getWorkspaceRoot();
    const stored = await readStoredReferenceMaterialAdoptionPreview(workspaceRoot, pendingActionId);
    const store = await getStoreWithoutValidator(workspaceRoot);
    const [prepared, live] = await Promise.all([
      store.readPreparedChangePreview(pendingActionId),
      store.readView(pendingActionId),
    ]);
    if (
      stored.status !== 'promoted'
      || stored.pendingActionId !== pendingActionId
      || live.status !== 'pending'
      || live.origin?.kind !== 'referenceMaterialAdoption'
      || stableSerialize(live.origin) !== stableSerialize(origin)
      || origin.referenceId !== stored.context.referenceId
      || origin.manifestRevision !== stored.context.manifestRevision
      || origin.sourceChecksumSha256 !== stored.context.sourceChecksumSha256
      || origin.contextFingerprint !== stored.contextFingerprint
      || origin.previewFingerprint !== stored.previewFingerprint
      || fingerprintReferenceMaterialAdoptionContext(stored.context) !== stored.contextFingerprint
    ) throw stalePreview('Reference Material adoption PendingAction is stale.');
    projectReferenceMaterialAdoptionPreview(stored, prepared);
    try {
      await assertReferenceMaterialAdoptionPreviewCurrent(workspaceRoot, stored);
    } catch (error) {
      throw stalePreview(error instanceof Error ? error.message : String(error));
    }
  }

  async function getStoreWithoutValidator(workspaceRoot: string): Promise<PendingActionStore> {
    if (options.getPendingActionStore) return options.getPendingActionStore(workspaceRoot);
    return createPendingActionStore({ workspaceRoot });
  }

  return {
    readCatalog,
    createPreview,
    createPendingAction,
    assertPreparedPreviewCurrent,
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

function noChanges(
  context: Awaited<ReturnType<typeof prepareReferenceMaterialAdoptionContext>>,
  decisions: Array<Omit<ReferenceMaterialAdoptionDecision, 'draft'>>,
): ReferenceMaterialAdoptionNoChanges {
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

function stalePreview(message: string): ReferenceMaterialAdoptionRequestError {
  return new ReferenceMaterialAdoptionRequestError(message, 'stalePreview');
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
