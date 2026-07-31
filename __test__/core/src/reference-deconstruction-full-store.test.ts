import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  approveReferenceFullDeconstruction,
  beginReferenceDeconstructionPublish,
  cancelReferenceDeconstructionRun,
  completeReferenceFullDeconstructionUnit,
  completeReferenceDeconstructionPublish,
  completeReferenceQuickPreview,
  createReferenceAnalysisOutputHash,
  createReferenceDeconstructionStageInputFingerprint,
  createReferenceDeconstructionRun,
  createReferenceEvidencePointerMap,
  createReferenceQuickPreviewSelection,
  evaluateReservedReferenceFullDeconstructionQuality,
  importReferenceWork,
  listReferenceWorks,
  listReferenceDeconstructionRuns,
  normalizeReferenceAggregateAnalysisModelOutput,
  normalizeReferenceChapterAnalysisModelOutput,
  normalizeReferenceDistillationModelOutput,
  normalizeReferenceQuickPreviewModelOutput,
  normalizeReferenceStyleProfileModelOutput,
  pauseReferenceDeconstructionRun,
  prepareReferenceDeconstructionPublicationCandidate,
  projectReferenceDeconstructionRunForTransport,
  readReferenceDeconstructionRun,
  readReferencePreviewSource,
  reconcileReferenceDeconstructionPublish,
  reconcileReferenceDeconstructionRun,
  rejectReferenceDeconstructionPublish,
  reserveReferenceFullDeconstructionUnit,
  reserveReferenceQuickPreview,
  resolveReferenceDeconstructionAttemptArtifactPath,
  resumeReferenceDeconstructionRun,
  retryReferenceDeconstructionUnit,
  selectReferenceContext,
  setReferenceEnabled,
} from '@oh-awesome-novel/core';
import type {
  ReferenceDeconstructionFinding,
  ReferenceDeconstructionPublicationCandidate,
  ReferenceDeconstructionRun,
  ReferenceFullDeconstructionExecution,
} from '@oh-awesome-novel/core';

describe('reference full deconstruction store', () => {
  it('allows only one concurrent reservation and cancellation leaves published files unchanged', async () => {
    const fixture = await createApprovedRun();
    const settled = await Promise.allSettled([
      reserveFull(fixture, fixture.run, 'advance-race-0001'),
      reserveFull(fixture, fixture.run, 'advance-race-0002'),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const reserved = settled.find((result) =>
      result.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof reserveReferenceFullDeconstructionUnit>>
      >;
    const cancelled = await cancelReferenceDeconstructionRun({
      ...identity(fixture, reserved.value.run),
      idempotencyKey: 'cancel-full-0001',
    });
    expect(cancelled.run).toMatchObject({ status: 'cancelled', activeReservation: undefined });
    expect(cancelled.run.full?.attempts[0]?.status).toBe('cancelled');
    const published = parse(await readFile(
      join(
        fixture.workspaceRoot,
        'examples',
        'references',
        fixture.referenceId,
        'deconstruction-manifest.yaml',
      ),
      'utf-8',
    )) as { status: string };
    expect(published.status).toBe('notAnalyzed');
  });

  it('fails closed when a selected attempt output is changed after completion', async () => {
    const fixture = await createApprovedRun();
    const reserved = await reserveFull(fixture, fixture.run, 'advance-tamper-0001');
    const output = chapterOutput(fixture.run.runId, reserved.execution!);
    const completed = await completeReferenceFullDeconstructionUnit({
      ...identity(fixture, reserved.run),
      reservationId: reserved.reservation!.id,
      output,
    });
    const findingsPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      fixture.run.runId,
      reserved.execution!.unit.stageId,
      reserved.reservation!.attemptId,
      'findings.yaml',
      { requireExistingArtifact: true },
    );
    await writeFile(findingsPath, stringify({ ...output, uncertainties: ['tampered'] }), 'utf-8');
    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      completed.runId,
    )).rejects.toThrow('stale');
  });

  it('adopts a completed attempt receipt after restart without another provider call', async () => {
    const fixture = await createApprovedRun();
    const reserved = await reserveFull(fixture, fixture.run, 'advance-adopt-0001');
    const output = chapterOutput(fixture.run.runId, reserved.execution!);
    const findingsPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      fixture.run.runId,
      reserved.execution!.unit.stageId,
      reserved.reservation!.attemptId,
      'findings.yaml',
    );
    const receiptPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      fixture.run.runId,
      reserved.execution!.unit.stageId,
      reserved.reservation!.attemptId,
      'receipt.yaml',
    );
    const outputHash = createReferenceAnalysisOutputHash(output);
    await writeFile(findingsPath, stringify(output), 'utf-8');
    await writeFile(receiptPath, stringify({
      version: 1,
      runId: fixture.run.runId,
      unitId: reserved.reservation!.unitId,
      attemptId: reserved.reservation!.attemptId,
      status: 'completed',
      inputFingerprint: reserved.reservation!.inputFingerprint,
      outputHash,
      completedAt: '2026-07-23T00:00:00.000Z',
    }), 'utf-8');

    const reconciled = await reconcileReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      fixture.run.runId,
      '2026-07-23T00:01:00.000Z',
    );
    expect(reconciled).toMatchObject({ status: 'fullRunning', activeReservation: undefined });
    expect(reconciled.full?.units[0]).toMatchObject({
      status: 'completed',
      selectedAttemptId: reserved.reservation!.attemptId,
    });
    expect(reconciled.full?.attempts[0]).toMatchObject({
      status: 'completed',
      outputHash,
    });
  });

  it('adopts a durable failed receipt after restart without relabeling it interrupted', async () => {
    const fixture = await createApprovedRun();
    const reserved = await reserveFull(fixture, fixture.run, 'advance-adopt-failed-0001');
    const receiptPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      fixture.run.runId,
      reserved.execution!.unit.stageId,
      reserved.reservation!.attemptId,
      'receipt.yaml',
    );
    const completedAt = '2026-07-23T00:00:00.000Z';
    await writeFile(receiptPath, stringify({
      version: 1,
      runId: fixture.run.runId,
      unitId: reserved.reservation!.unitId,
      attemptId: reserved.reservation!.attemptId,
      status: 'failed',
      inputFingerprint: reserved.reservation!.inputFingerprint,
      failure: {
        code: 'provider_error',
        message: 'The bounded provider call failed.',
        failedAt: completedAt,
      },
      completedAt,
    }), 'utf-8');

    const reconciled = await reconcileReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      fixture.run.runId,
      '2026-07-23T00:01:00.000Z',
    );

    expect(reconciled).toMatchObject({
      status: 'failed',
      activeReservation: undefined,
      failure: {
        code: 'provider_error',
        failedAt: completedAt,
      },
    });
    expect(reconciled.full?.units[0]?.status).toBe('failed');
    expect(reconciled.full?.attempts[0]).toMatchObject({
      status: 'failed',
      completedAt,
      failure: { code: 'provider_error' },
    });
  });

  it('rejects non-canonical crash artifacts instead of adopting them as selected output', async () => {
    const fixture = await createApprovedRun();
    const reserved = await reserveFull(fixture, fixture.run, 'advance-adopt-invalid-0001');
    const output = {
      ...chapterOutput(fixture.run.runId, reserved.execution!),
      unboundedFutureField: 'must not be adopted',
    };
    const findingsPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      fixture.run.runId,
      reserved.execution!.unit.stageId,
      reserved.reservation!.attemptId,
      'findings.yaml',
    );
    const receiptPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      fixture.run.runId,
      reserved.execution!.unit.stageId,
      reserved.reservation!.attemptId,
      'receipt.yaml',
    );
    await writeFile(findingsPath, stringify(output), 'utf-8');
    await writeFile(receiptPath, stringify({
      version: 1,
      runId: fixture.run.runId,
      unitId: reserved.reservation!.unitId,
      attemptId: reserved.reservation!.attemptId,
      status: 'completed',
      inputFingerprint: reserved.reservation!.inputFingerprint,
      outputHash: createReferenceAnalysisOutputHash(output),
      completedAt: '2026-07-23T00:00:00.000Z',
    }), 'utf-8');

    const reconciled = await reconcileReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      fixture.run.runId,
    );

    expect(reconciled.status).toBe('interrupted');
    expect(reconciled.full?.units[0]?.status).toBe('interrupted');
    expect(reconciled.full?.units[0]?.selectedAttemptId).toBeUndefined();
  });

  it('settles strict stored-output validation failures as explicitly retryable failures', async () => {
    const fixture = await createApprovedRun();
    const reserved = await reserveFull(fixture, fixture.run, 'advance-invalid-output-0001');
    const output = {
      ...chapterOutput(fixture.run.runId, reserved.execution!),
      unexpectedStoredField: true,
    };

    const failed = await completeReferenceFullDeconstructionUnit({
      ...identity(fixture, reserved.run),
      reservationId: reserved.reservation!.id,
      output,
    });

    expect(failed).toMatchObject({
      status: 'failed',
      activeReservation: undefined,
      failure: {
        code: 'invalid_output',
        message: 'Stored reference chapter analysis is invalid.',
      },
    });
    expect(failed.full?.attempts[0]?.status).toBe('failed');
    const retried = await retryReferenceDeconstructionUnit({
      ...identity(fixture, failed),
      idempotencyKey: 'retry-invalid-output-0001',
      unitId: reserved.reservation!.unitId,
    });
    expect(retried.run.full?.units[0]).toMatchObject({
      status: 'queued',
      selectedAttemptId: undefined,
    });
  });

  it('retains copied chapter text for the final warning gate', async () => {
    const fixture = await createApprovedRun();
    const reserved = await reserveFull(fixture, fixture.run, 'advance-copy-risk-0001');
    const copied = reserved.execution!.sourceWindows![0]!.content
      .replaceAll(/\s+/gu, ' ')
      .slice(0, 90);
    expect(copied.length).toBeGreaterThanOrEqual(80);
    const output = chapterOutput(
      fixture.run.runId,
      reserved.execution!,
      copied,
    );

    const completed = await completeReferenceFullDeconstructionUnit({
      ...identity(fixture, reserved.run),
      reservationId: reserved.reservation!.id,
      output,
    });
    expect(completed).toMatchObject({
      status: 'fullRunning',
      activeReservation: undefined,
      failure: undefined,
    });
    expect(completed.full?.units[0]).toMatchObject({
      status: 'completed',
      selectedAttemptId: reserved.reservation!.attemptId,
    });
    expect(completed.full?.attempts[0]).toMatchObject({
      status: 'completed',
    });
  });

  it('never overwrites an existing attempt artifact and accepts only identical bytes', async () => {
    const conflictingFixture = await createApprovedRun();
    const conflicting = await reserveFull(
      conflictingFixture,
      conflictingFixture.run,
      'advance-append-only-conflict-0001',
    );
    const conflictingPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      conflictingFixture.workspaceRoot,
      conflictingFixture.run.runId,
      conflicting.execution!.unit.stageId,
      conflicting.reservation!.attemptId,
      'findings.yaml',
    );
    await writeFile(conflictingPath, 'sentinel: must-not-change\n', 'utf-8');
    const conflictFailed = await completeReferenceFullDeconstructionUnit({
      ...identity(conflictingFixture, conflicting.run),
      reservationId: conflicting.reservation!.id,
      output: chapterOutput(conflictingFixture.run.runId, conflicting.execution!),
    });
    expect(conflictFailed).toMatchObject({
      status: 'failed',
      activeReservation: undefined,
      failure: {
        code: 'artifact_conflict',
        message: expect.stringContaining('append-only'),
      },
    });
    expect(await readFile(conflictingPath, 'utf-8')).toBe('sentinel: must-not-change\n');

    const identicalFixture = await createApprovedRun();
    const identical = await reserveFull(
      identicalFixture,
      identicalFixture.run,
      'advance-append-only-identical-0001',
    );
    const identicalOutput = chapterOutput(
      identicalFixture.run.runId,
      identical.execution!,
    );
    const identicalPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      identicalFixture.workspaceRoot,
      identicalFixture.run.runId,
      identical.execution!.unit.stageId,
      identical.reservation!.attemptId,
      'findings.yaml',
    );
    await writeFile(identicalPath, stringify(identicalOutput), 'utf-8');
    const completed = await completeReferenceFullDeconstructionUnit({
      ...identity(identicalFixture, identical.run),
      reservationId: identical.reservation!.id,
      output: identicalOutput,
    });
    expect(completed.full?.units[0]?.status).toBe('completed');
    expect(parse(await readFile(identicalPath, 'utf-8'))).toEqual(identicalOutput);
  });

  it('adopts a matching orphan input manifest without overwriting its original bytes', async () => {
    const fixture = await createApprovedRun();
    const unit = fixture.run.full!.units[0]!;
    const attemptId = `${unit.id}-attempt-0001`;
    const inputFingerprint = createReferenceDeconstructionStageInputFingerprint({
      sourceChecksumSha256: fixture.run.sourceChecksumSha256,
      structureFingerprint: fixture.run.structureFingerprint,
      stageId: unit.stageId,
      unitId: unit.id,
      options: {
        kind: unit.kind,
        chapterId: unit.chapterId ?? null,
        chunkId: unit.chunkId ?? null,
      },
      predecessorOutputHashes: [],
    });
    const startedAt = '2026-07-23T00:00:00.000Z';
    const manifestPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      fixture.run.runId,
      unit.stageId,
      attemptId,
      'input-manifest.yaml',
      { createDirectory: true },
    );
    const originalBytes = stringify({
      version: 1,
      runId: fixture.run.runId,
      referenceId: fixture.referenceId,
      unitId: unit.id,
      attemptId,
      inputFingerprint,
      predecessorOutputHashes: [],
      sourceChecksumSha256: fixture.run.sourceChecksumSha256,
      structureFingerprint: fixture.run.structureFingerprint,
      startedAt,
    });
    await writeFile(manifestPath, originalBytes, 'utf-8');

    const reserved = await reserveReferenceFullDeconstructionUnit({
      ...identity(fixture, fixture.run),
      idempotencyKey: 'advance-orphan-input-0001',
      now: '2026-07-23T00:05:00.000Z',
    });

    expect(reserved.reservation).toMatchObject({ attemptId, startedAt });
    expect(reserved.run.full?.attempts[0]).toMatchObject({ id: attemptId, startedAt });
    expect(await readFile(manifestPath, 'utf-8')).toBe(originalBytes);
    const completed = await completeReferenceFullDeconstructionUnit({
      ...identity(fixture, reserved.run),
      reservationId: reserved.reservation!.id,
      output: chapterOutput(fixture.run.runId, reserved.execution!),
    });
    expect(completed.full?.units[0]?.status).toBe('completed');
  });

  it('prepares a strict publication candidate from the completed quality DAG', async () => {
    const fixture = await createApprovedRun();
    const run = await reachReviewReady(fixture);

    const candidate = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      now: '2026-07-23T02:00:00.000Z',
    });

    expect(candidate).toMatchObject({
      referenceId: fixture.referenceId,
      runId: run.runId,
      runRevision: run.revision,
    });
    expect(candidate.files).toContainEqual(expect.objectContaining({
      path: 'examples/references.yaml',
      kind: 'index',
    }));
    expect(candidate.entryInventory).toHaveLength(5);
  });

  it('rejects a non-canonical project index before preparing publication', async () => {
    const fixture = await createApprovedRun();
    const run = await reachReviewReady(fixture);
    const indexPath = join(fixture.workspaceRoot, 'examples', 'references.yaml');
    const index = parse(await readFile(indexPath, 'utf-8')) as {
      version: number;
      references: Array<Record<string, unknown>>;
    };
    index.references[0]!.futureField = 'must not survive publication';
    await writeFile(indexPath, stringify(index), 'utf-8');

    await expect(prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
    })).rejects.toThrow('project index');
  });

  it('rebuilds publication candidates after repeated rejection and cannot reuse an old action', async () => {
    const fixture = await createApprovedRun();
    let run = await reachReviewReady(fixture);
    const first = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      now: '2026-07-23T03:00:00.000Z',
    });
    run = (await beginReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-begin-first',
      candidateFingerprint: first.candidateFingerprint,
      pendingActionId: 'pending-publish-first',
    })).run;
    run = (await rejectReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-reject-first',
      pendingActionId: 'pending-publish-first',
    })).run;

    const second = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      now: '2026-07-23T03:01:00.000Z',
    });
    expect(second.runRevision).toBe(run.revision);
    expect(second.candidateFingerprint).not.toBe(first.candidateFingerprint);
    await expect(beginReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-reuse-old',
      candidateFingerprint: first.candidateFingerprint,
      pendingActionId: 'pending-publish-first',
    })).rejects.toThrow('fingerprint');

    run = (await beginReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-begin-second',
      candidateFingerprint: second.candidateFingerprint,
      pendingActionId: 'pending-publish-second',
    })).run;
    run = (await rejectReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-reject-second',
      pendingActionId: 'pending-publish-second',
    })).run;

    const third = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      now: '2026-07-23T03:02:00.000Z',
    });
    expect(third.runRevision).toBe(run.revision);
    expect(third.candidateFingerprint).not.toBe(second.candidateFingerprint);
    run = (await beginReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-begin-third',
      candidateFingerprint: third.candidateFingerprint,
      pendingActionId: 'pending-publish-third',
    })).run;
    await materializeCandidate(fixture.workspaceRoot, third);
    run = (await completeReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-complete-third',
      candidateFingerprint: third.candidateFingerprint,
      pendingActionId: 'pending-publish-third',
    })).run;

    expect(run.status).toBe('completed');
  });

  it('reconciles an accepted materialization without candidate, attempt, or source artifacts', async () => {
    const fixture = await createApprovedRun();
    let run = await reachReviewReady(fixture);
    const candidate = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
    });
    run = (await beginReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-crash-reconcile-begin',
      candidateFingerprint: candidate.candidateFingerprint,
      pendingActionId: 'pending-publish-crash-reconcile',
    })).run;
    await materializeCandidate(fixture.workspaceRoot, candidate);

    const runArtifactRoot = join(
      fixture.workspaceRoot,
      '.workspace',
      'sessions',
      run.runId,
      'reference-deconstruction',
    );
    await rename(
      join(runArtifactRoot, 'publication-candidate.yaml'),
      join(runArtifactRoot, 'publication-candidate.yaml.unavailable'),
    );
    await rename(
      join(runArtifactRoot, 'stages'),
      join(runArtifactRoot, 'stages.unavailable'),
    );
    const sourcesRoot = join(
      fixture.workspaceRoot,
      'examples',
      'references',
      fixture.referenceId,
      'sources',
    );
    await rename(sourcesRoot, `${sourcesRoot}.unavailable`);
    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      run.runId,
    )).resolves.toMatchObject({
      status: 'publishing',
      publication: {
        pendingActionId: 'pending-publish-crash-reconcile',
      },
    });
    await expect(listReferenceDeconstructionRuns(
      fixture.workspaceRoot,
      fixture.referenceId,
    )).resolves.toContainEqual(expect.objectContaining({
      runId: run.runId,
      status: 'publishing',
    }));
    await expect(reconcileReferenceDeconstructionPublish({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      pendingActionStatus: 'pending',
    })).rejects.toThrow();

    const summaryFile = candidate.files.find((file) =>
      file.path.endsWith('/context/reference-summary.md'))!;
    const summaryPath = join(fixture.workspaceRoot, summaryFile.path);
    await writeFile(summaryPath, `${summaryFile.content}tampered\n`, 'utf-8');
    await expect(reconcileReferenceDeconstructionPublish({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      pendingActionStatus: 'accepted',
    })).rejects.toThrow('stale');

    await writeFile(summaryPath, summaryFile.content, 'utf-8');
    const second = await importReferenceWork({
      workspaceRoot: fixture.workspaceRoot,
      title: 'Later Reference',
      sourceText: 'Chapter 1\nA later reference legitimately updates the shared index.',
      rights: 'owned',
    });
    expect(second.reference.id).not.toBe(fixture.referenceId);

    const sharedIndexPath = join(
      fixture.workspaceRoot,
      'examples',
      'references.yaml',
    );
    const sharedIndexBytes = await readFile(sharedIndexPath, 'utf-8');
    const sharedIndex = parse(sharedIndexBytes) as {
      references: Array<{
        id: string;
        publishedContext?: { runId: string };
      }>;
    };
    const currentProjection = sharedIndex.references.find((reference) =>
      reference.id === fixture.referenceId)!;
    currentProjection.publishedContext!.runId = 'forged-shared-index-run';
    await writeFile(sharedIndexPath, stringify(sharedIndex), 'utf-8');
    await expect(reconcileReferenceDeconstructionPublish({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      pendingActionStatus: 'accepted',
    })).rejects.toThrow('project index');
    await writeFile(sharedIndexPath, sharedIndexBytes, 'utf-8');

    run = await reconcileReferenceDeconstructionPublish({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      pendingActionStatus: 'accepted',
    });
    expect(run.status).toBe('completed');
    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      run.runId,
    )).resolves.toMatchObject({
      runId: run.runId,
      status: 'completed',
    });
    await expect(listReferenceDeconstructionRuns(
      fixture.workspaceRoot,
      fixture.referenceId,
    )).resolves.toContainEqual(expect.objectContaining({
      runId: run.runId,
      status: 'completed',
    }));
    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      run.runId,
    )).resolves.toMatchObject({
      runId: run.runId,
      status: 'completed',
    });
    await expect(listReferenceDeconstructionRuns(
      fixture.workspaceRoot,
      fixture.referenceId,
    )).resolves.toContainEqual(expect.objectContaining({
      runId: run.runId,
      status: 'completed',
    }));

    const currentSelection = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      explicitReferenceIds: [fixture.referenceId],
      maxEntries: 1,
    });
    expect(currentSelection.included).toContainEqual(expect.objectContaining({
      referenceId: fixture.referenceId,
    }));

    const distilledFile = candidate.files.find((file) =>
      file.kind === 'distilled' && file.path !==
        `examples/references/${fixture.referenceId}/distilled/do-not-copy.md`)!;
    await writeFile(
      join(fixture.workspaceRoot, distilledFile.path),
      `${distilledFile.content}tampered\n`,
      'utf-8',
    );
    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      run.runId,
    )).resolves.toMatchObject({
      runId: run.runId,
      status: 'completed',
    });
    const staleSelection = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      explicitReferenceIds: [fixture.referenceId],
    });
    expect(staleSelection.included).toEqual([]);
    expect(staleSelection.omitted).toContainEqual(expect.objectContaining({
      referenceId: fixture.referenceId,
      reasonCode: 'invalidContextIndex',
    }));
  });

  it('completes an accepted disabled publication but keeps it out of writing context', async () => {
    const fixture = await createApprovedRun();
    await setReferenceEnabled(fixture.workspaceRoot, fixture.referenceId, false);
    let run = await reachReviewReady(fixture);
    const candidate = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
      now: '2026-07-23T04:00:00.000Z',
    });
    run = (await beginReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-disabled-begin',
      candidateFingerprint: candidate.candidateFingerprint,
      pendingActionId: 'pending-publish-disabled',
    })).run;
    await materializeCandidate(fixture.workspaceRoot, candidate);
    run = (await completeReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-disabled-complete',
      candidateFingerprint: candidate.candidateFingerprint,
      pendingActionId: 'pending-publish-disabled',
    })).run;

    expect(run.status).toBe('completed');
    const listed = await listReferenceWorks(fixture.workspaceRoot);
    expect(listed[0]).toMatchObject({
      id: fixture.referenceId,
      enabled: false,
      deconstructionStatus: 'completed',
      contextEligible: false,
      readinessReason: 'disabled',
      publishedContext: {
        runId: run.runId,
        entryCount: 5,
      },
    });
    const selection = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      explicitReferenceIds: [fixture.referenceId],
    });
    expect(selection.included).toEqual([]);
    expect(selection.omitted).toContainEqual(expect.objectContaining({
      scope: 'reference',
      referenceId: fixture.referenceId,
      reasonCode: 'disabled',
    }));
    expect(selection.originalSourceRead).toBe(false);
  });

  it('selects accepted distilled context without opening the original source', async () => {
    const fixture = await createApprovedRun();
    let run = await reachReviewReady(fixture);
    const candidate = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: run.runId,
    });
    run = (await beginReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-lightweight-begin',
      candidateFingerprint: candidate.candidateFingerprint,
      pendingActionId: 'pending-publish-lightweight',
    })).run;
    await materializeCandidate(fixture.workspaceRoot, candidate);
    run = (await completeReferenceDeconstructionPublish({
      ...identity(fixture, run),
      idempotencyKey: 'publish-lightweight-complete',
      candidateFingerprint: candidate.candidateFingerprint,
      pendingActionId: 'pending-publish-lightweight',
    })).run;

    const sourcesPath = join(
      fixture.workspaceRoot,
      'examples',
      'references',
      fixture.referenceId,
      'sources',
    );
    await rename(sourcesPath, `${sourcesPath}.unavailable`);
    const deconstructionPath = join(
      fixture.workspaceRoot,
      'examples',
      'references',
      fixture.referenceId,
      'deconstruction',
    );
    await rename(deconstructionPath, `${deconstructionPath}.unavailable`);
    const selection = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      capability: 'novel.write_chapter',
      explicitReferenceIds: [fixture.referenceId],
      maxEntries: 2,
    });
    expect(selection.included).toHaveLength(2);
    expect(selection.originalSourceRead).toBe(false);
    expect(selection.included.every((entry) =>
      entry.path.includes('/distilled/'))).toBe(true);

    await rename(`${sourcesPath}.unavailable`, sourcesPath);
    const metadataPath = join(
      fixture.workspaceRoot,
      'examples',
      'references',
      fixture.referenceId,
      'metadata.yaml',
    );
    const metadata = parse(await readFile(metadataPath, 'utf-8')) as {
      checksumSha256: string;
    };
    metadata.checksumSha256 = 'f'.repeat(64);
    await writeFile(metadataPath, stringify(metadata), 'utf-8');
    const staleSelection = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      explicitReferenceIds: [fixture.referenceId],
    });
    expect(staleSelection.included).toEqual([]);
    expect(staleSelection.omitted).toContainEqual(expect.objectContaining({
      referenceId: fixture.referenceId,
      reasonCode: 'stale',
    }));
  });

  it('persists append-only attempts and reaches reviewReady through bounded units', async () => {
    const fixture = await createApprovedRun();
    let run = fixture.run;

    const first = await reserveFull(fixture, run, 'advance-full-0001');
    const firstOutput = chapterOutput(run.runId, first.execution!);
    run = await completeReferenceFullDeconstructionUnit({
      ...identity(fixture, first.run),
      reservationId: first.reservation!.id,
      output: firstOutput,
    });

    const paused = await pauseReferenceDeconstructionRun({
      ...identity(fixture, run),
      idempotencyKey: 'pause-full-0001',
    });
    expect(paused.run.status).toBe('paused');
    const resumed = await resumeReferenceDeconstructionRun({
      ...identity(fixture, paused.run),
      idempotencyKey: 'resume-full-0001',
    });
    run = resumed.run;

    const retried = await retryReferenceDeconstructionUnit({
      ...identity(fixture, run),
      idempotencyKey: 'retry-full-0001',
      unitId: first.reservation!.unitId,
    });
    expect(retried.run.full?.attempts).toHaveLength(1);
    expect(retried.run.full?.units[0]).toMatchObject({
      status: 'queued',
      attemptIds: [first.reservation!.attemptId],
    });
    run = retried.run;

    const firstRetry = await reserveFull(fixture, run, 'advance-full-0002');
    expect(firstRetry.reservation?.attemptId).not.toBe(first.reservation?.attemptId);
    run = await completeReferenceFullDeconstructionUnit({
      ...identity(fixture, firstRetry.run),
      reservationId: firstRetry.reservation!.id,
      output: chapterOutput(run.runId, firstRetry.execution!),
    });

    const interruptedReservation = await reserveFull(fixture, run, 'advance-full-0003');
    run = await reconcileReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      run.runId,
    );
    expect(run).toMatchObject({ status: 'interrupted', activeReservation: undefined });
    expect(run.full?.attempts.at(-1)?.status).toBe('interrupted');
    run = (await resumeReferenceDeconstructionRun({
      ...identity(fixture, run),
      idempotencyKey: 'resume-full-0002',
    })).run;
    expect(run.full?.units.find((unit) =>
      unit.id === interruptedReservation.reservation!.unitId)?.status).toBe('queued');

    let sequence = 4;
    while (run.status !== 'reviewReady') {
      const reserved = await reserveFull(
        fixture,
        run,
        `advance-full-${String(sequence).padStart(4, '0')}`,
      );
      const execution = reserved.execution!;
      const output = execution.unit.kind === 'chapterChunk'
        ? chapterOutput(run.runId, execution)
        : execution.unit.kind === 'aggregate'
          ? aggregateOutput(run.runId, execution)
          : execution.unit.kind === 'style'
            ? styleOutput(run.runId, execution)
            : execution.unit.kind === 'distill'
              ? distillationOutput(run.runId, execution)
            : await evaluateReservedReferenceFullDeconstructionQuality(
                fixture.workspaceRoot,
                fixture.referenceId,
                run.runId,
                reserved.reservation!.id,
              );
      run = await completeReferenceFullDeconstructionUnit({
        ...identity(fixture, reserved.run),
        reservationId: reserved.reservation!.id,
        output,
      });
      sequence += 1;
    }

    expect(run.full?.analysisQuality).toMatchObject({
      status: 'warned',
      coveragePercent: 100,
      blockingDiagnosticCount: 0,
    });
    expect(run.full?.units.every((unit) => unit.status === 'completed')).toBe(true);
    expect(run.full?.attempts.filter((attempt) =>
      attempt.unitId === first.reservation!.unitId)).toHaveLength(2);
    const transport = projectReferenceDeconstructionRunForTransport(run);
    expect(transport).toMatchObject({
      status: 'reviewReady',
      receiptCount: run.revision + 1,
      full: {
        progress: { percent: 100, failedUnits: 0 },
        analysisQuality: { status: 'warned' },
      },
    });
    expect(transport.full?.stages.every((stage) => stage.status === 'completed')).toBe(true);

    const firstAttemptPath = await resolveReferenceDeconstructionAttemptArtifactPath(
      fixture.workspaceRoot,
      run.runId,
      'chapterAnalysis',
      first.reservation!.attemptId,
      'findings.yaml',
      { requireExistingArtifact: true },
    );
    expect(parse(await readFile(firstAttemptPath, 'utf-8'))).toMatchObject({
      unitId: first.reservation!.unitId,
    });
    const published = parse(await readFile(
      join(
        fixture.workspaceRoot,
        'examples',
        'references',
        fixture.referenceId,
        'deconstruction-manifest.yaml',
      ),
      'utf-8',
    )) as { status: string };
    expect(published.status).toBe('notAnalyzed');
  });
});

async function createApprovedRun(): Promise<{
  workspaceRoot: string;
  referenceId: string;
  run: ReferenceDeconstructionRun;
}> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-full-'));
  const sourceText = [
    'Chapter 1',
    'A short opening applies pressure and then changes direction while a visible consequence keeps the reader-facing question active.',
    '',
    'Chapter 2',
    'A second movement resolves one question while opening another.',
  ].join('\n');
  const imported = await importReferenceWork({
    workspaceRoot,
    title: 'Full Store Fixture',
    sourceText,
    rights: 'owned',
  });
  const referenceId = imported.reference.id;
  const source = await readReferencePreviewSource(workspaceRoot, referenceId);
  const selection = createReferenceQuickPreviewSelection({
    referenceId,
    sourceText,
    sourceChecksumSha256: source.sourceManifest.checksumSha256,
    structureFingerprint: source.sourceManifest.structureFingerprint,
    chapters: source.sourceManifest.detectedStructure.chapters,
  });
  const created = await createReferenceDeconstructionRun({
    workspaceRoot,
    referenceId,
    sourceChecksumSha256: selection.sourceChecksumSha256,
    structureFingerprint: selection.structureFingerprint,
    structureConfidence: source.sourceManifest.detectedStructure.confidence,
    rangeConfirmed: true,
    selection,
    idempotencyKey: 'create-full-0001',
    baseRunRevision: 0,
    runId: 'full-run-0001',
  });
  const previewReservation = await reserveReferenceQuickPreview({
    ...identity({ workspaceRoot, referenceId }, created.run),
    idempotencyKey: 'advance-preview-full-0001',
  });
  const pointerId = selection.windows[0]!.pointerId;
  const preview = normalizeReferenceQuickPreviewModelOutput({
    sourceOverview: 'The sample establishes a bounded narrative function.',
    chapterPreviews: selection.selectedChapterIds.map((chapterId) => ({
      chapterId,
      summary: `The host-selected chapter ${chapterId} changes narrative pressure.`,
      evidenceRefs: [selection.windows.find((window) =>
        window.pointer.chapterId === chapterId)!.pointerId],
      confidence: 'medium',
      uncertainty: null,
    })),
    findings: [{
      kind: 'pacing',
      observation: 'Narrative pressure changes between bounded movements.',
      technique: 'Vary the function of adjacent movements.',
      whenUseful: null,
      avoid: null,
      confidence: 'medium',
      evidenceRefs: [pointerId],
      generalInference: false,
      uncertainty: null,
    }],
    borrowablePatterns: [{
      title: 'Functional movement',
      technique: 'Give adjacent movements different reader-facing jobs.',
      whenUseful: null,
      evidenceRefs: [pointerId],
      confidence: 'medium',
    }],
    doNotCopy: ['Do not copy expression, events, names, or dialogue.'],
    differentiationRequirements: ['Change premise, cast, causality, and scene execution.'],
    differentiationPrompts: ['Which original conflict serves the same reader function?'],
    canonContaminationWarnings: ['Reference events are not current novel canon.'],
    confidence: 'medium',
    uncertainties: [],
  }, {
    runId: created.run.runId,
    referenceId,
    sourceChecksumSha256: selection.sourceChecksumSha256,
    selectedChapterIds: selection.selectedChapterIds,
    allowedPointers: createReferenceEvidencePointerMap(selection),
    sourceWindows: selection.windows,
  });
  const previewReady = await completeReferenceQuickPreview({
    ...identity({ workspaceRoot, referenceId }, previewReservation.run),
    reservationId: previewReservation.run.activeReservation!.id,
    preview,
  });
  const approved = await approveReferenceFullDeconstruction({
    ...identity({ workspaceRoot, referenceId }, previewReady),
    idempotencyKey: 'approve-full-0001',
  });
  return { workspaceRoot, referenceId, run: approved.run };
}

async function reserveFull(
  fixture: { workspaceRoot: string; referenceId: string },
  run: ReferenceDeconstructionRun,
  idempotencyKey: string,
) {
  return reserveReferenceFullDeconstructionUnit({
    ...identity(fixture, run),
    idempotencyKey,
  });
}

async function reachReviewReady(
  fixture: {
    workspaceRoot: string;
    referenceId: string;
    run: ReferenceDeconstructionRun;
  },
): Promise<ReferenceDeconstructionRun> {
  let run = fixture.run;
  let sequence = 1;
  while (run.status !== 'reviewReady') {
    if (sequence > 64) throw new Error('Fixture did not reach reviewReady.');
    const reserved = await reserveFull(
      fixture,
      run,
      `advance-ready-${String(sequence).padStart(4, '0')}`,
    );
    const execution = reserved.execution!;
    const output = execution.unit.kind === 'chapterChunk'
      ? chapterOutput(run.runId, execution)
      : execution.unit.kind === 'aggregate'
        ? aggregateOutput(run.runId, execution)
        : execution.unit.kind === 'style'
          ? styleOutput(run.runId, execution)
          : execution.unit.kind === 'distill'
            ? distillationOutput(run.runId, execution)
            : await evaluateReservedReferenceFullDeconstructionQuality(
                fixture.workspaceRoot,
                fixture.referenceId,
                run.runId,
                reserved.reservation!.id,
              );
    run = await completeReferenceFullDeconstructionUnit({
      ...identity(fixture, reserved.run),
      reservationId: reserved.reservation!.id,
      output,
    });
    sequence += 1;
  }
  return run;
}

async function materializeCandidate(
  workspaceRoot: string,
  candidate: ReferenceDeconstructionPublicationCandidate,
): Promise<void> {
  for (const file of candidate.files) {
    const path = join(workspaceRoot, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content, 'utf-8');
  }
}

function identity(
  fixture: { workspaceRoot: string; referenceId: string },
  run: ReferenceDeconstructionRun,
) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    referenceId: fixture.referenceId,
    runId: run.runId,
    baseRunRevision: run.revision,
  };
}

function chapterOutput(
  runId: string,
  execution: ReferenceFullDeconstructionExecution,
  unitSummaryText =
    'This bounded movement changes narrative pressure without reproducing source expression.',
) {
  const unit = execution.unit;
  const pointerId = execution.sourceWindows![0]!.pointerId;
  return normalizeReferenceChapterAnalysisModelOutput({
    unitSummary: {
      text: unitSummaryText,
      evidenceRefs: [pointerId],
      confidence: 'medium',
      uncertainty: null,
    },
    chapterSummary: unit.isLastChunkInChapter
      ? {
          text: 'The chapter performs a distinct structural movement.',
          evidenceRefs: [pointerId],
          confidence: 'medium',
          uncertainty: null,
        }
      : null,
    findings: [{
      kind: 'pacing',
      observation: 'The movement changes the type of pressure applied to the reader.',
      technique: 'Assign each bounded movement a distinct narrative function.',
      whenUseful: null,
      avoid: null,
      confidence: 'medium',
      evidenceRefs: [pointerId],
      generalInference: false,
      uncertainty: null,
    }],
    rollingSummary: 'Prior movement established changing pressure and an unresolved reader question.',
    rollingEvidenceRefs: [pointerId],
    uncertainties: [],
  }, {
    runId,
    unit,
    allowedPointers: { [pointerId]: execution.sourceWindows![0]!.pointer },
  });
}

function aggregateOutput(runId: string, execution: ReferenceFullDeconstructionExecution) {
  const first = execution.verifiedSourceFindings![0]!;
  return normalizeReferenceAggregateAnalysisModelOutput({
    summary: 'Across chapters, narrative functions change in a controlled sequence.',
    findings: [{
      kind: 'pacing',
      observation: 'Adjacent movements serve different structural purposes.',
      technique: 'Sequence contrasting reader-facing functions.',
      whenUseful: null,
      avoid: null,
      confidence: 'medium',
      sourceFindingRefs: [first.id],
      generalInference: false,
      uncertainty: null,
    }],
    uncertainties: [],
  }, {
    runId,
    unit: execution.unit,
    verifiedFindings: findingMap(execution.verifiedSourceFindings!),
    coveredUnitIds: execution.coveredUnitIds!,
    coveredChapterIds: execution.coveredChapterIds!,
  });
}

function styleOutput(runId: string, execution: ReferenceFullDeconstructionExecution) {
  const first = execution.verifiedSourceFindings![0]!;
  return normalizeReferenceStyleProfileModelOutput({
    summary: 'The abstract profile favors controlled changes in reader-facing function.',
    dimensions: [{
      dimension: 'paragraphRhythm',
      observation: 'Functional movement changes are clearly separated.',
      technique: 'Use paragraph boundaries to mark a change in narrative job.',
      avoid: null,
      confidence: 'medium',
      sourceFindingRefs: [first.id],
      generalInference: false,
      uncertainty: null,
    }],
    transferablePrinciples: ['Give each movement a distinct function.'],
    nonImitationBoundaries: ['Do not reuse source wording, events, or signature expression.'],
    uncertainties: [],
  }, {
    runId,
    unit: execution.unit,
    verifiedFindings: findingMap(execution.verifiedSourceFindings!),
    coveredUnitIds: execution.coveredUnitIds!,
    coveredChapterIds: execution.coveredChapterIds!,
  });
}

function distillationOutput(
  runId: string,
  execution: ReferenceFullDeconstructionExecution,
) {
  const first = execution.verifiedSourceFindings![0]!;
  return normalizeReferenceDistillationModelOutput({
    entries: [
      distillationEntry('writingStyle', 'Functional prose movement', first.id),
      distillationEntry('pacing', 'Contrasting movement sequence', first.id),
      distillationEntry('hooks', 'Active reader-facing question', first.id),
      distillationEntry('scene', 'Consequence-led scene turn', first.id),
      distillationEntry('character', 'Choice-driven pressure', first.id),
    ],
    doNotCopyRules: ['Do not copy source wording, events, names, or signature expression.'],
    differentiationWarnings: ['Change premise, motives, causality, setting, and consequences.'],
    uncertainties: [],
  }, {
    runId,
    unit: execution.unit,
    verifiedFindings: findingMap(execution.verifiedSourceFindings!),
    coveredUnitIds: execution.coveredUnitIds!,
    coveredChapterIds: execution.coveredChapterIds!,
  });
}

function distillationEntry(
  category: 'writingStyle' | 'pacing' | 'hooks' | 'scene' | 'character',
  title: string,
  sourceFindingRef: string,
) {
  return {
    category,
    title,
    technique: `Turn ${title.toLocaleLowerCase('en-US')} into an original task constraint.`,
    whenUseful: ['Use when the current writing task needs this structural function.'],
    constraints: ['Replace all source-specific expression and story causality.'],
    differentiationPrompts: ['Which original motive creates a different causal path?'],
    sourceFindingRefs: [sourceFindingRef],
    confidence: 'medium' as const,
    tags: [category],
    capabilityIds: ['novel.write_chapter' as const],
  };
}

function findingMap(findings: ReferenceDeconstructionFinding[]) {
  return Object.fromEntries(findings.map((finding) => [finding.id, finding]));
}
