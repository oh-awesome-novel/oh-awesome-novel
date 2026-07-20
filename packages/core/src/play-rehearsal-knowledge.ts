import { listPlayParticipantKnowledgeGrants, readPlayKnowledgeState } from './play-knowledge.js';
import { materializePlayTurnFacts } from './play-session-facts.js';
import type { PlaySession } from './play-session.js';
import {
  assertSafePlayRehearsalId,
  normalizePlaySceneRehearsalSidecar,
} from './play-rehearsal.js';
import type {
  PlayParticipantKnowledgeEvidence,
  PlaySceneRehearsalSidecar,
} from './play-rehearsal.js';
import {
  listActivePlayParticipantKnowledgeGrants,
  normalizePlayTurnAttempt,
} from './play-turn-attempt.js';
import type {
  PlayDirectorKnowledgeGrant,
  PlayTurnAttempt,
} from './play-turn-attempt.js';
import type { PlayEventVisibility, PlayWorldEvent } from './play-types.js';

export function createPlayParticipantKnowledgeEvidence(input: {
  session: PlaySession;
  sidecar: PlaySceneRehearsalSidecar;
  participantRef: string;
  attempt?: PlayTurnAttempt;
  throughQueueIndex?: number;
}): PlayParticipantKnowledgeEvidence[] {
  const sidecar = normalizePlaySceneRehearsalSidecar(input.sidecar);
  const participantRef = assertSafePlayRehearsalId(
    input.participantRef,
    'participant knowledge participantRef',
  );
  if (!sidecar.participants.some((participant) =>
    participant.participantRef === participantRef)) {
    throw new Error(`Play participant knowledge references unknown participant: ${participantRef}.`);
  }
  const facts = materializePlayTurnFacts(input.session);
  const selectedEvents = input.session.events.filter((event) =>
    facts.selectedEventIds.has(event.id));
  const committed = listPlayParticipantKnowledgeGrants(
    readPlayKnowledgeState(facts.selectedPlayLocalState),
    participantRef,
  ).map((record) => ({
    interventionRef: record.interventionRef,
    effectiveFromStepRef: record.effectiveFromStepRef,
    grant: record.grant,
  }));
  const provisional = input.attempt
    ? listActivePlayParticipantKnowledgeGrants(
        normalizePlayTurnAttempt(input.attempt),
        participantRef,
        input.throughQueueIndex ?? input.attempt.selectedStepRefs.length,
      ).map((intervention) => ({
        interventionRef: intervention.id,
        effectiveFromStepRef: intervention.effectiveFromStepRef,
        grant: intervention.grant,
      }))
    : [];
  const evidenceById = new Map(sidecar.initialKnowledgeEvidence.map((evidence) => [
    evidence.id,
    evidence,
  ]));
  const eventsById = new Map(selectedEvents.map((event) => [event.id, event]));
  const seen = new Set<string>();
  return [...committed, ...provisional].flatMap((entry) => {
    if (seen.has(entry.interventionRef)) return [];
    seen.add(entry.interventionRef);
    const resolved = resolveGrant(entry.grant, evidenceById, eventsById);
    return [{
      id: deriveEvidenceId(entry.interventionRef),
      participantRef,
      interventionRef: entry.interventionRef,
      effectiveFromStepRef: entry.effectiveFromStepRef,
      factRefs: resolved.factRefs,
      fact: resolved.fact,
      visibility: resolved.visibility,
      provenance: entry.grant.kind === 'existingFact'
        ? { kind: 'existingFact' as const }
        : {
            kind: 'authorProvidedPlayFact' as const,
            providedAt: entry.grant.providedAt,
          },
    }];
  });
}

function resolveGrant(
  grant: PlayDirectorKnowledgeGrant,
  evidenceById: Map<string, PlaySceneRehearsalSidecar['initialKnowledgeEvidence'][number]>,
  eventsById: Map<string, PlayWorldEvent>,
): { factRefs: string[]; fact: string; visibility: PlayEventVisibility } {
  if (grant.kind === 'authorProvidedPlayFact') {
    return {
      factRefs: [],
      fact: grant.summary,
      visibility: grant.visibility,
    };
  }
  const facts = grant.factRefs.map((factRef) => {
    const evidence = evidenceById.get(factRef);
    if (evidence) {
      return { summary: evidence.fact, visibility: evidence.visibility };
    }
    const event = eventsById.get(factRef);
    if (event) {
      return {
        summary: `${event.title}: ${event.summary}`,
        visibility: event.visibility,
      };
    }
    throw new Error(`Play participant knowledge fact is unavailable on this branch: ${factRef}.`);
  });
  return {
    factRefs: [...grant.factRefs],
    fact: facts.map((item) => item.summary).join('\n'),
    visibility: strictestVisibility(facts.map((item) => item.visibility)),
  };
}

function strictestVisibility(visibilities: PlayEventVisibility[]): PlayEventVisibility {
  return visibilities.includes('playerUnknown')
    ? 'playerUnknown'
    : visibilities.includes('rumor')
      ? 'rumor'
      : 'playerVisible';
}

function deriveEvidenceId(interventionRef: string): string {
  const candidate = `participant-knowledge-${interventionRef}`;
  return candidate.length <= 180
    ? candidate
    : `participant-knowledge-${interventionRef.slice(-150)}`;
}
