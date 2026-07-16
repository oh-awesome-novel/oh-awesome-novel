import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLAY_ADOPTION_TARGETS,
  PLAY_INITIAL_WORLD_CHECKPOINT_ID,
  addPlayAdoptionCandidate,
  addPlayTranscriptTurn,
  createPlayAdoptionCandidateFromDraft,
  createPlayOutcomeReport,
  createPlaySessionDraft,
  fingerprintPlayAdoptionEvidenceClosure,
  fingerprintPlayOutcomeReport,
  normalizePlayAdoptionDraft,
  normalizePlayAdoptionEvidenceClosure,
  projectPlayAdoptionCandidate,
  projectPlayAdoptionDraft,
  readPlaySessionFiles,
  rebuildPlayAdoptionDraft,
  restorePlaySessionCheckpoint,
  settlePlayWorldRefereeResponse,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type {
  PlayEventVisibility,
  PlayOutcomeReport,
  PlaySession,
  PlayWorldEventKind,
} from '@oh-awesome-novel/core';

const response = (input: {
  narrative: string;
  kind?: PlayWorldEventKind;
  title: string;
  summary: string;
  visibility?: PlayEventVisibility;
  sourceEventIds?: string[];
  observation?: { summary: string; evidence: string };
}): string => [
  input.narrative,
  '```oan-play-settlement',
  JSON.stringify({
    events: [{
      kind: input.kind ?? 'relationshipChanged',
      origin: 'npc',
      title: input.title,
      summary: input.summary,
      visibility: input.visibility ?? 'playerVisible',
      cause: {
        reason: `Cause for ${input.title}.`,
        ...(input.sourceEventIds
          ? { sourceEventIds: input.sourceEventIds }
          : {}),
      },
    }],
    pressureChanges: [],
    agendaChanges: [],
    scheduledEventChanges: [],
    knowledgeChanges: [],
    stateDelta: {},
    observations: input.observation ? [input.observation] : [],
    suggestedActions: [],
  }),
  '```',
].join('\n');

const createSelectedSession = (): PlaySession => {
  const draft = createPlaySessionDraft({
    id: 'play-adoption-selected',
    title: 'Adoption selected branch',
    createdAt: '2026-07-16T01:00:00.000Z',
    sceneStart: 'A station platform.',
    characters: [],
    activatedSources: [{
      sourceId: 'chapter-opening',
      path: 'chapters/0001/0001.md',
      objectId: 'chapter-0001-0001',
      contentHash: 'a'.repeat(64),
      role: 'chapter',
      reason: 'Guided scene base.',
      budgetLayer: 'L0',
      semanticBoundary: 'mustKeep',
      trust: 'canonical',
    }, {
      sourceId: 'world-station',
      path: 'world/station.md',
      contentHash: 'b'.repeat(64),
      role: 'world',
      reason: 'Station facts.',
      budgetLayer: 'L1',
      semanticBoundary: 'compressible',
      trust: 'canonical',
    }],
  });
  return settlePlayWorldRefereeResponse({
    session: draft,
    userText: 'Ask the guard for help.',
    actionKind: 'say',
    createdAt: '2026-07-16T01:01:00.000Z',
    refereeResponse: response({
      narrative: 'The guard decides to trust you.',
      title: 'The guard offers help',
      summary: 'The guard agrees to open the service gate.',
      observation: {
        summary: 'The guard now trusts the traveller',
        evidence: 'The guard offered access through the service gate.',
      },
    }),
  });
};

const createCurrentReport = (session: PlaySession): PlayOutcomeReport =>
  createPlayOutcomeReport(session, {
    createdAt: '2026-07-16T01:02:00.000Z',
  });

describe('evidence-backed Play adoption', () => {
  it('rebuilds event and observation roots with a selected evidence closure', () => {
    const session = createSelectedSession();
    const event = session.events[0]!;
    const observation = session.observations[0]!;
    const eventDraft = rebuildPlayAdoptionDraft({
      session,
      seed: { kind: 'event', eventId: event.id },
    });
    expect(eventDraft).toMatchObject({
      seed: { kind: 'event', eventId: event.id },
      summary: `${event.title}: ${event.summary}`,
      visibility: 'playerVisible',
      evidenceClosure: {
        schemaVersion: 1,
        sessionId: session.id,
        sessionRevision: 1,
        selectedArtifactTurnRefs: [session.turnArtifacts[0]!.id],
        artifactTurnRefs: [session.turnArtifacts[0]!.id],
        messageRefs: ['turn-1-referee', 'turn-1-user'],
        eventRefs: [event.id],
        sourceSnapshots: [
          expect.objectContaining({ sourceId: 'chapter-opening' }),
          expect.objectContaining({ sourceId: 'world-station' }),
        ],
      },
    });
    expect(eventDraft.targetSuggestions.map((suggestion) => suggestion.target))
      .toEqual(PLAY_ADOPTION_TARGETS);
    expect(eventDraft.targetSuggestions.find((suggestion) => suggestion.recommended))
      .toMatchObject({ target: 'state', toolName: 'state.set' });
    expect(eventDraft.targetSuggestions.every((suggestion) =>
      JSON.stringify(suggestion.defaultPayload).includes(eventDraft.summary)))
      .toBe(true);

    const observationDraft = rebuildPlayAdoptionDraft({
      session,
      seed: { kind: 'observation', observationId: observation.id },
    });
    expect(observationDraft).toMatchObject({
      summary: observation.summary,
      evidence: observation.evidence,
      evidenceClosure: {
        observationRefs: [observation.id],
        eventRefs: [event.id],
        artifactTurnRefs: [session.turnArtifacts[0]!.id],
      },
    });
    expect(observationDraft.targetSuggestions.find((suggestion) =>
      suggestion.recommended)?.target).toBe('chapterDraft');
  });

  it('rebuilds only a current outcome item and preserves its report fingerprint', () => {
    const session = createSelectedSession();
    const report = createCurrentReport(session);
    const item = report.items.find((candidate) =>
      candidate.kind === 'worldChange' &&
      candidate.eventRefs.includes(session.events[0]!.id))!;
    const outcomeReportFingerprint = fingerprintPlayOutcomeReport(report);
    const draft = rebuildPlayAdoptionDraft({
      session,
      seed: {
        kind: 'outcome',
        outcomeItemId: item.id,
        outcomeReportFingerprint,
      },
      outcomeReport: report,
    });
    expect(draft).toMatchObject({
      seed: {
        kind: 'outcome',
        outcomeItemId: item.id,
        outcomeReportFingerprint,
      },
      summary: item.summary,
      evidenceClosure: {
        artifactTurnRefs: item.artifactTurnRefs,
        eventRefs: item.eventRefs,
      },
    });

    const advanced = addPlayTranscriptTurn(session, {
      speaker: 'narrator',
      content: 'A later turn makes the report stale.',
      createdAt: '2026-07-16T01:03:00.000Z',
    });
    expect(() => rebuildPlayAdoptionDraft({
      session: advanced,
      seed: draft.seed,
      outcomeReport: report,
    })).toThrow('stale for the selected branch');
    expect(() => rebuildPlayAdoptionDraft({
      session,
      seed: {
        ...draft.seed,
        outcomeItemId: 'unknown-outcome-item',
      },
      outcomeReport: report,
    })).toThrow('outcome item is unknown');

    const duplicateRefs = structuredClone(report);
    const duplicatedItem = duplicateRefs.items.find((candidate) =>
      candidate.id === item.id)!;
    duplicatedItem.eventRefs.push(duplicatedItem.eventRefs[0]!);
    expect(() => rebuildPlayAdoptionDraft({
      session,
      seed: draft.seed,
      outcomeReport: duplicateRefs,
    })).toThrow('duplicate');
  });

  it('rejects unknown, discarded sibling, and duplicate evidence references', () => {
    const selected = createSelectedSession();
    expect(() => rebuildPlayAdoptionDraft({
      session: selected,
      seed: { kind: 'event', eventId: 'unknown-event' },
    })).toThrow('unknown or outside the selected branch');

    const restored = restorePlaySessionCheckpoint(
      selected,
      PLAY_INITIAL_WORLD_CHECKPOINT_ID,
    );
    const sibling = settlePlayWorldRefereeResponse({
      session: restored,
      userText: 'Take the other platform.',
      actionKind: 'move',
      refereeResponse: response({
        narrative: 'A different guard blocks the other platform.',
        title: 'The other platform is blocked',
        summary: 'A different guard closes the other platform.',
      }),
    });
    expect(sibling.events).toHaveLength(2);
    expect(() => rebuildPlayAdoptionDraft({
      session: sibling,
      seed: { kind: 'event', eventId: selected.events[0]!.id },
    })).toThrow('unknown or outside the selected branch');

    const draft = rebuildPlayAdoptionDraft({
      session: selected,
      seed: { kind: 'event', eventId: selected.events[0]!.id },
    });
    const staleCandidate = createPlayAdoptionCandidateFromDraft({
      id: 'stale-selected-branch-candidate',
      draft,
      target: 'state',
    });
    expect(() => addPlayAdoptionCandidate(sibling, staleCandidate))
      .toThrow('stale for the current selected branch');
    const duplicate = structuredClone(draft.evidenceClosure);
    duplicate.eventRefs.push(duplicate.eventRefs[0]!);
    expect(() => normalizePlayAdoptionEvidenceClosure(duplicate))
      .toThrow('must not contain duplicates');

    const duplicateSource = structuredClone(draft.evidenceClosure);
    duplicateSource.sourceSnapshots.push(structuredClone(
      duplicateSource.sourceSnapshots[0]!,
    ));
    expect(() => normalizePlayAdoptionEvidenceClosure(duplicateSource))
      .toThrow('must not contain duplicates');
  });

  it('rejects hidden Player roots and keeps Player defaults free of hidden closure text', () => {
    const draft = createPlaySessionDraft({
      id: 'play-adoption-hidden',
      title: 'Hidden adoption',
      sceneStart: 'A quiet station.',
      characters: [],
    });
    const hidden = settlePlayWorldRefereeResponse({
      session: draft,
      userText: 'Wait quietly.',
      actionKind: 'wait',
      refereeResponse: response({
        narrative: 'Nothing appears to change.',
        title: 'Secret signal changed',
        summary: 'A hidden conspirator changed the signal to red.',
        visibility: 'playerUnknown',
      }),
    });
    expect(() => rebuildPlayAdoptionDraft({
      session: hidden,
      seed: { kind: 'event', eventId: hidden.events[0]!.id },
      projection: 'player',
    })).toThrow('cannot adopt a playerUnknown');
    const hiddenDirectorDraft = rebuildPlayAdoptionDraft({
      session: hidden,
      seed: { kind: 'event', eventId: hidden.events[0]!.id },
      projection: 'director',
    });
    expect(projectPlayAdoptionDraft(hiddenDirectorDraft, 'player')).toBeUndefined();
    expect(projectPlayAdoptionCandidate(
      createPlayAdoptionCandidateFromDraft({
        id: 'hidden-director-candidate',
        draft: hiddenDirectorDraft,
        target: 'foreshadow',
      }),
      'player',
    )).toBeUndefined();

    const visible = settlePlayWorldRefereeResponse({
      session: hidden,
      userText: 'Inspect the public departure board.',
      actionKind: 'look',
      refereeResponse: response({
        narrative: 'The public board now shows a delay.',
        kind: 'informationSpread',
        title: 'A delay is announced',
        summary: 'The departure board publicly announces a delay.',
        sourceEventIds: [hidden.events[0]!.id],
      }),
    });
    const visibleDraft = rebuildPlayAdoptionDraft({
      session: visible,
      seed: { kind: 'event', eventId: visible.events[1]!.id },
      projection: 'player',
    });
    const defaultPayloads = JSON.stringify(
      visibleDraft.targetSuggestions.map((suggestion) => suggestion.defaultPayload),
    );
    expect(defaultPayloads).not.toContain(hidden.events[0]!.title);
    expect(defaultPayloads).not.toContain(hidden.events[0]!.summary);
    expect(defaultPayloads).not.toContain(hidden.events[0]!.cause.reason);

    const playerDraft = projectPlayAdoptionDraft(visibleDraft, 'player')!;
    expect(playerDraft.evidenceClosure).toMatchObject({
      selectedArtifactTurnRefs: [],
      artifactTurnRefs: [],
      messageRefs: [],
      eventRefs: [],
      observationRefs: [],
      evidenceRefs: [],
      sourceSnapshots: [],
    });
    expect(() => normalizePlayAdoptionDraft(playerDraft)).not.toThrow();
    expect(playerDraft.evidenceFingerprint)
      .toBe(fingerprintPlayAdoptionEvidenceClosure(playerDraft.evidenceClosure));
    expect(JSON.stringify(playerDraft.targetSuggestions))
      .toContain(playerDraft.evidenceFingerprint);
  });

  it('creates all four editable candidates and round-trips M4 evidence fields', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-adoption-'));
    try {
      const session = createSelectedSession();
      const draft = rebuildPlayAdoptionDraft({
        session,
        seed: { kind: 'event', eventId: session.events[0]!.id },
      });
      for (const suggestion of draft.targetSuggestions) {
        const candidate = createPlayAdoptionCandidateFromDraft({
          id: `adopt-${suggestion.target}`,
          draft,
          target: suggestion.target,
        });
        expect(candidate).toMatchObject({
          target: suggestion.target,
          seed: draft.seed,
          evidenceClosure: draft.evidenceClosure,
          evidenceFingerprint: draft.evidenceFingerprint,
          requiresPendingAction: true,
        });
      }

      const candidate = createPlayAdoptionCandidateFromDraft({
        id: 'adopt-roundtrip',
        draft,
        target: 'timeline',
      });
      const withCandidate = addPlayAdoptionCandidate(session, candidate);
      await writePlaySessionFiles(workspaceRoot, withCandidate);
      const reread = await readPlaySessionFiles(workspaceRoot, session.id);
      expect(reread.adoptionCandidates[0]).toEqual(candidate);
      const playerCandidate = projectPlayAdoptionCandidate(candidate, 'player')!;
      expect(playerCandidate).not.toHaveProperty('seed');
      expect(playerCandidate).not.toHaveProperty('evidenceClosure');
      expect(playerCandidate).not.toHaveProperty('evidenceFingerprint');
      expect(playerCandidate.sourceEventIds).toEqual([]);

      const staleSource = structuredClone(session);
      staleSource.activatedSources[0]!.contentHash = 'c'.repeat(64);
      expect(() => addPlayAdoptionCandidate(staleSource, candidate))
        .toThrow('source base is stale');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('uses deterministic fingerprints independent of session source order', () => {
    const session = createSelectedSession();
    const seed = { kind: 'event' as const, eventId: session.events[0]!.id };
    const first = rebuildPlayAdoptionDraft({ session, seed });
    const second = rebuildPlayAdoptionDraft({
      session: {
        ...structuredClone(session),
        activatedSources: [...session.activatedSources].reverse(),
      },
      seed,
    });
    expect(second.evidenceClosure.sourceSnapshots.map((source) => source.sourceId))
      .toEqual(['chapter-opening', 'world-station']);
    expect(second.evidenceClosure).toEqual(first.evidenceClosure);
    expect(second.evidenceFingerprint).toBe(first.evidenceFingerprint);
    expect(second.targetSuggestions).toEqual(first.targetSuggestions);
  });
});
