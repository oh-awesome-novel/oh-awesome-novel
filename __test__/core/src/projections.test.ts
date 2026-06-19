import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PROJECTION_TARGETS,
  PROJECTION_WARNING,
  buildWorkspaceProjectionDocuments,
  writeWorkspaceProjections,
} from '@oh-awesome-novel/core';

describe('workspace projections', () => {
  it('builds deterministic projection documents from canonical files', async () => {
    const workspaceRoot = await createProjectionWorkspace();

    try {
      const documents = await buildWorkspaceProjectionDocuments(workspaceRoot);
      const state = documents.find((document) => document.target === 'state');
      const progress = documents.find((document) => document.target === 'progress');

      expect(documents.map((document) => document.path)).toEqual([
        PROJECTION_TARGETS.state,
        PROJECTION_TARGETS.foreshadow,
        PROJECTION_TARGETS.timeline,
        PROJECTION_TARGETS.progress,
        PROJECTION_TARGETS.contextSnapshot,
      ]);
      expect(state?.content).toContain(PROJECTION_WARNING);
      expect(state?.content).toContain('heroine');
      expect(progress?.content).toContain('- chapters: 1');
      expect(progress?.content).toContain('- summaries: 1');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('can delete and rebuild projections with identical output', async () => {
    const workspaceRoot = await createProjectionWorkspace();

    try {
      await writeWorkspaceProjections(workspaceRoot);
      const first = await readFile(
        join(workspaceRoot, '.oan', 'indexes', 'state.md'),
        'utf-8',
      );

      await rm(join(workspaceRoot, '.oan', 'indexes'), { recursive: true, force: true });
      await writeWorkspaceProjections(workspaceRoot);
      const second = await readFile(
        join(workspaceRoot, '.oan', 'indexes', 'state.md'),
        'utf-8',
      );

      expect(second).toBe(first);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function createProjectionWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-projection-'));
  await mkdir(join(workspaceRoot, 'state'), { recursive: true });
  await mkdir(join(workspaceRoot, 'foreshadow'), { recursive: true });
  await mkdir(join(workspaceRoot, 'timeline'), { recursive: true });
  await mkdir(join(workspaceRoot, 'chapters', '0001'), { recursive: true });
  await mkdir(join(workspaceRoot, 'summaries', 'chapter', '0001'), { recursive: true });

  await writeFile(join(workspaceRoot, 'state', 'characters.yaml'), 'heroine:\n  hp: injured\n');
  await writeFile(join(workspaceRoot, 'foreshadow', 'active.yaml'), 'active:\n  - id: black_mark\n');
  await writeFile(join(workspaceRoot, 'timeline', 'events.yaml'), 'events:\n  - chapter: 0001/0001\n');
  await writeFile(join(workspaceRoot, 'chapters', '0001', '0001.md'), '# 第一章\n');
  await writeFile(join(workspaceRoot, 'summaries', 'chapter', '0001', '0001.md'), '# 摘要\n');

  return workspaceRoot;
}
