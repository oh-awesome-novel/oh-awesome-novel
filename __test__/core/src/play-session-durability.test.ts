import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vite-plus/test';
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
      .filter((name) => name.includes('.backup.') || name.includes('.stage.'))).toEqual([]);

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

  it('keeps recovery copies when a published or ready snapshot fails validation', async () => {
    const fixture = await createFixture();
    await writePlaySessionFiles(fixture.root, fixture.before);
    const parent = join(fixture.root, '.workspace/play-sessions');
    const target = join(parent, fixture.before.id);
    const backup = join(parent, `.${fixture.before.id}.backup.retained`);
    const stage = join(parent, `.${fixture.before.id}.stage.corrupt`);
    await cp(target, stage, { recursive: true });
    await writeFile(join(stage, 'session.yaml'), 'schemaVersion: 999\n');
    await writeFile(join(stage, '.ready'), '2\n');
    await rename(target, backup);
    await expect(readPlaySessionFiles(fixture.root, fixture.before.id)).rejects.toThrow('Unsupported Play session schemaVersion');
    // Retrying recovery must not discard the sole complete backup either.
    await expect(readPlaySessionFiles(fixture.root, fixture.before.id)).rejects.toThrow('Unsupported Play session schemaVersion');
    expect(await readFile(join(backup, 'session.yaml'), 'utf8')).toContain('schemaVersion: 4');
    expect(await readFile(join(target, '.ready'), 'utf8')).toBe('2\n');
  });

  it('waits for a live cross-process writer before cleaning its ready stage', async () => {
    const fixture = await createFixture();
    await writePlaySessionFiles(fixture.root, fixture.before);
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { readFile } from 'node:fs/promises';
      import { readPlaySessionFiles, writePlaySessionFiles } from '@oh-awesome-novel/core';
      const [root, payload] = process.argv.slice(1);
      const next = JSON.parse(await readFile(payload, 'utf8'));
      const before = await readPlaySessionFiles(root, next.id);
      await writePlaySessionFiles(root, next, {
        expectedCurrentSession: before,
        faultInjector: async point => {
          if (point !== 'after-ready') return;
          process.stdout.write('ready');
          await new Promise(resolve => process.stdin.once('data', resolve));
          process.stdin.pause();
        },
      });
    `, fixture.root, fixture.payload], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exit = once(child, 'exit');
    try {
      await once(child.stdout, 'data');
      let completed = false;
      const read = readPlaySessionFiles(fixture.root, fixture.before.id).then(value => { completed = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(completed).toBe(false);
      expect((await readdir(join(fixture.root, '.workspace/play-sessions'))).some(name => name.includes('.stage.'))).toBe(true);
      child.stdin.write('continue\n');
      expect(await read).toEqual(fixture.next);
      expect((await exit)[0]).toBe(0);
    } finally {
      if (child.exitCode === null) { child.kill('SIGKILL'); await exit; }
    }
  });

  it('retains stale-owner tombstones so delayed contenders cannot steal replacement locks', async () => {
    const fixture = await createFixture();
    await writePlaySessionFiles(fixture.root, fixture.before);
    await killAt(fixture.root, fixture.payload, 'after-ready', 'update');
    await readPlaySessionFiles(fixture.root, fixture.before.id);
    const locks = join(fixture.root, '.workspace/play-sessions/.write-locks');
    const tombstones = (await readdir(locks)).filter(name => name.includes('.stale.'));
    expect(tombstones).toHaveLength(1);
    await readPlaySessionFiles(fixture.root, fixture.before.id);
    expect((await readdir(locks)).filter(name => name.includes('.stale.'))).toEqual(tombstones);
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
  const result = await execFileAsync(process.execPath, [
    '--input-type=module', '-e', killedWriter, root, payload, point, mode,
  ], { timeout: 10_000 }).then(
    () => { throw new Error('writer exited without the crash boundary'); },
    (error: NodeJS.ErrnoException) => error,
  );
  // Windows TerminateProcess reports a status code. POSIX reports SIGKILL.
  if (process.platform === 'win32') expect(result.signal ?? result.code).not.toBe(0);
  else expect(result).toMatchObject({ signal: 'SIGKILL' });
}
