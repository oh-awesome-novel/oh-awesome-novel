import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  startNovelHttpBackend,
  type NovelBackendHandle,
} from '@oh-awesome-novel/backend';
import { afterEach, describe, expect, it } from 'vitest';

const workspaces: string[] = [];
const backends: NovelBackendHandle[] = [];

const canonicalTargets = {
  chapterDraft: 'chapters/0001/0001.md',
  state: 'state/play-adoption.yaml',
  timeline: 'timeline/events.yaml',
  foreshadow: 'foreshadow/active.yaml',
} as const;

type AdoptionTarget = keyof typeof canonicalTargets;

afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close();
  for (const workspace of workspaces.splice(0)) {
    await rm(workspace, { recursive: true, force: true });
  }
});

describe('evidence-backed Play adoption preview transport', () => {
  it('rebuilds event, observation, and outcome seeds and previews all real targets without canonical writes', async () => {
    const harness = await createSettledHarness();
    const visibleEvent = harness.session.events.find((event) =>
      event.visibility === 'playerVisible')!;
    const observation = harness.session.observations[0]!;
    const outcome = await createOutcomeReport(harness);
    const outcomeItem = outcome.report.items.find((item) =>
      item.visibility === 'playerVisible'
      && item.eventRefs.includes(visibleEvent.id))!;
    expect(outcomeItem).toBeDefined();

    const seeds: AdoptionSeed[] = [{
      kind: 'event',
      eventId: visibleEvent.id,
    }, {
      kind: 'observation',
      observationId: observation.id,
    }, {
      kind: 'outcome',
      outcomeItemId: outcomeItem.id,
      outcomeReportFingerprint: outcome.reportFingerprint,
    }];

    for (const seed of seeds) {
      const created = await createPreview(harness, {
        projection: 'director',
        seed,
      });
      expect(created.response.status).toBe(200);
      expect(created.body.preview).toMatchObject({
        schemaVersion: 1,
        sessionId: harness.session.id,
        baseRevision: 1,
        projection: 'director',
        seed,
        canonicalUnchanged: true,
      });
      expect(created.body.preview.evidenceClosure.sessionRevision).toBe(1);
      expect(created.body.preview.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(created.body.preview.suggestions.map((item) => item.target)).toEqual([
        'chapterDraft',
        'state',
        'timeline',
        'foreshadow',
      ]);
    }

    const before = await readCanonicalTargets(harness.workspaceRoot);
    const previews = new Map<AdoptionTarget, AdoptionPreview>();
    for (const target of Object.keys(canonicalTargets) as AdoptionTarget[]) {
      const created = await createPreview(harness, {
        projection: 'director',
        seed: { kind: 'event', eventId: visibleEvent.id },
        target,
      });
      expect(created.response.status).toBe(200);
      const preview = created.body.preview;
      previews.set(target, preview);
      expect(preview).toMatchObject({
        target,
        touchedFiles: [canonicalTargets[target]],
        canonicalUnchanged: true,
      });
      expect(preview.id).toMatch(/^pa_[0-9a-f-]+$/iu);
      expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(preview.diff).toContain(`b/${canonicalTargets[target]}`);
      expect(preview.diff).toContain(visibleEvent.summary);
    }
    expect(new Set([...previews.values()].map((preview) => preview.id)).size).toBe(4);
    await expect(readCanonicalTargets(harness.workspaceRoot)).resolves.toEqual(before);
    await expect(listPendingActions(harness.backend.url)).resolves.toEqual([]);
  });

  it('promotes the exact preview to one candidate and PendingAction idempotently while canonical files stay unchanged', async () => {
    const harness = await createSettledHarness();
    const event = harness.session.events.find((item) =>
      item.visibility === 'playerVisible')!;
    const before = await readCanonicalTargets(harness.workspaceRoot);
    const created = await createPreview(harness, {
      projection: 'director',
      seed: { kind: 'event', eventId: event.id },
      target: 'state',
    });
    expect(created.response.status).toBe(200);
    const preview = created.body.preview;

    const first = await promotePreview(harness, preview);
    expect(first.response.status).toBe(200);
    expect(first.body).toMatchObject({
      sessionUpdate: {
        sessionId: harness.session.id,
        baseRevision: 1,
        revision: 2,
      },
      candidate: {
        id: preview.candidateId,
        seed: preview.seed,
        target: 'state',
        summary: preview.summary,
        evidenceFingerprint: preview.evidenceFingerprint,
        requiresPendingAction: true,
      },
      pendingAction: {
        id: preview.id,
        status: 'pending',
        touchedFiles: preview.touchedFiles,
        diff: preview.diff,
      },
    });
    await expect(readCanonicalTargets(harness.workspaceRoot)).resolves.toEqual(before);

    const repeated = await promotePreview(harness, preview);
    expect(repeated.response.status).toBe(200);
    expect(repeated.body.candidate).toEqual(first.body.candidate);
    expect(repeated.body.pendingAction).toEqual(first.body.pendingAction);
    expect(repeated.body.sessionUpdate.revision).toBe(2);
    await expect(listPendingActions(harness.backend.url)).resolves.toEqual([
      expect.objectContaining({ id: preview.id, status: 'pending' }),
    ]);
    await expect(readCanonicalTargets(harness.workspaceRoot)).resolves.toEqual(before);

    const rejected = await requestJson<{ status: string }>(
      `${harness.backend.url}/api/workspace/pending-actions/${preview.id}/reject`,
      { method: 'POST' },
    );
    expect(rejected.response.status).toBe(200);
    expect(rejected.body.status).toBe('rejected');
    const afterDecision = await promotePreview(harness, preview);
    expect(afterDecision.response.status).toBe(409);
    expect(afterDecision.body).toMatchObject({
      code: 'stale_play_adoption_preview',
    });
  });

  it('returns a Player-safe proposal diff and receipt without canonical baseline or recovery internals', async () => {
    const harness = await createSettledHarness();
    const event = harness.session.events.find((item) =>
      item.visibility === 'playerVisible')!;
    const created = await createPreview(harness, {
      projection: 'player',
      seed: { kind: 'event', eventId: event.id },
      target: 'chapterDraft',
    });
    expect(created.response.status).toBe(200);
    expect(created.body.preview.diff).toContain('Player-safe Play adoption proposal');
    expect(created.body.preview.diff).toContain(event.summary);
    expect(created.body.preview.diff).not.toContain('Existing chapter');
    expect(created.body.preview.evidenceClosure).toMatchObject({
      eventRefs: [],
      sourceSnapshots: [],
    });

    const promoted = await promotePreview(harness, created.body.preview);
    expect(promoted.response.status).toBe(200);
    expect(promoted.body).not.toHaveProperty('session');
    expect(promoted.body.pendingAction).not.toHaveProperty('patches');
    expect(promoted.body.pendingAction).not.toHaveProperty('shadowWrites');
    expect(promoted.body.pendingAction.diff).toBe(created.body.preview.diff);
    expect(JSON.stringify(promoted.body)).not.toContain('Existing chapter');
  });

  it('rejects hidden Player roots and caller-forged evidence while allowing a Director preview', async () => {
    const harness = await createSettledHarness();
    const hiddenEvent = harness.session.events.find((event) =>
      event.visibility === 'playerUnknown')!;
    const hiddenSeed: AdoptionSeed = { kind: 'event', eventId: hiddenEvent.id };

    const player = await createPreview(harness, {
      projection: 'player',
      seed: hiddenSeed,
    });
    expect(player.response.status).toBe(422);
    expect(player.body).toMatchObject({ code: 'play_adoption_preview_failed' });
    expect(JSON.stringify(player.body)).not.toContain(hiddenEvent.summary);
    const unknown = await createPreview(harness, {
      projection: 'player',
      seed: { kind: 'event', eventId: 'event-does-not-exist' },
    });
    expect(unknown.response.status).toBe(player.response.status);
    expect(unknown.body).toEqual(player.body);

    const director = await createPreview(harness, {
      projection: 'director',
      seed: hiddenSeed,
    });
    expect(director.response.status).toBe(200);
    expect(director.body.preview).toMatchObject({
      visibility: 'playerUnknown',
      summary: expect.stringContaining(hiddenEvent.summary),
    });

    for (const forged of [
      { summary: 'Caller-forged summary' },
      { evidence: 'Caller-forged evidence' },
      { sourceEventIds: [hiddenEvent.id] },
    ]) {
      const rejected = await requestJson<ErrorResponse>(
        adoptionPreviewUrl(harness),
        {
          method: 'POST',
          body: {
            baseRevision: 1,
            projection: 'director',
            seed: hiddenSeed,
            ...forged,
          },
        },
      );
      expect(rejected.response.status).toBe(400);
      expect(rejected.body.error).toContain('unknown fields');
    }

    const outcome = await createOutcomeReport(harness);
    const outcomeItem = outcome.report.items.find((item) =>
      item.visibility === 'playerVisible')!;
    const staleOutcome = await createPreview(harness, {
      projection: 'director',
      seed: {
        kind: 'outcome',
        outcomeItemId: outcomeItem.id,
        outcomeReportFingerprint: '0'.repeat(64),
      },
    });
    expect(staleOutcome.response.status).toBe(409);
    expect(staleOutcome.body).toMatchObject({
      code: 'stale_play_adoption_preview',
    });

    const visibleEvent = harness.session.events.find((event) =>
      event.visibility === 'playerVisible')!;
    const prepared = await createPreview(harness, {
      projection: 'director',
      seed: { kind: 'event', eventId: visibleEvent.id },
    });
    expect(prepared.response.status).toBe(200);
    const wrongFingerprint = await requestJson<ErrorResponse>(
      `${adoptionPreviewUrl(harness)}/${prepared.body.preview.id}/pending-action`,
      {
        method: 'POST',
        body: { baseRevision: 1, fingerprint: '0'.repeat(64) },
      },
    );
    expect(wrongFingerprint.response.status).toBe(409);
    expect(wrongFingerprint.body).toMatchObject({
      code: 'stale_play_adoption_preview',
    });

    const unknownPromotionField = await requestJson<ErrorResponse>(
      `${adoptionPreviewUrl(harness)}/${prepared.body.preview.id}/pending-action`,
      {
        method: 'POST',
        body: {
          baseRevision: 1,
          fingerprint: prepared.body.preview.fingerprint,
          accept: true,
        },
      },
    );
    expect(unknownPromotionField.response.status).toBe(400);
    await expect(listPendingActions(harness.backend.url)).resolves.toEqual([]);
  });

  it('does not expose malformed canonical YAML through Player preview errors', async () => {
    const harness = await createSettledHarness();
    const event = harness.session.events.find((item) =>
      item.visibility === 'playerVisible')!;
    const secretYaml = 'secret-name: [classified-value\n';
    await writeWorkspaceFile(
      harness.workspaceRoot,
      canonicalTargets.state,
      secretYaml,
    );

    const player = await createPreview(harness, {
      projection: 'player',
      seed: { kind: 'event', eventId: event.id },
      target: 'state',
    });
    expect(player.response.status).toBe(422);
    expect(player.body).toEqual({
      error: 'The Play adoption preview could not be prepared safely.',
      code: 'play_adoption_preview_failed',
    });
    expect(JSON.stringify(player.body)).not.toContain('classified-value');

    const director = await createPreview(harness, {
      projection: 'director',
      seed: { kind: 'event', eventId: event.id },
      target: 'state',
    });
    expect(director.response.status).toBe(422);
    expect(JSON.stringify(director.body)).toContain('classified-value');
  });

  it('invalidates a preview after the session revision advances', async () => {
    const harness = await createSettledHarness();
    const preview = await prepareVisibleEventPreview(harness);
    const advanced = await requestJson<{ session: SessionView }>(
      `${harness.backend.url}/api/workspace/play-sessions/${harness.session.id}/transcript`,
      {
        method: 'POST',
        body: {
          speaker: 'narrator',
          content: 'A later note advances the Play revision.',
          baseRevision: 1,
        },
      },
    );
    expect(advanced.response.status).toBe(200);
    expect(advanced.body.session.revision).toBe(2);

    await expectStalePromotion(harness, preview);
  });

  it('invalidates a preview after Restore selects another branch', async () => {
    const harness = await createSettledHarness({ turnCount: 2 });
    const lastEvent = harness.session.events.find((event) =>
      event.title === 'Visible gate 2')!;
    const created = await createPreview(harness, {
      projection: 'director',
      seed: { kind: 'event', eventId: lastEvent.id },
    });
    expect(created.response.status).toBe(200);
    const restored = await requestJson<{ session: SessionView }>(
      `${harness.backend.url}/api/workspace/play-sessions/${harness.session.id}/checkpoints/turn-artifact-1/restore`,
      { method: 'POST', body: { baseRevision: 2 } },
    );
    expect(restored.response.status).toBe(200);
    expect(restored.body.session).toMatchObject({
      revision: 3,
      selectedTurnIds: ['turn-artifact-1'],
    });

    await expectStalePromotion(harness, created.body.preview);
  });

  it('invalidates a preview after an activated source drifts', async () => {
    const workspaceRoot = await createWorkspace();
    const sourceFile = 'world/gate.md';
    const sourceText = '# Gate\n\nThe public signal is green.\n';
    await writeWorkspaceFile(workspaceRoot, sourceFile, sourceText);
    const harness = await createSettledHarness({
      workspaceRoot,
      activatedSources: [{
        sourceId: 'world-gate',
        path: sourceFile,
        contentHash: sha256(sourceText),
        role: 'world',
        reason: 'World gate evidence',
        budgetLayer: 'L1',
        semanticBoundary: 'compressible',
        trust: 'canonical',
      }],
    });
    const preview = await prepareVisibleEventPreview(harness);
    await writeWorkspaceFile(
      workspaceRoot,
      sourceFile,
      `${sourceText}\nThe signal was externally changed.\n`,
    );

    const stale = await promotePreview(harness, preview);
    expect(stale.response.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'play_launch_source_validation' });
    await expect(listPendingActions(harness.backend.url)).resolves.toEqual([]);
  });

  it('revalidates the Play branch before accepting a promoted PendingAction', async () => {
    const harness = await createSettledHarness({ turnCount: 2 });
    const before = await readCanonicalTargets(harness.workspaceRoot);
    const preview = await prepareVisibleEventPreview(harness, 'state');
    const promoted = await promotePreview(harness, preview);
    expect(promoted.response.status).toBe(200);

    const restored = await requestJson<{ session: SessionView }>(
      `${harness.backend.url}/api/workspace/play-sessions/${harness.session.id}/checkpoints/turn-artifact-1/restore`,
      { method: 'POST', body: { baseRevision: 3 } },
    );
    expect(restored.response.status).toBe(200);
    expect(restored.body.session.revision).toBe(4);

    const staleAccept = await requestJson<ErrorResponse>(
      `${harness.backend.url}/api/workspace/pending-actions/${preview.id}/accept`,
      { method: 'POST' },
    );
    expect(staleAccept.response.status).toBe(409);
    expect(staleAccept.body).toMatchObject({
      code: 'stale_play_adoption_preview',
    });
    await expect(readCanonicalTargets(harness.workspaceRoot)).resolves.toEqual(before);
    await expect(listPendingActions(harness.backend.url)).resolves.toEqual([
      expect.objectContaining({ id: preview.id, status: 'pending' }),
    ]);

    const rejected = await requestJson<{ status: string }>(
      `${harness.backend.url}/api/workspace/pending-actions/${preview.id}/reject`,
      { method: 'POST' },
    );
    expect(rejected.response.status).toBe(200);
    expect(rejected.body.status).toBe('rejected');
  });

  it('revalidates activated source content before accepting a promoted PendingAction', async () => {
    const workspaceRoot = await createWorkspace();
    const sourceFile = 'world/gate-accept.md';
    const sourceText = '# Gate\n\nThe public signal is green.\n';
    await writeWorkspaceFile(workspaceRoot, sourceFile, sourceText);
    const harness = await createSettledHarness({
      workspaceRoot,
      activatedSources: [{
        sourceId: 'world-gate-accept',
        path: sourceFile,
        contentHash: sha256(sourceText),
        role: 'world',
        reason: 'World gate acceptance evidence',
        budgetLayer: 'L1',
        semanticBoundary: 'compressible',
        trust: 'canonical',
      }],
    });
    const before = await readCanonicalTargets(workspaceRoot);
    const preview = await prepareVisibleEventPreview(harness, 'timeline');
    const promoted = await promotePreview(harness, preview);
    expect(promoted.response.status).toBe(200);
    await writeWorkspaceFile(
      workspaceRoot,
      sourceFile,
      `${sourceText}The signal changed after Review.\n`,
    );

    const staleAccept = await requestJson<ErrorResponse>(
      `${harness.backend.url}/api/workspace/pending-actions/${preview.id}/accept`,
      { method: 'POST' },
    );
    expect(staleAccept.response.status).toBe(409);
    expect(staleAccept.body).toMatchObject({
      code: 'play_launch_source_validation',
    });
    await expect(readCanonicalTargets(workspaceRoot)).resolves.toEqual(before);
  });

  it('accepts a current promoted PendingAction and only then changes canonical truth', async () => {
    const harness = await createSettledHarness();
    const before = await readCanonicalTargets(harness.workspaceRoot);
    const preview = await prepareVisibleEventPreview(harness, 'state');
    const promoted = await promotePreview(harness, preview);
    expect(promoted.response.status).toBe(200);
    await expect(readCanonicalTargets(harness.workspaceRoot)).resolves.toEqual(before);

    const accepted = await requestJson<{ status: string; appliedFiles: string[] }>(
      `${harness.backend.url}/api/workspace/pending-actions/${preview.id}/accept`,
      { method: 'POST' },
    );
    expect(accepted.response.status).toBe(200);
    expect(accepted.body).toMatchObject({
      status: 'accepted',
      appliedFiles: [canonicalTargets.state],
    });
    const after = await readCanonicalTargets(harness.workspaceRoot);
    expect(after.state).not.toBe(before.state);
    expect(after.state).toContain(preview.summary);
    await expect(listPendingActions(harness.backend.url)).resolves.toEqual([]);
  });

  it('fails closed when a legacy file-backed activated source has no content hash', async () => {
    const workspaceRoot = await createWorkspace();
    await writeWorkspaceFile(workspaceRoot, 'world/legacy.md', '# Legacy source\n');
    const harness = await createSettledHarness({
      workspaceRoot,
      activatedSources: [{
        sourceId: 'legacy-source',
        path: 'world/legacy.md',
        reason: 'Legacy source without immutable content evidence',
        budgetLayer: 'L1',
        semanticBoundary: 'compressible',
        trust: 'canonical',
      }],
    });
    const event = harness.session.events.find((item) =>
      item.visibility === 'playerVisible')!;
    const rejected = await createPreview(harness, {
      projection: 'player',
      seed: { kind: 'event', eventId: event.id },
    });
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: 'stale_play_adoption_preview',
    });
    expect(JSON.stringify(rejected.body)).not.toContain('legacy-source');
  });

  it('invalidates a preview after its canonical target drifts and does not overwrite it', async () => {
    const harness = await createSettledHarness();
    const preview = await prepareVisibleEventPreview(harness, 'state');
    const statePath = join(harness.workspaceRoot, canonicalTargets.state);
    const external = 'evidence:\n  external: changed-after-preview\n';
    await writeFile(statePath, external, 'utf-8');

    const stale = await promotePreview(harness, preview);
    expect(stale.response.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'stale_play_adoption_preview' });
    await expect(readFile(statePath, 'utf-8')).resolves.toBe(external);
    await expect(listPendingActions(harness.backend.url)).resolves.toEqual([]);
    const current = await requestJson<{ session: SessionView }>(
      `${harness.backend.url}/api/workspace/play-sessions/${harness.session.id}`,
    );
    expect(current.body.session.revision).toBe(1);
    expect(current.body.session.adoptionCandidates).toEqual([]);
  });
});

type AdoptionSeed =
  | { kind: 'event'; eventId: string }
  | { kind: 'observation'; observationId: string }
  | {
      kind: 'outcome';
      outcomeItemId: string;
      outcomeReportFingerprint: string;
    };

interface SessionView {
  id: string;
  revision: number;
  selectedTurnIds: string[];
  events: Array<{
    id: string;
    title: string;
    summary: string;
    visibility: string;
  }>;
  observations: Array<{ id: string; summary: string; evidence: string }>;
  adoptionCandidates: Array<Record<string, unknown>>;
}

interface AdoptionPreview {
  id: string;
  sessionId: string;
  baseRevision: number;
  projection: 'player' | 'director';
  seed: AdoptionSeed;
  candidateId: string;
  summary: string;
  evidence: string;
  visibility: string;
  evidenceClosure: { sessionRevision: number };
  evidenceFingerprint: string;
  suggestions: Array<{ target: AdoptionTarget }>;
  target: AdoptionTarget;
  payload: Record<string, unknown>;
  touchedFiles: string[];
  diff: string;
  fingerprint: string;
  canonicalUnchanged: true;
}

interface AdoptionPreviewResponse extends ErrorResponse {
  preview: AdoptionPreview;
}

interface AdoptionPromotionResponse extends ErrorResponse {
  sessionUpdate: {
    sessionId: string;
    baseRevision: number;
    revision: number;
  };
  candidate: Record<string, unknown>;
  pendingAction: Record<string, unknown>;
}

interface ErrorResponse {
  error?: string;
  code?: string;
}

interface OutcomeResponse {
  report: {
    items: Array<{
      id: string;
      visibility: string;
      eventRefs: string[];
    }>;
  };
  reportFingerprint: string;
}

interface SettledHarness {
  workspaceRoot: string;
  backend: NovelBackendHandle;
  session: SessionView;
}

async function createSettledHarness(options: {
  workspaceRoot?: string;
  activatedSources?: Array<Record<string, unknown>>;
  turnCount?: number;
} = {}): Promise<SettledHarness> {
  const workspaceRoot = options.workspaceRoot ?? await createWorkspace();
  let settlementTurn = 0;
  const backend = await startBackend(workspaceRoot, {
    runPlayTurn: async () => playSettlement(++settlementTurn),
  });
  const id = `play-adoption-preview-${backends.length}`;
  const created = await requestJson<{ session: SessionView }>(
    `${backend.url}/api/workspace/play-sessions`,
    {
      method: 'POST',
      body: {
        id,
        title: 'Evidence-backed adoption preview',
        sceneStart: 'At the station gate',
        ...(options.activatedSources
          ? { activatedSources: options.activatedSources }
          : {}),
      },
    },
  );
  expect(created.response.status).toBe(200);
  let session = created.body.session;
  const turnCount = options.turnCount ?? 1;
  for (let index = 0; index < turnCount; index += 1) {
    const committed = await requestJson<{ session: SessionView }>(
      `${backend.url}/api/workspace/play-sessions/${id}/world-referee-turn`,
      {
        method: 'POST',
        body: {
          userText: `Wait at the gate ${index + 1}`,
          baseRevision: index,
        },
      },
    );
    expect(committed.response.status).toBe(200);
    session = committed.body.session;
  }
  return { workspaceRoot, backend, session };
}

async function createOutcomeReport(
  harness: SettledHarness,
): Promise<OutcomeResponse> {
  const created = await requestJson<OutcomeResponse>(
    `${harness.backend.url}/api/workspace/play-sessions/${harness.session.id}/reports/outcome`,
    {
      method: 'POST',
      body: {
        baseRevision: harness.session.revision,
        projection: 'director',
      },
    },
  );
  expect(created.response.status).toBe(200);
  expect(created.body.reportFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  return created.body;
}

async function createPreview(
  harness: SettledHarness,
  input: {
    projection: 'player' | 'director';
    seed: AdoptionSeed;
    target?: AdoptionTarget;
    payload?: Record<string, unknown>;
  },
): Promise<{ response: Response; body: AdoptionPreviewResponse }> {
  return requestJson<AdoptionPreviewResponse>(adoptionPreviewUrl(harness), {
    method: 'POST',
    body: {
      baseRevision: harness.session.revision,
      ...input,
    },
  });
}

async function prepareVisibleEventPreview(
  harness: SettledHarness,
  target?: AdoptionTarget,
): Promise<AdoptionPreview> {
  const event = harness.session.events.find((item) =>
    item.visibility === 'playerVisible')!;
  const created = await createPreview(harness, {
    projection: 'director',
    seed: { kind: 'event', eventId: event.id },
    ...(target ? { target } : {}),
  });
  expect(created.response.status).toBe(200);
  return created.body.preview;
}

async function promotePreview(
  harness: SettledHarness,
  preview: AdoptionPreview,
): Promise<{ response: Response; body: AdoptionPromotionResponse }> {
  return requestJson<AdoptionPromotionResponse>(
    `${adoptionPreviewUrl(harness)}/${preview.id}/pending-action`,
    {
      method: 'POST',
      body: {
        baseRevision: preview.baseRevision,
        fingerprint: preview.fingerprint,
      },
    },
  );
}

async function expectStalePromotion(
  harness: SettledHarness,
  preview: AdoptionPreview,
): Promise<void> {
  const stale = await promotePreview(harness, preview);
  expect(stale.response.status).toBe(409);
  expect(stale.body).toMatchObject({ code: 'stale_play_adoption_preview' });
  await expect(listPendingActions(harness.backend.url)).resolves.toEqual([]);
}

function adoptionPreviewUrl(harness: SettledHarness): string {
  return `${harness.backend.url}/api/workspace/play-sessions/${harness.session.id}/adoption-previews`;
}

async function listPendingActions(baseUrl: string): Promise<unknown[]> {
  const listed = await requestJson<{ pendingActions: unknown[] }>(
    `${baseUrl}/api/workspace/pending-actions`,
  );
  expect(listed.response.status).toBe(200);
  return listed.body.pendingActions;
}

async function readCanonicalTargets(
  workspaceRoot: string,
): Promise<Record<AdoptionTarget, string>> {
  return Object.fromEntries(await Promise.all(
    (Object.entries(canonicalTargets) as Array<[AdoptionTarget, string]>)
      .map(async ([target, file]) => [
        target,
        await readFile(join(workspaceRoot, file), 'utf-8'),
      ] as const),
  )) as Record<AdoptionTarget, string>;
}

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-adoption-preview-'));
  workspaces.push(workspaceRoot);
  await Promise.all([
    writeWorkspaceFile(workspaceRoot, '.oan/config.yaml', 'schemaVersion: 1\n'),
    writeWorkspaceFile(
      workspaceRoot,
      canonicalTargets.chapterDraft,
      '# Existing chapter\n\nThe station gate is still open.\n',
    ),
    writeWorkspaceFile(
      workspaceRoot,
      canonicalTargets.state,
      'evidence: {}\n',
    ),
    writeWorkspaceFile(
      workspaceRoot,
      canonicalTargets.timeline,
      'events: []\n',
    ),
    writeWorkspaceFile(
      workspaceRoot,
      canonicalTargets.foreshadow,
      'active: []\n',
    ),
  ]);
  return workspaceRoot;
}

async function writeWorkspaceFile(
  workspaceRoot: string,
  file: string,
  content: string,
): Promise<void> {
  const path = join(workspaceRoot, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

async function startBackend(
  workspaceRoot: string,
  options: Parameters<typeof startNovelHttpBackend>[0],
): Promise<NovelBackendHandle> {
  const backend = await startNovelHttpBackend({
    workspaceRoot,
    ...options,
  });
  backends.push(backend);
  return backend;
}

async function requestJson<T>(
  url: string,
  input: { method?: string; body?: unknown } = {},
): Promise<{ response: Response; body: T }> {
  const response = await fetch(url, {
    method: input.method,
    ...(input.body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input.body),
        }),
  });
  return { response, body: await response.json() as T };
}

function playSettlement(turn: number): string {
  return [
    `The station gate changes on turn ${turn}.`,
    '```oan-play-settlement',
    JSON.stringify({
      events: [{
        kind: 'environmentChanged',
        origin: 'environment',
        title: `Visible gate ${turn}`,
        summary: `The public gate changes on turn ${turn}.`,
        visibility: 'playerVisible',
        cause: { reason: 'The public mechanism advanced.' },
      }, {
        kind: 'informationSpread',
        origin: 'npc',
        title: `Hidden signal ${turn}`,
        summary: `A private signal changes on turn ${turn}.`,
        visibility: 'playerUnknown',
        cause: { reason: 'The porter sent a private code.' },
      }],
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      knowledgeChanges: [],
      stateDelta: {},
      observations: [{
        summary: `The gate mechanism moved on turn ${turn}.`,
        evidence: `The visible gate changed on turn ${turn}.`,
      }],
      suggestedActions: [],
    }),
    '```',
  ].join('\n');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
