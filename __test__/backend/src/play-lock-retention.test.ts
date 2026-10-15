import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createPlaySessionDraft, initWorkspace, readPlaySessionFiles, writePlaySessionFiles } from '@oh-awesome-novel/core';

const execFileAsync = promisify(execFile);
const delayedContender = `
  import fs from 'node:fs';
  import { once } from 'node:events';
  import { syncBuiltinESMExports } from 'node:module';
  const originalRename = fs.promises.rename;
  fs.promises.rename = async (from, to) => {
    if (!String(to).endsWith('.stale.dead-owner')) return originalRename(from, to);
    process.send('observed-old-lock');
    await once(process, 'message');
    try {
      await originalRename(from, to);
      process.send('stolen');
    } catch (error) {
      process.send({ blocked: error.code });
    }
    throw new Error('Contender checkpoint completed.');
  };
  syncBuiltinESMExports();
  const { readPlaySessionFiles } = await import('@oh-awesome-novel/core');
  try { await readPlaySessionFiles(process.argv[1], 'lock-session'); }
  catch (error) { if (error.message !== 'Contender checkpoint completed.') throw error; }
  process.disconnect();
`;

describe('workspace entry preserves Play lock tombstones', () => {
  it('opening a workspace cannot let a delayed contender steal a replacement writer lock', async () => {
    const base = await mkdtemp(join(tmpdir(), 'oan-lock-retention-'));
    const root = join(base, 'workspace');
    await mkdir(root);
    await initWorkspace(root);
    const session = createPlaySessionDraft({ id: 'lock-session', title: 'Lock test', sceneStart: 'A room.', characters: [] });
    await writePlaySessionFiles(root, session);
    const lock = join(root, '.workspace/play-sessions/.write-locks/lock-session.lock');
    const tombstone = `${lock}.stale.dead-owner`;
    await mkdir(lock);
    const deadOwner = JSON.stringify({ token: 'dead-owner', pid: 999_999_999, createdAt: new Date().toISOString() });
    await writeFile(join(lock, 'owner.json'), deadOwner);
    const child = spawn(process.execPath, ['--input-type=module', '-e', delayedContender, root], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const exited = once(child, 'exit');
    let releaseWriter: (() => void) | undefined;
    let writer: Promise<unknown> | undefined;
    try {
      expect((await once(child, 'message'))[0]).toBe('observed-old-lock');
      // A second contender reclaims the dead owner while the first is paused.
      await readPlaySessionFiles(root, session.id);
      const old = new Date(Date.now() - 60_000);
      await utimes(join(tombstone, 'owner.json'), old, old);
      await utimes(tombstone, old, old);

      // Natural child exit drains even fire-and-forget filesystem maintenance;
      // assertions do not depend on sleeping long enough for cleanup to finish.
      const opened = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
        import { createNovelHonoApp } from '@oh-awesome-novel/backend';
        const [root, config] = process.argv.slice(1);
        const app = createNovelHonoApp({ globalConfigDir: config });
        const response = await app.request('http://localhost/api/workspaces/open', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: root }),
        });
        console.log(response.status);
      `, root, join(base, 'global')], { timeout: 10_000 });
      expect(opened.stdout.trim()).toBe('200');

      let markLocked!: () => void;
      const locked = new Promise<void>(resolve => { markLocked = resolve; });
      const continueWriter = new Promise<void>(resolve => { releaseWriter = resolve; });
      writer = writePlaySessionFiles(root, session, {
        expectedCurrentSession: session,
        faultInjector: async point => {
          if (point !== 'after-stage-files') return;
          markLocked();
          await continueWriter;
        },
      });
      await locked;
      const liveOwner = await readFile(join(lock, 'owner.json'), 'utf8');
      const attempted = once(child, 'message');
      child.send('continue');
      expect((await attempted)[0]).toEqual({ blocked: expect.stringMatching(/^(EEXIST|ENOTEMPTY|EPERM)$/u) });
      expect(await readFile(join(lock, 'owner.json'), 'utf8')).toBe(liveOwner);
      expect(await readFile(join(tombstone, 'owner.json'), 'utf8')).toBe(deadOwner);
      expect((await exited)[0]).toBe(0);
    } finally {
      releaseWriter?.();
      await writer;
      if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
      await rm(base, { recursive: true, force: true });
    }
  }, 15_000);
});
