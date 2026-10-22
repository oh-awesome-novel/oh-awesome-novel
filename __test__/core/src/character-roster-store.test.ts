import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachPlayCharacterRoster, createPlaySessionDraft, serializeRosterProfile, addPlayTranscriptTurn, writePlaySessionFiles, readPlaySessionFiles } from '@oh-awesome-novel/core';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('filesystem character roster', () => {
  it('loads aliases and preserves snapshot across reload and later profile edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-roster-')); roots.push(root);
    await mkdir(join(root, 'characters', 'nian'), { recursive: true });
    const profile = { id: 'nian', name: '念念', aliases: ['小念'], genderKind: 'girl' as const, isPlayer: false, looks: { fixedBooruTags: '', outfitDescription: '', outfitTags: '' } };
    await writeFile(join(root, 'characters/nian/roster-profile.yaml'), serializeRosterProfile(profile));
    const session = createPlaySessionDraft({ id: 'roster', title: 'roster', sceneStart: '客栈', characters: ['小念'] });
    await attachPlayCharacterRoster(root, session);
    const next = addPlayTranscriptTurn(session, { speaker: 'narrator', content: '小念说：“回来。”', createdAt: '2026-01-01T00:00:00.000Z' });
    await writePlaySessionFiles(root, next, { expectedAbsent: true });
    await writeFile(join(root, 'characters/nian/roster-profile.yaml'), serializeRosterProfile({ ...profile, aliases: [] }));
    const reloaded = await readPlaySessionFiles(root, session.id);
    expect(reloaded.transcript[0]?.stageSnapshot?.beats[0]?.speaker).toBe('nian');
    expect(reloaded.transcript[0]?.stageSnapshot?.sceneId).toBe('客栈');
  });
  it('freezes local scene backgrounds on narrative nodes across reload and sibling scenes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-scenes-')); roots.push(root);
    await mkdir(join(root, 'world/places'), { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6kAAAAASUVORK5CYII=', 'base64');
    await writeFile(join(root, 'world/places/inn.png'), png);
    const session = createPlaySessionDraft({ id: 'scenery', title: 'scenery', sceneStart: 'inn', characters: [] });
    await attachPlayCharacterRoster(root, session);
    const first = addPlayTranscriptTurn(session, { speaker: 'narrator', content: '雨停。', createdAt: '2026-01-01T00:00:00.000Z' });
    const frozen = first.transcript[0]?.stageSnapshot?.backgroundDataUrl;
    expect(frozen).toBe(`data:image/png;base64,${png.toString('base64')}`);
    await writePlaySessionFiles(root, first, { expectedAbsent: true });
    await writeFile(join(root, 'world/places/inn.png'), 'changed');
    const reloaded = await readPlaySessionFiles(root, session.id);
    expect(reloaded.transcript[0]?.stageSnapshot?.backgroundDataUrl).toBe(frozen);
    const sibling = addPlayTranscriptTurn({ ...session, sceneStart: 'mountain' }, { speaker: 'narrator', content: '雪落。', createdAt: '2026-01-01T00:00:01.000Z' });
    expect(sibling.transcript[0]?.stageSnapshot?.sceneId).toBe('mountain');
    expect(sibling.transcript[0]?.stageSnapshot?.backgroundDataUrl).toBeUndefined();
    expect(first.transcript[0]?.stageSnapshot?.sceneId).toBe('inn');
  });
  it('rejects symlink scene images rather than reading their targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-scenes-')); roots.push(root);
    await mkdir(join(root, 'world/places'), { recursive: true });
    await writeFile(join(root, 'outside.png'), 'private');
    await symlink(join(root, 'outside.png'), join(root, 'world/places/inn.png'));
    const session = createPlaySessionDraft({ id: 'scenery', title: 'scenery', sceneStart: 'inn', characters: [] });
    await expect(attachPlayCharacterRoster(root, session)).rejects.toThrow();
  });
  it('rejects symlink profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-roster-')); roots.push(root);
    await mkdir(join(root, 'characters/nian'), { recursive: true });
    await writeFile(join(root, 'outside.yaml'), '{}');
    await symlink(join(root, 'outside.yaml'), join(root, 'characters/nian/roster-profile.yaml'));
    const session = createPlaySessionDraft({ id: 'roster', title: 'roster', sceneStart: '客栈', characters: ['nian'] });
    await expect(attachPlayCharacterRoster(root, session)).rejects.toThrow();
  });
});
