import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { streamNovelAgentCheckpointTurn } from '@oh-awesome-novel/agent';

const execFileAsync = promisify(execFile);

describe('checkpoint sandbox validation', () => {
  it('creates a real PendingAction from virtual bytes and leaves canon untouched', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-checkpoint-sandbox-'));
    const target = join(
      workspaceRoot,
      'chapters',
      '0001',
      '9999.md',
    );

    try {
      await writeFile(join(workspaceRoot, 'README.md'), '# Workspace\n', 'utf-8');
      await initGitRepo(workspaceRoot);
      const events = [];

      for await (const event of streamNovelAgentCheckpointTurn({
        workspaceRoot,
        request: 'Level 3 pending validation',
        level: 'level-3',
      })) {
        events.push(event);
      }

      const pending = events.find((event) => event.type === 'pending_action');
      expect(pending).toMatchObject({
        type: 'pending_action',
        pendingAction: {
          status: 'pending',
          changes: [{
            operation: 'create',
            path: 'chapters/0001/9999.md',
          }],
        },
      });
      await expect(readFile(target, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function initGitRepo(workspaceRoot: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: workspaceRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: workspaceRoot,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], {
    cwd: workspaceRoot,
  });
  await execFileAsync('git', ['add', '.'], { cwd: workspaceRoot });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot });
}
