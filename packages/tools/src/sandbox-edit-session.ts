import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';

import type { Sandbox as BashToolSandbox } from 'bash-tool';
import type { ToolSet } from 'ai';
import { Bash } from 'just-bash';

import {
  assertValidTextContent,
  fingerprintCandidateChanges,
  normalizeWorkspaceRelativePath,
  sha256Text,
} from './candidate-change-set';
import type {
  CandidateChangeSet,
  CandidateFileSnapshot,
  CandidateFileChange,
  RepositoryBaseline,
} from './candidate-change-set';
import {
  DEFAULT_MAX_RENDERED_DIFF_BYTES,
  renderCandidateChangeDiff,
} from './change-diff';
import { readRepositoryBaseline } from './git-integration';
import type {
  PendingActionOrigin,
  PendingActionView,
} from './pending-action-types';
import type { PendingActionStore } from './pending-action-store';
import { PolicyFs } from './policy-fs';
import { createReadTools } from './read-tools';
import type {
  WorkspaceReader,
  WorkspaceReaderDirectoryEntry,
} from './read-tools';
import {
  DEFAULT_MODEL_TOOL_OUTPUT_CHARS,
  OAN_COMMAND_ALLOWLIST,
  createSandboxToolSet,
} from './sandbox-toolset';
import type {
  SandboxProposeChangesInput,
  SandboxReadFileInput,
  SandboxWriteFileInput,
} from './sandbox-toolset';
import { TrackingFs } from './tracking-fs';
import {
  DEFAULT_MAX_IN_MEMORY_FS_BYTES,
  DEFAULT_MAX_PROJECTION_BYTES,
  DEFAULT_MAX_PROJECTION_FILE_BYTES,
  VIRTUAL_SCRATCH_ROOT,
  VIRTUAL_WORKSPACE_ROOT,
  createWorkspaceProjection,
  decodeWorkspaceText,
} from './workspace-projection';
import type { WorkspaceProjection } from './workspace-projection';
import {
  NOVEL_REFERENCE_PROJECTION_RULES,
  isNovelReferencePath,
  validateFinalObjectTreeReferences,
} from './final-object-tree-validator';
import { validateCandidateChangeSetAgainstPolicy } from './workspace-change-policy';
import type { WorkspaceChangePolicy } from './workspace-change-policy';

export const DEFAULT_SANDBOX_PREVIEW_BYTES = 128 * 1024;
export const DEFAULT_SANDBOX_READ_BYTES = 64 * 1024;
export const MAX_SANDBOX_READ_BYTES = 256 * 1024;
export const DEFAULT_SANDBOX_AUDIT_PREVIEW_BYTES = 512;
export const DEFAULT_SANDBOX_AUDIT_TOTAL_BYTES = 8 * 1024;

export interface SandboxEditSessionLimits {
  maxProjectionFileBytes: number;
  maxProjectionBytes: number;
  maxInMemoryBytes: number;
  maxScratchBytes: number;
  maxBashCalls: number;
  maxTotalWallTimeMs: number;
  maxTotalSourceBytes: number;
  maxTotalOutputBytes: number;
  maxReadBytes: number;
  maxPreviewBytes: number;
  maxAuditPreviewBytes: number;
  maxAuditTotalBytes: number;
  maxBashOutputChars: number;
  maxExecutionTimeMs: number;
  maxCommandCount: number;
  maxLoopIterations: number;
  maxTraversalEntries: number;
}

export interface CreateSandboxEditSessionOptions {
  workspaceRoot: string;
  policy: WorkspaceChangePolicy;
  sessionId?: string;
  abortSignal?: AbortSignal;
  pendingActionStore?: PendingActionStore;
  proposalOrigin?: PendingActionOrigin;
  pendingActionId?: string;
  repositoryReader?: (workspaceRoot: string) => Promise<RepositoryBaseline>;
  /** Trusted non-projection sources that must still be current before proposal. */
  freshnessChecks?: readonly (() => Promise<void>)[];
  limits?: Partial<SandboxEditSessionLimits>;
  now?: () => Date;
  /** Injectable monotonic clock for deterministic cumulative wall-time accounting. */
  monotonicNow?: () => number;
}

export interface SandboxProjectionSnapshot {
  readonly workspaceRoot: string;
  readonly projectionFingerprint: string;
  readonly files: readonly SandboxProjectionSnapshotFile[];
  readonly directories: readonly string[];
}

export interface SandboxProjectionSnapshotFile extends CandidateFileSnapshot {
  readonly mtimeMs: number;
}

export interface CandidateChangePreview {
  readonly changes: ReadonlyArray<{
    operation: 'create' | 'update' | 'delete';
    path: string;
    oldHash?: string;
    newHash?: string;
  }>;
  readonly stats: {
    created: number;
    updated: number;
    deleted: number;
    changedBytes: number;
  };
  readonly candidateFingerprint?: string;
  readonly diffExcerpt: string;
  readonly totalDiffBytes: number;
  readonly truncated: boolean;
}

export interface CandidateSourceMetadata {
  finalization: 'explicit-tool' | 'runtime-fallback';
}

export interface SandboxCommandAuditEntry {
  commandHash: string;
  commandPreview: string;
  exitCode: number | 'error';
}

export interface SandboxCommandAuditSummary {
  commandLogHash: string;
  commandCount: number;
  bashCalls: number;
  totalWallTimeMs: number;
  totalSourceBytes: number;
  totalOutputBytes: number;
  entries: readonly SandboxCommandAuditEntry[];
}

export interface SandboxProposalResult {
  pendingActions: PendingActionView[];
  noChanges: boolean;
}

export interface SandboxReadSource { path: string; sourceHash: string; originalChars: number }

export interface SandboxEditSession {
  drainReadSources(): SandboxReadSource[];
  readonly id: string;
  readonly tools: ToolSet;
  readonly policy: WorkspaceChangePolicy;
  readonly projectionFingerprint: string;
  projectionSnapshot(): SandboxProjectionSnapshot;
  assertFresh(): Promise<void>;
  isDirty(): boolean;
  isSealed(): boolean;
  preview(): Promise<CandidateChangePreview>;
  finalizeCandidate(input: CandidateSourceMetadata): Promise<CandidateChangeSet | undefined>;
  proposeChanges(
    input: SandboxProposeChangesInput & CandidateSourceMetadata,
  ): Promise<SandboxProposalResult>;
  commandAudit(): SandboxCommandAuditSummary;
  discard(): Promise<void>;
  dispose(): Promise<void>;
}

interface AuditState {
  entries: SandboxCommandAuditEntry[];
  bashCalls: number;
  totalWallTimeMs: number;
  totalSourceBytes: number;
  totalOutputBytes: number;
  previewBytes: number;
}

export async function createSandboxEditSession(
  options: CreateSandboxEditSessionOptions,
): Promise<SandboxEditSession> {
  const limits = normalizeLimits(options.limits);
  const projection = await createWorkspaceProjection({
    workspaceRoot: options.workspaceRoot,
    policy: options.policy,
    maxFileBytes: limits.maxProjectionFileBytes,
    maxTotalBytes: limits.maxProjectionBytes,
    maxInMemoryBytes: limits.maxInMemoryBytes,
  });
  const needsReferenceClosure = options.policy.writable.some((rule) =>
    isNovelReferencePath(`${rule.path}/`));
  const includesReferenceClosure = NOVEL_REFERENCE_PROJECTION_RULES.every((required) =>
    projection.manifest.rules.some((rule) => rule.kind === 'prefix' && rule.path === required.path));
  const referenceProjection = !needsReferenceClosure || includesReferenceClosure
    ? projection
    : await createWorkspaceProjection({
        workspaceRoot: options.workspaceRoot,
        rules: NOVEL_REFERENCE_PROJECTION_RULES,
        maxFileBytes: limits.maxProjectionFileBytes,
        maxTotalBytes: limits.maxProjectionBytes,
        maxInMemoryBytes: limits.maxInMemoryBytes,
      });
  if (referenceProjection !== projection) await projection.assertFresh();
  const repository = await (options.repositoryReader ?? readRepositoryBaseline)(
    projection.workspaceRoot,
  );
  const trackingFs = new TrackingFs(projection.fs, {
    workspaceRoot: VIRTUAL_WORKSPACE_ROOT,
    baselineFiles: projection.baselineFiles,
  });
  const readSources = new Map<string, SandboxReadSource>();
  const policyFs = new PolicyFs(trackingFs, {
    onRead(path, bytes) {
      if (!path.startsWith(`${VIRTUAL_WORKSPACE_ROOT}/`)) return;
      const relativePath = path.slice(VIRTUAL_WORKSPACE_ROOT.length + 1);
      const sourceHash = createHash('sha256').update(bytes).digest('hex');
      readSources.set(`${relativePath}:${sourceHash}`, { path: relativePath, sourceHash, originalChars: Buffer.from(bytes).toString('utf8').length });
    },
    policy: options.policy,
    baselineFiles: projection.baselineFiles,
    projectedPaths: [
      ...projection.manifest.directories,
      ...projection.manifest.files.map((file) => file.path),
    ],
    maxScratchBytes: limits.maxScratchBytes,
  });
  const bash = new Bash({
    fs: policyFs,
    cwd: VIRTUAL_WORKSPACE_ROOT,
    commands: [...OAN_COMMAND_ALLOWLIST],
    executionLimitProfile: 'hardened',
    executionLimits: {
      maxExecutionTimeMs: limits.maxExecutionTimeMs,
      maxSourceBytes: Math.min(limits.maxTotalSourceBytes, 256 * 1024),
      maxCommandCount: limits.maxCommandCount,
      maxLoopIterations: limits.maxLoopIterations,
      maxFileSystemBytes: limits.maxInMemoryBytes,
      maxOutputSize: Math.min(limits.maxTotalOutputBytes, 2 * 1024 * 1024),
      maxTraversalEntries: limits.maxTraversalEntries,
    },
    defenseInDepth: { enabled: 'auto' },
    python: false,
    javascript: false,
  });
  policyFs.activate();

  const session = new FileSandboxEditSession({
    options,
    limits,
    projection,
    referenceProjection,
    readSources,
    repository,
    trackingFs,
    policyFs,
    bash,
  });
  await session.initializeTools();
  return session;
}

class FileSandboxEditSession implements SandboxEditSession {
  readonly id: string;
  readonly policy: WorkspaceChangePolicy;
  readonly projectionFingerprint: string;

  #tools: ToolSet = Object.freeze({});
  #readSources: Map<string, SandboxReadSource>;
  #options: CreateSandboxEditSessionOptions;
  #limits: SandboxEditSessionLimits;
  #projection: WorkspaceProjection;
  #referenceProjection: WorkspaceProjection;
  #repository: RepositoryBaseline;
  #trackingFs: TrackingFs;
  #policyFs: PolicyFs;
  #bash: Bash;
  #createdAt: string;
  #now: () => Date;
  #monotonicNow: () => number;
  #projectionSnapshot: SandboxProjectionSnapshot;
  #audit: AuditState = {
    entries: [],
    bashCalls: 0,
    totalWallTimeMs: 0,
    totalSourceBytes: 0,
    totalOutputBytes: 0,
    previewBytes: 0,
  };
  #sealed = false;
  #discarded = false;
  #disposed = false;
  #finalized = false;
  #budgetFailure?: Error;
  #previewCache?: CandidateChangePreview;
  #proposalResult?: SandboxProposalResult;

  constructor(input: {
    readSources: Map<string, SandboxReadSource>;
    options: CreateSandboxEditSessionOptions;
    limits: SandboxEditSessionLimits;
    projection: WorkspaceProjection;
    referenceProjection: WorkspaceProjection;
    repository: RepositoryBaseline;
    trackingFs: TrackingFs;
    policyFs: PolicyFs;
    bash: Bash;
  }) {
    this.#readSources = input.readSources;
    this.#options = input.options;
    this.#limits = input.limits;
    this.#projection = input.projection;
    this.#referenceProjection = input.referenceProjection;
    this.#repository = input.repository;
    this.#trackingFs = input.trackingFs;
    this.#policyFs = input.policyFs;
    this.#bash = input.bash;
    this.#now = input.options.now ?? (() => new Date());
    this.#monotonicNow = input.options.monotonicNow ?? (() => performance.now());
    this.#createdAt = canonicalTimestamp(this.#now(), 'session createdAt');
    this.id = opaqueSessionId(input.options.sessionId ?? `ses_${randomUUID()}`);
    this.policy = input.options.policy;
    this.projectionFingerprint = input.projection.fingerprint;
    const metadataByPath = new Map(input.projection.manifest.files.map((file) => [
      file.path,
      file,
    ]));
    this.#projectionSnapshot = Object.freeze({
      workspaceRoot: input.projection.workspaceRoot,
      projectionFingerprint: input.projection.fingerprint,
      files: Object.freeze(input.projection.baselineFiles.map((file) => {
        const metadata = metadataByPath.get(file.path);
        if (!metadata) {
          throw new Error(`Projection manifest is missing baseline file metadata: ${file.path}.`);
        }
        return Object.freeze({ ...file, mtimeMs: metadata.mtimeMs });
      })),
      directories: input.projection.manifest.directories,
    });
  }

  drainReadSources(): SandboxReadSource[] {
    const sources = [...this.#readSources.values()];
    this.#readSources.clear();
    return sources;
  }

  get tools(): ToolSet {
    return this.#tools;
  }

  projectionSnapshot(): SandboxProjectionSnapshot {
    this.#assertUsable();
    return this.#projectionSnapshot;
  }

  async assertFresh(): Promise<void> {
    this.#assertUsable();
    await this.#assertAllSourcesFresh();
  }

  async initializeTools(): Promise<void> {
    const reader: WorkspaceReader = {
      readFile: async (path) => {
        this.#assertUsable();
        return this.#policyFs.readFile(path);
      },
      readdir: async (path): Promise<WorkspaceReaderDirectoryEntry[]> => {
        this.#assertUsable();
        const entries = await this.#policyFs.readdirWithFileTypes(path);
        return entries.map((entry) => ({
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymbolicLink: entry.isSymbolicLink,
        }));
      },
    };
    const domainTools = createReadTools({
      workspaceRoot: VIRTUAL_WORKSPACE_ROOT,
      reader,
    });
    const adapter: BashToolSandbox = {
      executeCommand: (command) => this.#executeCommand(command),
      readFile: async (path) => {
        this.#assertUsable();
        return this.#policyFs.readFile(this.#resolveSandboxPath(path));
      },
      writeFiles: async (files) => {
        this.#assertMutable();
        for (const file of files) {
          const path = this.#resolveSandboxPath(file.path);
          const content = typeof file.content === 'string'
            ? file.content
            : decodeWorkspaceText(file.content, `Sandbox write ${path}`);
          assertValidTextContent(content, `Sandbox write ${path}`);
          await this.#policyFs.mkdir(posix.dirname(path), { recursive: true });
          await this.#policyFs.writeFile(path, content);
        }
        this.#invalidatePreview();
      },
    };
    const tools = await createSandboxToolSet({
      sandbox: adapter,
      domainTools,
      projectionSummary: {
        fileCount: this.#projection.manifest.files.length,
        totalBytes: this.#projection.manifest.totalBytes,
        capability: this.policy.capability,
      },
      readFile: (input) => this.#readFile(input),
      writeFile: (input) => this.#writeFile(input),
      previewChanges: () => this.preview(),
      ...(this.#options.pendingActionStore
        ? {
            proposeChanges: (input: SandboxProposeChangesInput) => this.proposeChanges({
              ...input,
              finalization: 'explicit-tool',
            }),
          }
        : {}),
      maxBashOutputChars: this.#limits.maxBashOutputChars,
    });
    this.#tools = tools;
  }

  isDirty(): boolean {
    return this.#trackingFs.getCandidatePaths().length > 0;
  }

  isSealed(): boolean {
    return this.#sealed;
  }

  async preview(): Promise<CandidateChangePreview> {
    this.#assertUsable();
    this.#assertBudgetHealthy();
    if (this.#previewCache) return this.#previewCache;
    await this.#assertAllSourcesFresh();
    const candidate = await this.#buildCandidate('runtime-fallback');
    const preview = candidate
      ? renderPreview(candidate, this.#projection, this.#limits.maxPreviewBytes)
      : emptyPreview();
    this.#previewCache = deepFreeze(preview);
    return this.#previewCache;
  }

  async finalizeCandidate(
    input: CandidateSourceMetadata,
  ): Promise<CandidateChangeSet | undefined> {
    this.#assertUsable();
    this.#assertBudgetHealthy();
    if (this.#finalized) {
      throw new Error(`Sandbox edit session ${this.id} was already finalized.`);
    }
    const finalization = normalizeFinalization(input.finalization);
    this.#sealed = true;
    this.#finalized = true;
    await this.#assertAllSourcesFresh();
    return this.#buildCandidate(finalization);
  }

  async proposeChanges(
    input: SandboxProposeChangesInput & CandidateSourceMetadata,
  ): Promise<SandboxProposalResult> {
    this.#assertUsable();
    if (this.#proposalResult) return this.#proposalResult;
    const store = this.#options.pendingActionStore;
    if (!store) throw new Error('This sandbox session has no PendingAction store.');
    const title = boundedText(input.title, 'PendingAction title', 240);
    const description = boundedText(
      input.description,
      'PendingAction description',
      4_000,
    );
    const candidate = await this.finalizeCandidate({
      finalization: normalizeFinalization(input.finalization),
    });
    if (!candidate) {
      this.#proposalResult = deepFreeze({ pendingActions: [], noChanges: true });
      return this.#proposalResult;
    }
    const view = await store.proposeCandidate({
      candidate,
      title,
      description,
      ...(this.#options.pendingActionId ? { id: this.#options.pendingActionId } : {}),
      ...(this.#options.proposalOrigin ? { origin: this.#options.proposalOrigin } : {}),
    });
    this.#proposalResult = deepFreeze({
      pendingActions: [view],
      noChanges: false,
    });
    return this.#proposalResult;
  }

  commandAudit(): SandboxCommandAuditSummary {
    const entries = Object.freeze(this.#audit.entries.map((entry) => Object.freeze({
      ...entry,
    })));
    return Object.freeze({
      commandLogHash: auditDigest(entries),
      commandCount: entries.length,
      bashCalls: this.#audit.bashCalls,
      totalWallTimeMs: this.#audit.totalWallTimeMs,
      totalSourceBytes: this.#audit.totalSourceBytes,
      totalOutputBytes: this.#audit.totalOutputBytes,
      entries,
    });
  }

  async discard(): Promise<void> {
    if (this.#disposed) return;
    this.#sealed = true;
    this.#discarded = true;
    this.#previewCache = undefined;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#sealed = true;
    this.#disposed = true;
    this.#previewCache = undefined;
  }

  async #executeCommand(command: string) {
    this.#assertMutable();
    this.#assertBudgetHealthy();
    const source = originalBashToolCommand(command);
    assertValidTextContent(source, 'Bash source');
    const sourceBytes = Buffer.byteLength(source, 'utf8');
    if (this.#audit.bashCalls + 1 > this.#limits.maxBashCalls) {
      throw this.#poisonBudget('Sandbox bash call limit exceeded.');
    }
    if (this.#audit.totalSourceBytes + sourceBytes > this.#limits.maxTotalSourceBytes) {
      throw this.#poisonBudget('Sandbox cumulative source byte limit exceeded.');
    }
    if (this.#audit.totalWallTimeMs >= this.#limits.maxTotalWallTimeMs) {
      throw this.#poisonBudget('Sandbox cumulative wall-time limit exceeded.');
    }

    this.#audit.bashCalls += 1;
    this.#audit.totalSourceBytes += sourceBytes;
    this.#invalidatePreview();
    const startedAt = monotonicTimestamp(this.#monotonicNow());
    let exitCode: number | 'error' = 'error';
    try {
      const signal = combinedAbortSignal(
        this.#options.abortSignal,
        this.#limits.maxExecutionTimeMs,
      );
      const result = await this.#bash.exec(command, { signal });
      exitCode = result.exitCode;
      const outputBytes = Buffer.byteLength(result.stdout, 'utf8')
        + Buffer.byteLength(result.stderr, 'utf8');
      this.#audit.totalOutputBytes += outputBytes;
      if (this.#audit.totalOutputBytes > this.#limits.maxTotalOutputBytes) {
        throw this.#poisonBudget('Sandbox cumulative output byte limit exceeded.');
      }
      return {
        stdout: sanitizeSandboxText(result.stdout),
        stderr: sanitizeSandboxText(result.stderr),
        exitCode: result.exitCode,
      };
    } finally {
      const elapsed = Math.max(
        0,
        Math.ceil(monotonicTimestamp(this.#monotonicNow()) - startedAt),
      );
      this.#audit.totalWallTimeMs += elapsed;
      this.#appendAudit(source, exitCode);
      if (this.#audit.totalWallTimeMs > this.#limits.maxTotalWallTimeMs) {
        throw this.#poisonBudget('Sandbox cumulative wall-time limit exceeded.');
      }
    }
  }

  async #readFile(input: SandboxReadFileInput): Promise<unknown> {
    this.#assertUsable();
    const path = this.#resolveSandboxPath(input.path);
    const startLine = optionalPositiveInteger(input.startLine, 'startLine') ?? 1;
    const endLine = optionalPositiveInteger(input.endLine, 'endLine');
    if (endLine !== undefined && endLine < startLine) {
      throw new Error('readFile endLine must not precede startLine.');
    }
    const requestedMax = optionalPositiveInteger(input.maxBytes, 'maxBytes')
      ?? this.#limits.maxReadBytes;
    if (requestedMax > this.#limits.maxReadBytes) {
      throw new Error(`readFile maxBytes cannot exceed ${this.#limits.maxReadBytes}.`);
    }
    const fullContent = await this.#policyFs.readFile(path);
    const lines = fullContent.split('\n');
    const totalLines = fullContent.length === 0 ? 0 : lines.length;
    const selected = totalLines === 0
      ? ''
      : lines.slice(startLine - 1, endLine ?? totalLines).join('\n');
    const sanitized = sanitizeSandboxText(selected);
    const excerpt = truncateUtf8(sanitized, requestedMax);
    return {
      path: displayVirtualPath(path),
      content: excerpt.text,
      startLine,
      endLine: totalLines === 0
        ? 0
        : Math.min(endLine ?? totalLines, totalLines),
      totalLines,
      totalBytes: Buffer.byteLength(fullContent, 'utf8'),
      returnedBytes: Buffer.byteLength(excerpt.text, 'utf8'),
      truncated: excerpt.truncated
        || startLine > 1
        || (endLine !== undefined && endLine < totalLines),
    };
  }

  async #writeFile(input: SandboxWriteFileInput): Promise<unknown> {
    this.#assertMutable();
    const path = resolveWorkspaceFilePath(input.path);
    assertValidTextContent(input.content, `Sandbox write ${path}`);
    const byteLength = Buffer.byteLength(input.content, 'utf8');
    if (byteLength > this.policy.maxFileBytes) {
      throw new Error(
        `Sandbox write exceeds the ${this.policy.maxFileBytes}-byte file limit: ${path}.`,
      );
    }
    await this.#policyFs.mkdir(posix.dirname(path), { recursive: true });
    await this.#policyFs.writeFile(path, input.content);
    this.#invalidatePreview();
    return {
      success: true,
      path: displayVirtualPath(path),
      byteLength,
      sha256: sha256Text(input.content),
    };
  }

  async #buildCandidate(
    finalization: CandidateSourceMetadata['finalization'],
  ): Promise<CandidateChangeSet | undefined> {
    const audit = this.commandAudit();
    const exactAllowedTargets = this.policy.writable
      .filter((rule) => rule.kind === 'exact')
      .map((rule) => rule.path);
    const candidate = await this.#trackingFs.finalize({
      sessionId: this.id,
      createdAt: this.#createdAt,
      finalizedAt: canonicalTimestamp(this.#now(), 'candidate finalizedAt'),
      projectionFingerprint: this.#projection.fingerprint,
      repository: this.#repository,
      source: {
        kind: 'bash-session',
        capability: this.policy.capability,
        commandLogHash: audit.commandLogHash,
        commandCount: audit.commandCount,
        finalization,
      },
      ...(exactAllowedTargets.length > 0
        ? { allowedTargets: exactAllowedTargets }
        : {}),
    });
    if (!candidate) return undefined;
    validateCandidateChangeSetAgainstPolicy(candidate, this.policy);
    validateFinalObjectTreeReferences({
      baselineFiles: this.#referenceProjection.baselineFiles,
      changes: candidate.changes.map((change) => ({
        path: change.path,
        operation: change.operation,
        ...(change.operation === 'delete' ? {} : { content: change.draft.content }),
      })),
    });
    return candidate;
  }

  #appendAudit(source: string, exitCode: number | 'error'): void {
    const commandHash = createHash('sha256').update(source, 'utf8').digest('hex');
    const remaining = Math.max(
      0,
      this.#limits.maxAuditTotalBytes - this.#audit.previewBytes,
    );
    const limit = Math.min(this.#limits.maxAuditPreviewBytes, remaining);
    const sanitized = sanitizeSandboxText(source);
    const preview = limit === 0
      ? '[command preview omitted: cumulative audit limit reached]'
      : truncateUtf8(sanitized, limit, '\n[command preview truncated]').text;
    this.#audit.previewBytes += Buffer.byteLength(preview, 'utf8');
    this.#audit.entries.push({ commandHash, commandPreview: preview, exitCode });
  }

  #resolveSandboxPath(path: string): string {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('Sandbox path is required.');
    }
    if (path.startsWith('/')) return this.#policyFs.resolvePath('/', path.slice(1));
    return this.#policyFs.resolvePath(VIRTUAL_WORKSPACE_ROOT, path);
  }

  #invalidatePreview(): void {
    this.#previewCache = undefined;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error(`Sandbox edit session ${this.id} is disposed.`);
    if (this.#discarded) throw new Error(`Sandbox edit session ${this.id} was discarded.`);
    if (this.#options.abortSignal?.aborted) {
      throw this.#options.abortSignal.reason instanceof Error
        ? this.#options.abortSignal.reason
        : new Error('Sandbox edit session was aborted.');
    }
  }

  #assertMutable(): void {
    this.#assertUsable();
    if (this.#sealed) throw new Error(`Sandbox edit session ${this.id} is sealed.`);
  }

  #assertBudgetHealthy(): void {
    if (this.#budgetFailure) throw this.#budgetFailure;
  }

  async #assertAllSourcesFresh(): Promise<void> {
    await this.#projection.assertFresh();
    if (this.#referenceProjection !== this.#projection) await this.#referenceProjection.assertFresh();
    for (const check of this.#options.freshnessChecks ?? []) {
      await check();
    }
  }

  #poisonBudget(message: string): Error {
    this.#budgetFailure ??= Object.assign(new Error(message), {
      code: 'SANDBOX_RESOURCE_LIMIT_EXCEEDED',
    });
    return this.#budgetFailure;
  }
}

function monotonicTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Sandbox monotonic clock returned an invalid timestamp.');
  }
  return value;
}

export function sanitizeSandboxText(value: string): string {
  assertValidTextContent(value, 'Sandbox text');
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, (character) => (
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    ));
}

function normalizeLimits(
  input: Partial<SandboxEditSessionLimits> | undefined,
): SandboxEditSessionLimits {
  const limits: SandboxEditSessionLimits = {
    maxProjectionFileBytes: input?.maxProjectionFileBytes
      ?? DEFAULT_MAX_PROJECTION_FILE_BYTES,
    maxProjectionBytes: input?.maxProjectionBytes ?? DEFAULT_MAX_PROJECTION_BYTES,
    maxInMemoryBytes: input?.maxInMemoryBytes ?? DEFAULT_MAX_IN_MEMORY_FS_BYTES,
    maxScratchBytes: input?.maxScratchBytes ?? 8 * 1024 * 1024,
    maxBashCalls: input?.maxBashCalls ?? 64,
    maxTotalWallTimeMs: input?.maxTotalWallTimeMs ?? 60_000,
    maxTotalSourceBytes: input?.maxTotalSourceBytes ?? 1024 * 1024,
    maxTotalOutputBytes: input?.maxTotalOutputBytes ?? 4 * 1024 * 1024,
    maxReadBytes: input?.maxReadBytes ?? DEFAULT_SANDBOX_READ_BYTES,
    maxPreviewBytes: input?.maxPreviewBytes ?? DEFAULT_SANDBOX_PREVIEW_BYTES,
    maxAuditPreviewBytes: input?.maxAuditPreviewBytes
      ?? DEFAULT_SANDBOX_AUDIT_PREVIEW_BYTES,
    maxAuditTotalBytes: input?.maxAuditTotalBytes ?? DEFAULT_SANDBOX_AUDIT_TOTAL_BYTES,
    maxBashOutputChars: input?.maxBashOutputChars ?? DEFAULT_MODEL_TOOL_OUTPUT_CHARS,
    maxExecutionTimeMs: input?.maxExecutionTimeMs ?? 15_000,
    maxCommandCount: input?.maxCommandCount ?? 2_000,
    maxLoopIterations: input?.maxLoopIterations ?? 5_000,
    maxTraversalEntries: input?.maxTraversalEntries ?? 20_000,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Sandbox limit ${name} must be a positive integer.`);
    }
  }
  if (limits.maxReadBytes > MAX_SANDBOX_READ_BYTES) {
    throw new Error(`Sandbox maxReadBytes cannot exceed ${MAX_SANDBOX_READ_BYTES}.`);
  }
  if (limits.maxProjectionFileBytes > limits.maxProjectionBytes) {
    throw new Error('Sandbox projection file limit cannot exceed projection total limit.');
  }
  return Object.freeze(limits);
}

function renderPreview(
  candidate: CandidateChangeSet,
  projection: WorkspaceProjection,
  maxBytes: number,
): CandidateChangePreview {
  const baseline = new Map(projection.baselineFiles.map((file) => [file.path, file.content]));
  const diff = renderCandidateChangeDiff(candidate.changes.map((change) => {
    if (change.operation === 'create') {
      return {
        operation: 'create' as const,
        path: change.path,
        newContent: change.draft.content,
      };
    }
    if (change.operation === 'delete') {
      return {
        operation: 'delete' as const,
        path: change.path,
        oldContent: requireBaselineContent(baseline, change),
      };
    }
    return {
      operation: 'update' as const,
      path: change.path,
      oldContent: requireBaselineContent(baseline, change),
      newContent: change.draft.content,
    };
  }), { maxBytes: DEFAULT_MAX_RENDERED_DIFF_BYTES });
  const excerpt = truncateUtf8(diff, maxBytes, '\n[diff excerpt truncated]');
  return {
    changes: candidate.changes.map(publicCandidateChange),
    stats: structuredClone(candidate.stats),
    candidateFingerprint: fingerprintCandidateChanges(candidate.changes),
    diffExcerpt: excerpt.text,
    totalDiffBytes: Buffer.byteLength(diff, 'utf8'),
    truncated: excerpt.truncated,
  };
}

function publicCandidateChange(change: CandidateFileChange) {
  return {
    operation: change.operation,
    path: change.path,
    ...(change.baseline.exists ? { oldHash: change.baseline.sha256 } : {}),
    ...(change.draft ? { newHash: change.draft.sha256 } : {}),
  };
}

function requireBaselineContent(
  baseline: Map<string, string>,
  change: Exclude<CandidateFileChange, { operation: 'create' }>,
): string {
  const content = baseline.get(change.path);
  if (content === undefined) {
    throw new Error(`Candidate baseline content is unavailable: ${change.path}.`);
  }
  return content;
}

function emptyPreview(): CandidateChangePreview {
  return {
    changes: [],
    stats: { created: 0, updated: 0, deleted: 0, changedBytes: 0 },
    diffExcerpt: '',
    totalDiffBytes: 0,
    truncated: false,
  };
}

function originalBashToolCommand(command: string): string {
  const prefix = 'cd "/workspace" && ';
  return command.startsWith(prefix) ? command.slice(prefix.length) : command;
}

function combinedAbortSignal(
  sessionSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return sessionSignal ? AbortSignal.any([sessionSignal, timeout]) : timeout;
}

function resolveWorkspaceFilePath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Sandbox workspace path is required.');
  }
  const relative = path.startsWith(`${VIRTUAL_WORKSPACE_ROOT}/`)
    ? path.slice(VIRTUAL_WORKSPACE_ROOT.length + 1)
    : normalizeWorkspaceRelativePath(path);
  return `${VIRTUAL_WORKSPACE_ROOT}/${normalizeWorkspaceRelativePath(relative)}`;
}

function displayVirtualPath(path: string): string {
  return path.startsWith(`${VIRTUAL_WORKSPACE_ROOT}/`)
    ? path.slice(VIRTUAL_WORKSPACE_ROOT.length + 1)
    : path.startsWith(`${VIRTUAL_SCRATCH_ROOT}/`)
      ? path
      : path;
}

function truncateUtf8(
  value: string,
  maxBytes: number,
  suffix = '',
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false };
  const suffixBytes = Buffer.from(suffix, 'utf8');
  const bodyLimit = Math.max(0, maxBytes - suffixBytes.byteLength);
  let end = bodyLimit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  const body = bytes.subarray(0, end).toString('utf8');
  const fittedSuffix = suffixBytes.byteLength <= maxBytes ? suffix : '';
  return { text: `${body}${fittedSuffix}`, truncated: true };
}

function auditDigest(entries: readonly SandboxCommandAuditEntry[]): string {
  return createHash('sha256').update(JSON.stringify(entries.map((entry) => ({
    commandHash: entry.commandHash,
    exitCode: entry.exitCode,
  })))).digest('hex');
}

function opaqueSessionId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error('Sandbox session id is invalid.');
  }
  return value;
}

function canonicalTimestamp(value: Date, label: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value.toISOString();
}

function normalizeFinalization(
  value: CandidateSourceMetadata['finalization'],
): CandidateSourceMetadata['finalization'] {
  if (value !== 'explicit-tool' && value !== 'runtime-fallback') {
    throw new Error('Sandbox candidate finalization is invalid.');
  }
  return value;
}

function boundedText(value: string, label: string, maxLength: number): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maxLength
    || /\p{Cc}/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function optionalPositiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
