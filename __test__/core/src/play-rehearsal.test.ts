import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PLAY_REHEARSAL_SESSION_SCHEMA_VERSION,
  assertNarrativeBlocksWithinPerception,
  createCharacterPerceptionPackage,
  createPlaySceneRehearsalSessionDraft,
  createPlaySessionDraft,
  listForbiddenPlayKnowledgeEvidenceRefs,
  normalizeCharacterPerceptionPackage,
  normalizePlaySceneRehearsalSidecar,
  readPlaySessionFiles,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type {
  CreatePlaySceneRehearsalSessionInput,
  NarrativeBlock,
} from '@oh-awesome-novel/core';

const createRehearsalInput = (
  id = 'play-rehearsal-fixture',
): CreatePlaySceneRehearsalSessionInput => ({
  id,
  title: 'Scene rehearsal fixture',
  createdAt: '2026-07-15T00:00:00.000Z',
  sceneStart: 'A rain-dark station platform.',
  characters: [],
  startMode: 'guided',
  sceneContract: {
    sceneId: 'scene-station',
    worldClock: { turn: 0, revision: 0 },
    clockProvenance: {
      kind: 'newSessionInitial',
      sourceRefs: ['outline-station'],
    },
    location: {
      value: 'Station platform',
      provenance: {
        kind: 'sourceBacked',
        sourceRefs: ['outline-station'],
      },
    },
    atmosphere: {
      value: 'Cold rain and an empty timetable',
      provenance: {
        kind: 'authorProvided',
        providedAt: '2026-07-15T00:00:00.000Z',
      },
    },
    participantRefs: ['participant-alice', 'participant-bob'],
    orderStrategy: 'directorFixed',
  },
  participants: [{
    participantRef: 'participant-alice',
    canonicalCharacterRef: 'character-alice',
    displayName: 'Alice',
    currentGoal: 'Find the last train.',
    initialKnowledgeEvidenceRefs: ['knowledge-alice-ticket'],
  }, {
    participantRef: 'participant-bob',
    canonicalCharacterRef: 'character-bob',
    displayName: 'Bob',
    currentGoal: 'Keep the platform closed.',
    initialKnowledgeEvidenceRefs: ['knowledge-bob-lock'],
  }],
  initialKnowledgeEvidence: [{
    id: 'knowledge-alice-ticket',
    participantRef: 'participant-alice',
    visibility: 'playerVisible',
    fact: 'Alice carries a valid night ticket.',
    provenance: {
      kind: 'sourceBacked',
      sourceId: 'character-alice',
      sourcePath: 'characters/alice/profile.md',
      contentHash: 'sha256-alice-ticket',
    },
  }, {
    id: 'knowledge-bob-lock',
    participantRef: 'participant-bob',
    visibility: 'playerUnknown',
    fact: 'Bob locked the maintenance gate himself.',
    provenance: {
      kind: 'authorProvided',
      providedAt: '2026-07-15T00:00:00.000Z',
    },
  }],
});

describe('Play Scene Rehearsal contract and perception', () => {
  it('keeps ordinary/Quick Play at v4 and creates rehearsal sessions at v5', () => {
    const ordinary = createPlaySessionDraft({
      id: 'play-ordinary-v4',
      title: 'Ordinary Play',
      sceneStart: 'A normal scene.',
      characters: [],
    });
    const input = createRehearsalInput();
    const rehearsal = createPlaySceneRehearsalSessionDraft(input);

    expect(ordinary.schemaVersion).toBe(4);
    expect(ordinary).not.toHaveProperty('sceneRehearsal');
    expect(ordinary).not.toHaveProperty('rehearsalScenes');
    expect(rehearsal).toMatchObject({
      schemaVersion: PLAY_REHEARSAL_SESSION_SCHEMA_VERSION,
      characters: ['Alice', 'Bob'],
      sceneRehearsal: {
        activeSceneRef: 'scene-station',
        startMode: 'guided',
      },
      rehearsalScenes: [{
        sceneId: 'scene-station',
        turns: [],
      }],
    });
  });

  it('freezes participant-specific initial knowledge and rejects forbidden refs', () => {
    const input = createRehearsalInput();
    const rehearsal = createPlaySceneRehearsalSessionDraft(input);

    input.initialKnowledgeEvidence[0]!.fact = 'Mutated after session creation.';
    input.participants[0]!.initialKnowledgeEvidenceRefs = ['knowledge-bob-lock'];

    const perception = createCharacterPerceptionPackage(
      rehearsal.sceneRehearsal!,
      'participant-alice',
    );
    expect(perception.initialKnowledgeEvidence).toEqual([
      expect.objectContaining({
        id: 'knowledge-alice-ticket',
        fact: 'Alice carries a valid night ticket.',
      }),
    ]);
    expect(JSON.stringify(perception)).not.toContain('locked the maintenance gate');
    expect(listForbiddenPlayKnowledgeEvidenceRefs(
      rehearsal.sceneRehearsal!,
      'participant-alice',
    )).toEqual(['knowledge-bob-lock']);

    const forbiddenBlock: NarrativeBlock = {
      id: 'block-forbidden',
      kind: 'characterSpeech',
      speakerRef: 'participant-alice',
      content: 'I know who locked the gate.',
      visibility: 'playerVisible',
      projection: 'transcript',
      eventRefs: [],
      sourceRefs: ['knowledge-bob-lock'],
    };
    expect(() => assertNarrativeBlocksWithinPerception(
      [forbiddenBlock],
      perception,
    )).toThrow('forbidden knowledge evidence');
    expect(() => normalizeCharacterPerceptionPackage({
      ...perception,
      hiddenFactRefs: ['knowledge-bob-lock'],
    })).toThrow('unknown fields');
    expect(() => normalizeCharacterPerceptionPackage({
      ...perception,
      initialKnowledgeEvidence: [{
        ...perception.initialKnowledgeEvidence[0],
        participantRef: 'participant-bob',
      }],
    })).toThrow('does not match its participant snapshot');
  });

  it('strictly rejects unknown sidecar fields and identity/order mismatch', () => {
    const sidecar = createPlaySceneRehearsalSessionDraft(
      createRehearsalInput(),
    ).sceneRehearsal!;

    expect(() => normalizePlaySceneRehearsalSidecar({
      ...sidecar,
      hiddenRuntimeState: true,
    })).toThrow('unknown fields');
    expect(() => normalizePlaySceneRehearsalSidecar({
      ...sidecar,
      activeSceneRef: 'scene-other',
    })).toThrow('activeSceneRef');
    expect(() => normalizePlaySceneRehearsalSidecar({
      ...sidecar,
      participants: [...sidecar.participants].reverse(),
    })).toThrow('fixed Scene Contract order');
  });
});

describe('Play Scene Rehearsal filesystem pairing', () => {
  it('stages and reads a v5 parent with its sidecar and scene evidence', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-rehearsal-v5-'));
    const session = createPlaySceneRehearsalSessionDraft(
      createRehearsalInput('play-rehearsal-write'),
    );
    try {
      const files = await writePlaySessionFiles(workspaceRoot, session);
      expect(files.some((file) => file.endsWith('scene-rehearsal.yaml'))).toBe(true);
      expect(files.some((file) => file.endsWith('scenes/scene-station.yaml'))).toBe(true);
      await expect(readPlaySessionFiles(workspaceRoot, session.id)).resolves.toMatchObject({
        schemaVersion: 5,
        sceneRehearsal: { sessionId: session.id },
        rehearsalScenes: [{ sessionId: session.id, sceneId: 'scene-station' }],
      });
      await writeFile(join(
        workspaceRoot,
        '.workspace/play-sessions/play-rehearsal-write/scenes/notes.txt',
      ), 'not part of the committed scene manifest\n');
      await expect(readPlaySessionFiles(workspaceRoot, session.id))
        .rejects.toThrow('unsupported entry');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('fails closed for v5 missing/mismatched sidecars and v4 orphan files', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-play-rehearsal-pairing-'));
    try {
      const rehearsal = createPlaySceneRehearsalSessionDraft(
        createRehearsalInput('play-rehearsal-pairing'),
      );
      await writePlaySessionFiles(workspaceRoot, rehearsal);
      const rehearsalRoot = join(
        workspaceRoot,
        '.workspace/play-sessions/play-rehearsal-pairing',
      );
      const sidecarPath = join(rehearsalRoot, 'scene-rehearsal.yaml');
      const sidecarYaml = await readFile(sidecarPath, 'utf-8');
      await writeFile(
        sidecarPath,
        sidecarYaml.replace(
          'sessionId: play-rehearsal-pairing',
          'sessionId: play-another-session',
        ),
        'utf-8',
      );
      await expect(readPlaySessionFiles(workspaceRoot, rehearsal.id))
        .rejects.toThrow('belongs to another session');
      await rm(sidecarPath);
      await expect(readPlaySessionFiles(workspaceRoot, rehearsal.id))
        .rejects.toThrow('requires a matching scene rehearsal sidecar');

      const ordinary = createPlaySessionDraft({
        id: 'play-v4-orphan',
        title: 'V4 orphan',
        sceneStart: 'Ordinary scene.',
        characters: [],
      });
      await writePlaySessionFiles(workspaceRoot, ordinary);
      const ordinaryRoot = join(
        workspaceRoot,
        '.workspace/play-sessions/play-v4-orphan',
      );
      await writeFile(join(ordinaryRoot, 'scene-rehearsal.yaml'), 'schemaVersion: 1\n');
      await mkdir(join(ordinaryRoot, 'scenes'));
      await expect(readPlaySessionFiles(workspaceRoot, ordinary.id))
        .rejects.toThrow('cannot contain orphan scene rehearsal files');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
