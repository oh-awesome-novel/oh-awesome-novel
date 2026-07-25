import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  ReferenceDeconstructionConflictError,
  ReferenceDeconstructionValidationError,
  approveReferenceFullDeconstruction,
  cancelReferenceDeconstructionRun,
  completeReferenceQuickPreview,
  createReferenceDeconstructionRun,
  createReferenceEvidencePointerMap,
  createReferenceProgressProjection,
  createReferenceQuickPreviewSelection,
  importReferenceWork,
  inspectReferenceWorkReadiness,
  listReferenceWorks,
  normalizeReferenceQuickPreviewModelOutput,
  projectReferenceDeconstructionRunForTransport,
  readReferenceDeconstructionRun,
  readReferenceDeconstructionRunRequest,
  readReferencePreviewSource,
  reconcileReferenceDeconstructionRun,
  resolveReferenceDeconstructionRunArtifactPath,
  reserveReferenceQuickPreview,
  selectReferenceContext,
  setReferenceEnabled,
} from '@oh-awesome-novel/core';
import type {
  ReferenceDeconstructionManifest,
  ReferenceQuickPreviewSelection,
} from '@oh-awesome-novel/core';

describe('reference deconstruction run store', () => {
  it('persists idempotent create/advance/complete/approve with one revision per command', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-preview-001',
      runId: 'preview-run-001',
      now: '2026-07-22T00:00:00.000Z',
    });
    expect(created).toMatchObject({
      replayed: false,
      run: { revision: 0, status: 'created' },
      receipt: { resultingRunRevision: 0, resultStatus: 'created' },
    });

    await expect(createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-preview-001',
      now: '2026-07-22T00:00:00.000Z',
    })).resolves.toMatchObject({
      replayed: true,
      run: { runId: 'preview-run-001', revision: 0 },
    });

    await expect(createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-preview-002',
    })).rejects.toMatchObject({
      conflictCode: 'activeRunExists',
    });

    const reserved = await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-preview-001',
      now: '2026-07-22T00:01:00.000Z',
    });
    expect(reserved.run).toMatchObject({ revision: 1, status: 'previewRunning' });
    expect(reserved.run.activeReservation?.id).toEqual(expect.any(String));

    const preview = createPreview(fixture.selection, created.run.runId);
    const completed = await completeReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      reservationId: reserved.run.activeReservation!.id,
      preview,
      now: '2026-07-22T00:02:00.000Z',
    });
    expect(completed).toMatchObject({
      revision: 1,
      status: 'awaitingFullApproval',
      mutationReceipts: [
        { resultingRunRevision: 0, resultStatus: 'created' },
        { resultingRunRevision: 1, resultStatus: 'awaitingFullApproval' },
      ],
    });
    expect(completed.activeReservation).toBeUndefined();

    const transport = projectReferenceDeconstructionRunForTransport(completed);
    expect(transport).toMatchObject({
      schemaVersion: 1,
      id: created.run.runId,
      runRevision: 1,
      pipelineVersion: 1,
      capabilityVersion: 'novel.deconstruct_reference@1',
      selectedChapterIds: fixture.selection.selectedChapterIds,
    });
    expect(transport).not.toHaveProperty('selection');
    expect(transport).not.toHaveProperty('activeReservation');

    const approved = await approveReferenceFullDeconstruction({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      idempotencyKey: 'approve-preview-001',
      now: '2026-07-22T00:03:00.000Z',
    });
    expect(approved.run).toMatchObject({
      revision: 2,
      status: 'fullApproved',
      fullApprovedAt: '2026-07-22T00:03:00.000Z',
    });
    expect(approved.run.mutationReceipts).toHaveLength(3);
    await writeFile(fixture.originalPath, `${fixture.sourceText}\nchanged after approval`, 'utf-8');
    const staleApproved = await readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
      { reconcile: true },
    );
    expect(staleApproved.status).toBe('stale');
    expect(staleApproved.fullApprovedAt).toBe('2026-07-22T00:03:00.000Z');
    expect(staleApproved.preview?.diagnostics).toEqual(staleApproved.diagnostics);
    expect(projectReferenceDeconstructionRunForTransport(staleApproved).preview?.diagnostics)
      .toEqual(staleApproved.diagnostics);

    const publishedManifest = parse(await readFile(
      join(
        fixture.workspaceRoot,
        'examples',
        'references',
        fixture.referenceId,
        'deconstruction-manifest.yaml',
      ),
      'utf-8',
    )) as { status: string };
    expect(publishedManifest.status).toBe('notAnalyzed');
  });

  it('persists explicit confirmation before accepting a low-confidence detected range', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-low-confidence-'));
    const sourceText = 'An undelimited opening sample without deterministic chapter headings.';
    const imported = await importReferenceWork({
      workspaceRoot,
      title: 'Low Confidence Reference',
      sourceText,
      rights: 'owned',
    });
    const source = await readReferencePreviewSource(workspaceRoot, imported.reference.id);
    expect(source.sourceManifest.detectedStructure.confidence).toBe('low');
    const selection = createReferenceQuickPreviewSelection({
      referenceId: imported.reference.id,
      sourceText: source.sourceText,
      sourceChecksumSha256: source.sourceManifest.checksumSha256,
      structureFingerprint: source.sourceManifest.structureFingerprint,
      chapters: source.sourceManifest.detectedStructure.chapters,
    });
    const baseInput = {
      workspaceRoot,
      referenceId: imported.reference.id,
      sourceChecksumSha256: selection.sourceChecksumSha256,
      structureFingerprint: selection.structureFingerprint,
      structureConfidence: 'low' as const,
      selection,
      baseRunRevision: 0 as const,
      idempotencyKey: 'create-low-confidence-preview',
      runId: 'preview-run-low-confidence',
    };

    await expect(createReferenceDeconstructionRun({
      ...baseInput,
      rangeConfirmed: false,
    })).rejects.toThrow('require explicit range confirmation');

    const created = await createReferenceDeconstructionRun({
      ...baseInput,
      rangeConfirmed: true,
    });
    await expect(readReferenceDeconstructionRunRequest(
      workspaceRoot,
      imported.reference.id,
      created.run.runId,
    )).resolves.toMatchObject({
      structureConfidence: 'low',
      rangeConfirmed: true,
    });
  });

  it('reconciles running calls to interrupted and source drift to stale', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-reconcile-001',
      runId: 'preview-run-reconcile',
    });
    await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-reconcile-001',
    });
    const interrupted = await reconcileReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
      '2026-07-22T01:00:00.000Z',
    );
    expect(interrupted).toMatchObject({
      revision: 1,
      status: 'interrupted',
    });
    expect(interrupted.mutationReceipts[1]).toMatchObject({
      resultingRunRevision: 1,
      resultStatus: 'interrupted',
    });

    await writeFile(fixture.originalPath, `${fixture.sourceText}\nsource drift`, 'utf-8');
    const stale = await readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
      { reconcile: true, now: '2026-07-22T01:01:00.000Z' },
    );
    expect(stale.status).toBe('stale');
    expect(stale.diagnostics).toContainEqual(expect.objectContaining({
      code: 'source.stale',
      blocking: true,
      evidenceRefs: [],
    }));
  });

  it('reconciles source drift before replaying an active-chain mutation receipt', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-drift-replay',
      runId: 'preview-run-drift-replay',
    });
    const reserved = await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-drift-replay',
    });
    const completed = await completeReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      reservationId: reserved.run.activeReservation!.id,
      preview: createPreview(fixture.selection, created.run.runId),
    });
    await writeFile(fixture.originalPath, `${fixture.sourceText}\nsource drift`, 'utf-8');

    const replay = await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-drift-replay',
    });
    expect(replay).toMatchObject({
      replayed: true,
      run: { revision: completed.revision, status: 'stale' },
      receipt: {
        idempotencyKey: 'advance-drift-replay',
        resultingRunRevision: completed.revision,
        resultStatus: 'stale',
      },
    });
    expect(replay.run.preview?.diagnostics).toEqual(replay.run.diagnostics);
  });

  it('rejects tampered normalized previews before writing provisional artifacts', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-invalid-preview',
      runId: 'preview-run-invalid',
    });
    const reserved = await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-invalid-preview',
    });
    const preview = createPreview(fixture.selection, created.run.runId);
    preview.coverage.citedPointerCount = 999;

    await expect(completeReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      reservationId: reserved.run.activeReservation!.id,
      preview,
    })).rejects.toBeInstanceOf(ReferenceDeconstructionValidationError);
    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
    )).resolves.toMatchObject({ status: 'previewRunning', revision: 1 });
  });

  it('rejects a shadow request whose source window is not backed by its pointer', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-tampered-request',
      runId: 'preview-run-tampered-request',
    });
    const requestPath = join(
      fixture.workspaceRoot,
      '.workspace',
      'sessions',
      created.run.runId,
      'reference-deconstruction',
      'request.yaml',
    );
    const request = parse(await readFile(requestPath, 'utf-8')) as {
      selection: { windows: Array<{ content: string }> };
    };
    request.selection.windows[0]!.content = '#'.repeat(
      request.selection.windows[0]!.content.length,
    );
    await writeFile(requestPath, stringify(request), 'utf-8');

    await expect(readReferenceDeconstructionRunRequest(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
    )).rejects.toBeInstanceOf(ReferenceDeconstructionValidationError);
  });

  it('rejects a source-valid chapter swap that is not authorized by run state', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-swapped-request',
      runId: 'preview-run-swapped-request',
    });
    const source = await readReferencePreviewSource(
      fixture.workspaceRoot,
      fixture.referenceId,
    );
    const alternateChapterId = source.sourceManifest.detectedStructure.chapters.at(-1)!.id;
    const alternateSelection = createReferenceQuickPreviewSelection({
      referenceId: fixture.referenceId,
      sourceText: source.sourceText,
      sourceChecksumSha256: source.sourceManifest.checksumSha256,
      structureFingerprint: source.sourceManifest.structureFingerprint,
      chapters: source.sourceManifest.detectedStructure.chapters,
    }, { selectedChapterIds: [alternateChapterId] });
    expect(alternateSelection.selectedChapterIds).not.toEqual(
      fixture.selection.selectedChapterIds,
    );
    const requestPath = join(
      fixture.workspaceRoot,
      '.workspace',
      'sessions',
      created.run.runId,
      'reference-deconstruction',
      'request.yaml',
    );
    const request = parse(await readFile(requestPath, 'utf-8')) as {
      selection: ReferenceQuickPreviewSelection;
    };
    request.selection = alternateSelection;
    await writeFile(requestPath, stringify(request), 'utf-8');

    await expect(readReferenceDeconstructionRunRequest(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
    )).rejects.toThrow('authoritative run state');
  });

  it('rejects persisted lifecycle invariants that were manually desynchronized', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-lifecycle-tamper',
      runId: 'preview-run-lifecycle-tamper',
    });
    const reserved = await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-lifecycle-tamper',
    });
    await completeReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      reservationId: reserved.run.activeReservation!.id,
      preview: createPreview(fixture.selection, created.run.runId),
    });
    const statePath = join(
      fixture.workspaceRoot,
      '.workspace',
      'sessions',
      created.run.runId,
      'reference-deconstruction',
      'run-state.yaml',
    );
    const state = parse(await readFile(statePath, 'utf-8')) as {
      status: string;
      fullApprovedAt?: string;
      diagnostics: unknown[];
      preview?: { diagnostics: unknown[] };
    };
    state.fullApprovedAt = '2026-07-22T03:00:00.000Z';
    await writeFile(statePath, stringify(state), 'utf-8');

    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
    )).rejects.toBeInstanceOf(ReferenceDeconstructionValidationError);

    delete state.fullApprovedAt;
    state.preview!.diagnostics = [{
      id: 'manually-desynchronized',
      code: 'preview.manualTamper',
      severity: 'warning',
      blocking: false,
      message: 'This diagnostic exists only inside the preview.',
      evidenceRefs: [],
      stageId: 'quickPreview',
    }];
    await writeFile(statePath, stringify(state), 'utf-8');
    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
    )).rejects.toBeInstanceOf(ReferenceDeconstructionValidationError);
  });

  it('rejects a symlinked run artifact directory without writing outside workspace', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-run-directory-symlink',
      runId: 'preview-run-directory-symlink',
    });
    const reserved = await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-run-directory-symlink',
    });
    const artifactDirectory = join(
      fixture.workspaceRoot,
      '.workspace',
      'sessions',
      created.run.runId,
      'reference-deconstruction',
    );
    await rename(artifactDirectory, `${artifactDirectory}-safe-backup`);
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'oan-run-outside-'));
    await symlink(outsideDirectory, artifactDirectory, 'dir');

    await expect(readReferenceDeconstructionRun(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
    )).rejects.toThrow('non-symlink directories');
    await expect(reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      idempotencyKey: 'advance-run-directory-symlink-again',
    })).rejects.toThrow('non-symlink directories');
    await expect(completeReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      reservationId: reserved.run.activeReservation!.id,
      preview: createPreview(fixture.selection, created.run.runId),
    })).rejects.toThrow('non-symlink directories');
    expect(await readdir(outsideDirectory)).toEqual([]);
  });

  it('rejects symlinked run artifact files and exposes a safe lease resolver', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-artifact-symlink',
      runId: 'preview-run-artifact-symlink',
    });
    const artifactDirectory = join(
      fixture.workspaceRoot,
      '.workspace',
      'sessions',
      created.run.runId,
      'reference-deconstruction',
    );
    const requestPath = join(artifactDirectory, 'request.yaml');
    await rename(requestPath, join(artifactDirectory, 'request.safe-backup.yaml'));
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'oan-artifact-outside-'));
    const outsideRequest = join(outsideDirectory, 'request.yaml');
    const outsideContent = 'outside: unchanged\n';
    await writeFile(outsideRequest, outsideContent, 'utf-8');
    await symlink(outsideRequest, requestPath);

    await expect(readReferenceDeconstructionRunRequest(
      fixture.workspaceRoot,
      fixture.referenceId,
      created.run.runId,
    )).rejects.toThrow('regular non-symlink file');
    await expect(readFile(outsideRequest, 'utf-8')).resolves.toBe(outsideContent);

    const leasePath = await resolveReferenceDeconstructionRunArtifactPath(
      fixture.workspaceRoot,
      created.run.runId,
      'provider-lease.json',
      { createDirectory: true },
    );
    expect(leasePath).toBe(join(artifactDirectory, 'provider-lease.json'));
    await expect(resolveReferenceDeconstructionRunArtifactPath(
      fixture.workspaceRoot,
      created.run.runId,
      '../outside',
    )).rejects.toBeInstanceOf(ReferenceDeconstructionValidationError);
  });

  it('keeps a blocking copy-risk preview reviewable but refuses full approval', async () => {
    const fixture = await createReferenceFixture();
    const created = await createReferenceDeconstructionRun({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      sourceChecksumSha256: fixture.selection.sourceChecksumSha256,
      structureFingerprint: fixture.selection.structureFingerprint,
      structureConfidence: 'high',
      rangeConfirmed: false,
      selection: fixture.selection,
      baseRunRevision: 0,
      idempotencyKey: 'create-copy-risk-preview',
      runId: 'preview-run-copy-risk',
    });
    const reserved = await reserveReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 0,
      idempotencyKey: 'advance-copy-risk-preview',
    });
    const copiedOverview = fixture.selection.windows[0]!.content;
    expect(copiedOverview.length).toBeGreaterThan(80);
    const preview = createPreview(fixture.selection, created.run.runId, copiedOverview);
    expect(preview.diagnostics).toContainEqual(expect.objectContaining({
      code: 'copyRisk.exactOverlap',
      blocking: true,
    }));
    await completeReferenceQuickPreview({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      reservationId: reserved.run.activeReservation!.id,
      preview,
    });

    await expect(approveReferenceFullDeconstruction({
      workspaceRoot: fixture.workspaceRoot,
      referenceId: fixture.referenceId,
      runId: created.run.runId,
      baseRunRevision: 1,
      idempotencyKey: 'approve-copy-risk-preview',
    })).rejects.toBeInstanceOf(ReferenceDeconstructionValidationError);
  });
});

describe('reference readiness gate', () => {
  it('includes only current quality-passed context and applies the first-item budget hard cap', async () => {
    const fixture = await createReferenceFixture();
    const bundleRoot = join(
      fixture.workspaceRoot,
      'examples',
      'references',
      fixture.referenceId,
    );
    const manifestPath = join(bundleRoot, 'deconstruction-manifest.yaml');
    const manifest = parse(await readFile(manifestPath, 'utf-8')) as ReferenceDeconstructionManifest;
    const summary = await readFile(join(bundleRoot, 'context', 'reference-summary.md'), 'utf-8');
    const aggregate = 'aggregate: ready\n';
    await mkdir(join(bundleRoot, 'deconstruction'));
    await writeFile(join(bundleRoot, 'deconstruction', 'aggregate.yaml'), aggregate, 'utf-8');
    const doNotCopy = await readFile(join(bundleRoot, 'distilled', 'do-not-copy.md'), 'utf-8');
    manifest.status = 'completed';
    manifest.qualityStatus = 'passed';
    manifest.publishedRunId = 'published-run-001';
    manifest.publishedAt = '2026-07-22T02:00:00.000Z';
    for (const stage of Object.values(manifest.stages)) stage.status = 'completed';
    manifest.outputs = [
      {
        kind: 'deconstruction',
        path: 'deconstruction/aggregate.yaml',
        checksumSha256: sha256(aggregate),
      },
      {
        kind: 'distilled',
        path: 'distilled/do-not-copy.md',
        checksumSha256: sha256(doNotCopy),
      },
      {
        kind: 'context',
        path: 'context/reference-summary.md',
        checksumSha256: sha256(summary),
      },
    ];
    await writeFile(manifestPath, stringify(manifest), 'utf-8');
    await writeFile(
      join(bundleRoot, 'progress.yaml'),
      stringify(createReferenceProgressProjection(manifest, manifest.publishedAt)),
      'utf-8',
    );

    await expect(inspectReferenceWorkReadiness(
      fixture.workspaceRoot,
      fixture.referenceId,
    )).resolves.toMatchObject({
      status: 'completed',
      contextEligible: true,
      reason: 'ready',
    });

    const tooSmall = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      tokenBudget: 1,
    });
    expect(tooSmall.included).toEqual([]);
    expect(tooSmall.omitted).toContainEqual(expect.objectContaining({
      id: fixture.referenceId,
      reasonCode: 'tokenBudgetExceeded',
      contextEligible: false,
    }));

    const selected = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      tokenBudget: 2_000,
      explicitReferenceIds: [fixture.referenceId],
    });
    expect(selected.included).toContainEqual(expect.objectContaining({
      id: fixture.referenceId,
      deconstructionStatus: 'completed',
      contextEligible: true,
      reasonCode: 'ready',
    }));

    const disabled = await setReferenceEnabled(
      fixture.workspaceRoot,
      fixture.referenceId,
      false,
    );
    expect(disabled).toMatchObject({
      enabled: false,
      deconstructionStatus: 'completed',
      contextEligible: false,
      readinessReason: 'disabled',
      progress: { status: 'completed', contextEligible: false },
    });
    await expect(listReferenceWorks(fixture.workspaceRoot)).resolves.toEqual([
      expect.objectContaining({
        enabled: false,
        contextEligible: false,
        progress: expect.objectContaining({ contextEligible: false }),
      }),
    ]);
  });

  it('fails closed after source drift', async () => {
    const fixture = await createReferenceFixture();
    await writeFile(fixture.originalPath, `${fixture.sourceText}\nmanual edit`, 'utf-8');

    await expect(inspectReferenceWorkReadiness(
      fixture.workspaceRoot,
      fixture.referenceId,
    )).resolves.toMatchObject({
      status: 'stale',
      contextEligible: false,
      reason: 'stale',
    });
    const selection = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      explicitReferenceIds: [fixture.referenceId],
    });
    expect(selection.included).toEqual([]);
    expect(selection.omitted).toContainEqual(expect.objectContaining({
      reasonCode: 'stale',
    }));
  });

  it('omits a forged completed manifest whose frozen pipeline is incomplete', async () => {
    const fixture = await createReferenceFixture();
    const bundleRoot = join(
      fixture.workspaceRoot,
      'examples',
      'references',
      fixture.referenceId,
    );
    const manifestPath = join(bundleRoot, 'deconstruction-manifest.yaml');
    const manifest = parse(await readFile(manifestPath, 'utf-8')) as ReferenceDeconstructionManifest;
    const summary = await readFile(join(bundleRoot, 'context', 'reference-summary.md'), 'utf-8');
    manifest.status = 'completed';
    manifest.qualityStatus = 'passed';
    manifest.publishedRunId = 'forged-published-run';
    manifest.publishedAt = '2026-07-22T04:00:00.000Z';
    manifest.outputs = [{
      kind: 'context',
      path: 'context/reference-summary.md',
      checksumSha256: sha256(summary),
    }];
    await writeFile(manifestPath, stringify(manifest), 'utf-8');
    await writeFile(
      join(bundleRoot, 'progress.yaml'),
      stringify(createReferenceProgressProjection(manifest, manifest.publishedAt)),
      'utf-8',
    );

    await expect(inspectReferenceWorkReadiness(
      fixture.workspaceRoot,
      fixture.referenceId,
    )).resolves.toMatchObject({
      status: 'needsRebuild',
      contextEligible: false,
      reason: 'needsRebuild',
    });
    const selection = await selectReferenceContext({
      workspaceRoot: fixture.workspaceRoot,
      explicitReferenceIds: [fixture.referenceId],
    });
    expect(selection.included).toEqual([]);
    expect(selection.omitted).toContainEqual(expect.objectContaining({
      id: fixture.referenceId,
      reasonCode: 'needsRebuild',
    }));
  });

  it('fails closed when the index, metadata, or bundle realpath identity is tampered', async () => {
    const metadataFixture = await createReferenceFixture();
    const metadataPath = join(
      metadataFixture.workspaceRoot,
      'examples',
      'references',
      metadataFixture.referenceId,
      'metadata.yaml',
    );
    const metadata = parse(await readFile(metadataPath, 'utf-8')) as { id: string };
    metadata.id = 'different-reference-id';
    await writeFile(metadataPath, stringify(metadata), 'utf-8');
    await expect(setReferenceEnabled(
      metadataFixture.workspaceRoot,
      metadataFixture.referenceId,
      false,
    )).rejects.toThrow('identities do not match');

    const symlinkFixture = await createReferenceFixture();
    const bundleRoot = join(
      symlinkFixture.workspaceRoot,
      'examples',
      'references',
      symlinkFixture.referenceId,
    );
    const outsideRoot = await mkdtemp(join(tmpdir(), 'oan-reference-outside-'));
    const outsideBundle = join(outsideRoot, symlinkFixture.referenceId);
    await rename(bundleRoot, outsideBundle);
    await symlink(outsideBundle, bundleRoot, 'dir');
    await expect(readReferencePreviewSource(
      symlinkFixture.workspaceRoot,
      symlinkFixture.referenceId,
    )).rejects.toThrow('outside its workspace');
    await expect(setReferenceEnabled(
      symlinkFixture.workspaceRoot,
      symlinkFixture.referenceId,
      false,
    )).rejects.toThrow('safe directory');
  });
});

async function createReferenceFixture(): Promise<{
  workspaceRoot: string;
  referenceId: string;
  sourceText: string;
  originalPath: string;
  selection: ReferenceQuickPreviewSelection;
}> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-reference-run-'));
  const sourceText = [
    'Chapter 1 Opening',
    'A concrete question appears and remains unresolved while pressure rises through several distinct beats and delayed answers.',
    '',
    'Chapter 2 Pressure',
    'The cost of delay becomes visible.',
    '',
    'Chapter 3 Turn',
    'A choice changes the immediate direction.',
  ].join('\n');
  const imported = await importReferenceWork({
    workspaceRoot,
    title: 'Reference Store Fixture',
    sourceText,
    rights: 'owned',
  });
  const source = await readReferencePreviewSource(workspaceRoot, imported.reference.id);
  const selection = createReferenceQuickPreviewSelection({
    referenceId: imported.reference.id,
    sourceText: source.sourceText,
    sourceChecksumSha256: source.sourceManifest.checksumSha256,
    structureFingerprint: source.sourceManifest.structureFingerprint,
    chapters: source.sourceManifest.detectedStructure.chapters,
  });
  return {
    workspaceRoot,
    referenceId: imported.reference.id,
    sourceText,
    originalPath: join(
      workspaceRoot,
      imported.reference.bundlePath,
      'sources',
      imported.manifest.originalFile,
    ),
    selection,
  };
}

function createPreview(
  selection: ReferenceQuickPreviewSelection,
  runId: string,
  sourceOverview = 'The opening creates a clear reader question and controlled escalation.',
) {
  const pointerId = selection.windows[0]!.pointerId;
  return normalizeReferenceQuickPreviewModelOutput({
    sourceOverview,
    chapterPreviews: selection.selectedChapterIds.map((chapterId) => ({
      chapterId,
      summary: `Chapter ${chapterId} advances the opening pressure.`,
      evidenceRefs: [selection.windows.find((window) =>
        window.pointer.chapterId === chapterId)!.pointerId],
      confidence: 'high',
      uncertainty: null,
    })),
    findings: [{
      kind: 'hook',
      observation: 'A bounded question precedes its answer.',
      technique: 'Use a concrete uncertainty with a near-term promise.',
      whenUseful: null,
      avoid: null,
      confidence: 'high',
      evidenceRefs: [pointerId],
      generalInference: false,
      uncertainty: null,
    }],
    borrowablePatterns: [{
      title: 'Concrete delayed answer',
      technique: 'State a visible question while delaying the response.',
      whenUseful: null,
      evidenceRefs: [pointerId],
      confidence: 'high',
    }],
    doNotCopy: ['Do not copy prose, names, dialogue, or scene execution.'],
    differentiationRequirements: ['Change the premise, cast, setting, and causal sequence.'],
    differentiationPrompts: ['What different conflict could create the same reader function?'],
    canonContaminationWarnings: ['Reference events are not current novel canon.'],
    confidence: 'high',
    uncertainties: [],
  }, {
    runId,
    referenceId: selection.referenceId,
    sourceChecksumSha256: selection.sourceChecksumSha256,
    selectedChapterIds: selection.selectedChapterIds,
    allowedPointers: createReferenceEvidencePointerMap(selection),
    sourceWindows: selection.windows,
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
