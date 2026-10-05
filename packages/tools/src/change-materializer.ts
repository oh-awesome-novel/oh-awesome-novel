import { createHash, randomUUID } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import {
  chmod,
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { DEFAULT_CREATED_FILE_MODE } from './candidate-change-set';
import { assertChapterSettlementActionFresh } from './chapter-settlement';
import { assertManuscriptImportActionFresh } from './manuscript-import-change-producer';
import {
  assertRepositoryBaseline,
  commitPendingActionFiles,
  createPendingActionCommitMessage,
  inspectPendingActionGitPreflight,
  readPendingActionCommitAtHead,
} from './git-integration';
import type {
  PendingActionGitBaselineFile,
  PendingActionScopedCommitResult,
} from './git-integration';
import {
  createPendingActionDecisionReceipt,
} from './pending-action-decision-receipt';
import type { PendingActionDecisionReceipt } from './pending-action-decision-receipt';
import type {
  LockedPendingActionAccess,
  PendingActionStore,
} from './pending-action-store';
import {
  assertCanonicalTargetPath,
  assertOpaquePendingActionId,
} from './pending-action-types';
import type {
  PendingAction,
  PendingActionGitResult,
  PendingActionRecord,
  PendingActionView,
} from './pending-action-types';
import {
  getFinalDocumentValidatorIdForPath,
  validateFinalDocument,
} from './final-document-validator';
import {
  isNovelReferencePath,
  NOVEL_REFERENCE_PROJECTION_RULES,
  validateFinalObjectTreeReferences,
} from './final-object-tree-validator';
import { createWorkspaceProjection } from './workspace-projection';
import {
  assertPathWritableByPolicy,
  createWorkspaceChangePolicy,
} from './workspace-change-policy';
import type { WorkspaceChangePolicy } from './workspace-change-policy';

const JOURNAL_SCHEMA_VERSION = 1 as const;
const INTERNAL_ROOT = ['.workspace', 'change-engine', 'v1'] as const;

export type ChangeMaterializerFaultPoint =
  | 'before-journal'
  | `after-stage:${number}`
  | `after-backup:${number}`
  | `after-materialize:${number}`
  | 'before-terminal'
  | 'after-terminal'
  | 'before-git-add'
  | 'after-git-add'
  | 'after-git-commit'
  | 'before-receipt';

export interface ChangeMaterializerOptions {
  store: PendingActionStore;
  policyResolver?: (action: PendingAction) => Promise<WorkspaceChangePolicy> | WorkspaceChangePolicy;
  assertOriginFresh?: (action: PendingAction) => Promise<void>;
  now?: () => Date;
  idFactory?: () => string;
  faultInjector?: (point: ChangeMaterializerFaultPoint) => Promise<void> | void;
}

export interface AcceptChangeInput {
  actionId: string;
  autoCommitOnAccept?: boolean;
}

export interface RejectChangeInput {
  actionId: string;
}

export interface AcceptedChangeResult {
  action: PendingActionView;
  receipt: PendingActionDecisionReceipt;
  appliedFiles: string[];
}

export interface RejectedChangeResult {
  action: PendingActionView;
  receipt: PendingActionDecisionReceipt;
}

export interface ChangeMaterializer {
  accept(input: AcceptChangeInput): Promise<AcceptedChangeResult>;
  reject(input: RejectChangeInput): Promise<RejectedChangeResult>;
  recover(): Promise<void>;
  quickCommit(actionId: string): Promise<PendingActionDecisionReceipt>;
}

interface TransactionOperation {
  operation: 'create' | 'update' | 'delete';
  targetFile: string;
  stageFile?: string;
  backupFile?: string;
  baselineHash?: string;
  baselineMode?: number;
  draftHash?: string;
  draftByteLength?: number;
  targetMode: number;
}

interface TransactionJournal {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  kind: 'change-materialization-journal';
  actionId: string;
  decisionReceiptId: string;
  acceptedAt: string;
  phase: 'prepared' | 'materializing' | 'accepted-finalize-only' | 'accepted-git-only';
  autoCommitRequested: boolean;
  repository: PendingAction['repository'];
  operations: TransactionOperation[];
  git: {
    phase: 'not-started' | 'staged' | 'committed';
    commit?: string;
    branch?: string;
  };
}

interface PreparedOperation extends TransactionOperation {
  targetPath: string;
  stagePath?: string;
  backupPath?: string;
  draft?: string;
}

export function createChangeMaterializer(
  options: ChangeMaterializerOptions,
): ChangeMaterializer {
  return new FileChangeMaterializer(options);
}

class FileChangeMaterializer implements ChangeMaterializer {
  readonly #store: PendingActionStore;
  readonly #workspaceRoot: string;
  readonly #policyResolver: NonNullable<ChangeMaterializerOptions['policyResolver']>;
  readonly #assertOriginFresh?: ChangeMaterializerOptions['assertOriginFresh'];
  readonly #now: () => Date;
  readonly #idFactory: () => string;
  readonly #faultInjector?: ChangeMaterializerOptions['faultInjector'];

  constructor(options: ChangeMaterializerOptions) {
    this.#store = options.store;
    this.#workspaceRoot = options.store.workspaceRoot;
    this.#policyResolver = options.policyResolver ?? defaultPolicyForAction;
    this.#assertOriginFresh = options.assertOriginFresh;
    this.#now = options.now ?? (() => new Date());
    this.#idFactory = options.idFactory ?? (() => `receipt_${randomUUID()}`);
    this.#faultInjector = options.faultInjector;
  }

  async accept(input: AcceptChangeInput): Promise<AcceptedChangeResult> {
    const actionId = assertOpaquePendingActionId(input.actionId);
    const autoCommitRequested = input.autoCommitOnAccept ?? true;
    await this.recover();

    let action!: PendingAction;
    let receipt!: PendingActionDecisionReceipt;
    await this.#store.withMaterializationLocks(actionId, async (locked) => {
      const record = await locked.readRecord();
      if (record.status !== 'pending') {
        throw terminalConflict(record);
      }
      action = record.action;
      const policy = await this.#validateAction(action);

      const gitPreflight = await inspectPendingActionGitPreflight({
        workspaceRoot: this.#workspaceRoot,
        expected: action.repository,
        files: gitBaselineFiles(action),
      });
      if (gitPreflight.unrelatedStagedFiles.length > 0) {
        throw materializerError(
          'UNRELATED_STAGED_FILES',
          `Git index contains unrelated staged files: ${gitPreflight.unrelatedStagedFiles.join(', ')}`,
        );
      }

      const prepared = await this.#preflight(action, locked, policy);
      const decisionReceiptId = assertOpaquePendingActionId(this.#idFactory(), 'Decision receipt id');
      const acceptedAt = this.#now().toISOString();
      const journal = createJournal(
        action,
        prepared,
        decisionReceiptId,
        acceptedAt,
        autoCommitRequested,
      );
      await this.#fault('before-journal');
      await this.#writeJournal(journal, true);

      try {
        await this.#materialize(journal, prepared);
        await this.#fault('before-terminal');
        const terminal = await locked.writeTerminal({
          decision: 'accepted',
          decisionReceiptId: journal.decisionReceiptId,
          decidedAt: journal.acceptedAt,
        });
        journal.phase = 'accepted-finalize-only';
        await this.#writeJournal(journal, false);
        await this.#fault('after-terminal');
        receipt = createPendingActionDecisionReceipt({
          id: terminal.decisionReceiptId,
          actionId,
          decision: 'accepted',
          decidedAt: terminal.decidedAt,
          materialization: 'committed',
          git: { status: 'not-requested' },
        });
        if (!autoCommitRequested) await locked.writeDecisionReceipt(receipt);
      } catch (error) {
        const current = await locked.readRecord();
        if (current.status === 'accepted') {
          // Durable accepted terminal is the file commit point. Recovery is
          // finalize-only from here; fault injection may still surface after
          // state has safely crossed that boundary.
          throw error;
        }
        await this.#rollback(journal);
        throw error;
      }

      await this.#finalize(journal);
      if (autoCommitRequested) {
        const git = gitPreflight.dirtyBaselineFiles.length > 0
          ? ({ status: 'failed', errorCode: 'dirty_before_proposal' } as const)
          : await this.#commitAccepted(action, journal);
        receipt = createPendingActionDecisionReceipt({
          ...receipt,
          git,
        });
        await this.#fault('before-receipt');
        await locked.writeDecisionReceipt(receipt);
      }
      await this.#removeJournal(actionId);
    });

    return {
      action: await this.#store.readView(actionId),
      receipt,
      appliedFiles: action.changes.map((change) => change.path),
    };
  }

  async reject(input: RejectChangeInput): Promise<RejectedChangeResult> {
    const actionId = assertOpaquePendingActionId(input.actionId);
    await this.recover();
    let receipt!: PendingActionDecisionReceipt;
    await this.#store.withMaterializationLocks(actionId, async (locked) => {
      const record = await locked.readRecord();
      if (record.status !== 'pending') throw terminalConflict(record);
      const receiptId = assertOpaquePendingActionId(this.#idFactory(), 'Decision receipt id');
      const terminal = await locked.writeTerminal({
        decision: 'rejected',
        decisionReceiptId: receiptId,
        decidedAt: this.#now().toISOString(),
      });
      receipt = createPendingActionDecisionReceipt({
        id: terminal.decisionReceiptId,
        actionId,
        decision: 'rejected',
        decidedAt: terminal.decidedAt,
        materialization: 'not-applicable',
        git: { status: 'not-requested' },
      });
      await locked.writeDecisionReceipt(receipt);
      await this.#removeDraftDirectory(actionId);
    });
    return { action: await this.#store.readView(actionId), receipt };
  }

  async recover(): Promise<void> {
    const ids = await this.#listJournalIds();
    for (const id of ids) {
      await this.#store.withMaterializationLocks(id, async (locked) => {
        await this.#recoverJournalUnlocked(id, { access: locked });
      });
    }
    const records = await this.#store.listRecords();
    for (const record of records) {
      await this.#store.withMaterializationLocks(record.action.id, async (locked) => {
        if (await this.#readJournal(record.action.id)) return;
        await this.#removeOrphanTransactionTemporaries(record.action.id);
        const current = await locked.readRecord();
        await this.#removeOrphanMaterializationArtifacts(current);
        if (current.status !== 'pending') {
          const receipt = await this.#store.readDecisionReceipt(current.action.id);
          if (receipt) {
            assertReceiptMatchesRecord(receipt, current);
          } else if (current.status === 'rejected') {
            await locked.writeDecisionReceipt(createPendingActionDecisionReceipt({
              id: current.decisionReceiptId,
              actionId: current.action.id,
              decision: 'rejected',
              decidedAt: current.rejectedAt,
              materialization: 'not-applicable',
              git: { status: 'not-requested' },
            }));
          }
          await this.#removeDraftDirectory(current.action.id);
        }
      });
    }
  }

  async quickCommit(actionIdValue: string): Promise<PendingActionDecisionReceipt> {
    const actionId = assertOpaquePendingActionId(actionIdValue);
    let receipt!: PendingActionDecisionReceipt;
    await this.#store.withMaterializationLocks(actionId, async (locked) => {
      await this.#recoverJournalUnlocked(actionId, { access: locked });
      const record = await locked.readRecord();
      if (record.status !== 'accepted') {
        throw materializerError('PENDING_ACTION_NOT_ACCEPTED', `PendingAction ${actionId} is not accepted.`);
      }
      const previous = await this.#store.readDecisionReceipt(actionId);
      if (!previous || previous.decision !== 'accepted') {
        throw materializerError('PENDING_ACTION_RECEIPT_MISSING', `Accepted action ${actionId} has no receipt.`);
      }
      assertReceiptMatchesRecord(previous, record);
      if (previous.git.status === 'committed') {
        receipt = previous;
        return;
      }
      const files = record.action.changes.map((change) => change.path);
      const committed = await readPendingActionCommitAtHead({
        workspaceRoot: this.#workspaceRoot,
        actionId,
        files,
        expectedRepository: record.action.repository,
      });
      if (!committed) {
        await this.#assertAcceptedFinalState(record.action);
        await assertRepositoryBaseline(this.#workspaceRoot, record.action.repository);
      }
      const git: PendingActionGitResult = committed
        ? { status: 'committed', ...committed }
        : await this.#commitAccepted(record.action, await this.#ensureAcceptedGitJournal(
            record.action,
            record.decisionReceiptId,
            record.acceptedAt,
          ));
      receipt = createPendingActionDecisionReceipt({ ...previous, git });
      if (git.status === 'committed') {
        // Keep transition operands stable: `previous` is deeply frozen, but an
        // explicit reconstruction avoids any accidental aliasing at this
        // security boundary.
        receipt = createPendingActionDecisionReceipt({
          id: previous.id,
          actionId: previous.actionId,
          decision: previous.decision,
          decidedAt: previous.decidedAt,
          materialization: previous.materialization,
          git,
        });
      }
      await this.#fault('before-receipt');
      await locked.writeDecisionReceipt(receipt);
      await this.#removeJournal(actionId);
    });
    return receipt;
  }

  async #validateAction(action: PendingAction): Promise<WorkspaceChangePolicy> {
    await assertRepositoryBaseline(this.#workspaceRoot, action.repository);
    if (action.origin?.kind === 'chapterSettlement') {
      await assertChapterSettlementActionFresh(this.#workspaceRoot, action);
    }
    if (action.origin?.kind === 'manuscriptImport') {
      await assertManuscriptImportActionFresh(this.#workspaceRoot, action);
    }
    if (requiresTrustedOrigin(action.source.capability) && action.origin === undefined) {
      throw materializerError(
        'PENDING_ACTION_ORIGIN_VALIDATOR_REQUIRED',
        `PendingAction ${action.id} capability ${action.source.capability} requires a trusted origin.`,
      );
    }
    if (action.origin !== undefined) {
      if (!this.#assertOriginFresh) {
        throw materializerError(
          'PENDING_ACTION_ORIGIN_VALIDATOR_REQUIRED',
          `PendingAction ${action.id} origin must be revalidated before Accept.`,
        );
      }
      await this.#assertOriginFresh(action);
    }
    const policy = await this.#policyResolver(action);
    if (policy.capability !== action.source.capability) {
      throw materializerError('PENDING_ACTION_POLICY_MISMATCH', 'PendingAction capability changed before Accept.');
    }
    for (const change of action.changes) assertPathWritableByPolicy(change.path, policy);
    return policy;
  }

  async #preflight(
    action: PendingAction,
    locked: LockedPendingActionAccess,
    policy: WorkspaceChangePolicy,
  ): Promise<PreparedOperation[]> {
    const prepared: PreparedOperation[] = [];
    for (let index = 0; index < action.changes.length; index += 1) {
      const change = action.changes[index]!;
      const targetPath = await this.#resolveTarget(change.path);
      const information = await safeLstat(targetPath);
      if (change.operation === 'create') {
        if (information !== undefined) throw staleBaseline(change.path);
      } else {
        if (!information || information.isSymbolicLink() || !information.isFile()) {
          throw staleBaseline(change.path);
        }
        if (information.nlink !== 1) throw staleBaseline(change.path);
        const bytes = await readFile(targetPath);
        if (
          sha256(bytes) !== change.baseline.sha256
          || bytes.byteLength !== change.baseline.byteLength
          || (information.mode & 0o777) !== change.baseline.mode
        ) {
          throw staleBaseline(change.path);
        }
      }

      const token = materializationArtifactToken(action.id, change.path);
      const parent = dirname(targetPath);
      const stagePath = change.operation === 'delete'
        ? undefined
        : join(parent, `.oan-ce-${token}.stage`);
      const backupPath = change.operation === 'create'
        ? undefined
        : join(parent, `.oan-ce-${token}.backup`);
      for (const artifact of [stagePath, backupPath]) {
        if (artifact && await safeLstat(artifact)) {
          throw materializerError('STALE_TRANSACTION_ARTIFACT', `Stale materialization artifact exists for ${change.path}.`);
        }
      }

      if (change.draft !== null) {
        const artifactParts = change.draft.relativePath.split('/');
        if (
          artifactParts.some((part) => !part || part === '.' || part === '..')
          || artifactParts[0] !== 'drafts'
          || artifactParts[1] !== action.id
        ) {
          throw materializerError(
            'PENDING_ACTION_DRAFT_INTEGRITY_ERROR',
            `Draft artifact path is invalid: ${change.path}.`,
          );
        }
        const draftPath = enginePath(this.#workspaceRoot, ...artifactParts);
        const draftInformation = await lstat(draftPath);
        if (
          draftInformation.isSymbolicLink()
          || !draftInformation.isFile()
          || draftInformation.nlink !== 1
          || draftInformation.size !== change.draft.byteLength
        ) {
          throw materializerError(
            'PENDING_ACTION_DRAFT_INTEGRITY_ERROR',
            `Draft artifact is not an immutable private file: ${change.path}.`,
          );
        }
      }
      const draft = change.draft === null ? undefined : await locked.readDraft(index);
      if (
        change.draft !== null
        && (
          Buffer.byteLength(draft!, 'utf8') !== change.draft.byteLength
          || sha256(Buffer.from(draft!, 'utf8')) !== change.draft.sha256
        )
      ) {
        throw materializerError('PENDING_ACTION_DRAFT_INTEGRITY_ERROR', `Draft changed for ${change.path}.`);
      }
      if (change.draft !== null) {
        const validator = getFinalDocumentValidatorIdForPath(change.path);
        if (!validator || !policy.validators.includes(validator)) {
          throw materializerError(
            'PENDING_ACTION_POLICY_MISMATCH',
            `No policy-bound final validator exists for ${change.path}.`,
          );
        }
        validateFinalDocument({
          path: change.path,
          content: draft!,
          validator,
          context: policy.validationContext,
        });
      }
      prepared.push({
        operation: change.operation,
        targetFile: change.path,
        targetPath,
        ...(stagePath ? { stagePath, stageFile: relative(this.#workspaceRoot, stagePath) } : {}),
        ...(backupPath ? { backupPath, backupFile: relative(this.#workspaceRoot, backupPath) } : {}),
        ...(change.baseline.exists
          ? { baselineHash: change.baseline.sha256, baselineMode: change.baseline.mode }
          : {}),
        ...(change.draft
          ? {
              draft,
              draftHash: change.draft.sha256,
              draftByteLength: change.draft.byteLength,
            }
          : {}),
        targetMode: change.operation === 'create'
          ? DEFAULT_CREATED_FILE_MODE
          : change.baseline.mode,
      });
    }
    if (prepared.some((operation) => isNovelReferencePath(operation.targetFile))) {
      const projection = await createWorkspaceProjection({
        workspaceRoot: this.#workspaceRoot,
        rules: NOVEL_REFERENCE_PROJECTION_RULES,
      });
      validateFinalObjectTreeReferences({
        baselineFiles: projection.baselineFiles,
        changes: prepared.map((operation) => ({
          path: operation.targetFile,
          operation: operation.operation,
          ...(operation.draft === undefined ? {} : { content: operation.draft }),
        })),
      });
    }
    return prepared;
  }

  async #materialize(journal: TransactionJournal, operations: PreparedOperation[]): Promise<void> {
    journal.phase = 'materializing';
    await this.#writeJournal(journal, false);
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]!;
      await mkdir(dirname(operation.targetPath), { recursive: true, mode: 0o755 });
      await this.#assertRealParent(operation.targetPath);
      if (operation.stagePath) {
        await writeFile(operation.stagePath, operation.draft!, {
          encoding: 'utf8',
          flag: 'wx',
          mode: operation.targetMode,
        });
        await chmod(operation.stagePath, operation.targetMode);
        await fsyncFile(operation.stagePath);
      }
      await this.#fault(`after-stage:${index}`);
    }
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index]!;
      await this.#assertOperationBaseline(operation);
      if (operation.backupPath) {
        await rename(operation.targetPath, operation.backupPath);
        await this.#assertBackup(operation);
        await fsyncDirectory(dirname(operation.targetPath));
      }
      await this.#fault(`after-backup:${index}`);
      if (operation.operation === 'delete') {
        // Moving the target to backup is the delete; backup survives to commit point.
      } else {
        await rename(operation.stagePath!, operation.targetPath);
        await fsyncFile(operation.targetPath);
        await fsyncDirectory(dirname(operation.targetPath));
      }
      await this.#fault(`after-materialize:${index}`);
    }
  }

  async #commitAccepted(
    action: PendingAction,
    journal: TransactionJournal,
  ): Promise<PendingActionGitResult> {
    await this.#fault('before-git-add');
    const result = await commitPendingActionFiles({
      workspaceRoot: this.#workspaceRoot,
      files: action.changes.map((change) => change.path),
      message: createPendingActionCommitMessage({
        pendingActionId: action.id,
        title: action.title,
      }),
      onStaged: async () => {
        journal.git = { phase: 'staged', branch: action.repository.branch };
        await this.#writeJournal(journal, false);
        await this.#fault('after-git-add');
      },
    });
    if (result.status === 'committed') {
      // This deliberately precedes the durable journal update: recovery must
      // reconcile the real Git commit from its trailer/repository identity even
      // in the narrow crash window where the journal still says `staged`.
      await this.#fault('after-git-commit');
      journal.git = {
        phase: 'committed',
        branch: result.branch,
        commit: result.commit,
      };
      await this.#writeJournal(journal, false);
    }
    return toReceiptGit(result);
  }

  async #recoverJournalUnlocked(
    actionId: string,
    options: {
      access?: LockedPendingActionAccess;
    } = {},
  ): Promise<void> {
    const journal = await this.#readJournal(actionId);
    if (!journal) return;
    let record = options.access
      ? await options.access.readRecord()
      : await this.#store.readRecord(actionId);
    assertJournalMatchesAction(journal, record.action);
    if (record.status === 'pending') {
      if (journal.phase !== 'accepted-finalize-only' && journal.phase !== 'accepted-git-only') {
        await this.#rollback(journal);
        return;
      }
      await this.#assertAcceptedFinalState(record.action);
      await (options.access
        ? options.access.writeTerminal({
            decision: 'accepted',
            decisionReceiptId: journal.decisionReceiptId,
            decidedAt: journal.acceptedAt,
          })
        : this.#store.writeTerminal({
            actionId,
            decision: 'accepted',
            decisionReceiptId: journal.decisionReceiptId,
            decidedAt: journal.acceptedAt,
          }));
      record = options.access
        ? await options.access.readRecord()
        : await this.#store.readRecord(actionId);
    }
    if (record.status === 'rejected') {
      throw materializerError('PENDING_ACTION_TERMINAL_CONFLICT', `Rejected action ${actionId} has a transaction journal.`);
    }
    if (record.status !== 'accepted') throw invalidJournal();
    if (
      record.decisionReceiptId !== journal.decisionReceiptId
      || record.acceptedAt !== journal.acceptedAt
    ) {
      throw invalidJournal();
    }
    if (journal.phase !== 'accepted-finalize-only' && journal.phase !== 'accepted-git-only') {
      // A crash can occur after the durable terminal rename and before the
      // journal phase update. Terminal presence is authoritative and recovery
      // must never roll accepted canonical bytes back.
      journal.phase = 'accepted-finalize-only';
      await this.#writeJournal(journal, false);
    }
    await this.#finalize(journal);
    let receipt = await this.#store.readDecisionReceipt(actionId);
    if (receipt) assertReceiptMatchesRecord(receipt, record);
    if (journal.autoCommitRequested && receipt?.git.status !== 'committed') {
      const committed = await readPendingActionCommitAtHead({
        workspaceRoot: this.#workspaceRoot,
        actionId,
        files: record.action.changes.map((change) => change.path),
        expectedRepository: record.action.repository,
        ...(journal.git.phase === 'committed' && journal.git.commit
          ? { expectedCommit: journal.git.commit }
          : {}),
      });
      if (committed) {
        const next = createPendingActionDecisionReceipt({
          id: record.decisionReceiptId,
          actionId,
          decision: 'accepted',
          decidedAt: record.acceptedAt,
          materialization: 'committed',
          git: { status: 'committed', ...committed },
        });
        await (options.access
          ? options.access.writeDecisionReceipt(next)
          : this.#store.writeDecisionReceipt(next));
      } else if (!receipt || receipt.git.status === 'not-requested') {
        const next = createPendingActionDecisionReceipt({
          id: record.decisionReceiptId,
          actionId,
          decision: 'accepted',
          decidedAt: record.acceptedAt,
          materialization: 'committed',
          git: journal.git.phase === 'staged'
            ? {
                status: 'staged-not-committed',
                branch: journal.git.branch ?? record.action.repository.branch,
                errorCode: 'interrupted_after_git_add',
              }
            : { status: 'failed', errorCode: 'automatic_commit_interrupted' },
        });
        await (options.access
          ? options.access.writeDecisionReceipt(next)
          : this.#store.writeDecisionReceipt(next));
      }
      await this.#removeJournal(actionId);
      return;
    }
    if (!receipt) {
      receipt = createPendingActionDecisionReceipt({
        id: record.decisionReceiptId,
        actionId,
        decision: 'accepted',
        decidedAt: record.acceptedAt,
        materialization: 'committed',
        git: { status: 'not-requested' },
      });
      await (options.access
        ? options.access.writeDecisionReceipt(receipt)
        : this.#store.writeDecisionReceipt(receipt));
    }
    await this.#removeJournal(actionId);
  }

  async #rollback(journal: TransactionJournal): Promise<void> {
    const errors: unknown[] = [];
    for (const operation of [...journal.operations].reverse()) {
      try {
        const target = this.#resolveJournalPath(operation.targetFile);
        const stage = operation.stageFile
          ? this.#resolveJournalArtifact(operation.stageFile, '.stage')
          : undefined;
        const backup = operation.backupFile
          ? this.#resolveJournalArtifact(operation.backupFile, '.backup')
          : undefined;
        if (backup && await safeLstat(backup)) {
          const backupHash = await readRegularFileHash(backup);
          if (backupHash !== operation.baselineHash) {
            throw new Error(`Backup changed during rollback: ${operation.targetFile}.`);
          }
          const targetHash = await tryReadRegularFileHash(target);
          if (targetHash !== undefined && targetHash !== operation.draftHash) {
            throw new Error(`Target changed during rollback: ${operation.targetFile}.`);
          }
          if (targetHash !== undefined) await rm(target);
          await rename(backup, target);
          await chmod(target, operation.baselineMode!);
          await fsyncFile(target);
          await fsyncDirectory(dirname(target));
        } else if (operation.operation === 'create') {
          const targetHash = await tryReadRegularFileHash(target);
          if (targetHash !== undefined) {
            if (targetHash !== operation.draftHash) {
              throw new Error(`Created target changed during rollback: ${operation.targetFile}.`);
            }
            await rm(target);
            await fsyncDirectory(dirname(target));
          }
        } else {
          const targetHash = await tryReadRegularFileHash(target);
          if (targetHash !== operation.baselineHash) {
            throw new Error(`Cannot recover original target: ${operation.targetFile}.`);
          }
        }
        if (stage) await rm(stage, { force: true });
        if (backup) await rm(backup, { force: true });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Could not roll back PendingAction ${journal.actionId}.`);
    }
    await this.#removeJournal(journal.actionId);
  }

  async #finalize(journal: TransactionJournal): Promise<void> {
    // This durable phase proves file cleanup finished. Git bookkeeping must
    // not require the author to keep accepted canonical bytes unchanged.
    if (journal.phase === 'accepted-git-only') return;
    if (journal.phase !== 'accepted-finalize-only') {
      throw materializerError('CHANGE_JOURNAL_CORRUPT', 'Only accepted transactions may be finalized.');
    }
    for (const operation of journal.operations) {
      await this.#assertAcceptedOperation(operation);
      if (operation.stageFile) {
        await rm(this.#resolveJournalArtifact(operation.stageFile, '.stage'), { force: true });
      }
      if (operation.backupFile) {
        await rm(this.#resolveJournalArtifact(operation.backupFile, '.backup'), { force: true });
      }
      await fsyncDirectory(dirname(this.#resolveJournalPath(operation.targetFile)));
    }
    await this.#removeDraftDirectory(journal.actionId);
    journal.phase = 'accepted-git-only';
    await this.#writeJournal(journal, false);
  }

  async #assertAcceptedFinalState(action: PendingAction): Promise<void> {
    for (const change of action.changes) {
      await this.#assertAcceptedOperation({
        operation: change.operation,
        targetFile: change.path,
        ...(change.draft
          ? {
              draftHash: change.draft.sha256,
              draftByteLength: change.draft.byteLength,
            }
          : {}),
        targetMode: change.operation === 'create'
          ? DEFAULT_CREATED_FILE_MODE
          : change.baseline.mode,
      });
    }
  }

  async #assertAcceptedOperation(operation: TransactionOperation): Promise<void> {
    const target = this.#resolveJournalPath(operation.targetFile);
    const information = await safeLstat(target);
    if (operation.operation === 'delete') {
      if (information) {
        throw materializerError(
          'ACCEPTED_TARGET_DRIFT',
          `Deleted accepted target reappeared: ${operation.targetFile}.`,
        );
      }
      return;
    }
    if (
      !information
      || information.isSymbolicLink()
      || !information.isFile()
      || information.nlink !== 1
      || (information.mode & 0o777) !== operation.targetMode
      || information.size !== operation.draftByteLength
      || await readRegularFileHash(target) !== operation.draftHash
    ) {
      throw materializerError(
        'ACCEPTED_TARGET_DRIFT',
        `Accepted target is not the approved final state: ${operation.targetFile}.`,
      );
    }
  }

  async #assertOperationBaseline(operation: PreparedOperation): Promise<void> {
    const information = await safeLstat(operation.targetPath);
    if (operation.operation === 'create') {
      if (information) throw staleBaseline(operation.targetFile);
      return;
    }
    if (!information || information.isSymbolicLink() || !information.isFile() || information.nlink !== 1) {
      throw staleBaseline(operation.targetFile);
    }
    if (
      await readRegularFileHash(operation.targetPath) !== operation.baselineHash
      || (information.mode & 0o777) !== operation.baselineMode
    ) {
      throw staleBaseline(operation.targetFile);
    }
  }

  async #assertBackup(operation: PreparedOperation): Promise<void> {
    if (!operation.backupPath) return;
    const information = await lstat(operation.backupPath);
    if (information.isSymbolicLink() || !information.isFile() || information.nlink !== 1) {
      throw materializerError('CHANGE_BACKUP_INVALID', `Backup is not a private regular file: ${operation.targetFile}.`);
    }
    if (
      await readRegularFileHash(operation.backupPath) !== operation.baselineHash
      || (information.mode & 0o777) !== operation.baselineMode
    ) {
      throw materializerError('CHANGE_BACKUP_INVALID', `Backup differs from baseline: ${operation.targetFile}.`);
    }
  }

  async #resolveTarget(pathValue: string): Promise<string> {
    const path = assertCanonicalTargetPath(pathValue);
    const target = resolve(this.#workspaceRoot, ...path.split('/'));
    assertInside(this.#workspaceRoot, target, `Target escaped workspace: ${path}`);
    let cursor = this.#workspaceRoot;
    for (const part of path.split('/').slice(0, -1)) {
      cursor = join(cursor, part);
      const information = await safeLstat(cursor);
      if (!information) break;
      if (information.isSymbolicLink() || !information.isDirectory()) throw staleBaseline(path);
      assertInside(this.#workspaceRoot, await realpath(cursor), `Target parent escaped: ${path}`);
    }
    return target;
  }

  async #assertRealParent(targetPath: string): Promise<void> {
    const parent = dirname(targetPath);
    const information = await lstat(parent);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw materializerError('UNSAFE_TARGET_PARENT', `Target parent is unsafe: ${parent}.`);
    }
    assertInside(this.#workspaceRoot, await realpath(parent), 'Target parent escaped workspace.');
  }

  #journalPath(actionId: string): string {
    return enginePath(this.#workspaceRoot, 'transactions', `${assertOpaquePendingActionId(actionId)}.json`);
  }

  async #writeJournal(journal: TransactionJournal, exclusive: boolean): Promise<void> {
    const parsed = parseJournal(journal, journal.actionId);
    const path = this.#journalPath(journal.actionId);
    await ensureSafeInternalDirectory(this.#workspaceRoot, ['transactions']);
    await writeJsonAtomic(path, parsed, exclusive);
  }

  async #readJournal(actionId: string): Promise<TransactionJournal | undefined> {
    try {
      const path = this.#journalPath(actionId);
      const information = await lstat(path);
      if (information.isSymbolicLink() || !information.isFile() || information.nlink !== 1) {
        throw materializerError('CHANGE_JOURNAL_CORRUPT', 'Transaction journal is not a private regular file.');
      }
      if (information.size > 16 * 1024 * 1024) {
        throw materializerError('CHANGE_JOURNAL_CORRUPT', 'Transaction journal exceeds its size limit.');
      }
      const bytes = await readFile(path);
      return parseJournal(JSON.parse(bytes.toString('utf8')) as unknown, actionId);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async #listJournalIds(): Promise<string[]> {
    const root = enginePath(this.#workspaceRoot, 'transactions');
    try {
      const entries = await readdir(root, { withFileTypes: true });
      return entries.map((entry) => {
        if (
          entry.isFile()
          && !entry.isSymbolicLink()
          && transactionTemporaryActionId(entry.name) !== undefined
        ) return undefined;
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
          throw materializerError('CHANGE_JOURNAL_CORRUPT', `Unexpected transaction entry: ${entry.name}.`);
        }
        return assertOpaquePendingActionId(entry.name.slice(0, -5));
      }).filter((id): id is string => id !== undefined).sort();
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  #resolveJournalPath(path: string): string {
    const target = resolve(this.#workspaceRoot, ...assertCanonicalTargetPath(path).split('/'));
    assertInside(this.#workspaceRoot, target, 'Journal target escaped workspace.');
    return target;
  }

  #resolveJournalArtifact(path: string, suffix: '.stage' | '.backup'): string {
    if (
      path.startsWith('/')
      || path.includes('\\')
      || path.split('/').some((part) => !part || part === '.' || part === '..')
      || !basename(path).startsWith('.oan-ce-')
      || !path.endsWith(suffix)
    ) {
      throw materializerError('CHANGE_JOURNAL_CORRUPT', 'Transaction artifact path is invalid.');
    }
    const absolute = resolve(this.#workspaceRoot, ...path.split('/'));
    assertInside(this.#workspaceRoot, absolute, 'Journal artifact escaped workspace.');
    return absolute;
  }

  async #removeJournal(actionId: string): Promise<void> {
    await rm(this.#journalPath(actionId), { force: true });
    await fsyncDirectory(dirname(this.#journalPath(actionId)));
  }

  async #removeDraftDirectory(actionId: string): Promise<void> {
    const draftRoot = enginePath(this.#workspaceRoot, 'drafts', assertOpaquePendingActionId(actionId));
    await rm(draftRoot, {
      recursive: true,
      force: true,
    });
    await fsyncDirectory(dirname(draftRoot));
  }

  async #removeOrphanTransactionTemporaries(actionId: string): Promise<void> {
    const root = enginePath(this.#workspaceRoot, 'transactions');
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    let removed = false;
    for (const entry of entries) {
      if (transactionTemporaryActionId(entry.name) !== actionId) continue;
      const path = join(root, entry.name);
      const information = await lstat(path);
      if (
        entry.isSymbolicLink()
        || !entry.isFile()
        || information.isSymbolicLink()
        || !information.isFile()
        || information.nlink !== 1
        || (information.mode & 0o777) !== 0o600
        || information.size > 16 * 1024 * 1024
      ) {
        throw materializerError(
          'UNSAFE_ORPHAN_TRANSACTION_ARTIFACT',
          `Refusing to remove unsafe transaction temporary: ${entry.name}.`,
        );
      }
      await rm(path);
      removed = true;
    }
    if (removed) await fsyncDirectory(root);
  }

  async #removeOrphanMaterializationArtifacts(record: PendingActionRecord): Promise<void> {
    const removable: string[] = [];
    for (const change of record.action.changes) {
      const targetPath = await this.#resolveTarget(change.path);
      const parent = dirname(targetPath);
      const token = materializationArtifactToken(record.action.id, change.path);
      const targetMode = change.operation === 'create'
        ? DEFAULT_CREATED_FILE_MODE
        : change.baseline.mode;
      const stagePath = change.operation === 'delete'
        ? undefined
        : join(parent, `.oan-ce-${token}.stage`);
      const backupPath = change.operation === 'create'
        ? undefined
        : join(parent, `.oan-ce-${token}.backup`);

      if (stagePath && await safeLstat(stagePath)) {
        await assertOrphanArtifactMatches(stagePath, {
          sha256: change.draft!.sha256,
          byteLength: change.draft!.byteLength,
          mode: targetMode,
        });
        removable.push(stagePath);
      }
      if (change.operation !== 'create' && backupPath && await safeLstat(backupPath)) {
        await assertOrphanArtifactMatches(backupPath, {
          sha256: change.baseline.sha256,
          byteLength: change.baseline.byteLength,
          mode: change.baseline.mode,
        });
        if (record.status === 'accepted') {
          await this.#assertAcceptedOperation({
            operation: change.operation,
            targetFile: change.path,
            ...(change.draft
              ? {
                  draftHash: change.draft.sha256,
                  draftByteLength: change.draft.byteLength,
                }
              : {}),
            targetMode,
          });
        } else {
          await this.#assertOperationBaseline({
            operation: change.operation,
            targetFile: change.path,
            targetPath,
            baselineHash: change.baseline.sha256,
            baselineMode: change.baseline.mode,
            targetMode,
          });
        }
        removable.push(backupPath);
      }
    }
    for (const path of removable) {
      await rm(path);
      await fsyncDirectory(dirname(path));
    }
  }

  async #ensureAcceptedGitJournal(
    action: PendingAction,
    decisionReceiptId: string,
    acceptedAt: string,
  ): Promise<TransactionJournal> {
    const existing = await this.#readJournal(action.id);
    if (existing) return existing;
    const operations: PreparedOperation[] = action.changes.map((change) => ({
      operation: change.operation,
      targetFile: change.path,
      targetPath: resolve(this.#workspaceRoot, ...change.path.split('/')),
      ...(change.operation === 'delete' ? {} : {
        stageFile: join(dirname(change.path), `.oan-ce-${materializationArtifactToken(action.id, change.path)}.stage`),
      }),
      ...(change.operation === 'create' ? {} : {
        backupFile: join(dirname(change.path), `.oan-ce-${materializationArtifactToken(action.id, change.path)}.backup`),
      }),
      ...(change.baseline.exists
        ? { baselineHash: change.baseline.sha256, baselineMode: change.baseline.mode }
        : {}),
      ...(change.draft
        ? {
            draftHash: change.draft.sha256,
            draftByteLength: change.draft.byteLength,
          }
        : {}),
      targetMode: change.operation === 'create'
        ? DEFAULT_CREATED_FILE_MODE
        : change.baseline.mode,
    }));
    const journal = createJournal(action, operations, decisionReceiptId, acceptedAt, true);
    journal.phase = 'accepted-git-only';
    await this.#writeJournal(journal, true);
    return journal;
  }

  async #fault(point: ChangeMaterializerFaultPoint): Promise<void> {
    await this.#faultInjector?.(point);
  }
}

function defaultPolicyForAction(action: PendingAction): WorkspaceChangePolicy {
  const referenceId = action.origin && 'referenceId' in action.origin
    ? action.origin.referenceId
    : undefined;
  return createWorkspaceChangePolicy({
    capability: action.source.capability,
    exactWritablePaths: action.allowedTargets,
    ...(referenceId ? { referenceId } : {}),
  });
}

function requiresTrustedOrigin(
  capability: PendingAction['source']['capability'],
): boolean {
  return capability === 'reference.publish'
    || capability === 'reference.adopt'
    || capability === 'play.adopt';
}

function createJournal(
  action: PendingAction,
  operations: PreparedOperation[],
  decisionReceiptId: string,
  acceptedAt: string,
  autoCommitRequested: boolean,
): TransactionJournal {
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    kind: 'change-materialization-journal',
    actionId: action.id,
    decisionReceiptId,
    acceptedAt,
    phase: 'prepared',
    autoCommitRequested,
    repository: structuredClone(action.repository),
    operations: operations.map(({
      operation,
      targetFile,
      stageFile,
      backupFile,
      baselineHash,
      baselineMode,
      draftHash,
      draftByteLength,
      targetMode,
    }) => ({
      operation,
      targetFile,
      ...(stageFile ? { stageFile } : {}),
      ...(backupFile ? { backupFile } : {}),
      ...(baselineHash ? { baselineHash } : {}),
      ...(baselineMode === undefined ? {} : { baselineMode }),
      ...(draftHash ? { draftHash } : {}),
      ...(draftByteLength === undefined ? {} : { draftByteLength }),
      targetMode,
    })),
    git: { phase: 'not-started' },
  };
}

function materializationArtifactToken(actionId: string, targetFile: string): string {
  return createHash('sha256')
    .update(`${actionId}\0${targetFile}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function assertJournalMatchesAction(
  journal: TransactionJournal,
  action: PendingAction,
): void {
  if (
    journal.actionId !== action.id
    || journal.repository.repositoryId !== action.repository.repositoryId
    || journal.repository.branch !== action.repository.branch
    || journal.repository.head !== action.repository.head
    || journal.operations.length !== action.changes.length
  ) {
    throw invalidJournal();
  }
  for (let index = 0; index < action.changes.length; index += 1) {
    const change = action.changes[index]!;
    const token = materializationArtifactToken(action.id, change.path);
    const parent = dirname(change.path);
    const expected: TransactionOperation = {
      operation: change.operation,
      targetFile: change.path,
      ...(change.operation === 'delete'
        ? {}
        : { stageFile: join(parent, `.oan-ce-${token}.stage`) }),
      ...(change.operation === 'create'
        ? {}
        : { backupFile: join(parent, `.oan-ce-${token}.backup`) }),
      ...(change.baseline.exists
        ? { baselineHash: change.baseline.sha256, baselineMode: change.baseline.mode }
        : {}),
      ...(change.draft
        ? {
            draftHash: change.draft.sha256,
            draftByteLength: change.draft.byteLength,
          }
        : {}),
      targetMode: change.operation === 'create'
        ? DEFAULT_CREATED_FILE_MODE
        : change.baseline.mode,
    };
    if (JSON.stringify(journal.operations[index]) !== JSON.stringify(expected)) {
      throw invalidJournal();
    }
  }
}

function assertReceiptMatchesRecord(
  receipt: PendingActionDecisionReceipt,
  record: PendingActionRecord,
): void {
  if (record.status === 'pending') {
    throw materializerError('PENDING_ACTION_CORRUPT', 'A pending action cannot have a decision receipt.');
  }
  const decision = record.status === 'accepted' ? 'accepted' : 'rejected';
  const decidedAt = record.status === 'accepted' ? record.acceptedAt : record.rejectedAt;
  if (
    receipt.id !== record.decisionReceiptId
    || receipt.actionId !== record.action.id
    || receipt.decision !== decision
    || receipt.decidedAt !== decidedAt
  ) {
    throw materializerError(
      'PENDING_ACTION_CORRUPT',
      `Decision receipt does not match PendingAction ${record.action.id} terminal.`,
    );
  }
}

function transactionTemporaryActionId(name: string): string | undefined {
  const match = /^\.([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u.exec(name);
  if (!match) return undefined;
  try {
    return assertOpaquePendingActionId(match[1]);
  } catch {
    return undefined;
  }
}

function parseJournal(value: unknown, expectedActionId: string): TransactionJournal {
  if (!isRecord(value)) throw invalidJournal();
  assertExact(value, [
    'schemaVersion',
    'kind',
    'actionId',
    'decisionReceiptId',
    'acceptedAt',
    'phase',
    'autoCommitRequested',
    'repository',
    'operations',
    'git',
  ]);
  if (
    value.schemaVersion !== JOURNAL_SCHEMA_VERSION
    || value.kind !== 'change-materialization-journal'
    || value.actionId !== expectedActionId
    || !['prepared', 'materializing', 'accepted-finalize-only', 'accepted-git-only'].includes(String(value.phase))
    || typeof value.autoCommitRequested !== 'boolean'
    || !Array.isArray(value.operations)
    || value.operations.length === 0
    || value.operations.length > 4096
  ) throw invalidJournal();
  assertOpaquePendingActionId(value.actionId);
  assertOpaquePendingActionId(value.decisionReceiptId, 'Decision receipt id');
  assertJournalTimestamp(value.acceptedAt);
  if (!isRecord(value.repository)) throw invalidJournal();
  assertExact(value.repository, ['repositoryId', 'branch', 'head']);
  if (!Object.values(value.repository).every((field) => typeof field === 'string' && field.length > 0)) {
    throw invalidJournal();
  }
  if (!isRecord(value.git)) throw invalidJournal();
  const gitFields = value.git.phase === 'not-started'
    ? ['phase']
    : value.git.phase === 'staged'
      ? ['phase', 'branch']
      : value.git.phase === 'committed'
        ? ['phase', 'branch', 'commit']
        : [];
  if (!gitFields.length) throw invalidJournal();
  assertExact(value.git, gitFields);

  const paths = new Set<string>();
  for (const raw of value.operations) {
    if (!isRecord(raw)) throw invalidJournal();
    const common = ['operation', 'targetFile', 'targetMode'];
    if (raw.operation === 'create') {
      assertExact(raw, [...common, 'stageFile', 'draftHash', 'draftByteLength']);
    } else if (raw.operation === 'update') {
      assertExact(raw, [...common, 'stageFile', 'backupFile', 'baselineHash', 'baselineMode', 'draftHash', 'draftByteLength']);
    } else if (raw.operation === 'delete') {
      assertExact(raw, [...common, 'backupFile', 'baselineHash', 'baselineMode']);
    } else throw invalidJournal();
    const path = assertCanonicalTargetPath(raw.targetFile);
    if (paths.has(path)) throw invalidJournal();
    paths.add(path);
    if (!Number.isSafeInteger(raw.targetMode) || (raw.targetMode as number) < 0 || (raw.targetMode as number) > 0o777) throw invalidJournal();
    for (const hash of ['baselineHash', 'draftHash']) {
      if (Object.hasOwn(raw, hash) && (typeof raw[hash] !== 'string' || !/^[a-f0-9]{64}$/u.test(raw[hash] as string))) throw invalidJournal();
    }
    for (const length of ['baselineMode', 'draftByteLength']) {
      if (Object.hasOwn(raw, length) && (!Number.isSafeInteger(raw[length]) || (raw[length] as number) < 0)) throw invalidJournal();
    }
  }
  return structuredClone(value) as unknown as TransactionJournal;
}

function assertJournalTimestamp(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw invalidJournal();
  }
}

function gitBaselineFiles(action: PendingAction): PendingActionGitBaselineFile[] {
  return action.changes.map((change) => change.baseline.exists
    ? {
        path: change.path,
        exists: true,
        sha256: change.baseline.sha256,
        mode: change.baseline.mode,
      }
    : { path: change.path, exists: false });
}

function toReceiptGit(result: PendingActionScopedCommitResult): PendingActionGitResult {
  return result.status === 'committed'
    ? { status: 'committed', commit: result.commit, branch: result.branch }
    : result.status === 'staged-not-committed'
      ? {
          status: 'staged-not-committed',
          branch: result.branch,
          errorCode: result.errorCode,
        }
      : { status: 'failed', errorCode: result.errorCode };
}

async function writeJsonAtomic(path: string, value: unknown, exclusive: boolean): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (exclusive) {
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
          throw materializerError('CHANGE_JOURNAL_CONFLICT', `Transaction journal already exists: ${path}.`);
        }
        throw error;
      }
      await rm(temporary, { force: true });
    } else {
      await rename(temporary, path);
    }
    await fsyncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function ensureSafeInternalDirectory(
  workspaceRoot: string,
  extra: readonly string[],
): Promise<string> {
  let cursor = workspaceRoot;
  for (const part of [...INTERNAL_ROOT, ...extra]) {
    cursor = join(cursor, part);
    await mkdir(cursor, { mode: 0o700 }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error;
    });
    const information = await lstat(cursor);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw materializerError('UNSAFE_INTERNAL_PATH', `Change engine directory is unsafe: ${cursor}.`);
    }
    assertInside(workspaceRoot, await realpath(cursor), 'Change engine directory escaped workspace.');
  }
  return cursor;
}

async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function fsyncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

async function safeLstat(path: string): Promise<Stats | undefined> {
  try { return await lstat(path); } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function tryReadRegularFileHash(path: string): Promise<string | undefined> {
  const information = await safeLstat(path);
  if (!information) return undefined;
  if (information.isSymbolicLink() || !information.isFile() || information.nlink !== 1) {
    throw materializerError('UNSAFE_CANONICAL_TARGET', `Expected private regular file: ${path}.`);
  }
  return sha256(await readFile(path));
}

async function readRegularFileHash(path: string): Promise<string> {
  const hash = await tryReadRegularFileHash(path);
  if (!hash) throw materializerError('MISSING_CANONICAL_TARGET', `Expected file is missing: ${path}.`);
  return hash;
}

async function assertOrphanArtifactMatches(
  path: string,
  expected: { sha256: string; byteLength: number; mode: number },
): Promise<void> {
  const information = await lstat(path);
  if (
    information.isSymbolicLink()
    || !information.isFile()
    || information.nlink !== 1
    || information.size !== expected.byteLength
    || (information.mode & 0o777) !== expected.mode
    || await readRegularFileHash(path) !== expected.sha256
  ) {
    throw materializerError(
      'UNSAFE_ORPHAN_TRANSACTION_ARTIFACT',
      `Refusing to remove an unverified transaction artifact: ${path}.`,
    );
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function enginePath(workspaceRoot: string, ...parts: string[]): string {
  const root = resolve(workspaceRoot, ...INTERNAL_ROOT);
  const path = resolve(root, ...parts);
  assertInside(root, path, 'Change engine internal path escaped root.');
  return path;
}

function assertInside(root: string, path: string, message: string): void {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
    throw materializerError('UNSAFE_PATH', message);
  }
}

function terminalConflict(record: PendingActionRecord): Error {
  return materializerError(
    'PENDING_ACTION_TERMINAL_CONFLICT',
    `PendingAction ${record.action.id} is already ${record.status}.`,
  );
}

function staleBaseline(path: string): Error {
  return materializerError('STALE_PENDING_ACTION_BASELINE', `Canonical baseline changed: ${path}.`);
}

function invalidJournal(): Error {
  return materializerError('CHANGE_JOURNAL_CORRUPT', 'Change materialization journal is invalid.');
}

function materializerError(code: string, message: string): Error {
  const error = new Error(message);
  Object.assign(error, { code });
  return error;
}

function assertExact(value: Record<string, unknown>, fields: readonly string[]): void {
  const expected = new Set(fields);
  if (
    fields.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !expected.has(field))
  ) throw invalidJournal();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
