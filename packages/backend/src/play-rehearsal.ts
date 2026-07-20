import { randomUUID } from 'node:crypto';

import {
  acceptPlayTurnAttemptStep,
  applyPlayTurnAttemptRedirect,
  createPlayParticipantKnowledgeEvidence,
  addPlayTurnAttemptStep,
  cancelPlayTurnAttempt,
  createCharacterPerceptionPackage,
  evaluatePlaySessionEligibleEvents,
  finalizePlaySceneRehearsalAttempt,
  findPlayAttemptMutationReceipt,
  fingerprintPlayAttemptRequest,
  fingerprintPlayTurnAttemptStepOperation,
  listPlayKnowledgeRevealCandidates,
  grantPlayTurnAttemptKnowledge,
  insertPlayTurnAttemptActor,
  listPlayTurnAttemptRecoveries,
  listPlayRedirectConstraintRefs,
  parsePlayWorldRefereeResponse,
  preparePlayTurnAttemptRetry,
  projectPlaySceneMemory,
  projectSelectedPlayRehearsalEvidence,
  readPlaySessionFiles,
  readPlaySceneMemory,
  readPlayTurnAttemptRecovery,
  startPlaySceneRehearsalAttempt,
  revisePlayTurnAttemptProjection,
  withPlayTurnAttemptRecoveryTransaction,
  writePlaySceneMemory,
} from '@oh-awesome-novel/core';
import type {
  CharacterPerceptionPackage,
  CharacterStepDraft,
  LlmProviderConfig,
  NarrativeBlock,
  PlayAttemptMutationReceipt,
  PlayDirectorKnowledgeGrant,
  PlaySession,
  PlayContextSourceTrace,
  PlayTurnAttempt,
  PlaySceneMemoryArtifact,
  PlayWorldRefereeSettlement,
} from '@oh-awesome-novel/core';
import {
  completePlayRehearsalReferee,
  streamPlayRehearsalActorGeneration,
} from '@oh-awesome-novel/agent';
import type {
  PlayRehearsalActorPromptInput,
  PlayRehearsalModelResolver,
} from '@oh-awesome-novel/agent';

const MAX_ACTOR_NARRATIVE_CHARACTERS = 12_000;

export interface NovelBackendPlayRehearsalActorInput {
  readonly promptInput: PlayRehearsalActorPromptInput;
  readonly abortSignal: AbortSignal;
}

export interface NovelBackendPlayRehearsalRefereeInput {
  readonly prompt: string;
  readonly abortSignal: AbortSignal;
}

export interface PlayRehearsalModelRuntime {
  providerConfig: LlmProviderConfig;
  resolveModel: PlayRehearsalModelResolver;
}

export interface PlayRehearsalBackendControllerOptions {
  getWorkspaceRoot(): string;
  getModelRuntime(): Promise<PlayRehearsalModelRuntime>;
  tryReserveSession(workspaceRoot: string, sessionId: string): boolean;
  releaseSession(workspaceRoot: string, sessionId: string): void;
  streamActor?(input: NovelBackendPlayRehearsalActorInput): AsyncIterable<string>;
  runReferee?(input: NovelBackendPlayRehearsalRefereeInput): Promise<string>;
}

export interface PlayRehearsalStructuredError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class PlayRehearsalRequestError extends Error {
  readonly name = 'PlayRehearsalRequestError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface PlayRehearsalStepStreamInput {
  expectedAttemptRevision: number;
  idempotencyKey: string;
  mode: 'next' | 'retry';
  sourceStepRef?: string;
}

type PlayRehearsalStepRunStatus =
  | 'starting'
  | 'streaming'
  | 'refereeing'
  | 'committing'
  | 'prepared'
  | 'aborting'
  | 'aborted'
  | 'failed';

interface PlayRehearsalStepRun {
  workspaceRoot: string;
  sessionId: string;
  attemptId: string;
  stepRunId: string;
  abortController: AbortController;
  status: PlayRehearsalStepRunStatus;
  stepRef?: string;
  error?: PlayRehearsalStructuredError;
}

export interface PlayRehearsalBackendController {
  hasActiveStepRun(workspaceRoot?: string): boolean;
  hasActiveAttempt(workspaceRoot: string, sessionId: string): Promise<boolean>;
  createAttempt(sessionId: string, body: unknown): Promise<{ attempt: PlayTurnAttempt }>;
  getActiveAttempt(sessionId: string): Promise<{ attempt: PlayTurnAttempt | null }>;
  getAttempt(sessionId: string, attemptId: string): Promise<{ attempt: PlayTurnAttempt }>;
  streamStep(
    sessionId: string,
    attemptId: string,
    body: unknown,
    requestSignal?: AbortSignal,
  ): Promise<Response>;
  stopStep(
    sessionId: string,
    attemptId: string,
    stepRunId: string,
  ): Promise<Record<string, unknown>>;
  acceptStep(
    sessionId: string,
    attemptId: string,
    body: unknown,
  ): Promise<Record<string, unknown>>;
  finalizeAttempt(
    sessionId: string,
    attemptId: string,
    body: unknown,
  ): Promise<Record<string, unknown>>;
  cancelAttempt(
    sessionId: string,
    attemptId: string,
    body: unknown,
  ): Promise<Record<string, unknown>>;
  getSceneMemory(
    sessionId: string,
    lens: unknown,
  ): Promise<{ memory: PlaySceneMemoryArtifact | null }>;
  rebuildSceneMemory(
    sessionId: string,
    body: unknown,
  ): Promise<{ memory: PlaySceneMemoryArtifact }>;
}

export function createPlayRehearsalBackendController(
  options: PlayRehearsalBackendControllerOptions,
): PlayRehearsalBackendController {
  const stepRuns = new Map<string, PlayRehearsalStepRun>();

  return {
    hasActiveStepRun(workspaceRoot) {
      return [...stepRuns.values()].some((run) =>
        isActiveStepRun(run) &&
        (workspaceRoot === undefined || run.workspaceRoot === workspaceRoot));
    },

    async hasActiveAttempt(workspaceRoot, sessionId) {
      return (await listPlayTurnAttemptRecoveries(workspaceRoot, sessionId))
        .some((summary) => summary.classification === 'active');
    },

    async createAttempt(sessionIdValue, bodyValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const body = requireBody(bodyValue, ['baseRevision'], 'Play attempt create request');
      const baseRevision = requireNonNegativeInteger(body.baseRevision, 'baseRevision');
      return withSessionReservation(options, workspaceRoot, sessionId, async () => {
        const active = await readActiveAttempt(workspaceRoot, sessionId);
        if (active) {
          throw new PlayRehearsalRequestError(
            409,
            'active_attempt',
            `Play session already has an active rehearsal attempt: ${active.id}.`,
            { attemptId: active.id, attemptRevision: active.attemptRevision },
          );
        }
        const attempt = await startPlaySceneRehearsalAttempt(workspaceRoot, {
          sessionId,
          attemptId: `attempt-${randomUUID()}`,
          baseRevision,
        });
        return { attempt };
      });
    },

    async getActiveAttempt(sessionIdValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      return { attempt: await readActiveAttempt(workspaceRoot, sessionId) ?? null };
    },

    async getAttempt(sessionIdValue, attemptIdValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const attemptId = requireSafeWireId(attemptIdValue, 'attemptId');
      return {
        attempt: await readPlayTurnAttemptRecovery(workspaceRoot, sessionId, attemptId),
      };
    },

    async streamStep(sessionIdValue, attemptIdValue, bodyValue, requestSignal) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const attemptId = requireSafeWireId(attemptIdValue, 'attemptId');
      const body = normalizeStepStreamInput(bodyValue);
      const mutationKey = createAttemptMutationKey(workspaceRoot, sessionId, attemptId);
      if (findActiveRun(stepRuns, mutationKey)) {
        throw new PlayRehearsalRequestError(
          409,
          'attempt_busy',
          'The Play rehearsal attempt already has an active mutation.',
        );
      }

      const attempt = await withPlayTurnAttemptRecoveryTransaction(
        workspaceRoot,
        sessionId,
        async (recovery) => {
          await assertRehearsalAttemptNotCommitted(
            workspaceRoot,
            sessionId,
            attemptId,
            'step',
            () => recovery.remove(attemptId),
          );
          return recovery.read(attemptId);
        },
      );
      const operation = body.mode === 'retry'
        ? { mode: 'retry' as const, sourceStepRef: body.sourceStepRef! }
        : { mode: 'next' as const };
      const requestFingerprint = fingerprintPlayTurnAttemptStepOperation(operation);
      const existingReceipt = findPlayAttemptMutationReceipt(
        attempt,
        body.idempotencyKey,
        requestFingerprint,
      );
      const replayStep = existingReceipt
        ? attempt.steps.find((step) => step.id === existingReceipt.resultRef)
        : undefined;
      if (existingReceipt && !replayStep) {
        throw new PlayRehearsalRequestError(
          422,
          'invalid_rehearsal_effect',
          'The saved Play step receipt does not resolve to a step.',
        );
      }
      if (!existingReceipt) {
        assertAttemptRevision(attempt, body.expectedAttemptRevision);
        assertStepOperationReady(attempt, operation);
      }

      const participantRef = replayStep?.participantRef ?? resolveStepParticipant(
        attempt,
        operation,
      );
      const stepRunId = `step-run-${randomUUID()}`;
      const run: PlayRehearsalStepRun = {
        workspaceRoot,
        sessionId,
        attemptId,
        stepRunId,
        abortController: new AbortController(),
        status: 'starting',
        ...(replayStep ? { stepRef: replayStep.id } : {}),
      };
      stepRuns.set(createStepRunKey(workspaceRoot, sessionId, attemptId, stepRunId), run);

      const response = createStepStreamResponse({
        options,
        stepRuns,
        run,
        body,
        operation,
        participantRef,
        replay: existingReceipt && replayStep
          ? { attempt, receipt: existingReceipt, step: replayStep }
          : undefined,
      });
      linkAbortSignal(requestSignal, run.abortController);
      return response;
    },

    async stopStep(sessionIdValue, attemptIdValue, stepRunIdValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const attemptId = requireSafeWireId(attemptIdValue, 'attemptId');
      const stepRunId = requireSafeWireId(stepRunIdValue, 'stepRunId');
      const run = stepRuns.get(createStepRunKey(
        workspaceRoot,
        sessionId,
        attemptId,
        stepRunId,
      ));
      if (!run) {
        throw new PlayRehearsalRequestError(
          404,
          'step_run_not_found',
          `Play actor step run was not found: ${stepRunId}.`,
        );
      }
      if (run.status === 'prepared') {
        return { status: 'prepared', runId: stepRunId, stepRef: run.stepRef };
      }
      if (run.status === 'failed') {
        return {
          status: 'failed',
          runId: stepRunId,
          error: run.error?.message ?? 'Play actor step failed.',
        };
      }
      if (run.status === 'aborted') {
        return { status: 'aborted', runId: stepRunId };
      }
      if (run.status === 'aborting') {
        return { status: 'cancelling', runId: stepRunId };
      }
      if (run.status === 'committing') {
        return {
          status: 'committing',
          runId: stepRunId,
          tooLateToStop: true,
        };
      }
      run.status = 'aborting';
      run.abortController.abort('Stopped by the director.');
      return { status: 'cancelling', runId: stepRunId };
    },

    async acceptStep(sessionIdValue, attemptIdValue, bodyValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const attemptId = requireSafeWireId(attemptIdValue, 'attemptId');
      if (!isRecord(bodyValue) || typeof bodyValue.kind !== 'string') {
        throw new PlayRehearsalRequestError(
          400,
          'invalid_request',
          'Play rehearsal intervention request requires a typed kind.',
        );
      }
      if (bodyValue.kind === 'redirectStep') {
        const body = requireBody(
          bodyValue,
          [
            'expectedAttemptRevision',
            'idempotencyKey',
            'kind',
            'stepRef',
            'directorIntent',
            'authorConstraintRefs',
          ],
          'Play redirectStep intervention request',
        );
        return withAttemptMutation(
          stepRuns,
          workspaceRoot,
          sessionId,
          attemptId,
          () => performPlayRedirectIntervention({
            options,
            workspaceRoot,
            sessionId,
            attemptId,
            expectedAttemptRevision: requireNonNegativeInteger(
              body.expectedAttemptRevision,
              'expectedAttemptRevision',
            ),
            idempotencyKey: requireSafeWireId(body.idempotencyKey, 'idempotencyKey'),
            stepRef: requireSafeWireId(body.stepRef, 'stepRef'),
            directorIntent: requireWireText(body.directorIntent, 'directorIntent', 12_000),
            authorConstraintRefs: requireWireIdList(
              body.authorConstraintRefs,
              'authorConstraintRefs',
            ),
          }),
        );
      }
      const allowedFields = bodyValue.kind === 'accept'
        ? ['expectedAttemptRevision', 'idempotencyKey', 'kind', 'stepRef']
        : bodyValue.kind === 'reviseProjection'
          ? [
              'expectedAttemptRevision',
              'idempotencyKey',
              'kind',
              'stepRef',
              'replacementBlocks',
              'expectedEffectFingerprint',
            ]
          : bodyValue.kind === 'insertActor'
            ? [
                'expectedAttemptRevision',
                'idempotencyKey',
                'kind',
                'participantRef',
                'beforeStepRef',
                'afterStepRef',
              ]
            : bodyValue.kind === 'grantKnowledge'
              ? [
                  'expectedAttemptRevision',
                  'idempotencyKey',
                  'kind',
                  'participantRef',
                  'effectiveFromStepRef',
                  'grant',
                ]
              : undefined;
      if (!allowedFields) {
        throw new PlayRehearsalRequestError(
          400,
          'invalid_request',
          `Unsupported Play Director intervention: ${bodyValue.kind}.`,
        );
      }
      const body = requireBody(
        bodyValue,
        allowedFields,
        'Play rehearsal intervention request',
      );
      const common = {
        expectedAttemptRevision: requireNonNegativeInteger(
          body.expectedAttemptRevision,
          'expectedAttemptRevision',
        ),
        idempotencyKey: requireSafeWireId(body.idempotencyKey, 'idempotencyKey'),
        interventionId: `intervention-${requireSafeWireId(
          body.idempotencyKey,
          'idempotencyKey',
        )}`,
      };
      return withAttemptMutation(
        stepRuns,
        workspaceRoot,
        sessionId,
        attemptId,
        () => withPlayTurnAttemptRecoveryTransaction(
          workspaceRoot,
          sessionId,
          async (recovery) => {
            await assertRehearsalAttemptNotCommitted(
              workspaceRoot,
              sessionId,
              attemptId,
              'accept',
              () => recovery.remove(attemptId),
            );
            const attempt = await recovery.read(attemptId);
            const session = body.kind === 'grantKnowledge'
              ? await readPlaySessionFiles(workspaceRoot, sessionId)
              : undefined;
            const result = body.kind === 'accept'
              ? acceptPlayTurnAttemptStep(attempt, {
                  expectedAttemptRevision: common.expectedAttemptRevision,
                  idempotencyKey: common.idempotencyKey,
                  stepRef: requireSafeWireId(body.stepRef, 'stepRef'),
                })
              : body.kind === 'reviseProjection'
                ? revisePlayTurnAttemptProjection(attempt, {
                    ...common,
                    stepRef: requireSafeWireId(body.stepRef, 'stepRef'),
                    replacementBlocks: body.replacementBlocks as NarrativeBlock[],
                    expectedEffectFingerprint: requireSha256WireValue(
                      body.expectedEffectFingerprint,
                      'expectedEffectFingerprint',
                    ),
                  })
                : body.kind === 'insertActor'
                  ? insertPlayTurnAttemptActor(attempt, {
                      ...common,
                      participantRef: requireSafeWireId(
                        body.participantRef,
                        'participantRef',
                      ),
                      ...(body.beforeStepRef === undefined
                        ? {}
                        : { beforeStepRef: requireSafeWireId(body.beforeStepRef, 'beforeStepRef') }),
                      ...(body.afterStepRef === undefined
                        ? {}
                        : { afterStepRef: requireSafeWireId(body.afterStepRef, 'afterStepRef') }),
                    })
                  : grantPlayTurnAttemptKnowledge(attempt, {
                      ...common,
                      participantRef: requireSafeWireId(
                        body.participantRef,
                        'participantRef',
                      ),
                      effectiveFromStepRef: requireSafeWireId(
                        body.effectiveFromStepRef,
                        'effectiveFromStepRef',
                      ),
                      grant: requireDirectorKnowledgeGrant(body.grant),
                      availableFactRefs: [
                        ...(session?.sceneRehearsal?.initialKnowledgeEvidence.map(
                          (evidence) => evidence.id,
                        ) ?? []),
                        ...(session ? selectPlaySessionEvents(session).map((event) => event.id) : []),
                      ],
                    });
            if (!result.replayed) {
              await recovery.write(result.attempt, {
                expectedAttemptRevision: common.expectedAttemptRevision,
              });
            }
            return result;
          },
        ),
      );
    },

    async finalizeAttempt(sessionIdValue, attemptIdValue, bodyValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const attemptId = requireSafeWireId(attemptIdValue, 'attemptId');
      const body = requireBody(
        bodyValue,
        ['baseRevision', 'expectedAttemptRevision', 'idempotencyKey', 'selectedHeadRef'],
        'Play rehearsal finalize request',
      );
      const baseRevision = requireNonNegativeInteger(body.baseRevision, 'baseRevision');
      const expectedAttemptRevision = requireNonNegativeInteger(
        body.expectedAttemptRevision,
        'expectedAttemptRevision',
      );
      const idempotencyKey = requireSafeWireId(body.idempotencyKey, 'idempotencyKey');
      const selectedHeadRef = requireSafeWireId(body.selectedHeadRef, 'selectedHeadRef');
      return withAttemptMutation(
        stepRuns,
        workspaceRoot,
        sessionId,
        attemptId,
        async () => {
          return withSessionReservation(options, workspaceRoot, sessionId, async () => {
            const session = await readPlaySessionFiles(workspaceRoot, sessionId);
            const result = await finalizePlaySceneRehearsalAttempt(workspaceRoot, {
              sessionId,
              attemptId,
              baseRevision,
              expectedAttemptRevision,
              selectedHeadRef,
              idempotencyKey,
              userText: formatRehearsalActionText(session),
              contextTraceSources: createRehearsalContextSourceTraces(session),
            });
            return {
              session: result.session,
              ...(result.attempt ? { attempt: result.attempt } : {}),
              artifact: result.artifact,
              evidence: result.evidence,
              receipt: result.evidence.finalizeReceipt,
              replayed: result.replayed,
            };
          });
        },
      );
    },

    async cancelAttempt(sessionIdValue, attemptIdValue, bodyValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const attemptId = requireSafeWireId(attemptIdValue, 'attemptId');
      const body = requireBody(
        bodyValue,
        ['expectedAttemptRevision', 'idempotencyKey'],
        'Play rehearsal cancel request',
      );
      const input = {
        expectedAttemptRevision: requireNonNegativeInteger(
          body.expectedAttemptRevision,
          'expectedAttemptRevision',
        ),
        idempotencyKey: requireSafeWireId(body.idempotencyKey, 'idempotencyKey'),
      };
      return withAttemptMutation(
        stepRuns,
        workspaceRoot,
        sessionId,
        attemptId,
        () => withPlayTurnAttemptRecoveryTransaction(
          workspaceRoot,
          sessionId,
          async (recovery) => {
            await assertRehearsalAttemptNotCommitted(
              workspaceRoot,
              sessionId,
              attemptId,
              'cancel',
              () => recovery.remove(attemptId),
            );
            const attempt = await recovery.read(attemptId);
            const result = cancelPlayTurnAttempt(attempt, input);
            if (!result.replayed) {
              await recovery.write(result.attempt, {
                expectedAttemptRevision: input.expectedAttemptRevision,
              });
            }
            return result;
          },
        ),
      );
    },

    async getSceneMemory(sessionIdValue, lensValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const lens = requireMemoryLens(lensValue);
      const memory = await readPlaySceneMemory(workspaceRoot, sessionId, lens);
      return { memory: memory ? projectPlaySceneMemory(memory, lens) : null };
    },

    async rebuildSceneMemory(sessionIdValue, bodyValue) {
      const workspaceRoot = options.getWorkspaceRoot();
      const sessionId = requireSafeWireId(sessionIdValue, 'sessionId');
      const body = requireBody(bodyValue, ['lens'], 'Play Scene Memory rebuild request');
      const lens = requireMemoryLens(body.lens);
      const memory = await writePlaySceneMemory(workspaceRoot, sessionId, lens);
      return {
        memory: projectPlaySceneMemory(memory, lens),
      };
    },
  };
}

async function performPlayRedirectIntervention(input: {
  options: PlayRehearsalBackendControllerOptions;
  workspaceRoot: string;
  sessionId: string;
  attemptId: string;
  expectedAttemptRevision: number;
  idempotencyKey: string;
  stepRef: string;
  directorIntent: string;
  authorConstraintRefs: string[];
}): Promise<Record<string, unknown>> {
  const requestFingerprint = fingerprintPlayAttemptRequest({
    kind: 'redirectStep',
    stepRef: input.stepRef,
    directorIntent: input.directorIntent,
    authorConstraintRefs: input.authorConstraintRefs,
  });
  const session = await readPlaySessionFiles(input.workspaceRoot, input.sessionId);
  const attempt = await readPlayTurnAttemptRecovery(
    input.workspaceRoot,
    input.sessionId,
    input.attemptId,
  );
  const existingReceipt = findPlayAttemptMutationReceipt(
    attempt,
    input.idempotencyKey,
    requestFingerprint,
  );
  if (existingReceipt) {
    return { attempt, receipt: existingReceipt, replayed: true };
  }
  assertAttemptRevision(attempt, input.expectedAttemptRevision);
  const target = attempt.steps.find((step) =>
    step.id === input.stepRef && (step.status === 'selected' || step.status === 'draft'));
  if (!target) {
    throw new PlayRehearsalRequestError(
      404,
      'step_not_found',
      `Play redirectStep target is not on the live branch: ${input.stepRef}.`,
    );
  }
  const sidecar = session.sceneRehearsal;
  if (!sidecar || session.schemaVersion !== 5) {
    throw new PlayRehearsalRequestError(
      422,
      'invalid_rehearsal_effect',
      'Play redirectStep requires a v5 Scene Rehearsal session.',
    );
  }
  const selectedPrefixRefs = attempt.selectedStepRefs.slice(0, target.queueIndex);
  const prefixSet = new Set(selectedPrefixRefs);
  const selectedPrefixSteps = attempt.steps.filter((step) => prefixSet.has(step.id));
  const contextAttempt: PlayTurnAttempt = {
    ...attempt,
    status: 'running',
    selectedStepRefs: selectedPrefixRefs,
    selectedHeadRef: selectedPrefixRefs.at(-1),
    currentStepRef: undefined,
  };
  const committedBlocks = projectSelectedPlayRehearsalEvidence(
    session.turnArtifacts,
    session.selectedTurnIds,
    session.rehearsalScenes ?? [],
  ).flatMap((evidence) => evidence.narrativeBlocks);
  const selectedVisibleBlocks = [
    ...committedBlocks,
    ...selectedPrefixSteps.flatMap((step) => step.narrativeBlocks),
  ].filter(isParticipantVisibleBlock).filter((block, index, blocks) =>
    blocks.findIndex((candidate) => candidate.id === block.id) === index);
  const selectedEvents = selectPlaySessionEvents(session);
  const observedEventRefs = new Set(selectedVisibleBlocks.flatMap((block) => block.eventRefs));
  const visibleEvents = selectedEvents.filter((event) =>
    observedEventRefs.has(event.id) && event.visibility !== 'playerUnknown');
  const perception = createCharacterPerceptionPackage(
    sidecar,
    target.participantRef,
    {
      sceneRevision: session.revision,
      worldClock: session.worldClock,
      visibleEventRefs: visibleEvents.map((event) => event.id),
      observedNarrativeBlockRefs: selectedVisibleBlocks.map((block) => block.id),
      grantedKnowledgeEvidence: createPlayParticipantKnowledgeEvidence({
        session,
        sidecar,
        participantRef: target.participantRef,
        attempt,
        throughQueueIndex: target.queueIndex,
      }),
    },
  );
  const allowedConstraintRefs = new Set(listPlayRedirectConstraintRefs(perception));
  const forbiddenConstraintRef = input.authorConstraintRefs.find((constraintRef) =>
    !allowedConstraintRefs.has(constraintRef));
  if (forbiddenConstraintRef) {
    throw new PlayRehearsalRequestError(
      422,
      'invalid_rehearsal_effect',
      `Play redirect constraint is outside the target participant perception: ${forbiddenConstraintRef}.`,
    );
  }
  const resolvedAuthorConstraints = resolvePlayRedirectConstraintRecords(
    input.authorConstraintRefs,
    perception,
    visibleEvents,
    selectedVisibleBlocks,
  );
  const basePromptInput = createActorPromptInput(session, perception, selectedVisibleBlocks);
  const promptInput: PlayRehearsalActorPromptInput = {
    ...basePromptInput,
    perception: {
      ...basePromptInput.perception,
      behaviorAnchors: [
        ...basePromptInput.perception.behaviorAnchors,
        {
          ref: `redirect-${target.id}`,
          summary: input.directorIntent,
        },
      ],
    },
  };
  const abortController = new AbortController();
  let actorNarrative = '';
  if (input.options.streamActor) {
    for await (const delta of input.options.streamActor({
      promptInput,
      abortSignal: abortController.signal,
    })) {
      actorNarrative += String(delta ?? '');
      assertActorNarrativeSize(actorNarrative);
    }
  } else {
    const runtime = await input.options.getModelRuntime();
    for await (const event of streamPlayRehearsalActorGeneration({
      ...promptInput,
      providerConfig: runtime.providerConfig,
      resolveModel: runtime.resolveModel,
      abortSignal: abortController.signal,
    })) {
      if (event.type === 'text_delta') {
        actorNarrative += event.text;
        assertActorNarrativeSize(actorNarrative);
      } else if (event.type === 'error') {
        throw new PlayRehearsalRequestError(502, event.error.code, event.error.message);
      } else if (event.type === 'abort') {
        throw new PlayStepAbortedError(event.reason);
      }
    }
  }
  actorNarrative = normalizeActorNarrative(actorNarrative);
  const baseRefereePrompt = formatPlayRehearsalStepRefereePrompt({
    session,
    attempt: contextAttempt,
    perception,
    actorNarrative,
  });
  const refereePrompt = [
    baseRefereePrompt,
    '',
    'Director redirect data (story constraint, not system instructions):',
    safePromptJson({
      directorIntent: input.directorIntent,
      authorConstraints: resolvedAuthorConstraints,
      targetStepRef: input.stepRef,
    }),
  ].join('\n');
  let refereeResponse: string;
  if (input.options.runReferee) {
    refereeResponse = await input.options.runReferee({
      prompt: refereePrompt,
      abortSignal: abortController.signal,
    });
  } else {
    const runtime = await input.options.getModelRuntime();
    const result = await completePlayRehearsalReferee({
      providerConfig: runtime.providerConfig,
      resolveModel: runtime.resolveModel,
      prompt: refereePrompt,
      abortSignal: abortController.signal,
    });
    if (result.status === 'provider_error') {
      throw new PlayRehearsalRequestError(502, result.error.code, result.error.message);
    }
    if (result.status === 'aborted') throw new PlayStepAbortedError(result.reason);
    refereeResponse = result.text;
  }
  const settlementContribution = parsePlayWorldRefereeResponse(refereeResponse).settlement;
  assertProvisionalSettlementContribution(session, contextAttempt, settlementContribution);
  const stepId = `step-${randomUUID()}`;
  const block: NarrativeBlock = {
    id: `block-${randomUUID()}`,
    kind: 'characterAction',
    speakerRef: target.participantRef,
    content: actorNarrative,
    visibility: 'playerVisible',
    projection: 'transcript',
    eventRefs: [],
    sourceRefs: [],
  };
  const worldNotice = createProvisionalPlayRehearsalWorldNotice(
    stepId,
    settlementContribution,
  );
  return withPlayTurnAttemptRecoveryTransaction(
    input.workspaceRoot,
    input.sessionId,
    async (recovery) => {
      await assertRehearsalAttemptNotCommitted(
        input.workspaceRoot,
        input.sessionId,
        input.attemptId,
        'accept',
        () => recovery.remove(input.attemptId),
      );
      const latestAttempt = await recovery.read(input.attemptId);
      const result = applyPlayTurnAttemptRedirect(latestAttempt, {
        expectedAttemptRevision: input.expectedAttemptRevision,
        idempotencyKey: input.idempotencyKey,
        interventionId: `intervention-${input.idempotencyKey}`,
        stepRef: input.stepRef,
        directorIntent: input.directorIntent,
        authorConstraintRefs: input.authorConstraintRefs,
        perception,
        replacementStep: {
          id: stepId,
          participantRef: target.participantRef,
          queueIndex: target.queueIndex,
          ...(selectedPrefixRefs.at(-1)
            ? { beforeStepRef: selectedPrefixRefs.at(-1) }
            : {}),
          perceptionRef: perception.id,
          intentSummary: input.directorIntent.slice(0, 800),
          narrativeBlocks: worldNotice ? [block, worldNotice] : [block],
          settlementContribution,
          decisionBasisRefs: [
            ...perception.initialKnowledgeEvidence.map((item) => item.id),
            ...perception.grantedKnowledgeEvidence.map((item) => item.id),
          ],
          variantOf: target.id,
          createdAt: new Date().toISOString(),
        },
      });
      if (!result.replayed) {
        await recovery.write(result.attempt, {
          expectedAttemptRevision: input.expectedAttemptRevision,
        });
      }
      return result;
    },
  );
}

function createStepStreamResponse(input: {
  options: PlayRehearsalBackendControllerOptions;
  stepRuns: Map<string, PlayRehearsalStepRun>;
  run: PlayRehearsalStepRun;
  body: PlayRehearsalStepStreamInput;
  operation: { mode: 'next' } | { mode: 'retry'; sourceStepRef: string };
  participantRef: string;
  replay?: {
    attempt: PlayTurnAttempt;
    receipt: PlayAttemptMutationReceipt;
    step: CharacterStepDraft;
  };
}): Response {
  let sequence = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        sequence += 1;
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            ...event,
            eventId: `${input.run.stepRunId}:${sequence}`,
            sequence,
            sessionId: input.run.sessionId,
            attemptId: input.run.attemptId,
            stepRunId: input.run.stepRunId,
          })}\n\n`,
        ));
      };
      const close = () => {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      };

      emit({
        type: 'play.actor.step.started',
        baseAttemptRevision: input.body.expectedAttemptRevision,
        participantRef: input.participantRef,
        mode: input.body.mode,
        ...(input.body.sourceStepRef
          ? { sourceStepRef: input.body.sourceStepRef }
          : {}),
      });
      if (input.body.mode === 'retry') {
        emit({
          type: 'play.actor.step.reset',
          reason: 'Retrying the current actor step as a new provisional variant.',
          provisional: true,
        });
      }

      if (input.replay) {
        input.run.status = 'prepared';
        emit({
          type: 'play.actor.step.prepared',
          attempt: input.replay.attempt,
          step: input.replay.step,
          receipt: input.replay.receipt,
        });
        close();
        scheduleStepRunCleanup(input.stepRuns, input.run);
        return;
      }

      try {
        input.run.status = 'streaming';
        const session = await readPlaySessionFiles(
          input.run.workspaceRoot,
          input.run.sessionId,
        );
        const attempt = await readPlayTurnAttemptRecovery(
          input.run.workspaceRoot,
          input.run.sessionId,
          input.run.attemptId,
        );
        assertAttemptRevision(attempt, input.body.expectedAttemptRevision);
        const sidecar = session.sceneRehearsal;
        if (!sidecar || session.schemaVersion !== 5) {
          throw new PlayRehearsalRequestError(
            422,
            'invalid_rehearsal_effect',
            'Play actor steps require a v5 Scene Rehearsal session.',
          );
        }
        const selectedSteps = resolveSelectedSteps(attempt);
        const committedBlocks = projectSelectedPlayRehearsalEvidence(
          session.turnArtifacts,
          session.selectedTurnIds,
          session.rehearsalScenes ?? [],
        ).flatMap((evidence) => evidence.narrativeBlocks);
        const selectedVisibleBlocks = [
          ...committedBlocks,
          ...selectedSteps.flatMap((step) => step.narrativeBlocks),
        ].filter(isParticipantVisibleBlock).filter((block, index, blocks) =>
          blocks.findIndex((candidate) => candidate.id === block.id) === index);
        const selectedEvents = selectPlaySessionEvents(session);
        const observedEventRefs = new Set(selectedVisibleBlocks.flatMap((block) =>
          block.eventRefs));
        const visibleEvents = selectedEvents.filter((event) =>
          observedEventRefs.has(event.id) && event.visibility !== 'playerUnknown');
        const perception = createCharacterPerceptionPackage(
          sidecar,
          input.participantRef,
          {
            sceneRevision: session.revision,
            worldClock: session.worldClock,
            visibleEventRefs: visibleEvents.map((event) => event.id),
            observedNarrativeBlockRefs: selectedVisibleBlocks.map((block) => block.id),
            grantedKnowledgeEvidence: createPlayParticipantKnowledgeEvidence({
              session,
              sidecar,
              participantRef: input.participantRef,
              attempt,
              throughQueueIndex: attempt.selectedStepRefs.length,
            }),
          },
        );
        const actorPromptInput = createActorPromptInput(
          session,
          perception,
          selectedVisibleBlocks,
        );
        let actorNarrative = '';
        if (input.options.streamActor) {
          const iterator = input.options.streamActor({
            promptInput: actorPromptInput,
            abortSignal: input.run.abortController.signal,
          })[Symbol.asyncIterator]();
          while (true) {
            const next = await nextIteratorWithAbort(
              iterator,
              input.run.abortController.signal,
            );
            if (next.done) break;
            const delta = String(next.value ?? '');
            actorNarrative += delta;
            assertActorNarrativeSize(actorNarrative);
            if (delta) emit({ type: 'play.actor.step.delta', delta, provisional: true });
          }
        } else {
          const runtime = await input.options.getModelRuntime();
          for await (const event of streamPlayRehearsalActorGeneration({
            ...actorPromptInput,
            providerConfig: runtime.providerConfig,
            resolveModel: runtime.resolveModel,
            abortSignal: input.run.abortController.signal,
          })) {
            if (event.type === 'text_delta') {
              actorNarrative += event.text;
              assertActorNarrativeSize(actorNarrative);
              emit({
                type: 'play.actor.step.delta',
                delta: event.text,
                provisional: true,
              });
            } else if (event.type === 'abort') {
              throw new PlayStepAbortedError(event.reason);
            } else if (event.type === 'error') {
              throw new PlayRehearsalRequestError(
                502,
                event.error.code,
                event.error.message,
              );
            }
          }
        }
        actorNarrative = normalizeActorNarrative(actorNarrative);
        throwIfAborted(input.run.abortController.signal);

        input.run.status = 'refereeing';
        const refereePrompt = formatPlayRehearsalStepRefereePrompt({
          session,
          attempt,
          perception,
          actorNarrative,
        });
        let refereeResponse: string;
        if (input.options.runReferee) {
          refereeResponse = await racePromiseWithAbort(
            input.options.runReferee({
              prompt: refereePrompt,
              abortSignal: input.run.abortController.signal,
            }),
            input.run.abortController.signal,
          );
        } else {
          const runtime = await input.options.getModelRuntime();
          const result = await completePlayRehearsalReferee({
            providerConfig: runtime.providerConfig,
            resolveModel: runtime.resolveModel,
            prompt: refereePrompt,
            abortSignal: input.run.abortController.signal,
          });
          if (result.status === 'aborted') {
            throw new PlayStepAbortedError(result.reason);
          }
          if (result.status === 'provider_error') {
            throw new PlayRehearsalRequestError(
              502,
              result.error.code,
              result.error.message,
            );
          }
          refereeResponse = result.text;
        }
        throwIfAborted(input.run.abortController.signal);
        const settlementContribution = parsePlayWorldRefereeResponse(
          refereeResponse,
        ).settlement;
        assertProvisionalSettlementContribution(
          session,
          attempt,
          settlementContribution,
        );
        throwIfAborted(input.run.abortController.signal);
        const stepId = `step-${randomUUID()}`;
        const block: NarrativeBlock = {
          id: `block-${randomUUID()}`,
          kind: 'characterAction',
          speakerRef: input.participantRef,
          content: actorNarrative,
          visibility: 'playerVisible',
          projection: 'transcript',
          eventRefs: [],
          sourceRefs: [],
        };
        const worldNotice = createProvisionalPlayRehearsalWorldNotice(
          stepId,
          settlementContribution,
        );
        const mutation = await withPlayTurnAttemptRecoveryTransaction(
          input.run.workspaceRoot,
          input.run.sessionId,
          async (recovery) => {
            await assertRehearsalAttemptNotCommitted(
              input.run.workspaceRoot,
              input.run.sessionId,
              input.run.attemptId,
              'step',
              () => recovery.remove(input.run.attemptId),
            );
            const latestAttempt = await recovery.read(input.run.attemptId);
            throwIfAborted(input.run.abortController.signal);
            const retryPreparation = input.operation.mode === 'retry'
              ? preparePlayTurnAttemptRetry(
                  latestAttempt,
                  input.operation.sourceStepRef,
                )
              : undefined;
            const result = addPlayTurnAttemptStep(latestAttempt, {
              expectedAttemptRevision: input.body.expectedAttemptRevision,
              idempotencyKey: input.body.idempotencyKey,
              operation: input.operation,
              perception,
              step: {
                id: stepId,
                participantRef: input.participantRef,
                queueIndex: latestAttempt.selectedStepRefs.length,
                ...(latestAttempt.selectedHeadRef
                  ? { beforeStepRef: latestAttempt.selectedHeadRef }
                  : {}),
                perceptionRef: perception.id,
                intentSummary: perception.participant.currentGoal ??
                  actorNarrative.slice(0, 800),
                narrativeBlocks: worldNotice ? [block, worldNotice] : [block],
                settlementContribution,
                decisionBasisRefs: perception.initialKnowledgeEvidence
                  .map((item) => item.id)
                  .concat(perception.grantedKnowledgeEvidence.map((item) => item.id)),
                ...(retryPreparation
                  ? { variantOf: retryPreparation.variantOf }
                  : {}),
                createdAt: new Date().toISOString(),
              },
            });
            // This is the irreversible step boundary. Stop may abort provider
            // work before this point; once persistence starts it reconciles to
            // authoritative attempt truth.
            input.run.stepRef = result.receipt.resultRef;
            input.run.status = 'committing';
            await recovery.write(result.attempt, {
              expectedAttemptRevision: input.body.expectedAttemptRevision,
            });
            return result;
          },
        );
        const step = mutation.attempt.steps.find((candidate) =>
          candidate.id === mutation.receipt.resultRef);
        if (!step) {
          throw new Error('Prepared Play actor step was not persisted.');
        }
        input.run.status = 'prepared';
        input.run.stepRef = step.id;
        emit({
          type: 'play.actor.step.prepared',
          attempt: mutation.attempt,
          step,
          receipt: mutation.receipt,
        });
      } catch (error) {
        if (
          input.run.status !== 'committing' && (
            error instanceof PlayStepAbortedError ||
            input.run.abortController.signal.aborted
          )
        ) {
          input.run.status = 'aborting';
          emit({
            type: 'play.actor.step.stream-aborted',
            attemptRevision: input.body.expectedAttemptRevision,
            committed: false,
            reason: error instanceof PlayStepAbortedError
              ? error.message
              : readAbortReason(input.run.abortController.signal),
          });
          input.run.status = 'aborted';
        } else {
          input.run.status = 'failed';
          input.run.error = toStructuredError(error);
          emit({ type: 'play.actor.step.failed', error: input.run.error });
        }
      } finally {
        close();
        scheduleStepRunCleanup(input.stepRuns, input.run);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'X-OAN-Play-Step-Run-Id': input.run.stepRunId,
    },
  });
}

export function formatPlayRehearsalStepRefereePrompt(input: {
  session: PlaySession;
  attempt: PlayTurnAttempt;
  perception: CharacterPerceptionPackage;
  actorNarrative: string;
}): string {
  const selectedSteps = resolveSelectedSteps(input.attempt);
  const eligible = evaluatePlaySessionEligibleEvents(input.session, {
    actionKind: 'do',
    userText: formatRehearsalActionText(input.session),
  });
  const usedMomentumRefs = new Set(selectedSteps.flatMap((step) =>
    step.settlementContribution.events.flatMap((event) => [
      event.cause.pressureId,
      event.cause.agendaId,
    ].filter((value): value is string => Boolean(value))),
  ));
  const priorEventCount = selectedSteps.reduce(
    (count, step) => count + step.settlementContribution.events.length,
    0,
  );
  const usedKnowledgeSubjectIds = new Set(selectedSteps.flatMap((step) =>
    step.settlementContribution.knowledgeChanges.flatMap((change) =>
      change.type === 'revealEvent' ? [change.subjectEventId] : []),
  ));
  const revealCandidates = listPlayKnowledgeRevealCandidates({
    playLocalState: input.session.playLocalState,
    selectedEvents: selectPlaySessionEvents(input.session),
  }).filter((candidate) => !usedKnowledgeSubjectIds.has(candidate.subjectEventId));
  const payload = {
    session: {
      id: input.session.id,
      revision: input.session.revision,
      worldClock: input.session.worldClock,
      sceneStart: input.session.sceneStart,
      eventPolicy: input.session.eventPolicy,
      playLocalState: input.session.playLocalState,
      playLocalStateVisibility: input.session.playLocalStateVisibility,
      recentEvents: selectPlaySessionEvents(input.session).slice(-12),
      scheduledEvents: input.session.scheduledEvents,
      revealCandidates,
    },
    sceneRehearsal: input.session.sceneRehearsal,
    attempt: {
      id: input.attempt.id,
      baseRevision: input.attempt.baseRevision,
      selectedStepRefs: input.attempt.selectedStepRefs,
      priorSettlementContributions: selectedSteps.map((step) => ({
        stepRef: step.id,
        settlement: step.settlementContribution,
      })),
    },
    currentParticipant: {
      participantRef: input.perception.participantRef,
      perceptionRef: input.perception.id,
      actorNarrative: input.actorNarrative,
    },
    eligibleWorldMotion: {
      effectiveBudget: eligible.effectiveBudget,
      remainingExternalEventBudget: Math.max(
        0,
        input.session.eventPolicy.maxExternalEventsPerTurn - priorEventCount,
      ),
      candidates: eligible.candidates.filter((candidate) =>
        !usedMomentumRefs.has(candidate.pressureId ?? candidate.agendaId ?? '')),
    },
  };
  return [
    'Evaluate exactly one provisional Scene Rehearsal actor step.',
    'The character voice module has already produced actorNarrative. Do not rewrite or contradict it.',
    'You are the only referee allowed to propose Play-local effects.',
    'Return a short player-visible acknowledgement, then exactly one final fenced `oan-play-settlement` JSON object.',
    'The JSON fields are elapsed, worldTimeAnchor, events, pressureChanges, agendaChanges, scheduledEventChanges, knowledgeChanges, stateDelta, observations, suggestedActions.',
    'This is a contribution, not a committed turn: never include cause.triggerId and never settle hard-due events. The host adds hard-due effects exactly once at Finish.',
    'Do not repeat an event, momentum id, scheduled change, or state key already used by a prior selected contribution.',
    'Reveal an earlier hidden event only through a typed knowledgeChanges item from session.revealCandidates. Pair it with exactly one informationSpread event whose visibility equals the target and whose cause.sourceEventIds contains the candidate subjectEventId. Never reveal the same subject twice in one attempt.',
    'Use pressureId or agendaId only from eligibleWorldMotion.candidates, and include the matching typed change.',
    'Treat Director objective/risk, another participant\'s private knowledge, playerUnknown events/state/schedules/momentum, and hidden cause details as referee-private context.',
    'For playerVisible or rumor events, title and summary must contain only consequences perceivable at that visibility. Never reveal referee-private context in them or in suggestedActions.',
    'If an effect itself is secret, mark it playerUnknown. Hidden causal explanation may stay only in cause.reason; do not copy it into a public title, summary, observation, or state value.',
    'Use session.playLocalStateVisibility to distinguish public, rumor, and hidden state. Do not widen the visibility of an existing fact through stateDelta.',
    'Do not assign ids, revisions, turn ids, timestamps, or canonical flags.',
    '<oan-play-rehearsal-referee-input>',
    safePromptJson(payload),
    '</oan-play-rehearsal-referee-input>',
  ].join('\n');
}

function createRehearsalContextSourceTraces(
  session: PlaySession,
): PlayContextSourceTrace[] {
  const sidecar = session.sceneRehearsal;
  if (!sidecar) return [];
  const selectedSourceIds = new Set<string>();
  const selectedCharacters = new Map<string, number>();
  const addSelected = (sourceId: string, characters: number): void => {
    selectedSourceIds.add(sourceId);
    selectedCharacters.set(
      sourceId,
      (selectedCharacters.get(sourceId) ?? 0) + characters,
    );
  };
  for (const evidence of sidecar.initialKnowledgeEvidence) {
    if (evidence.provenance.kind === 'sourceBacked') {
      addSelected(evidence.provenance.sourceId, evidence.fact.length);
    }
  }
  if (sidecar.sceneContract.clockProvenance.kind === 'newSessionInitial') {
    for (const sourceId of sidecar.sceneContract.clockProvenance.sourceRefs) {
      addSelected(sourceId, 0);
    }
  }
  for (const field of [
    sidecar.sceneContract.location,
    sidecar.sceneContract.atmosphere,
    sidecar.sceneContract.trigger,
    sidecar.sceneContract.objective,
    sidecar.sceneContract.risk,
  ]) {
    if (field?.provenance.kind !== 'sourceBacked') continue;
    for (const sourceId of field.provenance.sourceRefs) {
      addSelected(sourceId, field.value.length);
    }
  }
  return session.activatedSources.map((source): PlayContextSourceTrace => ({
    sourceId: source.sourceId,
    ...(source.path ? { path: source.path } : {}),
    ...(source.role ? { role: source.role } : {}),
    trust: source.trust,
    budgetLayer: source.budgetLayer,
    semanticBoundary: source.semanticBoundary,
    ...(source.contentHash
      ? { expectedContentHash: source.contentHash }
      : {}),
    ...(selectedSourceIds.has(source.sourceId)
      ? {
          outcome: 'selected',
          selectedCharacterCount: selectedCharacters.get(source.sourceId) ?? 0,
        }
      : {
          outcome: 'omitted',
          omissionReason: 'notSelected',
        }),
  }));
}

function createActorPromptInput(
  session: PlaySession,
  perception: CharacterPerceptionPackage,
  selectedBlocks: NarrativeBlock[],
): PlayRehearsalActorPromptInput {
  const visibleEventsById = new Map(selectPlaySessionEvents(session)
    .filter((event) =>
      event.visibility !== 'playerUnknown' &&
      perception.visibleEventRefs.includes(event.id))
    .map((event) => [event.id, event]));
  const visibleEvents = perception.visibleEventRefs.map((eventRef) => {
    const event = visibleEventsById.get(eventRef);
    if (!event) {
      throw new PlayRehearsalRequestError(
        422,
        'invalid_rehearsal_effect',
        `Play actor perception references an unavailable visible event: ${eventRef}.`,
      );
    }
    return { ref: event.id, title: event.title, summary: event.summary };
  });
  const observedBlockRefs = new Set(perception.observedNarrativeBlockRefs);
  const observedBlocks = selectedBlocks.filter((block) =>
    observedBlockRefs.has(block.id));
  if (observedBlocks.length !== observedBlockRefs.size) {
    throw new PlayRehearsalRequestError(
      422,
      'invalid_rehearsal_effect',
      'Play actor perception references an unavailable observed narrative block.',
    );
  }
  return {
    sceneContract: {
      sceneId: perception.sceneRef,
      sceneRevision: perception.sceneRevision,
      participantRefs: [perception.participantRef],
      worldClock: { ...perception.scene.worldClock },
      ...(perception.scene.location
        ? { location: perception.scene.location.value }
        : {}),
      ...(perception.scene.atmosphere
        ? { atmosphere: perception.scene.atmosphere.value }
        : {}),
      ...(perception.scene.trigger
        ? { trigger: perception.scene.trigger.value }
        : {}),
    },
    perception: {
      snapshotId: perception.id,
      participantRef: perception.participantRef,
      displayName: perception.participant.displayName,
      sceneRevision: perception.sceneRevision,
      ...(perception.participant.position
        ? { position: perception.participant.position }
        : {}),
      ...(perception.participant.emotion
        ? { emotion: perception.participant.emotion }
        : {}),
      ...(perception.participant.currentGoal
        ? { currentGoal: perception.participant.currentGoal }
        : {}),
      visibleFacts: [
        ...perception.initialKnowledgeEvidence.map((evidence) => ({
          ref: evidence.id,
          fact: evidence.fact,
        })),
        ...perception.grantedKnowledgeEvidence.map((evidence) => ({
          ref: evidence.id,
          fact: evidence.fact,
        })),
      ],
      visibleEvents,
      behaviorAnchors: perception.participant.currentGoal
        ? [{ ref: `goal-${perception.participant.participantRef}`, summary: perception.participant.currentGoal }]
        : [],
      observedNarrativeBlockRefs: [...perception.observedNarrativeBlockRefs],
    },
    selectedPriorVisibleBlocks: observedBlocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      ...(block.speakerRef ? { speakerRef: block.speakerRef } : {}),
      content: block.content,
      projection: 'transcript' as const,
      selected: true as const,
      visibleToParticipant: true as const,
    })),
  };
}

function resolveSelectedSteps(attempt: PlayTurnAttempt): CharacterStepDraft[] {
  const byId = new Map(attempt.steps.map((step) => [step.id, step]));
  return attempt.selectedStepRefs.map((stepRef) => {
    const step = byId.get(stepRef);
    if (!step || step.status !== 'selected') {
      throw new PlayRehearsalRequestError(
        422,
        'invalid_rehearsal_effect',
        `Selected Play rehearsal step is missing: ${stepRef}.`,
      );
    }
    return step;
  });
}

function selectPlaySessionEvents(session: PlaySession) {
  const selectedArtifactIds = new Set(session.selectedTurnIds);
  const selectedEventIds = new Set(session.turnArtifacts
    .filter((artifact) => selectedArtifactIds.has(artifact.id))
    .flatMap((artifact) => artifact.eventIds));
  return session.events.filter((event) => selectedEventIds.has(event.id));
}

function assertProvisionalSettlementContribution(
  session: PlaySession,
  attempt: PlayTurnAttempt,
  contribution: PlayWorldRefereeSettlement,
): void {
  const selectedSteps = resolveSelectedSteps(attempt);
  const previousContributions = selectedSteps.map((step) =>
    step.settlementContribution);
  const attemptedHardDue = contribution.events.find((event) =>
    event.cause.triggerId !== undefined);
  if (attemptedHardDue) {
    throw new PlayRehearsalRequestError(
      422,
      'invalid_rehearsal_effect',
      'A provisional actor step cannot settle a hard-due event.',
    );
  }
  const previousEventCount = previousContributions.reduce(
    (count, settlement) => count + settlement.events.length,
    0,
  );
  if (
    previousEventCount + contribution.events.length >
    session.eventPolicy.maxExternalEventsPerTurn
  ) {
    throw new PlayRehearsalRequestError(
      422,
      'invalid_rehearsal_effect',
      'The selected rehearsal steps exceed the external event budget.',
    );
  }
  const usedStateKeys = new Set(previousContributions.flatMap((settlement) =>
    Object.keys(settlement.stateDelta)));
  const duplicateStateKey = Object.keys(contribution.stateDelta).find((key) =>
    usedStateKeys.has(key));
  if (duplicateStateKey) {
    throw new PlayRehearsalRequestError(
      422,
      'invalid_rehearsal_effect',
      `A selected rehearsal step already proposes state key: ${duplicateStateKey}.`,
    );
  }
  const usedKnowledgeSubjectIds = new Set(previousContributions.flatMap(
    (settlement) => settlement.knowledgeChanges.flatMap((change) =>
      change.type === 'revealEvent' ? [change.subjectEventId] : []),
  ));
  const revealCandidateIds = new Set(listPlayKnowledgeRevealCandidates({
    playLocalState: session.playLocalState,
    selectedEvents: selectPlaySessionEvents(session),
  }).map((candidate) => candidate.subjectEventId));
  const matchedRevealEventIndexes = new Set<number>();
  for (const change of contribution.knowledgeChanges) {
    if (change.type === 'grantParticipantKnowledge') {
      throw new PlayRehearsalRequestError(
        422,
        'invalid_rehearsal_effect',
        'Actor/referee output cannot forge a Director participant knowledge grant.',
      );
    }
    if (
      usedKnowledgeSubjectIds.has(change.subjectEventId) ||
      !revealCandidateIds.has(change.subjectEventId)
    ) {
      throw new PlayRehearsalRequestError(
        422,
        'invalid_rehearsal_effect',
        `A provisional actor step cannot reveal this event: ${change.subjectEventId}.`,
      );
    }
    const matchingEventIndexes = contribution.events.flatMap((event, index) =>
      event.kind === 'informationSpread' &&
        event.visibility === change.playerProjection &&
        event.cause.sourceEventIds?.includes(change.subjectEventId)
        ? [index]
        : []);
    if (
      matchingEventIndexes.length !== 1 ||
      matchedRevealEventIndexes.has(matchingEventIndexes[0]!)
    ) {
      throw new PlayRehearsalRequestError(
        422,
        'invalid_rehearsal_effect',
        `A provisional reveal requires exactly one dedicated informationSpread event: ${change.subjectEventId}.`,
      );
    }
    matchedRevealEventIndexes.add(matchingEventIndexes[0]!);
    usedKnowledgeSubjectIds.add(change.subjectEventId);
  }
  const eligible = evaluatePlaySessionEligibleEvents(session, {
    actionKind: 'do',
    userText: formatRehearsalActionText(session),
  });
  const eligiblePressureIds = new Set(eligible.candidates
    .map((candidate) => candidate.pressureId)
    .filter((value): value is string => Boolean(value)));
  const eligibleAgendaIds = new Set(eligible.candidates
    .map((candidate) => candidate.agendaId)
    .filter((value): value is string => Boolean(value)));
  const usedMomentumIds = new Set(previousContributions.flatMap((settlement) =>
    settlement.events.flatMap((event) => [
      event.cause.pressureId,
      event.cause.agendaId,
    ].filter((value): value is string => Boolean(value)))));
  for (const event of contribution.events) {
    const momentumId = event.cause.pressureId ?? event.cause.agendaId;
    if (momentumId && usedMomentumIds.has(momentumId)) {
      throw new PlayRehearsalRequestError(
        422,
        'invalid_rehearsal_effect',
        `A selected rehearsal step already realizes momentum cue: ${momentumId}.`,
      );
    }
    if (
      (event.cause.pressureId && !eligiblePressureIds.has(event.cause.pressureId)) ||
      (event.cause.agendaId && !eligibleAgendaIds.has(event.cause.agendaId))
    ) {
      throw new PlayRehearsalRequestError(
        422,
        'invalid_rehearsal_effect',
        `A provisional actor step references an ineligible momentum cue: ${momentumId}.`,
      );
    }
  }
}

function resolveStepParticipant(
  attempt: PlayTurnAttempt,
  operation: { mode: 'next' } | { mode: 'retry'; sourceStepRef: string },
): string {
  if (operation.mode === 'retry') {
    return preparePlayTurnAttemptRetry(attempt, operation.sourceStepRef).participantRef;
  }
  const participantRef = attempt.actorOrder[attempt.selectedStepRefs.length];
  if (!participantRef) {
    throw new PlayRehearsalRequestError(
      409,
      'invalid_transition',
      'The fixed actor queue has already been completed.',
    );
  }
  return participantRef;
}

function assertStepOperationReady(
  attempt: PlayTurnAttempt,
  operation: { mode: 'next' } | { mode: 'retry'; sourceStepRef: string },
): void {
  if (attempt.status !== 'running') {
    throw new PlayRehearsalRequestError(
      409,
      'invalid_transition',
      'Only a running Play rehearsal attempt can generate an actor step.',
    );
  }
  if (operation.mode === 'retry') {
    preparePlayTurnAttemptRetry(attempt, operation.sourceStepRef);
  } else if (attempt.currentStepRef !== undefined) {
    throw new PlayRehearsalRequestError(
      409,
      'invalid_transition',
      'Accept or Retry the current provisional step before generating the next actor.',
    );
  }
}

function assertAttemptRevision(attempt: PlayTurnAttempt, expected: number): void {
  if (attempt.attemptRevision !== expected) {
    throw new PlayRehearsalRequestError(
      409,
      'attempt_revision_conflict',
      `Play attempt revision conflict: expected ${expected}, current ${attempt.attemptRevision}.`,
      { expectedRevision: expected, currentRevision: attempt.attemptRevision },
    );
  }
}

async function readActiveAttempt(
  workspaceRoot: string,
  sessionId: string,
): Promise<PlayTurnAttempt | undefined> {
  const active = (await listPlayTurnAttemptRecoveries(workspaceRoot, sessionId))
    .filter((summary) => summary.classification === 'active');
  if (active.length > 1) {
    throw new PlayRehearsalRequestError(
      422,
      'invalid_recovery_state',
      'Play session contains more than one active rehearsal attempt.',
    );
  }
  return active[0]
    ? readPlayTurnAttemptRecovery(workspaceRoot, sessionId, active[0].attemptId)
    : undefined;
}

async function withSessionReservation<T>(
  options: PlayRehearsalBackendControllerOptions,
  workspaceRoot: string,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!options.tryReserveSession(workspaceRoot, sessionId)) {
    throw new PlayRehearsalRequestError(
      409,
      'session_busy',
      'Play session is being modified.',
    );
  }
  try {
    return await operation();
  } finally {
    options.releaseSession(workspaceRoot, sessionId);
  }
}

async function withAttemptMutation<T>(
  stepRuns: Map<string, PlayRehearsalStepRun>,
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = createAttemptMutationKey(workspaceRoot, sessionId, attemptId);
  if (findActiveRun(stepRuns, key)) {
    throw new PlayRehearsalRequestError(
      409,
      'attempt_busy',
      'The Play rehearsal attempt already has an active mutation.',
    );
  }
  return operation();
}

async function hasCommittedRehearsalAttempt(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): Promise<boolean> {
  const session = await readPlaySessionFiles(workspaceRoot, sessionId);
  return session.rehearsalScenes?.some((scene) =>
    scene.turns.some((turn) => turn.attemptId === attemptId)) ?? false;
}

async function assertRehearsalAttemptNotCommitted(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
  operation: 'step' | 'accept' | 'cancel',
  cleanupRecovery: () => Promise<void>,
): Promise<void> {
  if (!await hasCommittedRehearsalAttempt(workspaceRoot, sessionId, attemptId)) {
    return;
  }
  await cleanupRecovery();
  if (operation === 'cancel') {
    throw new PlayRehearsalRequestError(
      409,
      'too_late_to_cancel',
      'The Play rehearsal Finish commit has already completed.',
      { tooLateToCancel: true },
    );
  }
  throw new PlayRehearsalRequestError(
    409,
    'attempt_committed',
    `The Play rehearsal attempt was already committed before ${operation}.`,
    { attemptId },
  );
}

function normalizeStepStreamInput(value: unknown): PlayRehearsalStepStreamInput {
  const body = requireBody(
    value,
    ['expectedAttemptRevision', 'idempotencyKey', 'mode', 'sourceStepRef'],
    'Play actor step stream request',
  );
  if (body.mode !== 'next' && body.mode !== 'retry') {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      'Play actor step mode must be next or retry.',
    );
  }
  const sourceStepRef = body.sourceStepRef === undefined
    ? undefined
    : requireSafeWireId(body.sourceStepRef, 'sourceStepRef');
  if (
    (body.mode === 'next' && sourceStepRef !== undefined) ||
    (body.mode === 'retry' && sourceStepRef === undefined)
  ) {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      'Play Retry requires exactly one sourceStepRef; next forbids it.',
    );
  }
  return {
    expectedAttemptRevision: requireNonNegativeInteger(
      body.expectedAttemptRevision,
      'expectedAttemptRevision',
    ),
    idempotencyKey: requireSafeWireId(body.idempotencyKey, 'idempotencyKey'),
    mode: body.mode,
    ...(sourceStepRef ? { sourceStepRef } : {}),
  };
}

function requireBody(
  value: unknown,
  allowedFields: string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PlayRehearsalRequestError(400, 'invalid_request', `${label} must be an object.`);
  }
  const unknownField = Object.keys(value).find((field) => !allowedFields.includes(field));
  if (unknownField) {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      `${label} contains an unknown field: ${unknownField}.`,
    );
  }
  return value;
}

function requireSafeWireId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
  ) {
    throw new PlayRehearsalRequestError(400, 'invalid_request', `${label} is invalid.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      `${label} must be a non-negative integer.`,
    );
  }
  return value as number;
}

function requireWireText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      `${label} must be non-empty text up to ${maximum} characters.`,
    );
  }
  return value.trim();
}

function requireWireIdList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      `${label} must be an array of at most 64 ids.`,
    );
  }
  const ids = value.map((item) => requireSafeWireId(item, label));
  if (new Set(ids).size !== ids.length) {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      `${label} must not contain duplicates.`,
    );
  }
  return ids;
}

function requireMemoryLens(value: unknown): 'player' | 'director' {
  if (value !== 'player' && value !== 'director') {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      'Play Scene Memory lens must be player or director.',
    );
  }
  return value;
}

function requireSha256WireValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      `${label} must be a SHA-256 hex digest.`,
    );
  }
  return value;
}

function requireDirectorKnowledgeGrant(value: unknown): PlayDirectorKnowledgeGrant {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new PlayRehearsalRequestError(
      400,
      'invalid_request',
      'Play grantKnowledge requires a typed grant.',
    );
  }
  if (value.kind === 'existingFact') {
    const body = requireBody(value, ['kind', 'factRefs'], 'Play existing-fact grant');
    if (!Array.isArray(body.factRefs) || !body.factRefs.length) {
      throw new PlayRehearsalRequestError(
        400,
        'invalid_request',
        'Play existing-fact grant requires factRefs.',
      );
    }
    return {
      kind: 'existingFact',
      factRefs: body.factRefs.map((factRef) =>
        requireSafeWireId(factRef, 'factRef')),
    };
  }
  if (value.kind === 'authorProvidedPlayFact') {
    const body = requireBody(
      value,
      ['kind', 'summary', 'visibility', 'providedAt'],
      'Play author-provided knowledge grant',
    );
    if (
      typeof body.summary !== 'string' ||
      !body.summary.trim() ||
      body.summary.length > 12_000 ||
      typeof body.providedAt !== 'string' ||
      !body.providedAt.trim() ||
      (
        body.visibility !== 'playerVisible' &&
        body.visibility !== 'rumor' &&
        body.visibility !== 'playerUnknown'
      )
    ) {
      throw new PlayRehearsalRequestError(
        400,
        'invalid_request',
        'Play author-provided knowledge grant has invalid typed fields.',
      );
    }
    return {
      kind: 'authorProvidedPlayFact',
      summary: body.summary.trim(),
      visibility: body.visibility,
      providedAt: body.providedAt.trim(),
    };
  }
  throw new PlayRehearsalRequestError(
    400,
    'invalid_request',
    `Unsupported Play knowledge grant: ${value.kind}.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createAttemptMutationKey(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
): string {
  return `${workspaceRoot}\u0000${sessionId}\u0000${attemptId}`;
}

function createStepRunKey(
  workspaceRoot: string,
  sessionId: string,
  attemptId: string,
  stepRunId: string,
): string {
  return `${createAttemptMutationKey(workspaceRoot, sessionId, attemptId)}\u0000${stepRunId}`;
}

function findActiveRun(
  runs: Map<string, PlayRehearsalStepRun>,
  attemptKey: string,
): PlayRehearsalStepRun | undefined {
  return [...runs.values()].find((run) =>
    createAttemptMutationKey(run.workspaceRoot, run.sessionId, run.attemptId) === attemptKey &&
    isActiveStepRun(run));
}

function isActiveStepRun(run: PlayRehearsalStepRun): boolean {
  return run.status === 'starting' ||
    run.status === 'streaming' ||
    run.status === 'refereeing' ||
    run.status === 'committing' ||
    run.status === 'aborting';
}

function scheduleStepRunCleanup(
  runs: Map<string, PlayRehearsalStepRun>,
  run: PlayRehearsalStepRun,
): void {
  const timeout = setTimeout(() => {
    runs.delete(createStepRunKey(
      run.workspaceRoot,
      run.sessionId,
      run.attemptId,
      run.stepRunId,
    ));
  }, 60_000);
  timeout.unref();
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): void {
  if (!source) return;
  if (source.aborted) {
    target.abort(source.reason);
    return;
  }
  source.addEventListener('abort', () => target.abort(source.reason), { once: true });
}

async function nextIteratorWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  return racePromiseWithAbort(iterator.next(), signal);
}

async function racePromiseWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new PlayStepAbortedError(readAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new PlayStepAbortedError(readAbortReason(signal)));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

class PlayStepAbortedError extends Error {
  constructor(reason?: string) {
    super(reason || 'Play actor step generation was stopped.');
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new PlayStepAbortedError(readAbortReason(signal));
}

function readAbortReason(signal: AbortSignal): string {
  return typeof signal.reason === 'string'
    ? signal.reason
    : 'Play actor step generation was stopped.';
}

function normalizeActorNarrative(value: string): string {
  const narrative = value.trim();
  assertActorNarrativeSize(narrative);
  if (!narrative) {
    throw new PlayRehearsalRequestError(
      422,
      'unexpected_model_output',
      'Play rehearsal actor returned no observable narrative.',
    );
  }
  if (/oan-play-settlement|<oan-play-/iu.test(narrative)) {
    throw new PlayRehearsalRequestError(
      422,
      'unexpected_model_output',
      'Play rehearsal actor returned forbidden protocol data.',
    );
  }
  return narrative;
}

function assertActorNarrativeSize(value: string): void {
  if (value.length > MAX_ACTOR_NARRATIVE_CHARACTERS) {
    throw new PlayRehearsalRequestError(
      422,
      'response_too_large',
      `Play rehearsal actor response exceeded ${MAX_ACTOR_NARRATIVE_CHARACTERS} characters.`,
    );
  }
}

function isParticipantVisibleBlock(block: NarrativeBlock): boolean {
  return block.projection === 'transcript' && block.visibility !== 'playerUnknown';
}

function resolvePlayRedirectConstraintRecords(
  refs: readonly string[],
  perception: CharacterPerceptionPackage,
  visibleEvents: ReturnType<typeof selectPlaySessionEvents>,
  observedBlocks: readonly NarrativeBlock[],
): Array<Record<string, unknown>> {
  return refs.map((ref) => {
    const initialEvidence = perception.initialKnowledgeEvidence.find((evidence) =>
      evidence.id === ref);
    if (initialEvidence) {
      return {
        kind: 'initialKnowledgeEvidence',
        ref,
        fact: initialEvidence.fact,
        visibility: initialEvidence.visibility,
        provenance: initialEvidence.provenance,
      };
    }
    const grantedEvidence = perception.grantedKnowledgeEvidence.find((evidence) =>
      evidence.id === ref);
    if (grantedEvidence) {
      return {
        kind: 'grantedKnowledgeEvidence',
        ref,
        fact: grantedEvidence.fact,
        visibility: grantedEvidence.visibility,
        provenance: grantedEvidence.provenance,
      };
    }
    const visibleEvent = visibleEvents.find((event) => event.id === ref);
    if (visibleEvent) {
      return {
        kind: 'visibleEvent',
        ref,
        title: visibleEvent.title,
        summary: visibleEvent.summary,
        visibility: visibleEvent.visibility,
      };
    }
    const observedBlock = observedBlocks.find((block) => block.id === ref);
    if (observedBlock) {
      return {
        kind: 'observedNarrativeBlock',
        ref,
        content: observedBlock.content,
        visibility: observedBlock.visibility,
        eventRefs: observedBlock.eventRefs,
        sourceRefs: observedBlock.sourceRefs,
      };
    }
    const grantsByFactRef = perception.grantedKnowledgeEvidence.filter((evidence) =>
      evidence.factRefs.includes(ref));
    if (grantsByFactRef.length === 1) {
      const evidence = grantsByFactRef[0]!;
      return {
        kind: 'grantedKnowledgeFact',
        ref,
        evidenceRef: evidence.id,
        fact: evidence.fact,
        visibility: evidence.visibility,
        provenance: evidence.provenance,
      };
    }
    throw new PlayRehearsalRequestError(
      422,
      'invalid_rehearsal_effect',
      grantsByFactRef.length > 1
        ? `Play redirect constraint is ambiguous in the target participant perception: ${ref}.`
        : `Play redirect constraint is outside the target participant perception: ${ref}.`,
    );
  });
}

function createProvisionalPlayRehearsalWorldNotice(
  stepId: string,
  contribution: PlayWorldRefereeSettlement,
): NarrativeBlock | undefined {
  const visibleEvents = contribution.events.filter((event) =>
    event.visibility === 'playerVisible');
  if (!visibleEvents.length) return undefined;
  return {
    id: `world-notice-${stepId}`,
    kind: 'worldNotice',
    content: visibleEvents.map((event) =>
      `${event.title}: ${event.summary}`).join('\n'),
    visibility: 'playerVisible',
    projection: 'transcript',
    eventRefs: [],
    sourceRefs: [],
  };
}

function formatRehearsalActionText(session: PlaySession): string {
  return `Scene rehearsal: ${session.sceneStart}`.slice(0, 12_000);
}

function safePromptJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function toStructuredError(error: unknown): PlayRehearsalStructuredError {
  if (error instanceof PlayRehearsalRequestError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.status >= 500,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof candidate.code === 'string'
    ? normalizeCoreErrorCode(candidate.code, message)
    : 'provider_error';
  return {
    code,
    message,
    retryable: code === 'provider_error',
  };
}

function normalizeCoreErrorCode(code: string, message: string): string {
  if (code === 'revisionConflict') {
    return /session|baseRevision|rehearsal revision/iu.test(message)
      ? 'session_revision_conflict'
      : 'attempt_revision_conflict';
  }
  if (code === 'idempotencyConflict') return 'idempotency_conflict';
  if (code === 'selectedHeadConflict') return 'selected_head_conflict';
  if (code === 'invalidTransition' || code === 'invalidAttempt') {
    return 'invalid_rehearsal_effect';
  }
  return code;
}

export function toPlayRehearsalErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code: string; details?: Record<string, unknown> };
} {
  if (error instanceof PlayRehearsalRequestError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof candidate.code === 'string'
    ? normalizeCoreErrorCode(candidate.code, message)
    : 'play_rehearsal_error';
  const status = code === 'attempt_revision_conflict' ||
    code === 'session_revision_conflict' ||
    code === 'idempotency_conflict' ||
    code === 'selected_head_conflict' ||
    code === 'invalid_rehearsal_effect'
    ? 409
    : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      ? 404
      : 422;
  return {
    status,
    body: {
      error: message,
      code,
    },
  };
}
