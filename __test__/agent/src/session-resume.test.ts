import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSessionRunMetadata } from '@oh-awesome-novel/core';
const streamText = vi.fn();
vi.mock('ai', async (original) => ({ ...(await original<typeof import('ai')>()), streamText }));
const { runNovelAgentTurn, streamNovelAgentTurn, createAgentSessionStore } = await import('@oh-awesome-novel/agent');
const roots: string[] = [];
afterEach(async () => { streamText.mockReset(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function input() {
  const root = await mkdtemp(join(tmpdir(), 'oan-resume-test-')); roots.push(root);
  await writeSessionRunMetadata(root, { sessionId: 'resume', status: 'completed', startedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', inputSources: [], touchedFiles: [],
    resumeBoundary: { sessionId: 'resume', capturedAt: '2026-10-01T00:00:00Z', touchedFiles: [
      { path: 'chapters/0001/0001.md', missing: false, hash: 'a'.repeat(64) },
      { path: 'chapters/0001/0002.md', missing: false, hash: 'b'.repeat(64) },
    ] } });
  streamText.mockImplementation(() => ({ textStream: (async function* () { yield '继续。'; })(), toolCalls: Promise.resolve([]) }));
  return {
    workspaceRoot: root, workspace: { workspaceRoot: root }, request: '继续对话',
    providerConfig: { id: 'mock', kind: 'custom' as const, model: 'mock' },
    resolveModel: vi.fn(() => ({ provider: 'mock', modelId: 'mock' })) as any,
    session: { id: 'resume' },
    editEnvironmentFactory: async () => ({ tools: {}, workspace: { workspaceRoot: root, fixedFileHashes: [{ path: 'chapters/0001/0001.md', hash: createHash('sha256').update('current').digest('hex') }] }, assertFresh: async () => {}, dispose() {} }),
  };
}

describe('resume boundary production wiring', () => {
  it('warns the author and model of changed/deleted files using only the fixed snapshot', async () => {
    const options = await input();
    const result = await runNovelAgentTurn(options);
    expect(result.assistantMessage?.content).toContain('会话恢复提示');
    expect(result.assistantMessage?.content).toContain('已变化：chapters/0001/0001.md');
    expect(result.assistantMessage?.content).toContain('已删除或不在当前可读范围：chapters/0001/0002.md');
    expect(streamText.mock.calls[0][0].system).toContain('历史对话不代表当前事实');
    const recovered = await createAgentSessionStore({ workspaceRoot: options.workspaceRoot }).recoverSession('resume');
    expect(JSON.stringify(recovered)).toContain('会话恢复提示');
  });

  it('streams the same visible notice as the final response', async () => {
    const options = await input();
    let text = ''; let final = '';
    for await (const event of streamNovelAgentTurn(options)) {
      if (event.type === 'message_delta') text += event.text;
      if (event.type === 'message_finish') final = event.result.assistantMessage?.content ?? '';
    }
    expect(text).toBe(final);
    expect(text).toContain('会话恢复提示');
  });
});
