import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertUsageSessionId, parseAgentUsageRecord, USAGE_MAX_RECORDS } from './agent-usage';
import type { AgentGovernanceHistory, AgentUsageRecord } from './agent-usage';

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_READ_BYTES = 4 * 1024 * 1024;
const writers = new Map<string, Promise<void>>();

/** Disposable telemetry: callers report a warning on failure, never fail a turn. */
export async function appendAgentUsageRecord(root: string, sessionId: string, input: AgentUsageRecord): Promise<void> {
  assertUsageSessionId(sessionId);
  const record = parseAgentUsageRecord(input);
  if (record.sessionId !== sessionId) throw new Error('Usage session identity mismatch.');
  const data = Buffer.from(`${JSON.stringify(record)}\n`);
  if (data.length > MAX_RECORD_BYTES) throw new Error('Usage record exceeds limit.');
  const key = `${resolve(root)}\0${sessionId}`;
  const previous = writers.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const file = await safeUsagePath(root, sessionId, true);
    const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size + data.length > MAX_FILE_BYTES) throw new Error('Unsafe or oversized usage artifact.');
      // Refuse to append behind a damaged tail; otherwise two records could be joined.
      if (before.size > 0) {
        const reader = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await reader.stat(); const tail = Buffer.alloc(1);
          if (stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('Usage artifact changed.');
          await reader.read(tail, 0, 1, before.size - 1);
          if (tail[0] !== 10) throw new Error('Usage artifact has a truncated tail.');
        } finally { await reader.close(); }
      }
      const current = await lstat(file);
      if (current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev) throw new Error('Usage artifact changed.');
      await handle.writeFile(data); await handle.sync();
    } finally { await handle.close(); }
  });
  writers.set(key, next);
  try { await next; } finally { if (writers.get(key) === next) writers.delete(key); }
}

export async function readAgentGovernanceHistory(root: string, sessionId: string, limit = 50): Promise<AgentGovernanceHistory> {
  assertUsageSessionId(sessionId);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > USAGE_MAX_RECORDS) throw new Error('Usage limit must be 1–100.');
  const result: AgentGovernanceHistory = { schemaVersion: 1, sessionId, records: [], truncated: false, diagnostics: [] };
  try {
    const file = await safeUsagePath(root, sessionId, false);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1) throw new Error('Unsafe usage artifact.');
      if (before.size > MAX_FILE_BYTES) { result.diagnostics.push('size-limit'); return result; }
      const start = Math.max(0, before.size - MAX_READ_BYTES);
      const buffer = Buffer.alloc(before.size - start); let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(buffer, offset, buffer.length - offset, start + offset);
        if (!read.bytesRead) break; offset += read.bytesRead;
      }
      const current = await lstat(file); const after = await handle.stat();
      if (offset !== buffer.length || current.isSymbolicLink() || current.nlink !== 1 || before.ino !== current.ino || before.dev !== current.dev
        || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Usage artifact changed during read.');
      const textStart = start > 0 ? buffer.indexOf(10) + 1 : 0;
      if (start > 0) result.truncated = true;
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(textStart));
    } finally { await handle.close(); }
    const complete = text.length === 0 || text.endsWith('\n');
    const lines = text.split('\n'); lines.pop();
    if (!complete) result.diagnostics.push('truncated-tail');
    for (const line of lines.slice(-limit)) {
      if (!line) continue;
      try {
        if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error('Oversized record.');
        const record = parseAgentUsageRecord(JSON.parse(line));
        if (record.sessionId !== sessionId) throw new Error('Usage identity mismatch.');
        result.records.push(record);
      } catch { if (!result.diagnostics.includes('invalid-record')) result.diagnostics.push('invalid-record'); }
    }
    result.truncated ||= lines.length > limit;
  } catch (error) {
    result.diagnostics.push((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'read-failed');
  }
  return result;
}

async function safeUsagePath(root: string, sessionId: string, create: boolean): Promise<string> {
  let path = await realpath(resolve(root));
  for (const segment of ['.workspace', 'sessions', sessionId]) {
    path = join(path, segment);
    if (create) try { await mkdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe usage artifact directory.');
  }
  return join(path, 'usage-stats.jsonl');
}

/** Bounded, content-free index for reopening the local inspector. */
export async function listAgentUsageSessions(root: string): Promise<Array<{ id: string; updatedAt: string }>> {
  const { readdir } = await import('node:fs/promises');
  const path = join(await realpath(resolve(root)), '.workspace', 'sessions');
  try {
    for (const parent of [join(await realpath(resolve(root)), '.workspace'), path]) {
      const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe usage sessions path.');
    }
    const entries = await readdir(path, { withFileTypes: true });
    const sessions: Array<{ id: string; updatedAt: string }> = [];
    for (const entry of entries.slice(0, 1000)) {
      try {
        assertUsageSessionId(entry.name);
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const file = await safeUsagePath(root, entry.name, false); const stat = await lstat(file);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_FILE_BYTES) sessions.push({ id: entry.name, updatedAt: stat.mtime.toISOString() });
      } catch { /* Unrelated or unsafe session metadata is not an inspector entry. */ }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
