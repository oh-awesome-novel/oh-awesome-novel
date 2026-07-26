import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import {
  beginReferenceDeconstructionPublish,
  createReferenceEvidencePointerMap,
  normalizeReferenceAggregateAnalysisModelOutput,
  normalizeReferenceChapterAnalysisModelOutput,
  normalizeReferenceDistillationModelOutput,
  normalizeReferenceQuickPreviewModelOutput,
  normalizeReferenceStyleProfileModelOutput,
  prepareReferenceDeconstructionPublicationCandidate,
  rejectReferenceDeconstructionPublish,
  reserveReferenceFullDeconstructionUnit,
} from '@oh-awesome-novel/core';
import type {
  ReferenceDeconstructionFinding,
  ReferenceFullDeconstructionExecution,
} from '@oh-awesome-novel/core';
import {
  acceptPendingAction,
  rejectPendingAction,
} from '@oh-awesome-novel/tools';

const tempRoots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('reference full deconstruction backend', () => {
  it('dispatches every full work-unit kind and persists reservation identity in the lease', async () => {
    const workspaceRoot = await createOanWorkspace();
    const nextWorkspaceRoot = await createOanWorkspace();
    const globalConfigDir = await createTemporaryRoot();
    let releaseChapter!: () => void;
    let chapterStarted = false;
    const chapterGate = new Promise<void>((resolve) => {
      releaseChapter = resolve;
    });
    const calls = { chapter: 0, aggregate: 0, style: 0, distill: 0 };
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      globalConfigDir,
      providerConfig: providerConfig(),
      runReferenceQuickPreview: async (input) => completedPreview(input),
      runReferenceChapterAnalysis: async (input) => {
        calls.chapter += 1;
        if (calls.chapter === 1) {
          chapterStarted = true;
          await chapterGate;
        }
        return {
          status: 'completed',
          finishReason: 'stop',
          output: chapterOutput(input.runId, {
            unit: input.unit,
            sourceWindows: [...input.sourceWindows],
            ...(input.rollingContext
              ? { rollingContext: { ...input.rollingContext } }
              : {}),
          }),
        };
      },
      runReferenceAggregateAnalysis: async (input) => {
        calls.aggregate += 1;
        return {
          status: 'completed',
          finishReason: 'stop',
          output: aggregateOutput(input.runId, {
            unit: input.unit,
            verifiedSourceFindings: [...input.verifiedSourceFindings],
            coveredUnitIds: [...input.coveredUnitIds],
            coveredChapterIds: [...input.coveredChapterIds],
          }),
        };
      },
      runReferenceStyleProfile: async (input) => {
        calls.style += 1;
        return {
          status: 'completed',
          finishReason: 'stop',
          output: styleOutput(input.runId, {
            unit: input.unit,
            verifiedSourceFindings: [...input.verifiedSourceFindings],
            coveredUnitIds: [...input.coveredUnitIds],
            coveredChapterIds: [...input.coveredChapterIds],
          }),
        };
      },
      runReferenceDistillation: async (input) => {
        calls.distill += 1;
        return {
          status: 'completed',
          finishReason: 'stop',
          output: distillOutput(input.runId, {
            unit: input.unit,
            verifiedSourceFindings: [...input.verifiedSourceFindings],
            coveredUnitIds: [...input.coveredUnitIds],
            coveredChapterIds: [...input.coveredChapterIds],
          }),
        };
      },
    });
    servers.push(backend);
    const approved = await createApprovedRun(backend.url);
    const runUrl = referenceRunUrl(
      backend.url,
      approved.referenceId,
      approved.run.id,
    );
    const firstAdvance = postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      approved.run.runRevision,
      'advance-full-0001',
    );

    await expect.poll(() => chapterStarted).toBe(true);
    const lease = JSON.parse(await readFile(join(
      workspaceRoot,
      '.workspace',
      'sessions',
      approved.run.id,
      'reference-deconstruction',
      'provider-lease.json',
    ), 'utf-8')) as Record<string, unknown>;
    expect(lease).toMatchObject({
      pid: process.pid,
      reservationKind: 'fullUnit',
      reservationId: expect.stringMatching(/^full-reservation-/u),
      idempotencyKey: 'advance-full-0001',
      unitId: expect.any(String),
      attemptId: expect.any(String),
    });
    await expect(readFile(join(
      workspaceRoot,
      '.workspace',
      'sessions',
      approved.run.id,
      'reference-deconstruction',
      'provider-lease.preparing.json',
    ), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    const blockedSwitch = await fetch(`${backend.url}/api/workspaces/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: nextWorkspaceRoot }),
    });
    expect(blockedSwitch.status).toBe(409);
    releaseChapter();

    let current = (await firstAdvance).run;
    for (let index = 2; index <= 12 && current.status === 'fullRunning'; index += 1) {
      current = (await postMutation<RunEnvelope>(
        `${runUrl}/advance`,
        current.runRevision,
        `advance-full-${String(index).padStart(4, '0')}`,
      )).run;
    }

    expect(
      current.status,
      current.failure?.message ?? current.diagnostics?.map((item) => item.message).join('\n'),
    ).toBe('reviewReady');
    expect(current.full?.analysisQuality).toMatchObject({ status: 'passed' });
    expect(calls.chapter).toBeGreaterThan(0);
    expect(calls.aggregate).toBeGreaterThan(0);
    expect(calls.style).toBe(1);
    expect(calls.distill).toBe(1);
    const releasedSwitch = await fetch(`${backend.url}/api/workspaces/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: nextWorkspaceRoot }),
    });
    expect(releasedSwitch.status).toBe(200);
  });

  it('exposes retry, pause, and resume controls for request-driven full execution', async () => {
    const workspaceRoot = await createOanWorkspace();
    let chapterCalls = 0;
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceQuickPreview: async (input) => completedPreview(input),
      runReferenceChapterAnalysis: async (input) => {
        chapterCalls += 1;
        if (chapterCalls === 1) {
          return {
            status: 'failed',
            error: {
              code: 'invalid_output',
              message: 'invalid chapter fixture',
              retryable: false,
            },
          };
        }
        return {
          status: 'completed',
          finishReason: 'stop',
          output: chapterOutput(input.runId, {
            unit: input.unit,
            sourceWindows: [...input.sourceWindows],
          }),
        };
      },
    });
    servers.push(backend);
    const approved = await createApprovedRun(backend.url);
    const runUrl = referenceRunUrl(
      backend.url,
      approved.referenceId,
      approved.run.id,
    );

    const failed = (await postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      approved.run.runRevision,
      'advance-failed-full-unit',
    )).run;
    expect(failed.status).toBe('failed');
    expect(failed.full?.failedUnit?.id).toEqual(expect.any(String));

    const retried = await fetchJson<RunEnvelope>(`${runUrl}/retry`, {
      method: 'POST',
      body: JSON.stringify({
        baseRunRevision: failed.runRevision,
        idempotencyKey: 'retry-failed-full-unit',
        unitId: failed.full!.failedUnit!.id,
      }),
    });
    expect(retried.run.status).toBe('fullRunning');

    const completed = (await postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      retried.run.runRevision,
      'advance-retried-full-unit',
    )).run;
    expect(completed.status).toBe('fullRunning');

    const paused = await postMutation<RunEnvelope>(
      `${runUrl}/pause`,
      completed.runRevision,
      'pause-full-run',
    );
    expect(paused.run.status).toBe('paused');
    const resumed = await postMutation<RunEnvelope>(
      `${runUrl}/resume`,
      paused.run.runRevision,
      'resume-full-run',
    );
    expect(resumed.run.status).toBe('fullRunning');
    expect(chapterCalls).toBe(2);
  });

  it('keeps idle fullRunning runs resumable but interrupts orphaned full reservations', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceQuickPreview: async (input) => completedPreview(input),
      runReferenceChapterAnalysis: async (input) => ({
        status: 'completed',
        finishReason: 'stop',
        output: chapterOutput(input.runId, {
          unit: input.unit,
          sourceWindows: [...input.sourceWindows],
        }),
      }),
    });
    servers.push(backend);
    const approved = await createApprovedRun(backend.url);
    const runUrl = referenceRunUrl(
      backend.url,
      approved.referenceId,
      approved.run.id,
    );
    const idle = (await postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      approved.run.runRevision,
      'advance-idle-full-unit',
    )).run;
    expect(idle.status).toBe('fullRunning');

    const reader = await startNovelHttpBackend({ workspaceRoot });
    servers.push(reader);
    await expect(fetchJson<RunEnvelope>(referenceRunUrl(
      reader.url,
      approved.referenceId,
      approved.run.id,
    ))).resolves.toMatchObject({
      run: { status: 'fullRunning', runRevision: idle.runRevision },
    });

    await reserveReferenceFullDeconstructionUnit({
      workspaceRoot,
      referenceId: approved.referenceId,
      runId: approved.run.id,
      baseRunRevision: idle.runRevision,
      idempotencyKey: 'reserve-orphaned-full-unit',
    });
    const reconciler = await startNovelHttpBackend({ workspaceRoot });
    servers.push(reconciler);
    await expect(fetchJson<RunEnvelope>(referenceRunUrl(
      reconciler.url,
      approved.referenceId,
      approved.run.id,
    ))).resolves.toMatchObject({
      run: {
        status: 'interrupted',
        diagnostics: [
          expect.objectContaining({ code: 'full.interrupted' }),
        ],
      },
    });
  });

  it('protects the cross-backend reservation handoff with a verified preparing lease', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceQuickPreview: async (input) => completedPreview(input),
    });
    servers.push(backend);
    const approved = await createApprovedRun(backend.url);
    const runUrl = referenceRunUrl(
      backend.url,
      approved.referenceId,
      approved.run.id,
    );
    const handoffKey = 'reserve-live-preparing-full-unit';
    const reserved = await reserveReferenceFullDeconstructionUnit({
      workspaceRoot,
      referenceId: approved.referenceId,
      runId: approved.run.id,
      baseRunRevision: approved.run.runRevision,
      idempotencyKey: handoffKey,
    });
    expect(reserved.reservation?.kind).toBe('fullUnit');

    const preparingLeasePath = join(
      workspaceRoot,
      '.workspace',
      'sessions',
      approved.run.id,
      'reference-deconstruction',
      'provider-lease.preparing.json',
    );
    const livePreparingOwner = {
      pid: process.ppid,
      instanceId: 'external-preparing-backend',
      startedAt: new Date().toISOString(),
      reservationKind: 'preparing',
      preparingKind: 'fullUnit',
      referenceId: approved.referenceId,
      baseRunRevision: approved.run.runRevision,
      idempotencyKey: handoffKey,
    };
    await writeFile(
      preparingLeasePath,
      `${JSON.stringify(livePreparingOwner)}\n`,
      'utf-8',
    );

    const reader = await startNovelHttpBackend({ workspaceRoot });
    servers.push(reader);
    const liveHandoff = await fetchJson<RunEnvelope>(referenceRunUrl(
      reader.url,
      approved.referenceId,
      approved.run.id,
    ));
    expect(liveHandoff.run).toMatchObject({
      status: 'fullRunning',
      runRevision: reserved.run.revision,
    });
    await expect(readFile(preparingLeasePath, 'utf-8')).resolves.toContain(
      '"reservationKind":"preparing"',
    );

    await writeFile(
      preparingLeasePath,
      `${JSON.stringify({ ...livePreparingOwner, pid: 2_147_483_647 })}\n`,
      'utf-8',
    );
    const recoveredDeadOwner = await fetchJson<RunEnvelope>(referenceRunUrl(
      reader.url,
      approved.referenceId,
      approved.run.id,
    ));
    expect(recoveredDeadOwner.run.status).toBe('interrupted');
    await expect(readFile(preparingLeasePath, 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const resumed = await postMutation<RunEnvelope>(
      `${runUrl}/resume`,
      recoveredDeadOwner.run.runRevision,
      'resume-after-dead-preparing-owner',
    );
    await reserveReferenceFullDeconstructionUnit({
      workspaceRoot,
      referenceId: approved.referenceId,
      runId: approved.run.id,
      baseRunRevision: resumed.run.runRevision,
      idempotencyKey: 'reserve-malformed-preparing-full-unit',
    });
    await writeFile(
      preparingLeasePath,
      `${JSON.stringify({
        pid: process.ppid,
        instanceId: 'malformed-preparing-backend',
        startedAt: new Date().toISOString(),
        reservationKind: 'preparing',
      })}\n`,
      'utf-8',
    );
    const recoveredMalformedOwner = await fetchJson<RunEnvelope>(referenceRunUrl(
      reader.url,
      approved.referenceId,
      approved.run.id,
    ));
    expect(recoveredMalformedOwner.run.status).toBe('interrupted');
    await expect(readFile(preparingLeasePath, 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps a republished old candidate publishing while its new stable action is being created', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceQuickPreview: async (input) => completedPreview(input),
      runReferenceChapterAnalysis: async (input) => ({
        status: 'completed',
        finishReason: 'stop',
        output: chapterOutput(input.runId, {
          unit: input.unit,
          sourceWindows: [...input.sourceWindows],
          ...(input.rollingContext
            ? { rollingContext: { ...input.rollingContext } }
            : {}),
        }),
      }),
      runReferenceAggregateAnalysis: async (input) => ({
        status: 'completed',
        finishReason: 'stop',
        output: aggregateOutput(input.runId, {
          unit: input.unit,
          verifiedSourceFindings: [...input.verifiedSourceFindings],
          coveredUnitIds: [...input.coveredUnitIds],
          coveredChapterIds: [...input.coveredChapterIds],
        }),
      }),
      runReferenceStyleProfile: async (input) => ({
        status: 'completed',
        finishReason: 'stop',
        output: styleOutput(input.runId, {
          unit: input.unit,
          verifiedSourceFindings: [...input.verifiedSourceFindings],
          coveredUnitIds: [...input.coveredUnitIds],
          coveredChapterIds: [...input.coveredChapterIds],
        }),
      }),
      runReferenceDistillation: async (input) => ({
        status: 'completed',
        finishReason: 'stop',
        output: distillOutput(input.runId, {
          unit: input.unit,
          verifiedSourceFindings: [...input.verifiedSourceFindings],
          coveredUnitIds: [...input.coveredUnitIds],
          coveredChapterIds: [...input.coveredChapterIds],
        }),
      }),
    });
    servers.push(backend);
    const approved = await createApprovedRun(backend.url);
    const runUrl = referenceRunUrl(
      backend.url,
      approved.referenceId,
      approved.run.id,
    );
    let reviewReady = approved.run;
    for (let index = 1; index <= 16 && reviewReady.status !== 'reviewReady'; index += 1) {
      reviewReady = (await postMutation<RunEnvelope>(
        `${runUrl}/advance`,
        reviewReady.runRevision,
        `advance-republish-${index}`,
      )).run;
      if (!['fullApproved', 'fullRunning'].includes(reviewReady.status)) break;
    }
    expect(reviewReady.status, reviewReady.failure?.message).toBe('reviewReady');

    const oldPreparedAt = '2000-01-01T00:00:00.000Z';
    const candidate = await prepareReferenceDeconstructionPublicationCandidate({
      workspaceRoot,
      referenceId: approved.referenceId,
      runId: approved.run.id,
      now: oldPreparedAt,
    });
    expect(candidate.preparedAt).toBe(oldPreparedAt);
    const first = await beginReferenceDeconstructionPublish({
      workspaceRoot,
      referenceId: approved.referenceId,
      runId: approved.run.id,
      baseRunRevision: reviewReady.runRevision,
      idempotencyKey: 'begin-old-candidate',
      candidateFingerprint: candidate.candidateFingerprint,
      pendingActionId: `pa_${'8'.repeat(64)}`,
      now: oldPreparedAt,
    });
    const rejected = await rejectReferenceDeconstructionPublish({
      workspaceRoot,
      referenceId: approved.referenceId,
      runId: approved.run.id,
      baseRunRevision: first.run.revision,
      idempotencyKey: 'reject-old-candidate',
      pendingActionId: `pa_${'8'.repeat(64)}`,
      now: '2000-01-01T00:00:01.000Z',
    });
    const republishCandidate =
      await prepareReferenceDeconstructionPublicationCandidate({
        workspaceRoot,
        referenceId: approved.referenceId,
        runId: approved.run.id,
        now: oldPreparedAt,
      });
    const republished = await beginReferenceDeconstructionPublish({
      workspaceRoot,
      referenceId: approved.referenceId,
      runId: approved.run.id,
      baseRunRevision: rejected.run.revision,
      idempotencyKey: 'begin-republished-candidate',
      candidateFingerprint: republishCandidate.candidateFingerprint,
      pendingActionId: `pa_${'9'.repeat(64)}`,
    });
    expect(republished.run.publication?.preparedAt).toBe(oldPreparedAt);
    expect(Date.now() - Date.parse(republished.run.updatedAt)).toBeLessThan(30_000);

    const observed = await fetchJson<RunEnvelope>(runUrl);
    expect(observed.run).toMatchObject({
      status: 'publishing',
      runRevision: republished.run.revision,
    });
  });

  it('publishes one review bundle through a stable PendingAction and accepts it atomically', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot);
    servers.push(backend);
    const ready = await createReviewReadyRun(backend.url);
    const runUrl = referenceRunUrl(backend.url, ready.referenceId, ready.run.id);
    const manifestPath = join(
      workspaceRoot,
      'examples',
      'references',
      ready.referenceId,
      'deconstruction-manifest.yaml',
    );
    const manifestBeforePublish = await readFile(manifestPath, 'utf-8');

    const published = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      'publish-complete-bundle',
    );
    expect(published).toMatchObject({
      run: { status: 'publishing' },
      replayed: false,
      pendingAction: { status: 'pending' },
    });
    await expect(readFile(manifestPath, 'utf-8')).resolves.toBe(
      manifestBeforePublish,
    );

    const replayed = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      'publish-complete-bundle',
    );
    expect(replayed).toMatchObject({
      run: { status: 'publishing' },
      replayed: true,
      pendingAction: {
        id: published.pendingAction.id,
        status: 'pending',
      },
    });

    const accepted = await fetchJson<PendingActionDecisionEnvelope>(
      `${backend.url}/api/workspace/pending-actions/${published.pendingAction.id}/accept`,
      { method: 'POST' },
    );
    expect(accepted).toMatchObject({
      id: published.pendingAction.id,
      status: 'accepted',
      referencePublish: {
        run: { status: 'completed' },
      },
    });
    for (const target of published.pendingAction.touchedFiles) {
      await expect(readFile(join(workspaceRoot, target), 'utf-8'))
        .resolves.toEqual(expect.any(String));
    }
    await expect(fetchJson<RunEnvelope>(runUrl)).resolves.toMatchObject({
      run: { status: 'completed' },
    });
  });

  it('reconciles an accepted archive after candidate, stages, and source artifacts disappear', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot);
    servers.push(backend);
    const ready = await createReviewReadyRun(backend.url);
    const runUrl = referenceRunUrl(backend.url, ready.referenceId, ready.run.id);
    const idempotencyKey = 'publish-terminal-accepted-recovery';
    const published = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      idempotencyKey,
    );
    await acceptPendingAction({
      workspaceRoot,
      id: published.pendingAction.id,
      autoCommitOnAccept: false,
    });
    const runArtifacts = join(
      workspaceRoot,
      '.workspace',
      'sessions',
      ready.run.id,
      'reference-deconstruction',
    );
    await rm(join(runArtifacts, 'candidate'), { recursive: true, force: true });
    await rm(join(runArtifacts, 'publication-candidate.yaml'), { force: true });
    await rm(join(runArtifacts, 'stages'), { recursive: true, force: true });
    await rm(join(
      workspaceRoot,
      'examples',
      'references',
      ready.referenceId,
      'sources',
    ), { recursive: true, force: true });

    const replayed = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      idempotencyKey,
    );
    expect(replayed).toMatchObject({
      run: { status: 'completed' },
      replayed: true,
      pendingAction: {
        id: published.pendingAction.id,
        status: 'accepted',
      },
    });
    await expect(fetchJson<RunEnvelope>(runUrl)).resolves.toMatchObject({
      run: { status: 'completed' },
    });
  });

  it('fails closed on published target tampering during accepted terminal recovery', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot);
    servers.push(backend);
    const ready = await createReviewReadyRun(backend.url);
    const runUrl = referenceRunUrl(backend.url, ready.referenceId, ready.run.id);
    const published = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      'publish-terminal-tamper',
    );
    await acceptPendingAction({
      workspaceRoot,
      id: published.pendingAction.id,
      autoCommitOnAccept: false,
    });
    const tamperedTarget = published.pendingAction.touchedFiles.find((file) =>
      file.endsWith('/progress.yaml'))!;
    await writeFile(
      join(workspaceRoot, tamperedTarget),
      'version: 1\nstatus: forged\n',
      'utf-8',
    );

    const response = await fetch(runUrl);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'validationFailed',
    });
  });

  it('allows rejection after source and candidate drift while blocking acceptance and replay', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot);
    servers.push(backend);
    const ready = await createReviewReadyRun(backend.url);
    const runUrl = referenceRunUrl(backend.url, ready.referenceId, ready.run.id);
    const idempotencyKey = 'publish-source-drift-reject';
    const published = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      idempotencyKey,
    );
    const manifestPath = join(
      workspaceRoot,
      'examples',
      'references',
      ready.referenceId,
      'deconstruction-manifest.yaml',
    );
    const manifestBeforePublish = await readFile(manifestPath, 'utf-8');
    await writeFile(join(
      workspaceRoot,
      'examples',
      'references',
      ready.referenceId,
      'sources',
      'original.txt',
    ), 'externally changed source\n', 'utf-8');

    const acceptResponse = await fetch(
      `${backend.url}/api/workspace/pending-actions/${published.pendingAction.id}/accept`,
      { method: 'POST' },
    );
    expect(acceptResponse.status).toBe(409);
    await expect(readFile(manifestPath, 'utf-8')).resolves.toBe(
      manifestBeforePublish,
    );

    const runArtifacts = join(
      workspaceRoot,
      '.workspace',
      'sessions',
      ready.run.id,
      'reference-deconstruction',
    );
    await rm(join(runArtifacts, 'candidate'), { recursive: true, force: true });
    await rm(join(runArtifacts, 'publication-candidate.yaml'), { force: true });
    await rm(join(runArtifacts, 'stages'), { recursive: true, force: true });
    const rejected = await fetchJson<PendingActionDecisionEnvelope>(
      `${backend.url}/api/workspace/pending-actions/${published.pendingAction.id}/reject`,
      { method: 'POST' },
    );
    expect(rejected).toMatchObject({
      id: published.pendingAction.id,
      status: 'rejected',
      referencePublish: {
        run: { status: 'reviewReady' },
      },
    });
    await expect(readFile(manifestPath, 'utf-8')).resolves.toBe(
      manifestBeforePublish,
    );

    const replayResponse = await fetch(`${runUrl}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRunRevision: ready.run.runRevision,
        idempotencyKey,
      }),
    });
    expect(replayResponse.status).toBe(409);
  });

  it('rejects a tampered reference publication action before materialization', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot);
    servers.push(backend);
    const ready = await createReviewReadyRun(backend.url);
    const runUrl = referenceRunUrl(backend.url, ready.referenceId, ready.run.id);
    const published = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      'publish-tampered-pending-action',
    );
    const pendingPath = join(
      workspaceRoot,
      '.workspace',
      'pending-actions',
      `${published.pendingAction.id}.json`,
    );
    const originalStored = JSON.parse(await readFile(pendingPath, 'utf-8')) as {
      patches: Array<Record<string, unknown>>;
      origin: { runRevision: number };
    };
    const revisionTampered = structuredClone(originalStored);
    revisionTampered.origin.runRevision -= 1;
    await writeFile(
      pendingPath,
      `${JSON.stringify(revisionTampered, null, 2)}\n`,
      'utf-8',
    );
    const revisionAcceptResponse = await fetch(
      `${backend.url}/api/workspace/pending-actions/${published.pendingAction.id}/accept`,
      { method: 'POST' },
    );
    expect([409, 422]).toContain(revisionAcceptResponse.status);

    const stored = structuredClone(originalStored);
    stored.patches[0] = {
      ...stored.patches[0],
      value: 'version: 1\nreferences: forged\n',
    };
    await writeFile(
      pendingPath,
      `${JSON.stringify(stored, null, 2)}\n`,
      'utf-8',
    );
    const manifestPath = join(
      workspaceRoot,
      'examples',
      'references',
      ready.referenceId,
      'deconstruction-manifest.yaml',
    );
    const manifestBeforePublish = await readFile(manifestPath, 'utf-8');

    const acceptResponse = await fetch(
      `${backend.url}/api/workspace/pending-actions/${published.pendingAction.id}/accept`,
      { method: 'POST' },
    );
    expect([409, 422]).toContain(acceptResponse.status);
    await expect(readFile(manifestPath, 'utf-8')).resolves.toBe(
      manifestBeforePublish,
    );
    await expect(fetchJson<PendingActionDecisionEnvelope>(
      `${backend.url}/api/workspace/pending-actions/${published.pendingAction.id}/reject`,
      { method: 'POST' },
    )).resolves.toMatchObject({
      status: 'rejected',
      referencePublish: { run: { status: 'reviewReady' } },
    });
  });
});

interface RunProjection {
  id: string;
  status: string;
  runRevision: number;
  diagnostics?: Array<{ code: string; message?: string }>;
  failure?: { code: string; message: string };
  full?: {
    failedUnit?: { id: string };
    analysisQuality?: { status: string };
  };
}

interface RunEnvelope {
  run: RunProjection;
}

interface PublishEnvelope extends RunEnvelope {
  replayed: boolean;
  pendingAction: {
    id: string;
    status: 'pending' | 'accepted' | 'rejected';
    touchedFiles: string[];
    origin: {
      candidateFingerprint: string;
    };
  };
}

interface PendingActionDecisionEnvelope {
  id: string;
  status: 'accepted' | 'rejected';
  referencePublish: RunEnvelope;
}

async function startCompleteReferenceBackend(workspaceRoot: string) {
  return startNovelHttpBackend({
    workspaceRoot,
    providerConfig: providerConfig(),
    runReferenceQuickPreview: async (input) => completedPreview(input),
    runReferenceChapterAnalysis: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: chapterOutput(input.runId, {
        unit: input.unit,
        sourceWindows: [...input.sourceWindows],
        ...(input.rollingContext
          ? { rollingContext: { ...input.rollingContext } }
          : {}),
      }),
    }),
    runReferenceAggregateAnalysis: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: aggregateOutput(input.runId, {
        unit: input.unit,
        verifiedSourceFindings: [...input.verifiedSourceFindings],
        coveredUnitIds: [...input.coveredUnitIds],
        coveredChapterIds: [...input.coveredChapterIds],
      }),
    }),
    runReferenceStyleProfile: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: styleOutput(input.runId, {
        unit: input.unit,
        verifiedSourceFindings: [...input.verifiedSourceFindings],
        coveredUnitIds: [...input.coveredUnitIds],
        coveredChapterIds: [...input.coveredChapterIds],
      }),
    }),
    runReferenceDistillation: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: distillOutput(input.runId, {
        unit: input.unit,
        verifiedSourceFindings: [...input.verifiedSourceFindings],
        coveredUnitIds: [...input.coveredUnitIds],
        coveredChapterIds: [...input.coveredChapterIds],
      }),
    }),
  });
}

async function createReviewReadyRun(backendUrl: string): Promise<{
  referenceId: string;
  run: RunProjection;
}> {
  const approved = await createApprovedRun(backendUrl);
  const runUrl = referenceRunUrl(backendUrl, approved.referenceId, approved.run.id);
  let current = approved.run;
  for (let index = 1; index <= 16 && current.status !== 'reviewReady'; index += 1) {
    current = (await postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      current.runRevision,
      `advance-review-ready-${index}`,
    )).run;
    if (!['fullApproved', 'fullRunning', 'reviewReady'].includes(current.status)) break;
  }
  expect(current.status, current.failure?.message).toBe('reviewReady');
  return { referenceId: approved.referenceId, run: current };
}

async function createApprovedRun(backendUrl: string): Promise<{
  referenceId: string;
  run: RunProjection;
}> {
  const imported = await fetchJson<{ reference: { id: string } }>(
    `${backendUrl}/api/workspace/references/import`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'Backend Full Deconstruction',
        sourceText: [
          '第一章 开端',
          '雨夜里，守门人改变了原定路线。',
          '他留下一个尚未解释的选择，然后离开。',
        ].join('\n'),
        rights: 'owned',
      }),
    },
  );
  const created = await fetchJson<RunEnvelope>(
    `${backendUrl}/api/workspace/references/${imported.reference.id}/deconstruction-runs`,
    {
      method: 'POST',
      body: JSON.stringify({
        mode: 'quickPreview',
        baseRunRevision: 0,
        idempotencyKey: 'create-full-run',
      }),
    },
  );
  const runUrl = referenceRunUrl(
    backendUrl,
    imported.reference.id,
    created.run.id,
  );
  const preview = await postMutation<RunEnvelope>(
    `${runUrl}/advance`,
    created.run.runRevision,
    'advance-preview',
  );
  const approved = await postMutation<RunEnvelope>(
    `${runUrl}/approve-full`,
    preview.run.runRevision,
    'approve-full',
  );
  return { referenceId: imported.reference.id, run: approved.run };
}

function completedPreview(
  input: Parameters<
    NonNullable<Parameters<typeof startNovelHttpBackend>[0]['runReferenceQuickPreview']>
  >[0],
) {
  const evidenceRefs = input.selection.windows.map((window) => window.pointerId);
  const preview = normalizeReferenceQuickPreviewModelOutput({
    sourceOverview: 'A bounded transformed overview.',
    chapterPreviews: input.selection.selectedChapterIds.map((chapterId) => ({
      chapterId,
      summary: `A transformed summary for ${chapterId}.`,
      evidenceRefs: input.selection.windows
        .filter((window) => window.pointer.chapterId === chapterId)
        .map((window) => window.pointerId),
      confidence: 'medium' as const,
    })),
    findings: [{
      kind: 'hook' as const,
      observation: 'The selected opening creates a bounded reader question.',
      technique: 'Introduce a concrete uncertainty before background.',
      confidence: 'medium' as const,
      evidenceRefs: evidenceRefs.slice(0, 1),
      generalInference: false,
    }],
    borrowablePatterns: [{
      title: 'Question before explanation',
      technique: 'Create curiosity before supplying background.',
      evidenceRefs: evidenceRefs.slice(0, 1),
      confidence: 'medium' as const,
    }],
    doNotCopy: ['Do not reuse names, prose, or scene execution.'],
    differentiationRequirements: ['Change premise, causality, and character motivation.'],
    differentiationPrompts: ['What different promise serves this novel own canon?'],
    canonContaminationWarnings: ['Reference facts are not current novel facts.'],
    confidence: 'medium' as const,
    uncertainties: [],
  }, {
    runId: input.runId,
    referenceId: input.selection.referenceId,
    sourceChecksumSha256: input.selection.sourceChecksumSha256,
    selectedChapterIds: input.selection.selectedChapterIds,
    allowedPointers: createReferenceEvidencePointerMap(input.selection),
    sourceWindows: input.selection.windows,
  });
  return { status: 'completed' as const, finishReason: 'stop' as const, preview };
}

function chapterOutput(
  runId: string,
  execution: ReferenceFullDeconstructionExecution,
) {
  const unit = execution.unit;
  const sourceWindow = execution.sourceWindows![0]!;
  return normalizeReferenceChapterAnalysisModelOutput({
    unitSummary: {
      text: 'This bounded movement changes narrative pressure without reproducing source expression.',
      evidenceRefs: [sourceWindow.pointerId],
      confidence: 'medium',
      uncertainty: null,
    },
    chapterSummary: unit.isLastChunkInChapter
      ? {
          text: 'The chapter performs a distinct structural movement.',
          evidenceRefs: [sourceWindow.pointerId],
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
      evidenceRefs: [sourceWindow.pointerId],
      generalInference: false,
      uncertainty: null,
    }],
    rollingSummary: 'Prior movement established changing pressure and an unresolved reader question.',
    rollingEvidenceRefs: [sourceWindow.pointerId],
    uncertainties: [],
  }, {
    runId,
    unit,
    allowedPointers: { [sourceWindow.pointerId]: sourceWindow.pointer },
  });
}

function aggregateOutput(
  runId: string,
  execution: ReferenceFullDeconstructionExecution,
) {
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

function styleOutput(
  runId: string,
  execution: ReferenceFullDeconstructionExecution,
) {
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

function distillOutput(
  runId: string,
  execution: ReferenceFullDeconstructionExecution,
) {
  const first = execution.verifiedSourceFindings![0]!;
  return normalizeReferenceDistillationModelOutput({
    entries: [
      'writingStyle',
      'pacing',
      'hooks',
      'scene',
      'character',
    ].map((category) => ({
      category,
      title: `${category} transferable technique`,
      technique: `Apply a bounded ${category} technique through original causality.`,
      whenUseful: ['When the current novel needs this narrative function.'],
      constraints: ['Use original prose, events, and character motivations.'],
      differentiationPrompts: ['How will the current canon make this structurally different?'],
      sourceFindingRefs: [first.id],
      confidence: 'medium',
      tags: [category],
      capabilityIds: ['novel.write_chapter'],
    })),
    doNotCopyRules: ['Do not reuse source wording, events, or signature expression.'],
    differentiationWarnings: ['Change premise, causality, and character motivation.'],
    uncertainties: [],
  }, {
    runId,
    unit: execution.unit,
    verifiedFindings: findingMap(execution.verifiedSourceFindings!),
    coveredUnitIds: execution.coveredUnitIds!,
    coveredChapterIds: execution.coveredChapterIds!,
  });
}

function findingMap(findings: readonly ReferenceDeconstructionFinding[]) {
  return Object.fromEntries(findings.map((finding) => [finding.id, finding]));
}

async function createOanWorkspace(): Promise<string> {
  const root = await createTemporaryRoot();
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(
    join(root, '.oan/config.yaml'),
    'version: 1\nnovelName: backend-full-sample\n',
    'utf-8',
  );
  await writeFile(
    join(root, '.oan/workflow.yaml'),
    'name: lightnovel\nsteps:\n  - chapter\n',
    'utf-8',
  );
  await writeFile(join(root, 'chapters/0001/0001.md'), '# 第一章\n\n正文。\n', 'utf-8');
  return root;
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-backend-full-'));
  tempRoots.push(root);
  return root;
}

function providerConfig() {
  return {
    id: 'reference-full-test',
    kind: 'custom' as const,
    model: 'mock-reference-full',
  };
}

function referenceRunUrl(
  backendUrl: string,
  referenceId: string,
  runId: string,
): string {
  return `${backendUrl}/api/workspace/references/${referenceId}/deconstruction-runs/${runId}`;
}

function postMutation<T>(
  url: string,
  baseRunRevision: number,
  idempotencyKey: string,
): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    body: JSON.stringify({ baseRunRevision, idempotencyKey }),
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : init?.headers,
  });
  const data = await response.json() as T;
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}
