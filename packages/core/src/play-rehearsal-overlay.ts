import { evaluatePlayDueEvents } from './play-event-schedule.js';
import type {
  EvaluatePlayDueEventsInput,
  PlayDueEventEvaluation,
  PlayScheduledEvent,
} from './play-event-schedule.js';
import {
  materializePlayScheduledEvents,
  normalizePlayWorldRefereeSettlement,
} from './play-session.js';
import type { PlaySession, PlayWorldRefereeSettlement } from './play-session.js';
import {
  materializePlayTurnFacts,
  mergePlayLocalState,
  resolvePlaySessionRevision,
} from './play-session-facts.js';
import { normalizePlayTurnAttempt, PlayTurnAttemptError } from './play-turn-attempt.js';
import type { PlayTurnAttempt } from './play-turn-attempt.js';

export interface PlayRehearsalOverlayEvaluation {
  selectedStepRefs: string[];
  playLocalState: Record<string, unknown>;
  scheduledEvents: PlayScheduledEvent[];
  currentWorldTime?: string;
  base: PlayDueEventEvaluation;
  overlay: PlayDueEventEvaluation;
  newlyDueEventIds: string[];
  noLongerDueEventIds: string[];
}

/**
 * Builds a disposable selected-prefix view and delegates trigger ordering and
 * matching to the committed due-event evaluator. It never persists the
 * overlay and intentionally does not introduce another schedule reducer.
 */
export function evaluatePlayRehearsalProvisionalOverlay(
  session: PlaySession,
  attemptValue: PlayTurnAttempt,
  options: Pick<EvaluatePlayDueEventsInput, 'compareWorldTime'> = {},
): PlayRehearsalOverlayEvaluation {
  const attempt = normalizePlayTurnAttempt(attemptValue);
  if (attempt.sessionId !== session.id) {
    throw new PlayTurnAttemptError(
      'invalidAttempt',
      'Play rehearsal overlay attempt belongs to another session.',
    );
  }
  const facts = materializePlayTurnFacts(session);
  const stepsById = new Map(attempt.steps.map((step) => [step.id, step]));
  const selectedSteps = attempt.selectedStepRefs.map((stepRef) => {
    const step = stepsById.get(stepRef);
    if (!step || step.status !== 'selected') {
      throw new PlayTurnAttemptError(
        'stepNotFound',
        `Play rehearsal overlay cannot resolve selected step: ${stepRef}.`,
      );
    }
    return step;
  });
  const playLocalState = selectedSteps.reduce<Record<string, unknown>>(
    (state, step) => mergePlayLocalState(state, step.settlementContribution.stateDelta),
    structuredClone(facts.selectedPlayLocalState),
  );
  const anchorValues = new Set(selectedSteps.flatMap((step) =>
    step.settlementContribution.worldTimeAnchor
      ? [step.settlementContribution.worldTimeAnchor]
      : []));
  if (anchorValues.size > 1) {
    throw new PlayTurnAttemptError(
      'invalidTransition',
      'Play rehearsal overlay contains conflicting world-time anchors.',
    );
  }
  const scheduledEventChanges = selectedSteps.flatMap((step) =>
    structuredClone(step.settlementContribution.scheduledEventChanges));
  const overlaySettlement = createScheduleOnlySettlement(scheduledEventChanges);
  const selectedSession: PlaySession = {
    ...structuredClone(session),
    scheduledEvents: structuredClone(facts.selectedScheduledEvents),
  };
  const nextRevision = resolvePlaySessionRevision(session, facts.turnArtifacts) + 1;
  const scheduledEvents = materializePlayScheduledEvents({
    session: selectedSession,
    settlement: overlaySettlement,
    events: [],
    revision: nextRevision,
    worldTurn: session.worldClock.turn + 1,
    refereeTurnId: `turn-${nextRevision}-referee`,
  });
  const currentWorldTime = [...anchorValues][0] ?? session.worldClock.anchor;
  const evaluationInput = {
    currentTurn: session.worldClock.turn,
    nextTurn: session.worldClock.turn + 1,
    playLocalState,
    ...(currentWorldTime ? { currentWorldTime } : {}),
    ...(options.compareWorldTime ? { compareWorldTime: options.compareWorldTime } : {}),
  };
  const base = evaluatePlayDueEvents({
    ...evaluationInput,
    playLocalState: facts.selectedPlayLocalState,
    scheduledEvents: facts.selectedScheduledEvents,
    ...(session.worldClock.anchor
      ? { currentWorldTime: session.worldClock.anchor }
      : { currentWorldTime: undefined }),
  });
  const overlay = evaluatePlayDueEvents({
    ...evaluationInput,
    scheduledEvents,
  });
  const baseIds = new Set(base.dueEvents.map((event) => event.id));
  const overlayIds = new Set(overlay.dueEvents.map((event) => event.id));
  return {
    selectedStepRefs: [...attempt.selectedStepRefs],
    playLocalState,
    scheduledEvents,
    ...(currentWorldTime ? { currentWorldTime } : {}),
    base,
    overlay,
    newlyDueEventIds: overlay.dueEvents
      .map((event) => event.id)
      .filter((eventId) => !baseIds.has(eventId)),
    noLongerDueEventIds: base.dueEvents
      .map((event) => event.id)
      .filter((eventId) => !overlayIds.has(eventId)),
  };
}

function createScheduleOnlySettlement(
  scheduledEventChanges: PlayWorldRefereeSettlement['scheduledEventChanges'],
): PlayWorldRefereeSettlement {
  return normalizePlayWorldRefereeSettlement({
    events: [],
    knowledgeChanges: [],
    pressureChanges: [],
    agendaChanges: [],
    scheduledEventChanges,
    stateDelta: {},
    observations: [],
    suggestedActions: [],
  });
}
