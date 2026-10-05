import process from 'node:process';

/** Windows chmod/stat represent the read-only attribute through owner-write;
 * they cannot represent POSIX owner/group/other or executable permissions. */
export function hostFileModesMatch(actual: number, expected: number): boolean {
  const mask = process.platform === 'win32' ? 0o200 : 0o777;
  return (actual & mask) === (expected & mask);
}

/** Git trees store only the executable bit, never POSIX access permissions.
 * A filesystem without executable modes must preserve Git's recorded mode. */
export function gitFileModesMatch(hostMode: number, gitMode: number, fileMode: boolean): boolean {
  return !fileMode || process.platform === 'win32'
    || Boolean(hostMode & 0o100) === Boolean(gitMode & 0o100);
}
