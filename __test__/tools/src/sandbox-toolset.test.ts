import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  OAN_COMMAND_ALLOWLIST,
  createPendingActionStore,
  createSandboxBashToolPrompt,
  createSandboxEditSession,
  createWorkspaceChangePolicy,
} from '@oh-awesome-novel/tools';
import type { ToolSet } from 'ai';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('sandbox AI SDK toolset', () => {
  it('uses a host-owned allowlist prompt and excludes disabled commands', () => {
    const prompt = createSandboxBashToolPrompt({
      capability: 'summary.edit',
      fileCount: 2,
      totalBytes: 48,
    });

    expect(prompt).toContain(`Available commands: ${OAN_COMMAND_ALLOWLIST.join(', ')}`);
    expect(prompt).toContain('Capability: summary.edit');
    expect(OAN_COMMAND_ALLOWLIST).not.toContain('curl');
    expect(OAN_COMMAND_ALLOWLIST).not.toContain('python');
    expect(OAN_COMMAND_ALLOWLIST).not.toContain('js-exec');
    expect(OAN_COMMAND_ALLOWLIST).not.toContain('ln');
    expect(OAN_COMMAND_ALLOWLIST).not.toContain('chmod');
  });

  it('exposes bounded OAN file tools instead of bash-tool default file tools', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nalpha\nbeta\ngamma\n',
    });
    const policy = createWorkspaceChangePolicy({ capability: 'summary.edit' });
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy,
      repositoryReader: fakeRepository,
      limits: { maxReadBytes: 16 },
    });

    expect(Object.keys(session.tools)).toEqual(expect.arrayContaining([
      'bash',
      'readFile',
      'writeFile',
      'workspace.previewChanges',
      'summary.get',
    ]));
    expect(session.tools['workspace.proposeChanges']).toBeUndefined();

    const read = await executeTool(session.tools, 'readFile', {
      path: 'summaries/global.md',
      startLine: 4,
      endLine: 5,
      maxBytes: 10,
    });
    expect(read).toMatchObject({
      content: 'beta\ngamma',
      startLine: 4,
      endLine: 5,
      totalLines: 6,
      truncated: true,
    });
    await expect(executeTool(session.tools, 'readFile', {
      path: 'summaries/global.md',
      maxBytes: 17,
    })).rejects.toThrow('cannot exceed 16');

    await executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# Global\n\nchanged\n',
    });
    await expect(readFile(join(workspaceRoot, 'summaries/global.md'), 'utf8'))
      .resolves.toContain('alpha');
    await session.dispose();
  });

  it('keeps network, host runtimes and internal paths inaccessible', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nalpha\n',
      '.workspace/secret.txt': 'secret\n',
    });
    const session = await createSandboxEditSession({
      workspaceRoot,
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
    });

    for (const command of [
      'curl https://example.com',
      'python -c "print(1)"',
      'js-exec "1+1"',
      'ln -s summaries/global.md summaries/link.md',
    ]) {
      await expect(executeTool(session.tools, 'bash', { command })).resolves.toMatchObject({
        exitCode: 127,
      });
    }
    await expect(executeTool(session.tools, 'bash', {
      command: 'cat .workspace/secret.txt',
    })).resolves.toMatchObject({ exitCode: 1 });
    await session.dispose();
  });

  it('executes workspace.proposeChanges exactly once and seals canonical-safe edits', async () => {
    const workspaceRoot = await tempWorkspace({
      'summaries/global.md': '# Global\n\nold\n',
    });
    const store = await createPendingActionStore({
      workspaceRoot,
      repositoryValidator: async () => undefined,
      idFactory: () => 'pa-explicit-proposal',
    });
    const session = await createSandboxEditSession({
      workspaceRoot,
      sessionId: 'explicit-proposal-session',
      policy: createWorkspaceChangePolicy({ capability: 'summary.edit' }),
      repositoryReader: fakeRepository,
      pendingActionStore: store,
    });

    expect(session.tools['workspace.proposeChanges']).toBeDefined();
    await executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# Global\n\nexplicit candidate\n',
    });
    await expect(executeTool(session.tools, 'workspace.previewChanges', {}))
      .resolves.toMatchObject({
        changes: [{ operation: 'update', path: 'summaries/global.md' }],
      });

    const proposed = await executeTool(session.tools, 'workspace.proposeChanges', {
      title: 'Review explicit summary edit',
      description: 'The model explicitly sealed its virtual summary edit.',
    });
    const repeated = await executeTool(session.tools, 'workspace.proposeChanges', {
      title: 'Ignored duplicate title',
      description: 'The already sealed proposal is returned unchanged.',
    });

    expect(repeated).toEqual(proposed);
    expect(proposed).toMatchObject({
      noChanges: false,
      pendingActions: [{
        id: 'pa-explicit-proposal',
        status: 'pending',
        changes: [{ operation: 'update', path: 'summaries/global.md' }],
      }],
    });
    expect(JSON.stringify(proposed)).not.toContain('relativePath');
    expect((await store.readAction('pa-explicit-proposal')).source).toMatchObject({
      kind: 'bash-session',
      finalization: 'explicit-tool',
    });
    expect(await store.listViews({ status: 'pending' })).toHaveLength(1);
    await expect(executeTool(session.tools, 'writeFile', {
      path: 'summaries/global.md',
      content: '# Global\n\nlate mutation\n',
    })).rejects.toThrow('sealed');
    await expect(readFile(join(workspaceRoot, 'summaries/global.md'), 'utf8'))
      .resolves.toBe('# Global\n\nold\n');
    await session.dispose();
  });
});

async function tempWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-sandbox-tools-'));
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

async function executeTool(tools: ToolSet, name: string, args: unknown): Promise<any> {
  const executable = tools[name] as {
    execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
  };
  if (!executable?.execute) throw new Error(`Tool ${name} is not executable.`);
  return executable.execute(args, {});
}
