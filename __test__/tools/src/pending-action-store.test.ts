import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCandidateChangeSet,
  createPendingActionDecisionReceipt,
  createPendingActionStore,
} from '@oh-awesome-novel/tools';
import type {
  CandidateChangeSet,
  SandboxPendingActionOrigin,
} from '@oh-awesome-novel/tools';

const repository = {
  repositoryId: 'repository-1',
  branch: 'main',
  head: 'abc123',
};
const projectionFingerprint = 'a'.repeat(64);
const candidateFingerprint = 'e'.repeat(64);
const now = '2026-08-12T00:00:00.000Z';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('PendingActionStore v1', () => {
  it('persists an immutable proposal and atomic drafts in the isolated namespace', async () => {
    const workspaceRoot = await createWorkspace();
    const repositoryValidator = vi.fn(async () => undefined);
    const store = await createPendingActionStore({
      workspaceRoot,
      repositoryValidator,
      now: () => new Date(now),
    });
    const candidate = createMixedCandidate();

    const view = await store.proposeCandidate({
      id: 'pa-test-1',
      candidate,
      title: 'Review three files',
      description: 'Create, update, and delete in one immutable proposal.',
    });

    expect(view.changes).toEqual([
      {
        operation: 'create',
        path: 'chapters/0001/0002.md',
        newHash: candidate.changes[0].draft?.sha256,
      },
      {
        operation: 'update',
        path: 'state/value.yaml',
        oldHash: candidate.changes[1].baseline.exists
          ? candidate.changes[1].baseline.sha256
          : undefined,
        newHash: candidate.changes[1].draft?.sha256,
      },
      {
        operation: 'delete',
        path: 'world/obsolete.md',
        oldHash: candidate.changes[2].baseline.exists
          ? candidate.changes[2].baseline.sha256
          : undefined,
      },
    ]);
    expect(JSON.stringify(view)).not.toContain('relativePath');
    expect(view.diff).toContain('new file mode 100644');
    expect(view.diff).toContain('deleted file mode 100644');
    expect(await readFile(join(workspaceRoot, 'state/value.yaml'), 'utf8')).toBe('value: old\n');
    await expect(readFile(join(workspaceRoot, 'chapters/0001/0002.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(workspaceRoot, 'world/obsolete.md'), 'utf8')).toBe('# Old world\n');

    const engineRoot = join(workspaceRoot, '.workspace/change-engine/v1');
    const stored = JSON.parse(await readFile(
      join(engineRoot, 'pending/pa-test-1.json'),
      'utf8',
    )) as Record<string, unknown>;
    expect(stored).toMatchObject({ schemaVersion: 1, kind: 'pending-action' });
    expect(stored).not.toHaveProperty('patches');
    expect(stored).not.toHaveProperty('shadowWrites');
    expect(stored).not.toHaveProperty('touchedFiles');
    expect(await readFile(join(engineRoot, 'drafts/pa-test-1/0.txt'), 'utf8')).toBe('# Chapter 2\n');
    expect(await readFile(join(engineRoot, 'drafts/pa-test-1/1.txt'), 'utf8')).toBe('value: new\n');
    expect(await listFiles(engineRoot)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.tmp$/u)]),
    );
    expect(repositoryValidator).toHaveBeenCalledWith(store.workspaceRoot, repository);

    const proposalBefore = await readFile(join(engineRoot, 'pending/pa-test-1.json'), 'utf8');
    await expect(store.proposeCandidate({
      id: 'pa-test-1',
      candidate,
      title: 'Overwrite',
      description: 'Must not overwrite.',
    })).rejects.toMatchObject({ code: 'PENDING_ACTION_ID_CONFLICT' });
    expect(await readFile(join(engineRoot, 'pending/pa-test-1.json'), 'utf8')).toBe(proposalBefore);
  });

  it('rejects old/unversioned/new-but-loose stored records and never scans old directories', async () => {
    const workspaceRoot = await createWorkspace();
    const store = await createPendingActionStore({
      workspaceRoot,
      repositoryValidator: async () => undefined,
    });
    const newPending = join(workspaceRoot, '.workspace/change-engine/v1/pending');
    await mkdir(newPending, { recursive: true });
    await writeFile(join(newPending, 'legacy.json'), JSON.stringify({
      id: 'legacy',
      patches: [],
      shadowWrites: [],
    }));
    await mkdir(join(workspaceRoot, '.workspace/pending-actions'), { recursive: true });
    await writeFile(
      join(workspaceRoot, '.workspace/pending-actions/old.json'),
      JSON.stringify({ id: 'old', patches: [] }),
    );

    await expect(store.readAction('legacy')).rejects.toMatchObject({
      code: 'UNSUPPORTED_PENDING_ACTION_SCHEMA',
    });
    await rm(join(newPending, 'legacy.json'));
    expect(await store.listRecords()).toEqual([]);

    const view = await store.proposeCandidate({
      id: 'strict-record',
      candidate: createMixedCandidate(),
      title: 'Strict record',
      description: 'Strict record.',
    });
    const actionPath = join(newPending, `${view.id}.json`);
    const action = JSON.parse(await readFile(actionPath, 'utf8')) as Record<string, unknown>;
    await writeFile(actionPath, JSON.stringify({ ...action, unexpected: true }));
    await expect(store.readAction(view.id)).rejects.toMatchObject({
      code: 'INVALID_PENDING_ACTION_SCHEMA',
    });
    await expect(store.readAction('../escape')).rejects.toMatchObject({
      code: 'INVALID_PENDING_ACTION_SCHEMA',
    });
  });

  it('fails closed on terminal conflict and keeps Git outcome in a separate receipt', async () => {
    const workspaceRoot = await createWorkspace();
    const store = await createPendingActionStore({
      workspaceRoot,
      repositoryValidator: async () => undefined,
      now: () => new Date(now),
    });
    await store.proposeCandidate({
      id: 'terminal-test',
      candidate: createMixedCandidate(),
      title: 'Terminal test',
      description: 'Terminal test.',
    });
    const terminal = await store.writeTerminal({
      actionId: 'terminal-test',
      decision: 'accepted',
      decisionReceiptId: 'receipt-terminal-test',
    });
    expect(terminal.kind).toBe('pending-action-terminal');
    await expect(store.writeTerminal({
      actionId: 'terminal-test',
      decision: 'rejected',
      decisionReceiptId: 'receipt-rejected',
    })).rejects.toMatchObject({ code: 'PENDING_ACTION_TERMINAL_CONFLICT' });

    const staged = createPendingActionDecisionReceipt({
      id: 'receipt-terminal-test',
      actionId: 'terminal-test',
      decision: 'accepted',
      decidedAt: now,
      materialization: 'committed',
      git: {
        status: 'staged-not-committed',
        branch: 'main',
        errorCode: 'identity_missing',
      },
    });
    await store.writeDecisionReceipt(staged);
    expect((await store.readView('terminal-test')).git?.status).toBe('staged-not-committed');
    await store.writeDecisionReceipt(createPendingActionDecisionReceipt({
      ...staged,
      git: { status: 'committed', commit: 'def456', branch: 'main' },
    }));
    expect((await store.readView('terminal-test')).git).toEqual({
      status: 'committed',
      commit: 'def456',
      branch: 'main',
    });

    const rejectedPath = join(
      workspaceRoot,
      '.workspace/change-engine/v1/terminal/rejected/terminal-test.json',
    );
    await mkdir(dirname(rejectedPath), { recursive: true });
    await writeFile(rejectedPath, JSON.stringify({
      ...terminal,
      decision: 'rejected',
      decisionReceiptId: 'other-receipt',
    }));
    await expect(store.readRecord('terminal-test')).rejects.toMatchObject({
      code: 'PENDING_ACTION_TERMINAL_CONFLICT',
    });
  });

  it('promotes a prepared preview only after every trusted precondition is revalidated', async () => {
    const workspaceRoot = await createWorkspace();
    const repositoryValidator = vi.fn(async () => undefined);
    const originValidator = vi.fn(async () => undefined);
    const store = await createPendingActionStore({
      workspaceRoot,
      repositoryValidator,
      assertOriginFresh: originValidator,
      now: () => new Date(now),
    });
    const origin = referenceOrigin();
    const candidate = createMixedCandidate();
    const allowedTargets = candidate.changes.map((change) => change.path);

    const preview = await store.prepareChangePreview({
      id: 'preview-test',
      candidate,
      origin,
      allowedTargets,
    });
    expect(preview.kind).toBe('prepared-change-preview');
    expect(await readFile(join(
      workspaceRoot,
      '.workspace/change-engine/v1/previews/preview-test/drafts/0.txt',
    ), 'utf8')).toBe('# Chapter 2\n');

    const view = await store.promotePreparedChangePreview({
      id: preview.id,
      title: 'Promoted preview',
      description: 'Promoted only after freshness checks.',
      source: {
        kind: 'deterministic-builder',
        producer: 'reference-publisher',
        capability: preview.capability,
      },
      origin,
      allowedTargets,
    });
    expect(view.status).toBe('pending');
    expect(JSON.stringify(view)).not.toContain('relativePath');
    expect(repositoryValidator).toHaveBeenCalledTimes(2);
    expect(originValidator).toHaveBeenCalledOnce();
    expect(await readFile(join(
      workspaceRoot,
      '.workspace/change-engine/v1/previews/preview-test/promotion.json',
    ), 'utf8')).toContain('prepared-change-preview-promotion');
    expect(await readFile(join(
      workspaceRoot,
      '.workspace/change-engine/v1/drafts/preview-test/0.txt',
    ), 'utf8')).toBe('# Chapter 2\n');

    await expect(store.promotePreparedChangePreview({
      id: preview.id,
      title: 'Promoted preview',
      description: 'Promoted only after freshness checks.',
      source: {
        kind: 'deterministic-builder',
        producer: 'reference-publisher',
        capability: preview.capability,
      },
      origin,
      allowedTargets: ['state/value.yaml'],
    })).rejects.toMatchObject({ code: 'PENDING_ACTION_ALLOWED_TARGETS_MISMATCH' });
  });

  it('rejects prepared preview artifact tamper, baseline drift, and missing origin validator', async () => {
    const workspaceRoot = await createWorkspace();
    const origin = referenceOrigin();
    const candidate = createMixedCandidate();
    const allowedTargets = candidate.changes.map((change) => change.path);
    const makeStore = (assertOriginFresh?: () => Promise<void>) => createPendingActionStore({
      workspaceRoot,
      repositoryValidator: async () => undefined,
      ...(assertOriginFresh ? { assertOriginFresh } : {}),
    });

    const tamperedStore = await makeStore(async () => undefined);
    await tamperedStore.prepareChangePreview({
      id: 'tampered-preview',
      candidate,
      origin,
      allowedTargets,
    });
    await writeFile(join(
      workspaceRoot,
      '.workspace/change-engine/v1/previews/tampered-preview/drafts/0.txt',
    ), '# Tampered\n');
    await expect(tamperedStore.promotePreparedChangePreview({
      id: 'tampered-preview',
      title: 'Tampered',
      description: 'Must fail.',
      source: deterministicSource(),
      origin,
      allowedTargets,
    })).rejects.toMatchObject({ code: 'PENDING_ACTION_DRAFT_INTEGRITY_ERROR' });

    const driftStore = await makeStore(async () => undefined);
    await driftStore.prepareChangePreview({
      id: 'drift-preview',
      candidate,
      origin,
      allowedTargets,
    });
    await writeFile(join(workspaceRoot, 'state/value.yaml'), 'value: user-change\n');
    await expect(driftStore.promotePreparedChangePreview({
      id: 'drift-preview',
      title: 'Drift',
      description: 'Must fail.',
      source: deterministicSource(),
      origin,
      allowedTargets,
    })).rejects.toMatchObject({ code: 'STALE_PENDING_ACTION_BASELINE' });

    await writeFile(join(workspaceRoot, 'state/value.yaml'), 'value: old\n');
    const noOriginStore = await makeStore();
    await noOriginStore.prepareChangePreview({
      id: 'no-origin-validator',
      candidate,
      origin,
      allowedTargets,
    });
    await expect(noOriginStore.promotePreparedChangePreview({
      id: 'no-origin-validator',
      title: 'No origin validator',
      description: 'Must fail closed.',
      source: deterministicSource(),
      origin,
      allowedTargets,
    })).rejects.toMatchObject({ code: 'PENDING_ACTION_ORIGIN_VALIDATOR_REQUIRED' });
  });

  it('does not steal an expired-looking lock while its owner process is alive', async () => {
    const workspaceRoot = await createWorkspace();
    const store = await createPendingActionStore({
      workspaceRoot,
      repositoryValidator: async () => undefined,
      lockOwnerPid: process.pid,
      lockMaxAttempts: 1,
    });
    const lockPath = join(
      workspaceRoot,
      '.workspace/change-engine/v1/locks/actions/live-owner.lock',
    );
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ token: 'live', pid: process.pid })}\n`);
    const expired = new Date(Date.now() - 120_000);
    await utimes(lockPath, expired, expired);

    await expect(store.proposeCandidate({
      id: 'live-owner',
      candidate: createMixedCandidate(),
      title: 'Must remain locked',
      description: 'An active process owns this expired-looking lock.',
    })).rejects.toThrow(/lock is busy/u);
    expect(await readFile(lockPath, 'utf8')).toContain(`"pid":${process.pid}`);
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-pending-store-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'state'), { recursive: true });
  await mkdir(join(root, 'world'), { recursive: true });
  await writeFile(join(root, 'state/value.yaml'), 'value: old\n');
  await writeFile(join(root, 'world/obsolete.md'), '# Old world\n');
  return root;
}

function createMixedCandidate(): CandidateChangeSet {
  const candidate = createCandidateChangeSet({
    sessionId: 'candidate-session',
    createdAt: now,
    finalizedAt: now,
    projectionFingerprint,
    repository,
    source: deterministicSource(),
    baselineFiles: [
      { path: 'state/value.yaml', content: 'value: old\n', mode: 0o644 },
      { path: 'world/obsolete.md', content: '# Old world\n', mode: 0o644 },
    ],
    finalFiles: [
      { path: 'chapters/0001/0002.md', content: '# Chapter 2\n', mode: 0o644 },
      { path: 'state/value.yaml', content: 'value: new\n', mode: 0o644 },
    ],
  });
  if (!candidate) throw new Error('Expected a non-empty CandidateChangeSet.');
  return candidate;
}

function deterministicSource() {
  return {
    kind: 'deterministic-builder' as const,
    producer: 'reference-publisher',
    capability: 'novel.multi-file-edit' as const,
  };
}

function referenceOrigin(): SandboxPendingActionOrigin {
  return {
    kind: 'referenceDeconstructionPublish',
    referenceId: 'reference-1',
    runId: 'run-1',
    runRevision: 1,
    candidateFingerprint,
  };
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else files.push(path);
  }
  return files;
}
