import { mkdir, readdir, readFile, realpath, writeFile, appendFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';

import type {
  RuntimeEvent,
  RuntimeMessage,
  RuntimeToolCall,
  RuntimeToolLogEntry,
  RuntimeToolResult,
} from '@oh-awesome-novel/runtime';

export interface AgentSessionStoreOptions {
  workspaceRoot: string;
}

export interface AgentSessionMetadataInput {
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentSessionMetadata {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionRecovery {
  sessionId: string;
  updatedAt: string;
  shadowWrites: string[];
}

export type AgentSessionToolLogEntry =
  | {
      type: 'tool_call_start';
      toolCall: RuntimeToolCall;
    }
  | {
      type: 'tool_call_finish';
      toolCall: RuntimeToolCall;
      result: RuntimeToolResult;
    };

export interface RecoveredAgentSession {
  metadata: AgentSessionMetadata;
  messages: RuntimeMessage[];
  toolLog: AgentSessionToolLogEntry[];
  recovery: AgentSessionRecovery;
}

export interface AgentSessionStore {
  createSession(metadata?: AgentSessionMetadataInput): Promise<AgentSessionMetadata>;
  ensureSession(
    sessionId: string,
    metadata?: AgentSessionMetadataInput,
  ): Promise<AgentSessionMetadata>;
  appendMessage(sessionId: string, message: RuntimeMessage): Promise<void>;
  appendMessages(sessionId: string, messages: RuntimeMessage[]): Promise<void>;
  appendToolLog(sessionId: string, entry: RuntimeToolLogEntry): Promise<void>;
  recordRuntimeEvent(sessionId: string, event: RuntimeEvent): Promise<void>;
  recoverSession(sessionId: string): Promise<RecoveredAgentSession>;
  recoverLatestSession(): Promise<RecoveredAgentSession | undefined>;
}

export function createAgentSessionStore(
  options: AgentSessionStoreOptions,
): AgentSessionStore {
  return new FileAgentSessionStore(options.workspaceRoot);
}

class FileAgentSessionStore implements AgentSessionStore {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async createSession(
    metadata: AgentSessionMetadataInput = {},
  ): Promise<AgentSessionMetadata> {
    const session = createSessionMetadata(randomUUID(), metadata);
    await this.writeMetadata(session);
    await this.writeRecovery(session.id, []);
    return session;
  }

  async ensureSession(
    sessionId: string,
    metadata: AgentSessionMetadataInput = {},
  ): Promise<AgentSessionMetadata> {
    assertSafeSessionId(sessionId);

    try {
      return await this.readMetadata(sessionId);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    const session = createSessionMetadata(sessionId, metadata);
    await this.writeMetadata(session);
    await this.writeRecovery(session.id, []);
    return session;
  }

  async appendMessage(sessionId: string, message: RuntimeMessage): Promise<void> {
    await this.appendJsonLine(sessionId, 'messages.jsonl', message);
  }

  async appendMessages(sessionId: string, messages: RuntimeMessage[]): Promise<void> {
    for (const message of messages) {
      await this.appendMessage(sessionId, message);
    }
  }

  async appendToolLog(
    sessionId: string,
    entry: RuntimeToolLogEntry,
  ): Promise<void> {
    await this.appendJsonLine(sessionId, 'tool-log.jsonl', {
      type: 'tool_call_finish',
      ...entry,
    } satisfies AgentSessionToolLogEntry);
    const shadowWrites = findShadowWrites(entry);

    if (shadowWrites.length) {
      await this.mergeShadowWrites(sessionId, shadowWrites);
    }
  }

  async recordRuntimeEvent(sessionId: string, event: RuntimeEvent): Promise<void> {
    if (event.type === 'message_finish') {
      await this.appendMessages(sessionId, event.result.messages);
      return;
    }

    if (event.type === 'tool_call_start') {
      await this.appendJsonLine(sessionId, 'tool-log.jsonl', {
        type: 'tool_call_start',
        toolCall: event.toolCall,
      } satisfies AgentSessionToolLogEntry);
      return;
    }

    if (event.type === 'tool_call_finish') {
      await this.appendToolLog(sessionId, {
        toolCall: event.toolCall,
        result: event.result,
      });
    }
  }

  async recoverSession(sessionId: string): Promise<RecoveredAgentSession> {
    const metadata = await this.readMetadata(sessionId);
    const messages = await this.readJsonLines<RuntimeMessage>(
      sessionId,
      'messages.jsonl',
    );
    const toolLog = await this.readJsonLines<AgentSessionToolLogEntry>(
      sessionId,
      'tool-log.jsonl',
    );
    const recovery = await this.readRecovery(sessionId);

    return {
      metadata,
      messages,
      toolLog,
      recovery,
    };
  }

  async recoverLatestSession(): Promise<RecoveredAgentSession | undefined> {
    const sessionsRoot = await this.sessionsRoot();

    try {
      const entries = await readdir(sessionsRoot, { withFileTypes: true });
      const sessions = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.readMetadata(entry.name)),
      );
      const latest = sessions.toSorted((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      )[0];

      return latest ? this.recoverSession(latest.id) : undefined;
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  private async writeMetadata(metadata: AgentSessionMetadata): Promise<void> {
    const filePath = await this.sessionFile(metadata.id, 'session.yaml');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, stringify(metadata), 'utf-8');
  }

  private async readMetadata(sessionId: string): Promise<AgentSessionMetadata> {
    const filePath = await this.sessionFile(sessionId, 'session.yaml');
    return parse(await readFile(filePath, 'utf-8')) as AgentSessionMetadata;
  }

  private async writeRecovery(
    sessionId: string,
    shadowWrites: string[],
  ): Promise<void> {
    const filePath = await this.sessionFile(sessionId, 'recovery.yaml');
    const recovery: AgentSessionRecovery = {
      sessionId,
      updatedAt: new Date().toISOString(),
      shadowWrites: [...new Set(shadowWrites)].toSorted(),
    };
    await writeFile(filePath, stringify(recovery), 'utf-8');
    await this.touchSession(sessionId);
  }

  private async readRecovery(sessionId: string): Promise<AgentSessionRecovery> {
    const filePath = await this.sessionFile(sessionId, 'recovery.yaml');

    try {
      return parse(await readFile(filePath, 'utf-8')) as AgentSessionRecovery;
    } catch (error) {
      if (isNotFoundError(error)) {
        return {
          sessionId,
          updatedAt: new Date().toISOString(),
          shadowWrites: [],
        };
      }

      throw error;
    }
  }

  private async mergeShadowWrites(
    sessionId: string,
    shadowWrites: string[],
  ): Promise<void> {
    const recovery = await this.readRecovery(sessionId);
    await this.writeRecovery(sessionId, [
      ...recovery.shadowWrites,
      ...shadowWrites,
    ]);
  }

  private async appendJsonLine(
    sessionId: string,
    fileName: string,
    value: unknown,
  ): Promise<void> {
    const filePath = await this.sessionFile(sessionId, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf-8');
    await this.touchSession(sessionId);
  }

  private async readJsonLines<T>(
    sessionId: string,
    fileName: string,
  ): Promise<T[]> {
    const filePath = await this.sessionFile(sessionId, fileName);

    try {
      const content = await readFile(filePath, 'utf-8');
      return content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async touchSession(sessionId: string): Promise<void> {
    const metadata = await this.readMetadata(sessionId);
    await this.writeMetadata({
      ...metadata,
      updatedAt: new Date().toISOString(),
    });
  }

  private async sessionsRoot(): Promise<string> {
    const workspaceRealpath = await realpath(this.workspaceRoot);
    const sessionsRoot = resolve(workspaceRealpath, '.oan', 'sessions');
    assertPathInside(
      workspaceRealpath,
      sessionsRoot,
      'Session storage escaped workspace.',
    );
    return sessionsRoot;
  }

  private async sessionFile(sessionId: string, fileName: string): Promise<string> {
    assertSafeSessionId(sessionId);

    if (!allowedSessionFiles.has(fileName)) {
      throw new Error(`Unsupported session file: ${fileName}`);
    }

    const sessionsRoot = await this.sessionsRoot();
    const filePath = resolve(sessionsRoot, sessionId, fileName);
    assertPathInside(
      sessionsRoot,
      filePath,
      'Session file escaped workspace/.oan/sessions.',
    );
    return filePath;
  }
}

const allowedSessionFiles = new Set([
  'session.yaml',
  'messages.jsonl',
  'tool-log.jsonl',
  'recovery.yaml',
]);

function createSessionMetadata(
  id: string,
  input: AgentSessionMetadataInput,
): AgentSessionMetadata {
  const now = new Date().toISOString();
  return {
    id,
    ...(input.title ? { title: input.title } : {}),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function findShadowWrites(entry: RuntimeToolLogEntry): string[] {
  if (!entry.result.ok || typeof entry.result.content !== 'object' || entry.result.content === null) {
    return [];
  }

  const shadowFile = (entry.result.content as { shadowFile?: unknown }).shadowFile;
  return typeof shadowFile === 'string' ? [shadowFile] : [];
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error('Session id may only contain letters, numbers, "_" and "-".');
  }
}

function assertPathInside(root: string, path: string, message: string): void {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;

  if (path !== root && !path.startsWith(normalizedRoot)) {
    throw new Error(message);
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
