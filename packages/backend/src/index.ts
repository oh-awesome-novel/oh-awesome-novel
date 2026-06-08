import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { pipeUIMessageStreamToResponse } from 'ai';
import type { LanguageModel, ToolSet, UIMessage } from 'ai';

import type { LlmProviderConfig } from '@oh-awesome-novel/core';
import {
  createNovelAgentValidationTools,
  runtimeEventsToUiMessageStream,
  streamNovelAgentCheckpointTurn,
  streamNovelAgentTurn,
} from '@oh-awesome-novel/agent';
import type { AiSdkProviderResolver } from '@oh-awesome-novel/agent';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';

export interface NovelBackendOptions {
  workspaceRoot: string;
  providerConfig?: LlmProviderConfig;
  resolveModel?: AiSdkProviderResolver;
  tools?: ToolSet;
  host?: string;
  port?: number;
  mode?: 'checkpoint' | 'model';
  runAgent?: (input: NovelBackendAgentInput) => AsyncIterable<RuntimeEvent>;
}

export interface NovelBackendAgentInput {
  request: string;
  workspaceRoot: string;
  messages: UIMessage[];
}

export interface NovelBackendHandle {
  server: Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export function createNovelHttpBackend(options: NovelBackendOptions): Server {
  return createServer(async (request, response) => {
    try {
      await routeRequest(options, request, response);
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export async function startNovelHttpBackend(
  options: NovelBackendOptions,
): Promise<NovelBackendHandle> {
  const host = options.host ?? '127.0.0.1';
  const server = createNovelHttpBackend(options);

  server.listen(options.port ?? 0, host);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;

  return {
    server,
    host,
    port: address.port,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function routeRequest(
  options: NovelBackendOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/api/health') {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/chat') {
    await handleAgentChat(options, request, response);
    return;
  }

  writeJson(response, 404, { error: 'Not found.' });
}

async function handleAgentChat(
  options: NovelBackendOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const messages = Array.isArray(body.messages) ? (body.messages as UIMessage[]) : [];
  const requestText = getLastUserText(messages) ?? getOptionalString(body, 'request') ?? '';

  if (!requestText.trim()) {
    writeJson(response, 400, { error: 'A user message is required.' });
    return;
  }

  const runtimeEvents = createRuntimeEventStream(options, {
    request: requestText,
    workspaceRoot: options.workspaceRoot,
    messages,
  });
  const stream = runtimeEventsToUiMessageStream(runtimeEvents);

  pipeUIMessageStreamToResponse({
    response,
    stream,
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function createRuntimeEventStream(
  options: NovelBackendOptions,
  input: NovelBackendAgentInput,
): AsyncIterable<RuntimeEvent> {
  if (options.runAgent) {
    return options.runAgent(input);
  }

  if (options.mode === 'model') {
    if (!options.providerConfig || !options.resolveModel) {
      throw new Error('Model mode requires providerConfig and resolveModel.');
    }

    return streamNovelAgentTurn({
      providerConfig: options.providerConfig,
      resolveModel: options.resolveModel,
      workspaceRoot: input.workspaceRoot,
      workspace: { workspaceRoot: input.workspaceRoot },
      request: input.request,
      tools: options.tools ?? createNovelAgentValidationTools(input.workspaceRoot),
      session: { metadata: { title: input.request } },
    });
  }

  return streamNovelAgentCheckpointTurn({
    workspaceRoot: input.workspaceRoot,
    request: input.request,
    tools: options.tools,
  });
}

function getLastUserText(messages: UIMessage[]): string | undefined {
  const message = [...messages].reverse().find((item) => item.role === 'user');

  if (!message) {
    return undefined;
  }

  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

function getOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

export type { LanguageModel };
