import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listPendingActions,
  prepareWriteIntentPreview,
  promoteWriteIntentPreview,
  validateWriteIntentPreview,
  WRITE_INTENT_PREVIEW_SCHEMA_VERSION,
} from '@oh-awesome-novel/tools';
import type {
  PreparedWriteIntentPreview,
} from '@oh-awesome-novel/tools';

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('write-intent prepared preview promotion seam', () => {
  it.each([
    {
      toolName: 'chapter.createDraft' as const,
      args: {
        chapterId: '0001/0002',
        title: '第二章',
        content: '雨停在门外。',
      },
      targetFile: 'chapters/0001/0002.md',
      patch: { kind: 'narrative', domain: 'chapter', operation: 'replaceFile' },
      shadowText: '# 第二章',
    },
    {
      toolName: 'state.set' as const,
      args: {
        file: 'characters.yaml',
        path: 'characters.heroine.hp',
        value: 'recovering',
      },
      targetFile: 'state/characters.yaml',
      patch: { kind: 'collection', domain: 'state', operation: 'yamlSet' },
      shadowText: 'hp: recovering',
    },
    {
      toolName: 'timeline.add' as const,
      args: {
        event: {
          id: 'event_002',
          chapter: '0001/0002',
          title: '雨停',
          description: '雨在第二章停下。',
        },
      },
      targetFile: 'timeline/events.yaml',
      patch: { kind: 'collection', domain: 'timeline', operation: 'yamlAppend' },
      shadowText: 'id: event_002',
    },
    {
      toolName: 'foreshadow.create' as const,
      args: {
        item: {
          id: 'rain_stops',
          title: '停雨伏笔',
          status: 'active',
        },
      },
      targetFile: 'foreshadow/active.yaml',
      patch: { kind: 'collection', domain: 'foreshadow', operation: 'yamlAppend' },
      shadowText: 'id: rain_stops',
    },
  ])(
    'prepares and promotes $toolName without touching $targetFile',
    async ({ toolName, args, targetFile, patch, shadowText }) => {
      const workspaceRoot = await createWorkspace();
      const targetPath = join(workspaceRoot, targetFile);
      const before = await readOptionalFile(targetPath);

      const preview = await prepareWriteIntentPreview({
        workspaceRoot,
        toolName,
        args,
      });

      expect(preview).toMatchObject({
        schemaVersion: WRITE_INTENT_PREVIEW_SCHEMA_VERSION,
        id: expect.stringMatching(/^pa_[0-9a-f-]+$/i),
        toolName,
        patches: [patch],
        touchedFiles: [targetFile],
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(preview.diff).toContain(`b/${targetFile}`);
      expect(preview.shadowWrites).toHaveLength(1);
      await expect(
        readFile(join(workspaceRoot, preview.shadowWrites[0]!.shadowFile), 'utf-8'),
      ).resolves.toContain(shadowText);
      await expect(readOptionalFile(targetPath)).resolves.toBe(before);
      await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
      await expect(readPreparedManifest(workspaceRoot, preview)).resolves.toMatchObject({
        id: preview.id,
        toolName,
        fingerprint: preview.fingerprint,
      });

      await expect(
        validateWriteIntentPreview({ workspaceRoot, preview }),
      ).resolves.toBeUndefined();
      await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);

      const action = await promoteWriteIntentPreview({ workspaceRoot, preview });
      expect(action).toMatchObject({
        id: preview.id,
        title: preview.title,
        description: preview.description,
        patches: preview.patches,
        touchedFiles: [targetFile],
        diff: preview.diff,
        status: 'pending',
        shadowWrites: preview.shadowWrites,
      });
      await expect(readOptionalFile(targetPath)).resolves.toBe(before);
      await expect(listPendingActions({ workspaceRoot })).resolves.toMatchObject([
        { id: preview.id, touchedFiles: [targetFile], status: 'pending' },
      ]);
    },
  );

  it('rejects promotion after the canonical target drifts and creates no PendingAction', async () => {
    const workspaceRoot = await createWorkspace();
    const preview = await prepareStatePreview(workspaceRoot);
    const targetPath = join(workspaceRoot, 'state/characters.yaml');
    const external = 'characters:\n  heroine:\n    hp: externally-edited\n';
    await writeFile(targetPath, external, 'utf-8');

    await expect(validateWriteIntentPreview({ workspaceRoot, preview }))
      .rejects.toThrow(/target changed since preview.*state\/characters\.yaml/);
    await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
    await expect(promoteWriteIntentPreview({ workspaceRoot, preview }))
      .rejects.toThrow(/target changed since preview.*state\/characters\.yaml/);
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe(external);
    await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
  });

  it('rejects promotion after shadow content is tampered and keeps canonical truth intact', async () => {
    const workspaceRoot = await createWorkspace();
    const preview = await prepareStatePreview(workspaceRoot);
    const targetPath = join(workspaceRoot, 'state/characters.yaml');
    const before = await readFile(targetPath, 'utf-8');
    await writeFile(
      join(workspaceRoot, preview.shadowWrites[0]!.shadowFile),
      'characters:\n  heroine:\n    hp: forged\n',
      'utf-8',
    );

    await expect(promoteWriteIntentPreview({ workspaceRoot, preview }))
      .rejects.toThrow(/shadow content changed since preview.*state\/characters\.yaml/);
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe(before);
    await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
  });

  it.each([
    {
      name: 'tool identity',
      mutate(preview: PreparedWriteIntentPreview) {
        preview.toolName = 'timeline.add';
      },
    },
    {
      name: 'normalized arguments',
      mutate(preview: PreparedWriteIntentPreview) {
        preview.args.value = 'forged';
      },
    },
    {
      name: 'SemanticPatch',
      mutate(preview: PreparedWriteIntentPreview) {
        (preview.patches[0] as { value?: unknown }).value = 'forged';
      },
    },
  ])('rejects a tampered $name fingerprint', async ({ mutate }) => {
    const workspaceRoot = await createWorkspace();
    const preview = await prepareStatePreview(workspaceRoot);
    mutate(preview);

    await expect(promoteWriteIntentPreview({ workspaceRoot, preview }))
      .rejects.toThrow(/fingerprint is invalid/);
    await expect(listPendingActions({ workspaceRoot })).resolves.toEqual([]);
  });

  it('rejects duplicate promotion instead of overwriting the existing action', async () => {
    const workspaceRoot = await createWorkspace();
    const preview = await prepareStatePreview(workspaceRoot);
    const first = await promoteWriteIntentPreview({ workspaceRoot, preview });
    const storedBefore = await readFile(
      join(workspaceRoot, '.workspace', 'pending-actions', `${preview.id}.json`),
      'utf-8',
    );

    await expect(promoteWriteIntentPreview({ workspaceRoot, preview }))
      .rejects.toThrow(/already promoted/);
    await expect(listPendingActions({ workspaceRoot })).resolves.toMatchObject([
      { id: first.id, status: 'pending' },
    ]);
    await expect(readFile(
      join(workspaceRoot, '.workspace', 'pending-actions', `${preview.id}.json`),
      'utf-8',
    )).resolves.toBe(storedBefore);
  });
});

async function prepareStatePreview(
  workspaceRoot: string,
): Promise<PreparedWriteIntentPreview> {
  return prepareWriteIntentPreview({
    workspaceRoot,
    toolName: 'state.set',
    args: {
      file: 'characters.yaml',
      path: 'characters.heroine.hp',
      value: 'recovering',
    },
  });
}

async function readPreparedManifest(
  workspaceRoot: string,
  preview: PreparedWriteIntentPreview,
): Promise<Record<string, unknown>> {
  const actionDirectory = dirname(preview.shadowWrites[0]!.shadowFile);
  const entries = await readdir(join(workspaceRoot, actionDirectory));
  expect(entries).toContain('prepared-preview.json');
  return JSON.parse(await readFile(
    join(workspaceRoot, actionDirectory, 'prepared-preview.json'),
    'utf-8',
  )) as Record<string, unknown>;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
}

async function createWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-write-preview-'));
  tempRoots.push(workspaceRoot);
  await writeFileTree(workspaceRoot, {
    'state/characters.yaml': 'characters:\n  heroine:\n    hp: injured\n',
    'timeline/events.yaml': [
      'events:',
      '  - id: event_001',
      "    chapter: '0001/0001'",
      '    title: 雨夜',
      '    description: 雨仍在下。',
      '',
    ].join('\n'),
    'foreshadow/active.yaml': 'active: []\n',
  });
  return workspaceRoot;
}

async function writeFileTree(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(Object.entries(files).map(async ([file, content]) => {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }));
}
