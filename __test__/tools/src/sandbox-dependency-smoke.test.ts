import { createBashTool } from 'bash-tool';
import { createPatch } from 'diff';
import { Bash, InMemoryFs } from 'just-bash';
import { describe, expect, it } from 'vitest';

import type { ToolSet } from 'ai';

describe('sandbox dependency smoke', () => {
  it('runs AI SDK 6 tools against a network-disabled in-memory Bash', async () => {
    const fs = new InMemoryFs({
      '/workspace/input.txt': 'hello\n',
    }, {
      maxTotalBytes: 1024 * 1024,
    });
    const bash = new Bash({
      fs,
      cwd: '/workspace',
      commands: ['cat', 'echo', 'printf'],
      executionLimitProfile: 'hardened',
      executionLimits: {
        maxExecutionTimeMs: 1_000,
        maxSourceBytes: 4 * 1024,
        maxCommandCount: 20,
        maxLoopIterations: 20,
        maxFileSystemBytes: 1024 * 1024,
        maxOutputSize: 16 * 1024,
        maxTraversalEntries: 100,
      },
      defenseInDepth: { enabled: 'auto' },
      python: false,
      javascript: false,
    });

    const toolkit = await createBashTool({
      sandbox: bash,
      destination: '/workspace',
      maxOutputLength: 4 * 1024,
      promptOptions: {
        toolPrompt: 'In-memory smoke sandbox. Available commands: cat, echo, printf.',
      },
    });
    const tools: ToolSet = toolkit.tools;

    await expect(executeTool(tools, 'bash', {
      command: "printf 'world\\n' > output.txt && cat input.txt output.txt",
    })).resolves.toMatchObject({
      stdout: 'hello\nworld\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(fs.readFile('/workspace/output.txt')).resolves.toBe('world\n');

    await expect(executeTool(tools, 'bash', {
      command: 'curl https://example.com',
    })).resolves.toMatchObject({
      exitCode: 127,
    });

    expect(createPatch('output.txt', '', 'world\n')).toContain('+world');
  });
});

async function executeTool(
  tools: ToolSet,
  name: string,
  args: unknown,
): Promise<unknown> {
  const executable = tools[name] as {
    execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
  };

  if (!executable?.execute) {
    throw new Error(`Tool ${name} is not executable.`);
  }

  return executable.execute(args, {});
}
