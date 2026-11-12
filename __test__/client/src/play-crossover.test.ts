import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vite-plus/test';
import { createOanClient } from '@oh-awesome-novel/client';
import { createCompactedPlaySession, createPlayCompactionPreview, createPlaySessionFromLaunchPackage, previewPlayLaunchPackage, settlePlayWorldRefereeResponse } from '@oh-awesome-novel/core';
import { crossoverFixture } from '../../core/src/fixtures/crossover';

it('strictly binds work assignments/contracts and refuses grants detached from a frozen source boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oan-crossover-client-'));
  try {
    const input = await crossoverFixture(root); const pkg = await previewPlayLaunchPackage(root, input);
    let body: unknown = { launchPackage: pkg };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
    const client = createOanClient({ backendBaseUrl: 'http://test', fetch: fetcher });
    expect((await client.previewPlayLaunchPackage(input)).launchPackage).toEqual(pkg);
    body = { launchPackage: { ...pkg, crossover: { ...pkg.crossover, knowledge: 'shared' } } };
    await expect(client.previewPlayLaunchPackage(input)).rejects.toThrow();
    body = { launchPackage: { ...pkg, crossover: { ...pkg.crossover, extra: 'unknown' } } };
    await expect(client.previewPlayLaunchPackage(input)).rejects.toThrow();
    const malformed = structuredClone(input); delete malformed.crossover;
    await expect(client.previewPlayLaunchPackage(malformed)).rejects.toThrow();
    const session = settlePlayWorldRefereeResponse({ session: createPlaySessionFromLaunchPackage(pkg, { id: 'cross' }), actionKind: 'say', userText: '介绍', refereeResponse: `介绍了另一作品。\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [{ kind: 'informationSpread', origin: 'npc', title: '介绍', summary: '说明来历', visibility: 'playerVisible', cause: { reason: '交流' } }], stateDelta: {}, observations: [], suggestedActions: [], knowledgeChanges: [{ type: 'learnSource', participantRef: 'a1', sourceId: 'b1', eventRef: 1 }] })}\n\`\`\`` });
    body = { session }; await expect(client.getPlaySession('cross')).resolves.toMatchObject({ session: { revision: 1 } });
    const archive = createPlayCompactionPreview(session, JSON.stringify({ version: 1, turnsCovered: 1,
      characters: [], chronicle: ['介绍了另一作品。'], unresolvedThreads: [],
      currentScene: { timeAndPlace: '未记录', presentCharacters: [], atmosphere: '未记录', immediateCrisis: '未记录' },
      voiceAndStyle: { pov: 'third', rhythm: 'slow', tonePoints: [] }, resourceState: session.playLocalState }));
    body = { session: createCompactedPlaySession(session, archive, 'continued') };
    await expect(client.getPlaySession('continued')).resolves.toMatchObject({ session: { metadataExtensions: { playCrossover: expect.any(Object) } } });
    const forged = structuredClone(session); delete forged.metadataExtensions.playCrossover;
    body = { session: forged }; await expect(client.getPlaySession('cross')).rejects.toThrow();
    body = { session: { ...session, activatedSources: session.activatedSources.map(source => ({ ...source, originWork: { id: 'bad/id', title: 'bad' } })) } };
    await expect(client.getPlaySession('cross')).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
