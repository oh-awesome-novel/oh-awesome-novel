import { describe, expect, it } from 'vitest';

import {
  createPlaySessionDraft,
  createPlaySceneRehearsalSessionDraft,
  createPlaySourceDriftStatus,
  resolvePlaySourceDriftDecision,
} from '@oh-awesome-novel/core';

const OLD_HASH = 'a'.repeat(64);
const NEW_HASH = 'b'.repeat(64);

describe('Play source drift decisions', () => {
  it('continues with changed sources explicitly excluded without pretending old bytes exist', () => {
    const session = createSession();
    const status = createPlaySourceDriftStatus(session, [{
      sourceId: 'world',
      path: 'world/rules.md',
      expectedContentHash: OLD_HASH,
      actualContentHash: NEW_HASH,
      state: 'changed',
    }]);
    const result = resolvePlaySourceDriftDecision({
      session,
      status,
      decision: { kind: 'continueFrozen', baseRevision: 0 },
      decidedAt: '2026-07-20T00:00:00.000Z',
    });

    expect(result.session.activatedSources[0]?.contentHash).toBe(OLD_HASH);
    expect(result.resolution).toMatchObject({
      kind: 'continueFrozen',
      excludedSourceIds: ['world'],
      canonical: false,
    });
    expect(result.session.revision).toBe(1);
  });

  it('reassembles hashes as a Play-local revision and forks create-only data under a new identity', () => {
    const session = createSession();
    const status = createPlaySourceDriftStatus(session, [{
      sourceId: 'world',
      path: 'world/rules.md',
      expectedContentHash: OLD_HASH,
      actualContentHash: NEW_HASH,
      state: 'changed',
    }]);
    const reassembled = resolvePlaySourceDriftDecision({
      session,
      status,
      decision: { kind: 'reassemble', baseRevision: 0 },
    });
    expect(reassembled.session.activatedSources[0]?.contentHash).toBe(NEW_HASH);
    expect(session.activatedSources[0]?.contentHash).toBe(OLD_HASH);

    const forked = resolvePlaySourceDriftDecision({
      session,
      status,
      decision: {
        kind: 'fork',
        baseRevision: 0,
        newSessionId: 'play-fork',
        title: 'Canonical fork',
      },
      decidedAt: '2026-07-20T00:00:00.000Z',
    });
    expect(forked).toMatchObject({
      sourceSessionId: 'play-source',
      createdSessionId: 'play-fork',
      session: {
        id: 'play-fork',
        title: 'Canonical fork',
      },
    });
    expect(forked.session.activatedSources[0]?.contentHash).toBe(NEW_HASH);
    expect(session.id).toBe('play-source');
  });

  it('only offers continue when a source is unavailable', () => {
    const session = createSession();
    const status = createPlaySourceDriftStatus(session, [{
      sourceId: 'world',
      path: 'world/rules.md',
      expectedContentHash: OLD_HASH,
      state: 'missing',
    }]);
    expect(status).toMatchObject({
      overall: 'unavailable',
      availableDecisions: ['continueFrozen'],
      canonical: false,
    });
  });

  it('rewrites embedded rehearsal session identities when forking', () => {
    const session = createPlaySceneRehearsalSessionDraft({
      id: 'rehearsal-source',
      title: 'Rehearsal source',
      sceneStart: 'Start',
      characters: ['Alice'],
      activatedSources: createSession().activatedSources,
      sceneContract: {
        sceneId: 'scene-1',
        worldClock: { turn: 0, revision: 0 },
        clockProvenance: { kind: 'newSessionInitial', sourceRefs: ['world'] },
        participantRefs: ['participant-alice'],
        orderStrategy: 'directorFixed',
      },
      participants: [{
        participantRef: 'participant-alice',
        displayName: 'Alice',
        initialKnowledgeEvidenceRefs: [],
      }],
      initialKnowledgeEvidence: [],
    });
    const status = createPlaySourceDriftStatus(session, [{
      sourceId: 'world',
      path: 'world/rules.md',
      expectedContentHash: OLD_HASH,
      actualContentHash: NEW_HASH,
      state: 'changed',
    }]);
    const forked = resolvePlaySourceDriftDecision({
      session,
      status,
      decision: {
        kind: 'fork',
        baseRevision: 0,
        newSessionId: 'rehearsal-fork',
      },
    });

    expect(forked.session.sceneRehearsal?.sessionId).toBe('rehearsal-fork');
    expect(forked.session.rehearsalScenes?.map((scene) => scene.sessionId))
      .toEqual(['rehearsal-fork']);
    expect(session.sceneRehearsal?.sessionId).toBe('rehearsal-source');
  });
});

function createSession() {
  return createPlaySessionDraft({
    id: 'play-source',
    title: 'Source',
    sceneStart: 'Start',
    characters: [],
    activatedSources: [{
      sourceId: 'world',
      path: 'world/rules.md',
      contentHash: OLD_HASH,
      role: 'world',
      reason: 'World rules',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
      trust: 'canonical',
    }],
  });
}
