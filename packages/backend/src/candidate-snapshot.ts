import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, relative, sep } from 'node:path';

import {
  fingerprintFileSnapshots,
  normalizeWorkspaceRelativePath,
} from '@oh-awesome-novel/tools';
import type { CandidateFileSnapshot } from '@oh-awesome-novel/tools';

export async function readCandidateTargetSnapshots(
  workspaceRoot: string,
  rawPaths: readonly string[],
): Promise<CandidateFileSnapshot[]> {
  const root = await realpath(workspaceRoot);
  const paths = [...new Set(rawPaths.map(normalizeWorkspaceRelativePath))]
    .sort(compareText);
  if (paths.length !== rawPaths.length) {
    throw new Error('Candidate target paths must be unique.');
  }
  const snapshots: CandidateFileSnapshot[] = [];
  for (const path of paths) {
    const target = resolve(root, ...path.split('/'));
    assertInside(root, target);
    let information: Awaited<ReturnType<typeof lstat>>;
    try {
      information = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (information.isSymbolicLink() || !information.isFile() || information.nlink > 1) {
      throw new Error(`Candidate target is not a private regular file: ${path}.`);
    }
    const actual = await realpath(target);
    assertInside(root, actual);
    const bytes = await readFile(actual);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (content.includes('\0')) throw new Error(`Candidate target contains NUL: ${path}.`);
    snapshots.push({ path, content, mode: information.mode & 0o777 });
  }
  return snapshots;
}

export function fingerprintCandidateProjection(
  snapshots: readonly CandidateFileSnapshot[],
): string {
  return fingerprintFileSnapshots(snapshots);
}

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))) {
    return;
  }
  throw new Error('Candidate target escaped the workspace.');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
