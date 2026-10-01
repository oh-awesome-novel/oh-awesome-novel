import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import {
  createCandidateChangeSet,
  createChangeMaterializer,
  createPendingActionStore,
  readRepositoryBaseline,
} from '@oh-awesome-novel/tools';
import type { ChangeMaterializerFaultPoint } from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const now = '2026-10-01T00:00:00.000Z';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('accepted file transactions and Git recovery', () => {
  it.each(['edit', 'restore', 'delete'] as const)(
    'allows unrelated approval after dirty-before-proposal and author %s',
    async (change) => {
      const fixture = await createFixture();
      await writeFile(join(fixture.root, 'state/a.yaml'), 'value: author-before-proposal\n');
      await fixture.propose('a');
      const accepted = await fixture.materializer.accept({ actionId: 'a' });
      expect(accepted.receipt.git).toEqual({ status: 'failed', errorCode: 'dirty_before_proposal' });
      await expectNoJournal(fixture.root, 'a');

      if (change === 'delete') await rm(join(fixture.root, 'state/a.yaml'));
      else await writeFile(join(fixture.root, 'state/a.yaml'), change === 'restore'
        ? 'value: baseline\n' : 'value: author-after-accept\n');
      await fixture.propose('b');
      await fixture.propose('c');
      await expect(fixture.materializer.accept({ actionId: 'b', autoCommitOnAccept: false }))
        .resolves.toMatchObject({ action: { status: 'accepted' } });
      await expect(fixture.materializer.reject({ actionId: 'c' }))
        .resolves.toMatchObject({ action: { status: 'rejected' } });
      await expect(fixture.materializer.quickCommit('a')).rejects.toMatchObject({ code: 'ACCEPTED_TARGET_DRIFT' });
      expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.head);
      if (change === 'delete') await expect(readFile(join(fixture.root, 'state/a.yaml')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      else expect(await readFile(join(fixture.root, 'state/a.yaml'), 'utf8')).toBe(change === 'restore'
        ? 'value: baseline\n' : 'value: author-after-accept\n');
    },
  );

  it.each(['hook', 'identity'] as const)(
    'keeps Reject usable after %s failure and preserves the unrelated staged gate',
    async (failure) => {
      const fixture = await createFixture();
      await fixture.propose('a');
      if (failure === 'hook') {
        const hook = join(fixture.root, '.git/hooks/pre-commit');
        await writeFile(hook, '#!/bin/sh\nexit 1\n');
        await chmod(hook, 0o755);
      } else await git(fixture.root, ['config', 'user.name', '']);
      const accepted = await fixture.materializer.accept({ actionId: 'a' });
      expect(accepted.receipt.git.status).toBe('staged-not-committed');
      await expectNoJournal(fixture.root, 'a');
      await writeFile(join(fixture.root, 'state/a.yaml'), 'value: author-after-failure\n');
      await fixture.propose('b');
      await fixture.propose('c');

      await expect(fixture.materializer.reject({ actionId: 'c' }))
        .resolves.toMatchObject({ action: { status: 'rejected' } });
      await expect(fixture.materializer.accept({ actionId: 'b', autoCommitOnAccept: false }))
        .rejects.toMatchObject({ code: 'UNRELATED_STAGED_FILES' });
      expect(await git(fixture.root, ['diff', '--cached', '--name-only'])).toBe('state/a.yaml');
      await git(fixture.root, ['restore', '--staged', '--', 'state/a.yaml']);
      await expect(fixture.materializer.accept({ actionId: 'b', autoCommitOnAccept: false }))
        .resolves.toMatchObject({ action: { status: 'accepted' } });
      await expect(fixture.materializer.quickCommit('a')).rejects.toMatchObject({ code: 'ACCEPTED_TARGET_DRIFT' });
      expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.head);
    },
  );

  it('allows new approvals after an external manual commit without attributing it to the failed action', async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.root, 'state/a.yaml'), 'value: dirty\n');
    await fixture.propose('a');
    await fixture.materializer.accept({ actionId: 'a' });
    await git(fixture.root, ['add', '--', 'state/a.yaml']);
    await git(fixture.root, ['commit', '-m', 'Author manual commit']);
    const head = await git(fixture.root, ['rev-parse', 'HEAD']);
    await fixture.propose('b');
    await expect(fixture.materializer.accept({ actionId: 'b', autoCommitOnAccept: false }))
      .resolves.toMatchObject({ action: { status: 'accepted' } });
    await expect(fixture.materializer.quickCommit('a')).rejects.toMatchObject({ code: 'STALE_REPOSITORY_BASELINE' });
    expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(head);
    expect((await fixture.store.readDecisionReceipt('a'))?.git.status).toBe('failed');
  });

  it.each(['before-git-add', 'before-receipt'] as const)(
    'finishes only Git bookkeeping after %s interruption even when the author edits',
    async (point) => {
      const fixture = await createFixture();
      await writeFile(join(fixture.root, 'state/a.yaml'), 'value: dirty\n');
      await fixture.propose('a');
      // The first case reaches Git; the second stops before persisting a dirty-baseline receipt.
      if (point === 'before-git-add') {
        await git(fixture.root, ['add', '--', 'state/a.yaml']);
        await git(fixture.root, ['commit', '-m', 'Author baseline']);
        await fixture.propose('a-clean', 'a');
      }
      const actionId = point === 'before-git-add' ? 'a-clean' : 'a';
      const interrupted = createChangeMaterializer({
        store: fixture.store,
        faultInjector: (actual) => { if (actual === point) throw new Error('receipt interruption'); },
      });
      await expect(interrupted.accept({ actionId })).rejects.toThrow('receipt interruption');
      expect(JSON.parse(await readFile(journalPath(fixture.root, actionId), 'utf8')).phase)
        .toBe('accepted-git-only');
      await writeFile(join(fixture.root, 'state/a.yaml'), 'value: author-after-crash\n');
      await fixture.propose('b');
      await expect(fixture.materializer.accept({ actionId: 'b', autoCommitOnAccept: false }))
        .resolves.toMatchObject({ action: { status: 'accepted' } });
      expect(await fixture.store.readDecisionReceipt(actionId)).toMatchObject({
        decision: 'accepted', git: { status: 'failed', errorCode: 'automatic_commit_interrupted' },
      });
      await expectNoJournal(fixture.root, actionId);
      await expect(fixture.materializer.quickCommit(actionId)).rejects.toMatchObject({ code: 'ACCEPTED_TARGET_DRIFT' });
      expect(await readFile(join(fixture.root, 'state/a.yaml'), 'utf8')).toBe('value: author-after-crash\n');
    },
  );

  it.each(['after-git-commit', 'before-receipt'] as const)(
    'reconciles committed identity after %s interruption without rechecking canonical bytes',
    async (point) => {
      const fixture = await createFixture();
      await fixture.propose('a');
      const interrupted = createChangeMaterializer({
        store: fixture.store,
        faultInjector: (actual) => { if (actual === point) throw new Error('commit receipt interruption'); },
      });
      await expect(interrupted.accept({ actionId: 'a' })).rejects.toThrow('commit receipt interruption');
      const head = await git(fixture.root, ['rev-parse', 'HEAD']);
      await rm(join(fixture.root, 'state/a.yaml'));
      await fixture.propose('b');
      await expect(fixture.materializer.reject({ actionId: 'b' }))
        .resolves.toMatchObject({ action: { status: 'rejected' } });
      expect(await fixture.store.readDecisionReceipt('a')).toMatchObject({
        git: { status: 'committed', commit: head },
      });
      await expect(fixture.materializer.quickCommit('a')).resolves.toMatchObject({ git: { status: 'committed', commit: head } });
      expect(await git(fixture.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
      await expectNoJournal(fixture.root, 'a');
      await expect(readFile(join(fixture.root, 'state/a.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('recovers a quick commit receipt interruption without committing a second time', async () => {
    const fixture = await createFixture();
    await fixture.propose('a');
    await fixture.materializer.accept({ actionId: 'a', autoCommitOnAccept: false });
    const interrupted = createChangeMaterializer({
      store: fixture.store,
      faultInjector: (point) => { if (point === 'after-git-commit') throw new Error('quick commit interruption'); },
    });
    await expect(interrupted.quickCommit('a')).rejects.toThrow('quick commit interruption');
    const head = await git(fixture.root, ['rev-parse', 'HEAD']);
    await writeFile(join(fixture.root, 'state/a.yaml'), 'value: author-after-commit\n');
    await expect(fixture.materializer.quickCommit('a')).resolves.toMatchObject({
      git: { status: 'committed', commit: head },
    });
    expect(await git(fixture.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    await expectNoJournal(fixture.root, 'a');
  });

  it('records each explicit quick commit failure and commits at most once after repair', async () => {
    const fixture = await createFixture();
    await fixture.propose('a');
    await fixture.materializer.accept({ actionId: 'a', autoCommitOnAccept: false });
    await writeFile(join(fixture.root, '.git/index.lock'), 'occupied');
    const addFailure = await fixture.materializer.quickCommit('a');
    expect(addFailure.git).toEqual({ status: 'failed', errorCode: 'git_failed' });
    expect(await fixture.store.readDecisionReceipt('a')).toEqual(addFailure);
    await expectNoJournal(fixture.root, 'a');

    await rm(join(fixture.root, '.git/index.lock'));
    await git(fixture.root, ['config', 'user.name', '']);
    const identityFailure = await fixture.materializer.quickCommit('a');
    expect(identityFailure.git).toEqual({
      status: 'staged-not-committed', branch: 'main', errorCode: 'identity_missing',
    });
    expect(await fixture.store.readDecisionReceipt('a')).toEqual(identityFailure);
    await expectNoJournal(fixture.root, 'a');
    expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.head);

    await git(fixture.root, ['config', 'user.name', 'OAN Test']);
    const receipt = await fixture.materializer.quickCommit('a');
    expect(receipt.git).toMatchObject({ status: 'committed', branch: 'main' });
    await expect(fixture.materializer.quickCommit('a')).resolves.toEqual(receipt);
    expect(await git(fixture.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    await expectNoJournal(fixture.root, 'a');
  });

  it('records an interrupted first quick commit as attempted when auto commit was disabled', async () => {
    const fixture = await createFixture();
    await fixture.propose('a');
    await fixture.materializer.accept({ actionId: 'a', autoCommitOnAccept: false });
    const interrupted = createChangeMaterializer({
      store: fixture.store,
      faultInjector: (point) => { if (point === 'before-git-add') throw new Error('quick commit interrupted'); },
    });
    await expect(interrupted.quickCommit('a')).rejects.toThrow('quick commit interrupted');
    await fixture.materializer.recover();
    expect(await fixture.store.readDecisionReceipt('a')).toMatchObject({
      git: { status: 'failed', errorCode: 'automatic_commit_interrupted' },
    });
    await expectNoJournal(fixture.root, 'a');
    expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.head);
  });

  it('still fails closed when an accepted file transaction has not finished cleanup', async () => {
    const fixture = await createFixture();
    await fixture.propose('a');
    const interrupted = createChangeMaterializer({
      store: fixture.store,
      faultInjector: (point: ChangeMaterializerFaultPoint) => {
        if (point === 'after-terminal') throw new Error('unfinished file cleanup');
      },
    });
    await expect(interrupted.accept({ actionId: 'a' })).rejects.toThrow('unfinished file cleanup');
    await writeFile(join(fixture.root, 'state/a.yaml'), 'value: author-during-incomplete-transaction\n');
    await fixture.propose('b');
    await expect(fixture.materializer.reject({ actionId: 'b' })).rejects.toMatchObject({ code: 'ACCEPTED_TARGET_DRIFT' });
    expect((await fixture.store.readRecord('b')).status).toBe('pending');
    expect(JSON.parse(await readFile(journalPath(fixture.root, 'a'), 'utf8')).phase).toBe('accepted-finalize-only');
    expect(await readFile(join(fixture.root, 'state/a.yaml'), 'utf8')).toBe('value: author-during-incomplete-transaction\n');
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-accepted-git-recovery-'));
  roots.push(root);
  await mkdir(join(root, 'state'));
  for (const name of ['a', 'b', 'c']) await writeFile(join(root, `state/${name}.yaml`), 'value: baseline\n');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'OAN Test']);
  await git(root, ['config', 'user.email', 'oan@example.test']);
  await git(root, ['add', '--', 'state']);
  await git(root, ['commit', '-m', 'baseline']);
  const head = await git(root, ['rev-parse', 'HEAD']);
  const store = await createPendingActionStore({ workspaceRoot: root });
  const materializer = createChangeMaterializer({ store });
  async function propose(id: string, file = id) {
    const path = `state/${file}.yaml`;
    const candidate = createCandidateChangeSet({
      sessionId: `session-${id}`, createdAt: now, finalizedAt: now,
      projectionFingerprint: 'a'.repeat(64), repository: await readRepositoryBaseline(root),
      source: { kind: 'deterministic-builder', producer: 'recovery-test', capability: 'state.edit' },
      baselineFiles: [{ path, content: await readFile(join(root, path), 'utf8'), mode: 0o644 }],
      finalFiles: [{ path, content: 'value: accepted\n', mode: 0o644 }],
    });
    if (!candidate) throw new Error('Expected candidate');
    await store.proposeCandidate({ id, candidate, title: `Apply ${id}`, description: 'Git recovery test' });
  }
  return { root, head, store, materializer, propose };
}

function journalPath(root: string, id: string): string {
  return join(root, '.workspace/change-engine/v1/transactions', `${id}.json`);
}

async function expectNoJournal(root: string, id: string) {
  await expect(readFile(journalPath(root, id))).rejects.toMatchObject({ code: 'ENOENT' });
}

async function git(root: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', ['-C', root, ...args])).stdout.trim();
}
