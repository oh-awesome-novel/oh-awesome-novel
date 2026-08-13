import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readStoredPlayAdoptionPreview } from '../../../packages/backend/src/play-adoption-preview.js';
import { readStoredReferenceMaterialAdoptionPreview } from '../../../packages/backend/src/reference-material-adoption-preview.js';

const PREVIEW_ID = 'pa_00000000-0000-4000-8000-000000000001';
const cleanupRoots: string[] = [];

const stores = [
  {
    label: 'Play adoption',
    directory: 'play-adoption-previews',
    read: readStoredPlayAdoptionPreview,
    rootError: 'Play adoption preview root is not a private directory.',
    recordError: `Play adoption preview record is not a regular file: ${PREVIEW_ID}.`,
  },
  {
    label: 'Reference Material adoption',
    directory: 'reference-material-adoption-previews',
    read: readStoredReferenceMaterialAdoptionPreview,
    rootError: 'Reference Material adoption preview root is not a private directory.',
    recordError: `Reference Material adoption preview record is invalid: ${PREVIEW_ID}.`,
  },
] as const;

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })));
});

describe.each(stores)('$label domain preview storage', (store) => {
  it('rejects a symlinked storage root before reading outside the workspace', async () => {
    const workspaceRoot = await createTemporaryRoot('oan-domain-preview-workspace-');
    const outsideRoot = await createTemporaryRoot('oan-domain-preview-outside-');
    const recordRoot = previewRecordRoot(workspaceRoot, store.directory);
    await mkdir(dirname(recordRoot), { recursive: true });
    await symlink(outsideRoot, recordRoot, 'dir');

    await expect(store.read(workspaceRoot, PREVIEW_ID)).rejects.toThrow(store.rootError);
    await expect(readdir(outsideRoot)).resolves.toEqual([]);
  });

  it('rejects a symlink record that points outside the workspace', async () => {
    const workspaceRoot = await createTemporaryRoot('oan-domain-preview-workspace-');
    const outsideRoot = await createTemporaryRoot('oan-domain-preview-outside-');
    const recordPath = previewRecordPath(workspaceRoot, store.directory);
    const outsideRecord = join(outsideRoot, `${PREVIEW_ID}.json`);
    await mkdir(dirname(recordPath), { recursive: true });
    await writeFile(outsideRecord, '{}\n', 'utf8');
    await symlink(outsideRecord, recordPath, 'file');

    await expect(store.read(workspaceRoot, PREVIEW_ID)).rejects.toThrow(store.recordError);
    await expect(readFile(outsideRecord, 'utf8')).resolves.toBe('{}\n');
  });

  it('rejects a hardlink record before parsing bytes shared outside the workspace', async () => {
    const workspaceRoot = await createTemporaryRoot('oan-domain-preview-workspace-');
    const outsideRoot = await createTemporaryRoot('oan-domain-preview-outside-');
    const recordPath = previewRecordPath(workspaceRoot, store.directory);
    const outsideRecord = join(outsideRoot, `${PREVIEW_ID}.json`);
    await mkdir(dirname(recordPath), { recursive: true });
    await writeFile(recordPath, '{}\n', { encoding: 'utf8', mode: 0o600 });
    await link(recordPath, outsideRecord);

    await expect(lstat(recordPath)).resolves.toMatchObject({ nlink: 2 });
    await expect(store.read(workspaceRoot, PREVIEW_ID)).rejects.toThrow(store.recordError);
    await expect(readFile(outsideRecord, 'utf8')).resolves.toBe('{}\n');
  });
});

async function createTemporaryRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanupRoots.push(path);
  return path;
}

function previewRecordRoot(workspaceRoot: string, directory: string): string {
  return join(
    workspaceRoot,
    '.workspace',
    'change-engine',
    'v1',
    'domain',
    directory,
  );
}

function previewRecordPath(workspaceRoot: string, directory: string): string {
  return join(previewRecordRoot(workspaceRoot, directory), `${PREVIEW_ID}.json`);
}
