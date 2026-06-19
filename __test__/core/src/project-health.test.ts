import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  formatProjectHealthMarkdown,
  readProjectHealth,
} from '@oh-awesome-novel/core';

describe('project health', () => {
  it('reports read-only health warnings without writing files', async () => {
    const workspaceRoot = await createHealthWorkspace();

    try {
      const health = await readProjectHealth(workspaceRoot, {
        generatedAt: '2026-06-19T00:00:00.000Z',
        pendingActionCount: 2,
      });

      expect(health.activeHookCount).toBe(1);
      expect(health.pendingActionCount).toBe(2);
      expect(health.missingCharacterCards).toEqual(['heroine']);
      expect(health.chaptersWithoutSummaries).toEqual(['0001/0002']);
      expect(health.latestStateStale).toBe(true);
      expect(health.timelineGapCount).toBe(1);
      expect(health.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'pending-actions' }),
          expect.objectContaining({ id: 'timeline-gap:0001/0002' }),
        ]),
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('formats a concise project health report', async () => {
    const workspaceRoot = await createHealthWorkspace();

    try {
      const health = await readProjectHealth(workspaceRoot, {
        generatedAt: '2026-06-19T00:00:00.000Z',
      });
      const markdown = formatProjectHealthMarkdown(health);

      expect(markdown).toContain('## Project Health');
      expect(markdown).toContain('missing character cards: 1');
      expect(markdown).toContain('latest state stale: yes');
      expect(markdown).toContain('[warning] Chapter has no summary');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function createHealthWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oan-health-'));
  await mkdir(join(workspaceRoot, 'characters', 'heroine'), { recursive: true });
  await mkdir(join(workspaceRoot, 'chapters', '0001'), { recursive: true });
  await mkdir(join(workspaceRoot, 'summaries', 'chapter', '0001'), { recursive: true });
  await mkdir(join(workspaceRoot, 'foreshadow'), { recursive: true });
  await mkdir(join(workspaceRoot, 'timeline'), { recursive: true });

  await writeFile(join(workspaceRoot, 'characters', 'heroine', 'meta.yaml'), 'id: heroine\n');
  await writeFile(join(workspaceRoot, 'chapters', '0001', '0001.md'), '# 第一章\n');
  await writeFile(join(workspaceRoot, 'chapters', '0001', '0002.md'), '# 第二章\n');
  await writeFile(join(workspaceRoot, 'summaries', 'chapter', '0001', '0001.md'), '# 第一章摘要\n');
  await writeFile(join(workspaceRoot, 'foreshadow', 'active.yaml'), 'active:\n  - id: black_mark\n');
  await writeFile(join(workspaceRoot, 'timeline', 'events.yaml'), 'events:\n  - chapter: 0001/0001\n');

  return workspaceRoot;
}
