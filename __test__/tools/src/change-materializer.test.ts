import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createCandidateChangeSet,
  createChangeMaterializer,
  createPendingActionStore,
  readPendingActionCommitAtHead,
  readRepositoryBaseline,
} from '@oh-awesome-novel/tools';
import type {
  CandidateChangeSet,
  ChangeMaterializerFaultPoint,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const now = '2026-08-12T00:00:00.000Z';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('ChangeMaterializer v1', () => {
  it('reconstructs Accept policy from immutable allowed targets, not only changed paths', async () => {
    const fixture = await createFixture('trusted-targets');
    const action = await fixture.store.readAction(fixture.actionId);

    expect(action.allowedTargets).toEqual(action.changes.map((change) => change.path));
    const tampered = structuredClone(action);
    tampered.allowedTargets = tampered.allowedTargets.filter(
      (path) => path !== 'state/value.yaml',
    );
    await writeFile(
      join(fixture.root, '.workspace/change-engine/v1/pending', `${fixture.actionId}.json`),
      `${JSON.stringify(tampered, null, 2)}\n`,
    );

    await expect(createChangeMaterializer({ store: fixture.store }).accept({
      actionId: fixture.actionId,
      autoCommitOnAccept: false,
    })).rejects.toMatchObject({ code: 'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH' });
  });

  it('atomically materializes create/update/delete and leaves Git untouched when disabled', async () => {
    const fixture = await createFixture('atomic');
    const materializer = createChangeMaterializer({
      store: fixture.store,
      now: () => new Date(now),
      idFactory: () => 'receipt-atomic',
    });

    const result = await materializer.accept({
      actionId: fixture.actionId,
      autoCommitOnAccept: false,
    });

    expect(result.appliedFiles).toEqual([
      'chapters/0001/0002.md',
      'state/value.yaml',
      'world/obsolete.md',
    ]);
    expect(result.action.status).toBe('accepted');
    expect(result.receipt).toMatchObject({
      decision: 'accepted',
      materialization: 'committed',
      git: { status: 'not-requested' },
    });
    expect(await readFile(join(fixture.root, 'chapters/0001/0002.md'), 'utf8')).toBe('# Chapter 2\n');
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');
    await expect(readFile(join(fixture.root, 'world/obsolete.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(join(fixture.root, 'chapters/0001/0002.md'))).mode & 0o777).toBe(0o644);
    expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.repository.head);
    await expect(readFile(transactionPath(fixture.root, fixture.actionId), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(draftPath(fixture.root, fixture.actionId, 0), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each<ChangeMaterializerFaultPoint>([
    'before-journal',
    'after-stage:0',
    'after-stage:1',
    'after-stage:2',
    'after-backup:0',
    'after-backup:1',
    'after-backup:2',
    'after-materialize:0',
    'after-materialize:1',
    'after-materialize:2',
    'before-terminal',
  ])('rolls back pre-commit fault %s and permits a clean retry', async (point) => {
    const fixture = await createFixture(point.replace(/[^a-z0-9]+/giu, '-'));
    let armed = true;
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => `receipt-${fixture.actionId}`,
      faultInjector: (actual) => {
        if (armed && actual === point) throw Object.assign(new Error(`fault: ${point}`), { code: 'TEST_FAULT' });
      },
    });

    await expect(materializer.accept({
      actionId: fixture.actionId,
      autoCommitOnAccept: false,
    })).rejects.toThrow(`fault: ${point}`);
    await expectCanonicalBaseline(fixture.root);
    expect((await fixture.store.readRecord(fixture.actionId)).status).toBe('pending');

    armed = false;
    await expect(materializer.accept({
      actionId: fixture.actionId,
      autoCommitOnAccept: false,
    })).resolves.toMatchObject({ action: { status: 'accepted' } });
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');
  });

  it('treats the accepted terminal as commit point and only finalizes after a crash', async () => {
    const fixture = await createFixture('after-terminal');
    let armed = true;
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-after-terminal',
      faultInjector: (point) => {
        if (armed && point === 'after-terminal') throw new Error('simulated post-terminal crash');
      },
    });

    await expect(materializer.accept({
      actionId: fixture.actionId,
      autoCommitOnAccept: false,
    })).rejects.toThrow('simulated post-terminal crash');
    expect((await fixture.store.readRecord(fixture.actionId)).status).toBe('accepted');
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');
    await expect(readFile(join(fixture.root, 'world/obsolete.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });

    armed = false;
    await materializer.recover();
    expect(await fixture.store.readDecisionReceipt(fixture.actionId)).toMatchObject({
      decision: 'accepted',
      git: { status: 'not-requested' },
    });
    await expect(readFile(transactionPath(fixture.root, fixture.actionId), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('restores a missing accepted terminal from finalize-only journal identity without rolling back', async () => {
    const fixture = await createFixture('missing-accepted-terminal');
    let armed = true;
    const materializer = createChangeMaterializer({
      store: fixture.store,
      now: () => new Date(now),
      idFactory: () => 'receipt-missing-accepted-terminal',
      faultInjector: (point) => {
        if (armed && point === 'after-terminal') throw new Error('simulated missing terminal crash');
      },
    });

    await expect(materializer.accept({
      actionId: fixture.actionId,
      autoCommitOnAccept: false,
    })).rejects.toThrow('simulated missing terminal crash');
    const journal = JSON.parse(
      await readFile(transactionPath(fixture.root, fixture.actionId), 'utf8'),
    ) as { phase: string; decisionReceiptId: string; acceptedAt: string };
    expect(journal).toMatchObject({
      phase: 'accepted-finalize-only',
      decisionReceiptId: 'receipt-missing-accepted-terminal',
      acceptedAt: now,
    });

    await rm(terminalPath(fixture.root, 'accepted', fixture.actionId));
    expect((await fixture.store.readRecord(fixture.actionId)).status).toBe('pending');
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');

    armed = false;
    await materializer.recover();
    expect(await fixture.store.readRecord(fixture.actionId)).toMatchObject({
      status: 'accepted',
      decisionReceiptId: journal.decisionReceiptId,
      acceptedAt: journal.acceptedAt,
    });
    expect(await fixture.store.readDecisionReceipt(fixture.actionId)).toMatchObject({
      id: journal.decisionReceiptId,
      decision: 'accepted',
      decidedAt: journal.acceptedAt,
      git: { status: 'not-requested' },
    });
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');
    await expect(readFile(join(fixture.root, 'world/obsolete.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(transactionPath(fixture.root, fixture.actionId), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removes only verified current-protocol orphan transaction artifacts without changing canonical files', async () => {
    const fixture = await createFixture('orphan-artifacts');
    const token = artifactToken(fixture.actionId, 'state/value.yaml');
    const stage = join(fixture.root, 'state', `.oan-ce-${token}.stage`);
    const backup = join(fixture.root, 'state', `.oan-ce-${token}.backup`);
    const unknownStage = join(fixture.root, 'state', `.oan-ce-${'f'.repeat(32)}.stage`);
    const legacyBackup = join(fixture.root, 'state', '.oan-write-intent-legacy.backup');
    const transactions = join(fixture.root, '.workspace/change-engine/v1/transactions');
    const transactionTemporary = join(
      transactions,
      `.${fixture.actionId}.json.00000000-0000-4000-8000-000000000000.tmp`,
    );
    const unknownTransactionTemporary = join(
      transactions,
      '.pa-unknown.json.00000000-0000-4000-8000-000000000001.tmp',
    );
    await mkdir(transactions, { recursive: true });
    await writeFile(stage, 'value: new\n');
    await writeFile(backup, 'value: old\n');
    await writeFile(unknownStage, 'user-owned lookalike\n');
    await writeFile(legacyBackup, 'legacy namespace\n');
    await writeFile(transactionTemporary, '{"partial":true}', { mode: 0o600 });
    await writeFile(unknownTransactionTemporary, '{"partial":true}', { mode: 0o600 });

    await createChangeMaterializer({ store: fixture.store }).recover();

    await expect(readFile(stage, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(backup, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(transactionTemporary, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(unknownStage, 'utf8')).toBe('user-owned lookalike\n');
    expect(await readFile(legacyBackup, 'utf8')).toBe('legacy namespace\n');
    expect(await readFile(unknownTransactionTemporary, 'utf8')).toBe('{"partial":true}');
    await expectCanonicalBaseline(fixture.root);
  });

  it('fails closed on an unsafe orphan artifact and does not follow it into canonical data', async () => {
    const fixture = await createFixture('unsafe-orphan-artifact');
    const token = artifactToken(fixture.actionId, 'state/value.yaml');
    const stage = join(fixture.root, 'state', `.oan-ce-${token}.stage`);
    await symlink(join(fixture.root, 'state/value.yaml'), stage);

    await expect(createChangeMaterializer({ store: fixture.store }).recover()).rejects.toMatchObject({
      code: 'UNSAFE_ORPHAN_TRANSACTION_ARTIFACT',
    });
    expect((await lstat(stage)).isSymbolicLink()).toBe(true);
    await expectCanonicalBaseline(fixture.root);
  });

  it('supplements a rejected terminal receipt and removes draft leftovers without a journal', async () => {
    const fixture = await createFixture('orphan-terminal-draft');
    const terminal = await fixture.store.writeTerminal({
      actionId: fixture.actionId,
      decision: 'rejected',
      decisionReceiptId: 'receipt-orphan-terminal-draft',
    });
    expect(await fixture.store.readDecisionReceipt(fixture.actionId)).toBeUndefined();
    await expect(readFile(draftPath(fixture.root, fixture.actionId, 0), 'utf8'))
      .resolves.toContain('Chapter 2');

    await createChangeMaterializer({ store: fixture.store }).recover();

    expect(await fixture.store.readDecisionReceipt(fixture.actionId)).toMatchObject({
      id: terminal.decisionReceiptId,
      decision: 'rejected',
      decidedAt: terminal.decidedAt,
      materialization: 'not-applicable',
      git: { status: 'not-requested' },
    });
    await expect(readFile(draftPath(fixture.root, fixture.actionId, 0), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expectCanonicalBaseline(fixture.root);
  });

  it('rejects without touching canonical files and deletes private drafts', async () => {
    const fixture = await createFixture('reject');
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-reject',
    });

    const result = await materializer.reject({ actionId: fixture.actionId });
    expect(result).toMatchObject({
      action: { status: 'rejected' },
      receipt: {
        decision: 'rejected',
        materialization: 'not-applicable',
        git: { status: 'not-requested' },
      },
    });
    await expectCanonicalBaseline(fixture.root);
    await expect(readFile(draftPath(fixture.root, fixture.actionId, 0), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fails preflight on repository, mode, content, and symlink drift with zero canonical writes', async () => {
    const content = await createFixture('content-drift');
    await writeFile(join(content.root, 'state/value.yaml'), 'value: user\n');
    await expect(createChangeMaterializer({ store: content.store }).accept({
      actionId: content.actionId,
      autoCommitOnAccept: false,
    })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    await expect(readFile(join(content.root, 'chapters/0001/0002.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const mode = await createFixture('mode-drift');
    await chmod(join(mode.root, 'state/value.yaml'), 0o600);
    await expect(createChangeMaterializer({ store: mode.store }).accept({
      actionId: mode.actionId,
      autoCommitOnAccept: false,
    })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });

    const linked = await createFixture('symlink-drift');
    await rm(join(linked.root, 'world/obsolete.md'));
    await symlink(join(linked.root, 'state/value.yaml'), join(linked.root, 'world/obsolete.md'));
    await expect(createChangeMaterializer({ store: linked.store }).accept({
      actionId: linked.actionId,
      autoCommitOnAccept: false,
    })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });

    const repository = await createFixture('repository-drift');
    await writeFile(join(repository.root, 'unrelated.md'), '# unrelated\n');
    await git(repository.root, ['add', 'unrelated.md']);
    await git(repository.root, ['commit', '-m', 'move HEAD']);
    await expect(createChangeMaterializer({ store: repository.store }).accept({
      actionId: repository.actionId,
      autoCommitOnAccept: false,
    })).rejects.toMatchObject({ code: 'STALE_REPOSITORY_BASELINE' });
  });

  it('auto-commits only accepted paths and writes a committed decision receipt', async () => {
    const fixture = await createFixture('auto-commit');
    const result = await createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-auto-commit',
    }).accept({ actionId: fixture.actionId });

    expect(result.receipt.git).toMatchObject({
      status: 'committed',
      branch: 'main',
    });
    const body = await git(fixture.root, ['show', '-s', '--format=%B', 'HEAD']);
    expect(body).toContain(`Pending-Action-Id: ${fixture.actionId}`);
    expect((await git(fixture.root, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      'HEAD',
    ])).split('\n').filter(Boolean).sort()).toEqual([
      'chapters/0001/0002.md',
      'state/value.yaml',
      'world/obsolete.md',
    ]);
  });

  it('refuses unrelated staged state before materialization', async () => {
    const fixture = await createFixture('unrelated-staged');
    await writeFile(join(fixture.root, 'unrelated.md'), '# staged by user\n');
    await git(fixture.root, ['add', 'unrelated.md']);

    await expect(createChangeMaterializer({ store: fixture.store }).accept({
      actionId: fixture.actionId,
    })).rejects.toMatchObject({ code: 'UNRELATED_STAGED_FILES' });
    await expectCanonicalBaseline(fixture.root);
    expect((await fixture.store.readRecord(fixture.actionId)).status).toBe('pending');
  });

  it.each([
    'reference.publish',
    'reference.adopt',
    'play.adopt',
  ] as const)('rejects restricted capability %s when it omits its trusted origin', async (capability) => {
    const fixture = await createFixture(`restricted-no-origin-${capability}`, {
      capability,
    });

    await expect(createChangeMaterializer({ store: fixture.store }).accept({
      actionId: fixture.actionId,
      autoCommitOnAccept: false,
    })).rejects.toMatchObject({ code: 'PENDING_ACTION_ORIGIN_VALIDATOR_REQUIRED' });
    await expectCanonicalBaseline(fixture.root);
    expect((await fixture.store.readRecord(fixture.actionId)).status).toBe('pending');
  });

  it('replaces already-staged accepted paths with the approved final bytes', async () => {
    const fixture = await createFixture('replace-staged-bytes');
    await writeFile(join(fixture.root, 'state/value.yaml'), 'value: staged-evil\n');
    await git(fixture.root, ['add', '--', 'state/value.yaml']);
    await writeFile(join(fixture.root, 'state/value.yaml'), 'value: old\n');

    const result = await createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-replace-staged-bytes',
    }).accept({ actionId: fixture.actionId });

    expect(result.receipt.git).toMatchObject({ status: 'committed' });
    expect(await git(fixture.root, ['show', 'HEAD:state/value.yaml'])).toBe('value: new');
  });

  it('supports CJK accepted paths across preflight, staging, commit, and recovery lookup', async () => {
    const fixture = await createFixture('cjk-path', { includeCjkPath: true });
    const result = await createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-cjk-path',
    }).accept({ actionId: fixture.actionId });

    expect(result.receipt.git).toMatchObject({ status: 'committed' });
    expect(await git(fixture.root, ['show', 'HEAD:state/中文.yaml'])).toBe('value: 新');
    await expect(readPendingActionCommitAtHead({
      workspaceRoot: fixture.root,
      actionId: fixture.actionId,
      files: (await fixture.store.readRecord(fixture.actionId)).action.changes
        .map((change) => change.path),
    })).resolves.toMatchObject({
      commit: await git(fixture.root, ['rev-parse', 'HEAD']),
      branch: 'main',
    });
  });

  it('keeps accepted files when git add fails, then quick-commits exactly the action paths', async () => {
    const fixture = await createFixture('git-add-fail');
    await writeFile(join(fixture.root, '.git/index.lock'), 'occupied');
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-git-add-fail',
    });

    const result = await materializer.accept({ actionId: fixture.actionId });
    expect(result.action.status).toBe('accepted');
    expect(result.receipt.git).toMatchObject({ status: 'failed' });
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');

    await rm(join(fixture.root, '.git/index.lock'));
    const receipt = await materializer.quickCommit(fixture.actionId);
    expect(receipt.git).toMatchObject({ status: 'committed', branch: 'main' });
  });

  it('records staged-not-committed and resumes through explicit quick commit', async () => {
    const fixture = await createFixture('commit-fail');
    const hook = join(fixture.root, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-commit-fail',
    });

    const result = await materializer.accept({ actionId: fixture.actionId });
    expect(result.receipt.git).toMatchObject({
      status: 'staged-not-committed',
      branch: 'main',
    });
    expect((await git(fixture.root, ['diff', '--cached', '--name-only'])).split('\n').filter(Boolean).sort()).toEqual([
      'chapters/0001/0002.md',
      'state/value.yaml',
      'world/obsolete.md',
    ]);

    await rm(hook);
    await expect(materializer.quickCommit(fixture.actionId)).resolves.toMatchObject({
      git: { status: 'committed', branch: 'main' },
    });
  });

  it('quick commit rejects canonical content or mode drift after Accept', async () => {
    const content = await createFixture('quick-content-drift');
    const contentMaterializer = createChangeMaterializer({
      store: content.store,
      idFactory: () => 'receipt-quick-content-drift',
    });
    await contentMaterializer.accept({
      actionId: content.actionId,
      autoCommitOnAccept: false,
    });
    await writeFile(join(content.root, 'state/value.yaml'), 'value: post-accept-drift\n');
    await expect(contentMaterializer.quickCommit(content.actionId)).rejects.toMatchObject({
      code: 'ACCEPTED_TARGET_DRIFT',
    });
    expect(await git(content.root, ['rev-parse', 'HEAD'])).toBe(content.repository.head);

    const mode = await createFixture('quick-mode-drift');
    const modeMaterializer = createChangeMaterializer({
      store: mode.store,
      idFactory: () => 'receipt-quick-mode-drift',
    });
    await modeMaterializer.accept({
      actionId: mode.actionId,
      autoCommitOnAccept: false,
    });
    await chmod(join(mode.root, 'state/value.yaml'), 0o600);
    await expect(modeMaterializer.quickCommit(mode.actionId)).rejects.toMatchObject({
      code: 'ACCEPTED_TARGET_DRIFT',
    });
  });

  it('fails closed for auto-commit when a touched baseline was already dirty at proposal time', async () => {
    const fixture = await createFixture('dirty-baseline', { dirtyBaseline: true });
    const result = await createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-dirty-baseline',
    }).accept({ actionId: fixture.actionId });

    expect(result.action.status).toBe('accepted');
    expect(result.receipt.git).toEqual({
      status: 'failed',
      errorCode: 'dirty_before_proposal',
    });
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');
    expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.repository.head);
  });

  it('keeps explicit after-git-add evidence and never rolls accepted files back', async () => {
    const fixture = await createFixture('after-git-add');
    let armed = true;
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-after-git-add',
      faultInjector: (point) => {
        if (armed && point === 'after-git-add') {
          throw Object.assign(new Error('simulated crash after add'), { code: 'after_add_crash' });
        }
      },
    });

    const result = await materializer.accept({ actionId: fixture.actionId });
    expect(result.receipt.git).toEqual({
      status: 'staged-not-committed',
      branch: 'main',
      errorCode: 'after_add_crash',
    });
    expect(await readFile(join(fixture.root, 'state/value.yaml'), 'utf8')).toBe('value: new\n');

    armed = false;
    await expect(materializer.quickCommit(fixture.actionId)).resolves.toMatchObject({
      git: { status: 'committed' },
    });
  });

  it('records an interrupted automatic commit before git add and resumes only through quick commit', async () => {
    const fixture = await createFixture('before-git-add');
    let armed = true;
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-before-git-add',
      faultInjector: (point) => {
        if (armed && point === 'before-git-add') throw new Error('simulated crash before add');
      },
    });

    await expect(materializer.accept({ actionId: fixture.actionId })).rejects.toThrow(
      'simulated crash before add',
    );
    expect((await fixture.store.readRecord(fixture.actionId)).status).toBe('accepted');
    expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.repository.head);

    armed = false;
    await materializer.recover();
    expect(await fixture.store.readDecisionReceipt(fixture.actionId)).toMatchObject({
      decision: 'accepted',
      git: { status: 'failed', errorCode: 'automatic_commit_interrupted' },
    });
    await expect(materializer.quickCommit(fixture.actionId)).resolves.toMatchObject({
      git: { status: 'committed' },
    });
  });

  it('reconciles a committed action after a pre-receipt crash without committing twice', async () => {
    const fixture = await createFixture('after-git-commit');
    let armed = true;
    const materializer = createChangeMaterializer({
      store: fixture.store,
      idFactory: () => 'receipt-after-git-commit',
      faultInjector: (point) => {
        if (armed && point === 'after-git-commit') throw new Error('simulated crash after commit');
      },
    });

    await expect(materializer.accept({ actionId: fixture.actionId })).rejects.toThrow(
      'simulated crash after commit',
    );
    const committedHead = await git(fixture.root, ['rev-parse', 'HEAD']);
    expect(committedHead).not.toBe(fixture.repository.head);
    expect(await fixture.store.readDecisionReceipt(fixture.actionId)).toBeUndefined();
    expect(await git(fixture.root, ['rev-list', '--count', 'HEAD'])).toBe('2');

    armed = false;
    await materializer.recover();
    expect(await fixture.store.readDecisionReceipt(fixture.actionId)).toMatchObject({
      decision: 'accepted',
      git: { status: 'committed', commit: committedHead, branch: 'main' },
    });
    expect(await git(fixture.root, ['rev-parse', 'HEAD'])).toBe(committedHead);
    expect(await git(fixture.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    await materializer.recover();
    expect(await git(fixture.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    await expect(readFile(transactionPath(fixture.root, fixture.actionId), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

async function createFixture(
  label: string,
  options: {
    dirtyBaseline?: boolean;
    includeCjkPath?: boolean;
    capability?: CandidateChangeSet['source']['capability'];
  } = {},
): Promise<{
  root: string;
  actionId: string;
  repository: Awaited<ReturnType<typeof readRepositoryBaseline>>;
  store: Awaited<ReturnType<typeof createPendingActionStore>>;
}> {
  const root = await mkdtemp(join(tmpdir(), `oan-change-materializer-${label}-`));
  roots.push(root);
  await mkdir(join(root, 'state'), { recursive: true });
  await mkdir(join(root, 'world'), { recursive: true });
  await writeFile(join(root, 'state/value.yaml'), 'value: old\n');
  await writeFile(join(root, 'world/obsolete.md'), '# Old world\n');
  if (options.includeCjkPath) {
    await writeFile(join(root, 'state/中文.yaml'), 'value: 旧\n');
  }
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'OAN Test']);
  await git(root, ['config', 'user.email', 'oan@example.test']);
  await git(root, ['add', '--', 'state/value.yaml', 'world/obsolete.md', ...(
    options.includeCjkPath ? ['state/中文.yaml'] : []
  )]);
  await git(root, ['commit', '-m', 'baseline']);
  const repository = await readRepositoryBaseline(root);
  if (options.dirtyBaseline) {
    await writeFile(join(root, 'state/value.yaml'), 'value: dirty-before-proposal\n');
  }
  const candidate = createCandidate(
    repository,
    options.dirtyBaseline ? 'value: dirty-before-proposal\n' : 'value: old\n',
    options,
  );
  const actionId = `pa-${label}`.replace(/[^A-Za-z0-9._-]/gu, '-');
  const store = await createPendingActionStore({ workspaceRoot: root });
  await store.proposeCandidate({
    id: actionId,
    candidate,
    title: `Apply ${label}`,
    description: 'A test create/update/delete action.',
  });
  return { root, actionId, repository, store };
}

function createCandidate(
  repository: Awaited<ReturnType<typeof readRepositoryBaseline>>,
  stateBaseline: string,
  options: {
    includeCjkPath?: boolean;
    capability?: CandidateChangeSet['source']['capability'];
  } = {},
): CandidateChangeSet {
  const candidate = createCandidateChangeSet({
    sessionId: 'materializer-test-session',
    createdAt: now,
    finalizedAt: now,
    projectionFingerprint: 'a'.repeat(64),
    repository,
    source: {
      kind: 'deterministic-builder',
      producer: 'materializer-test',
      capability: options.capability ?? 'novel.multi-file-edit',
    },
    baselineFiles: [
      { path: 'state/value.yaml', content: stateBaseline, mode: 0o644 },
      { path: 'world/obsolete.md', content: '# Old world\n', mode: 0o644 },
      ...(options.includeCjkPath
        ? [{ path: 'state/中文.yaml', content: 'value: 旧\n', mode: 0o644 }]
        : []),
    ],
    finalFiles: [
      { path: 'chapters/0001/0002.md', content: '# Chapter 2\n', mode: 0o644 },
      { path: 'state/value.yaml', content: 'value: new\n', mode: 0o644 },
      ...(options.includeCjkPath
        ? [{ path: 'state/中文.yaml', content: 'value: 新\n', mode: 0o644 }]
        : []),
    ],
  });
  if (!candidate) throw new Error('Expected candidate.');
  return candidate;
}

async function expectCanonicalBaseline(root: string): Promise<void> {
  expect(await readFile(join(root, 'state/value.yaml'), 'utf8')).toBe('value: old\n');
  expect(await readFile(join(root, 'world/obsolete.md'), 'utf8')).toBe('# Old world\n');
  await expect(readFile(join(root, 'chapters/0001/0002.md'), 'utf8')).rejects.toMatchObject({
    code: 'ENOENT',
  });
}

function transactionPath(root: string, actionId: string): string {
  return join(root, '.workspace/change-engine/v1/transactions', `${actionId}.json`);
}

function terminalPath(
  root: string,
  decision: 'accepted' | 'rejected',
  actionId: string,
): string {
  return join(root, '.workspace/change-engine/v1/terminal', decision, `${actionId}.json`);
}

function draftPath(root: string, actionId: string, index: number): string {
  return join(root, '.workspace/change-engine/v1/drafts', actionId, `${index}.txt`);
}

function artifactToken(actionId: string, targetFile: string): string {
  return createHash('sha256')
    .update(`${actionId}\0${targetFile}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', root, ...args]);
  return result.stdout.trim();
}
