import { appendFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, stringify } from 'yaml';

import type {
  RuntimeEvent,
  RuntimeMessage,
  RuntimeToolCall,
  RuntimeToolLogEntry,
  RuntimeToolResult,
} from '@oh-awesome-novel/runtime';
import {
  DEFAULT_BASH_COMMAND_PREVIEW_BYTES,
  DEFAULT_BASH_TURN_PREVIEW_BYTES,
  createBashCommandAudit,
  normalizeBashCommandAudit,
} from './bash-command-audit';
import type { BashCommandAudit } from './bash-command-audit';

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
  pendingActionIds: string[];
}

export interface AgentSessionAuditedToolCall {
  id: string;
  name: 'bash';
}

export type AgentSessionCommandAudit = BashCommandAudit;

type AgentSessionToolCallFields =
  | {
      toolCall: RuntimeToolCall;
      commandAudit?: never;
    }
  | {
      toolCall: AgentSessionAuditedToolCall;
      commandAudit: AgentSessionCommandAudit;
    };

export type AgentSessionToolLogEntry =
  | (AgentSessionToolCallFields & {
      type: 'tool_call_start';
    })
  | (AgentSessionToolCallFields & {
      type: 'tool_call_finish';
      result: RuntimeToolResult;
    });

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
  private readonly remainingTurnPreviewBytes = new Map<string, number>();
  private readonly turnCommandAudits = new Map<
    string,
    Map<string, AgentSessionCommandAudit>
  >();

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
    const toolCallFields = this.createToolCallFields(sessionId, entry.toolCall);
    await this.appendJsonLine(sessionId, 'tool-log.jsonl', {
      type: 'tool_call_finish',
      ...toolCallFields,
      result: entry.result,
    } satisfies AgentSessionToolLogEntry);
    this.releaseCommandAudit(sessionId, entry.toolCall.id);
  }

  async recordRuntimeEvent(sessionId: string, event: RuntimeEvent): Promise<void> {
    if (event.type === 'message_start') {
      this.resetCommandAuditBudget(sessionId);
      return;
    }

    if (event.type === 'message_finish') {
      await this.appendMessages(
        sessionId,
        event.result.messages.map((message) => sanitizeStoredMessage(message)),
      );
      this.clearCommandAuditBudget(sessionId);
      return;
    }

    if (event.type === 'tool_call_start') {
      const toolCallFields = this.createToolCallFields(sessionId, event.toolCall);
      await this.appendJsonLine(sessionId, 'tool-log.jsonl', {
        type: 'tool_call_start',
        ...toolCallFields,
      } satisfies AgentSessionToolLogEntry);
      return;
    }

    if (event.type === 'tool_call_finish') {
      await this.appendToolLog(sessionId, {
        toolCall: event.toolCall,
        result: event.result,
      });
      return;
    }

    if (event.type === 'pending_action') {
      await this.mergePendingActionIds(sessionId, [event.pendingAction.id]);
      return;
    }

    if (event.type === 'error') {
      this.clearCommandAuditBudget(sessionId);
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
    const filePath = await this.sessionFile(metadata.id, 'session.yaml', true);
    await writeFile(filePath, stringify(metadata), 'utf-8');
  }

  private async readMetadata(sessionId: string): Promise<AgentSessionMetadata> {
    const filePath = await this.sessionFile(sessionId, 'session.yaml');
    return parse(await readFile(filePath, 'utf-8')) as AgentSessionMetadata;
  }

  private async writeRecovery(
    sessionId: string,
    pendingActionIds: string[],
  ): Promise<void> {
    const filePath = await this.sessionFile(sessionId, 'recovery.yaml', true);
    const recovery: AgentSessionRecovery = {
      sessionId,
      updatedAt: new Date().toISOString(),
      pendingActionIds: [...new Set(pendingActionIds)].toSorted(),
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
          pendingActionIds: [],
        };
      }

      throw error;
    }
  }

  private async mergePendingActionIds(
    sessionId: string,
    pendingActionIds: string[],
  ): Promise<void> {
    const recovery = await this.readRecovery(sessionId);
    await this.writeRecovery(sessionId, [
      ...recovery.pendingActionIds,
      ...pendingActionIds,
    ]);
  }

  private async appendJsonLine(
    sessionId: string,
    fileName: string,
    value: unknown,
  ): Promise<void> {
    const filePath = await this.sessionFile(sessionId, fileName, true);
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

  private createToolCallFields(
    sessionId: string,
    toolCall: RuntimeToolCall,
  ): AgentSessionToolCallFields {
    if (toolCall.name !== 'bash') {
      return { toolCall };
    }

    let sessionAudits = this.turnCommandAudits.get(sessionId);

    if (!sessionAudits) {
      sessionAudits = new Map();
      this.turnCommandAudits.set(sessionId, sessionAudits);
    }

    let commandAudit = sessionAudits.get(toolCall.id);

    if (!commandAudit) {
      const remainingBytes = this.remainingTurnPreviewBytes.get(sessionId)
        ?? DEFAULT_BASH_TURN_PREVIEW_BYTES;
      const maxPreviewBytes = Math.min(
        DEFAULT_BASH_COMMAND_PREVIEW_BYTES,
        remainingBytes,
      );
      const existing = readExistingCommandAudit(toolCall.args);
      commandAudit = existing
        ? boundExistingCommandAudit(existing, maxPreviewBytes)
        : createBashCommandAudit(toolCall.args, { maxPreviewBytes });
      sessionAudits.set(toolCall.id, commandAudit);
      this.remainingTurnPreviewBytes.set(
        sessionId,
        Math.max(0, remainingBytes - commandAudit.previewByteLength),
      );
    }

    return {
      toolCall: {
        id: toolCall.id,
        name: 'bash',
      },
      commandAudit,
    };
  }

  private resetCommandAuditBudget(sessionId: string): void {
    this.remainingTurnPreviewBytes.set(
      sessionId,
      DEFAULT_BASH_TURN_PREVIEW_BYTES,
    );
    this.turnCommandAudits.set(sessionId, new Map());
  }

  private releaseCommandAudit(sessionId: string, toolCallId: string): void {
    const sessionAudits = this.turnCommandAudits.get(sessionId);
    sessionAudits?.delete(toolCallId);
  }

  private clearCommandAuditBudget(sessionId: string): void {
    this.remainingTurnPreviewBytes.delete(sessionId);
    this.turnCommandAudits.delete(sessionId);
  }

  private async sessionsRoot(): Promise<string> {
    const workspaceRealpath = await realpath(this.workspaceRoot);
    return resolveSafeSessionDirectory(
      workspaceRealpath,
      ['.oan', 'sessions'],
      false,
    );
  }

  private async sessionFile(
    sessionId: string,
    fileName: string,
    createParent = false,
  ): Promise<string> {
    assertSafeSessionId(sessionId);

    if (!allowedSessionFiles.has(fileName)) {
      throw new Error(`Unsupported session file: ${fileName}`);
    }

    const workspaceRealpath = await realpath(this.workspaceRoot);
    const sessionsRoot = resolve(workspaceRealpath, '.oan', 'sessions');
    const sessionRoot = await resolveSafeSessionDirectory(
      workspaceRealpath,
      ['.oan', 'sessions', sessionId],
      createParent,
    );
    const filePath = resolve(sessionRoot, fileName);
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

function sanitizeStoredMessage(message: RuntimeMessage): RuntimeMessage {
  if (!message.toolCalls?.length) return message;
  return {
    ...message,
    toolCalls: message.toolCalls.map((toolCall) => toolCall.name === 'bash'
      ? {
          id: toolCall.id,
          name: toolCall.name,
          args: readExistingCommandAudit(toolCall.args)
            ?? createBashCommandAudit(toolCall.args),
        }
      : toolCall),
  };
}

function readExistingCommandAudit(value: unknown): AgentSessionCommandAudit | undefined {
  return normalizeBashCommandAudit(value);
}

function boundExistingCommandAudit(
  audit: AgentSessionCommandAudit,
  maxPreviewBytes: number,
): AgentSessionCommandAudit {
  if (audit.previewByteLength <= maxPreviewBytes) return audit;
  let commandPreview = '';
  let previewByteLength = 0;
  for (const character of audit.commandPreview) {
    const characterBytes = Buffer.byteLength(character, 'utf-8');
    if (previewByteLength + characterBytes > maxPreviewBytes) break;
    commandPreview += character;
    previewByteLength += characterBytes;
  }
  return {
    ...audit,
    commandPreview,
    previewByteLength,
    truncated: true,
  };
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error('Session id may only contain letters, numbers, "_" and "-".');
  }
}

async function resolveSafeSessionDirectory(
  workspaceRoot: string,
  parts: readonly string[],
  create: boolean,
): Promise<string> {
  let cursor = workspaceRoot;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = resolve(cursor, parts[index]!);
    assertPathInside(workspaceRoot, cursor, 'Session storage escaped workspace.');
    if (create) {
      await mkdir(cursor, { mode: 0o700 }).catch((error: unknown) => {
        if (!isAlreadyExistsError(error)) throw error;
      });
    }
    let information: Awaited<ReturnType<typeof lstat>>;
    try {
      information = await lstat(cursor);
    } catch (error) {
      if (!create && isNotFoundError(error)) {
        return resolve(cursor, ...parts.slice(index + 1));
      }
      throw error;
    }
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new Error(`Session storage directory is unsafe: ${cursor}`);
    }
    assertPathInside(
      workspaceRoot,
      await realpath(cursor),
      'Session storage directory escaped workspace.',
    );
  }
  return cursor;
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

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === 'EEXIST'
  );
}
