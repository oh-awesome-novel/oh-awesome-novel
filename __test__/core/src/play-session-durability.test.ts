import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import {
  createPlaySessionDraft,
  readPlaySessionFiles,
  readPlaySessionSelectedDetail,
  projectPlaySessionSelectedDetail,
  settlePlayWorldRefereeResponse,
  writePlaySessionFiles,
} from '@oh-awesome-novel/core';
import type { PlaySessionWriteFaultPoint } from '@oh-awesome-novel/core';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const points: PlaySessionWriteFaultPoint[] = [
  'after-stage-files',
  'after-ready',
  'after-backup-rename',
  'after-session-swap',
  'after-publish-sync',
  'after-cleanup',
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// SIGKILL bypasses writer catches/finally and leaves the real filesystem lock.
// These are process-crash tests, not a simulation of storage-device power loss.
const killedWriter = `
  import { readFile } from 'node:fs/promises';
  import { readPlaySessionFiles, writePlaySessionFiles } from '@oh-awesome-novel/core';
  const [root, payload, point, mode] = process.argv.slice(1);
  const next = JSON.parse(await readFile(payload, 'utf8'));
  const expected = mode === 'update' ? await readPlaySessionFiles(root, next.id) : undefined;
  await writePlaySessionFiles(root, next, {
    ...(expected ? { expectedCurrentSession: expected } : { expectedAbsent: true }),
    faultInjector: (actual) => { if (actual === point) process.kill(process.pid, 'SIGKILL'); },
  });
  throw new Error('Expected to reach the crash boundary');
`;

describe('Play staged snapshot durability boundaries', () => {
  it.each(points)('recovers an update killed at %s as a complete old or new revision', async (point) => {
    const fixture = await createFixture();
    await writePlaySessionFiles(fixture.root, fixture.before, { expectedAbsent: true });
    await killAt(fixture.root, fixture.payload, point, 'update');

    const stored = await readPlaySessionFiles(fixture.root, fixture.before.id);
    const committed = !['after-stage-files', 'after-ready'].includes(point);
    expect(stored).toEqual(committed ? fixture.next : fixture.before);
    expect(await readPlaySessionSelectedDetail(fixture.root, stored.id))
      .toEqual(projectPlaySessionSelectedDetail(stored));
    const sessionRoot = join(fixture.root, '.workspace/play-sessions', fixture.before.id);
    const transcript = await readFile(join(sessionRoot, 'transcript.md'), 'utf8');
    expect(transcript.includes('The lamp turns on.')).toBe(committed);
    expect((await readFile(join(sessionRoot, 'play-local-state.yaml'), 'utf8')).includes('lit: true'))
      .toBe(committed);
    await expect(readFile(join(sessionRoot, '.ready'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(join(fixture.root, '.workspace/play-sessions')))
      .filter((name) => name.includes('.backup.'))).toEqual([]);

    // The dead process's cooperative lock was reclaimed; CAS still prevents
    // overwriting a recovered revision using the pre-turn snapshot.
    if (committed) {
      await expect(writePlaySessionFiles(fixture.root, fixture.next, {
        expectedCurrentSession: fixture.before,
      })).rejects.toMatchObject({ name: 'PlaySessionWriteConflictError' });
    } else {
      await writePlaySessionFiles(fixture.root, fixture.next, { expectedCurrentSession: fixture.before });
    }
    expect(await readPlaySessionFiles(fixture.root, fixture.before.id)).toEqual(fixture.next);
    expect(await readPlaySessionSelectedDetail(fixture.root, fixture.before.id))
      .toEqual(projectPlaySessionSelectedDetail(fixture.next));
  });

  it.each(points)('recovers creation killed at %s without publishing partial files', async (point) => {
    const fixture = await createFixture();
    await killAt(fixture.root, fixture.payload, point, 'create');
    if (point === 'after-stage-files') {
      await expect(readPlaySessionFiles(fixture.root, fixture.before.id))
        .rejects.toMatchObject({ code: 'ENOENT' });
      await writePlaySessionFiles(fixture.root, fixture.next, { expectedAbsent: true });
    }
    expect(await readPlaySessionFiles(fixture.root, fixture.before.id)).toEqual(fixture.next);
    await expect(writePlaySessionFiles(fixture.root, fixture.before, { expectedAbsent: true }))
      .rejects.toMatchObject({ name: 'PlaySessionWriteConflictError' });
  });

  it('keeps the original snapshot when preparation fails before the durable ready marker', async () => {
    const fixture = await createFixture();
    await writePlaySessionFiles(fixture.root, fixture.before);
    await expect(writePlaySessionFiles(fixture.root, fixture.next, {
      expectedCurrentSession: fixture.before,
      faultInjector: (point) => {
        if (point === 'after-stage-files') throw new Error('stage failure');
      },
    })).rejects.toThrow('stage failure');
    expect(await readPlaySessionFiles(fixture.root, fixture.before.id)).toEqual(fixture.before);
    expect((await readdir(join(fixture.root, '.workspace/play-sessions')))
      .filter((name) => name.includes('.stage.') || name.includes('.backup.'))).toEqual([]);
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-play-durable-'));
  roots.push(root);
  const empty = createPlaySessionDraft({
    id: 'durable-session', title: 'Durable session', sceneStart: 'The lamp is dark.', characters: [],
  });
  // Start with an existing multibyte transcript so every update crash boundary
  // exercises the private clone plus suffix path, not just initial creation.
  const before = settlePlayWorldRefereeResponse({
    session: empty, userText: '观察房间。🌙', actionKind: 'do',
    refereeResponse: ['The lamp is still dark.', '```oan-play-settlement',
      JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] }), '```'].join('\n'),
  });
  const next = settlePlayWorldRefereeResponse({
    session: before,
    userText: 'Light the lamp.',
    actionKind: 'do',
    refereeResponse: [
      'The lamp turns on.',
      '```oan-play-settlement',
      JSON.stringify({
        events: [], stateDelta: { lit: true }, observations: [], suggestedActions: ['Look around.'],
      }),
      '```',
    ].join('\n'),
  });
  const payload = join(root, 'next-session.json');
  await writeFile(payload, JSON.stringify(next));
  return { root, before, next, payload };
}

async function killAt(root: string, payload: string, point: PlaySessionWriteFaultPoint, mode: 'create' | 'update') {
  await expect(execFileAsync(process.execPath, [
    '--input-type=module', '-e', killedWriter, root, payload, point, mode,
  ], { timeout: 10_000 })).rejects.toMatchObject({ signal: 'SIGKILL' });
}
