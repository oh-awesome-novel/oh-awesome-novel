import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createPendingActionStore } from '@oh-awesome-novel/tools';

const openFault = vi.hoisted(() => ({ path: '', mode: '', hits: 0 }));
const renameFault = vi.hoisted(() => ({ source: '', mode: '', hits: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: async (...args: Parameters<typeof original.open>) => {
    if (String(args[0]) === openFault.path && args[1] === 'wx') {
      if (openFault.mode === 'open-permanent' || openFault.hits === 0) {
        openFault.hits++;
        const fail = () => { throw Object.assign(new Error('Injected Windows open denial'), { code: 'EPERM' }); };
        if (openFault.mode === 'write-failure') {
          const handle = await original.open(...args);
          handle.writeFile = async () => fail();
          return handle;
        }
        return fail();
      }
    }
    return original.open(...args);
  }, rename: async (...args: Parameters<typeof original.rename>) => {
    if (renameFault.mode.startsWith('publish-') && String(args[0]).startsWith(`${renameFault.source}.candidate-`)
      && (renameFault.mode === 'publish-permanent' || renameFault.hits === 0)) {
      renameFault.hits++;
      throw Object.assign(new Error('Injected Windows publication race'), { code: 'EPERM' });
    }
    if (String(args[0]) === renameFault.source && renameFault.hits === 0) {
      renameFault.hits++;
      if (renameFault.mode === 'collision') await original.rename(...args);
      if (renameFault.mode === 'wrong-owner') {
        await original.mkdir(args[1], { recursive: true });
        await original.writeFile(join(String(args[1]), 'owner.json'), JSON.stringify({ token: 'different', pid: process.pid }));
      }
      throw Object.assign(new Error('Injected Windows rename denial'), { code: 'EPERM' });
    }
    return original.rename(...args);
  } };
});

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  Object.assign(renameFault, { source: '', mode: '', hits: 0 });
  Object.assign(openFault, { path: '', mode: '', hits: 0 });
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('PendingAction cross-process lock ownership', () => {
  it.each(['holder', 'other'])('keeps an expired live lock exclusive for action %s', async (actionId) => {
    const { root, child, applyLock } = await holdingProcess();
    const actionLock = join(root, '.workspace/change-engine/v1/locks/actions/holder.lock');
    const original = await readFile(applyLock, 'utf8');
    await expire(applyLock);
    await expire(actionLock);
    const contender = await createPendingActionStore({ workspaceRoot: root, lockMaxAttempts: 3 });
    let entered = false;
    await expect(contender.withMaterializationLocks(actionId, async () => { entered = true; }))
      .rejects.toThrow(/lock is busy/u);
    expect(entered).toBe(false);
    expect(await readFile(applyLock, 'utf8')).toBe(original);
    await finish(child, 'release');
    await contender.withMaterializationLocks(actionId, async () => { entered = true; });
    expect(entered).toBe(true);
  });

  it('serializes concurrent recoverers after the actual owner exits', async () => {
    const { root, child, applyLock } = await holdingProcess();
    await finish(child, 'crash');
    await expire(applyLock);
    await assertExclusiveContenders(root);
  });

  it('does not steal an expired breaker whose owner is alive', async () => {
    const { root, child, applyLock } = await holdingProcess();
    await finish(child, 'crash');
    await expire(applyLock);
    const breaker = `${applyLock}.break`;
    await mkdir(breaker);
    const owner = JSON.stringify({ token: randomUUID(), pid: process.pid });
    await writeFile(join(breaker, 'owner.json'), owner);
    await expire(breaker);
    const store = await createPendingActionStore({ workspaceRoot: root, lockMaxAttempts: 3 });
    await expect(store.withMaterializationLocks('contender', async () => undefined))
      .rejects.toThrow(/lock is busy/u);
    expect(await readFile(join(breaker, 'owner.json'), 'utf8')).toBe(owner);
  });

  it.each(['open-once', 'open-permanent', 'write-failure'])('retries Windows open contention only before a handle is acquired: %s', async (mode) => {
    const { root, child, applyLock } = await holdingProcess();
    await finish(child, 'release');
    const store = await createPendingActionStore({ workspaceRoot: root, lockMaxAttempts: 5 });
    Object.assign(openFault, { path: applyLock, mode, hits: 0 });
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
    let entered = 0;
    const attempt = store.withMaterializationLocks('contender', async () => { entered++; });
    if (mode === 'open-once') {
      await expect(attempt).resolves.toBeUndefined();
      expect(entered).toBe(1);
      expect(openFault.hits).toBe(1);
    } else {
      if (mode === 'open-permanent') await expect(attempt).rejects.toThrow(/lock is busy/u);
      else await expect(attempt).rejects.toMatchObject({ code: 'EPERM' });
      expect(entered).toBe(0);
      expect(openFault.hits).toBe(mode === 'open-permanent' ? 5 : 1);
    }
  });

  it.each(['publish-once', 'publish-permanent'])('bounds retry when a Windows breaker publication target disappears: %s', async (mode) => {
    const { root, child, applyLock } = await holdingProcess();
    await finish(child, 'crash');
    await expire(applyLock);
    const original = await readFile(applyLock, 'utf8');
    const store = await createPendingActionStore({ workspaceRoot: root, lockMaxAttempts: 5 });
    Object.assign(renameFault, { source: `${applyLock}.break`, mode, hits: 0 });
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
    let entered = 0;
    const attempt = store.withMaterializationLocks('contender', async () => { entered++; });
    if (mode === 'publish-once') {
      await expect(attempt).resolves.toBeUndefined();
      expect(entered).toBe(1);
      expect(renameFault.hits).toBe(1);
    } else {
      await expect(attempt).rejects.toThrow(/lock is busy/u);
      expect(entered).toBe(0);
      expect(renameFault.hits).toBe(5);
      expect(await readFile(applyLock, 'utf8')).toBe(original);
    }
  });

  it.each(['collision', 'denied', 'wrong-owner'])('handles Windows rename denial only with a matching fence: %s', async (mode) => {
    const { root, child, applyLock } = await holdingProcess();
    const pid = child.pid!;
    await finish(child, 'crash');
    await expire(applyLock);
    const breaker = `${applyLock}.break`;
    await mkdir(breaker);
    await writeFile(join(breaker, 'owner.json'), JSON.stringify({ token: randomUUID(), pid }));
    await expire(breaker);
    Object.assign(renameFault, { source: breaker, mode, hits: 0 });
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
    const store = await createPendingActionStore({ workspaceRoot: root, lockMaxAttempts: 5 });
    let entered = false;
    const attempt = store.withMaterializationLocks('contender', async () => { entered = true; });
    if (mode === 'collision') await expect(attempt).resolves.toBeUndefined();
    else await expect(attempt).rejects.toMatchObject({ code: 'EPERM' });
    expect(entered).toBe(mode === 'collision');
    expect(renameFault.hits).toBeGreaterThan(0);
  });

  it('recovers a crashed breaker concurrently and retains a fence against delayed recoverers', async () => {
    const { root, child, applyLock } = await holdingProcess();
    const pid = child.pid!;
    await finish(child, 'crash');
    await expire(applyLock);
    const breaker = `${applyLock}.break`;
    const token = randomUUID();
    const owner = JSON.stringify({ token, pid });
    await mkdir(breaker);
    await writeFile(join(breaker, 'owner.json'), owner);
    await expire(breaker);
    await assertExclusiveContenders(root);
    expect(await readFile(join(`${breaker}.stale-${token}`, 'owner.json'), 'utf8')).toBe(owner);
  });
});

async function holdingProcess() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'oan-pending-locks-')));
  roots.push(root);
  const child = fork(new URL('./fixtures/pending-action-lock-holder.mjs', import.meta.url), [root], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  let errors = '';
  child.stderr?.on('data', (data) => { errors += String(data); });
  await new Promise<void>((resolve, reject) => {
    const onExit = () => reject(new Error(`Lock holder exited before acquiring: ${errors}`));
    child.once('error', reject);
    child.once('exit', onExit);
    child.once('message', (message) => {
      child.off('error', reject);
      child.off('exit', onExit);
      if (message === 'locked') resolve();
      else reject(new Error('Unexpected lock holder message.'));
    });
  });
  return { root, child, applyLock: join(root, '.workspace/change-engine/v1/locks/apply.lock') };
}

async function finish(child: ChildProcess, message: 'crash' | 'release') {
  const exited = once(child, 'exit');
  child.send(message);
  const [code] = await exited;
  expect(code).toBe(0);
}

async function expire(path: string) {
  const expired = new Date(Date.now() - 120_000);
  await utimes(path, expired, expired);
}

async function assertExclusiveContenders(root: string) {
  const stores = await Promise.all(Array.from({ length: 8 }, () => createPendingActionStore({ workspaceRoot: root })));
  let active = 0;
  let maximum = 0;
  let completed = 0;
  const outcomes = await Promise.allSettled(stores.map((store, index) => store.withMaterializationLocks(`contender-${index}`, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(15);
    active -= 1;
    completed += 1;
  })));
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }
  expect(maximum).toBe(1);
  expect(completed).toBe(8);
}
