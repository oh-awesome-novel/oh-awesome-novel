import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'oan-launch-reuse-http-'));
  await mkdir(join(root, '.oan'), { recursive: true });
  await mkdir(join(root, 'chapters'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'schemaVersion: 1\n');
  await writeFile(join(root, 'chapters/opening.md'), 'Rain crosses the platform.\n');
  const backend = await startNovelHttpBackend({ workspaceRoot: root });
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }); });
  return { root, client: createOanClient({ backendBaseUrl: backend.url }) };
}

describe('Play launch reuse over HTTP', () => {
  it('reuses a guided opening through the SDK and flags drift before creation', async () => {
    const { root, client } = await setup();
    const { launchPackage } = await client.previewPlayLaunchPackage({
      title: 'Station journey',
      purpose: 'immersiveJourney',
      startMode: 'guided',
      simulationMode: 'reactiveWorld',
      density: 'balanced',
      sources: [{ sourceId: 'chapter-opening', path: 'chapters/opening.md', role: 'chapter' }],
      entryPoint: { id: 'entry-1', label: 'Platform', opening: 'The train arrives.', sourceRefs: ['chapter-opening'] },
      identity: { kind: 'player', persona: 'A traveler.' },
      participantRoles: [],
    });
    await client.createPlayLaunchPackage(launchPackage);
    const original = (await client.startPlaySessionFromLaunchPackage({
      launchPackageId: launchPackage.id,
      id: 'play-original',
    })).session;

    const { seed } = await client.getPlayLaunchReuseSeed(original.id);
    if (seed.kind !== 'guided') throw new Error('expected guided seed');
    expect(seed.sources).toEqual([expect.objectContaining({ status: 'unchanged' })]);

    // Unmodified seed -> preview -> create -> start: a second, unrelated session.
    const again = await client.previewPlayLaunchPackage(seed.launch);
    await client.createPlayLaunchPackage(again.launchPackage);
    const next = (await client.startPlaySessionFromLaunchPackage({
      launchPackageId: again.launchPackage.id,
      id: 'play-again',
    })).session;
    expect(next.id).toBe('play-again');
    expect(next.revision).toBe(0);
    expect(again.launchPackage.id).not.toBe(launchPackage.id);
    expect((await client.getPlaySession(original.id)).session.revision).toBe(original.revision);

    await writeFile(join(root, 'chapters/opening.md'), 'The platform is dry.\n');
    const drifted = (await client.getPlayLaunchReuseSeed(original.id)).seed;
    if (drifted.kind !== 'guided') throw new Error('expected guided seed');
    expect(drifted.sources).toEqual([expect.objectContaining({ status: 'changed' })]);
  });

  it('returns 404 for an unknown session', async () => {
    const { client } = await setup();
    await expect(client.getPlayLaunchReuseSeed('missing-session')).rejects.toThrow();
  });
});
