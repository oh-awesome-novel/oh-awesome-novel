import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  acceptPendingAction,
  createPendingAction,
  createWriteIntentTools,
  listPendingActions,
  previewSemanticPatches,
  readPendingAction,
  rejectPendingAction,
} from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];
const cannotEnforceDirectoryPermissions =
  process.platform === 'win32' || process.getuid?.() === 0;

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('write intent tools and human approval', () => {
  it('returns a PendingAction with a shadow write instead of materializing state.set', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    const result = await executeTool(tools, 'state.set', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    });

    const action = expectSinglePendingAction(result);
    expect(action).toMatchObject({
      title: 'Set state characters.heroine.hp',
      touchedFiles: ['state/characters.yaml'],
      status: 'pending',
    });
    expect(action.diff).toContain('-    hp: injured');
    expect(action.diff).toContain('+    hp: recovering');
    expect(action.shadowWrites[0]).toMatchObject({
      targetFile: 'state/characters.yaml',
      originalHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      draftHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      targetExisted: true,
    });

    await expect(
      readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'),
    ).resolves.toContain('hp: injured');
    await expect(
      readFile(join(workspaceRoot, action.shadowWrites[0].shadowFile), 'utf-8'),
    ).resolves.toContain('hp: recovering');
    await expect(listPendingActions({ workspaceRoot })).resolves.toHaveLength(1);
  });

  it('accepts a PendingAction, writes the real file, and auto-commits touched files by default', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    await initGitRepo(workspaceRoot);
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'character.updatePersonality', {
      characterId: 'heroine',
      section: '外在人格',
      content: '她在人前更加冷淡克制，但会默默保护同伴。',
    });
    const action = expectSinglePendingAction(result);

    const accepted = await acceptPendingAction({
      workspaceRoot,
      id: action.id,
    });

    expect(accepted).toMatchObject({
      id: action.id,
      status: 'accepted',
      appliedFiles: ['characters/heroine/personality.md'],
      gitCommit: {
        status: 'committed',
        message: expect.stringContaining('chore(novel): apply pending action'),
      },
    });
    expect(accepted.gitDiff).toBe('');
    expect(accepted.dirtyStatus).toBe('');
    await expect(
      readFile(join(workspaceRoot, 'characters/heroine/personality.md'), 'utf-8'),
    ).resolves.toContain('更加冷淡克制');
    await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
    await expect(git(workspaceRoot, ['show', '--name-only', '--format=', 'HEAD']))
      .resolves
      .toContain('characters/heroine/personality.md');
  });

  it('can accept a PendingAction without auto-committing', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    await initGitRepo(workspaceRoot);
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'state.set', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    });
    const action = expectSinglePendingAction(result);

    const accepted = await acceptPendingAction({
      workspaceRoot,
      id: action.id,
      autoCommitOnAccept: false,
    });

    expect(accepted.gitCommit).toMatchObject({
      status: 'skipped',
      reason: 'auto_commit_disabled',
    });
    expect(accepted.gitDiff).toContain('hp: recovering');
    expect(accepted.dirtyStatus).toContain('state/characters.yaml');
  });

  it('publishes technique and Story Material artifacts through one typed PendingAction transaction', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    await mkdir(
      join(workspaceRoot, 'examples/references/reference-1'),
      { recursive: true },
    );
    await writeFile(
      join(workspaceRoot, 'examples/references.yaml'),
      'version: 1\nreferences: []\n',
      'utf-8',
    );
    await writeFile(
      join(
        workspaceRoot,
        'examples/references/reference-1/deconstruction-manifest.yaml',
      ),
      'version: 1\nstatus: notAnalyzed\n',
      'utf-8',
    );
    const candidateFingerprint = 'a'.repeat(64);
    const action = await createPendingAction(workspaceRoot, {
      title: 'Publish reference reference-1',
      description: 'Publish a reviewed reference deconstruction candidate.',
      origin: {
        kind: 'referenceDeconstructionPublish',
        referenceId: 'reference-1',
        runId: 'run-1',
        runRevision: 12,
        candidateFingerprint,
      },
      patches: [
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'references.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nreferences:\n  - id: reference-1\n',
        },
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'distilled/pacing.md',
          operation: 'replaceFile',
          value: '# Pacing\n\nUse bounded escalation.\n',
        },
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'materials/world.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nkind: world\nentries:\n  - id: world-1\n',
        },
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'materials/characters.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nkind: characters\nentries:\n  - id: character-1\n',
        },
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'context/index.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nentries: []\n',
        },
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'deconstruction-manifest.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nstatus: completed\n',
        },
      ],
    });

    expect(action).toMatchObject({
      status: 'pending',
      origin: {
        kind: 'referenceDeconstructionPublish',
        referenceId: 'reference-1',
        runId: 'run-1',
        runRevision: 12,
        candidateFingerprint,
      },
      touchedFiles: [
        'examples/references.yaml',
        'examples/references/reference-1/distilled/pacing.md',
        'examples/references/reference-1/materials/world.yaml',
        'examples/references/reference-1/materials/characters.yaml',
        'examples/references/reference-1/context/index.yaml',
        'examples/references/reference-1/deconstruction-manifest.yaml',
      ],
    });
    await expect(
      readFile(
        join(
          workspaceRoot,
          'examples/references/reference-1/deconstruction-manifest.yaml',
        ),
        'utf-8',
      ),
    ).resolves.toContain('notAnalyzed');
    await expect(
      readFile(
        join(
          workspaceRoot,
          'examples/references/reference-1/materials/world.yaml',
        ),
        'utf-8',
      ),
    ).rejects.toThrow();
    await expect(
      readFile(
        join(
          workspaceRoot,
          'examples/references/reference-1/materials/characters.yaml',
        ),
        'utf-8',
      ),
    ).rejects.toThrow();

    const accepted = await acceptPendingAction({
      workspaceRoot,
      id: action.id,
      autoCommitOnAccept: false,
    });
    expect(accepted).toMatchObject({
      status: 'accepted',
      appliedFiles: action.touchedFiles,
      gitCommit: { status: 'skipped', reason: 'auto_commit_disabled' },
    });
    await expect(
      readFile(
        join(
          workspaceRoot,
          'examples/references/reference-1/deconstruction-manifest.yaml',
        ),
        'utf-8',
      ),
    ).resolves.toContain('completed');
    await expect(
      readFile(
        join(
          workspaceRoot,
          'examples/references/reference-1/distilled/pacing.md',
        ),
        'utf-8',
      ),
    ).resolves.toContain('bounded escalation');
    await expect(
      readFile(
        join(
          workspaceRoot,
          'examples/references/reference-1/materials/world.yaml',
        ),
        'utf-8',
      ),
    ).resolves.toContain('world-1');
    await expect(
      readFile(
        join(
          workspaceRoot,
          'examples/references/reference-1/materials/characters.yaml',
        ),
        'utf-8',
      ),
    ).resolves.toContain('character-1');
  });

  it('rejects a reference publication PendingAction without changing its bundle', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const action = await createPendingAction(workspaceRoot, {
      title: 'Publish reference reference-1',
      description: 'Publish a reviewed reference deconstruction candidate.',
      patches: [{
        kind: 'referenceArtifact',
        referenceId: 'reference-1',
        file: 'context/reference-summary.md',
        operation: 'replaceFile',
        value: '# Distilled summary\n',
      }],
      origin: {
        kind: 'referenceDeconstructionPublish',
        referenceId: 'reference-1',
        runId: 'run-1',
        runRevision: 12,
        candidateFingerprint: 'b'.repeat(64),
      },
    });

    await expect(rejectPendingAction({
      workspaceRoot,
      id: action.id,
    })).resolves.toMatchObject({ status: 'rejected' });
    await expect(
      stat(
        join(
          workspaceRoot,
          'examples/references/reference-1/context/reference-summary.md',
        ),
      ),
    ).rejects.toThrow();
  });

  it('rejects malformed reference publication origins before creating an action', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    await expect(createPendingAction(workspaceRoot, {
      title: 'Publish reference',
      description: 'Invalid origin.',
      patches: [{
        kind: 'referenceArtifact',
        referenceId: 'reference-1',
        file: 'progress.yaml',
        operation: 'replaceFile',
        value: 'version: 1\n',
      }],
      origin: {
        kind: 'referenceDeconstructionPublish',
        referenceId: '../escape',
        runId: 'run-1',
        runRevision: 1,
        candidateFingerprint: 'c'.repeat(64),
      },
    })).rejects.toThrow(/origin is invalid/);
    await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
  });

  it('uses a caller-stable PendingAction id without allowing duplicate overwrite', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const input = {
      id: `pa_${'d'.repeat(64)}`,
      title: 'Stable reference publication',
      description: 'Stable identity for publish replay.',
      patches: [{
        kind: 'referenceArtifact' as const,
        referenceId: 'reference-1',
        file: 'progress.yaml',
        operation: 'replaceFile' as const,
        value: 'version: 1\nstatus: completed\n',
      }],
    };
    const first = await createPendingAction(workspaceRoot, input);
    await expect(createPendingAction(workspaceRoot, {
      ...input,
      patches: [{
        ...input.patches[0],
        value: 'version: 1\nstatus: forged\n',
      }],
    })).rejects.toThrow(/already promoted/);
    await expect(readPendingAction({ workspaceRoot, id: first.id }))
      .resolves.toMatchObject({
        id: input.id,
        patches: input.patches,
      });
  });

  it.each(['accepted', 'rejected'] as const)(
    'keeps a stable PendingAction id globally unique after it is %s',
    async (decision) => {
      const workspaceRoot = await createTempNovelWorkspace();
      const id = `pa_${(decision === 'accepted' ? 'e' : 'f').repeat(64)}`;
      const input = {
        id,
        title: 'Terminal stable reference publication',
        description: 'The action identity must remain terminal.',
        patches: [{
          kind: 'referenceArtifact' as const,
          referenceId: 'reference-1',
          file: 'progress.yaml',
          operation: 'replaceFile' as const,
          value: 'version: 1\nstatus: completed\n',
        }],
      };
      const action = await createPendingAction(workspaceRoot, input);
      if (decision === 'accepted') {
        await acceptPendingAction({
          workspaceRoot,
          id: action.id,
          autoCommitOnAccept: false,
        });
      } else {
        await rejectPendingAction({ workspaceRoot, id: action.id });
      }

      await expect(createPendingAction(workspaceRoot, input))
        .rejects.toThrow(/already promoted/);
      await expect(readPendingAction({ workspaceRoot, id: action.id }))
        .resolves.toMatchObject({ id: action.id, status: decision });
    },
  );

  it('serializes concurrent stable-id creation and terminal decisions', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const id = `pa_${'1'.repeat(64)}`;
    const createResults = await Promise.allSettled([
      createPendingAction(workspaceRoot, {
        id,
        title: 'Concurrent candidate A',
        description: 'First candidate.',
        patches: [{
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'progress.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nstatus: candidate-a\n',
        }],
      }),
      createPendingAction(workspaceRoot, {
        id,
        title: 'Concurrent candidate B',
        description: 'Second candidate.',
        patches: [{
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'progress.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nstatus: candidate-b\n',
        }],
      }),
    ]);
    expect(createResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(createResults.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const decisions = await Promise.allSettled([
      acceptPendingAction({ workspaceRoot, id, autoCommitOnAccept: false }),
      rejectPendingAction({ workspaceRoot, id }),
    ]);
    expect(decisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const terminal = await readPendingAction({ workspaceRoot, id });
    expect(['accepted', 'rejected']).toContain(terminal.status);
    await expect(createPendingAction(workspaceRoot, {
      id,
      title: 'Replay after decision',
      description: 'Must remain globally unique.',
      patches: terminal.patches,
    })).rejects.toThrow(/already promoted/);
  });

  it('serializes different PendingActions that share a target across the whole accept', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const values = ['recovering', 'critical'] as const;
    const actions = await Promise.all(values.map((value, index) =>
      createPendingAction(workspaceRoot, {
        id: `pa_${String(index + 3).repeat(64)}`,
        title: `Shared target candidate ${value}`,
        description: 'Only one baseline may be accepted.',
        patches: [{
          kind: 'collection',
          domain: 'state',
          file: 'characters.yaml',
          operation: 'yamlSet',
          path: 'characters.heroine.hp',
          value,
        }],
      })));

    const decisions = await Promise.allSettled(actions.map((action) =>
      acceptPendingAction({
        workspaceRoot,
        id: action.id,
        autoCommitOnAccept: false,
      })));
    expect(decisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const acceptedIndex = decisions.findIndex((result) => result.status === 'fulfilled');
    const rejectedIndex = decisions.findIndex((result) => result.status === 'rejected');
    await expect(
      readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'),
    ).resolves.toContain(`hp: ${values[acceptedIndex]}`);
    await expect(readPendingAction({
      workspaceRoot,
      id: actions[acceptedIndex]!.id,
    })).resolves.toMatchObject({ status: 'accepted' });
    await expect(readPendingAction({
      workspaceRoot,
      id: actions[rejectedIndex]!.id,
    })).resolves.toMatchObject({ status: 'pending' });
    expect(
      (await readdir(join(workspaceRoot, 'state')))
        .filter((entry) => entry.startsWith('.oan-pa-')),
    ).toEqual([]);
    await expect(readDirectoryOrEmpty(join(
      workspaceRoot,
      '.workspace',
      'pending-action-transactions',
    ))).resolves.toEqual([]);
  });

  it('rolls back a journaled partial multi-file materialization before read', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const firstTarget = 'examples/references/reference-1/progress.yaml';
    const secondTarget = 'examples/references/reference-1/diagnostics.yaml';
    await mkdir(join(workspaceRoot, 'examples/references/reference-1'), {
      recursive: true,
    });
    const firstOriginal = 'version: 1\nstatus: notAnalyzed\n';
    const secondOriginal = 'version: 1\ndiagnostics: []\n';
    await writeFile(join(workspaceRoot, firstTarget), firstOriginal, 'utf-8');
    await writeFile(join(workspaceRoot, secondTarget), secondOriginal, 'utf-8');
    const action = await createPendingAction(workspaceRoot, {
      id: `pa_${'2'.repeat(64)}`,
      title: 'Recover partial reference publication',
      description: 'Recovery must restore the complete old bundle.',
      patches: [
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'progress.yaml',
          operation: 'replaceFile',
          value: 'version: 1\nstatus: completed\n',
        },
        {
          kind: 'referenceArtifact',
          referenceId: 'reference-1',
          file: 'diagnostics.yaml',
          operation: 'replaceFile',
          value: 'version: 1\ndiagnostics:\n  - published\n',
        },
      ],
    });
    const writes = await Promise.all(action.shadowWrites.map(async (shadow) => {
      const token = createHash('sha256')
        .update(`${action.id}\u0000${shadow.targetFile}`, 'utf-8')
        .digest('hex')
        .slice(0, 32);
      const parent = join(workspaceRoot, shadow.targetFile, '..');
      const stagePath = join(parent, `.oan-pa-${token}.stage`);
      const backupPath = join(parent, `.oan-pa-${token}.backup`);
      await writeFile(
        stagePath,
        await readFile(join(workspaceRoot, shadow.shadowFile), 'utf-8'),
        'utf-8',
      );
      return {
        targetFile: shadow.targetFile,
        stageFile: stagePath.slice(workspaceRoot.length + 1),
        backupFile: backupPath.slice(workspaceRoot.length + 1),
        originalHash: shadow.originalHash,
        draftHash: shadow.draftHash,
        targetExisted: true,
        stagePath,
        backupPath,
      };
    }));
    const journalRoot = join(
      workspaceRoot,
      '.workspace',
      'pending-action-transactions',
    );
    await mkdir(journalRoot, { recursive: true });
    await writeFile(
      join(journalRoot, `${action.id}.json`),
      `${JSON.stringify({
        version: 1,
        actionId: action.id,
        writes: writes.map(({
          stagePath: _stagePath,
          backupPath: _backupPath,
          ...write
        }) => write),
      }, null, 2)}\n`,
      'utf-8',
    );
    await rename(join(workspaceRoot, firstTarget), writes[0]!.backupPath);
    await rename(writes[0]!.stagePath, join(workspaceRoot, firstTarget));

    await expect(readPendingAction({ workspaceRoot, id: action.id }))
      .resolves.toMatchObject({ status: 'pending' });
    await expect(readFile(join(workspaceRoot, firstTarget), 'utf-8'))
      .resolves.toBe(firstOriginal);
    await expect(readFile(join(workspaceRoot, secondTarget), 'utf-8'))
      .resolves.toBe(secondOriginal);
    await expect(stat(join(journalRoot, `${action.id}.json`))).rejects.toThrow();
  });

  it.each([
    ['retained', false],
    ['missing', true],
  ] as const)(
    'finalizes an accepted transaction whose pending record is %s during list recovery',
    async (_pendingState, removePendingRecord) => {
      const workspaceRoot = await createTempNovelWorkspace();
      const action = await createPendingAction(workspaceRoot, {
        id: `pa_${removePendingRecord ? '5'.repeat(64) : '4'.repeat(64)}`,
        title: 'Recover accepted materialization',
        description: 'An accepted archive commits the complete draft bundle.',
        patches: [{
          kind: 'collection',
          domain: 'state',
          file: 'characters.yaml',
          operation: 'yamlSet',
          path: 'characters.heroine.hp',
          value: 'recovered-after-restart',
        }],
      });
      const writes = await simulatePendingActionMaterialization(
        workspaceRoot,
        action,
      );
      const acceptedRoot = join(
        workspaceRoot,
        '.workspace',
        'accepted-actions',
      );
      await mkdir(acceptedRoot, { recursive: true });
      await writeFile(
        join(acceptedRoot, `${action.id}.json`),
        `${JSON.stringify({
          ...action,
          status: 'accepted',
          acceptedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        'utf-8',
      );
      const pendingPath = join(
        workspaceRoot,
        '.workspace',
        'pending-actions',
        `${action.id}.json`,
      );
      if (removePendingRecord) await rm(pendingPath);

      await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
      await expect(
        readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'),
      ).resolves.toContain('hp: recovered-after-restart');
      await expect(readPendingAction({ workspaceRoot, id: action.id }))
        .resolves.toMatchObject({ status: 'accepted' });
      await expect(stat(pendingPath)).rejects.toThrow();
      await expect(stat(writes[0]!.backupPath!)).rejects.toThrow();
      await expect(stat(join(
        workspaceRoot,
        '.workspace',
        'pending-action-transactions',
        `${action.id}.json`,
      ))).rejects.toThrow();
    },
  );

  it('recovers an orphan shared-target transaction before accepting another action', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const orphan = await createPendingAction(workspaceRoot, {
      id: `pa_${'6'.repeat(64)}`,
      title: 'Interrupted shared target update',
      description: 'This materialization has no terminal archive.',
      patches: [{
        kind: 'collection',
        domain: 'state',
        file: 'characters.yaml',
        operation: 'yamlSet',
        path: 'characters.heroine.hp',
        value: 'orphan-draft',
      }],
    });
    const winner = await createPendingAction(workspaceRoot, {
      id: `pa_${'7'.repeat(64)}`,
      title: 'Next shared target update',
      description: 'Recovery must restore its baseline before preflight.',
      patches: [{
        kind: 'collection',
        domain: 'state',
        file: 'characters.yaml',
        operation: 'yamlSet',
        path: 'characters.heroine.hp',
        value: 'accepted-after-recovery',
      }],
    });
    await simulatePendingActionMaterialization(workspaceRoot, orphan);

    await expect(acceptPendingAction({
      workspaceRoot,
      id: winner.id,
      autoCommitOnAccept: false,
    })).resolves.toMatchObject({ status: 'accepted' });
    await expect(
      readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'),
    ).resolves.toContain('hp: accepted-after-recovery');
    await expect(readPendingAction({ workspaceRoot, id: orphan.id }))
      .resolves.toMatchObject({ status: 'pending' });
    expect(
      (await readdir(join(workspaceRoot, 'state')))
        .filter((entry) => entry.startsWith('.oan-pa-')),
    ).toEqual([]);
    await expect(readDirectoryOrEmpty(join(
      workspaceRoot,
      '.workspace',
      'pending-action-transactions',
    ))).resolves.toEqual([]);
  });

  it('fails closed when a target changes after preview', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'state.set', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    });
    const action = expectSinglePendingAction(result);
    const targetPath = join(workspaceRoot, 'state/characters.yaml');
    const externalEdit = `characters:\n  heroine:\n    hp: externally-edited\n`;
    await writeFile(targetPath, externalEdit, 'utf-8');

    await expect(
      acceptPendingAction({ workspaceRoot, id: action.id }),
    ).rejects.toThrow(/target changed since preview.*state\/characters\.yaml/);

    await expect(readFile(targetPath, 'utf-8')).resolves.toBe(externalEdit);
    await expect(listPendingActions({ workspaceRoot })).resolves.toMatchObject([
      { id: action.id, status: 'pending' },
    ]);
  });

  it('fails closed for legacy PendingActions without baseline metadata', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'state.set', {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    });
    const action = expectSinglePendingAction(result);
    const recordPath = join(
      workspaceRoot,
      '.workspace',
      'pending-actions',
      `${action.id}.json`,
    );
    const stored = JSON.parse(await readFile(recordPath, 'utf-8')) as {
      shadowWrites: Array<Record<string, unknown>>;
    };
    delete stored.shadowWrites[0].originalHash;
    delete stored.shadowWrites[0].draftHash;
    delete stored.shadowWrites[0].targetExisted;
    await writeFile(recordPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf-8');

    await expect(
      acceptPendingAction({ workspaceRoot, id: action.id }),
    ).rejects.toThrow(/Invalid PendingAction record/);
    await expect(
      readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'),
    ).resolves.toContain('hp: injured');
  });

  it('preflights every shadow before materializing any multi-file target', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const secondTarget = join(workspaceRoot, 'state/second.yaml');
    await writeFile(secondTarget, 'value: original\n', 'utf-8');
    const id = 'pa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const patches = [
      {
        kind: 'collection' as const,
        domain: 'state' as const,
        file: 'characters.yaml',
        operation: 'yamlSet' as const,
        path: 'characters.heroine.hp',
        value: 'recovering',
      },
      {
        kind: 'collection' as const,
        domain: 'state' as const,
        file: 'second.yaml',
        operation: 'yamlSet' as const,
        path: 'value',
        value: 'changed',
      },
    ];
    const preview = await previewSemanticPatches({ workspaceRoot, id, patches });
    await persistPendingAction(workspaceRoot, {
      id,
      title: 'Apply two files',
      description: 'Exercise full preflight.',
      patches,
      touchedFiles: preview.touchedFiles,
      diff: preview.diff,
      createdAt: new Date().toISOString(),
      status: 'pending',
      shadowWrites: preview.shadowWrites,
    });
    const firstTarget = join(workspaceRoot, 'state/characters.yaml');
    const firstBefore = await readFile(firstTarget, 'utf-8');
    await writeFile(
      join(workspaceRoot, preview.shadowWrites[1].shadowFile),
      'value: tampered\n',
      'utf-8',
    );

    await expect(
      acceptPendingAction({ workspaceRoot, id, autoCommitOnAccept: false }),
    ).rejects.toThrow(/shadow content changed since preview.*state\/second\.yaml/);
    await expect(readFile(firstTarget, 'utf-8')).resolves.toBe(firstBefore);
    await expect(readFile(secondTarget, 'utf-8')).resolves.toBe('value: original\n');
  });

  it.skipIf(cannotEnforceDirectoryPermissions)(
    'rolls back earlier targets when a later staged write fails',
    async () => {
      const workspaceRoot = await createTempNovelWorkspace();
      const lockedDirectory = join(workspaceRoot, 'state/locked');
      const lockedTarget = join(lockedDirectory, 'second.yaml');
      await mkdir(lockedDirectory, { recursive: true });
      await writeFile(lockedTarget, 'value: original\n', 'utf-8');
      const id = 'pa_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const patches = [
        {
          kind: 'collection' as const,
          domain: 'state' as const,
          file: 'characters.yaml',
          operation: 'yamlSet' as const,
          path: 'characters.heroine.hp',
          value: 'recovering',
        },
        {
          kind: 'collection' as const,
          domain: 'state' as const,
          file: 'locked/second.yaml',
          operation: 'yamlSet' as const,
          path: 'value',
          value: 'changed',
        },
      ];
      const preview = await previewSemanticPatches({ workspaceRoot, id, patches });
      const record = {
        id,
        title: 'Apply two files',
        description: 'Exercise multi-file rollback.',
        patches,
        touchedFiles: preview.touchedFiles,
        diff: preview.diff,
        createdAt: new Date().toISOString(),
        status: 'pending',
        shadowWrites: preview.shadowWrites,
      };
      await persistPendingAction(workspaceRoot, record);
      const firstBefore = await readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8');
      const secondBefore = await readFile(lockedTarget, 'utf-8');

      await chmod(lockedDirectory, 0o555);
      try {
        await expect(
          acceptPendingAction({ workspaceRoot, id, autoCommitOnAccept: false }),
        ).rejects.toThrow();
      } finally {
        await chmod(lockedDirectory, 0o755);
      }

      await expect(
        readFile(join(workspaceRoot, 'state/characters.yaml'), 'utf-8'),
      ).resolves.toBe(firstBefore);
      await expect(readFile(lockedTarget, 'utf-8')).resolves.toBe(secondBefore);
      await expect(listPendingActions({ workspaceRoot })).resolves.toMatchObject([
        { id, status: 'pending' },
      ]);
    },
  );

  it('rejects a PendingAction without writing the target and marks the shadow write rejected', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });
    const result = await executeTool(tools, 'timeline.add', {
      event: {
        id: 'event_002',
        chapter: '0001/0002',
        title: '拒绝的事件',
        description: '不应该写入真实文件。',
      },
    });
    const action = expectSinglePendingAction(result);
    const shadowFile = join(workspaceRoot, action.shadowWrites[0].shadowFile);

    const rejected = await rejectPendingAction({
      workspaceRoot,
      id: action.id,
    });

    expect(rejected).toMatchObject({
      id: action.id,
      status: 'rejected',
    });
    await expect(
      readFile(join(workspaceRoot, 'timeline/events.yaml'), 'utf-8'),
    ).resolves.not.toContain('拒绝的事件');
    await expect(stat(shadowFile)).rejects.toThrow();
    await expect(
      readFile(join(workspaceRoot, '.workspace', 'rejected-actions', `${action.id}.json`), 'utf-8'),
    ).resolves.toContain('"status": "rejected"');
    await expect(readPendingAction({ workspaceRoot, id: action.id }))
      .resolves.toMatchObject({
        id: action.id,
        status: 'rejected',
      });
  });

  it('creates all initial M6 write intent tools', () => {
    const tools = createWriteIntentTools({ workspaceRoot: '/tmp/unused' });

    expect(Object.keys(tools)).toEqual([
      'chapter.createDraft',
      'character.updatePersonality',
      'state.set',
      'timeline.add',
      'foreshadow.create',
      'summary.generateChapter',
    ]);
  });

  it('creates a chapter draft PendingAction and materializes it only on accept', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    const result = await executeTool(tools, 'chapter.createDraft', {
      chapterId: '0001/0001',
      title: '第一章',
      content: '她推开门，看见雨停在半空。',
    });
    const action = expectSinglePendingAction(result);

    expect(action).toMatchObject({
      title: 'Create chapter 0001/0001 draft',
      touchedFiles: ['chapters/0001/0001.md'],
      status: 'pending',
    });
    expect(action.diff).toContain('+# 第一章');
    await expect(
      readFile(join(workspaceRoot, 'chapters/0001/0001.md'), 'utf-8'),
    ).rejects.toThrow();

    await acceptPendingAction({ workspaceRoot, id: action.id });

    await expect(
      readFile(join(workspaceRoot, 'chapters/0001/0001.md'), 'utf-8'),
    ).resolves.toContain('她推开门');
  });

  it('uses the stable numbered chapter summary path by default', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    const result = await executeTool(tools, 'summary.generateChapter', {
      chapterId: '0001/0001',
      content: '# Chapter 0001\n\n新摘要。',
    });

    const action = expectSinglePendingAction(result);
    expect(action.touchedFiles).toEqual(['summaries/chapter/0001/0001.md']);
    expect(action.shadowWrites[0]).toMatchObject({
      targetFile: 'summaries/chapter/0001/0001.md',
    });
    await expect(
      readFile(join(workspaceRoot, 'summaries/chapter/0001/0001.md'), 'utf-8'),
    ).resolves.toContain('旧摘要');
    await expect(
      readFile(join(workspaceRoot, action.shadowWrites[0].shadowFile), 'utf-8'),
    ).resolves.toContain('新摘要');
  });

  it('blocks formal write tools from targeting hidden files or directories', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0001',
        file: '../.hidden.md',
        content: 'blocked',
      }),
    ).rejects.toThrow(/Invalid workspace relative path/);
  });

  it('rejects generating a chapter summary for volume metadata 0000', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0000',
        content: 'not a chapter',
      }),
    ).rejects.toThrow(/reserved for volume metadata/);
  });

  it('rejects chapter summary file overrides that target volume metadata 0000', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0001',
        file: 'chapter/0001/0000.md',
        content: 'not a chapter summary target',
      }),
    ).rejects.toThrow(/reserved for volume metadata/);
  });

  it('rejects chapter summary file overrides that do not match the chapter id', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'summary.generateChapter', {
        chapterId: '0001/0001',
        file: 'chapter/0001/0002.md',
        content: 'wrong chapter summary target',
      }),
    ).rejects.toThrow(/must match chapter id 0001\/0001/);
  });

  it('rejects shadow writes when internal .workspace points outside', async () => {
    const workspaceRoot = await createTempNovelWorkspace();
    const outsideRoot = await createTempRoot();
    await symlink(outsideRoot, join(workspaceRoot, '.workspace'));
    const tools = createWriteIntentTools({ workspaceRoot });

    await expect(
      executeTool(tools, 'state.set', {
        file: 'characters.yaml',
        path: 'characters.heroine.hp',
        value: 'blocked',
      }),
    ).rejects.toThrow(/outside the active workspace/);
    await expect(readdir(outsideRoot)).resolves.toEqual([]);
  });
});

interface TestPendingAction {
  id: string;
  title: string;
  touchedFiles: string[];
  diff: string;
  status: 'pending';
  shadowWrites: Array<{
    targetFile: string;
    shadowFile: string;
    originalHash: string;
    draftHash: string;
    targetExisted: boolean;
  }>;
}

interface SimulatedTransactionWrite {
  targetFile: string;
  stageFile: string;
  backupFile?: string;
  originalHash: string;
  draftHash: string;
  targetExisted: boolean;
  stagePath: string;
  backupPath?: string;
}

async function simulatePendingActionMaterialization(
  workspaceRoot: string,
  action: Pick<
    Awaited<ReturnType<typeof createPendingAction>>,
    'id' | 'shadowWrites'
  >,
): Promise<SimulatedTransactionWrite[]> {
  const writes = await Promise.all(action.shadowWrites.map(async (shadow) => {
    const token = createHash('sha256')
      .update(`${action.id}\u0000${shadow.targetFile}`, 'utf-8')
      .digest('hex')
      .slice(0, 32);
    const parent = join(workspaceRoot, shadow.targetFile, '..');
    const stagePath = join(parent, `.oan-pa-${token}.stage`);
    const backupPath = shadow.targetExisted
      ? join(parent, `.oan-pa-${token}.backup`)
      : undefined;
    await writeFile(
      stagePath,
      await readFile(join(workspaceRoot, shadow.shadowFile), 'utf-8'),
      'utf-8',
    );
    return {
      targetFile: shadow.targetFile,
      stageFile: stagePath.slice(workspaceRoot.length + 1),
      ...(backupPath
        ? { backupFile: backupPath.slice(workspaceRoot.length + 1) }
        : {}),
      originalHash: shadow.originalHash,
      draftHash: shadow.draftHash,
      targetExisted: shadow.targetExisted,
      stagePath,
      ...(backupPath ? { backupPath } : {}),
    };
  }));
  const journalRoot = join(
    workspaceRoot,
    '.workspace',
    'pending-action-transactions',
  );
  await mkdir(journalRoot, { recursive: true });
  await writeFile(
    join(journalRoot, `${action.id}.json`),
    `${JSON.stringify({
      version: 1,
      actionId: action.id,
      writes: writes.map(({
        stagePath: _stagePath,
        backupPath: _backupPath,
        ...write
      }) => write),
    }, null, 2)}\n`,
    'utf-8',
  );
  for (const write of writes) {
    const targetPath = join(workspaceRoot, write.targetFile);
    if (write.backupPath) await rename(targetPath, write.backupPath);
    await rename(write.stagePath, targetPath);
  }
  return writes;
}

async function readDirectoryOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function persistPendingAction(
  workspaceRoot: string,
  action: Record<string, unknown>,
): Promise<void> {
  const pendingDirectory = join(workspaceRoot, '.workspace/pending-actions');
  await mkdir(pendingDirectory, { recursive: true });
  await writeFile(
    join(pendingDirectory, `${String(action.id)}.json`),
    `${JSON.stringify(action, null, 2)}\n`,
    'utf-8',
  );
}

async function createTempNovelWorkspace(): Promise<string> {
  const root = await createTempRoot();

  await mkdir(join(root, 'characters/heroine'), { recursive: true });
  await mkdir(join(root, 'chapters/0001'), { recursive: true });
  await mkdir(join(root, 'state'), { recursive: true });
  await mkdir(join(root, 'timeline'), { recursive: true });
  await mkdir(join(root, 'foreshadow'), { recursive: true });
  await mkdir(join(root, 'summaries/chapter/0001'), { recursive: true });
  await writeFile(
    join(root, 'characters/heroine/personality.md'),
    `---
id: heroine
---

# 外在人格

冷淡克制。

# 内在人格

温柔但隐藏。
`,
    'utf-8',
  );
  await writeFile(
    join(root, 'state/characters.yaml'),
    `characters:
  heroine:
    hp: injured
`,
    'utf-8',
  );
  await writeFile(
    join(root, 'timeline/events.yaml'),
    `events:
  - id: event_001
    chapter: '0001/0001'
    title: 已有事件
    description: 已存在。
`,
    'utf-8',
  );
  await writeFile(join(root, 'foreshadow/active.yaml'), 'active: []\n', 'utf-8');
  await writeFile(
    join(root, 'summaries/chapter/0001/0001.md'),
    '# Chapter 0001\n\n旧摘要。\n',
    'utf-8',
  );

  return root;
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-write-intent-'));
  tempRoots.push(root);
  return root;
}

async function initGitRepo(workspaceRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: workspaceRoot });
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
}

async function git(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: workspaceRoot });
  return stdout;
}

async function executeTool(
  tools: ToolSet,
  name: string,
  args: unknown,
): Promise<unknown> {
  const executable = tools[name] as {
    execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
  };

  if (!executable?.execute) {
    throw new Error(`Tool ${name} is not executable.`);
  }

  return executable.execute(args, {});
}

function expectSinglePendingAction(result: unknown): TestPendingAction {
  expect(result).toMatchObject({
    pendingActions: [expect.any(Object)],
  });

  const action = (result as { pendingActions: TestPendingAction[] }).pendingActions[0];
  expect(action.shadowWrites).toHaveLength(1);
  return action;
}
