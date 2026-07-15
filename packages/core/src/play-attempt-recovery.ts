import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'yaml';

import {
  assertSafePlayRehearsalId,
} from './play-rehearsal.js';
import {
  PlayTurnAttemptError,
  normalizePlayTurnAttempt,
} from './play-turn-attempt.js';
import type { PlayTurnAttempt } from './play-turn-attempt.js';

export const PLAY_ATTEMPT_RECOVERY_DIRECTORY = '.recovery/turn-attempts' as const;
export const PLAY_ATTEMPT_RECOVERY_FILE = 'attempt.yaml' as const;
export const PLAY_ATTEMPT_ACTIVE_MARKER_FILE = '.active-attempt' as const;

const PLAY_ATTEMPT_RECOVERY_STAGE_PREFIX = '.attempt-stage.';
const PLAY_ATTEMPT_RECOVERY_LOCKS_DIRECTORY = '.attempt-locks';
const PLAY_ATTEMPT_RECOVERY_LOCK_OWNER_FILE = 'owner.json';
const PLAY_ATTEMPT_RECOVERY_INCOMPLETE_LOCK_STALE_MS = 30_000;
const PLAY_ATTEMPT_RECOVERY_LOCK_WAIT_ATTEMPTS = 250;
const PLAY_ATTEMPT_RECOVERY_LOCK_WAIT_MS = 10;

export type PlayAttemptRecoveryClassification =
  | 'active'
  | 'terminal';

export interface PlayAttemptRecoverySummary {
  attemptId: string;
  sessionId: string;
  status: PlayTurnAttempt['status'];
  attemptRevision: number;
  updatedAt: string;
  classification: PlayAttemptRecoveryClassification;
}

export interface WritePlayTurnAttemptRecoveryOptions {
  expectedAttemptRevision: number;
}

export interface PlayTurnAttemptRecoveryTransaction {
  list(): Promise<PlayAttemptRecoverySummary[]>;
  read(attemptId: string): Promise<PlayTurnAttempt>;
  write(
    attempt: PlayTurnAttempt,
    options: WritePlayTurnAttemptRecoveryOptions,
  ): Promise<string>;
  remove(attemptId: string): Promise<void>;
}

export async function createPlayTurnAttemptRecovery(
  workspaceRoot: string,
  attemptValue: PlayTurnAttempt,
): Promise<string> {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  if (attempt.status !== 'running') {
    throw new Error('A new Play attempt recovery must start in running status.');
  }
  return withPlayAttemptRecoveryLock(
    workspaceRoot,
    attempt.sessionId,
    async () => {
      const active = await listPlayTurnAttemptRecoveriesLocked(
        workspaceRoot,
        attempt.sessionId,
      );
      const existingActive = active.find((summary) =>
        summary.classification === 'active' && summary.attemptId !== attempt.id);
      if (existingActive) {
        throw new Error(
          `Play session already has an active attempt: ${existingActive.attemptId}.`,
        );
      }
      const attemptsRoot = resolvePlayAttemptsRecoveryRoot(
        workspaceRoot,
        attempt.sessionId,
      );
      const attemptRoot = resolvePlayAttemptRecoveryRoot(
        workspaceRoot,
        attempt.sessionId,
        attempt.id,
      );
      if (await pathExists(attemptRoot)) {
        throw new Error(`Play attempt recovery already exists: ${attempt.id}.`);
      }

      await mkdir(attemptsRoot, { recursive: true });
      const stageRoot = join(
        attemptsRoot,
        `${PLAY_ATTEMPT_RECOVERY_STAGE_PREFIX}${randomUUID()}`,
      );
      let published = false;
      await mkdir(stageRoot, { recursive: false });
      try {
        await writePlayTurnAttemptRecoveryFile(stageRoot, attempt);
        await rename(stageRoot, attemptRoot);
        published = true;
        await reconcilePlayAttemptActiveMarkerLocked(
          workspaceRoot,
          attempt.sessionId,
          attempt.id,
        );
        return join(attemptRoot, PLAY_ATTEMPT_RECOVERY_FILE);
      } catch (error) {
        await rm(published ? attemptRoot : stageRoot, {
          recursive: true,
          force: true,
        });
        await reconcilePlayAttemptActiveMarkerLocked(
          workspaceRoot,
          attempt.sessionId,
        ).catch(() => undefined);
        throw error;
      }
    },
  );
}

export async function writePlayTurnAttemptRecovery(
  workspaceRoot: string,
  attemptValue: PlayTurnAttempt,
  options: WritePlayTurnAttemptRecoveryOptions,
): Promise<string> {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  return withPlayAttemptRecoveryLock(
    workspaceRoot,
    attempt.sessionId,
    () => writePlayTurnAttemptRecoveryLocked(workspaceRoot, attempt, options),
  );
}

async function writePlayTurnAttemptRecoveryLocked(
  workspaceRoot: string,
  attempt: PlayTurnAttempt,
  options: WritePlayTurnAttemptRecoveryOptions,
): Promise<string> {
  const expectedRevision = assertExpectedPlayAttemptRevision(
    options.expectedAttemptRevision,
  );
  const attemptRoot = resolvePlayAttemptRecoveryRoot(
    workspaceRoot,
    attempt.sessionId,
    attempt.id,
  );
  if (!await pathExists(attemptRoot)) {
    throw new Error(`Play attempt recovery does not exist: ${attempt.id}.`);
  }
  if (attempt.status === 'running' || attempt.status === 'prepared') {
    const active = await listPlayTurnAttemptRecoveriesLocked(
      workspaceRoot,
      attempt.sessionId,
    );
    const conflicting = active.find((summary) =>
      summary.classification === 'active' && summary.attemptId !== attempt.id);
    if (conflicting) {
      throw new Error(
        `Play session already has an active attempt: ${conflicting.attemptId}.`,
      );
    }
  }
  const authoritative = await readPlayTurnAttemptRecoveryFile(
    workspaceRoot,
    attempt.sessionId,
    attempt.id,
  );
  if (authoritative.attemptRevision !== expectedRevision) {
    throw new PlayTurnAttemptError(
      'revisionConflict',
      `Play attempt recovery revision conflict: expected ${expectedRevision}, current ${authoritative.attemptRevision}.`,
    );
  }
  if (attempt.attemptRevision !== expectedRevision + 1) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      `Play attempt recovery write must advance revision ${expectedRevision} exactly once.`,
    );
  }
  const target = await writePlayTurnAttemptRecoveryFile(attemptRoot, attempt);
  await reconcilePlayAttemptActiveMarkerLocked(
    workspaceRoot,
    attempt.sessionId,
    attempt.status === 'running' || attempt.status === 'prepared'
      ? attempt.id
      : undefined,
  );
  return target;
}

export async function readPlayTurnAttemptRecovery(
  workspaceRoot: string,
  sessionIdValue: string,
  attemptIdValue: string,
): Promise<PlayTurnAttempt> {
  const sessionId = assertSafePlayRehearsalId(sessionIdValue, 'recovery sessionId');
  const attemptId = assertSafePlayRehearsalId(attemptIdValue, 'recovery attemptId');
  return withPlayAttemptRecoveryLock(
    workspaceRoot,
    sessionId,
    () => readPlayTurnAttemptRecoveryLocked(workspaceRoot, sessionId, attemptId),
  );
}

async function readPlayTurnAttemptRecoveryLocked(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): Promise<PlayTurnAttempt> {
  let attempt: PlayTurnAttempt;
  try {
    attempt = await readPlayTurnAttemptRecoveryFile(
      workspaceRoot,
      sessionId,
      attemptId,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await removeIncompletePlayAttemptRecovery(
      workspaceRoot,
      sessionId,
      attemptId,
    );
    await reconcilePlayAttemptActiveMarkerLocked(workspaceRoot, sessionId);
    throw error;
  }
  await reconcilePlayAttemptActiveMarkerLocked(
    workspaceRoot,
    sessionId,
    attempt.status === 'running' || attempt.status === 'prepared'
      ? attempt.id
      : undefined,
  );
  return attempt;
}

export async function listPlayTurnAttemptRecoveries(
  workspaceRoot: string,
  sessionIdValue: string,
): Promise<PlayAttemptRecoverySummary[]> {
  const sessionId = assertSafePlayRehearsalId(sessionIdValue, 'recovery sessionId');
  return withPlayAttemptRecoveryLock(
    workspaceRoot,
    sessionId,
    () => listPlayTurnAttemptRecoveriesLocked(workspaceRoot, sessionId),
  );
}

async function listPlayTurnAttemptRecoveriesLocked(
  workspaceRoot: string,
  sessionId: string,
): Promise<PlayAttemptRecoverySummary[]> {
  const attemptsRoot = resolvePlayAttemptsRecoveryRoot(workspaceRoot, sessionId);
  let names: string[];
  try {
    names = (await readdir(attemptsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const attempts: PlayTurnAttempt[] = [];
  for (const name of names) {
    const attemptId = assertSafePlayRehearsalId(name, 'recovery attemptId');
    try {
      attempts.push(await readPlayTurnAttemptRecoveryFile(
        workspaceRoot,
        sessionId,
        attemptId,
      ));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await removeIncompletePlayAttemptRecovery(
        workspaceRoot,
        sessionId,
        attemptId,
      );
    }
  }
  const summaries = attempts.map((attempt): PlayAttemptRecoverySummary => ({
    attemptId: attempt.id,
    sessionId: attempt.sessionId,
    status: attempt.status,
    attemptRevision: attempt.attemptRevision,
    updatedAt: attempt.updatedAt,
    classification: attempt.status === 'running' || attempt.status === 'prepared'
      ? 'active'
      : 'terminal',
  })).sort((left, right) =>
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.attemptId.localeCompare(right.attemptId));
  if (summaries.filter((summary) => summary.classification === 'active').length > 1) {
    throw new Error(`Play session ${sessionId} has multiple active attempt recoveries.`);
  }
  await reconcilePlayAttemptActiveMarkerLocked(
    workspaceRoot,
    sessionId,
    summaries.find((summary) => summary.classification === 'active')?.attemptId,
  );
  return summaries;
}

export async function removePlayTurnAttemptRecovery(
  workspaceRoot: string,
  sessionIdValue: string,
  attemptIdValue: string,
): Promise<void> {
  const sessionId = assertSafePlayRehearsalId(sessionIdValue, 'recovery sessionId');
  const attemptId = assertSafePlayRehearsalId(attemptIdValue, 'recovery attemptId');
  await withPlayAttemptRecoveryLock(
    workspaceRoot,
    sessionId,
    () => removePlayTurnAttemptRecoveryLocked(workspaceRoot, sessionId, attemptId),
  );
}

async function removePlayTurnAttemptRecoveryLocked(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): Promise<void> {
  await rm(
    resolvePlayAttemptRecoveryRoot(workspaceRoot, sessionId, attemptId),
    { recursive: true, force: true },
  );
  await reconcilePlayAttemptActiveMarkerLocked(workspaceRoot, sessionId);
}

export async function withPlayTurnAttemptRecoveryTransaction<T>(
  workspaceRoot: string,
  sessionIdValue: string,
  operation: (transaction: PlayTurnAttemptRecoveryTransaction) => Promise<T>,
): Promise<T> {
  const sessionId = assertSafePlayRehearsalId(sessionIdValue, 'recovery sessionId');
  return withPlayAttemptRecoveryLock(workspaceRoot, sessionId, () => operation({
    list: () => listPlayTurnAttemptRecoveriesLocked(workspaceRoot, sessionId),
    read: (attemptIdValue) => readPlayTurnAttemptRecoveryLocked(
      workspaceRoot,
      sessionId,
      assertSafePlayRehearsalId(attemptIdValue, 'recovery attemptId'),
    ),
    write: (attemptValue, writeOptions) => {
      const attempt = normalizePlayTurnAttempt(attemptValue);
      if (attempt.sessionId !== sessionId) {
        throw new Error('Play attempt transaction cannot cross sessions.');
      }
      return writePlayTurnAttemptRecoveryLocked(
        workspaceRoot,
        attempt,
        writeOptions,
      );
    },
    remove: (attemptIdValue) => removePlayTurnAttemptRecoveryLocked(
      workspaceRoot,
      sessionId,
      assertSafePlayRehearsalId(attemptIdValue, 'recovery attemptId'),
    ),
  }));
}

export function resolvePlayAttemptRecoveryPath(
  workspaceRoot: string,
  sessionIdValue: string,
  attemptIdValue: string,
): string {
  const sessionId = assertSafePlayRehearsalId(sessionIdValue, 'recovery sessionId');
  const attemptId = assertSafePlayRehearsalId(attemptIdValue, 'recovery attemptId');
  return join(
    resolvePlayAttemptRecoveryRoot(workspaceRoot, sessionId, attemptId),
    PLAY_ATTEMPT_RECOVERY_FILE,
  );
}

async function writePlayTurnAttemptRecoveryFile(
  attemptRoot: string,
  attempt: PlayTurnAttempt,
): Promise<string> {
  const target = join(attemptRoot, PLAY_ATTEMPT_RECOVERY_FILE);
  const temporary = join(attemptRoot, `.attempt.${randomUUID()}.tmp`);
  const content = stringify(attempt);
  await writeFile(
    temporary,
    content.endsWith('\n') ? content : `${content}\n`,
    'utf-8',
  );
  await rename(temporary, target);
  return target;
}

async function readPlayTurnAttemptRecoveryFile(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): Promise<PlayTurnAttempt> {
  const attemptRoot = resolvePlayAttemptRecoveryRoot(
    workspaceRoot,
    sessionId,
    attemptId,
  );
  const attempt = normalizePlayTurnAttempt(
    parse(await readFile(join(attemptRoot, PLAY_ATTEMPT_RECOVERY_FILE), 'utf-8')),
  );
  if (attempt.sessionId !== sessionId || attempt.id !== attemptId) {
    throw new Error('Play attempt recovery identity does not match its directory.');
  }
  return attempt;
}

async function removeIncompletePlayAttemptRecovery(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): Promise<void> {
  const attemptRoot = resolvePlayAttemptRecoveryRoot(
    workspaceRoot,
    sessionId,
    attemptId,
  );
  if (await pathExists(join(attemptRoot, PLAY_ATTEMPT_RECOVERY_FILE))) return;
  await rm(attemptRoot, { recursive: true, force: true });
}

function resolvePlayAttemptsRecoveryRoot(
  workspaceRoot: string,
  sessionId: string,
): string {
  const workspace = resolve(workspaceRoot);
  const sessionRoot = resolve(
    workspace,
    '.workspace',
    'play-sessions',
    sessionId,
  );
  const recoveryRoot = resolve(
    sessionRoot,
    '.recovery',
    'turn-attempts',
  );
  assertContained(workspace, sessionRoot, 'Play session recovery');
  assertContained(sessionRoot, recoveryRoot, 'Play attempt recovery');
  return recoveryRoot;
}

function resolvePlayAttemptRecoveryRoot(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): string {
  const attemptsRoot = resolvePlayAttemptsRecoveryRoot(workspaceRoot, sessionId);
  const attemptRoot = resolve(attemptsRoot, attemptId);
  assertContained(attemptsRoot, attemptRoot, 'Play attempt recovery');
  return attemptRoot;
}

function assertContained(root: string, candidate: string, label: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath.startsWith('..') ||
    relativePath === '' ||
    relativePath.includes(`..${sep}`)
  ) {
    throw new Error(`${label} path must remain contained.`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertExpectedPlayAttemptRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play attempt recovery expectedAttemptRevision must be a non-negative integer.',
    );
  }
  return value as number;
}

interface PlayAttemptRecoveryLockOwner {
  token: string;
  pid: number;
  createdAt: string;
}

interface PlayAttemptActiveMarkerObservation {
  attemptId?: string;
}

async function withPlayAttemptRecoveryLock<T>(
  workspaceRoot: string,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquirePlayAttemptRecoveryLock(workspaceRoot, sessionId);
  try {
    await cleanupPlayAttemptRecoveryStages(workspaceRoot, sessionId);
    return await operation();
  } finally {
    await release();
  }
}

async function acquirePlayAttemptRecoveryLock(
  workspaceRoot: string,
  sessionId: string,
): Promise<() => Promise<void>> {
  const lockRoot = resolvePlayAttemptRecoveryLockRoot(workspaceRoot, sessionId);
  const ownerPath = join(lockRoot, PLAY_ATTEMPT_RECOVERY_LOCK_OWNER_FILE);
  const owner: PlayAttemptRecoveryLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  await mkdir(dirname(lockRoot), { recursive: true });

  for (
    let iteration = 0;
    iteration < PLAY_ATTEMPT_RECOVERY_LOCK_WAIT_ATTEMPTS;
    iteration += 1
  ) {
    try {
      await mkdir(lockRoot, { recursive: false });
      try {
        await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, {
          encoding: 'utf-8',
          flag: 'wx',
        });
      } catch (error) {
        await rm(lockRoot, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        await removePlayAttemptRecoveryLockIfOwned(lockRoot, owner.token);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await removeStalePlayAttemptRecoveryLock(lockRoot)) continue;
      await new Promise<void>((resolveWait) => {
        setTimeout(resolveWait, PLAY_ATTEMPT_RECOVERY_LOCK_WAIT_MS);
      });
    }
  }

  throw new Error(`Play session ${sessionId} recovery lock did not stabilize.`);
}

async function removePlayAttemptRecoveryLockIfOwned(
  lockRoot: string,
  token: string,
): Promise<void> {
  try {
    const raw = await readFile(
      join(lockRoot, PLAY_ATTEMPT_RECOVERY_LOCK_OWNER_FILE),
      'utf-8',
    );
    if (parsePlayAttemptRecoveryLockOwner(raw)?.token === token) {
      await rm(lockRoot, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function removeStalePlayAttemptRecoveryLock(
  lockRoot: string,
): Promise<boolean> {
  let raw: string | undefined;
  let lockStat: Awaited<ReturnType<typeof stat>>;
  try {
    lockStat = await stat(lockRoot);
    raw = await readFile(
      join(lockRoot, PLAY_ATTEMPT_RECOVERY_LOCK_OWNER_FILE),
      'utf-8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      lockStat = await stat(lockRoot);
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw statError;
    }
  }

  const owner = raw ? parsePlayAttemptRecoveryLockOwner(raw) : undefined;
  if (owner && isProcessAlive(owner.pid)) return false;
  if (
    !owner &&
    Date.now() - lockStat.mtimeMs <
      PLAY_ATTEMPT_RECOVERY_INCOMPLETE_LOCK_STALE_MS
  ) {
    return false;
  }

  const observedIdentity = owner?.token ?? [
    lockStat.dev,
    lockStat.ino,
    Math.trunc(lockStat.mtimeMs),
  ].join('-');
  if (raw === undefined) {
    const tombstone = `${JSON.stringify({ staleLockIdentity: observedIdentity })}\n`;
    try {
      // Make an incomplete lock non-empty before quarantine. A delayed
      // contender can no longer rename a replacement live lock over it.
      await writeFile(
        join(lockRoot, PLAY_ATTEMPT_RECOVERY_LOCK_OWNER_FILE),
        tombstone,
        { encoding: 'utf-8', flag: 'wx' },
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return true;
      if (code === 'EEXIST') return false;
      throw error;
    }
  } else {
    try {
      const current = await readFile(
        join(lockRoot, PLAY_ATTEMPT_RECOVERY_LOCK_OWNER_FILE),
        'utf-8',
      );
      if (current !== raw) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  }
  const quarantineRoot = `${lockRoot}.stale.${observedIdentity}`;
  try {
    // Contenders observing the same stale owner use the same destination.
    // Keeping it prevents a delayed contender from renaming a replacement lock.
    await rename(lockRoot, quarantineRoot);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return false;
    throw error;
  }
}

function parsePlayAttemptRecoveryLockOwner(
  raw: string,
): PlayAttemptRecoveryLockOwner | undefined {
  try {
    const value = JSON.parse(raw) as Partial<PlayAttemptRecoveryLockOwner>;
    return typeof value.token === 'string' && value.token.length > 0 &&
      Number.isSafeInteger(value.pid) && (value.pid as number) > 0 &&
      typeof value.createdAt === 'string' && value.createdAt.length > 0
      ? value as PlayAttemptRecoveryLockOwner
      : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function cleanupPlayAttemptRecoveryStages(
  workspaceRoot: string,
  sessionId: string,
): Promise<void> {
  const attemptsRoot = resolvePlayAttemptsRecoveryRoot(workspaceRoot, sessionId);
  let entries: Dirent[];
  try {
    entries = await readdir(attemptsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(entries
    .filter((entry) =>
      entry.isDirectory() && isPlayAttemptRecoveryStageName(entry.name))
    .map((entry) =>
      rm(join(attemptsRoot, entry.name), { recursive: true, force: true })));
}

function resolvePlayAttemptRecoveryLockRoot(
  workspaceRoot: string,
  sessionIdValue: string,
): string {
  const sessionId = assertSafePlayRehearsalId(
    sessionIdValue,
    'recovery lock sessionId',
  );
  const workspace = resolve(workspaceRoot);
  const sessionsRoot = resolve(workspace, '.workspace', 'play-sessions');
  const locksRoot = resolve(
    sessionsRoot,
    PLAY_ATTEMPT_RECOVERY_LOCKS_DIRECTORY,
  );
  const lockRoot = resolve(locksRoot, `${sessionId}.lock`);
  assertContained(workspace, sessionsRoot, 'Play sessions recovery lock');
  assertContained(sessionsRoot, locksRoot, 'Play attempt recovery lock');
  assertContained(locksRoot, lockRoot, 'Play attempt recovery lock');
  return lockRoot;
}

function isPlayAttemptRecoveryStageName(name: string): boolean {
  return /^\.attempt-stage\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
    .test(name);
}

async function reconcilePlayAttemptActiveMarkerLocked(
  workspaceRoot: string,
  sessionId: string,
  expectedActiveAttemptId?: string,
): Promise<void> {
  const expectedAttemptId = expectedActiveAttemptId === undefined
    ? undefined
    : assertSafePlayRehearsalId(
        expectedActiveAttemptId,
        'expected active attempt marker',
      );
  const attemptsRoot = resolvePlayAttemptsRecoveryRoot(workspaceRoot, sessionId);
  const markerPath = join(
    attemptsRoot,
    PLAY_ATTEMPT_ACTIVE_MARKER_FILE,
  );
  let marker: PlayAttemptActiveMarkerObservation | undefined;
  try {
    marker = await readPlayAttemptActiveMarker(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (expectedAttemptId && marker?.attemptId === expectedAttemptId) return;
  if (marker?.attemptId) {
    const markerTarget = await classifyPlayAttemptMarkerTarget(
      workspaceRoot,
      sessionId,
      marker.attemptId,
    );
    if (markerTarget === 'active') {
      if (!expectedAttemptId) return;
      throw new Error(
        `Play session already has an active attempt: ${marker.attemptId}.`,
      );
    }
  }

  if (marker) await rm(markerPath, { force: true });
  if (!expectedAttemptId) return;
  await writeFile(markerPath, `${expectedAttemptId}\n`, {
    encoding: 'utf-8',
    flag: 'wx',
  });
}

async function classifyPlayAttemptMarkerTarget(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): Promise<'active' | 'terminal' | 'missing'> {
  try {
    const attempt = await readPlayTurnAttemptRecoveryFile(
      workspaceRoot,
      sessionId,
      attemptId,
    );
    return attempt.status === 'running' || attempt.status === 'prepared'
      ? 'active'
      : 'terminal';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function readPlayAttemptActiveMarker(
  markerPath: string,
): Promise<PlayAttemptActiveMarkerObservation> {
  const raw = await readFile(markerPath, 'utf-8');
  try {
    return {
      attemptId: assertSafePlayRehearsalId(
        raw.trim(),
        'active attempt marker',
      ),
    };
  } catch {
    return {};
  }
}
