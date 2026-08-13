import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertRepositoryBaseline,
  readRepositoryBaseline,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('repository baseline', () => {
  it('fixes repository identity, branch and HEAD and rejects drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-repository-baseline-'));
    tempRoots.push(root);
    await mkdir(join(root, 'state'), { recursive: true });
    await writeFile(join(root, 'state', 'value.yaml'), 'value: one\n', 'utf8');
    await git(root, 'init', '-b', 'main');
    await git(root, 'config', 'user.name', 'OAN Test');
    await git(root, 'config', 'user.email', 'oan@example.test');
    await git(root, 'add', '--', 'state/value.yaml');
    await git(root, 'commit', '-m', 'initial');

    const baseline = await readRepositoryBaseline(root);
    expect(baseline).toMatchObject({ branch: 'main' });
    expect(baseline.repositoryId).toMatch(/^[0-9a-f]{64}$/u);
    await expect(assertRepositoryBaseline(root, baseline)).resolves.toBeUndefined();

    await writeFile(join(root, 'state', 'value.yaml'), 'value: two\n', 'utf8');
    await git(root, 'add', '--', 'state/value.yaml');
    await git(root, 'commit', '-m', 'second');
    await expect(assertRepositoryBaseline(root, baseline)).rejects.toMatchObject({
      code: 'STALE_REPOSITORY_BASELINE',
    });
  });
});

async function git(root: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args]);
}
