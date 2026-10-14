import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createPendingActionStore } from '@oh-awesome-novel/tools';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
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
  const root = await mkdtemp(join(tmpdir(), 'oan-pending-locks-'));
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
  await Promise.all(stores.map((store, index) => store.withMaterializationLocks(`contender-${index}`, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(15);
    active -= 1;
    completed += 1;
  })));
  expect(maximum).toBe(1);
  expect(completed).toBe(8);
}
