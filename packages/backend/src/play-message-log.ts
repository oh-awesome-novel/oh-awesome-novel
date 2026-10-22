import { appendFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/**
 * Append-only Play debug log. It records what was sent to and returned by the
 * model (including thinking) so an author can inspect a session afterwards.
 * Nothing reads it back into Play state, context, adoption or export, and
 * deleting it changes no behaviour.
 */
export type PlayMessageLogEntryKind =
  | 'author_action'
  | 'model_request'
  | 'model_reasoning'
  | 'model_output'
  | 'turn_committed'
  | 'turn_cancelled'
  | 'turn_failed';

export type PlayMessageLogRole =
  | 'world_referee'
  | 'rehearsal_actor'
  | 'rehearsal_referee';

export interface PlayMessageLogEntryInput {
  kind: PlayMessageLogEntryKind;
  turnId?: string;
  attemptId?: string;
  stepRef?: string;
  role?: PlayMessageLogRole;
  participantRef?: string;
  text?: string;
  data?: Record<string, unknown>;
}

export interface PlayMessageLogEntry extends PlayMessageLogEntryInput {
  schemaVersion: 1;
  at: string;
  playSessionId: string;
  truncated?: true;
}

export interface PlayMessageLogPage {
  entries: PlayMessageLogEntry[];
  nextCursor?: number;
  skippedLines: number;
}

const LOG_DIRECTORY = ['.oan', 'sessions', '.play-logs'] as const;
const LOG_FILE = 'messages.jsonl';
const MAX_TEXT_CHARACTERS = 512 * 1024;
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 1000;

export async function appendPlayMessageLog(
  workspaceRoot: string,
  playSessionId: string,
  entries: readonly PlayMessageLogEntryInput[],
): Promise<void> {
  if (!entries.length) return;
  const file = await resolvePlayMessageLogFile(workspaceRoot, playSessionId, true);
  const at = new Date().toISOString();
  const lines = entries.map((entry) => JSON.stringify(toStoredEntry(playSessionId, at, entry)));
  await appendFile(file, `${lines.join('\n')}\n`, { encoding: 'utf-8', mode: 0o600 });
}

/** Debug logging must never fail a Play turn. */
export async function tryAppendPlayMessageLog(
  workspaceRoot: string,
  playSessionId: string,
  entries: readonly PlayMessageLogEntryInput[],
): Promise<boolean> {
  try {
    await appendPlayMessageLog(workspaceRoot, playSessionId, entries);
    return true;
  } catch {
    return false;
  }
}

export async function readPlayMessageLog(
  workspaceRoot: string,
  playSessionId: string,
  options: { cursor?: number; limit?: number } = {},
): Promise<PlayMessageLogPage> {
  const cursor = Math.max(0, Math.trunc(options.cursor ?? 0));
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(options.limit ?? DEFAULT_PAGE_SIZE)));
  const file = await resolvePlayMessageLogFile(workspaceRoot, playSessionId, false);
  let content: string;
  try {
    content = await readFile(file, 'utf-8');
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return { entries: [], skippedLines: 0 };
    throw error;
  }
  const lines = content.split('\n').filter((line) => line.trim());
  const entries: PlayMessageLogEntry[] = [];
  let skippedLines = 0;
  for (const line of lines.slice(cursor, cursor + limit)) {
    const entry = parseEntry(line, playSessionId);
    if (entry) entries.push(entry);
    else skippedLines += 1;
  }
  const next = cursor + limit;
  return {
    entries,
    ...(next < lines.length ? { nextCursor: next } : {}),
    skippedLines,
  };
}

function toStoredEntry(
  playSessionId: string,
  at: string,
  entry: PlayMessageLogEntryInput,
): PlayMessageLogEntry {
  const text = entry.text !== undefined && entry.text.length > MAX_TEXT_CHARACTERS
    ? entry.text.slice(0, MAX_TEXT_CHARACTERS)
    : entry.text;
  return {
    schemaVersion: 1,
    at,
    playSessionId,
    ...entry,
    ...(text !== undefined ? { text } : {}),
    ...(text !== entry.text ? { truncated: true as const } : {}),
  };
}

function parseEntry(line: string, playSessionId: string): PlayMessageLogEntry | undefined {
  try {
    const value = JSON.parse(line) as Partial<PlayMessageLogEntry>;
    if (
      value?.schemaVersion !== 1
      || value.playSessionId !== playSessionId
      || typeof value.kind !== 'string'
      || typeof value.at !== 'string'
    ) return undefined;
    return value as PlayMessageLogEntry;
  } catch {
    return undefined;
  }
}

async function resolvePlayMessageLogFile(
  workspaceRoot: string,
  playSessionId: string,
  create: boolean,
): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(playSessionId) || playSessionId.includes('..')) {
    throw new Error('Invalid Play session id.');
  }
  const root = await realpath(workspaceRoot);
  let cursor = root;
  for (const part of [...LOG_DIRECTORY, playSessionId]) {
    cursor = resolve(cursor, part);
    assertInside(root, cursor);
    if (create) {
      await mkdir(cursor, { mode: 0o700 }).catch((error: unknown) => {
        if (!isErrorCode(error, 'EEXIST')) throw error;
      });
    }
    let information: Awaited<ReturnType<typeof lstat>>;
    try {
      information = await lstat(cursor);
    } catch (error) {
      if (!create && isErrorCode(error, 'ENOENT')) return resolve(cursor, LOG_FILE);
      throw error;
    }
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error('Play message log directory is unsafe.');
    }
  }
  const file = resolve(cursor, LOG_FILE);
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Play message log file is unsafe.');
  } catch (error) {
    if (!isErrorCode(error, 'ENOENT')) throw error;
  }
  return file;
}

function assertInside(root: string, path: string): void {
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error('Play message log escaped the workspace.');
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
