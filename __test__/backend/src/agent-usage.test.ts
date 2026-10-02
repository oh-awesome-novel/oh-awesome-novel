import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendAgentUsageRecord } from '@oh-awesome-novel/core';
import { createNovelHonoApp } from '@oh-awesome-novel/backend';
import { createOanClient } from '@oh-awesome-novel/client';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oan-usage-http-')); roots.push(root);
  const app = createNovelHonoApp({ workspaceRoot: root });
  const client = createOanClient({ backendBaseUrl: 'http://test', fetch: ((input, init) => app.request(String(input), init)) as typeof fetch });
  return { root, app, client };
}
describe('workspace-bound usage history HTTP', () => {
  it('reopens only strictly parsed content-free records and exposes session discovery', async () => {
    const { root, client } = await fixture();
    const record = { schemaVersion: 1 as const, recordType: 'step' as const, sessionId: 's1', turnId: 't1', stepIndex: 0, createdAt: '2026-10-01T00:00:00.000Z', outcome: 'completed' as const, actualUsage: { availability: 'unavailable' as const } };
    await appendAgentUsageRecord(root, 's1', record);
    expect(await client.getAgentGovernanceHistory('s1')).toEqual({ schemaVersion: 1, sessionId: 's1', records: [record], diagnostics: [], truncated: false });
    expect(await client.listAgentUsageSessions()).toEqual({ sessions: [{ id: 's1', updatedAt: expect.any(String) }] });
  });
  it('bounds limits, rejects dangerous IDs and refuses symlinked private content', async () => {
    const { root, app, client } = await fixture();
    expect((await app.request('/api/workspace/agent-sessions/s1/governance?limit=101')).status).toBe(400);
    expect((await app.request('/api/workspace/agent-sessions/s1..bad/governance')).status).toBe(400);
    await mkdir(join(root, '.workspace/sessions/s1'), { recursive: true });
    await writeFile(join(root, 'secret.txt'), 'SECRET_HEADER');
    await symlink(join(root, 'secret.txt'), join(root, '.workspace/sessions/s1/usage-stats.jsonl'));
    const result = await client.getAgentGovernanceHistory('s1');
    expect(result).toMatchObject({ records: [], diagnostics: ['read-failed'] });
    expect(JSON.stringify(result)).not.toContain('SECRET_HEADER');
  });
  it('rejects chat IDs that the persistent Agent SessionStore cannot accept', async () => {
    const { app } = await fixture();
    const response = await app.request('/api/agent/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'chat.v1', request: 'hello' }) });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Invalid agent session id.' });
  });

});
