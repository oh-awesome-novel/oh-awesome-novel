import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createEmptyForgeBrief } from '@oh-awesome-novel/core';
import { createForgeHandlers } from '@oh-awesome-novel/backend';

const fault = vi.hoisted(() => ({
  recoveryPath: '', lockPath: '',
  beforeRename: undefined as (() => Promise<void>) | undefined,
  beforeUnlink: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    rename: async (...args: Parameters<typeof original.rename>) => {
      if (String(args[0]) === fault.recoveryPath && fault.beforeRename) {
        const pause = fault.beforeRename; fault.beforeRename = undefined;
        await pause();
      }
      return original.rename(...args);
    },
    unlink: async (...args: Parameters<typeof original.unlink>) => {
      if (String(args[0]) === fault.lockPath && fault.beforeUnlink) {
        const pause = fault.beforeUnlink; fault.beforeUnlink = undefined;
        await pause();
      }
      return original.unlink(...args);
    },
  };
});

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  Object.assign(fault, { recoveryPath: '', lockPath: '', beforeRename: undefined, beforeUnlink: undefined });
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-forge-lock-')); roots.push(root);
  const id = `forge_${randomUUID()}`;
  const directory = join(root, '.workspace/forge/drafts');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}.yaml`), JSON.stringify({
    schemaVersion: 1, id, revision: 0, idea: '渡口', stage: 'discuss',
    brief: createEmptyForgeBrief(), questions: [], reply: '从渡口开始。',
  }));
  const handlers = createForgeHandlers({
    getWorkspaceRoot: () => root,
    getStore: async () => { throw new Error('Unexpected approval store access.'); },
    getModelRuntime: async () => { throw new Error('Unexpected provider access.'); },
  });
  const app = new Hono();
  app.post('/edit', context => handlers.operation(context, id, 'edit'));
  app.delete('/draft', context => handlers.delete(context, id));
  const edit = (value: string, revision = 0) => app.request('/edit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedWorkspaceRoot: root, expectedRevision: revision, edits: [{ key: 'stage', value, locked: true }] }),
  });
  const lock = join(directory, `${id}.lock`);
  return { root, id, app, edit, lock, recovery: `${lock}.recovery`, readDraft: async () => JSON.parse(await readFile(join(directory, `${id}.yaml`), 'utf8')) };
}

async function hold(root: string, id: string) {
  const child = fork(new URL('./fixtures/forge-lock-holder.mjs', import.meta.url), [root, id], {
    execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  children.push(child);
  expect((await once(child, 'message'))[0]).toBe('locked');
  return child;
}

async function finish(child: ChildProcess, command: 'release' | 'crash') {
  const exited = once(child, 'exit'); child.send(command);
  expect((await exited)[0]).toBe(0);
}

describe('Forge cross-process draft locks', () => {
  it('keeps an expired lock owned by another live process exclusive for editing and deletion', async () => {
    const h = await fixture();
    const child = await hold(h.root, h.id);
    const original = await readFile(h.lock, 'utf8');
    const old = new Date(Date.now() - 4 * 60 * 1000);
    await utimes(h.lock, old, old);
    expect((await h.edit('不应覆盖')).status).toBe(409);
    expect((await h.app.request('/draft', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedWorkspaceRoot: h.root, expectedRevision: 0 }) })).status).toBe(409);
    expect(await readFile(h.lock, 'utf8')).toBe(original);
    await finish(child, 'release');
    expect((await h.edit('作者后续编辑', 1)).status).toBe(200);
    expect((await h.readDraft()).brief.items[0].value).toBe('作者后续编辑');
  });

  it('recovers only after the actual owner exits and admits one of two concurrent edits', async () => {
    const h = await fixture();
    const child = await hold(h.root, h.id);
    await finish(child, 'crash');
    const results = await Promise.all([h.edit('甲'), h.edit('乙')]);
    expect(results.map(result => result.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const draft = await h.readDraft();
    expect(draft.revision).toBe(1);
    expect(draft.brief.items[0].value).toBe(results[0]!.status === 200 ? '甲' : '乙');
  });

  it('does not treat a failed permission probe as proof that the owner exited', async () => {
    const h = await fixture();
    const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
    await writeFile(h.lock, owner);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('Denied'), { code: 'EPERM' }); });
    expect((await h.edit('不应覆盖')).status).toBe(409);
    expect(await readFile(h.lock, 'utf8')).toBe(owner);
    expect((await h.readDraft()).revision).toBe(0);
  });

  it('fences a delayed dead-owner recoverer while a replacement recovery lock is live', async () => {
    const h = await fixture();
    const child = await hold(h.root, h.id);
    const pid = child.pid!;
    await finish(child, 'crash');
    const token = randomUUID();
    await mkdir(h.recovery);
    await writeFile(join(h.recovery, 'owner.json'), JSON.stringify({ pid, token }));
    const observedDead = deferred(); const resumeLate = deferred();
    const replacementHeld = deferred(); const releaseReplacement = deferred();
    Object.assign(fault, {
      recoveryPath: h.recovery, lockPath: h.lock,
      beforeRename: async () => { observedDead.resolve(); await resumeLate.promise; },
      beforeUnlink: async () => { replacementHeld.resolve(); await releaseReplacement.promise; },
    });
    const late = h.edit('迟到的编辑');
    let replacement: Promise<Response> | undefined;
    try {
      await observedDead.promise;
      replacement = h.edit('胜出的编辑');
      await replacementHeld.promise;
      const liveOwner = await readFile(join(h.recovery, 'owner.json'), 'utf8');
      resumeLate.resolve();
      expect((await late).status).toBe(409);
      expect(await readFile(join(h.recovery, 'owner.json'), 'utf8')).toBe(liveOwner);
      expect(JSON.parse(await readFile(join(`${h.recovery}.stale-${token}`, 'owner.json'), 'utf8'))).toEqual({ pid, token });
    } finally {
      resumeLate.resolve(); releaseReplacement.resolve();
      await Promise.all([late, replacement]);
    }
    expect((await replacement!).status).toBe(200);
    expect((await h.readDraft()).brief.items[0].value).toBe('胜出的编辑');
  });
});
