import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  addPlayTranscriptTurn,
  createPlaySceneRehearsalSessionDraft,
  createPlaySessionDraft,
  createPlaySessionFromLaunchPackage,
  previewPlayLaunchPackage,
  readPlayLaunchPackage,
  readPlayLaunchReuseSeed,
  readPlaySessionFiles,
  writePlayLaunchPackage,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlayLaunchPackagePreviewInput } from '@oh-awesome-novel/core';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-launch-reuse-'));
  roots.push(root);
  await mkdir(join(root, 'chapters'), { recursive: true });
  await mkdir(join(root, 'timeline'), { recursive: true });
  await writeFile(join(root, 'chapters/opening.md'), 'Rain crosses the platform.\n');
  await writeFile(join(root, 'timeline/main.md'), '- The last train leaves at midnight.\n');
  return root;
}

const launchInput: PlayLaunchPackagePreviewInput = {
  id: 'setup-original',
  createdAt: '2026-11-10T00:00:00.000Z',
  title: 'Station journey',
  purpose: 'immersiveJourney',
  startMode: 'guided',
  simulationMode: 'activeWorld',
  density: 'quiet',
  sources: [
    { sourceId: 'chapter-opening', path: 'chapters/opening.md', role: 'chapter' },
    { sourceId: 'timeline-main', path: 'timeline/main.md', role: 'timeline' },
  ],
  entryPoint: {
    id: 'entry-1',
    label: 'Last platform',
    opening: 'The last train approaches.',
    sourceRefs: ['chapter-opening'],
  },
  identity: { kind: 'player', persona: 'A late traveler.' },
  participantRoles: [],
};

async function guidedSession(root: string, id = 'play-original') {
  const launchPackage = await previewPlayLaunchPackage(root, launchInput);
  await writePlayLaunchPackage(root, launchPackage);
  const session = addPlayTranscriptTurn(
    createPlaySessionFromLaunchPackage(
      await readPlayLaunchPackage(root, launchPackage.id),
      { id },
    ),
    { speaker: 'user', content: 'A secret only this session knows.', createdAt: '2026-11-10T00:01:00.000Z' },
  );
  await writePlaySessionFiles(root, session);
  return session;
}

describe('Play launch reuse', () => {
  it('returns the frozen guided opening with every source unchanged', async () => {
    const root = await workspace();
    const original = await guidedSession(root);

    const seed = await readPlayLaunchReuseSeed(root, original.id);

    expect(seed.kind).toBe('guided');
    if (seed.kind !== 'guided') throw new Error('expected guided seed');
    expect(seed.launch).toEqual({
      ...launchInput,
      id: undefined,
      createdAt: undefined,
      sources: launchInput.sources.map((source) => ({
        ...source,
        reason: `Guided Start ${source.role} source`,
      })),
    });
    expect(Object.hasOwn(seed.launch, 'id')).toBe(false);
    expect(seed.sources.map((source) => source.status)).toEqual(['unchanged', 'unchanged']);
    expect(JSON.stringify(seed)).not.toContain('A secret only this session knows.');
    expect(JSON.stringify(seed)).not.toContain('setup-original');
  });

  it('reports changed and missing sources before anything is created', async () => {
    const root = await workspace();
    const original = await guidedSession(root);
    await writeFile(join(root, 'chapters/opening.md'), 'The platform is dry tonight.\n');
    await rm(join(root, 'timeline/main.md'));

    const seed = await readPlayLaunchReuseSeed(root, original.id);

    if (seed.kind !== 'guided') throw new Error('expected guided seed');
    const [changed, missing] = seed.sources;
    expect(changed).toMatchObject({ path: 'chapters/opening.md', status: 'changed' });
    expect(changed?.frozenContentHash).not.toBe(changed?.currentContentHash);
    expect(missing).toMatchObject({ path: 'timeline/main.md', status: 'missing' });
    expect(missing?.currentContentHash).toBeUndefined();
  });

  it('creates an unrelated session and leaves the source session untouched', async () => {
    const root = await workspace();
    const original = await guidedSession(root);
    const seed = await readPlayLaunchReuseSeed(root, original.id);
    if (seed.kind !== 'guided') throw new Error('expected guided seed');

    const nextPackage = await previewPlayLaunchPackage(root, seed.launch);
    await writePlayLaunchPackage(root, nextPackage);
    const next = createPlaySessionFromLaunchPackage(nextPackage, { id: 'play-again' });
    await writePlaySessionFiles(root, next);

    expect(nextPackage.id).not.toBe('setup-original');
    expect(next.revision).toBe(0);
    expect(next.transcript).toEqual([]);
    expect(next.turnArtifacts).toEqual([]);
    expect(next.playLocalState).toEqual({});
    expect(next.sceneStart).toBe(original.sceneStart);
    expect(next.userPersona).toBe(original.userPersona);
    const reread = await readPlaySessionFiles(root, original.id);
    expect(reread.revision).toBe(original.revision);
    expect(reread.selectedTurnIds).toEqual(original.selectedTurnIds);
    expect(reread.transcript).toEqual(original.transcript);
  });

  it('prefills a quick journey from its form only, never from later Play-local state', async () => {
    const root = await workspace();
    const quick = addPlayTranscriptTurn(createPlaySessionDraft({
      id: 'play-quick',
      title: 'Dock night',
      sceneStart: 'Fog on the dock.',
      userPersona: 'A courier.',
      characters: ['Mara'],
      eventPolicy: { simulationMode: 'conversation', density: 'volatile' },
      worldMomentum: {
        pressures: [{
          id: 'pressure-1',
          kind: 'deadline',
          label: 'Ship leaves at dawn',
          status: 'active',
          causeRefs: ['branch-base'],
          nextConsequence: 'The gangway is raised.',
          visibility: 'playerVisible',
        }],
        agendas: [],
      },
    }), { speaker: 'user', content: 'Later turn text.', createdAt: '2026-11-10T00:01:00.000Z' });
    await writePlaySessionFiles(root, quick);

    const seed = await readPlayLaunchReuseSeed(root, quick.id);

    expect(seed).toMatchObject({
      kind: 'quickJourney',
      sourceSessionId: 'play-quick',
      form: {
        title: 'Dock night',
        sceneStart: 'Fog on the dock.',
        userPersona: 'A courier.',
        characters: ['Mara'],
        eventPolicy: { simulationMode: 'conversation', density: 'volatile' },
        worldMomentum: { pressures: [{ label: 'Ship leaves at dawn' }], agendas: [] },
      },
    });
    expect(JSON.stringify(seed)).not.toContain('Later turn text.');
  });

  it('prefills a quick rehearsal with its scene and cast', async () => {
    const root = await workspace();
    const rehearsal = createPlaySceneRehearsalSessionDraft({
      id: 'play-rehearsal',
      title: 'Argument',
      sceneStart: 'Two people face each other.',
      characters: [],
      sceneContract: {
        sceneId: 'scene-1',
        worldClock: { turn: 0, revision: 0 },
        clockProvenance: { kind: 'newSessionInitial', sourceRefs: [], authorProvidedAt: '2026-11-10T00:00:00.000Z' },
        location: { value: 'Kitchen', provenance: { kind: 'authorProvided', providedAt: '2026-11-10T00:00:00.000Z' } },
        objective: { value: 'Find the breaking point', provenance: { kind: 'authorProvided', providedAt: '2026-11-10T00:00:00.000Z' } },
        participantRefs: ['participant-1', 'participant-2'],
        orderStrategy: 'directorFixed',
      },
      participants: [
        { participantRef: 'participant-1', displayName: 'Ana', currentGoal: 'Leave', initialKnowledgeEvidenceRefs: ['k1'] },
        { participantRef: 'participant-2', displayName: 'Bo', currentGoal: 'Stay', initialKnowledgeEvidenceRefs: [] },
      ],
      initialKnowledgeEvidence: [{
        id: 'k1',
        participantRef: 'participant-1',
        visibility: 'playerVisible',
        fact: 'Ana already packed.',
        provenance: { kind: 'authorProvided', providedAt: '2026-11-10T00:00:00.000Z' },
      }],
    });
    await writePlaySessionFiles(root, rehearsal);

    const seed = await readPlayLaunchReuseSeed(root, rehearsal.id);

    if (seed.kind !== 'quickRehearsal') throw new Error('expected quick rehearsal seed');
    expect(seed.form).toMatchObject({
      title: 'Argument',
      opening: 'Two people face each other.',
      location: 'Kitchen',
      atmosphere: '',
      objective: 'Find the breaking point',
    });
    expect(seed.form.participants.map((participant) => participant.displayName)).toEqual(['Ana', 'Bo']);
    expect(seed.form.participants[0]?.initialKnowledge).toBe('Ana already packed.');
  });
});
