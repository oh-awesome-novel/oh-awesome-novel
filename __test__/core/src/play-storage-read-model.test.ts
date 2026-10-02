import { cp, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlaySessionDraft, listPlaySessionSummaries, projectPlaySessionSelectedDetail,
  readPlaySessionFiles, readPlaySessionSelectedDetail, settlePlayWorldRefereeResponse,
  restorePlaySessionCheckpoint, settlePlayWorldSettlementRetry, writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlaySession } from '@oh-awesome-novel/core';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('Play snapshot-bound storage read models', () => {
  it('matches every transcript/event cursor page and keeps hidden event evidence intact', async () => {
    const fixture = await setup(38);
    let transcriptCursor: string | undefined;
    let eventCursor: string | undefined;
    let pages = 0;
    do {
      const options = { limit: 9, transcriptCursor, eventCursor };
      const actual = await readPlaySessionSelectedDetail(fixture.root, fixture.session.id, options);
      expect(actual).toEqual(projectPlaySessionSelectedDetail(fixture.session, options));
      transcriptCursor = actual.transcript.nextCursor;
      eventCursor = actual.events.nextCursor;
      pages += 1;
    } while (transcriptCursor);
    expect(pages).toBeGreaterThan(2);
    expect((await listPlaySessionSummaries(fixture.root))[0]?.transcriptCount).toBe(76);
  });

  it('rebuilds a deleted derived directory and a missing page from validated facts', async () => {
    const fixture = await setup(18);
    const expected = await readPlaySessionSelectedDetail(fixture.root, fixture.session.id, { limit: 7 });
    const metadataBefore = await readFile(join(fixture.sessionRoot, 'session.yaml'), 'utf8');
    await rm(join(fixture.sessionRoot, '.read-model'), { recursive: true });
    expect(await readPlaySessionSelectedDetail(fixture.root, fixture.session.id, { limit: 7 })).toEqual(expected);
    expect(await readFile(join(fixture.sessionRoot, 'session.yaml'), 'utf8')).toBe(metadataBefore);
    const objects = await readObjects(fixture.sessionRoot);
    const page = objects.find((entry) => entry.value.kind === 'page' && entry.value.items.some((item: any) => item.speaker));
    await rm(join(fixture.sessionRoot, '.read-model', page!.name));
    expect(await readPlaySessionSelectedDetail(fixture.root, fixture.session.id, { limit: 200 }))
      .toEqual(projectPlaySessionSelectedDetail(fixture.session, { limit: 200 }));
  });

  it('rejects corrupted derived bytes instead of serving or silently trusting them', async () => {
    const fixture = await setup(4);
    const objects = await readObjects(fixture.sessionRoot);
    const page = objects.find((entry) => entry.value.kind === 'page' && entry.value.items.some((item: any) => item.speaker));
    await writeFile(join(fixture.sessionRoot, '.read-model', page!.name), '{"kind":"page","items":[],"sources":[]}\n');
    await expect(readPlaySessionSelectedDetail(fixture.root, fixture.session.id))
      .rejects.toMatchObject({ code: 'PLAY_READ_MODEL_INVALID' });
    expect((await readPlaySessionFiles(fixture.root, fixture.session.id)).transcript).toEqual(fixture.session.transcript);
  });

  it('rejects source drift even if mtime is restored, and rejects changed head metadata', async () => {
    const fixture = await setup(4);
    const statePath = join(fixture.sessionRoot, 'play-local-state.yaml');
    const information = await stat(statePath);
    await writeFile(statePath, 'step: 999\n');
    await utimes(statePath, information.atime, information.mtime);
    await expect(listPlaySessionSummaries(fixture.root)).rejects.toThrow();

    const other = await setup(2);
    const metadataPath = join(other.sessionRoot, 'session.yaml');
    const metadata = parse(await readFile(metadataPath, 'utf8'));
    metadata.title = 'Unvalidated edited title';
    await writeFile(metadataPath, stringify(metadata));
    await expect(listPlaySessionSummaries(other.root)).rejects.toMatchObject({ code: 'PLAY_READ_MODEL_INVALID' });
  });

  it('fails closed when a derived event page tries to change hidden visibility', async () => {
    const fixture = await setup(4);
    const objects = await readObjects(fixture.sessionRoot);
    const page = objects.find((entry) => entry.value.kind === 'page'
      && entry.value.items.some((item: any) => item.event?.visibility === 'playerUnknown'))!;
    page.value.items.find((item: any) => item.event?.visibility === 'playerUnknown').event.visibility = 'playerVisible';
    await writeFile(join(fixture.sessionRoot, '.read-model', page.name), JSON.stringify(page.value));
    await expect(readPlaySessionSelectedDetail(fixture.root, fixture.session.id))
      .rejects.toMatchObject({ code: 'PLAY_READ_MODEL_INVALID' });
  });

  it.each([false, true])('rebinds a copied workspace without changing its stable anchor (index deleted: %s)', async (removeIndex) => {
    const fixture = await setup(8, 3);
    const copyRoot = await mkdtemp(join(tmpdir(), 'oan-play-index-copy-'));
    roots.push(copyRoot);
    await cp(join(fixture.root, '.workspace'), join(copyRoot, '.workspace'), { recursive: true });
    const copiedSession = join(copyRoot, '.workspace/play-sessions', fixture.session.id);
    const metadata = await readFile(join(copiedSession, 'session.yaml'), 'utf8');
    if (removeIndex) await rm(join(copiedSession, '.read-model'), { recursive: true });
    expect(await readPlaySessionSelectedDetail(copyRoot, fixture.session.id, { limit: 4 }))
      .toEqual(projectPlaySessionSelectedDetail(fixture.session, { limit: 4 }));
    expect(await readFile(join(copiedSession, 'session.yaml'), 'utf8')).toBe(metadata);
    // Rebinding is a one-time full validation, not a full graph read on every
    // ordinary request. An unrelated sibling remains outside the next window.
    const sibling = fixture.session.turnArtifacts.find((artifact) => !fixture.session.selectedTurnIds.includes(artifact.id))!;
    await writeFile(join(copiedSession, 'turns', `${sibling.id}.yaml`), 'invalid: sibling\n');
    expect(await readPlaySessionSelectedDetail(copyRoot, fixture.session.id, { limit: 4 }))
      .toEqual(projectPlaySessionSelectedDetail(fixture.session, { limit: 4 }));
    await expect(readPlaySessionFiles(copyRoot, fixture.session.id)).rejects.toThrow();
  });

  it('revalidates a content-identical touch once without rewriting the anchored metadata', async () => {
    const fixture = await setup(8, 3);
    const path = join(fixture.sessionRoot, 'play-local-state.yaml');
    const metadata = await readFile(join(fixture.sessionRoot, 'session.yaml'), 'utf8');
    const timestamp = new Date(Date.now() + 10_000);
    await utimes(path, timestamp, timestamp);
    expect(await readPlaySessionSelectedDetail(fixture.root, fixture.session.id, { limit: 4 }))
      .toEqual(projectPlaySessionSelectedDetail(fixture.session, { limit: 4 }));
    expect(await readFile(join(fixture.sessionRoot, 'session.yaml'), 'utf8')).toBe(metadata);
    const sibling = fixture.session.turnArtifacts.find((artifact) => !fixture.session.selectedTurnIds.includes(artifact.id))!;
    await writeFile(join(fixture.sessionRoot, 'turns', `${sibling.id}.yaml`), 'invalid: sibling\n');
    expect(await listPlaySessionSummaries(fixture.root)).toHaveLength(1);
  });

  it('rejects rebinding if a structurally valid unselected artifact changed content', async () => {
    const fixture = await setup(8, 3);
    const sibling = fixture.session.turnArtifacts.find((artifact) => !fixture.session.selectedTurnIds.includes(artifact.id))!;
    const path = join(fixture.sessionRoot, 'turns', `${sibling.id}.yaml`);
    const artifact = parse(await readFile(path, 'utf8'));
    artifact.messages.at(-1).content = 'A different, structurally valid sibling narrative.';
    await writeFile(path, stringify(artifact));
    await expect(readPlaySessionFiles(fixture.root, fixture.session.id)).resolves.toMatchObject({ id: fixture.session.id });
    // Deleting the derived layer requires a full source/root comparison; it
    // cannot quietly adopt even a domain-valid change to unrelated history.
    await rm(join(fixture.sessionRoot, '.read-model'), { recursive: true });
    await expect(readPlaySessionSelectedDetail(fixture.root, fixture.session.id))
      .rejects.toMatchObject({ code: 'PLAY_READ_MODEL_INVALID' });
  });

  it('reads no unrelated sibling artifact, while the full graph reader still rejects its corruption', async () => {
    const fixture = await setup(8, 24);
    const sibling = fixture.session.turnArtifacts.find((artifact) => !fixture.session.selectedTurnIds.includes(artifact.id))!;
    await writeFile(join(fixture.sessionRoot, 'turns', `${sibling.id}.yaml`), 'invalid: sibling\n');
    expect(await readPlaySessionSelectedDetail(fixture.root, fixture.session.id, { limit: 4 }))
      .toEqual(projectPlaySessionSelectedDetail(fixture.session, { limit: 4 }));
    expect(await listPlaySessionSummaries(fixture.root)).toHaveLength(1);
    await expect(readPlaySessionFiles(fixture.root, fixture.session.id)).rejects.toThrow();
    await expect(writePlaySessionFiles(fixture.root, append(fixture.session, 9), { expectedCurrentSession: fixture.session }))
      .rejects.toThrow();
  });

  it('rejects a changed selected-window source and cannot rebuild stale facts over its anchor', async () => {
    const fixture = await setup(38);
    const path = join(fixture.sessionRoot, 'turns', `${fixture.session.selectedTurnIds[25]}.yaml`);
    await writeFile(path, (await readFile(path, 'utf8')).replace('Scene 26', 'Edited 26'));
    await expect(readPlaySessionSelectedDetail(fixture.root, fixture.session.id, { limit: 30 }))
      .rejects.toMatchObject({ code: 'PLAY_READ_MODEL_INVALID' });
    await rm(join(fixture.sessionRoot, '.read-model'), { recursive: true });
    await expect(readPlaySessionSelectedDetail(fixture.root, fixture.session.id, { limit: 30 })).rejects.toThrow();
  });

  it('preserves private old snapshots and stale-cursor/CAS protection when reusing turn files', async () => {
    const fixture = await setup(8);
    const before = await readPlaySessionFiles(fixture.root, fixture.session.id);
    const cursor = (await readPlaySessionSelectedDetail(fixture.root, before.id, { limit: 3 })).transcript.nextCursor;
    const next = append(before, 9);
    let backup: string | undefined;
    await writePlaySessionFiles(fixture.root, next, {
      expectedCurrentSession: before,
      faultInjector: async (point) => {
        if (point !== 'after-session-swap') return;
        const sessionsRoot = join(fixture.root, '.workspace/play-sessions');
        backup = (await readdir(sessionsRoot)).find((name) => name.includes('.backup.'));
        const turnPath = `turns/${before.selectedTurnIds[0]}.yaml`;
        const oldPath = join(sessionsRoot, backup!, turnPath);
        const newPath = join(fixture.sessionRoot, turnPath);
        expect((await stat(oldPath)).ino).not.toBe((await stat(newPath)).ino);
        expect((await stat(newPath)).nlink).toBe(1);
        const oldBytes = await readFile(oldPath, 'utf8');
        await writeFile(oldPath, 'Changed only in the prior snapshot\n');
        expect(await readFile(newPath, 'utf8')).toBe(oldBytes);
        const oldTranscript = join(sessionsRoot, backup!, 'transcript.md');
        const newTranscript = join(fixture.sessionRoot, 'transcript.md');
        const oldTranscriptBytes = await readFile(oldTranscript, 'utf8');
        const newTranscriptBytes = await readFile(newTranscript, 'utf8');
        expect(newTranscriptBytes.startsWith(oldTranscriptBytes)).toBe(true);
        expect(newTranscriptBytes).toContain('Scene 9.');
        expect((await stat(oldTranscript)).ino).not.toBe((await stat(newTranscript)).ino);
        expect((await stat(newTranscript)).nlink).toBe(1);
        await writeFile(oldTranscript, 'Changed only in the prior transcript\n');
        expect(await readFile(newTranscript, 'utf8')).toBe(newTranscriptBytes);
      },
    });
    expect(backup).toBeDefined();
    await expect(readPlaySessionSelectedDetail(fixture.root, before.id, { limit: 3, transcriptCursor: cursor }))
      .rejects.toThrow('stale');
    await expect(writePlaySessionFiles(fixture.root, next, { expectedCurrentSession: before }))
      .rejects.toMatchObject({ name: 'PlaySessionWriteConflictError' });
    expect(await readPlaySessionSelectedDetail(fixture.root, before.id)).toEqual(projectPlaySessionSelectedDetail(next));
  });

  it.each(['missing', 'corrupt'] as const)('rebuilds a %s derived transcript from the validated graph on save', async (kind) => {
    const fixture = await setup(3);
    const before = await readPlaySessionFiles(fixture.root, fixture.session.id);
    const next = append(before, 4);
    const expectedRoot = await mkdtemp(join(tmpdir(), 'oan-play-transcript-'));
    roots.push(expectedRoot);
    await writePlaySessionFiles(expectedRoot, next, { expectedAbsent: true });
    const transcript = join(fixture.sessionRoot, 'transcript.md');
    if (kind === 'missing') await rm(transcript);
    else await writeFile(transcript, 'Untrusted derived narrative\n');
    await writePlaySessionFiles(fixture.root, next, { expectedCurrentSession: before });
    expect(await readFile(transcript, 'utf8')).toBe(await readFile(
      join(expectedRoot, '.workspace/play-sessions', next.id, 'transcript.md'), 'utf8',
    ));
    expect(await readPlaySessionFiles(fixture.root, next.id)).toEqual(next);
  });

  it('regenerates a non-prefix transcript after Restore and preserves multibyte text when extending it', async () => {
    const fixture = await setup(4);
    const before = await readPlaySessionFiles(fixture.root, fixture.session.id);
    const restored = restorePlaySessionCheckpoint(before, before.selectedTurnIds[1]!);
    await writePlaySessionFiles(fixture.root, restored, { expectedCurrentSession: before });
    const transcript = join(fixture.sessionRoot, 'transcript.md');
    expect(await readFile(transcript, 'utf8')).not.toContain('Scene 3.');
    const next = settlePlayWorldRefereeResponse({ session: restored, actionKind: 'do',
      userText: '她点亮灯笼。🌙', refereeResponse: response(5) });
    await writePlaySessionFiles(fixture.root, next, { expectedCurrentSession: restored });
    const first = await readFile(transcript, 'utf8');
    const last = append(next, 6);
    await writePlaySessionFiles(fixture.root, last, { expectedCurrentSession: next });
    const final = await readFile(transcript, 'utf8');
    expect(final.startsWith(first)).toBe(true);
    expect(final).toContain('她点亮灯笼。🌙');
    expect(final).not.toContain('Scene 3.');
    expect(await readPlaySessionSelectedDetail(fixture.root, last.id)).toEqual(projectPlaySessionSelectedDetail(last));
  });

  it('validates every candidate sibling before optimizing its projection or staging any transcript', async () => {
    const fixture = await setup(4, 2);
    const before = await readPlaySessionFiles(fixture.root, fixture.session.id);
    const next = structuredClone(append(before, 5));
    const sibling = next.turnArtifacts.find((artifact) => !next.selectedTurnIds.includes(artifact.id))!;
    sibling.parentTurnId = 'missing-parent';
    const transcript = await readFile(join(fixture.sessionRoot, 'transcript.md'), 'utf8');
    await expect(writePlaySessionFiles(fixture.root, next, { expectedCurrentSession: before })).rejects.toThrow();
    expect(await readFile(join(fixture.sessionRoot, 'transcript.md'), 'utf8')).toBe(transcript);
    expect(await readPlaySessionFiles(fixture.root, before.id)).toEqual(before);
  });

  it('keeps an unindexed session readable without silently upgrading its metadata', async () => {
    const fixture = await setup(3);
    const metadataPath = join(fixture.sessionRoot, 'session.yaml');
    const metadata = parse(await readFile(metadataPath, 'utf8'));
    delete metadata.storageReadModel;
    const bytes = stringify(metadata);
    await writeFile(metadataPath, bytes);
    await rm(join(fixture.sessionRoot, '.read-model'), { recursive: true });
    expect(await readPlaySessionSelectedDetail(fixture.root, fixture.session.id)).toEqual(projectPlaySessionSelectedDetail(fixture.session));
    expect(await readFile(metadataPath, 'utf8')).toBe(bytes);
    await expect(readFile(join(fixture.sessionRoot, '.read-model'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function response(step: number): string {
  return [`Scene ${step}.`, '```oan-play-settlement', JSON.stringify({
    events: [{ kind: 'environmentChanged', origin: 'environment', title: `Event ${step}`, summary: `Consequence ${step}`,
      visibility: step % 2 ? 'playerVisible' : 'playerUnknown', cause: { reason: `Reason ${step}` } }],
    stateDelta: { step }, observations: [], suggestedActions: ['Continue.'],
  }), '```'].join('\n');
}
function append(session: PlaySession, step: number): PlaySession {
  return settlePlayWorldRefereeResponse({ session, actionKind: 'do', userText: `Action ${step}`,
    refereeResponse: response(step), createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, step)).toISOString() });
}
async function setup(turns: number, siblings = 0) {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-index-'));
  roots.push(root);
  let session = createPlaySessionDraft({ id: 'indexed', title: 'Indexed', sceneStart: 'Start', characters: [] });
  for (let step = 1; step <= turns; step += 1) session = append(session, step);
  const sourceArtifactId = session.selectedTurnIds.at(-1)!;
  for (let index = 0; index < siblings; index += 1) {
    session = settlePlayWorldSettlementRetry({ session, sourceArtifactId, expectedSessionRevision: session.revision,
      refereeResponse: response(turns), createdAt: new Date(Date.UTC(2026, 9, 2, 0, 0, index)).toISOString() }).session;
  }
  await writePlaySessionFiles(root, session, { expectedAbsent: true });
  return { root, session, sessionRoot: join(root, '.workspace/play-sessions', session.id) };
}
async function readObjects(root: string) {
  return Promise.all((await readdir(join(root, '.read-model'))).map(async (name) => ({
    name, value: JSON.parse(await readFile(join(root, '.read-model', name), 'utf8')),
  })));
}
