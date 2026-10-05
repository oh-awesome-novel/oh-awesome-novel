import type { ManuscriptImportPlan } from '@oh-awesome-novel/core';
import { isDeepStrictEqual } from 'node:util';
import { createCandidateChangeSetBuilder, finalizeDeterministicChangeProposal } from './deterministic-change-producers';
import type { RepositoryBaseline } from './candidate-change-set';
import { createWorkspaceChangePolicy } from './workspace-change-policy';
import { createPendingActionStore } from './pending-action-store';
import { parsePendingActionOrigin, PendingActionProtocolError } from './pending-action-types';
import type { PendingAction, PendingActionOrigin, PreparedChangePreviewV1 } from './pending-action-types';

export const MANUSCRIPT_IMPORT_PRODUCER = 'manuscript-import';
export type ManuscriptImportOrigin = Extract<PendingActionOrigin, { kind: 'manuscriptImport' }>;

export function createManuscriptImportChangeProposal(input: {
  plan: ManuscriptImportPlan;
  previewId: string;
  repository: RepositoryBaseline;
}) {
  const { plan, previewId, repository } = input;
  const origin = parsePendingActionOrigin({ kind: 'manuscriptImport', previewId,
    sourceHash: plan.sourceHash, mappingHash: plan.mappingHash }) as ManuscriptImportOrigin;
  const allowedTargets = plan.files.map((file) => file.path);
  if (!allowedTargets.length || allowedTargets.length > 64 || new Set(allowedTargets).size !== allowedTargets.length
    || allowedTargets.some((path) => !/^chapters\/(?!0000)\d{4}\/(?!0000)\d{4}\.md$/u.test(path))) {
    throw new Error('Import requires 1–64 unique new chapter targets.');
  }
  const policy = createWorkspaceChangePolicy({ capability: 'chapter.edit', exactWritablePaths: allowedTargets });
  const builder = createCandidateChangeSetBuilder({ sessionId: previewId, producer: MANUSCRIPT_IMPORT_PRODUCER,
    capability: 'chapter.edit', repository, baselineFiles: [] });
  for (const file of plan.files) builder.write(file.path, file.content);
  return finalizeDeterministicChangeProposal({ builder, policy, origin, allowedTargets })!;
}

export function assertManuscriptImportPreview(preview: PreparedChangePreviewV1): void {
  if (preview.origin.kind !== 'manuscriptImport' || preview.origin.previewId !== preview.id
    || preview.capability !== 'chapter.edit' || preview.changes.length > 64
    || preview.allowedTargets.length !== preview.changes.length
    || preview.changes.some((change) => change.operation !== 'create'
      || !/^chapters\/(?!0000)\d{4}\/(?!0000)\d{4}\.md$/u.test(change.path))) {
    throw invalidImport();
  }
}

/** Uploads are immutable input, so freshness means the exact reviewed preview
 * and create baselines, not rereading a caller-selected host source file. */
export async function assertManuscriptImportActionFresh(workspaceRoot: string, action: PendingAction): Promise<void> {
  if (action.origin?.kind !== 'manuscriptImport' || action.source.kind !== 'deterministic-builder'
    || action.source.producer !== MANUSCRIPT_IMPORT_PRODUCER || action.source.capability !== 'chapter.edit') throw invalidImport();
  const store = await createPendingActionStore({ workspaceRoot });
  const preview = await store.readPreparedChangePreview(action.origin.previewId);
  assertManuscriptImportPreview(preview);
  if (action.id !== preview.id || !isDeepStrictEqual(action.origin, preview.origin)
    || !isDeepStrictEqual(action.repository, preview.repository) || !isDeepStrictEqual(action.allowedTargets, preview.allowedTargets)
    || !isDeepStrictEqual(action.preview, preview.preview)
    || !isDeepStrictEqual(action.changes.map(publicBinding), preview.changes.map(publicBinding))) throw invalidImport();
}

function publicBinding(change: PendingAction['changes'][number]) {
  return { operation: change.operation, path: change.path, baseline: change.baseline,
    draft: change.draft && { sha256: change.draft.sha256, byteLength: change.draft.byteLength } };
}
function invalidImport() {
  return new PendingActionProtocolError('PENDING_ACTION_ALLOWED_TARGETS_MISMATCH', 'Manuscript import no longer matches its immutable reviewed preview.');
}
