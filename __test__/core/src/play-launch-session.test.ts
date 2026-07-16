import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION,
  PLAY_LAUNCH_SESSION_METADATA_KEY,
  createPlaySessionDraft,
  createPlaySessionFromLaunchPackage,
  getPlayLaunchSessionMetadata,
  getPlaySessionPurpose,
  getPlaySessionStartMode,
  readPlaySessionFiles,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlayLaunchPackage } from '@oh-awesome-novel/core';

const HASH = 'a'.repeat(64);

function launchPackage(
  purpose: 'immersiveJourney' | 'sceneRehearsal',
): PlayLaunchPackage {
  return {
    schemaVersion: PLAY_LAUNCH_PACKAGE_SCHEMA_VERSION,
    id: `setup-${purpose}`,
    createdAt: '2026-07-16T08:00:00.000Z',
    title: purpose === 'sceneRehearsal' ? 'Station rehearsal' : 'Station journey',
    purpose,
    startMode: 'guided',
    eventPolicy: {
      simulationMode: 'reactiveWorld',
      density: 'balanced',
    },
    sourceBase: {
      activatedSources: [{
        sourceId: 'chapter-opening',
        path: 'chapters/opening.md',
        objectId: 'opening',
        role: 'chapter',
        reason: 'Opening scene',
        budgetLayer: 'L2',
        semanticBoundary: 'compressible',
        trust: 'canonical',
        status: 'ready',
        contentHash: HASH,
        excerpt: 'Rain crosses the platform.',
      }, {
        sourceId: 'character-lin',
        path: 'characters/lin.md',
        objectId: 'lin',
        role: 'character',
        reason: 'Cast source',
        budgetLayer: 'L1',
        semanticBoundary: 'compressible',
        trust: 'canonical',
        status: 'ready',
        contentHash: HASH.replaceAll('a', 'b'),
        excerpt: 'Lin is waiting for the last train.',
      }],
    },
    entryPoint: {
      id: 'platform-entry',
      label: 'Last platform',
      opening: 'Rain crosses the platform as the last train approaches.',
      sourceRefs: ['chapter-opening'],
      location: {
        value: 'East platform',
        provenance: { kind: 'sourceBacked', sourceRefs: ['chapter-opening'] },
      },
      worldTime: {
        value: 'Midnight',
        provenance: { kind: 'sourceBacked', sourceRefs: ['chapter-opening'] },
      },
      objective: {
        value: 'Find out why Lin stayed.',
        provenance: {
          kind: 'authorProvided',
          providedAt: '2026-07-16T08:00:00.000Z',
        },
      },
    },
    identity: purpose === 'sceneRehearsal'
      ? { kind: 'director', directorPurpose: 'Calibrate Lin reaction.' }
      : { kind: 'player', persona: 'A passenger carrying a sealed letter.' },
    participantRoles: [{
      participantRef: 'participant-lin',
      displayName: 'Lin',
      canonicalCharacterRef: 'lin',
      sourceRefs: ['character-lin'],
      position: 'Under the station clock',
      currentGoal: 'Delay the train',
      initialKnowledge: [{
        id: 'knowledge-last-train',
        fact: 'This is the final train tonight.',
        visibility: 'playerVisible',
        sourceRefs: ['chapter-opening'],
      }],
    }],
    diagnostics: [],
    canonical: false,
  };
}

describe('Play source-backed launch session mapping', () => {
  it('creates a guided immersive v4 session without changing Quick Start defaults', () => {
    const session = createPlaySessionFromLaunchPackage(
      launchPackage('immersiveJourney'),
      { id: 'guided-journey', createdAt: '2026-07-16T09:00:00.000Z' },
    );

    expect(session.schemaVersion).toBe(4);
    expect(getPlaySessionPurpose(session)).toBe('immersiveJourney');
    expect(getPlaySessionStartMode(session)).toBe('guided');
    expect(session.worldClock.anchor).toBe('Midnight');
    expect(session.branchBaseSnapshot.worldClock).toEqual(session.worldClock);
    expect(session.activatedSources[0]).toMatchObject({
      sourceId: 'chapter-opening',
      objectId: 'opening',
      role: 'chapter',
      contentHash: HASH,
    });
    expect(getPlayLaunchSessionMetadata(session)).toEqual({
      setupId: 'setup-immersiveJourney',
      setupSchemaVersion: 1,
      purpose: 'immersiveJourney',
      startMode: 'guided',
    });

    const quick = createPlaySessionDraft({
      id: 'legacy-quick',
      title: 'Quick',
      sceneStart: 'Start',
      characters: [],
    });
    expect(getPlaySessionPurpose(quick)).toBe('immersiveJourney');
    expect(getPlaySessionStartMode(quick)).toBe('quick');
  });

  it('maps a guided rehearsal into the existing v5 frozen Scene Contract', () => {
    const session = createPlaySessionFromLaunchPackage(
      launchPackage('sceneRehearsal'),
      { id: 'guided-rehearsal' },
    );

    expect(session.schemaVersion).toBe(5);
    if (session.schemaVersion !== 5) throw new Error('Expected rehearsal session.');
    expect(session.sceneRehearsal).toMatchObject({
      purpose: 'sceneRehearsal',
      startMode: 'guided',
      activeSceneRef: 'platform-entry',
      sceneContract: {
        worldClock: { turn: 0, revision: 0, anchor: 'Midnight' },
        clockProvenance: {
          kind: 'newSessionInitial',
          sourceRefs: ['chapter-opening'],
        },
        location: {
          value: 'East platform',
          provenance: { kind: 'sourceBacked', sourceRefs: ['chapter-opening'] },
        },
      },
      participants: [{
        participantRef: 'participant-lin',
        currentGoal: 'Delay the train',
        initialKnowledgeEvidenceRefs: ['knowledge-last-train'],
      }],
      initialKnowledgeEvidence: [{
        id: 'knowledge-last-train',
        fact: 'This is the final train tonight.',
        provenance: {
          kind: 'sourceBacked',
          sourceId: 'chapter-opening',
          sourcePath: 'chapters/opening.md',
          contentHash: HASH,
          sourceFactRef: 'knowledge-last-train',
        },
      }],
    });
    expect(session.worldClock).toEqual(session.sceneRehearsal.sceneContract.worldClock);
    expect(getPlaySessionPurpose(session)).toBe('sceneRehearsal');
    expect(getPlaySessionStartMode(session)).toBe('guided');
  });

  it('round-trips setup provenance with activatedSources as the only hash truth', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'oan-play-launch-session-'));
    try {
      const session = createPlaySessionFromLaunchPackage(
        launchPackage('immersiveJourney'),
        { id: 'guided-round-trip' },
      );
      await writePlaySessionFiles(workspace, session);
      const restored = await readPlaySessionFiles(workspace, session.id);

      expect(restored.activatedSources).toEqual(session.activatedSources);
      expect(getPlayLaunchSessionMetadata(restored))
        .toEqual(getPlayLaunchSessionMetadata(session));
      expect(getPlaySessionStartMode(restored)).toBe('guided');

      await writePlaySessionFiles(workspace, {
        ...session,
        activatedSources: session.activatedSources.map((source, index) =>
          index === 0 ? { ...source, contentHash: undefined } : source),
      });
      await expect(readPlaySessionFiles(workspace, session.id)).rejects
        .toThrow(/activated source hash and role evidence/u);

      await writePlaySessionFiles(workspace, {
        ...session,
        metadataExtensions: {
          ...session.metadataExtensions,
          [PLAY_LAUNCH_SESSION_METADATA_KEY]: {
            ...getPlayLaunchSessionMetadata(session),
            purpose: 'sceneRehearsal',
          },
        },
      });
      await expect(readPlaySessionFiles(workspace, session.id)).rejects
        .toThrow(/purpose does not match/u);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('fails closed for blocking packages and malformed persisted launch metadata', () => {
    const blocked = launchPackage('immersiveJourney');
    blocked.diagnostics.push({
      id: 'diagnostic-missing',
      code: 'missingSource',
      severity: 'error',
      message: 'Missing source',
      sourceId: 'chapter-opening',
      path: 'chapters/opening.md',
    });
    expect(() => createPlaySessionFromLaunchPackage(blocked, { id: 'blocked' }))
      .toThrow(/blocking diagnostics/u);

    const session = createPlaySessionDraft({
      id: 'invalid-metadata',
      title: 'Invalid',
      sceneStart: 'Start',
      characters: [],
    });
    session.metadataExtensions[PLAY_LAUNCH_SESSION_METADATA_KEY] = {
      setupId: 'setup-invalid',
      setupSchemaVersion: 1,
      purpose: 'immersiveJourney',
      startMode: 'guided',
      sourceHashes: { source: 'not-a-hash' },
    };
    expect(() => getPlayLaunchSessionMetadata(session)).toThrow(/unknown field/u);
  });
});
