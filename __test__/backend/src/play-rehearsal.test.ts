import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addPlayObservation,
  createPlaySceneRehearsalSessionDraft,
  readPlaySessionFiles,
  writePlaySessionFiles,
} from "@oh-awesome-novel/core";
import type {
  CharacterStepDraft,
  CreatePlaySceneRehearsalSessionInput,
  PlaySession,
  PlayTurnAttempt,
} from "@oh-awesome-novel/core";
import { startNovelHttpBackend } from "@oh-awesome-novel/backend";
import type {
  NovelBackendOptions,
  NovelBackendPlayRehearsalActorInput,
  NovelBackendPlayRehearsalRefereeInput,
} from "@oh-awesome-novel/backend";
import { afterEach, describe, expect, it, vi } from "vitest";

interface JsonResponse<T> {
  response: Response;
  body: T;
}

interface SseEvent {
  type: string;
  [key: string]: unknown;
}

const cleanupCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupCallbacks.length > 0) {
    await cleanupCallbacks.pop()?.();
  }
});

describe("Play scene-rehearsal HTTP controller", () => {
  it("creates and round-trips a Core-shaped v5 session, permits one active attempt, and rejects invalid requests before providers run", async () => {
    const workspaceRoot = await createOanWorkspace();
    const actor = vi.fn(defaultActor);
    const referee = vi.fn(defaultReferee);
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });

    const created = await createSession(baseUrl, "rehearsal-roundtrip");

    expect(created.schemaVersion).toBe(5);
    expect(created.sceneRehearsal?.purpose).toBe("sceneRehearsal");
    expect(created.sceneRehearsal?.sceneContract.sceneId).toBe("scene-gate");
    expect(
      created.sceneRehearsal?.participants.map(
        (participant) => participant.participantRef,
      ),
    ).toEqual(["participant-alice"]);

    const files = await snapshotCommittedSessionFiles(
      join(workspaceRoot, ".workspace", "play-sessions", created.id),
    );
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "scene-rehearsal.yaml",
      "scenes/scene-gate.yaml",
      "session.yaml",
      "transcript.md",
    ]));

    const reopened = await getJson<{ session: PlaySession }>(
      `${baseUrl}/api/workspace/play-sessions/${created.id}`,
    );
    expect(reopened.response.status).toBe(200);
    expect(reopened.body.session).toEqual(created);

    const attempt = await createAttempt(baseUrl, created.id, 0);
    expect(attempt.status).toBe("running");
    expect(attempt.attemptRevision).toBe(0);

    const duplicate = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${created.id}/attempts`,
      { baseRevision: 0 },
    );
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.code).toBe("active_attempt");

    const active = await getJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${created.id}/attempts/active`,
    );
    expect(active.response.status).toBe(200);
    expect(active.body.attempt.id).toBe(attempt.id);

    const malformed = await postJson<{ code: string }>(
      stepStreamUrl(baseUrl, created.id, attempt.id),
      {
        expectedAttemptRevision: 0,
        idempotencyKey: "malformed-next",
        mode: "next",
        sourceStepRef: "not-allowed-for-next",
      },
    );
    expect(malformed.response.status).toBe(400);

    const stale = await postJson<{ code: string }>(
      stepStreamUrl(baseUrl, created.id, attempt.id),
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "stale-next",
        mode: "next",
      },
    );
    expect(stale.response.status).toBe(409);
    expect(stale.body.code).toBe("attempt_revision_conflict");
    expect(actor).not.toHaveBeenCalled();
    expect(referee).not.toHaveBeenCalled();
  });

  it("streams stable step identity and headers, accepts the draft, and never emits ordinary play.turn events", async () => {
    const workspaceRoot = await createOanWorkspace();
    const actor = vi.fn(async function* (_input: NovelBackendPlayRehearsalActorInput) {
      yield "Alice ";
      yield "raises the ticket.";
    });
    const referee = vi.fn(defaultReferee);
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const session = await createSession(baseUrl, "rehearsal-step-identity");
    const attempt = await createAttempt(baseUrl, session.id, 0);

    const streamed = await streamStep(baseUrl, session.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "identity-next",
      mode: "next",
    });

    expect(streamed.response.status).toBe(200);
    expect(streamed.stepRunId).toMatch(/^step-run-/);
    expect(streamed.events.map((event) => event.type)).toEqual([
      "play.actor.step.started",
      "play.actor.step.delta",
      "play.actor.step.delta",
      "play.actor.step.prepared",
    ]);
    expect(streamed.raw).not.toContain("play.turn.");

    for (const [index, event] of streamed.events.entries()) {
      expect(event.sessionId).toBe(session.id);
      expect(event.attemptId).toBe(attempt.id);
      expect(event.stepRunId).toBe(streamed.stepRunId);
      expect(event.sequence).toBe(index + 1);
      expect(event.eventId).toBe(`${streamed.stepRunId}:${index + 1}`);
    }

    const prepared = findEvent(streamed.events, "play.actor.step.prepared");
    const preparedAttempt = prepared.attempt as PlayTurnAttempt;
    const draft = prepared.step as CharacterStepDraft;
    expect(preparedAttempt.attemptRevision).toBe(1);
    expect(preparedAttempt.currentStepRef).toBe(draft.id);
    expect(draft.status).toBe("draft");
    expect(draft.narrativeBlocks.map((block) => block.content).join(""))
      .toBe("Alice raises the ticket.");

    const accepted = await postJson<{
      attempt: PlayTurnAttempt;
      replayed: boolean;
    }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "accept-alice",
        kind: "accept",
        stepRef: draft.id,
      },
    );
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.attempt.attemptRevision).toBe(2);
    expect(accepted.body.attempt.status).toBe("prepared");
    expect(accepted.body.attempt.selectedHeadRef).toBe(draft.id);
    expect(
      accepted.body.attempt.steps.find((step) => step.id === draft.id)?.status,
    ).toBe("selected");
    expect(accepted.body.replayed).toBe(false);

    const unchangedSession = await getJson<{ session: PlaySession }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}`,
    );
    expect(unchangedSession.body.session.revision).toBe(0);
    expect(actor).toHaveBeenCalledTimes(1);
    expect(referee).toHaveBeenCalledTimes(1);
    expect(Object.keys(actor.mock.calls[0]![0]).sort()).toEqual([
      "abortSignal",
      "promptInput",
    ]);
    expect(actor.mock.calls[0]![0]).not.toHaveProperty("workspaceRoot");
    expect(actor.mock.calls[0]![0]).not.toHaveProperty("session");
    expect(actor.mock.calls[0]![0]).not.toHaveProperty("attempt");
    expect(actor.mock.calls[0]![0].promptInput.sceneContract).toMatchObject({
      sceneId: "scene-gate",
      participantRefs: ["participant-alice"],
    });
    expect(actor.mock.calls[0]![0].promptInput.sceneContract)
      .not.toHaveProperty("objective");
    expect(actor.mock.calls[0]![0].promptInput.sceneContract)
      .not.toHaveProperty("risk");
    expect(Object.keys(referee.mock.calls[0]![0]).sort()).toEqual([
      "abortSignal",
      "prompt",
    ]);
  });

  it("persists typed revise/grant controls and returns lens-safe rebuildable Scene Memory", async () => {
    const workspaceRoot = await createOanWorkspace();
    const actor = vi.fn(defaultActor);
    const referee = vi.fn(defaultReferee);
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const session = await createSession(baseUrl, "rehearsal-f4-controls");
    const attempt = await createAttempt(baseUrl, session.id, 0);
    const streamed = await streamStep(baseUrl, session.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "f4-first-step",
      mode: "next",
    });
    const draft = findEvent(streamed.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;

    const revised = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "f4-revise-step",
        kind: "reviseProjection",
        stepRef: draft.id,
        expectedEffectFingerprint: draft.effectFingerprint,
        replacementBlocks: [{
          id: "block-f4-revised",
          kind: "characterAction",
          speakerRef: "participant-alice",
          content: "Alice deliberately keeps the valid ticket visible.",
          visibility: "playerVisible",
          projection: "transcript",
          eventRefs: [],
          sourceRefs: [...draft.narrativeBlocks[0]!.sourceRefs],
        }],
      },
    );
    expect(revised.response.status, JSON.stringify(revised.body)).toBe(200);
    const revisedStep = revised.body.attempt.steps.find((step) =>
      step.id === revised.body.attempt.currentStepRef)!;
    expect(revisedStep).toMatchObject({
      variantOf: draft.id,
      effectFingerprint: draft.effectFingerprint,
      status: "draft",
    });
    expect(revised.body.attempt.interventions).toEqual([
      expect.objectContaining({
        kind: "reviseProjection",
        stepRef: draft.id,
        replacementStepRef: revisedStep.id,
        supersededStepRefs: [draft.id],
      }),
    ]);

    const rejectedGrant = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 2,
        idempotencyKey: "f4-grant-forged",
        kind: "grantKnowledge",
        participantRef: "participant-alice",
        effectiveFromStepRef: revisedStep.id,
        grant: {
          kind: "authorProvidedPlayFact",
          summary: "The Director tells Alice that the last train is a decoy.",
          visibility: "playerUnknown",
          providedAt: "2026-07-20T02:00:00.000Z",
          forged: true,
        },
      },
    );
    expect(rejectedGrant.response.status).toBe(400);

    const granted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 2,
        idempotencyKey: "f4-grant-secret",
        kind: "grantKnowledge",
        participantRef: "participant-alice",
        effectiveFromStepRef: revisedStep.id,
        grant: {
          kind: "authorProvidedPlayFact",
          summary: "The Director tells Alice that the last train is a decoy.",
          visibility: "playerUnknown",
          providedAt: "2026-07-20T02:00:00.000Z",
        },
      },
    );
    expect(granted.response.status).toBe(200);
    expect(granted.body.attempt).toMatchObject({
      attemptRevision: 3,
      selectedStepRefs: [],
    });
    expect(granted.body.attempt).not.toHaveProperty("currentStepRef");
    expect(granted.body.attempt.interventions.at(-1)).toMatchObject({
      kind: "grantKnowledge",
      participantRef: "participant-alice",
      supersededStepRefs: [revisedStep.id],
    });

    const regenerated = await streamStep(baseUrl, session.id, attempt.id, {
      expectedAttemptRevision: 3,
      idempotencyKey: "f4-regenerate-with-grant",
      mode: "next",
    });
    const grantedDraft = findEvent(regenerated.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;
    expect(actor.mock.calls.at(-1)![0].promptInput.perception.visibleFacts)
      .toContainEqual(expect.objectContaining({
        ref: "participant-knowledge-intervention-f4-grant-secret",
        fact: "The Director tells Alice that the last train is a decoy.",
      }));
    const accepted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 4,
        idempotencyKey: "f4-accept-granted-step",
        kind: "accept",
        stepRef: grantedDraft.id,
      },
    );
    expect(accepted.body.attempt.status).toBe("prepared");

    const finished = await postJson<{
      session: PlaySession;
      attempt: PlayTurnAttempt;
    }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/finalize`,
      {
        baseRevision: 0,
        expectedAttemptRevision: 5,
        idempotencyKey: "f4-finish-granted-step",
        selectedHeadRef: grantedDraft.id,
      },
    );
    expect(finished.response.status).toBe(200);
    expect(finished.body.session.playLocalState.playKnowledge).toMatchObject({
      schemaVersion: 1,
      records: [expect.objectContaining({
        kind: "participantGrant",
        participantRef: "participant-alice",
        interventionRef: "intervention-f4-grant-secret",
        grantedAtTurnId: "turn-1-referee",
      })],
    });

    const malformedMemory = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/memories/rebuild`,
      { lens: "player", forged: true },
    );
    expect(malformedMemory.response.status).toBe(400);
    const rebuiltPlayer = await postJson<{ memory: {
      lens: string;
      selectedTurnRefs: string[];
      sourceHashes: Record<string, string>;
      items: Array<Record<string, unknown>>;
      status: string;
    } }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/memories/rebuild`,
      { lens: "player" },
    );
    expect(rebuiltPlayer.response.status).toBe(200);
    expect(rebuiltPlayer.body.memory).toMatchObject({
      lens: "player",
      selectedTurnRefs: [],
      sourceHashes: {},
      status: "current",
    });
    expect(JSON.stringify(rebuiltPlayer.body.memory)).not.toContain(
      "participant-knowledge-intervention-f4-grant-secret",
    );
    expect(rebuiltPlayer.body.memory.items.every((item) => [
      "artifactTurnRefs",
      "messageRefs",
      "eventRefs",
      "observationRefs",
      "evidenceRefs",
      "sourceRefs",
      "participantRefs",
    ].every((field) => Array.isArray(item[field]) && item[field].length === 0)))
      .toBe(true);
    const reopenedPlayer = await getJson<typeof rebuiltPlayer.body>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/memories/player`,
    );
    expect(reopenedPlayer.body).toEqual(rebuiltPlayer.body);
  });

  it("adjudicates redirect server-side and rejects renderer-supplied replacement truth", async () => {
    const workspaceRoot = await createOanWorkspace();
    const actor = vi.fn(defaultActor);
    const referee = vi.fn(defaultReferee);
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const session = await createSession(baseUrl, "rehearsal-f4-redirect");
    const attempt = await createAttempt(baseUrl, session.id, 0);
    const streamed = await streamStep(baseUrl, session.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "redirect-first-step",
      mode: "next",
    });
    const draft = findEvent(streamed.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;

    const forged = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "redirect-forged",
        kind: "redirectStep",
        stepRef: draft.id,
        directorIntent: "Alice lowers the ticket.",
        authorConstraintRefs: ["knowledge-ticket"],
        replacementStep: draft,
      },
    );
    expect(forged.response.status).toBe(400);
    expect(actor).toHaveBeenCalledTimes(1);
    expect(referee).toHaveBeenCalledTimes(1);

    const opaqueConstraint = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "redirect-opaque-constraint",
        kind: "redirectStep",
        stepRef: draft.id,
        directorIntent: "Alice lowers the ticket.",
        authorConstraintRefs: ["unresolved-opaque-constraint"],
      },
    );
    expect(opaqueConstraint.response.status).toBe(422);
    expect(opaqueConstraint.body.code).toBe("invalid_rehearsal_effect");
    expect(actor).toHaveBeenCalledTimes(1);
    expect(referee).toHaveBeenCalledTimes(1);

    const redirectBody = {
      expectedAttemptRevision: 1,
      idempotencyKey: "redirect-host-adjudicated",
      kind: "redirectStep",
      stepRef: draft.id,
      directorIntent: "Alice lowers the ticket without revealing why.",
      authorConstraintRefs: ["knowledge-ticket"],
    };
    const redirected = await postJson<{
      attempt: PlayTurnAttempt;
      replayed: boolean;
    }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      redirectBody,
    );
    expect(redirected.response.status).toBe(200);
    expect(redirected.body.replayed).toBe(false);
    expect(actor).toHaveBeenCalledTimes(2);
    expect(referee).toHaveBeenCalledTimes(2);
    const replacement = redirected.body.attempt.steps.find((step) =>
      step.id === redirected.body.attempt.currentStepRef)!;
    expect(replacement).toMatchObject({
      variantOf: draft.id,
      status: "draft",
      intentSummary: redirectBody.directorIntent,
    });
    expect(redirected.body.attempt.interventions).toEqual([
      expect.objectContaining({
        kind: "redirectStep",
        stepRef: draft.id,
        replacementStepRef: replacement.id,
        directorIntent: redirectBody.directorIntent,
      }),
    ]);
    expect(actor.mock.calls.at(-1)![0].promptInput.perception.behaviorAnchors)
      .toContainEqual(expect.objectContaining({
        ref: `redirect-${draft.id}`,
        summary: redirectBody.directorIntent,
      }));
    expect(referee.mock.calls.at(-1)![0].prompt).toContain(
      '"kind": "initialKnowledgeEvidence"',
    );
    expect(referee.mock.calls.at(-1)![0].prompt).toContain(
      '"ref": "knowledge-ticket"',
    );
    expect(referee.mock.calls.at(-1)![0].prompt).not.toContain(
      '"authorConstraintRefs"',
    );

    const replay = await postJson<typeof redirected.body>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      redirectBody,
    );
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.attempt).toEqual(redirected.body.attempt);
    expect(actor).toHaveBeenCalledTimes(2);
    expect(referee).toHaveBeenCalledTimes(2);
  });

  it("shows a provisional player-visible world notice to the next actor without inventing event ids or leaking hidden effects", async () => {
    const workspaceRoot = await createOanWorkspace();
    const baseInput = createSessionInput("rehearsal-provisional-world-notice");
    const input: CreatePlaySceneRehearsalSessionInput = {
      ...baseInput,
      sceneContract: {
        ...baseInput.sceneContract,
        participantRefs: ["participant-alice", "participant-bob"],
      },
      participants: [
        ...baseInput.participants,
        {
          participantRef: "participant-bob",
          displayName: "Bob",
          initialKnowledgeEvidenceRefs: ["knowledge-gate-duty"],
        },
      ],
      initialKnowledgeEvidence: [
        ...baseInput.initialKnowledgeEvidence,
        {
          id: "knowledge-gate-duty",
          participantRef: "participant-bob",
          visibility: "playerVisible",
          fact: "Bob knows that he must watch the station gate.",
          provenance: {
            kind: "authorProvided",
            providedAt: "2026-07-15T00:00:00.000Z",
          },
        },
      ],
    };
    await writePlaySessionFiles(
      workspaceRoot,
      createPlaySceneRehearsalSessionDraft(input),
    );

    let refereeCall = 0;
    const actor = vi.fn(defaultActor);
    const referee = vi.fn(async function refereeWithVisibleAndHiddenEffects() {
      refereeCall += 1;
      const events = refereeCall === 1
        ? [{
            kind: "environmentChanged",
            origin: "environment",
            title: "The warning lamp turns red",
            summary: "The lamp above the gate now glows red.",
            visibility: "playerVisible",
            cause: { reason: "Alice stepped beneath the gate sensor." },
          }, {
            kind: "informationSpread",
            origin: "npc",
            title: "The porter sends a private warning",
            summary: "Only the porter and stationmaster know about the warning.",
            visibility: "playerUnknown",
            cause: { reason: "The porter distrusts Alice's ticket." },
          }]
        : [];
      return [
        "The station responds.",
        "```oan-play-settlement",
        JSON.stringify({
          events,
          pressureChanges: [],
          agendaChanges: [],
          scheduledEventChanges: [],
          stateDelta: {},
          observations: [],
          suggestedActions: [],
        }),
        "```",
      ].join("\n");
    });
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const attempt = await createAttempt(baseUrl, input.id, 0);
    const aliceStream = await streamStep(baseUrl, input.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "provisional-alice",
      mode: "next",
    });
    const aliceDraft = findEvent(
      aliceStream.events,
      "play.actor.step.prepared",
    ).step as CharacterStepDraft;
    const provisionalNotice = aliceDraft.narrativeBlocks.at(-1)!;
    expect(provisionalNotice).toMatchObject({
      id: `world-notice-${aliceDraft.id}`,
      kind: "worldNotice",
      content: "The warning lamp turns red: The lamp above the gate now glows red.",
      visibility: "playerVisible",
      projection: "transcript",
      eventRefs: [],
      sourceRefs: [],
    });
    expect(JSON.stringify(aliceDraft.narrativeBlocks))
      .not.toContain("private warning");

    const accepted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "provisional-accept-alice",
        kind: "accept",
        stepRef: aliceDraft.id,
      },
    );
    expect(accepted.body.attempt).toMatchObject({
      status: "running",
      attemptRevision: 2,
    });

    await streamStep(baseUrl, input.id, attempt.id, {
      expectedAttemptRevision: 2,
      idempotencyKey: "provisional-bob",
      mode: "next",
    });
    const bobPrompt = actor.mock.calls.at(-1)![0].promptInput;
    expect(bobPrompt.perception.visibleEvents).toEqual([]);
    expect(bobPrompt.selectedPriorVisibleBlocks).toEqual([
      expect.objectContaining({ id: aliceDraft.narrativeBlocks[0]!.id }),
      expect.objectContaining({
        id: provisionalNotice.id,
        kind: "worldNotice",
        content: provisionalNotice.content,
      }),
    ]);
    expect(JSON.stringify(bobPrompt)).not.toContain("private warning");
    expect(JSON.stringify(bobPrompt)).not.toContain("stationmaster");
    const refereePrompt = referee.mock.calls[0]![0].prompt;
    expect(refereePrompt).toContain('"playLocalStateVisibility"');
    expect(refereePrompt).toContain("Treat Director objective/risk");
    expect(refereePrompt).toContain(
      "title and summary must contain only consequences perceivable at that visibility",
    );
    expect(refereePrompt).toContain(
      "Do not widen the visibility of an existing fact through stateDelta",
    );
  });

  it("offers only selected hidden ancestors as reveal candidates and commits a typed reveal at Finish", async () => {
    const workspaceRoot = await createOanWorkspace();
    const input = createSessionInput("rehearsal-branch-knowledge");
    await writePlaySessionFiles(
      workspaceRoot,
      createPlaySceneRehearsalSessionDraft(input),
    );
    let hiddenEventId = "";
    let refereeCall = 0;
    const actor = vi.fn(defaultActor);
    const referee = vi.fn(async () => {
      refereeCall += 1;
      const firstTurn = refereeCall === 1;
      return [
        firstTurn
          ? "The station remains quiet."
          : "A clipped announcement reaches the platform.",
        "```oan-play-settlement",
        JSON.stringify({
          events: firstTurn
            ? [{
                kind: "factionActed",
                origin: "faction",
                title: "The syndicate diverts the night train",
                summary: "A hidden order sends the night train onto another line.",
                visibility: "playerUnknown",
                cause: { reason: "The syndicate wants the platform left empty." },
              }]
            : [{
                kind: "informationSpread",
                origin: "environment",
                title: "The board announces a diverted train",
                summary: "The departure board now marks the night train as diverted.",
                visibility: "playerVisible",
                cause: {
                  reason: "The routing update has reached the public board.",
                  sourceEventIds: [hiddenEventId],
                },
              }],
          pressureChanges: [],
          agendaChanges: [],
          scheduledEventChanges: [],
          knowledgeChanges: firstTurn
            ? []
            : [{
                type: "revealEvent",
                subjectEventId: hiddenEventId,
                playerProjection: "playerVisible",
              }],
          stateDelta: {},
          observations: [],
          suggestedActions: [],
        }),
        "```",
      ].join("\n");
    });
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const hiddenAttempt = await createAttempt(baseUrl, input.id, 0);
    const hiddenStream = await streamStep(baseUrl, input.id, hiddenAttempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "hidden-step",
      mode: "next",
    });
    const hiddenDraft = findEvent(hiddenStream.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;
    const hiddenAccepted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${hiddenAttempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "hidden-accept",
        kind: "accept",
        stepRef: hiddenDraft.id,
      },
    );
    const hiddenFinished = await postJson<{ session: PlaySession }>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${hiddenAttempt.id}/finalize`,
      {
        baseRevision: 0,
        expectedAttemptRevision: hiddenAccepted.body.attempt.attemptRevision,
        idempotencyKey: "hidden-finish",
        selectedHeadRef: hiddenDraft.id,
      },
    );
    expect(hiddenFinished.response.status).toBe(200);
    const hiddenEvent = hiddenFinished.body.session.events[0]!;
    hiddenEventId = hiddenEvent.id;

    const attempt = await createAttempt(baseUrl, input.id, 1);
    const streamed = await streamStep(baseUrl, input.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "knowledge-step",
      mode: "next",
    });
    const prompt = referee.mock.calls[1]![0].prompt;
    expect(prompt).toContain('"revealCandidates"');
    expect(prompt).toContain(hiddenEventId);
    expect(prompt).toContain('"currentPlayerProjection": "playerUnknown"');
    expect(prompt).toContain("knowledgeChanges");
    const draft = findEvent(streamed.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;
    expect(draft.narrativeBlocks.at(-1)?.content)
      .toBe("The board announces a diverted train: The departure board now marks the night train as diverted.");
    expect(JSON.stringify(draft.narrativeBlocks))
      .not.toContain("syndicate diverts");

    const accepted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "knowledge-accept",
        kind: "accept",
        stepRef: draft.id,
      },
    );
    const finished = await postJson<{ session: PlaySession }>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${attempt.id}/finalize`,
      {
        baseRevision: 1,
        expectedAttemptRevision: accepted.body.attempt.attemptRevision,
        idempotencyKey: "knowledge-finish",
        selectedHeadRef: draft.id,
      },
    );
    expect(finished.response.status).toBe(200);
    expect(finished.body.session.playLocalState.playKnowledge).toMatchObject({
      schemaVersion: 1,
      records: [expect.objectContaining({
        subjectEventId: hiddenEventId,
        previousPlayerProjection: "playerUnknown",
        playerProjection: "playerVisible",
      })],
    });
    expect(finished.body.session.events[0]).toEqual(hiddenEvent);
  });

  it("uses filesystem CAS across two backends for concurrent Accept and Cancel", async () => {
    const workspaceRoot = await createOanWorkspace();
    const firstBackend = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: defaultActor,
      runPlayRehearsalReferee: defaultReferee,
    });
    const secondBackend = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: defaultActor,
      runPlayRehearsalReferee: defaultReferee,
    });
    const session = await createSession(firstBackend, "rehearsal-accept-cancel-cas");
    const attempt = await createAttempt(firstBackend, session.id, 0);
    const streamed = await streamStep(firstBackend, session.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "cas-step",
      mode: "next",
    });
    const draft = findEvent(streamed.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;

    const [accepted, cancelled] = await Promise.all([
      postJson<{ attempt?: PlayTurnAttempt; code?: string }>(
        `${firstBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
        {
          expectedAttemptRevision: 1,
          idempotencyKey: "cas-accept",
          kind: "accept",
          stepRef: draft.id,
        },
      ),
      postJson<{ attempt?: PlayTurnAttempt; code?: string }>(
        `${secondBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/cancel`,
        {
          expectedAttemptRevision: 1,
          idempotencyKey: "cas-cancel",
        },
      ),
    ]);

    const results = [accepted, cancelled];
    expect(results.filter((result) => result.response.status === 200)).toHaveLength(1);
    const conflict = results.find((result) => result.response.status !== 200)!;
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.code).toBe("attempt_revision_conflict");

    const authoritative = await getJson<{ attempt: PlayTurnAttempt }>(
      `${firstBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}`,
    );
    expect(authoritative.response.status).toBe(200);
    expect(authoritative.body.attempt.attemptRevision).toBe(2);
    expect(["prepared", "cancelled"]).toContain(authoritative.body.attempt.status);
    expect(authoritative.body.attempt.mutationReceipts).toHaveLength(2);
    expect(authoritative.body.attempt.mutationReceipts.map((receipt) => receipt.idempotencyKey))
      .toEqual(expect.arrayContaining([
        "cas-step",
        authoritative.body.attempt.status === "prepared" ? "cas-accept" : "cas-cancel",
      ]));
  });

  it("holds the attempt transaction through Finish so another backend Cancel sees committed truth", async () => {
    const workspaceRoot = await createOanWorkspace();
    const firstBackend = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: defaultActor,
      runPlayRehearsalReferee: defaultReferee,
    });
    const secondBackend = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: defaultActor,
      runPlayRehearsalReferee: defaultReferee,
    });
    const session = await createSession(firstBackend, "rehearsal-finish-cancel-lock");
    const attempt = await createAttempt(firstBackend, session.id, 0);
    const streamed = await streamStep(firstBackend, session.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "finish-lock-step",
      mode: "next",
    });
    const draft = findEvent(streamed.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;
    const accepted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${firstBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "finish-lock-accept",
        kind: "accept",
        stepRef: draft.id,
      },
    );
    expect(accepted.body.attempt.status).toBe("prepared");

    // Keep the staged session copy open long enough to deterministically issue
    // Cancel after Finish owns the external attempt lock.
    const sessionRoot = join(
      workspaceRoot,
      ".workspace",
      "play-sessions",
      session.id,
    );
    await mkdir(join(sessionRoot, ".migrations"), { recursive: true });
    await writeFile(
      join(sessionRoot, ".migrations", "finish-lock-padding.bin"),
      new Uint8Array(8 * 1024 * 1024),
    );
    const attemptLockRoot = join(
      workspaceRoot,
      ".workspace",
      "play-sessions",
      ".attempt-locks",
      `${session.id}.lock`,
    );
    const finishPromise = postJson<{
      session?: PlaySession;
      evidence?: { attemptId: string };
      code?: string;
    }>(
      `${firstBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/finalize`,
      {
        baseRevision: 0,
        expectedAttemptRevision: 2,
        idempotencyKey: "finish-lock-commit",
        selectedHeadRef: draft.id,
      },
    );
    await waitForPath(attemptLockRoot);
    const cancelPromise = postJson<{ code?: string; attempt?: PlayTurnAttempt }>(
      `${secondBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/cancel`,
      {
        expectedAttemptRevision: 2,
        idempotencyKey: "finish-lock-cancel",
      },
    );

    const [finished, cancelled] = await Promise.all([finishPromise, cancelPromise]);
    expect(finished.response.status).toBe(200);
    expect(finished.body.evidence).toMatchObject({ attemptId: attempt.id });
    expect(cancelled.response.status).toBe(409);
    expect(cancelled.body.code).toBe("too_late_to_cancel");

    const committed = await readPlaySessionFiles(workspaceRoot, session.id);
    expect(committed.revision).toBe(1);
    expect(committed.rehearsalScenes?.flatMap((scene) => scene.turns))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ attemptId: attempt.id }),
      ]));
    const removedRecovery = await getJson<{ code: string }>(
      `${firstBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}`,
    );
    expect(removedRecovery.response.status).toBe(404);

    // Simulate a process crash after the committed session swap but before
    // recovery.remove. Both mutation paths must prefer committed evidence and
    // self-heal the residual prepared recovery.
    const attemptsRoot = join(sessionRoot, ".recovery", "turn-attempts");
    const residualRoot = join(attemptsRoot, attempt.id);
    await mkdir(residualRoot, { recursive: true });
    await writeFile(
      join(residualRoot, "attempt.yaml"),
      `${JSON.stringify(accepted.body.attempt, null, 2)}\n`,
      "utf-8",
    );
    await writeFile(
      join(attemptsRoot, ".active-attempt"),
      `${attempt.id}\n`,
      "utf-8",
    );
    const residualCancel = await postJson<{ code: string }>(
      `${secondBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/cancel`,
      {
        expectedAttemptRevision: 2,
        idempotencyKey: "residual-cancel",
      },
    );
    expect(residualCancel.response.status).toBe(409);
    expect(residualCancel.body.code).toBe("too_late_to_cancel");
    const residualAccept = await postJson<{ code: string }>(
      `${firstBackend}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 2,
        idempotencyKey: "residual-accept",
        kind: "accept",
        stepRef: draft.id,
      },
    );
    expect(residualAccept.response.status).toBe(409);
    expect(residualAccept.body.code).toBe("attempt_committed");
    await expect(readdir(residualRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops a retry without replacing the existing draft", async () => {
    const workspaceRoot = await createOanWorkspace();
    let actorCall = 0;
    let signalRetryStarted: (() => void) | undefined;
    const retryStarted = new Promise<void>((resolve) => {
      signalRetryStarted = resolve;
    });
    const actor = vi.fn(async function* (input: NovelBackendPlayRehearsalActorInput) {
      actorCall += 1;
      if (actorCall === 1) {
        yield "The original draft remains.";
        return;
      }

      yield "A partial replacement";
      signalRetryStarted?.();
      await waitForAbort(input.abortSignal);
    });
    const referee = vi.fn(defaultReferee);
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const session = await createSession(baseUrl, "rehearsal-stop-retry");
    const attempt = await createAttempt(baseUrl, session.id, 0);
    const first = await streamStep(baseUrl, session.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "initial-step",
      mode: "next",
    });
    const firstPrepared = findEvent(first.events, "play.actor.step.prepared");
    const originalDraft = firstPrepared.step as CharacterStepDraft;

    const retryResponse = await fetch(stepStreamUrl(baseUrl, session.id, attempt.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedAttemptRevision: 1,
        idempotencyKey: "retry-to-stop",
        mode: "retry",
        sourceStepRef: originalDraft.id,
      }),
    });
    const retryRunId = retryResponse.headers.get("x-oan-play-step-run-id");
    expect(retryRunId).toMatch(/^step-run-/);
    await retryStarted;

    const stopped = await postJson<{ status: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/steps/${retryRunId}/stop`,
      {},
    );
    expect(stopped.response.status).toBe(200);
    expect(["aborted", "cancelling"]).toContain(stopped.body.status);

    const retryRaw = await retryResponse.text();
    const retryEvents = parseSseEvents(retryRaw);
    expect(retryEvents.map((event) => event.type)).toContain("play.actor.step.stream-aborted");
    expect(retryRaw).not.toContain("play.turn.");
    expect(retryEvents.some((event) => event.type === "play.actor.step.prepared")).toBe(false);

    const recovered = await getJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}`,
    );
    expect(recovered.response.status).toBe(200);
    expect(recovered.body.attempt.attemptRevision).toBe(1);
    expect(recovered.body.attempt.currentStepRef).toBe(originalDraft.id);
    expect(recovered.body.attempt.steps).toHaveLength(1);
    expect(recovered.body.attempt.steps[0]).toEqual(originalDraft);
    expect(referee).toHaveBeenCalledTimes(1);
  });

  it("blocks ordinary Play mutations while an attempt is active and cancel leaves committed session files unchanged", async () => {
    const workspaceRoot = await createOanWorkspace();
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: defaultActor,
      runPlayRehearsalReferee: defaultReferee,
    });
    const session = await createSession(baseUrl, "rehearsal-active-guard");
    const sessionDirectory = join(
      workspaceRoot,
      ".workspace",
      "play-sessions",
      session.id,
    );
    const before = await snapshotCommittedSessionFiles(sessionDirectory);
    const attempt = await createAttempt(baseUrl, session.id, 0);

    const ordinaryTurn = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/turns/stream`,
      {
        userText: "Proceed outside rehearsal.",
        actionKind: "say",
        baseRevision: 0,
      },
    );
    const observation = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/observations`,
      {
        summary: "An observation that must be blocked.",
        evidence: "Blocked by the active rehearsal attempt.",
        baseRevision: 0,
      },
    );
    const adoption = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/adoption-candidates`,
      {
        target: "state",
        summary: "A state adoption that must be blocked.",
        evidence: "Blocked by the active rehearsal attempt.",
        baseRevision: 0,
      },
    );

    for (const guarded of [ordinaryTurn, observation, adoption]) {
      expect(guarded.response.status).toBe(409);
      expect(guarded.body.code).toBe("active_attempt");
    }

    const cancelled = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/cancel`,
      {
        expectedAttemptRevision: 0,
        idempotencyKey: "cancel-without-commit",
      },
    );
    expect(cancelled.response.status).toBe(200);
    expect(cancelled.body.attempt.status).toBe("cancelled");
    expect(cancelled.body.attempt.attemptRevision).toBe(1);

    expect(await snapshotCommittedSessionFiles(sessionDirectory)).toEqual(before);
    const reopened = await readPlaySessionFiles(workspaceRoot, session.id);
    expect(reopened.revision).toBe(0);
    expect(reopened.transcript).toEqual([]);
    expect(reopened.observations).toEqual([]);
    expect(reopened.adoptionCandidates).toEqual([]);
  });

  it("finishes without another provider call, commits v3 rehearsal evidence and one hard-due event, then replays the receipt", async () => {
    const workspaceRoot = await createOanWorkspace();
    const dueEventId = "scheduled-hard-due";
    const input = createSessionInput("rehearsal-finish", [
      {
        id: dueEventId,
        label: "The station gate closes",
        trigger: { type: "nextTurn" },
        template: {
          kind: "environmentChanged",
          origin: "clock",
          title: "The station gate closes",
          summary: "The gate closes at the end of this rehearsal turn.",
          visibility: "playerVisible",
        },
        status: "scheduled",
        scheduledAtTurn: 0,
        scheduledAtRevision: 0,
      },
    ]);
    await writePlaySessionFiles(
      workspaceRoot,
      createPlaySceneRehearsalSessionDraft(input),
    );

    const actor = vi.fn(defaultActor);
    const referee = vi.fn(defaultReferee);
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const attempt = await createAttempt(baseUrl, input.id, 0);
    const streamed = await streamStep(baseUrl, input.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "finish-step",
      mode: "next",
    });
    const draft = findEvent(streamed.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;
    const accepted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "finish-accept",
        kind: "accept",
        stepRef: draft.id,
      },
    );
    expect(accepted.body.attempt.attemptRevision).toBe(2);
    const providerCountsBeforeFinish = {
      actor: actor.mock.calls.length,
      referee: referee.mock.calls.length,
    };

    const finishBody = {
      baseRevision: 0,
      expectedAttemptRevision: 2,
      idempotencyKey: "finish-once",
      selectedHeadRef: draft.id,
    };
    const finished = await postJson<{
      session: PlaySession;
      artifact: {
        schemaVersion: number;
        id: string;
        dueScheduledEventIds: string[];
        rehearsalEvidenceRefs: string[];
      };
      evidence: {
        id: string;
        owningTurnArtifactId: string;
        attemptId: string;
        selectedStepRefs: string[];
        steps: Array<{
          stepRef: string;
          narrativeBlocks: CharacterStepDraft["narrativeBlocks"];
        }>;
        hostNarrativeBlocks: CharacterStepDraft["narrativeBlocks"];
        narrativeBlocks: CharacterStepDraft["narrativeBlocks"];
      };
      receipt: { idempotencyKey: string; attemptRevision: number };
      replayed: boolean;
    }>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${attempt.id}/finalize`,
      finishBody,
    );

    expect(finished.response.status).toBe(200);
    expect(finished.body.replayed).toBe(false);
    expect(finished.body.session.revision).toBe(1);
    expect(finished.body.artifact.schemaVersion).toBe(3);
    expect(finished.body.artifact.dueScheduledEventIds).toEqual([dueEventId]);
    expect(finished.body.artifact.rehearsalEvidenceRefs).toEqual([
      finished.body.evidence.id,
    ]);
    expect(finished.body.evidence).toMatchObject({
      owningTurnArtifactId: finished.body.artifact.id,
      attemptId: attempt.id,
      selectedStepRefs: [draft.id],
      steps: [expect.objectContaining({ stepRef: draft.id })],
    });
    expect(finished.body.receipt.idempotencyKey).toBe("finish-once");
    expect(finished.body.receipt.attemptRevision).toBe(2);
    expect(actor).toHaveBeenCalledTimes(providerCountsBeforeFinish.actor);
    expect(referee).toHaveBeenCalledTimes(providerCountsBeforeFinish.referee);
    expect(JSON.stringify(finished.body)).not.toContain("play.turn.");

    const contextTraces = await getJson<{
      traces: Array<{
        artifactId: string;
        sessionRevision: number;
        transcriptWindow: { kind: string };
        eventWindow: { kind: string };
      }>;
    }>(`${baseUrl}/api/workspace/play-sessions/${input.id}/context-traces`);
    expect(contextTraces.response.status).toBe(200);
    expect(contextTraces.body.traces).toEqual([
      expect.objectContaining({
        artifactId: finished.body.artifact.id,
        sessionRevision: 1,
        transcriptWindow: expect.objectContaining({ kind: "transcript" }),
        eventWindow: expect.objectContaining({ kind: "event" }),
      }),
    ]);

    const boundedReopen = await getJson<{
      detail: {
        snapshot: {
          schemaVersion: number;
          rehearsalScenes: Array<{
            turns: Array<{ id: string; owningTurnArtifactId: string }>;
          }>;
        };
        events: { items: Array<{ id: string }> };
        eventPresentation: Array<{ eventId: string }>;
        selectedArtifactPresentation: {
          id: string;
          revision: number;
          rehearsalEvidenceRefs: string[];
        };
      };
    }>(`${baseUrl}/api/workspace/play-sessions/${input.id}/detail?limit=20`);
    expect(boundedReopen.response.status).toBe(200);
    expect(boundedReopen.body.detail.snapshot.schemaVersion).toBe(5);
    expect(boundedReopen.body.detail.selectedArtifactPresentation).toMatchObject({
      id: finished.body.artifact.id,
      revision: 1,
      rehearsalEvidenceRefs: [finished.body.evidence.id],
    });
    expect(boundedReopen.body.detail.snapshot.rehearsalScenes[0]?.turns)
      .toEqual([expect.objectContaining({
        id: finished.body.evidence.id,
        owningTurnArtifactId: finished.body.artifact.id,
      })]);
    expect(boundedReopen.body.detail.eventPresentation.map((item) => item.eventId))
      .toEqual(boundedReopen.body.detail.events.items.map((event) => event.id));

    const dueOccurrences = finished.body.session.events.filter(
      (event) => event.cause.triggerId === dueEventId,
    );
    expect(dueOccurrences).toHaveLength(1);
    const committedWorldNotice = finished.body.evidence.hostNarrativeBlocks?.[0];
    expect(committedWorldNotice).toMatchObject({
      id: `world-notice-host-${finished.body.artifact.id}`,
      kind: "worldNotice",
      content: "The station gate closes: The gate closes at the end of this rehearsal turn.",
      visibility: "playerVisible",
      projection: "transcript",
      eventRefs: [dueOccurrences[0]!.id],
      sourceRefs: [],
    });
    expect(finished.body.evidence.narrativeBlocks).toEqual(
      [
        ...finished.body.evidence.steps.flatMap((step) => step.narrativeBlocks),
        ...(finished.body.evidence.hostNarrativeBlocks ?? []),
      ],
    );
    expect(
      finished.body.session.scheduledEvents.find((event) => event.id === dueEventId)?.status,
    ).toBe("occurred");

    const replayed = await postJson<typeof finished.body>(
      `${baseUrl}/api/workspace/play-sessions/${input.id}/attempts/${attempt.id}/finalize`,
      finishBody,
    );
    expect(replayed.response.status).toBe(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.session.revision).toBe(1);
    expect(replayed.body.receipt).toEqual(finished.body.receipt);
    expect(replayed.body.artifact).toEqual(finished.body.artifact);
    expect(replayed.body.evidence).toEqual(finished.body.evidence);
    expect(actor).toHaveBeenCalledTimes(providerCountsBeforeFinish.actor);
    expect(referee).toHaveBeenCalledTimes(providerCountsBeforeFinish.referee);

    const persisted = await readPlaySessionFiles(workspaceRoot, input.id);
    expect(persisted.revision).toBe(1);
    expect(persisted.events.filter((event) => event.cause.triggerId === dueEventId)).toHaveLength(
      1,
    );

    const nextAttempt = await createAttempt(baseUrl, input.id, 1);
    await streamStep(baseUrl, input.id, nextAttempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "next-turn-perception",
      mode: "next",
    });
    expect(actor.mock.calls.at(-1)![0].promptInput.perception.visibleEvents).toEqual([{
      ref: dueOccurrences[0]!.id,
      title: "The station gate closes",
      summary: "The gate closes at the end of this rehearsal turn.",
    }]);
    expect(actor.mock.calls.at(-1)![0].promptInput).toMatchObject({
      sceneContract: { sceneRevision: 1, worldClock: { turn: 1, revision: 1 } },
      perception: {
        snapshotId: "perception-scene-gate-participant-alice-1",
        sceneRevision: 1,
      },
    });
    expect(actor.mock.calls.at(-1)![0].promptInput.selectedPriorVisibleBlocks)
      .toEqual([
        expect.objectContaining({
          id: draft.narrativeBlocks[0]!.id,
          content: draft.narrativeBlocks[0]!.content,
        }),
        expect.objectContaining({
          id: committedWorldNotice!.id,
          kind: "worldNotice",
          content: committedWorldNotice!.content,
        }),
      ]);
  });

  it("rejects finalize after committed-session drift while retaining the prepared attempt", async () => {
    const workspaceRoot = await createOanWorkspace();
    const actor = vi.fn(defaultActor);
    const referee = vi.fn(defaultReferee);
    const baseUrl = await startBackend(workspaceRoot, {
      streamPlayRehearsalActor: actor,
      runPlayRehearsalReferee: referee,
    });
    const session = await createSession(baseUrl, "rehearsal-session-drift");
    const attempt = await createAttempt(baseUrl, session.id, 0);
    const streamed = await streamStep(baseUrl, session.id, attempt.id, {
      expectedAttemptRevision: 0,
      idempotencyKey: "drift-step",
      mode: "next",
    });
    const draft = findEvent(streamed.events, "play.actor.step.prepared")
      .step as CharacterStepDraft;
    const accepted = await postJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/interventions`,
      {
        expectedAttemptRevision: 1,
        idempotencyKey: "drift-accept",
        kind: "accept",
        stepRef: draft.id,
      },
    );
    expect(accepted.body.attempt.status).toBe("prepared");

    const committedBeforeDrift = await readPlaySessionFiles(workspaceRoot, session.id);
    const drifted = addPlayObservation(committedBeforeDrift, {
      id: "external-observation",
      summary: "The committed session changed outside this attempt.",
      evidence: "A direct committed-session write creates a revision conflict.",
      visibility: "playerVisible",
      sourceTurnIds: [],
      sourceEventIds: [],
      canonical: false,
    });
    await writePlaySessionFiles(workspaceRoot, drifted);

    const providerCountsBeforeFinish = {
      actor: actor.mock.calls.length,
      referee: referee.mock.calls.length,
    };
    const conflict = await postJson<{ code: string }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}/finalize`,
      {
        baseRevision: 0,
        expectedAttemptRevision: 2,
        idempotencyKey: "finish-after-drift",
        selectedHeadRef: draft.id,
      },
    );
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.code).toBe("session_revision_conflict");
    expect(actor).toHaveBeenCalledTimes(providerCountsBeforeFinish.actor);
    expect(referee).toHaveBeenCalledTimes(providerCountsBeforeFinish.referee);

    const retained = await getJson<{ attempt: PlayTurnAttempt }>(
      `${baseUrl}/api/workspace/play-sessions/${session.id}/attempts/${attempt.id}`,
    );
    expect(retained.response.status).toBe(200);
    expect(retained.body.attempt.status).toBe("prepared");
    expect(retained.body.attempt.attemptRevision).toBe(2);
    expect(retained.body.attempt.selectedHeadRef).toBe(draft.id);
    expect(retained.body.attempt.steps).toHaveLength(1);

    const committedAfterConflict = await readPlaySessionFiles(workspaceRoot, session.id);
    expect(committedAfterConflict.revision).toBe(1);
    expect(committedAfterConflict.observations.map((observation) => observation.id)).toContain(
      "external-observation",
    );
  });
});

function createSessionInput(
  id: string,
  scheduledEvents: CreatePlaySceneRehearsalSessionInput["scheduledEvents"] = [],
): CreatePlaySceneRehearsalSessionInput {
  return {
    id,
    title: "Station gate rehearsal",
    sceneStart: "The station gate is about to close.",
    characters: [],
    activatedSources: [],
    eventPolicy: "medium",
    worldMomentum: { pressures: [], agendas: [] },
    sceneContract: {
      sceneId: "scene-gate",
      worldClock: { turn: 0, revision: 0 },
      clockProvenance: { kind: "newSessionInitial", sourceRefs: [] },
      objective: {
        value: "Director-only: test whether Alice abandons the ticket.",
        provenance: {
          kind: "authorProvided",
          providedAt: "2026-07-15T00:00:00.000Z",
        },
      },
      risk: {
        value: "Director-only: revealing the hidden test invalidates the rehearsal.",
        provenance: {
          kind: "authorProvided",
          providedAt: "2026-07-15T00:00:00.000Z",
        },
      },
      participantRefs: ["participant-alice"],
      orderStrategy: "directorFixed",
    },
    participants: [
      {
        participantRef: "participant-alice",
        displayName: "Alice",
        initialKnowledgeEvidenceRefs: ["knowledge-ticket"],
      },
    ],
    initialKnowledgeEvidence: [
      {
        id: "knowledge-ticket",
        participantRef: "participant-alice",
        visibility: "playerVisible",
        fact: "Alice knows that she is holding the valid ticket.",
        provenance: {
          kind: "authorProvided",
          providedAt: "2026-07-15T00:00:00.000Z",
        },
      },
    ],
    scheduledEvents,
  };
}

async function createOanWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "oan-play-rehearsal-backend-"));
  await mkdir(join(workspaceRoot, ".oan"), { recursive: true });
  await writeFile(join(workspaceRoot, ".oan", "config.yaml"), "schemaVersion: 1\n");
  cleanupCallbacks.push(() => rm(workspaceRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

async function startBackend(
  workspaceRoot: string,
  options: Pick<
    NovelBackendOptions,
    "streamPlayRehearsalActor" | "runPlayRehearsalReferee"
  >,
): Promise<string> {
  const server = await startNovelHttpBackend({
    host: "127.0.0.1",
    port: 0,
    workspaceRoot,
    ...options,
  });
  cleanupCallbacks.push(async () => {
    await server.close();
  });
  return server.url;
}

async function createSession(baseUrl: string, id: string): Promise<PlaySession> {
  const input = createSessionInput(id);
  const { scheduledEvents: _scheduledEvents, ...requestInput } = input;
  const result = await postJson<{ session: PlaySession }>(
    `${baseUrl}/api/workspace/play-sessions`,
    {
      ...requestInput,
      purpose: "sceneRehearsal",
      startMode: "guided",
    },
  );
  expect(result.response.status).toBe(200);
  return result.body.session;
}

async function createAttempt(
  baseUrl: string,
  sessionId: string,
  baseRevision: number,
): Promise<PlayTurnAttempt> {
  const result = await postJson<{ attempt: PlayTurnAttempt }>(
    `${baseUrl}/api/workspace/play-sessions/${sessionId}/attempts`,
    { baseRevision },
  );
  expect(result.response.status).toBe(200);
  return result.body.attempt;
}

async function streamStep(
  baseUrl: string,
  sessionId: string,
  attemptId: string,
  body: {
    expectedAttemptRevision: number;
    idempotencyKey: string;
    mode: "next" | "retry";
    sourceStepRef?: string;
  },
): Promise<{
  response: Response;
  raw: string;
  events: SseEvent[];
  stepRunId: string;
}> {
  const response = await fetch(stepStreamUrl(baseUrl, sessionId, attemptId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const stepRunId = response.headers.get("x-oan-play-step-run-id");
  if (!stepRunId) {
    throw new Error(`Missing step run header: ${raw}`);
  }
  return {
    response,
    raw,
    events: parseSseEvents(raw),
    stepRunId,
  };
}

function stepStreamUrl(baseUrl: string, sessionId: string, attemptId: string): string {
  return `${baseUrl}/api/workspace/play-sessions/${sessionId}/attempts/${attemptId}/steps/next/stream`;
}

async function postJson<T>(url: string, body: unknown): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: (await response.json()) as T,
  };
}

async function getJson<T>(url: string): Promise<JsonResponse<T>> {
  const response = await fetch(url);
  return {
    response,
    body: (await response.json()) as T,
  };
}

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      await access(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 2));
  }
  throw new Error(`Timed out waiting for path: ${path}`);
}

function parseSseEvents(raw: string): SseEvent[] {
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data) as SseEvent);
}

function findEvent(events: SseEvent[], type: string): SseEvent {
  const event = events.find((candidate) => candidate.type === type);
  if (!event) {
    throw new Error(`Expected SSE event ${type}, received ${JSON.stringify(events)}`);
  }
  return event;
}

async function snapshotCommittedSessionFiles(
  sessionDirectory: string,
): Promise<Record<string, string>> {
  const entries: Array<[string, string]> = [];

  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".recovery") {
        continue;
      }
      const absolutePath = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else {
        entries.push([relativePath, await readFile(absolutePath, "utf8")]);
      }
    }
  }

  await visit(sessionDirectory, "");
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

async function* defaultActor(_input: NovelBackendPlayRehearsalActorInput) {
  yield "Alice raises the ticket.";
}

async function defaultReferee(_input: NovelBackendPlayRehearsalRefereeInput) {
  return [
    "The station responds to Alice's move.",
    "```oan-play-settlement",
    JSON.stringify({
      events: [],
      pressureChanges: [],
      agendaChanges: [],
      scheduledEventChanges: [],
      stateDelta: {},
      observations: [],
      suggestedActions: [],
    }),
    "```",
  ].join("\n");
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
