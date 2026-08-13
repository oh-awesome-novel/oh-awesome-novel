import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  CANDIDATE_CHANGE_SET_SCHEMA_VERSION,
  assertValidTextContent,
  fingerprintCandidateChanges,
  sha256Text,
} from './candidate-change-set';
import type {
  CandidateChangeSet,
  CandidateFileChange,
  RepositoryBaseline,
} from './candidate-change-set';
import { renderCandidateChangeDiff } from './change-diff';
import { assertRepositoryBaseline as assertGitRepositoryBaseline } from './git-integration';
import {
  createPendingActionDecisionReceipt,
  isAllowedDecisionReceiptTransition,
  parsePendingActionDecisionReceipt,
} from './pending-action-decision-receipt';
import type {
  CreatePendingActionDecisionReceiptInput,
  PendingActionDecisionReceipt,
} from './pending-action-decision-receipt';
import {
  PENDING_ACTION_SCHEMA_VERSION,
  PENDING_ACTION_TERMINAL_SCHEMA_VERSION,
  PREPARED_CHANGE_PREVIEW_SCHEMA_VERSION,
  PendingActionProtocolError,
  assertCanonicalIsoTimestamp,
  assertCanonicalTargetPath,
  assertOpaquePendingActionId,
  assertSha256,
  parseAllowedTargets,
  parsePendingAction,
  parsePendingActionOrigin,
  parsePendingActionSource,
  parsePendingActionTerminal,
  parsePreparedChangePreview,
  parsePreparedChangePreviewPromotion,
  parseRepositoryBaseline,
  stableProtocolSerialize,
} from './pending-action-types';
import type {
  DraftArtifact,
  PendingAction,
  PendingActionOrigin,
  PendingActionRecord,
  PendingActionSource,
  PendingActionTerminalRecord,
  PendingActionView,
  PendingFileChange,
  PreparedChangePreviewPromotion,
  PreparedChangePreviewV1,
} from './pending-action-types';

const ENGINE_RELATIVE_ROOT = ['.workspace', 'change-engine', 'v1'] as const;
const MAX_STORED_JSON_BYTES = 16 * 1024 * 1024;
const LOCK_RETRY_MS = 10;
const LOCK_MAX_ATTEMPTS = 3_000;
const LOCK_STALE_MS = 60_000;

export interface PendingActionStoreOptions {
  workspaceRoot: string;
  repositoryValidator?: (
    workspaceRoot: string,
    expected: RepositoryBaseline,
  ) => Promise<void>;
  assertOriginFresh?: (input: {
    workspaceRoot: string;
    origin: PendingActionOrigin;
    preview: PreparedChangePreviewV1;
  }) => Promise<void>;
  now?: () => Date;
  idFactory?: () => string;
  /** Test/embedding seam; defaults to this process' PID. */
  lockOwnerPid?: number;
  /** Test/embedding seam; production defaults to the bounded retry window. */
  lockMaxAttempts?: number;
}

export interface ProposePendingActionInput {
  candidate: CandidateChangeSet;
  title: string;
  description: string;
  id?: string;
  origin?: PendingActionOrigin;
  createdAt?: string;
}

export interface PrepareChangePreviewInput {
  candidate: CandidateChangeSet;
  origin: PendingActionOrigin;
  allowedTargets: readonly string[];
  id?: string;
  createdAt?: string;
}

export interface PromotePreparedChangePreviewInput {
  id: string;
  title: string;
  description: string;
  source: PendingActionSource;
  origin: PendingActionOrigin;
  allowedTargets: readonly string[];
  createdAt?: string;
}

export interface WritePendingActionTerminalInput {
  actionId: string;
  decision: 'accepted' | 'rejected';
  decisionReceiptId: string;
  decidedAt?: string;
}

export interface PendingActionListOptions {
  status?: PendingActionRecord['status'];
}

export interface LockedPendingActionAccess {
  readAction(): Promise<PendingAction>;
  readRecord(): Promise<PendingActionRecord>;
  readDraft(changeIndex: number): Promise<string>;
  writeTerminal(
    input: Omit<WritePendingActionTerminalInput, 'actionId'>,
  ): Promise<PendingActionTerminalRecord>;
  writeDecisionReceipt(
    receipt: PendingActionDecisionReceipt,
  ): Promise<PendingActionDecisionReceipt>;
}

export interface PendingActionStore {
  readonly workspaceRoot: string;
  proposeCandidate(input: ProposePendingActionInput): Promise<PendingActionView>;
  prepareChangePreview(input: PrepareChangePreviewInput): Promise<PreparedChangePreviewV1>;
  promotePreparedChangePreview(
    input: PromotePreparedChangePreviewInput,
  ): Promise<PendingActionView>;
  readPreparedChangePreview(id: string): Promise<PreparedChangePreviewV1>;
  readAction(id: string): Promise<PendingAction>;
  readRecord(id: string): Promise<PendingActionRecord>;
  readView(id: string): Promise<PendingActionView>;
  listRecords(options?: PendingActionListOptions): Promise<PendingActionRecord[]>;
  listViews(options?: PendingActionListOptions): Promise<PendingActionView[]>;
  writeTerminal(
    input: WritePendingActionTerminalInput,
  ): Promise<PendingActionTerminalRecord>;
  readDecisionReceipt(actionId: string): Promise<PendingActionDecisionReceipt | undefined>;
  writeDecisionReceipt(
    receipt: PendingActionDecisionReceipt,
  ): Promise<PendingActionDecisionReceipt>;
  withActionLock<T>(
    actionId: string,
    operation: (access: LockedPendingActionAccess) => Promise<T>,
  ): Promise<T>;
  withMaterializationLocks<T>(
    actionId: string,
    operation: (access: LockedPendingActionAccess) => Promise<T>,
  ): Promise<T>;
}

export async function createPendingActionStore(
  options: PendingActionStoreOptions,
): Promise<PendingActionStore> {
  const workspaceRoot = await realpath(options.workspaceRoot);
  const information = await lstat(workspaceRoot);
  if (!information.isDirectory()) {
    throw new Error(`PendingAction workspace is not a directory: ${workspaceRoot}`);
  }
  return new FilePendingActionStore(workspaceRoot, options);
}

class FilePendingActionStore implements PendingActionStore {
  readonly workspaceRoot: string;
  readonly #repositoryValidator: NonNullable<PendingActionStoreOptions['repositoryValidator']>;
  readonly #originValidator: PendingActionStoreOptions['assertOriginFresh'];
  readonly #lockOwnerPid: number;
  readonly #lockMaxAttempts: number;
  readonly #now: () => Date;
  readonly #idFactory: () => string;

  constructor(workspaceRoot: string, options: PendingActionStoreOptions) {
    this.workspaceRoot = workspaceRoot;
    this.#repositoryValidator = options.repositoryValidator ?? assertGitRepositoryBaseline;
    this.#originValidator = options.assertOriginFresh;
    this.#lockOwnerPid = options.lockOwnerPid ?? process.pid;
    this.#lockMaxAttempts = options.lockMaxAttempts ?? LOCK_MAX_ATTEMPTS;
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => `pa_${randomUUID()}`);
  }

  async proposeCandidate(input: ProposePendingActionInput): Promise<PendingActionView> {
    const candidate = parseStrictCandidateChangeSet(input.candidate);
    const id = assertOpaquePendingActionId(input.id ?? this.#idFactory());
    return this.#withNamedLock(`locks/actions/${id}.lock`, async () => {
      await this.#assertActionIdentityAvailable(id);
      const action = await this.#persistCandidateAsAction({
        candidate,
        id,
        title: input.title,
        description: input.description,
        ...(input.origin === undefined
          ? {}
          : { origin: parsePendingActionOrigin(input.origin) }),
        createdAt: normalizeTimestamp(input.createdAt, this.#now),
      });
      return pendingActionView({ action, status: 'pending' });
    });
  }

  async prepareChangePreview(
    input: PrepareChangePreviewInput,
  ): Promise<PreparedChangePreviewV1> {
    const candidate = parseStrictCandidateChangeSet(input.candidate);
    const id = assertOpaquePendingActionId(input.id ?? this.#idFactory());
    const origin = parsePendingActionOrigin(input.origin);
    const allowedTargets = normalizeAllowedTargetInput(input.allowedTargets);
    assertChangesAllowed(candidate.changes, allowedTargets, id);

    return this.#withNamedLock(`locks/actions/${id}.lock`, async () => {
      await this.#assertActionIdentityAvailable(id);
      await this.#assertPreviewIdentityAvailable(id);
      await this.#validateRepository(candidate.repository);
      const oldContents = await this.#validateCandidateBaselines(candidate.changes);
      const diff = renderCandidateDiff(candidate.changes, oldContents);
      const changes = candidate.changes.map((change, index) => toStoredChange(
        change,
        `previews/${id}/drafts/${index}.txt`,
      ));
      await this.#persistCandidateDrafts(candidate.changes, changes, true);

      const preview = parsePreparedChangePreview({
        schemaVersion: PREPARED_CHANGE_PREVIEW_SCHEMA_VERSION,
        kind: 'prepared-change-preview',
        id,
        capability: candidate.source.capability,
        candidateFingerprint: fingerprintCandidateChanges(candidate.changes),
        repository: structuredClone(candidate.repository),
        origin: structuredClone(origin),
        allowedTargets,
        changes,
        preview: { diff, diffHash: sha256Text(diff) },
        createdAt: normalizeTimestamp(input.createdAt, this.#now),
      }, id);
      await this.#writeImmutableJson(this.#previewManifestPath(id), preview);
      return preview;
    });
  }

  async promotePreparedChangePreview(
    input: PromotePreparedChangePreviewInput,
  ): Promise<PendingActionView> {
    const id = assertOpaquePendingActionId(input.id, 'Prepared preview id');
    const expectedOrigin = parsePendingActionOrigin(input.origin);
    const expectedTargets = normalizeAllowedTargetInput(input.allowedTargets);
    const source = parsePendingActionSource(input.source);

    return this.#withNamedLock(`locks/actions/${id}.lock`, async () => {
      const preview = await this.#readPreparedChangePreviewUnlocked(id);
      if (stableProtocolSerialize(preview.origin) !== stableProtocolSerialize(expectedOrigin)) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
          `Prepared preview ${id} origin does not match the trusted promotion request.`,
        );
      }
      if (stableProtocolSerialize(preview.allowedTargets) !== stableProtocolSerialize(expectedTargets)) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
          `Prepared preview ${id} allowed targets changed before promotion.`,
        );
      }
      if (source.capability !== preview.capability) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
          `Prepared preview ${id} capability changed before promotion.`,
        );
      }
      assertChangesAllowed(preview.changes, expectedTargets, id);
      await this.#validateRepository(preview.repository);
      if (!this.#originValidator) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_ORIGIN_VALIDATOR_REQUIRED',
          `Prepared preview ${id} requires an origin freshness validator.`,
        );
      }
      await this.#originValidator({
        workspaceRoot: this.workspaceRoot,
        origin: preview.origin,
        preview,
      });
      await this.#validatePendingBaselines(preview.changes);
      const hydrated = await this.#hydrateChanges(preview.changes);
      const actualFingerprint = fingerprintCandidateChanges(hydrated);
      if (actualFingerprint !== preview.candidateFingerprint) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_DRAFT_INTEGRITY_ERROR',
          `Prepared preview ${id} candidate fingerprint is invalid.`,
        );
      }

      const existingPromotion = await this.#readPromotionIfPresent(id);
      if (existingPromotion) {
        return this.#validateExistingPromotion(existingPromotion, preview, source);
      }

      let action = await this.#readActionIfPresent(id);
      if (action) {
        await this.#assertActionMatchesPreview(action, preview, source);
      } else {
        await this.#assertActionIdentityAvailable(id, { allowPreview: true });
        const actionChanges = preview.changes.map((change, index) => ({
          ...structuredClone(change),
          ...(change.draft === null
            ? { draft: null }
            : {
                draft: {
                  ...structuredClone(change.draft),
                  relativePath: `drafts/${id}/${index}.txt`,
                },
              }),
        })) as PendingFileChange[];
        await this.#persistHydratedDrafts(hydrated, actionChanges);
        action = parsePendingAction({
          schemaVersion: PENDING_ACTION_SCHEMA_VERSION,
          kind: 'pending-action',
          id,
          title: input.title,
          description: input.description,
          createdAt: normalizeTimestamp(input.createdAt, this.#now),
          source,
          repository: structuredClone(preview.repository),
          allowedTargets: structuredClone(preview.allowedTargets),
          changes: actionChanges,
          preview: structuredClone(preview.preview),
          origin: structuredClone(preview.origin),
        }, id);
        await this.#writeImmutableJson(this.#pendingPath(id), action);
      }

      const promotion = parsePreparedChangePreviewPromotion({
        schemaVersion: 1,
        kind: 'prepared-change-preview-promotion',
        previewId: id,
        actionId: action.id,
        candidateFingerprint: preview.candidateFingerprint,
        promotedAt: this.#now().toISOString(),
      }, id);
      await this.#writeImmutableJson(this.#promotionPath(id), promotion);
      return pendingActionView({ action, status: 'pending' });
    });
  }

  async readPreparedChangePreview(id: string): Promise<PreparedChangePreviewV1> {
    return this.#readPreparedChangePreviewUnlocked(assertOpaquePendingActionId(id));
  }

  async readAction(id: string): Promise<PendingAction> {
    return this.#readActionUnlocked(assertOpaquePendingActionId(id));
  }

  async readRecord(id: string): Promise<PendingActionRecord> {
    return this.#readRecordUnlocked(assertOpaquePendingActionId(id));
  }

  async readView(id: string): Promise<PendingActionView> {
    const actionId = assertOpaquePendingActionId(id);
    const record = await this.#readRecordUnlocked(actionId);
    const receipt = record.status === 'pending'
      ? undefined
      : await this.#readDecisionReceiptUnlocked(actionId);
    return pendingActionView(record, receipt);
  }

  async listRecords(
    options: PendingActionListOptions = {},
  ): Promise<PendingActionRecord[]> {
    const directory = await this.#ensureEngineDirectory(['pending']);
    const entries = await readdir(directory, { withFileTypes: true });
    const records: PendingActionRecord[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name.endsWith('.tmp')) continue;
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_CORRUPT',
          `Unexpected entry in PendingAction proposal directory: ${entry.name}`,
        );
      }
      const id = assertOpaquePendingActionId(basename(entry.name, '.json'));
      const record = await this.#readRecordUnlocked(id);
      if (options.status === undefined || record.status === options.status) records.push(record);
    }
    return records.sort((left, right) => (
      left.action.createdAt.localeCompare(right.action.createdAt)
      || left.action.id.localeCompare(right.action.id)
    ));
  }

  async listViews(
    options: PendingActionListOptions = {},
  ): Promise<PendingActionView[]> {
    const records = await this.listRecords(options);
    return Promise.all(records.map(async (record) => {
      const receipt = record.status === 'pending'
        ? undefined
        : await this.#readDecisionReceiptUnlocked(record.action.id);
      return pendingActionView(record, receipt);
    }));
  }

  async writeTerminal(
    input: WritePendingActionTerminalInput,
  ): Promise<PendingActionTerminalRecord> {
    const actionId = assertOpaquePendingActionId(input.actionId);
    return this.#withNamedLock(`locks/actions/${actionId}.lock`, () => (
      this.#writeTerminalUnlocked({ ...input, actionId })
    ));
  }

  async readDecisionReceipt(
    actionId: string,
  ): Promise<PendingActionDecisionReceipt | undefined> {
    return this.#readDecisionReceiptUnlocked(assertOpaquePendingActionId(actionId));
  }

  async writeDecisionReceipt(
    receipt: PendingActionDecisionReceipt,
  ): Promise<PendingActionDecisionReceipt> {
    const parsed = parsePendingActionDecisionReceipt(receipt);
    return this.#withNamedLock(`locks/actions/${parsed.actionId}.lock`, () => (
      this.#writeDecisionReceiptUnlocked(parsed)
    ));
  }

  async withActionLock<T>(
    actionId: string,
    operation: (access: LockedPendingActionAccess) => Promise<T>,
  ): Promise<T> {
    const id = assertOpaquePendingActionId(actionId);
    return this.#withNamedLock(`locks/actions/${id}.lock`, () => operation(
      this.#lockedAccess(id),
    ));
  }

  async withMaterializationLocks<T>(
    actionId: string,
    operation: (access: LockedPendingActionAccess) => Promise<T>,
  ): Promise<T> {
    const id = assertOpaquePendingActionId(actionId);
    return this.#withNamedLock(`locks/actions/${id}.lock`, () => (
      this.#withNamedLock('locks/apply.lock', () => operation(this.#lockedAccess(id)))
    ));
  }

  #lockedAccess(actionId: string): LockedPendingActionAccess {
    return {
      readAction: () => this.#readActionUnlocked(actionId),
      readRecord: () => this.#readRecordUnlocked(actionId),
      readDraft: (index) => this.#readActionDraftUnlocked(actionId, index),
      writeTerminal: (input) => this.#writeTerminalUnlocked({ ...input, actionId }),
      writeDecisionReceipt: (receipt) => this.#writeDecisionReceiptUnlocked(
        parsePendingActionDecisionReceipt(receipt, actionId),
      ),
    };
  }

  async #persistCandidateAsAction(input: {
    candidate: CandidateChangeSet;
    id: string;
    title: string;
    description: string;
    origin?: PendingActionOrigin;
    createdAt: string;
  }): Promise<PendingAction> {
    await this.#validateRepository(input.candidate.repository);
    const oldContents = await this.#validateCandidateBaselines(input.candidate.changes);
    const diff = renderCandidateDiff(input.candidate.changes, oldContents);
    const changes = input.candidate.changes.map((change, index) => toStoredChange(
      change,
      `drafts/${input.id}/${index}.txt`,
    ));
    await this.#persistCandidateDrafts(input.candidate.changes, changes, true);
    const action = parsePendingAction({
      schemaVersion: PENDING_ACTION_SCHEMA_VERSION,
      kind: 'pending-action',
      id: input.id,
      title: input.title,
      description: input.description,
      createdAt: input.createdAt,
      source: candidateSourceToPendingSource(input.candidate),
      repository: structuredClone(input.candidate.repository),
      allowedTargets: structuredClone(input.candidate.allowedTargets),
      changes,
      preview: { diff, diffHash: sha256Text(diff) },
      ...(input.origin === undefined ? {} : { origin: structuredClone(input.origin) }),
    }, input.id);
    await this.#writeImmutableJson(this.#pendingPath(input.id), action);
    return action;
  }

  async #validateRepository(repository: RepositoryBaseline): Promise<void> {
    await this.#repositoryValidator(this.workspaceRoot, repository);
  }

  async #validateCandidateBaselines(
    changes: readonly CandidateFileChange[],
  ): Promise<Map<string, string>> {
    const oldContents = new Map<string, string>();
    for (const change of changes) {
      const content = await this.#validateOneBaseline(change.path, change.baseline);
      if (content !== undefined) oldContents.set(change.path, content);
    }
    return oldContents;
  }

  async #validatePendingBaselines(changes: readonly PendingFileChange[]): Promise<void> {
    for (const change of changes) {
      await this.#validateOneBaseline(change.path, change.baseline);
    }
  }

  async #validateOneBaseline(
    path: string,
    baseline: PendingFileChange['baseline'],
  ): Promise<string | undefined> {
    const targetPath = await this.#resolveCanonicalTarget(path);
    let information: Awaited<ReturnType<typeof lstat>>;
    try {
      information = await lstat(targetPath);
    } catch (error) {
      if (isNotFoundError(error) && baseline.exists === false) return undefined;
      throw staleBaseline(path);
    }
    if (baseline.exists === false) throw staleBaseline(path);
    if (information.isSymbolicLink() || !information.isFile()) throw staleBaseline(path);
    const targetRealpath = await realpath(targetPath);
    assertPathInside(this.workspaceRoot, targetRealpath, `Canonical target escaped: ${path}`);
    const bytes = await readFile(targetRealpath);
    const content = decodeUtf8(bytes, `Canonical baseline ${path}`);
    if (
      createHash('sha256').update(bytes).digest('hex') !== baseline.sha256
      || bytes.byteLength !== baseline.byteLength
      || (information.mode & 0o777) !== baseline.mode
    ) {
      throw staleBaseline(path);
    }
    return content;
  }

  async #resolveCanonicalTarget(pathValue: string): Promise<string> {
    const path = assertCanonicalTargetPath(pathValue);
    const parts = path.split('/');
    let cursor = this.workspaceRoot;
    for (const part of parts.slice(0, -1)) {
      cursor = join(cursor, part);
      try {
        const information = await lstat(cursor);
        if (information.isSymbolicLink() || !information.isDirectory()) {
          throw staleBaseline(path);
        }
        const actual = await realpath(cursor);
        assertPathInside(this.workspaceRoot, actual, `Canonical parent escaped: ${path}`);
      } catch (error) {
        if (isNotFoundError(error)) break;
        throw error;
      }
    }
    const target = resolve(this.workspaceRoot, ...parts);
    assertPathInside(this.workspaceRoot, target, `Canonical target escaped: ${path}`);
    return target;
  }

  async #persistCandidateDrafts(
    candidateChanges: readonly CandidateFileChange[],
    storedChanges: readonly PendingFileChange[],
    exclusive: boolean,
  ): Promise<void> {
    for (let index = 0; index < storedChanges.length; index += 1) {
      const stored = storedChanges[index];
      const candidate = candidateChanges[index];
      if (stored.draft === null || candidate.draft === null) continue;
      await this.#writeImmutableText(
        this.#engineRelativePath(stored.draft.relativePath),
        candidate.draft.content,
        { allowIdentical: !exclusive },
      );
    }
  }

  async #persistHydratedDrafts(
    hydratedChanges: readonly CandidateFileChange[],
    storedChanges: readonly PendingFileChange[],
  ): Promise<void> {
    await this.#persistCandidateDrafts(hydratedChanges, storedChanges, false);
  }

  async #hydrateChanges(
    changes: readonly PendingFileChange[],
  ): Promise<CandidateFileChange[]> {
    const hydrated: CandidateFileChange[] = [];
    for (const change of changes) {
      if (change.draft === null) {
        hydrated.push(structuredClone(change) as CandidateFileChange);
        continue;
      }
      const content = await this.#readAndValidateDraft(change.draft);
      hydrated.push({
        ...structuredClone(change),
        draft: { ...structuredClone(change.draft), content },
      } as CandidateFileChange);
    }
    return hydrated;
  }

  async #readAndValidateDraft(artifact: DraftArtifact): Promise<string> {
    const absolutePath = this.#engineRelativePath(artifact.relativePath);
    const bytes = await this.#readSafeInternalFile(absolutePath);
    const content = decodeUtf8(bytes, `Draft artifact ${artifact.relativePath}`);
    if (
      bytes.byteLength !== artifact.byteLength
      || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
    ) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_DRAFT_INTEGRITY_ERROR',
        `Draft artifact integrity check failed: ${artifact.relativePath}`,
      );
    }
    return content;
  }

  async #readActionDraftUnlocked(actionId: string, index: number): Promise<string> {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new PendingActionProtocolError(
        'INVALID_PENDING_ACTION_SCHEMA',
        'PendingAction draft index is invalid.',
      );
    }
    const action = await this.#readActionUnlocked(actionId);
    const change = action.changes[index];
    if (!change || change.draft === null) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_DRAFT_INTEGRITY_ERROR',
        `PendingAction ${actionId} has no draft at index ${index}.`,
      );
    }
    return this.#readAndValidateDraft(change.draft);
  }

  async #readPreparedChangePreviewUnlocked(id: string): Promise<PreparedChangePreviewV1> {
    const parsed = await this.#readJson(this.#previewManifestPath(id));
    return parsePreparedChangePreview(parsed, id);
  }

  async #readActionUnlocked(id: string): Promise<PendingAction> {
    let parsed: unknown;
    try {
      parsed = await this.#readJson(this.#pendingPath(id));
    } catch (error) {
      if (isNotFoundError(error)) throw pendingActionNotFound(id);
      throw error;
    }
    return parsePendingAction(parsed, id);
  }

  async #readActionIfPresent(id: string): Promise<PendingAction | undefined> {
    try {
      return await this.#readActionUnlocked(id);
    } catch (error) {
      if (error instanceof PendingActionProtocolError && error.code === 'PENDING_ACTION_NOT_FOUND') {
        return undefined;
      }
      throw error;
    }
  }

  async #readRecordUnlocked(id: string): Promise<PendingActionRecord> {
    const action = await this.#readActionUnlocked(id);
    const acceptedExists = await this.#pathExists(this.#terminalPath('accepted', id));
    const rejectedExists = await this.#pathExists(this.#terminalPath('rejected', id));
    if (acceptedExists && rejectedExists) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_TERMINAL_CONFLICT',
        `PendingAction ${id} has conflicting accepted and rejected terminals.`,
      );
    }
    if (!acceptedExists && !rejectedExists) return { action, status: 'pending' };
    const decision = acceptedExists ? 'accepted' : 'rejected';
    const terminal = parsePendingActionTerminal(
      await this.#readJson(this.#terminalPath(decision, id)),
      id,
      decision,
    );
    return decision === 'accepted'
      ? {
          action,
          status: 'accepted',
          acceptedAt: terminal.decidedAt,
          decisionReceiptId: terminal.decisionReceiptId,
        }
      : {
          action,
          status: 'rejected',
          rejectedAt: terminal.decidedAt,
          decisionReceiptId: terminal.decisionReceiptId,
        };
  }

  async #writeTerminalUnlocked(
    input: WritePendingActionTerminalInput,
  ): Promise<PendingActionTerminalRecord> {
    const actionId = assertOpaquePendingActionId(input.actionId);
    await this.#readActionUnlocked(actionId);
    const opposite = input.decision === 'accepted' ? 'rejected' : 'accepted';
    if (await this.#pathExists(this.#terminalPath(opposite, actionId))) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_TERMINAL_CONFLICT',
        `PendingAction ${actionId} already has a conflicting ${opposite} terminal.`,
      );
    }
    const terminal = parsePendingActionTerminal({
      schemaVersion: PENDING_ACTION_TERMINAL_SCHEMA_VERSION,
      kind: 'pending-action-terminal',
      actionId,
      decision: input.decision,
      decidedAt: normalizeTimestamp(input.decidedAt, this.#now),
      decisionReceiptId: assertOpaquePendingActionId(
        input.decisionReceiptId,
        'Decision receipt id',
      ),
    }, actionId, input.decision);
    const path = this.#terminalPath(input.decision, actionId);
    if (await this.#pathExists(path)) {
      const existing = parsePendingActionTerminal(await this.#readJson(path), actionId, input.decision);
      if (stableProtocolSerialize(existing) === stableProtocolSerialize(terminal)) return existing;
      throw new PendingActionProtocolError(
        'PENDING_ACTION_TERMINAL_CONFLICT',
        `PendingAction ${actionId} terminal is immutable.`,
      );
    }
    await this.#writeImmutableJson(path, terminal);
    return terminal;
  }

  async #readDecisionReceiptUnlocked(
    actionId: string,
  ): Promise<PendingActionDecisionReceipt | undefined> {
    const path = this.#receiptPath(actionId);
    try {
      return parsePendingActionDecisionReceipt(await this.#readJson(path), actionId);
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  async #writeDecisionReceiptUnlocked(
    value: PendingActionDecisionReceipt,
  ): Promise<PendingActionDecisionReceipt> {
    const receipt = parsePendingActionDecisionReceipt(value);
    const record = await this.#readRecordUnlocked(receipt.actionId);
    if (record.status === 'pending') {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        `PendingAction ${receipt.actionId} has no terminal for its decision receipt.`,
      );
    }
    const terminalDecision = record.status === 'accepted' ? 'accepted' : 'rejected';
    const decidedAt = record.status === 'accepted' ? record.acceptedAt : record.rejectedAt;
    if (
      receipt.id !== record.decisionReceiptId
      || receipt.decision !== terminalDecision
      || receipt.decidedAt !== decidedAt
    ) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        `Decision receipt does not match PendingAction ${receipt.actionId} terminal.`,
      );
    }
    const existing = await this.#readDecisionReceiptUnlocked(receipt.actionId);
    if (existing && !isAllowedDecisionReceiptTransition(existing, receipt)) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        `Decision receipt transition is invalid for ${receipt.actionId}.`,
      );
    }
    await this.#writeJsonAtomic(this.#receiptPath(receipt.actionId), receipt, {
      replace: existing !== undefined,
    });
    return receipt;
  }

  async #readPromotionIfPresent(
    previewId: string,
  ): Promise<PreparedChangePreviewPromotion | undefined> {
    try {
      return parsePreparedChangePreviewPromotion(
        await this.#readJson(this.#promotionPath(previewId)),
        previewId,
      );
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  async #validateExistingPromotion(
    promotion: PreparedChangePreviewPromotion,
    preview: PreparedChangePreviewV1,
    source: PendingActionSource,
  ): Promise<PendingActionView> {
    if (
      promotion.actionId !== preview.id
      || promotion.candidateFingerprint !== preview.candidateFingerprint
    ) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        `Prepared preview ${preview.id} promotion marker is invalid.`,
      );
    }
    const action = await this.#readActionUnlocked(promotion.actionId);
    await this.#assertActionMatchesPreview(action, preview, source);
    return pendingActionView(await this.#readRecordUnlocked(action.id),
      await this.#readDecisionReceiptUnlocked(action.id));
  }

  async #assertActionMatchesPreview(
    action: PendingAction,
    preview: PreparedChangePreviewV1,
    source: PendingActionSource,
  ): Promise<void> {
    const hydrated = await this.#hydrateChanges(action.changes);
    if (
      action.id !== preview.id
      || fingerprintCandidateChanges(hydrated) !== preview.candidateFingerprint
      || stableProtocolSerialize(action.repository) !== stableProtocolSerialize(preview.repository)
      || stableProtocolSerialize(action.origin) !== stableProtocolSerialize(preview.origin)
      || stableProtocolSerialize(action.preview) !== stableProtocolSerialize(preview.preview)
      || stableProtocolSerialize(action.source) !== stableProtocolSerialize(source)
    ) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_ID_CONFLICT',
        `Prepared preview ${preview.id} conflicts with an existing PendingAction.`,
      );
    }
  }

  async #assertActionIdentityAvailable(
    id: string,
    options: { allowPreview?: boolean } = {},
  ): Promise<void> {
    const paths = [
      this.#pendingPath(id),
      this.#terminalPath('accepted', id),
      this.#terminalPath('rejected', id),
      this.#receiptPath(id),
      this.#enginePath('drafts', id),
      ...(!options.allowPreview ? [this.#enginePath('previews', id)] : []),
    ];
    for (const path of paths) {
      if (await this.#pathExists(path)) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_ID_CONFLICT',
          `PendingAction id is already in use: ${id}`,
        );
      }
    }
  }

  async #assertPreviewIdentityAvailable(id: string): Promise<void> {
    if (await this.#pathExists(this.#enginePath('previews', id))) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_ID_CONFLICT',
        `Prepared preview id is already in use: ${id}`,
      );
    }
  }

  async #withNamedLock<T>(relativePath: string, operation: () => Promise<T>): Promise<T> {
    const path = this.#engineRelativePath(relativePath);
    await this.#ensureEngineDirectory(relativePath.split('/').slice(0, -1));
    const token = randomUUID();
    let acquired = false;
    for (let attempt = 0; attempt < this.#lockMaxAttempts; attempt += 1) {
      try {
        const handle = await open(path, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ token, pid: this.#lockOwnerPid })}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        acquired = true;
        break;
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
        if (await this.#recoverStaleLock(path)) continue;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, LOCK_RETRY_MS));
      }
    }
    if (!acquired) throw new Error(`PendingAction lock is busy: ${relativePath}`);
    try {
      return await operation();
    } finally {
      try {
        const owner = JSON.parse(await readFile(path, 'utf8')) as { token?: unknown };
        if (owner.token === token) await rm(path, { force: true });
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }
  }

  async #recoverStaleLock(path: string): Promise<boolean> {
    let information: Awaited<ReturnType<typeof lstat>>;
    try {
      information = await lstat(path);
    } catch (error) {
      if (isNotFoundError(error)) return true;
      throw error;
    }
    if (information.isSymbolicLink() || !information.isFile()) {
      throw new PendingActionProtocolError('PENDING_ACTION_CORRUPT', 'Lock path is invalid.');
    }
    if (Date.now() - information.mtimeMs < LOCK_STALE_MS) return false;
    let owner: { pid?: unknown };
    try {
      owner = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown };
    } catch {
      throw new PendingActionProtocolError('PENDING_ACTION_CORRUPT', 'Lock owner is invalid.');
    }
    if (Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0) {
      try {
        process.kill(owner.pid as number, 0);
        return false;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM') return false;
        if (code !== 'ESRCH') throw error;
      }
    }
    const quarantine = `${path}.stale-${randomUUID()}`;
    try {
      await rename(path, quarantine);
    } catch (error) {
      if (isNotFoundError(error) || isAlreadyExistsError(error)) return true;
      throw error;
    }
    await rm(quarantine, { force: true });
    return true;
  }

  async #ensureEngineDirectory(parts: readonly string[]): Promise<string> {
    let cursor = this.workspaceRoot;
    for (const part of [...ENGINE_RELATIVE_ROOT, ...parts]) {
      if (!part || part === '.' || part === '..' || part.includes(sep)) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_CORRUPT',
          'Internal PendingAction directory segment is invalid.',
        );
      }
      cursor = join(cursor, part);
      try {
        await mkdir(cursor);
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
      const information = await lstat(cursor);
      if (information.isSymbolicLink() || !information.isDirectory()) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_CORRUPT',
          `Internal PendingAction directory is unsafe: ${cursor}`,
        );
      }
      const actual = await realpath(cursor);
      assertPathInside(this.workspaceRoot, actual, 'PendingAction storage escaped workspace.');
    }
    return cursor;
  }

  #enginePath(...parts: string[]): string {
    const root = resolve(this.workspaceRoot, ...ENGINE_RELATIVE_ROOT);
    const result = resolve(root, ...parts);
    assertPathInside(root, result, 'PendingAction internal path escaped storage root.');
    return result;
  }

  #engineRelativePath(path: string): string {
    if (
      typeof path !== 'string'
      || path.startsWith('/')
      || path.includes('\\')
      || path.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        `PendingAction internal relative path is invalid: ${String(path)}`,
      );
    }
    return this.#enginePath(...path.split('/'));
  }

  #pendingPath(id: string): string {
    return this.#enginePath('pending', `${assertOpaquePendingActionId(id)}.json`);
  }

  #terminalPath(decision: 'accepted' | 'rejected', id: string): string {
    return this.#enginePath('terminal', decision, `${assertOpaquePendingActionId(id)}.json`);
  }

  #receiptPath(id: string): string {
    return this.#enginePath('receipts', `${assertOpaquePendingActionId(id)}.json`);
  }

  #previewManifestPath(id: string): string {
    return this.#enginePath('previews', assertOpaquePendingActionId(id), 'preview.json');
  }

  #promotionPath(id: string): string {
    return this.#enginePath('previews', assertOpaquePendingActionId(id), 'promotion.json');
  }

  async #pathExists(path: string): Promise<boolean> {
    try {
      const information = await lstat(path);
      if (information.isSymbolicLink()) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_CORRUPT',
          `PendingAction storage contains a symlink: ${path}`,
        );
      }
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async #readJson(path: string): Promise<unknown> {
    const bytes = await this.#readSafeInternalFile(path);
    if (bytes.byteLength > MAX_STORED_JSON_BYTES) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        `Stored PendingAction JSON is too large: ${path}`,
      );
    }
    try {
      return JSON.parse(decodeUtf8(bytes, `Stored JSON ${path}`)) as unknown;
    } catch (error) {
      if (error instanceof PendingActionProtocolError) throw error;
      throw new PendingActionProtocolError(
        'INVALID_PENDING_ACTION_SCHEMA',
        `Stored PendingAction JSON is invalid: ${path}`,
      );
    }
  }

  async #readSafeInternalFile(path: string): Promise<Buffer> {
    const engineRoot = await this.#ensureEngineDirectory([]);
    const relativePath = relative(engineRoot, path);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        'PendingAction file escaped its storage root.',
      );
    }
    let cursor = engineRoot;
    for (const part of relativePath.split(sep)) {
      cursor = join(cursor, part);
      const information = await lstat(cursor);
      if (information.isSymbolicLink()) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_CORRUPT',
          `PendingAction storage contains a symlink: ${cursor}`,
        );
      }
    }
    const information = await lstat(path);
    if (!information.isFile()) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_CORRUPT',
        `PendingAction storage entry is not a regular file: ${path}`,
      );
    }
    const actual = await realpath(path);
    assertPathInside(engineRoot, actual, 'PendingAction file escaped storage root.');
    return readFile(actual);
  }

  async #writeImmutableText(
    path: string,
    content: string,
    options: { allowIdentical?: boolean } = {},
  ): Promise<void> {
    assertValidTextContent(content, 'PendingAction draft artifact');
    if (await this.#pathExists(path)) {
      if (options.allowIdentical) {
        const existing = await this.#readSafeInternalFile(path);
        if (existing.equals(Buffer.from(content, 'utf8'))) return;
      }
      throw new PendingActionProtocolError(
        'PENDING_ACTION_ID_CONFLICT',
        `Immutable PendingAction artifact already exists: ${path}`,
      );
    }
    await this.#writeFileAtomic(path, Buffer.from(content, 'utf8'), { replace: false });
  }

  async #writeImmutableJson(path: string, value: unknown): Promise<void> {
    if (await this.#pathExists(path)) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_ID_CONFLICT',
        `Immutable PendingAction record already exists: ${path}`,
      );
    }
    await this.#writeJsonAtomic(path, value, { replace: false });
  }

  async #writeJsonAtomic(
    path: string,
    value: unknown,
    options: { replace: boolean },
  ): Promise<void> {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    await this.#writeFileAtomic(path, Buffer.from(serialized, 'utf8'), options);
  }

  async #writeFileAtomic(
    path: string,
    bytes: Buffer,
    options: { replace: boolean },
  ): Promise<void> {
    const engineRoot = resolve(this.workspaceRoot, ...ENGINE_RELATIVE_ROOT);
    const parentRelative = relative(engineRoot, dirname(path));
    const parts = parentRelative ? parentRelative.split(sep) : [];
    await this.#ensureEngineDirectory(parts);
    if (!options.replace && await this.#pathExists(path)) {
      throw new PendingActionProtocolError(
        'PENDING_ACTION_ID_CONFLICT',
        `Immutable PendingAction record already exists: ${path}`,
      );
    }
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (!options.replace && await this.#pathExists(path)) {
        throw new PendingActionProtocolError(
          'PENDING_ACTION_ID_CONFLICT',
          `Immutable PendingAction record already exists: ${path}`,
        );
      }
      await rename(temporary, path);
      const directory = await open(dirname(path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      if (handle) await handle.close();
      await rm(temporary, { force: true });
    }
  }
}

function parseStrictCandidateChangeSet(value: unknown): CandidateChangeSet {
  if (!isRecord(value)) invalidCandidate('CandidateChangeSet must be an object.');
  assertExactFields(value, [
    'schemaVersion',
    'sessionId',
    'createdAt',
    'finalizedAt',
    'projectionFingerprint',
    'repository',
    'source',
    'allowedTargets',
    'changes',
    'stats',
  ]);
  if (value.schemaVersion !== CANDIDATE_CHANGE_SET_SCHEMA_VERSION) {
    invalidCandidate('CandidateChangeSet schema version is unsupported.');
  }
  assertOpaquePendingActionId(value.sessionId, 'Candidate session id');
  assertCanonicalIsoTimestamp(value.createdAt, 'Candidate createdAt');
  assertCanonicalIsoTimestamp(value.finalizedAt, 'Candidate finalizedAt');
  if (Date.parse(value.finalizedAt as string) < Date.parse(value.createdAt as string)) {
    invalidCandidate('Candidate finalizedAt precedes createdAt.');
  }
  assertSha256(value.projectionFingerprint, 'Candidate projection fingerprint');
  parseRepositoryBaseline(value.repository);
  parseStrictCandidateSource(value.source);
  const allowedTargets = parseAllowedTargets(value.allowedTargets);
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    invalidCandidate('CandidateChangeSet changes must be non-empty.');
  }
  const paths: string[] = [];
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let changedBytes = 0;
  for (const change of value.changes) {
    if (!isRecord(change)) invalidCandidate('Candidate change must be an object.');
    assertExactFields(change, ['operation', 'path', 'baseline', 'draft']);
    paths.push(assertCanonicalTargetPath(change.path));
    if (change.operation === 'create' || change.operation === 'update') {
      if (!isRecord(change.draft)) invalidCandidate('Candidate draft is required.');
      assertExactFields(change.draft, ['sha256', 'byteLength', 'content']);
      if (typeof change.draft.content !== 'string') invalidCandidate('Candidate content is invalid.');
      assertValidTextContent(change.draft.content, 'Candidate content');
      const bytes = Buffer.byteLength(change.draft.content, 'utf8');
      if (
        assertSha256(change.draft.sha256, 'Candidate draft hash') !== sha256Text(change.draft.content)
        || change.draft.byteLength !== bytes
      ) {
        invalidCandidate('Candidate draft metadata does not match its content.');
      }
      changedBytes += bytes;
      if (change.operation === 'create') created += 1;
      else updated += 1;
    } else if (change.operation === 'delete') {
      if (change.draft !== null) invalidCandidate('Candidate delete draft must be null.');
      if (!isRecord(change.baseline) || !Number.isSafeInteger(change.baseline.byteLength)) {
        invalidCandidate('Candidate delete baseline is invalid.');
      }
      changedBytes += change.baseline.byteLength as number;
      deleted += 1;
    } else {
      invalidCandidate('Candidate operation is invalid.');
    }
  }
  if (new Set(paths).size !== paths.length || paths.some((path, i) => (
    path !== [...paths].sort(comparePaths)[i]
  ))) {
    invalidCandidate('Candidate changes must have unique, stably sorted paths.');
  }
  const allowed = new Set(allowedTargets);
  if (paths.some((path) => !allowed.has(path))) {
    throw new PendingActionProtocolError(
      'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
      'CandidateChangeSet contains a change outside its allowed targets.',
    );
  }
  if (!isRecord(value.stats)) invalidCandidate('Candidate stats must be an object.');
  assertExactFields(value.stats, ['created', 'updated', 'deleted', 'changedBytes']);
  if (
    value.stats.created !== created
    || value.stats.updated !== updated
    || value.stats.deleted !== deleted
    || value.stats.changedBytes !== changedBytes
  ) {
    invalidCandidate('Candidate stats do not match its changes.');
  }

  // Reuse the strict stored parser to validate every baseline and operation union.
  const syntheticId = 'candidate_validation';
  parsePendingAction({
    schemaVersion: 1,
    kind: 'pending-action',
    id: syntheticId,
    title: 'Candidate validation',
    description: 'Candidate validation',
    createdAt: value.finalizedAt,
    source: candidateSourceToPendingSource(value as unknown as CandidateChangeSet),
    repository: value.repository,
    allowedTargets: value.allowedTargets,
    changes: value.changes.map((change, index) => {
      const entry = change as unknown as CandidateFileChange;
      return toStoredChange(entry, `drafts/${syntheticId}/${index}.txt`);
    }),
    preview: { diff: '', diffHash: sha256Text('') },
  });
  return structuredClone(value) as unknown as CandidateChangeSet;
}

function parseStrictCandidateSource(value: unknown): void {
  if (!isRecord(value)) invalidCandidate('Candidate source must be an object.');
  if (value.kind === 'bash-session') {
    assertExactFields(value, [
      'kind',
      'capability',
      'commandLogHash',
      'commandCount',
      'finalization',
    ]);
    parsePendingActionSource({ ...value, sessionId: 'candidate_validation' });
    return;
  }
  if (value.kind === 'deterministic-builder') {
    assertExactFields(value, ['kind', 'producer', 'capability']);
    parsePendingActionSource(value);
    return;
  }
  invalidCandidate('Candidate source kind is invalid.');
}

function candidateSourceToPendingSource(candidate: CandidateChangeSet): PendingActionSource {
  return parsePendingActionSource(candidate.source.kind === 'bash-session'
    ? { ...structuredClone(candidate.source), sessionId: candidate.sessionId }
    : structuredClone(candidate.source));
}

function toStoredChange(
  change: CandidateFileChange,
  relativePath: string,
): PendingFileChange {
  if (change.draft === null) return structuredClone(change) as unknown as PendingFileChange;
  return {
    operation: change.operation,
    path: change.path,
    baseline: structuredClone(change.baseline),
    draft: {
      relativePath,
      sha256: change.draft.sha256,
      byteLength: change.draft.byteLength,
    },
  } as PendingFileChange;
}

function renderCandidateDiff(
  changes: readonly CandidateFileChange[],
  oldContents: ReadonlyMap<string, string>,
): string {
  return renderCandidateChangeDiff(changes.map((change) => {
    if (change.operation === 'create') {
      return { operation: 'create', path: change.path, newContent: change.draft.content };
    }
    const oldContent = oldContents.get(change.path);
    if (oldContent === undefined) throw staleBaseline(change.path);
    if (change.operation === 'delete') {
      return { operation: 'delete', path: change.path, oldContent };
    }
    return {
      operation: 'update',
      path: change.path,
      oldContent,
      newContent: change.draft.content,
    };
  }));
}

function pendingActionView(
  record: PendingActionRecord,
  receipt?: PendingActionDecisionReceipt,
): PendingActionView {
  const decidedAt = record.status === 'accepted'
    ? record.acceptedAt
    : record.status === 'rejected'
      ? record.rejectedAt
      : undefined;
  const view: PendingActionView = {
    id: record.action.id,
    title: record.action.title,
    description: record.action.description,
    status: record.status,
    createdAt: record.action.createdAt,
    ...(decidedAt === undefined ? {} : { decidedAt }),
    changes: record.action.changes.map((change) => ({
      operation: change.operation,
      path: change.path,
      ...(change.baseline.exists ? { oldHash: change.baseline.sha256 } : {}),
      ...(change.draft === null ? {} : { newHash: change.draft.sha256 }),
    })),
    diff: record.action.preview.diff,
    ...(record.action.origin === undefined
      ? {}
      : { origin: structuredClone(record.action.origin) }),
    ...(receipt === undefined ? {} : { git: structuredClone(receipt.git) }),
  };
  return deepFreeze(view);
}

function normalizeAllowedTargetInput(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PendingActionProtocolError(
      'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
      'Prepared preview allowed targets are required.',
    );
  }
  const targets = value.map(assertCanonicalTargetPath);
  if (new Set(targets).size !== targets.length) {
    throw new PendingActionProtocolError(
      'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
      'Prepared preview allowed targets contain duplicates.',
    );
  }
  const sorted = [...targets].sort(comparePaths);
  parseAllowedTargets(sorted);
  return sorted;
}

function assertChangesAllowed(
  changes: readonly Pick<PendingFileChange, 'path'>[],
  allowedTargets: readonly string[],
  id: string,
): void {
  const allowed = new Set(allowedTargets);
  if (changes.some((change) => !allowed.has(change.path))) {
    throw new PendingActionProtocolError(
      'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH',
      `Prepared preview ${id} contains a target outside its allowlist.`,
    );
  }
}

function normalizeTimestamp(value: string | undefined, now: () => Date): string {
  return assertCanonicalIsoTimestamp(value ?? now().toISOString(), 'PendingAction timestamp');
}

function decodeUtf8(bytes: Buffer, label: string): string {
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes) || content.includes('\0')) {
    throw new PendingActionProtocolError(
      'PENDING_ACTION_CORRUPT',
      `${label} is not valid UTF-8 text.`,
    );
  }
  return content;
}

function staleBaseline(path: string): PendingActionProtocolError {
  return new PendingActionProtocolError(
    'STALE_PENDING_ACTION_BASELINE',
    `PendingAction baseline is stale: ${path}`,
  );
}

function pendingActionNotFound(id: string): PendingActionProtocolError {
  return new PendingActionProtocolError(
    'PENDING_ACTION_NOT_FOUND',
    `PendingAction not found: ${id}`,
  );
}

function assertPathInside(root: string, path: string, message: string): void {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (path !== root && !path.startsWith(prefix)) {
    throw new PendingActionProtocolError('PENDING_ACTION_CORRUPT', message);
  }
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[]): void {
  const expected = new Set(fields);
  if (
    fields.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !expected.has(field))
  ) {
    invalidCandidate('Protocol value has missing or additional fields.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidCandidate(message: string): never {
  throw new PendingActionProtocolError('INVALID_PENDING_ACTION_SCHEMA', message);
}

function isNotFoundError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST';
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createRejectedDecisionReceipt(input: {
  id: string;
  actionId: string;
  decidedAt: string;
}): PendingActionDecisionReceipt {
  const receiptInput: CreatePendingActionDecisionReceiptInput = {
    ...input,
    decision: 'rejected',
    materialization: 'not-applicable',
    git: { status: 'not-requested' },
  };
  return createPendingActionDecisionReceipt(receiptInput);
}
