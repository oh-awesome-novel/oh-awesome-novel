import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCandidateChangeSet, createChangeMaterializer, createPendingActionStore,
  inspectPendingActionGitPreflight, readRepositoryBaseline,
} from '@oh-awesome-novel/tools';

const host = vi.hoisted(() => ({ platform: 'win32' as NodeJS.Platform }));
vi.mock('node:process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:process')>();
  return { ...original, default: new Proxy(original.default, {
    get(target, key) { return key === 'platform' ? host.platform : Reflect.get(target, key); },
  }) };
});
// Reproduce native Windows stat/chmod: 0644 and 0600 both report 0666;
// clearing owner-write sets the read-only attribute and reports 0444.
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original,
    lstat: async (...args: Parameters<typeof original.lstat>) => {
      const info = await original.lstat(...args);
      if (host.platform === 'win32' && info.isFile()) {
        const mode = Number(info.mode);
        const simulated = (mode & ~0o777) | (mode & 0o200 ? 0o666 : 0o444);
        Object.assign(info, { mode: typeof info.mode === 'bigint' ? BigInt(simulated) : simulated });
      }
      return info;
    },
    chmod: async (path: Parameters<typeof original.chmod>[0], mode: Parameters<typeof original.chmod>[1]) => {
      const native = typeof mode === 'number' ? mode : Number.parseInt(mode, 8);
      await original.chmod(path, host.platform === 'win32' ? (native & 0o200 ? 0o666 : 0o444) : mode);
    },
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        if (host.platform === 'win32' && (await handle.stat()).isDirectory()) {
          throw Object.assign(new Error('Windows directory flush is unsupported'), { code: 'EINVAL' });
        }
        await sync();
      };
      return handle;
    },
  };
});
// Keep actual fixture filesystem paths native, but reproduce Windows separators
// for the relative artifact strings serialized into and verified against journals.
vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:path')>();
  return { ...original,
    relative(from: string, to: string) {
      const result = original.relative(from, to);
      return host.platform === 'win32' && original.basename(to).startsWith('.oan-ce-') ? result.replaceAll('/', '\\') : result;
    },
    resolve(...parts: string[]) {
      return original.resolve(...parts.map((part) => host.platform === 'win32' && part.includes('.oan-ce-')
        ? part.replaceAll('\\', '/') : part));
    },
    join(...parts: string[]) {
      const result = original.join(...parts);
      return host.platform === 'win32' && !original.isAbsolute(parts[0]!) && parts.at(-1)!.startsWith('.oan-ce-')
        ? result.replaceAll('/', '\\') : result;
    },
  };
});

const roots: string[] = [];
const exec = promisify(execFile);
const chapter = 'chapters/0001/0001.md';
const created = 'chapters/0001/0002.md';
const removed = 'state/remove.yaml';
const before = '# Chapter 1\nOriginal text.\n';
const after = '# Chapter 1\nApproved text.\n';
afterEach(async () => {
  host.platform = 'win32';
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function git(root: string, ...args: string[]) { return (await exec('git', ['-C', root, ...args])).stdout.trim(); }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-host-modes-')); roots.push(root);
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await mkdir(join(root, 'state'));
  await writeFile(join(root, chapter), before);
  await writeFile(join(root, removed), 'value: old\n');
  await git(root, 'init', '-b', 'main');
  await git(root, 'config', 'user.name', 'Mode Test');
  await git(root, 'config', 'user.email', 'modes@example.invalid');
  await git(root, 'config', 'core.filemode', host.platform === 'win32' ? 'false' : 'true');
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'baseline');
  const repository = await readRepositoryBaseline(root);
  const baselineMode = (await lstat(join(root, chapter))).mode & 0o777;
  const candidate = createCandidateChangeSet({ sessionId: 'host-modes', projectionFingerprint: 'a'.repeat(64), repository,
    source: { kind: 'deterministic-builder', producer: 'mode-test', capability: 'novel.multi-file-edit' },
    baselineFiles: [{ path: chapter, content: before, mode: baselineMode }, { path: removed, content: 'value: old\n', mode: baselineMode }],
    finalFiles: [{ path: chapter, content: after, mode: baselineMode }, { path: created, content: '# Chapter 2\n', mode: 0o644 }],
  });
  expect(candidate).toBeDefined();
  const store = await createPendingActionStore({ workspaceRoot: root });
  const actionId = 'pa_host-modes';
  await store.proposeCandidate({ id: actionId, title: 'Mode test', description: 'Create, update and delete', candidate: candidate! });
  return { root, store, actionId, repository, baselineMode };
}

describe('host permission semantics at approval boundaries', () => {
  it('auto-commits approved creates, updates and deletes when Windows reports writable files as 0666', async () => {
    const { root, store, actionId, baselineMode } = await fixture();
    expect(baselineMode).toBe(0o666);
    const result = await createChangeMaterializer({ store }).accept({ actionId });
    expect(result.receipt.git.status).toBe('committed');
    expect((await store.readRecord(actionId)).status).toBe('accepted');
    expect(await store.readDecisionReceipt(actionId)).toEqual(result.receipt);
    expect(await readFile(join(root, chapter), 'utf8')).toBe(after);
    expect((await lstat(join(root, created))).mode & 0o777).toBe(0o666);
    await expect(readFile(join(root, removed))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await git(root, 'diff', '--cached')).toBe('');
    expect(await readdir(join(root, '.workspace/change-engine/v1/transactions'))).toEqual([]);
  });

  it('rejects a Windows read-only attribute change after proposal before modifying canonical files', async () => {
    const { root, store, actionId } = await fixture();
    await chmod(join(root, chapter), 0o444);
    await expect(createChangeMaterializer({ store }).accept({ actionId })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    expect(await readFile(join(root, chapter), 'utf8')).toBe(before);
    expect((await lstat(join(root, chapter))).mode & 0o777).toBe(0o444);
    await expect(readFile(join(root, created))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.readRecord(actionId)).status).toBe('pending');
  });

  it('rolls back interrupted Windows creates and updates with original bytes and writeability intact', async () => {
    const { root, store, actionId } = await fixture();
    await expect(createChangeMaterializer({ store, faultInjector: async (point) => {
      if (point === 'after-materialize:1') throw new Error('Interrupted before acceptance');
    } }).accept({ actionId })).rejects.toThrow('Interrupted before acceptance');
    expect(await readFile(join(root, chapter), 'utf8')).toBe(before);
    expect((await lstat(join(root, chapter))).mode & 0o777).toBe(0o666);
    await expect(readFile(join(root, created))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, removed), 'utf8')).toBe('value: old\n');
    expect((await store.readRecord(actionId)).status).toBe('pending');
    expect(await readdir(join(root, '.workspace/change-engine/v1/transactions'))).toEqual([]);
  });

  it('recovers after the accepted terminal without rolling approved bytes back and can finish Git bookkeeping', async () => {
    const { root, store, actionId } = await fixture();
    await expect(createChangeMaterializer({ store, faultInjector: async (point) => {
      if (point === 'after-terminal') throw new Error('Interrupted after acceptance');
    } }).accept({ actionId })).rejects.toThrow('Interrupted after acceptance');
    expect((await store.readRecord(actionId)).status).toBe('accepted');
    expect(await store.readDecisionReceipt(actionId)).toBeUndefined();
    const journal = JSON.parse(await readFile(join(root, '.workspace/change-engine/v1/transactions', `${actionId}.json`), 'utf8'));
    expect(journal.operations.every((operation: { stageFile?: string; backupFile?: string }) =>
      !operation.stageFile?.includes('\\') && !operation.backupFile?.includes('\\'))).toBe(true);
    const reopened = await createPendingActionStore({ workspaceRoot: root });
    const materializer = createChangeMaterializer({ store: reopened });
    await materializer.recover();
    expect(await readFile(join(root, chapter), 'utf8')).toBe(after);
    expect((await reopened.readRecord(actionId)).status).toBe('accepted');
    expect((await reopened.readDecisionReceipt(actionId))?.git.status).toBe('failed');
    expect((await materializer.quickCommit(actionId)).git.status).toBe('committed');
    expect(await git(root, 'rev-list', '--count', 'HEAD')).toBe('2');
  });

  it('still detects Windows read-only drift during accepted finalization', async () => {
    const { root, store, actionId } = await fixture();
    await expect(createChangeMaterializer({ store, faultInjector: async (point) => {
      if (point === 'after-terminal') await chmod(join(root, created), 0o444);
    } }).accept({ actionId })).rejects.toMatchObject({ code: 'ACCEPTED_TARGET_DRIFT' });
    expect((await store.readRecord(actionId)).status).toBe('accepted');
    expect((await lstat(join(root, created))).mode & 0o777).toBe(0o444);
    await chmod(join(root, created), 0o644);
    await createChangeMaterializer({ store }).recover();
    expect(await readFile(join(root, chapter), 'utf8')).toBe(after);
    expect(await store.readDecisionReceipt(actionId)).toBeDefined();
  });

  it('cleans an interrupted private 0600 journal temporary reported as 0666 on Windows', async () => {
    const { root, store, actionId } = await fixture();
    const directory = join(root, '.workspace/change-engine/v1/transactions');
    await mkdir(directory, { recursive: true });
    const path = join(directory, `.${actionId}.json.${randomUUID()}.tmp`);
    await writeFile(path, '{}', { mode: 0o600 });
    expect((await lstat(path)).mode & 0o777).toBe(0o666);
    await createChangeMaterializer({ store }).recover();
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a Windows journal temporary whose read-only attribute changed', async () => {
    const { root, store, actionId } = await fixture();
    const directory = join(root, '.workspace/change-engine/v1/transactions');
    await mkdir(directory, { recursive: true });
    const path = join(directory, `.${actionId}.json.${randomUUID()}.tmp`);
    await writeFile(path, '{}', { mode: 0o600 });
    await chmod(path, 0o444);
    await expect(createChangeMaterializer({ store }).recover()).rejects.toMatchObject({ code: 'UNSAFE_ORPHAN_TRANSACTION_ARTIFACT' });
    expect(await readFile(path, 'utf8')).toBe('{}');
  });

  it('retains full POSIX permission drift checks while Git preflight compares only executable mode', async () => {
    host.platform = 'linux';
    const { root, store, actionId, repository } = await fixture();
    const files = [{ path: chapter, exists: true, sha256: createHash('sha256').update(before).digest('hex'), mode: 0o600 }];
    expect((await inspectPendingActionGitPreflight({ workspaceRoot: root, expected: repository, files })).dirtyBaselineFiles).toEqual([]);
    for (const mode of [0o654, 0o645]) {
      expect((await inspectPendingActionGitPreflight({ workspaceRoot: root, expected: repository, files: [{ ...files[0]!, mode }] })).dirtyBaselineFiles).toEqual([]);
    }
    expect((await inspectPendingActionGitPreflight({ workspaceRoot: root, expected: repository, files: [{ ...files[0]!, mode: 0o744 }] })).dirtyBaselineFiles).toEqual([chapter]);
    expect((await inspectPendingActionGitPreflight({ workspaceRoot: root, expected: repository, files: [{ ...files[0]!, mode: 0o755 }] })).dirtyBaselineFiles).toEqual([chapter]);
    await git(root, 'config', 'core.filemode', 'false');
    expect((await inspectPendingActionGitPreflight({ workspaceRoot: root, expected: repository, files: [{ ...files[0]!, mode: 0o755 }] })).dirtyBaselineFiles).toEqual([]);
    await chmod(join(root, chapter), 0o600);
    await expect(createChangeMaterializer({ store }).accept({ actionId })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });
    expect(await readFile(join(root, chapter), 'utf8')).toBe(before);
  });

  it('does not confuse a tracked symlink with a regular file whose contents match', async () => {
    const { root } = await fixture();
    const blob = await git(root, 'rev-parse', `HEAD:${chapter}`);
    await git(root, 'update-index', '--cacheinfo', '120000', blob, chapter);
    await git(root, 'commit', '-m', 'tracked symbolic link');
    await expect(inspectPendingActionGitPreflight({ workspaceRoot: root, expected: await readRepositoryBaseline(root),
      files: [{ path: chapter, exists: true, sha256: createHash('sha256').update(before).digest('hex'), mode: 0o666 }],
    })).rejects.toMatchObject({ code: 'git_failed' });
  });
});
