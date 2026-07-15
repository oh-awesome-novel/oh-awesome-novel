import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLAY_ATTEMPT_ACTIVE_MARKER_FILE,
  cancelPlayTurnAttempt,
  createPlayTurnAttempt,
  createPlayTurnAttemptRecovery,
  listPlayTurnAttemptRecoveries,
  readPlayTurnAttemptRecovery,
  removePlayTurnAttemptRecovery,
  resolvePlayAttemptRecoveryPath,
  writePlayTurnAttemptRecovery,
} from '@oh-awesome-novel/core';

describe('Play attempt active-marker recovery', () => {
  it('repairs a marker left after a terminal write and keeps Cancel replay usable', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-attempt-terminal-marker-'));
    const sessionId = 'session-terminal-marker';
    const running = createAttempt(sessionId, 'attempt-terminal');
    const cancelInput = {
      expectedAttemptRevision: 0,
      idempotencyKey: 'cancel-terminal',
    };

    try {
      await createPlayTurnAttemptRecovery(workspaceRoot, running);
      const cancelled = cancelPlayTurnAttempt(running, cancelInput).attempt;
      const recoveryPath = resolvePlayAttemptRecoveryPath(
        workspaceRoot,
        sessionId,
        running.id,
      );
      const markerPath = resolveMarkerPath(recoveryPath);

      // Simulate process termination after the terminal attempt rename but
      // before the old active marker is removed.
      await writeFile(
        recoveryPath,
        `${JSON.stringify(cancelled, null, 2)}\n`,
        'utf-8',
      );
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe(`${running.id}\n`);

      await expect(listPlayTurnAttemptRecoveries(workspaceRoot, sessionId))
        .resolves.toEqual([
          expect.objectContaining({
            attemptId: running.id,
            status: 'cancelled',
            classification: 'terminal',
          }),
        ]);
      await expect(readFile(markerPath, 'utf-8')).rejects.toMatchObject({
        code: 'ENOENT',
      });

      // A lost Cancel response can replay from terminal recovery. Reading it
      // must repair the same stale-marker state even when list was not called.
      await writeFile(markerPath, `${running.id}\n`, { encoding: 'utf-8', flag: 'wx' });
      const recovered = await readPlayTurnAttemptRecovery(
        workspaceRoot,
        sessionId,
        running.id,
      );
      const replay = cancelPlayTurnAttempt(recovered, cancelInput);
      expect(replay.replayed).toBe(true);
      expect(replay.attempt.status).toBe('cancelled');
      await expect(readFile(markerPath, 'utf-8')).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const next = createAttempt(sessionId, 'attempt-after-terminal');
      await expect(createPlayTurnAttemptRecovery(workspaceRoot, next)).resolves.toBe(
        resolvePlayAttemptRecoveryPath(workspaceRoot, sessionId, next.id),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('removes a marker whose attempt directory disappeared before marker cleanup', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-attempt-missing-marker-target-'));
    const sessionId = 'session-missing-marker-target';
    const running = createAttempt(sessionId, 'attempt-removed-first');

    try {
      await createPlayTurnAttemptRecovery(workspaceRoot, running);
      const recoveryPath = resolvePlayAttemptRecoveryPath(
        workspaceRoot,
        sessionId,
        running.id,
      );
      const markerPath = resolveMarkerPath(recoveryPath);

      // Simulate process termination after removing the attempt recovery but
      // before removing its marker.
      await rm(dirname(recoveryPath), { recursive: true, force: true });
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe(`${running.id}\n`);

      await expect(listPlayTurnAttemptRecoveries(workspaceRoot, sessionId))
        .resolves.toEqual([]);
      await expect(readFile(markerPath, 'utf-8')).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const next = createAttempt(sessionId, 'attempt-after-missing');
      await createPlayTurnAttemptRecovery(workspaceRoot, next);
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe(`${next.id}\n`);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rebuilds a missing marker from active recovery without weakening single-active admission', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-attempt-rebuild-marker-'));
    const sessionId = 'session-rebuild-marker';
    const running = createAttempt(sessionId, 'attempt-active');
    const competing = createAttempt(sessionId, 'attempt-competing');

    try {
      await createPlayTurnAttemptRecovery(workspaceRoot, running);
      const recoveryPath = resolvePlayAttemptRecoveryPath(
        workspaceRoot,
        sessionId,
        running.id,
      );
      const markerPath = resolveMarkerPath(recoveryPath);

      await rm(markerPath, { force: true });
      await expect(readPlayTurnAttemptRecovery(workspaceRoot, sessionId, running.id))
        .resolves.toEqual(running);
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe(`${running.id}\n`);

      await rm(markerPath, { force: true });
      await expect(listPlayTurnAttemptRecoveries(workspaceRoot, sessionId))
        .resolves.toEqual([
          expect.objectContaining({
            attemptId: running.id,
            status: 'running',
            classification: 'active',
          }),
        ]);
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe(`${running.id}\n`);
      await expect(createPlayTurnAttemptRecovery(workspaceRoot, competing))
        .rejects.toThrow(`already has an active attempt: ${running.id}`);

      await removePlayTurnAttemptRecovery(workspaceRoot, sessionId, running.id);
      await expect(createPlayTurnAttemptRecovery(workspaceRoot, competing)).resolves.toBe(
        resolvePlayAttemptRecoveryPath(workspaceRoot, sessionId, competing.id),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('serializes stale-marker self-healers with competing active admissions', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-attempt-marker-race-'));
    const sessionId = 'session-marker-race';
    const terminalSource = createAttempt(sessionId, 'attempt-terminal-race');

    try {
      await createPlayTurnAttemptRecovery(workspaceRoot, terminalSource);
      const cancelled = cancelPlayTurnAttempt(terminalSource, {
        expectedAttemptRevision: 0,
        idempotencyKey: 'cancel-marker-race',
      }).attempt;
      const terminalPath = resolvePlayAttemptRecoveryPath(
        workspaceRoot,
        sessionId,
        terminalSource.id,
      );
      const markerPath = resolveMarkerPath(terminalPath);
      await writeFile(
        terminalPath,
        `${JSON.stringify(cancelled, null, 2)}\n`,
        'utf-8',
      );

      let releaseStart!: () => void;
      const start = new Promise<void>((resolveStart) => {
        releaseStart = resolveStart;
      });
      const candidates = Array.from({ length: 12 }, (_, index) =>
        createAttempt(sessionId, `attempt-racer-${index}`));
      const createResultsPromise = Promise.allSettled(candidates.map(async (candidate) => {
        await start;
        return createPlayTurnAttemptRecovery(workspaceRoot, candidate);
      }));
      const healerResultsPromise = Promise.all(Array.from({ length: 24 }, async (_, index) => {
        await start;
        return index % 2 === 0
          ? readPlayTurnAttemptRecovery(workspaceRoot, sessionId, terminalSource.id)
          : listPlayTurnAttemptRecoveries(workspaceRoot, sessionId);
      }));

      releaseStart();
      const [createResults] = await Promise.all([
        createResultsPromise,
        healerResultsPromise,
      ]);
      const admittedIndexes = createResults.flatMap((result, index) =>
        result.status === 'fulfilled' ? [index] : []);
      expect(admittedIndexes).toHaveLength(1);

      const admitted = candidates[admittedIndexes[0]!];
      const summaries = await listPlayTurnAttemptRecoveries(workspaceRoot, sessionId);
      expect(summaries.filter((summary) => summary.classification === 'active'))
        .toEqual([
          expect.objectContaining({ attemptId: admitted.id }),
        ]);
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe(`${admitted.id}\n`);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('reclaims crashed stages, incomplete published roots, and a stale mutex', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-attempt-stage-crash-'));
    const sessionId = 'session-stage-crash';
    const staged = createAttempt(sessionId, 'attempt-staged-only');
    const incomplete = createAttempt(sessionId, 'attempt-incomplete-published');

    try {
      const incompletePath = resolvePlayAttemptRecoveryPath(
        workspaceRoot,
        sessionId,
        incomplete.id,
      );
      const attemptsRoot = dirname(dirname(incompletePath));
      const stageRoot = join(attemptsRoot, `.attempt-stage.${randomUUID()}`);
      const incompleteRoot = dirname(incompletePath);
      const markerPath = resolveMarkerPath(incompletePath);
      const sessionsRoot = dirname(dirname(dirname(attemptsRoot)));
      const lockRoot = join(
        sessionsRoot,
        '.attempt-locks',
        `${sessionId}.lock`,
      );
      await mkdir(stageRoot, { recursive: true });
      await writeFile(
        join(stageRoot, 'attempt.yaml'),
        `${JSON.stringify(staged, null, 2)}\n`,
        'utf-8',
      );
      await mkdir(incompleteRoot, { recursive: false });
      await writeFile(markerPath, `${incomplete.id}\n`, 'utf-8');

      // Simulate a process dying after mkdir(lock) but before owner.json.
      await mkdir(dirname(lockRoot), { recursive: true });
      await mkdir(lockRoot, { recursive: false });
      const staleTime = new Date(Date.now() - 60_000);
      await utimes(lockRoot, staleTime, staleTime);

      await expect(listPlayTurnAttemptRecoveries(workspaceRoot, sessionId))
        .resolves.toEqual([]);
      await expect(readdir(stageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(incompleteRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(lockRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(markerPath, 'utf-8')).rejects.toMatchObject({
        code: 'ENOENT',
      });

      await expect(createPlayTurnAttemptRecovery(workspaceRoot, incomplete))
        .resolves.toBe(incompletePath);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('makes a direct read clean an empty published root and its stale marker', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-attempt-empty-read-'));
    const sessionId = 'session-empty-read';
    const attempt = createAttempt(sessionId, 'attempt-empty-read');

    try {
      const recoveryPath = resolvePlayAttemptRecoveryPath(
        workspaceRoot,
        sessionId,
        attempt.id,
      );
      const attemptRoot = dirname(recoveryPath);
      const markerPath = resolveMarkerPath(recoveryPath);
      await mkdir(attemptRoot, { recursive: true });
      await writeFile(markerPath, `${attempt.id}\n`, 'utf-8');

      await expect(readPlayTurnAttemptRecovery(
        workspaceRoot,
        sessionId,
        attempt.id,
      )).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(attemptRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(markerPath, 'utf-8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(createPlayTurnAttemptRecovery(workspaceRoot, attempt))
        .resolves.toBe(recoveryPath);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('compares against authoritative revision inside the mutex before writing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-attempt-write-cas-'));
    const sessionId = 'session-write-cas';
    const running = createAttempt(sessionId, 'attempt-write-cas');

    try {
      await createPlayTurnAttemptRecovery(workspaceRoot, running);
      const first = cancelPlayTurnAttempt(running, {
        expectedAttemptRevision: 0,
        idempotencyKey: 'cancel-cas-first',
      }).attempt;
      const second = cancelPlayTurnAttempt(running, {
        expectedAttemptRevision: 0,
        idempotencyKey: 'cancel-cas-second',
      }).attempt;
      const results = await Promise.allSettled([
        writePlayTurnAttemptRecovery(workspaceRoot, first, {
          expectedAttemptRevision: 0,
        }),
        writePlayTurnAttemptRecovery(workspaceRoot, second, {
          expectedAttemptRevision: 0,
        }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'revisionConflict' }),
      });
      const persisted = await readPlayTurnAttemptRecovery(
        workspaceRoot,
        sessionId,
        running.id,
      );
      expect(persisted.attemptRevision).toBe(1);
      expect(persisted.status).toBe('cancelled');
      expect(persisted.mutationReceipts).toHaveLength(1);
      expect(['cancel-cas-first', 'cancel-cas-second'])
        .toContain(persisted.mutationReceipts[0]!.idempotencyKey);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function createAttempt(sessionId: string, attemptId: string) {
  return createPlayTurnAttempt({
    id: attemptId,
    sessionId,
    baseRevision: 0,
    sceneBeforeRef: 'scene-one',
    actorOrder: ['participant-one'],
    createdAt: '2026-07-15T00:00:00.000Z',
  });
}

function resolveMarkerPath(recoveryPath: string): string {
  return join(
    dirname(dirname(recoveryPath)),
    PLAY_ATTEMPT_ACTIVE_MARKER_FILE,
  );
}
