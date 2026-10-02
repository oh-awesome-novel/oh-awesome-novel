import { chmod, lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSandboxEditSession,
  createWorkspaceChangePolicy,
  sanitizeSandboxText,
} from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('SandboxEditSession', () => {
  it.each([0o600, 0o666])('preserves projected permissions after a shell redirect (%s)', async (mode) => {
    const path = 'summaries/global.md';
    const workspaceRoot = await tempWorkspace({ [path]: '# Global\n\nbefore\n' });
    const canonical = join(workspaceRoot, path);
    await chmod(canonical, mode);
    const canonicalMode = (await lstat(canonical)).mode & 0o777;
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
    });
    try {
      await executeTool(session.tools, 'bash', {
        command: "printf '# Global\\n\\nafter\\n' > summaries/global.md",
      });
      const candidate = await session.finalizeCandidate({ finalization: 'runtime-fallback' });
      expect(candidate?.changes).toMatchObject([
        { operation: 'update', path, baseline: { mode: canonicalMode } },
      ]);
      expect(await readFile(canonical, 'utf8')).toBe('# Global\n\nbefore\n');
      expect((await lstat(canonical)).mode & 0o777).toBe(canonicalMode);
    } finally {
      await session.dispose();
    }
  });

  it('shares virtual state across calls and finalizes exact create/update/delete once', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
      'summaries/delete.md': '# Delete\n\nold\n',
    });
    const canonicalBefore = await readFile(join(workspaceRoot, 'summaries/global.md'), 'utf8');
    const session = await createSandboxEditSession({
      workspaceRoot,
      sessionId: 'session-one',
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
      now: increasingClock(),
    });

    await executeTool(session.tools, 'bash', {
      command: "printf '# Global\\n\\nnew\\n' > summaries/global.md && rm summaries/delete.md",
    });
    await executeTool(session.tools, 'writeFile', {
      path: 'summaries/created.md',
      content: '# Created\n\n中文\n',
    });
    expect(session.isDirty()).toBe(true);

    const firstPreview = await session.preview();
    const secondPreview = await session.preview();
    expect(secondPreview).toBe(firstPreview);
    expect(firstPreview.changes.map((change) => [change.operation, change.path])).toEqual([
      ['create', 'summaries/created.md'],
      ['delete', 'summaries/delete.md'],
      ['update', 'summaries/global.md'],
    ]);
    expect(firstPreview.diffExcerpt).toContain('diff --git a/summaries/global.md');
    expect(await readFile(join(workspaceRoot, 'summaries/global.md'), 'utf8'))
      .toBe(canonicalBefore);

    const candidate = await session.finalizeCandidate({ finalization: 'runtime-fallback' });
    expect(candidate?.source).toMatchObject({
      kind: 'bash-session',
      capability: 'summary.edit',
      finalization: 'runtime-fallback',
      commandCount: 1,
    });
    expect(session.isSealed()).toBe(true);
    await expect(session.finalizeCandidate({ finalization: 'runtime-fallback' }))
      .rejects.toThrow('already finalized');
    await expect(executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# No\n',
    })).rejects.toThrow('sealed');
    await session.dispose();
  });

  it('eliminates change-then-revert and clean sessions', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
    });
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
    });
    await executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# Global\n\nchanged\n',
    });
    await executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# Global\n\nold\n',
    });

    await expect(session.preview()).resolves.toMatchObject({ changes: [] });
    await expect(session.finalizeCandidate({ finalization: 'runtime-fallback' }))
      .resolves.toBeUndefined();
    await session.dispose();
  });

  it('detects host projection drift before preview/finalization without mixing bytes', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
    });
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
    });
    await executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# Global\n\ncandidate\n',
    });
    await writeFile(join(workspaceRoot, 'summaries/global.md'), '# Global\n\ndrift\n', 'utf8');

    const projected = await executeTool(session.tools, 'readFile', {
      path: 'summaries/global.md',
    });
    expect(projected.content).toContain('candidate');
    expect(projected.content).not.toContain('drift');
    await expect(session.preview()).rejects.toMatchObject({
      code: 'WORKSPACE_PROJECTION_STALE',
    });
    await session.dispose();
  });

  it('rechecks trusted external sources before an explicit proposal is persisted', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
    });
    const proposeCandidate = vi.fn();
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
      pendingActionStore: { proposeCandidate } as never,
      freshnessChecks: [async () => {
        throw Object.assign(new Error('external source drifted'), {
          code: 'WORKSPACE_PROJECTION_STALE',
        });
      }],
    });
    await executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# Global\n\ncandidate\n',
    });

    await expect(executeTool(session.tools, 'workspace.proposeChanges', {
      title: 'Review summary',
      description: 'External source must still match.',
    })).rejects.toMatchObject({ code: 'WORKSPACE_PROJECTION_STALE' });
    expect(proposeCandidate).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('applies cumulative command/source/output budgets and bounded sanitized audit', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
    });
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
      limits: {
        maxBashCalls: 1,
        maxTotalSourceBytes: 512,
        maxTotalOutputBytes: 32,
        maxAuditPreviewBytes: 12,
        maxAuditTotalBytes: 12,
      },
    });
    await executeTool(session.tools, 'bash', {
      command: "printf '\\033[31mhello\\033[0m\\n'",
    });
    await expect(executeTool(session.tools, 'bash', { command: 'true' }))
      .rejects.toMatchObject({ code: 'SANDBOX_RESOURCE_LIMIT_EXCEEDED' });
    const audit = session.commandAudit();
    expect(audit.commandCount).toBe(1);
    expect(audit.commandLogHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.byteLength(audit.entries[0]!.commandPreview, 'utf8')).toBeLessThanOrEqual(12);
    expect(audit.entries[0]!.commandPreview).not.toContain('\u001b');
    await expect(session.preview()).rejects.toMatchObject({
      code: 'SANDBOX_RESOURCE_LIMIT_EXCEEDED',
    });
    await session.dispose();
  });

  it('uses a monotonic clock and poisons the session when cumulative wall time is exceeded', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
    });
    const ticks = [100, 106, 106, 111];
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
      monotonicNow: () => ticks.shift() ?? 111,
      limits: { maxTotalWallTimeMs: 10 },
    });

    await executeTool(session.tools, 'bash', { command: 'true' });
    await expect(executeTool(session.tools, 'bash', { command: 'true' }))
      .rejects.toMatchObject({ code: 'SANDBOX_RESOURCE_LIMIT_EXCEEDED' });
    expect(session.commandAudit()).toMatchObject({
      bashCalls: 2,
      totalWallTimeMs: 11,
    });
    await expect(session.preview()).rejects.toMatchObject({
      code: 'SANDBOX_RESOURCE_LIMIT_EXCEEDED',
    });
    await session.dispose();
  });

  it('propagates abort and makes disposed sessions unusable', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
    });
    const controller = new AbortController();
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
      abortSignal: controller.signal,
    });
    controller.abort(new Error('stop now'));
    await expect(session.preview()).rejects.toThrow('stop now');
    await session.dispose();
    await expect(session.preview()).rejects.toThrow('disposed');
  });

  it('sanitizes ANSI/control data but preserves safe Unicode and newlines', () => {
    expect(sanitizeSandboxText('\u001b[31m红\u001b[0m\u0001\n')).toBe('红\\u0001\n');
  });
});

async function tempWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-edit-session-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content, 'utf8');
  }
  return root;
}

async function fakeRepository() {
  return {
    repositoryId: 'r'.repeat(64),
    branch: 'main',
    head: 'h'.repeat(40),
  };
}

function increasingClock(): () => Date {
  let milliseconds = Date.parse('2026-08-12T00:00:00.000Z');
  return () => new Date(milliseconds++);
}

async function executeTool(tools: ToolSet, name: string, args: unknown): Promise<any> {
  const executable = tools[name];
  if (!executable?.execute) throw new Error(`Tool ${name} is not executable.`);
  return executable.execute(args as never, {
    toolCallId: `test-${name}`, messages: [], context: undefined,
  });
}
