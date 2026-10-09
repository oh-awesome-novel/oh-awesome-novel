import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PlaySession } from '@oh-awesome-novel/core';
import { syncDirectory } from './directory-sync.js';

/** Transport recovery metadata only; the Play session artifact remains commit truth. */
export interface PlayTurnRunReceipt {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  baseRevision: number;
  artifactId: string;
  phase: 'running' | 'committing' | 'committed' | 'cancelled' | 'failed';
  artifactHash?: string;
  error?: string;
}

const MAX_RECEIPT_BYTES = 8_192;

export function fingerprintPlayTurnArtifact(artifact: unknown): string {
  const stable = (value: unknown): unknown => Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]))
      : value;
  return createHash('sha256').update(JSON.stringify(stable(artifact))).digest('hex');
}

export function receiptMatchesCommittedArtifact(receipt: PlayTurnRunReceipt, session: PlaySession): boolean {
  if (!receipt.artifactHash || session.id !== receipt.sessionId || session.revision <= receipt.baseRevision) return false;
  const artifact = session.turnArtifacts.find((item) => item.id === receipt.artifactId);
  return artifact !== undefined && fingerprintPlayTurnArtifact(artifact) === receipt.artifactHash;
}

export async function writePlayTurnRunReceipt(root: string, receipt: PlayTurnRunReceipt): Promise<void> {
  validateReceipt(receipt, receipt.sessionId, receipt.turnId);
  const directory = await receiptDirectory(root, receipt.sessionId, true);
  const path = join(directory!, `${receipt.turnId}.json`);
  const temp = join(directory!, `.${receipt.turnId}.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(receipt)}\n`;
  if (Buffer.byteLength(content) > MAX_RECEIPT_BYTES) throw new Error('Play turn receipt exceeds size limit.');
  try {
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await replaceReceiptFile(temp, path);
    await syncDirectory(directory!);
  } finally { await rm(temp, { force: true }); }
}

export async function readPlayTurnRunReceipt(root: string, sessionId: string, turnId: string): Promise<PlayTurnRunReceipt | undefined> {
  requireId(turnId);
  const directory = await receiptDirectory(root, sessionId, false);
  if (!directory) return undefined;
  const path = join(directory, `${turnId}.json`);
  // Windows ignores O_NOFOLLOW, so reject a symlink before opening it.
  let linked;
  try { linked = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  if (linked.isSymbolicLink() || !linked.isFile()) throw new Error('Unsafe Play turn receipt.');
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_RECEIPT_BYTES) throw new Error('Unsafe Play turn receipt.');
    const bytes = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error('Play turn receipt changed during read.');
    }
    const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    validateReceipt(value, sessionId, turnId);
    return value;
  } finally { await handle.close(); }
}

async function replaceReceiptFile(from: string, to: string): Promise<void> {
  // Windows cannot replace a file another handle still has open. A recovery
  // reader can hit that window; retry the sharing violation, then surface it.
  const attempts = process.platform === 'win32' ? 40 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const locked = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (process.platform !== 'win32' || !locked || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function receiptDirectory(root: string, sessionId: string, create: boolean): Promise<string | undefined> {
  requireId(sessionId);
  const workspace = await realpath(root);
  let cursor = workspace;
  for (const segment of ['.workspace', 'play-turn-runs', sessionId]) {
    const parent = cursor;
    cursor = join(cursor, segment);
    if (create) {
      try { await mkdir(cursor, { mode: 0o700 }); await syncDirectory(parent); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    let info;
    try { info = await lstat(cursor); }
    catch (error) { if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(cursor) !== resolve(cursor)) {
      throw new Error('Unsafe Play turn receipt directory.');
    }
  }
  return cursor;
}

function requireId(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/u.test(value)) throw new Error('Invalid Play turn receipt identity.');
}

function validateReceipt(value: unknown, sessionId: string, turnId: string): asserts value is PlayTurnRunReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Play turn receipt.');
  const item = value as PlayTurnRunReceipt;
  requireId(item.sessionId); requireId(item.turnId); requireId(item.artifactId);
  if (item.schemaVersion !== 1 || item.sessionId !== sessionId || item.turnId !== turnId
    || !Number.isSafeInteger(item.baseRevision) || item.baseRevision < 0
    || !['running', 'committing', 'committed', 'cancelled', 'failed'].includes(item.phase)
    || (item.artifactHash !== undefined && !/^[a-f0-9]{64}$/u.test(item.artifactHash))
    || (['committing', 'committed'].includes(item.phase) && !item.artifactHash)
    || (item.error !== undefined && (typeof item.error !== 'string' || item.error.length > 2_000))) {
    throw new Error('Invalid Play turn receipt.');
  }
}
