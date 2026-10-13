import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import {
  beginReferenceDeconstructionPublish,
  createReferenceEvidencePointerMap,
  createReferenceMaterialAdoptionPlan,
  inspectPublishedReferenceWorkReadiness,
  normalizeReferenceAggregateAnalysisModelOutput,
  normalizeReferenceChapterAnalysisModelOutput,
  normalizeReferenceDistillationModelOutput,
  normalizeReferenceQuickPreviewModelOutput,
  normalizeReferenceStoryMaterialAggregateModelOutput,
  normalizeReferenceStoryMaterialChapterModelOutput,
  normalizeReferenceStoryMaterialCoverageModelOutput,
  normalizeReferenceStoryMaterialProjectionModelOutput,
  normalizeReferenceStyleProfileModelOutput,
  prepareReferenceDeconstructionPublicationCandidate,
  rejectReferenceDeconstructionPublish,
  reserveReferenceFullDeconstructionUnit,
} from '@oh-awesome-novel/core';

import type {
  ReferenceChapterWorkUnitWindow,
  ReferenceDeconstructionFinding,
  ReferenceDeconstructionWorkUnit,
  ReferenceFullDeconstructionExecution,
  ReferenceQuickPreviewSelection,
  ReferenceStoryMaterialFinding,
  ReferenceStoryMaterialKind,
} from '@oh-awesome-novel/core';
import {
  createChangeMaterializer,
  createPendingActionStore,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('reference full deconstruction backend', () => {
  it('freezes the active Writing Profile for each run and rejects forged snapshots', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceQuickPreview: async (input) => completedPreview(input),
      runReferenceMaterialCoverage: async (input) => completedMaterialCoverage(input),
    });
    servers.push(backend);

    const commercialReferenceId = await importReference(
      backend.url,
      'Commercial Snapshot',
    );
    const forged = await fetch(
      `${backend.url}/api/workspace/references/${commercialReferenceId}/deconstruction-runs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'quickPreview',
          baseRunRevision: 0,
          idempotencyKey: 'forge-profile-snapshot',
          profileId: 'fanfictionWriting',
          outputs: ['world'],
        }),
      },
    );
    expect(forged.status).toBe(400);
    await expect(forged.json()).resolves.toMatchObject({ code: 'invalidRequest' });

    const commercial = await createRunForReference(
      backend.url,
      commercialReferenceId,
      'create-commercial-snapshot',
    );
    expect(commercial.run).toMatchObject({
      schemaVersion: 2,
      profileId: 'commercialWriting',
      outputs: ['techniques'],
    });

    await activateWritingProfile(backend.url, 'fanfictionWriting');
    const fanfictionReferenceId = await importReference(
      backend.url,
      'Fanfiction Snapshot',
    );
    const fanfiction = await createRunForReference(
      backend.url,
      fanfictionReferenceId,
      'create-fanfiction-snapshot',
    );
    expect(fanfiction.run).toMatchObject({
      schemaVersion: 2,
      profileId: 'fanfictionWriting',
      outputs: ['world', 'characters', 'relationships', 'outline', 'timeline'],
    });

    await fetchJson(`${backend.url}/api/workspace/writing-profiles`, {
      method: 'POST',
      body: JSON.stringify({
        version: 1,
        id: 'both-tracks',
        displayName: 'Both Tracks',
        description: 'Backend run snapshot fixture.',
        deconstruction: { outputs: ['techniques', 'world'] },
        writingReminders: {
          originality: true,
          aiVoice: false,
          characterConsistency: true,
          adaptationFreedom: true,
        },
      }),
    });
    await activateWritingProfile(backend.url, 'both-tracks');
    const bothReferenceId = await importReference(backend.url, 'Both Snapshot');
    const both = await createRunForReference(
      backend.url,
      bothReferenceId,
      'create-both-snapshot',
    );
    expect(both.run).toMatchObject({
      schemaVersion: 2,
      profileId: 'both-tracks',
      outputs: ['techniques', 'world'],
    });

    await activateWritingProfile(backend.url, 'commercialWriting');
    const bothRunUrl = referenceRunUrl(backend.url, bothReferenceId, both.run.id);
    let previewed = both.run;
    for (let index = 1; index <= 2 && previewed.status !== 'awaitingFullApproval'; index += 1) {
      previewed = (await postMutation<RunEnvelope>(
        `${bothRunUrl}/advance`,
        previewed.runRevision,
        `advance-both-snapshot-preview-${index}`,
      )).run;
    }
    expect(previewed.status).toBe('awaitingFullApproval');
    const approved = await postMutation<RunEnvelope>(
      `${bothRunUrl}/approve-full`,
      previewed.runRevision,
      'approve-both-snapshot',
    );
    expect(approved.run).toMatchObject({
      profileId: 'both-tracks',
      outputs: ['techniques', 'world'],
    });
    expect(approved.run.full?.stages.map((stage) => stage.stageId)).toEqual(
      expect.arrayContaining([
        'chapterAnalysis',
        'aggregateAnalysis',
        'styleProfile',
        'distillForOan',
        'materialChapterAnalysis',
        'materialAggregateAnalysis',
        'materialProjection',
        'qualityGate',
      ]),
    );
  });

  it('fails closed after restart when a persisted run loses its frozen outputs', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startNovelHttpBackend({ workspaceRoot });
    servers.push(backend);
    const referenceId = await importReference(backend.url, 'Strict Snapshot');
    const created = await createRunForReference(
      backend.url,
      referenceId,
      'create-strict-snapshot',
    );
    const runStatePath = join(
      workspaceRoot,
      '.workspace',
      'sessions',
      created.run.id,
      'reference-deconstruction',
      'run-state.yaml',
    );
    const original = await readFile(runStatePath, 'utf-8');
    const tampered = original.replace(
      /\noutputs:\n(?:  - [^\n]+\n)+/u,
      '\n',
    );
    expect(tampered).not.toBe(original);
    await writeFile(runStatePath, tampered, 'utf-8');

    const restarted = await startNovelHttpBackend({ workspaceRoot });
    servers.push(restarted);
    const response = await fetch(referenceRunUrl(
      restarted.url,
      referenceId,
      created.run.id,
    ));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'validationFailed',
    });
  });

  it('resumes a frozen fanfiction run through only Story Material stages', async () => {
    const workspaceRoot = await createOanWorkspace();
    let coverageCalls = 0;
    const setup = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceMaterialCoverage: async (input) => {
        coverageCalls += 1;
        return completedMaterialCoverage(input);
      },
    });
    servers.push(setup);
    await activateWritingProfile(setup.url, 'fanfictionWriting');
    const referenceId = await importReference(setup.url, 'Fanfiction Material Run');
    const created = await createRunForReference(
      setup.url,
      referenceId,
      'create-fanfiction-material-run',
    );
    const runUrl = referenceRunUrl(setup.url, referenceId, created.run.id);
    const previewed = await postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      created.run.runRevision,
      'advance-fanfiction-material-preview',
    );
    expect(previewed.run).toMatchObject({
      status: 'awaitingFullApproval',
      profileId: 'fanfictionWriting',
      materialPreview: {
        track: 'storyMaterial',
        materialKinds: ['world', 'characters', 'relationships', 'outline', 'timeline'],
      },
    });
    const approved = await postMutation<RunEnvelope>(
      `${runUrl}/approve-full`,
      previewed.run.runRevision,
      'approve-fanfiction-material-run',
    );
    await activateWritingProfile(setup.url, 'commercialWriting');
    await setup.close();
    servers.splice(servers.indexOf(setup), 1);

    const calls = {
      technique: 0,
      materialChapter: 0,
      materialAggregate: 0,
      materialProjection: 0,
    };
    const restarted = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceChapterAnalysis: async () => {
        calls.technique += 1;
        throw new Error('Technique chapter runner must not receive a material unit.');
      },
      runReferenceAggregateAnalysis: async () => {
        calls.technique += 1;
        throw new Error('Technique aggregate runner must not receive a material unit.');
      },
      runReferenceStyleProfile: async () => {
        calls.technique += 1;
        throw new Error('Technique style runner must not receive a material unit.');
      },
      runReferenceDistillation: async () => {
        calls.technique += 1;
        throw new Error('Technique distillation runner must not receive a material unit.');
      },
      runReferenceMaterialChapter: async (input) => {
        calls.materialChapter += 1;
        if (calls.materialChapter === 1) {
          return {
            status: 'failed',
            error: {
              code: 'invalid_output',
              message: 'Retry the bounded Story Material chapter fixture.',
              retryable: false,
            },
          };
        }
        return {
          status: 'completed',
          finishReason: 'stop',
          output: materialChapterOutput(input.runId, {
            unit: input.unit,
            materialKinds: input.materialKinds,
            sourceWindows: input.sourceWindows,
          }),
        };
      },
      runReferenceMaterialAggregate: async (input) => {
        calls.materialAggregate += 1;
        return {
          status: 'completed',
          finishReason: 'stop',
          output: materialAggregateOutput(input.runId, {
            unit: input.unit,
            materialKinds: input.materialKinds,
            verifiedFindings: input.verifiedFindings,
            coveredUnitIds: input.coveredUnitIds,
            coveredChapterIds: input.coveredChapterIds,
          }),
        };
      },
      runReferenceMaterialProjection: async (input) => {
        calls.materialProjection += 1;
        return {
          status: 'completed',
          finishReason: 'stop',
          output: materialProjectionOutput(input.runId, {
            unit: input.unit,
            materialKinds: input.materialKinds,
            verifiedFindings: input.verifiedFindings,
            coveredUnitIds: input.coveredUnitIds,
            coveredChapterIds: input.coveredChapterIds,
          }),
        };
      },
    });
    servers.push(restarted);
    const restartedRunUrl = referenceRunUrl(
      restarted.url,
      referenceId,
      approved.run.id,
    );
    let current = (await fetchJson<RunEnvelope>(restartedRunUrl)).run;
    expect(current).toMatchObject({
      status: 'fullApproved',
      profileId: 'fanfictionWriting',
      outputs: ['world', 'characters', 'relationships', 'outline', 'timeline'],
    });
    current = (await postMutation<RunEnvelope>(
      `${restartedRunUrl}/advance`,
      current.runRevision,
      'fail-restarted-material-chapter',
    )).run;
    expect(current).toMatchObject({
      status: 'failed',
      full: {
        failedUnit: { track: 'storyMaterial' },
      },
    });
    current = (await fetchJson<RunEnvelope>(`${restartedRunUrl}/retry`, {
      method: 'POST',
      body: JSON.stringify({
        baseRunRevision: current.runRevision,
        idempotencyKey: 'retry-restarted-material-chapter',
        unitId: current.full!.failedUnit!.id,
      }),
    })).run;
    expect(current.status).toBe('fullRunning');
    for (let index = 1; index <= 12 && current.status !== 'reviewReady'; index += 1) {
      current = (await postMutation<RunEnvelope>(
        `${restartedRunUrl}/advance`,
        current.runRevision,
        `advance-restarted-material-${index}`,
      )).run;
      if (!['fullApproved', 'fullRunning', 'reviewReady'].includes(current.status)) break;
    }
    expect(
      current.status,
      current.failure?.message ?? current.diagnostics?.map((item) => item.message).join('\n'),
    ).toBe('reviewReady');
    expect(current.full?.analysisQuality).toMatchObject({
      storyMaterial: { status: 'passed' },
    });
    expect(current.full?.stages.map((stage) => stage.stageId)).not.toEqual(
      expect.arrayContaining([
        'chapterAnalysis',
        'aggregateAnalysis',
        'styleProfile',
        'distillForOan',
      ]),
    );
    expect(coverageCalls).toBe(1);
    expect(calls.technique).toBe(0);
    expect(calls.materialChapter).toBeGreaterThan(1);
    expect(calls.materialAggregate).toBeGreaterThan(0);
    expect(calls.materialProjection).toBe(1);

    const published = await postMutation<PublishEnvelope>(
      `${restartedRunUrl}/publish`,
      current.runRevision,
      'publish-restarted-material-only',
    );
    const materialPaths = [
      'world',
      'characters',
      'relationships',
      'outline',
      'timeline',
    ].map((materialKind) =>
      `examples/references/${referenceId}/materials/${materialKind}.yaml`);
    const publishedPaths = published.pendingAction.changes.map((change) => change.path);
    expect(publishedPaths).toEqual(
      expect.arrayContaining(materialPaths),
    );
    expect(publishedPaths.filter((path) =>
      path.includes('/distilled/'))).toEqual([]);

    await materializePendingAction(workspaceRoot, published.pendingAction.id);
    await expect(fetchJson<RunEnvelope>(restartedRunUrl)).resolves.toMatchObject({
      run: { status: 'completed' },
    });
    for (const materialPath of materialPaths) {
      await expect(readFile(join(workspaceRoot, materialPath), 'utf-8'))
        .resolves.toEqual(expect.any(String));
    }
    await expect(inspectPublishedReferenceWorkReadiness(
      workspaceRoot,
      referenceId,
    )).resolves.toMatchObject({
      status: 'completed',
      contextEligible: false,
      reason: 'techniqueTrackNotPublished',
      contextIndex: {
        techniqueTrackRan: false,
        contextEligible: false,
        entries: [],
      },
      deconstructionManifest: {
        profileId: 'fanfictionWriting',
        selectedOutputs: ['world', 'characters', 'relationships', 'outline', 'timeline'],
      },
      progress: { contextEligible: false },
    });

    await restarted.close();
    servers.splice(servers.indexOf(restarted), 1);
    const reconciled = await startNovelHttpBackend({ workspaceRoot });
    servers.push(reconciled);
    await expect(fetchJson<RunEnvelope>(referenceRunUrl(
      reconciled.url,
      referenceId,
      current.id,
    ))).resolves.toMatchObject({
      run: { status: 'completed' },
    });
  });

  it('preserves current Technique provenance across material publication and stales it after source change', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot);
    servers.push(backend);

    const techniqueReady = await createReviewReadyRun(backend.url);
    await publishAndAcceptReferenceRun({
      workspaceRoot,
      backendUrl: backend.url,
      referenceId: techniqueReady.referenceId,
      run: techniqueReady.run,
      idempotencyKey: 'publish-technique-provenance-base',
    });
    const techniqueInspection = await inspectPublishedReferenceWorkReadiness(
      workspaceRoot,
      techniqueReady.referenceId,
    );
    const techniqueManifest = techniqueInspection.deconstructionManifest;
    if (!techniqueManifest || !techniqueInspection.contextIndex) {
      throw new Error('Technique publication fixture is missing its published context.');
    }
    expect(techniqueInspection).toMatchObject({
      status: 'completed',
      contextEligible: true,
      reason: 'ready',
      contextIndex: {
        publishedRunId: techniqueReady.run.id,
        techniqueTrackRan: true,
        contextEligible: true,
      },
    });
    const techniqueOutputs = techniqueManifest.outputs.filter((output) =>
      output.sourceRunId === techniqueReady.run.id);
    expect(techniqueOutputs.length).toBeGreaterThan(0);
    expect(techniqueOutputs.every((output) => !output.stale)).toBe(true);

    await activateWritingProfile(backend.url, 'fanfictionWriting');
    const sameSourceMaterial = await createReviewReadyRunForReference(
      backend.url,
      techniqueReady.referenceId,
      'same-source-material',
    );
    await publishAndAcceptReferenceRun({
      workspaceRoot,
      backendUrl: backend.url,
      referenceId: techniqueReady.referenceId,
      run: sameSourceMaterial,
      idempotencyKey: 'publish-same-source-material',
    });
    const sameSourceInspection = await inspectPublishedReferenceWorkReadiness(
      workspaceRoot,
      techniqueReady.referenceId,
    );
    const sameSourceManifest = sameSourceInspection.deconstructionManifest;
    if (!sameSourceManifest || !sameSourceInspection.contextIndex) {
      throw new Error('Same-source material publication lost its context projection.');
    }
    expect(sameSourceInspection).toMatchObject({
      status: 'completed',
      contextEligible: true,
      reason: 'ready',
      contextIndex: {
        publishedRunId: techniqueReady.run.id,
        techniqueTrackRan: true,
        contextEligible: true,
      },
    });
    const retainedTechniqueOutputs = sameSourceManifest.outputs.filter((output) =>
      output.sourceRunId === techniqueReady.run.id);
    expect(retainedTechniqueOutputs.length).toBe(techniqueOutputs.length);
    expect(retainedTechniqueOutputs.every((output) =>
      !output.stale
      && output.sourceChecksumSha256 === techniqueManifest.sourceChecksumSha256,
    )).toBe(true);
    const sameSourceMaterialOutputs = sameSourceManifest.outputs.filter((output) =>
      output.kind === 'materials');
    expect(sameSourceMaterialOutputs).toHaveLength(5);
    expect(sameSourceMaterialOutputs.every((output) =>
      output.sourceRunId === sameSourceMaterial.id
      && output.sourceChecksumSha256 === techniqueManifest.sourceChecksumSha256
      && !output.stale,
    )).toBe(true);

    const changedSource = await rewriteReferenceSourceIdentity(
      workspaceRoot,
      techniqueReady.referenceId,
    );
    expect(changedSource.previousChecksumSha256).toBe(
      techniqueManifest.sourceChecksumSha256,
    );
    const changedSourceMaterial = await createReviewReadyRunForReference(
      backend.url,
      techniqueReady.referenceId,
      'changed-source-material',
    );
    await publishAndAcceptReferenceRun({
      workspaceRoot,
      backendUrl: backend.url,
      referenceId: techniqueReady.referenceId,
      run: changedSourceMaterial,
      idempotencyKey: 'publish-changed-source-material',
    });
    const changedSourceInspection = await inspectPublishedReferenceWorkReadiness(
      workspaceRoot,
      techniqueReady.referenceId,
    );
    const changedSourceManifest = changedSourceInspection.deconstructionManifest;
    if (!changedSourceManifest || !changedSourceInspection.contextIndex) {
      throw new Error('Changed-source material publication lost its empty context projection.');
    }
    expect(changedSourceInspection).toMatchObject({
      status: 'completed',
      contextEligible: false,
      reason: 'techniqueTrackNotPublished',
      contextIndex: {
        publishedRunId: changedSourceMaterial.id,
        sourceChecksumSha256: changedSource.checksumSha256,
        techniqueTrackRan: false,
        contextEligible: false,
        entries: [],
      },
      progress: { contextEligible: false },
    });
    expect(changedSourceManifest.sourceChecksumSha256).toBe(
      changedSource.checksumSha256,
    );
    const staleTechniqueOutputs = changedSourceManifest.outputs.filter((output) =>
      output.sourceRunId === techniqueReady.run.id);
    expect(staleTechniqueOutputs.length).toBe(retainedTechniqueOutputs.filter((output) =>
      output.kind !== 'context').length);
    expect(staleTechniqueOutputs.every((output) =>
      output.stale
      && output.sourceChecksumSha256 === changedSource.previousChecksumSha256,
    )).toBe(true);
    expect(changedSourceManifest.outputs.some((output) =>
      output.kind === 'context'
      && output.sourceRunId === techniqueReady.run.id)).toBe(false);
    expect(changedSourceManifest.outputs.filter((output) =>
      output.kind === 'context')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'context/index.yaml',
        sourceRunId: changedSourceMaterial.id,
        sourceChecksumSha256: changedSource.checksumSha256,
        stale: false,
      }),
      expect.objectContaining({
        path: 'context/reference-summary.md',
        sourceRunId: changedSourceMaterial.id,
        sourceChecksumSha256: changedSource.checksumSha256,
        stale: false,
      }),
    ]));
  }, 60_000);

  it('runs custom both tracks in one controller with shared source pointers', async () => {
    const workspaceRoot = await createOanWorkspace();
    const calls = {
      techniqueChapter: 0,
      techniqueAggregate: 0,
      techniqueStyle: 0,
      techniqueDistill: 0,
      materialChapter: 0,
      materialAggregate: 0,
      materialProjection: 0,
    };
    const techniquePointers: string[] = [];
    const materialPointers: string[] = [];
    const backend = await startNovelHttpBackend({
      workspaceRoot,
      providerConfig: providerConfig(),
      runReferenceQuickPreview: async (input) => completedPreview(input),
      runReferenceMaterialCoverage: async (input) => completedMaterialCoverage(input),
      runReferenceChapterAnalysis: async (input) => {
        calls.techniqueChapter += 1;
        techniquePointers.push(...input.sourceWindows.map((window) => window.pointerId));
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
        calls.techniqueAggregate += 1;
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
        calls.techniqueStyle += 1;
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
        calls.techniqueDistill += 1;
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
      runReferenceMaterialChapter: async (input) => {
        calls.materialChapter += 1;
        materialPointers.push(...input.sourceWindows.map((window) => window.pointerId));
        return {
          status: 'completed',
          finishReason: 'stop',
          output: materialChapterOutput(input.runId, {
            unit: input.unit,
            materialKinds: input.materialKinds,
            sourceWindows: input.sourceWindows,
          }),
        };
      },
      runReferenceMaterialAggregate: async (input) => {
        calls.materialAggregate += 1;
        return {
          status: 'completed',
          finishReason: 'stop',
          output: materialAggregateOutput(input.runId, {
            unit: input.unit,
            materialKinds: input.materialKinds,
            verifiedFindings: input.verifiedFindings,
            coveredUnitIds: input.coveredUnitIds,
            coveredChapterIds: input.coveredChapterIds,
          }),
        };
      },
      runReferenceMaterialProjection: async (input) => {
        calls.materialProjection += 1;
        return {
          status: 'completed',
          finishReason: 'stop',
          output: materialProjectionOutput(input.runId, {
            unit: input.unit,
            materialKinds: input.materialKinds,
            verifiedFindings: input.verifiedFindings,
            coveredUnitIds: input.coveredUnitIds,
            coveredChapterIds: input.coveredChapterIds,
          }),
        };
      },
    });
    servers.push(backend);
    await createBothWritingProfile(backend.url, 'both-controller');
    await activateWritingProfile(backend.url, 'both-controller');
    const referenceId = await importReference(backend.url, 'Both Controller Run');
    const created = await createRunForReference(
      backend.url,
      referenceId,
      'create-both-controller-run',
    );
    const runUrl = referenceRunUrl(backend.url, referenceId, created.run.id);
    let current = created.run;
    for (let index = 1; index <= 2 && current.status !== 'awaitingFullApproval'; index += 1) {
      current = (await postMutation<RunEnvelope>(
        `${runUrl}/advance`,
        current.runRevision,
        `advance-both-controller-preview-${index}`,
      )).run;
    }
    expect(current.status).toBe('awaitingFullApproval');
    current = (await postMutation<RunEnvelope>(
      `${runUrl}/approve-full`,
      current.runRevision,
      'approve-both-controller-run',
    )).run;
    for (let index = 1; index <= 20 && current.status !== 'reviewReady'; index += 1) {
      current = (await postMutation<RunEnvelope>(
        `${runUrl}/advance`,
        current.runRevision,
        `advance-both-controller-full-${index}`,
      )).run;
      if (!['fullApproved', 'fullRunning', 'reviewReady'].includes(current.status)) break;
    }

    expect(
      current.status,
      current.failure?.message ?? current.diagnostics?.map((item) => item.message).join('\n'),
    ).toBe('reviewReady');
    expect(current).toMatchObject({
      profileId: 'both-controller',
      outputs: ['techniques', 'world'],
      full: {
        analysisQuality: {
          technique: { status: 'passed' },
          storyMaterial: { status: 'passed' },
        },
      },
    });
    expect(calls).toMatchObject({
      techniqueChapter: expect.any(Number),
      techniqueAggregate: expect.any(Number),
      techniqueStyle: 1,
      techniqueDistill: 1,
      materialChapter: expect.any(Number),
      materialAggregate: expect.any(Number),
      materialProjection: 1,
    });
    expect(calls.techniqueChapter).toBeGreaterThan(0);
    expect(calls.techniqueAggregate).toBeGreaterThan(0);
    expect(calls.materialChapter).toBeGreaterThan(0);
    expect(calls.materialAggregate).toBeGreaterThan(0);
    expect(materialPointers).toEqual(techniquePointers);
  });

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
    expect(current.full?.analysisQuality).toMatchObject({
      technique: { status: 'passed' },
    });
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
      pendingAction: {
        id: published.pendingAction.id,
        status: 'accepted',
      },
      referencePublish: {
        run: { status: 'completed' },
      },
    });
    for (const target of published.pendingAction.changes.map((change) => change.path)) {
      await expect(readFile(join(workspaceRoot, target), 'utf-8'))
        .resolves.toEqual(expect.any(String));
    }
    await expect(fetchJson<RunEnvelope>(runUrl)).resolves.toMatchObject({
      run: { status: 'completed' },
    });
  });

  it('publishes warned quality with a manifest summary and visible PendingAction count', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot, {
      withQualityWarning: true,
    });
    servers.push(backend);
    const ready = await createReviewReadyRun(backend.url);
    expect(ready.run.full?.analysisQuality).toMatchObject({
      technique: {
        status: 'warned',
        blockingDiagnosticCount: 0,
      },
    });
    expect(ready.run.diagnostics).toContainEqual(expect.objectContaining({
      code: 'quality.uncertainty',
      severity: 'warning',
      blocking: false,
    }));

    const runUrl = referenceRunUrl(backend.url, ready.referenceId, ready.run.id);
    const published = await postMutation<PublishEnvelope>(
      `${runUrl}/publish`,
      ready.run.runRevision,
      'publish-warned-bundle',
    );
    expect(published.pendingAction.description).toMatch(
      /Includes [1-9]\d* non-blocking quality warning\(s\)/u,
    );

    await fetchJson<PendingActionDecisionEnvelope>(
      `${backend.url}/api/workspace/pending-actions/${published.pendingAction.id}/accept`,
      { method: 'POST' },
    );
    await expect(inspectPublishedReferenceWorkReadiness(
      workspaceRoot,
      ready.referenceId,
    )).resolves.toMatchObject({
      status: 'completed',
      contextEligible: true,
      reason: 'ready',
      deconstructionManifest: {
        qualityStatus: 'warned',
        warningSummary: {
          count: expect.any(Number),
          codes: expect.arrayContaining(['quality.uncertainty']),
        },
      },
      progress: {
        contextEligible: true,
      },
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
    await materializePendingAction(workspaceRoot, published.pendingAction.id);
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
    await materializePendingAction(workspaceRoot, published.pendingAction.id);
    const tamperedTarget = published.pendingAction.changes
      .map((change) => change.path)
      .find((file) =>
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
      pendingAction: {
        id: published.pendingAction.id,
        status: 'rejected',
      },
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
      'change-engine',
      'v1',
      'pending',
      `${published.pendingAction.id}.json`,
    );
    const originalStored = JSON.parse(await readFile(pendingPath, 'utf-8')) as {
      changes: Array<{
        draft: null | { sha256: string; byteLength: number; relativePath: string };
      }>;
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
    expect(stored.changes[0]?.draft).not.toBeNull();
    stored.changes[0]!.draft!.sha256 = '0'.repeat(64);
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
      pendingAction: { status: 'rejected' },
      referencePublish: { run: { status: 'reviewReady' } },
    });
  });

  it('closes published Story Material adoption through diff, PendingAction, Accept, and stale-target rejection', async () => {
    const workspaceRoot = await createOanWorkspace();
    const backend = await startCompleteReferenceBackend(workspaceRoot, {
      runReferenceMaterialAdoption: async (input) => ({
        status: 'completed',
        finishReason: 'stop',
        plan: createReferenceMaterialAdoptionPlan(input.context, {
          targets: input.context.targets.map((target) => ({
            targetId: target.id,
            decision: target.targetExisted ? 'update' : 'create',
            reason: 'Adopt the explicitly selected bounded entry into its controlled target.',
            draft: target.targetExisted
              ? `${target.baseline.trimEnd()}\n\nBounded adoption update.\n`
              : [
                  '# Adopted Rain Gate',
                  '',
                  `Selected entries: ${target.entries.map((entry) => entry.id).join(', ')}`,
                  '',
                ].join('\n'),
          })),
        }),
      }),
    });
    servers.push(backend);
    await activateWritingProfile(backend.url, 'fanfictionWriting');
    const referenceId = await importReference(backend.url, 'Adoption Source');
    const ready = await createReviewReadyRunForReference(
      backend.url,
      referenceId,
      'adoption-source',
    );
    await publishAndAcceptReferenceRun({
      workspaceRoot,
      backendUrl: backend.url,
      referenceId,
      run: ready,
      idempotencyKey: 'publish-adoption-source',
    });

    const catalogEnvelope = await fetchJson<{
      catalog: {
        fingerprint: string;
        entries: Array<{ id: string; materialKind: string }>;
      };
    }>(`${backend.url}/api/workspace/references/${referenceId}/materials`);
    const selected = catalogEnvelope.catalog.entries.find((entry) =>
      entry.materialKind === 'world');
    expect(selected).toBeDefined();
    const targetFile = 'world/adopted/reference-rain.md';
    const targetPath = join(workspaceRoot, targetFile);
    const createPreview = () => fetchJson<{
      status: 'ready';
      preview: {
        id: string;
        fingerprint: string;
        changes: Array<{ operation: 'create' | 'update' | 'delete'; path: string }>;
        canonicalUnchanged: true;
      };
    }>(`${backend.url}/api/workspace/references/${referenceId}/material-adoption-previews`, {
      method: 'POST',
      body: JSON.stringify({
        catalogFingerprint: catalogEnvelope.catalog.fingerprint,
        selections: [{ entryId: selected!.id, targetFile }],
      }),
    });

    const preview = await createPreview();
    expect(preview).toMatchObject({
      status: 'ready',
      preview: {
        changes: [{ operation: 'create', path: targetFile }],
        canonicalUnchanged: true,
      },
    });
    await expect(readOptionalFile(targetPath)).resolves.toBeUndefined();
    const pending = await fetchJson<{
      pendingAction: {
        id: string;
        status: 'pending';
        changes: Array<{ operation: 'create' | 'update' | 'delete'; path: string }>;
      };
    }>(
      `${backend.url}/api/workspace/references/${referenceId}`
        + `/material-adoption-previews/${preview.preview.id}/pending-action`,
      {
        method: 'POST',
        body: JSON.stringify({ fingerprint: preview.preview.fingerprint }),
      },
    );
    expect(pending.pendingAction).toMatchObject({
      status: 'pending',
      changes: [{ operation: 'create', path: targetFile }],
    });
    await expect(readOptionalFile(targetPath)).resolves.toBeUndefined();

    await expect(fetchJson<{ pendingAction: { status: string } }>(
      `${backend.url}/api/workspace/pending-actions/${pending.pendingAction.id}/accept`,
      { method: 'POST' },
    )).resolves.toMatchObject({ pendingAction: { status: 'accepted' } });
    await expect(readFile(targetPath, 'utf8')).resolves.toContain('# Adopted Rain Gate');

    const updatePreview = await createPreview();
    const updatePending = await fetchJson<{
      pendingAction: { id: string; status: 'pending' };
    }>(
      `${backend.url}/api/workspace/references/${referenceId}`
        + `/material-adoption-previews/${updatePreview.preview.id}/pending-action`,
      {
        method: 'POST',
        body: JSON.stringify({ fingerprint: updatePreview.preview.fingerprint }),
      },
    );
    const externalContent = '# User edit after PendingAction\n';
    await writeFile(targetPath, externalContent, 'utf8');
    const staleAccept = await fetch(
      `${backend.url}/api/workspace/pending-actions/${updatePending.pendingAction.id}/accept`,
      { method: 'POST' },
    );
    expect(staleAccept.status).toBe(409);
    await expect(staleAccept.json()).resolves.toMatchObject({ code: 'stalePreview' });
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(externalContent);
  });
});

interface RunProjection {
  id: string;
  schemaVersion?: number;
  profileId?: string;
  outputs?: string[];
  materialPreview?: { track: string; materialKinds: string[] };
  status: string;
  runRevision: number;
  diagnostics?: Array<{ code: string; message?: string }>;
  failure?: { code: string; message: string };
  full?: {
    failedUnit?: { id: string; track?: string };
    stages: Array<{ stageId: string; status?: string }>;
    analysisQuality?: Partial<Record<
      'technique' | 'storyMaterial',
      { status: string; blockingDiagnosticCount?: number }
    >>;
  };
}

interface RunEnvelope {
  run: RunProjection;
}

interface PublishEnvelope extends RunEnvelope {
  replayed: boolean;
  pendingAction: {
    id: string;
    description: string;
    status: 'pending' | 'accepted' | 'rejected';
    changes: Array<{
      operation: 'create' | 'update' | 'delete';
      path: string;
    }>;
    origin: {
      candidateFingerprint: string;
    };
  };
}

interface PendingActionDecisionEnvelope {
  pendingAction: {
    id: string;
    status: 'accepted' | 'rejected';
  };
  referencePublish: RunEnvelope;
}

async function startCompleteReferenceBackend(
  workspaceRoot: string,
  options: {
    withQualityWarning?: boolean;
    runReferenceMaterialAdoption?: NonNullable<
      Parameters<typeof startNovelHttpBackend>[0]['runReferenceMaterialAdoption']
    >;
  } = {},
) {
  return startNovelHttpBackend({
    workspaceRoot,
    providerConfig: providerConfig(),
    runReferenceQuickPreview: async (input) => completedPreview(input),
    runReferenceMaterialCoverage: async (input) => completedMaterialCoverage(input),
    runReferenceChapterAnalysis: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: chapterOutput(input.runId, {
        unit: input.unit,
        sourceWindows: [...input.sourceWindows],
        ...(input.rollingContext
          ? { rollingContext: { ...input.rollingContext } }
          : {}),
      }, options.withQualityWarning
        ? 'The chapter-level pattern may change outside this bounded source window.'
        : undefined),
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
    runReferenceMaterialChapter: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: materialChapterOutput(input.runId, {
        unit: input.unit,
        materialKinds: input.materialKinds,
        sourceWindows: input.sourceWindows,
      }),
    }),
    runReferenceMaterialAggregate: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: materialAggregateOutput(input.runId, {
        unit: input.unit,
        materialKinds: input.materialKinds,
        verifiedFindings: input.verifiedFindings,
        coveredUnitIds: input.coveredUnitIds,
        coveredChapterIds: input.coveredChapterIds,
      }),
    }),
    runReferenceMaterialProjection: async (input) => ({
      status: 'completed',
      finishReason: 'stop',
      output: materialProjectionOutput(input.runId, {
        unit: input.unit,
        materialKinds: input.materialKinds,
        verifiedFindings: input.verifiedFindings,
        coveredUnitIds: input.coveredUnitIds,
        coveredChapterIds: input.coveredChapterIds,
      }),
    }),
    ...(options.runReferenceMaterialAdoption
      ? { runReferenceMaterialAdoption: options.runReferenceMaterialAdoption }
      : {}),
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

async function createReviewReadyRunForReference(
  backendUrl: string,
  referenceId: string,
  idempotencyPrefix: string,
): Promise<RunProjection> {
  const created = await createRunForReference(
    backendUrl,
    referenceId,
    `create-${idempotencyPrefix}`,
  );
  const runUrl = referenceRunUrl(backendUrl, referenceId, created.run.id);
  let current = created.run;
  for (let index = 1; index <= 2 && current.status !== 'awaitingFullApproval'; index += 1) {
    current = (await postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      current.runRevision,
      `preview-${idempotencyPrefix}-${index}`,
    )).run;
  }
  expect(current.status, current.failure?.message).toBe('awaitingFullApproval');
  current = (await postMutation<RunEnvelope>(
    `${runUrl}/approve-full`,
    current.runRevision,
    `approve-${idempotencyPrefix}`,
  )).run;
  for (let index = 1; index <= 16 && current.status !== 'reviewReady'; index += 1) {
    current = (await postMutation<RunEnvelope>(
      `${runUrl}/advance`,
      current.runRevision,
      `advance-${idempotencyPrefix}-${index}`,
    )).run;
    if (!['fullApproved', 'fullRunning', 'reviewReady'].includes(current.status)) break;
  }
  expect(current.status, current.failure?.message).toBe('reviewReady');
  return current;
}

async function publishAndAcceptReferenceRun(input: {
  workspaceRoot: string;
  backendUrl: string;
  referenceId: string;
  run: RunProjection;
  idempotencyKey: string;
}): Promise<RunProjection> {
  const runUrl = referenceRunUrl(input.backendUrl, input.referenceId, input.run.id);
  const published = await postMutation<PublishEnvelope>(
    `${runUrl}/publish`,
    input.run.runRevision,
    input.idempotencyKey,
  );
  await fetchJson(
    `${input.backendUrl}/api/workspace/pending-actions/${published.pendingAction.id}/accept`,
    { method: 'POST' },
  );
  const reconciled = (await fetchJson<RunEnvelope>(runUrl)).run;
  expect(reconciled.status).toBe('completed');
  return reconciled;
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

async function importReference(
  backendUrl: string,
  title: string,
): Promise<string> {
  const imported = await fetchJson<{ reference: { id: string } }>(
    `${backendUrl}/api/workspace/references/import`,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
        sourceText: [
          '第一章 开端',
          '雨夜里，守门人改变了原定路线。',
          '他留下一个尚未解释的选择，然后离开。',
        ].join('\n'),
        rights: 'owned',
      }),
    },
  );
  return imported.reference.id;
}

function createRunForReference(
  backendUrl: string,
  referenceId: string,
  idempotencyKey: string,
): Promise<RunEnvelope> {
  return fetchJson<RunEnvelope>(
    `${backendUrl}/api/workspace/references/${referenceId}/deconstruction-runs`,
    {
      method: 'POST',
      body: JSON.stringify({
        mode: 'quickPreview',
        baseRunRevision: 0,
        idempotencyKey,
      }),
    },
  );
}

async function activateWritingProfile(
  backendUrl: string,
  profileId: string,
): Promise<void> {
  await fetchJson(
    `${backendUrl}/api/workspace/writing-profiles/${profileId}/activate`,
    { method: 'POST', body: '{}' },
  );
}

async function createBothWritingProfile(
  backendUrl: string,
  profileId: string,
): Promise<void> {
  await fetchJson(`${backendUrl}/api/workspace/writing-profiles`, {
    method: 'POST',
    body: JSON.stringify({
      version: 1,
      id: profileId,
      displayName: 'Both Tracks',
      description: 'Backend both-track controller fixture.',
      deconstruction: { outputs: ['techniques', 'world'] },
      writingReminders: {
        originality: true,
        aiVoice: false,
        characterConsistency: true,
        adaptationFreedom: true,
      },
    }),
  });
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

function completedMaterialCoverage(input: {
  runId: string;
  selection: ReferenceQuickPreviewSelection;
  materialKinds: readonly ReferenceStoryMaterialKind[];
}) {
  const firstPointerId = input.selection.windows[0]!.pointerId;
  const output = normalizeReferenceStoryMaterialCoverageModelOutput({
    items: input.materialKinds.map((materialKind) => ({
      materialKind,
      coverage: 'substantial' as const,
      summary: `The bounded preview covers concrete ${materialKind} material.`,
      confidence: 'medium' as const,
      evidenceRefs: [firstPointerId],
      uncertainty: null,
    })),
    uncertainties: [],
  }, {
    runId: input.runId,
    selection: input.selection,
    materialKinds: input.materialKinds,
  });
  return { status: 'completed' as const, finishReason: 'stop' as const, output };
}

function chapterOutput(
  runId: string,
  execution: ReferenceFullDeconstructionExecution,
  uncertainty?: string,
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
    uncertainties: uncertainty ? [uncertainty] : [],
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

function materialChapterOutput(
  runId: string,
  input: {
    unit: ReferenceDeconstructionWorkUnit;
    materialKinds: readonly ReferenceStoryMaterialKind[];
    sourceWindows: readonly ReferenceChapterWorkUnitWindow[];
  },
) {
  const sourceWindow = input.sourceWindows[0]!;
  return normalizeReferenceStoryMaterialChapterModelOutput({
    summary: 'The bounded source window contains concrete story material.',
    summaryEvidenceRefs: [sourceWindow.pointerId],
    findings: input.materialKinds.map((materialKind) => ({
      materialKind,
      title: `${materialKind} bounded fact`,
      content: `A concrete ${materialKind} fact remains attached to its source evidence.`,
      details: [`The ${materialKind} fixture remains specific and auditable.`],
      assertionType: 'fact' as const,
      confidence: 'medium' as const,
      evidenceRefs: [sourceWindow.pointerId],
      uncertainty: null,
    })),
    uncertainties: [],
  }, {
    runId,
    unit: input.unit,
    materialKinds: input.materialKinds,
    allowedPointers: Object.fromEntries(input.sourceWindows.map((window) => [
      window.pointerId,
      window.pointer,
    ])),
  });
}

function materialAggregateOutput(
  runId: string,
  input: MaterialReductionFixtureInput,
) {
  return normalizeReferenceStoryMaterialAggregateModelOutput({
    summary: 'Concrete material facts are merged without technique abstraction.',
    findings: input.materialKinds.map((materialKind) => {
      const predecessor = requireMaterialFinding(input.verifiedFindings, materialKind);
      return {
        materialKind,
        title: `${materialKind} aggregate fact`,
        content: `The aggregate preserves the concrete ${materialKind} fact.`,
        details: [`Merged ${materialKind} evidence remains traceable.`],
        assertionType: 'fact' as const,
        confidence: 'medium' as const,
        sourceFindingRefs: [predecessor.id],
        uncertainty: null,
      };
    }),
    uncertainties: [],
  }, {
    runId,
    unit: input.unit,
    materialKinds: input.materialKinds,
    verifiedFindings: materialFindingMap(input.verifiedFindings),
    coveredUnitIds: input.coveredUnitIds,
    coveredChapterIds: input.coveredChapterIds,
  });
}

function materialProjectionOutput(
  runId: string,
  input: MaterialReductionFixtureInput,
) {
  return normalizeReferenceStoryMaterialProjectionModelOutput({
    entries: input.materialKinds.map((materialKind) => {
      const predecessor = requireMaterialFinding(input.verifiedFindings, materialKind);
      return {
        materialKind,
        title: `${materialKind} projected entry`,
        content: `The projection keeps the accepted ${materialKind} fact concrete.`,
        details: [`Projected ${materialKind} evidence remains traceable.`],
        assertionType: 'fact' as const,
        confidence: 'medium' as const,
        sourceFindingRefs: [predecessor.id],
        uncertainty: null,
      };
    }),
    uncertainties: [],
  }, {
    runId,
    unit: input.unit,
    materialKinds: input.materialKinds,
    verifiedFindings: materialFindingMap(input.verifiedFindings),
    coveredUnitIds: input.coveredUnitIds,
    coveredChapterIds: input.coveredChapterIds,
  });
}

interface MaterialReductionFixtureInput {
  unit: ReferenceDeconstructionWorkUnit;
  materialKinds: readonly ReferenceStoryMaterialKind[];
  verifiedFindings: readonly ReferenceStoryMaterialFinding[];
  coveredUnitIds: readonly string[];
  coveredChapterIds: readonly string[];
}

function requireMaterialFinding(
  findings: readonly ReferenceStoryMaterialFinding[],
  materialKind: ReferenceStoryMaterialKind,
): ReferenceStoryMaterialFinding {
  const finding = findings.find((candidate) =>
    candidate.track === 'storyMaterial'
    && candidate.materialKind === materialKind);
  if (!finding) throw new Error(`Missing ${materialKind} Story Material fixture finding.`);
  return finding;
}

function materialFindingMap(findings: readonly ReferenceStoryMaterialFinding[]) {
  return Object.fromEntries(findings.map((finding) => [finding.id, finding]));
}

function findingMap(findings: readonly ReferenceDeconstructionFinding[]) {
  return Object.fromEntries(findings.map((finding) => [finding.id, finding]));
}

async function rewriteReferenceSourceIdentity(
  workspaceRoot: string,
  referenceId: string,
): Promise<{
  previousChecksumSha256: string;
  checksumSha256: string;
}> {
  const bundleRoot = join(workspaceRoot, 'examples', 'references', referenceId);
  const sourcePath = join(bundleRoot, 'sources', 'original.txt');
  const sourceText = await readFile(sourcePath, 'utf-8');
  const changedSourceText = sourceText.replace('雨夜里', '雪夜里');
  if (changedSourceText === sourceText) {
    throw new Error('Reference source fixture does not contain the expected drift marker.');
  }
  const previousChecksumSha256 = sha256Fixture(sourceText);
  const checksumSha256 = sha256Fixture(changedSourceText);

  await writeFile(sourcePath, changedSourceText, 'utf-8');
  await replaceYamlChecksum(
    join(bundleRoot, 'metadata.yaml'),
    /^(checksumSha256:\s*)[a-f0-9]{64}$/mu,
    previousChecksumSha256,
    checksumSha256,
  );
  await replaceYamlChecksum(
    join(bundleRoot, 'sources', 'source-manifest.yaml'),
    /^(checksumSha256:\s*)[a-f0-9]{64}$/mu,
    previousChecksumSha256,
    checksumSha256,
  );
  await replaceYamlChecksum(
    join(bundleRoot, 'deconstruction-manifest.yaml'),
    /^(sourceChecksumSha256:\s*)[a-f0-9]{64}$/mu,
    previousChecksumSha256,
    checksumSha256,
  );
  await replaceYamlScalar(
    join(bundleRoot, 'deconstruction-manifest.yaml'),
    /^(status:\s*)completed$/mu,
    'completed',
    'stale',
  );
  await replaceYamlChecksum(
    join(workspaceRoot, 'examples', 'references.yaml'),
    /^(\s+checksumSha256:\s*)[a-f0-9]{64}$/mu,
    previousChecksumSha256,
    checksumSha256,
  );
  return { previousChecksumSha256, checksumSha256 };
}

async function replaceYamlChecksum(
  path: string,
  pattern: RegExp,
  expectedChecksumSha256: string,
  checksumSha256: string,
): Promise<void> {
  const current = await readFile(path, 'utf-8');
  const matched = current.match(pattern)?.[0];
  if (!matched?.endsWith(expectedChecksumSha256)) {
    throw new Error(`Reference source checksum fixture is stale: ${path}`);
  }
  const updated = current.replace(pattern, `$1${checksumSha256}`);
  if (updated === current) {
    throw new Error(`Reference source checksum fixture was not updated: ${path}`);
  }
  await writeFile(path, updated, 'utf-8');
}

async function replaceYamlScalar(
  path: string,
  pattern: RegExp,
  expectedValue: string,
  value: string,
): Promise<void> {
  const current = await readFile(path, 'utf-8');
  const matched = current.match(pattern)?.[0];
  if (!matched?.endsWith(expectedValue)) {
    throw new Error(`Reference YAML scalar fixture is stale: ${path}`);
  }
  const updated = current.replace(pattern, `$1${value}`);
  if (updated === current) {
    throw new Error(`Reference YAML scalar fixture was not updated: ${path}`);
  }
  await writeFile(path, updated, 'utf-8');
}

function sha256Fixture(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function createOanWorkspace(): Promise<string> {
  const root = await createTemporaryRoot();
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await writeFile(
    join(root, '.oan/config.yaml'),
    [
      'version: 1',
      'novelName: backend-full-sample',
      'git:',
      '  autoCommitOnAccept: false',
      '',
    ].join('\n'),
    'utf-8',
  );
  await writeFile(
    join(root, '.oan/workflow.yaml'),
    'name: lightnovel\nsteps:\n  - chapter\n',
    'utf-8',
  );
  await writeFile(join(root, 'chapters/0001/0001.md'), '# 第一章\n\n正文。\n', 'utf-8');
  await initializeGitRepository(root);
  return root;
}

async function initializeGitRepository(workspaceRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: workspaceRoot,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], {
    cwd: workspaceRoot,
  });
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
}

async function materializePendingAction(
  workspaceRoot: string,
  actionId: string,
): Promise<void> {
  const store = await createPendingActionStore({ workspaceRoot });
  const materializer = createChangeMaterializer({
    store,
    assertOriginFresh(action) {
      expect(action.origin?.kind).toBe('referenceDeconstructionPublish');
    },
  });
  await materializer.accept({ actionId, autoCommitOnAccept: false });
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

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
