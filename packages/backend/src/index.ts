import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { pipeUIMessageStreamToResponse } from 'ai';
import type { LanguageModel, ToolSet, UIMessage } from 'ai';

import {
  createEmptyLlmProviderConfigState,
  loadWorkspaceList,
  redactLlmProviderConfig,
  resolveGlobalOanConfigDir,
  saveWorkspaceList,
  upsertLlmProviderConfig,
} from '@oh-awesome-novel/core';
import type { LlmProviderConfig, LlmProviderConfigState, LlmProviderKind } from '@oh-awesome-novel/core';
import {
  createNovelAgentValidationTools,
  runtimeEventsToUiMessageStream,
  streamNovelAgentCheckpointTurn,
  streamNovelAgentTurn,
} from '@oh-awesome-novel/agent';
import type { AiSdkProviderResolver } from '@oh-awesome-novel/agent';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
import {
  buildChapterIndex,
  listPendingActions,
  loadYaml,
  readChapterIndexStatus,
  writeChapterIndexFile,
} from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);

export interface NovelBackendOptions {
  workspaceRoot?: string;
  seedWorkspaceRoot?: string;
  globalConfigDir?: string;
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

interface BackendState {
  activeWorkspaceRoot?: string;
  providerConfigState: LlmProviderConfigState;
  providerConfigLoaded: boolean;
}

interface LauncherWorkspaceEntry {
  name: string;
  path: string;
  novelName: string;
  lastOpenedAt?: string;
  addedAt?: string;
  valid: boolean;
  reason?: string;
}

interface WorkspaceValidationResult {
  ok: boolean;
  path: string;
  name: string;
  novelName: string;
  reason?: string;
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: FileTreeNode[];
}

export function createNovelHttpBackend(options: NovelBackendOptions): Server {
  const state: BackendState = {
    activeWorkspaceRoot: options.workspaceRoot,
    providerConfigState: options.providerConfig
      ? upsertLlmProviderConfig(createEmptyLlmProviderConfigState(), options.providerConfig)
      : createEmptyLlmProviderConfigState(),
    providerConfigLoaded: Boolean(options.providerConfig),
  };

  return createServer(async (request, response) => {
    try {
      await routeRequest(options, state, request, response);
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
  state: BackendState,
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

  if (request.method === 'GET' && url.pathname === '/api/workspaces') {
    await handleListWorkspaces(options, state, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/workspaces/import') {
    await handleImportWorkspace(options, request, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/workspaces/open') {
    await handleOpenWorkspace(options, state, request, response);
    return;
  }

  if (request.method === 'PATCH' && url.pathname === '/api/workspaces/name') {
    await handleRenameWorkspace(options, request, response);
    return;
  }

  if (request.method === 'DELETE' && url.pathname === '/api/workspaces') {
    await handleRemoveWorkspace(options, state, request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/provider-config') {
    await handleGetProviderConfig(options, state, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/provider-config') {
    await handleSaveProviderConfig(options, state, request, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/workspace') {
    await handleGetActiveWorkspace(options, state, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/workspace/tree') {
    await handleWorkspaceTree(options, state, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/workspace/file') {
    await handleWorkspaceFile(options, state, url, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/workspace/status') {
    await handleWorkspaceStatus(options, state, response);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/workspace/chapters') {
    await handleWorkspaceChapters(options, state, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/workspace/chapters/rescan') {
    await handleWorkspaceChapterRescan(options, state, response);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/agent/chat') {
    await handleAgentChat(options, state, request, response);
    return;
  }

  writeJson(response, 404, { error: 'Not found.' });
}

async function handleAgentChat(
  options: NovelBackendOptions,
  state: BackendState,
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
    workspaceRoot: requireActiveWorkspaceRoot(options, state),
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

async function handleListWorkspaces(
  options: NovelBackendOptions,
  state: BackendState,
  response: ServerResponse,
): Promise<void> {
  await ensureProviderConfigLoaded(options, state);
  const workspaces = await loadLauncherWorkspaces(options);

  writeJson(response, 200, {
    workspaces,
    activeWorkspacePath: state.activeWorkspaceRoot,
    providerConfigured: state.providerConfigState.providers.length > 0,
  });
}

async function handleImportWorkspace(
  options: NovelBackendOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const requestedPath = getOptionalString(body, 'path');
  const displayName = getOptionalString(body, 'name');

  if (!requestedPath) {
    writeJson(response, 400, { error: 'Workspace path is required.' });
    return;
  }

  const validation = await validateOanWorkspace(requestedPath);
  if (!validation.ok) {
    writeJson(response, 400, { error: validation.reason ?? 'Not an OAN workspace.' });
    return;
  }

  const workspaces = await upsertLauncherWorkspace(options, {
    name: displayName?.trim() || validation.name,
    path: validation.path,
    novelName: validation.novelName,
    addedAt: new Date().toISOString(),
  });

  writeJson(response, 200, { workspace: workspaces.find((item) => item.path === validation.path) });
}

async function handleOpenWorkspace(
  options: NovelBackendOptions,
  state: BackendState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(request);
  const requestedPath = getOptionalString(body, 'path');

  if (!requestedPath) {
    writeJson(response, 400, { error: 'Workspace path is required.' });
    return;
  }

  const validation = await validateOanWorkspace(requestedPath);
  if (!validation.ok) {
    writeJson(response, 400, { error: validation.reason ?? 'Not an OAN workspace.' });
    return;
  }

  state.activeWorkspaceRoot = validation.path;
  const workspaces = await upsertLauncherWorkspace(options, {
    name: validation.name,
    path: validation.path,
    novelName: validation.novelName,
    lastOpenedAt: new Date().toISOString(),
  }, { preserveName: true });

  writeJson(response, 200, {
    workspace: workspaces.find((item) => item.path === validation.path),
    providerConfigured: state.providerConfigState.providers.length > 0,
  });
}

async function handleRenameWorkspace(
  options: NovelBackendOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const requestedPath = getOptionalString(body, 'path');
  const name = getOptionalString(body, 'name')?.trim();

  if (!requestedPath || !name) {
    writeJson(response, 400, { error: 'Workspace path and name are required.' });
    return;
  }

  const workspaces = await loadRawLauncherWorkspaces(options);
  const normalizedPath = resolve(requestedPath);
  const next = workspaces.map((workspace) =>
    workspace.path === normalizedPath ? { ...workspace, name } : workspace,
  );
  await saveRawLauncherWorkspaces(options, next);

  writeJson(response, 200, { workspaces: await loadLauncherWorkspaces(options) });
}

async function handleRemoveWorkspace(
  options: NovelBackendOptions,
  state: BackendState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(request);
  const requestedPath = getOptionalString(body, 'path');

  if (!requestedPath) {
    writeJson(response, 400, { error: 'Workspace path is required.' });
    return;
  }

  const normalizedPath = resolve(requestedPath);
  const workspaces = (await loadRawLauncherWorkspaces(options))
    .filter((workspace) => workspace.path !== normalizedPath);
  await saveRawLauncherWorkspaces(options, workspaces);

  if (state.activeWorkspaceRoot === normalizedPath) {
    state.activeWorkspaceRoot = undefined;
  }

  writeJson(response, 200, { workspaces: await loadLauncherWorkspaces(options) });
}

async function handleGetProviderConfig(
  options: NovelBackendOptions,
  state: BackendState,
  response: ServerResponse,
): Promise<void> {
  await ensureProviderConfigLoaded(options, state);
  const providers = state.providerConfigState.providers.map(redactLlmProviderConfig);

  writeJson(response, 200, {
    providers,
    defaultProviderId: state.providerConfigState.defaultProviderId,
    configured: providers.length > 0,
  });
}

async function handleSaveProviderConfig(
  options: NovelBackendOptions,
  state: BackendState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(request);
  const id = getOptionalString(body, 'id')?.trim() || 'default';
  const kind = getOptionalString(body, 'kind') as LlmProviderKind | undefined;
  const model = getOptionalString(body, 'model')?.trim();

  if (!kind || !['openai', 'openai-compatible', 'deepseek', 'custom'].includes(kind)) {
    writeJson(response, 400, { error: 'Provider kind is invalid.' });
    return;
  }

  if (!model) {
    writeJson(response, 400, { error: 'Model is required.' });
    return;
  }

  const provider: LlmProviderConfig = {
    id,
    kind,
    model,
    displayName: getOptionalString(body, 'displayName')?.trim() || id,
    baseUrl: getOptionalString(body, 'baseUrl')?.trim() || undefined,
    apiKeyEnv: getOptionalString(body, 'apiKeyEnv')?.trim() || undefined,
    default: true,
  };

  state.providerConfigState = upsertLlmProviderConfig(state.providerConfigState, provider);
  await saveProviderConfigState(options, state.providerConfigState);
  await handleGetProviderConfig(options, state, response);
}

async function handleGetActiveWorkspace(
  options: NovelBackendOptions,
  state: BackendState,
  response: ServerResponse,
): Promise<void> {
  await ensureProviderConfigLoaded(options, state);
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const validation = await validateOanWorkspace(workspaceRoot);

  writeJson(response, 200, {
    workspace: {
      name: validation.name,
      novelName: validation.novelName,
      path: validation.path,
      valid: validation.ok,
      reason: validation.reason,
    },
    providerConfigured: state.providerConfigState.providers.length > 0,
  });
}

async function handleWorkspaceTree(
  options: NovelBackendOptions,
  state: BackendState,
  response: ServerResponse,
): Promise<void> {
  const workspaceRoot = await realpath(requireActiveWorkspaceRoot(options, state));
  writeJson(response, 200, { tree: await buildFileTree(workspaceRoot, workspaceRoot) });
}

async function handleWorkspaceFile(
  options: NovelBackendOptions,
  state: BackendState,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const workspaceRoot = await realpath(requireActiveWorkspaceRoot(options, state));
  const filePath = resolveWorkspaceFile(workspaceRoot, url.searchParams.get('path') ?? '');
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    writeJson(response, 400, { error: 'Selected path is not a file.' });
    return;
  }

  writeJson(response, 200, {
    path: relative(workspaceRoot, filePath),
    content: await readFile(filePath, 'utf-8'),
  });
}

async function handleWorkspaceChapters(
  options: NovelBackendOptions,
  state: BackendState,
  response: ServerResponse,
): Promise<void> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const [index, status] = await Promise.all([
    buildChapterIndex({ workspaceRoot }),
    readChapterIndexStatus({ workspaceRoot }),
  ]);

  writeJson(response, 200, { index, status });
}

async function handleWorkspaceStatus(
  options: NovelBackendOptions,
  state: BackendState,
  response: ServerResponse,
): Promise<void> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const [pendingActions, gitStatus] = await Promise.all([
    listPendingActions({ workspaceRoot }),
    readGitWorkspaceStatus(workspaceRoot),
  ]);

  writeJson(response, 200, {
    pendingActionCount: pendingActions.length,
    git: gitStatus,
  });
}

async function handleWorkspaceChapterRescan(
  options: NovelBackendOptions,
  state: BackendState,
  response: ServerResponse,
): Promise<void> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const index = await writeChapterIndexFile({ workspaceRoot });
  const status = await readChapterIndexStatus({ workspaceRoot });

  writeJson(response, 200, { index, status });
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

async function loadLauncherWorkspaces(options: NovelBackendOptions): Promise<LauncherWorkspaceEntry[]> {
  await seedLauncherWorkspace(options);
  const workspaces = await loadRawLauncherWorkspaces(options);
  const enriched = await Promise.all(
    workspaces.map(async (workspace) => {
      const validation = await validateOanWorkspace(workspace.path);
      return {
        ...workspace,
        novelName: validation.novelName,
        name: workspace.name || validation.name,
        valid: validation.ok,
        reason: validation.reason,
      };
    }),
  );

  return enriched.sort((left, right) =>
    (right.lastOpenedAt ?? right.addedAt ?? '').localeCompare(left.lastOpenedAt ?? left.addedAt ?? ''),
  );
}

async function seedLauncherWorkspace(options: NovelBackendOptions): Promise<void> {
  const seedPath = options.seedWorkspaceRoot;

  if (!seedPath) {
    return;
  }

  const validation = await validateOanWorkspace(seedPath);
  if (!validation.ok) {
    return;
  }

  const workspaces = await loadRawLauncherWorkspaces(options);
  if (workspaces.some((workspace) => workspace.path === validation.path)) {
    return;
  }

  await saveRawLauncherWorkspaces(options, [
    ...workspaces,
    {
      name: validation.name,
      path: validation.path,
      novelName: validation.novelName,
      addedAt: new Date().toISOString(),
      valid: true,
    },
  ]);
}

async function loadRawLauncherWorkspaces(options: NovelBackendOptions): Promise<LauncherWorkspaceEntry[]> {
  const list = await loadWorkspaceList(resolveGlobalConfigDir(options));
  return list.workspaces.map((workspace) => ({
    ...workspace,
    novelName: (workspace as LauncherWorkspaceEntry).novelName ?? workspace.name,
    lastOpenedAt: (workspace as LauncherWorkspaceEntry).lastOpenedAt,
    addedAt: (workspace as LauncherWorkspaceEntry).addedAt,
    valid: true,
  }));
}

async function saveRawLauncherWorkspaces(
  options: NovelBackendOptions,
  workspaces: LauncherWorkspaceEntry[],
): Promise<void> {
  await saveWorkspaceList(resolveGlobalConfigDir(options), { workspaces });
}

async function upsertLauncherWorkspace(
  options: NovelBackendOptions,
  workspace: Omit<LauncherWorkspaceEntry, 'valid'>,
  behavior?: { preserveName?: boolean },
): Promise<LauncherWorkspaceEntry[]> {
  const workspaces = await loadRawLauncherWorkspaces(options);
  const existing = workspaces.find((item) => item.path === workspace.path);
  const nextWorkspace: LauncherWorkspaceEntry = {
    ...existing,
    ...workspace,
    name: behavior?.preserveName && existing?.name ? existing.name : workspace.name,
    valid: true,
  };
  const next = [
    ...workspaces.filter((item) => item.path !== workspace.path),
    nextWorkspace,
  ];

  await saveRawLauncherWorkspaces(options, next);
  return loadLauncherWorkspaces(options);
}

async function ensureProviderConfigLoaded(
  options: NovelBackendOptions,
  state: BackendState,
): Promise<void> {
  if (state.providerConfigLoaded) {
    return;
  }

  state.providerConfigState = await loadProviderConfigState(options);
  state.providerConfigLoaded = true;
}

async function loadProviderConfigState(options: NovelBackendOptions): Promise<LlmProviderConfigState> {
  try {
    const raw = await readFile(providerConfigFilePath(options), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (
      isRecord(parsed) &&
      parsed.kind === 'llm-provider-config' &&
      parsed.version === 1 &&
      isRecord(parsed.state) &&
      Array.isArray(parsed.state.providers)
    ) {
      return parsed.state as LlmProviderConfigState;
    }
  } catch {
    // Missing or unreadable global provider config falls back to an empty state.
  }

  return createEmptyLlmProviderConfigState();
}

async function saveProviderConfigState(
  options: NovelBackendOptions,
  state: LlmProviderConfigState,
): Promise<void> {
  const filePath = providerConfigFilePath(options);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({
      kind: 'llm-provider-config',
      version: 1,
      state,
    }, null, 2)}\n`,
    'utf-8',
  );
}

function providerConfigFilePath(options: NovelBackendOptions): string {
  return join(resolveGlobalConfigDir(options), 'llm-providers.json');
}

async function validateOanWorkspace(path: string): Promise<WorkspaceValidationResult> {
  const absolutePath = resolve(path);
  const name = basename(absolutePath);

  if (isInternalWorkspacePath(absolutePath)) {
    return invalidWorkspace(absolutePath, name, 'Cannot import an internal workspace runtime directory.');
  }

  try {
    const root = await realpath(absolutePath);
    const rootStat = await stat(root);

    if (!rootStat.isDirectory()) {
      return invalidWorkspace(root, name, 'Selected path is not a directory.');
    }

    await access(join(root, '.oan'));
    await access(join(root, '.oan', 'config.yaml'));
    await access(join(root, '.oan', 'workflow.yaml'));

    const contentDirs = await Promise.all(
      ['chapters', 'characters', 'world', 'state', 'timeline', 'foreshadow', 'summaries']
        .map(async (dir) => (await isDirectory(join(root, dir))) ? dir : undefined),
    );

    if (!contentDirs.some(Boolean)) {
      return invalidWorkspace(root, name, 'Workspace has no OAN content directories.');
    }

    const novelName = await readNovelName(root);
    return {
      ok: true,
      path: root,
      name: novelName,
      novelName,
    };
  } catch (error) {
    const code = typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
    const reason = code === 'ENOENT'
      ? 'Not an OAN workspace: missing .oan/config.yaml or .oan/workflow.yaml.'
      : 'Directory is not readable.';
    return invalidWorkspace(absolutePath, name, reason);
  }
}

async function readNovelName(workspaceRoot: string): Promise<string> {
  const fallback = basename(workspaceRoot);

  try {
    const config = await loadYaml(join(workspaceRoot, '.oan', 'config.yaml'));
    const configName = readStringProperty(config.data, ['novelName', 'name', 'title']);
    if (configName) {
      return configName;
    }
  } catch {
    // Fall through to workflow and directory fallback.
  }

  try {
    const workflow = await loadYaml(join(workspaceRoot, '.oan', 'workflow.yaml'));
    return readStringProperty(workflow.data, ['novelName', 'projectName', 'title']) ?? fallback;
  } catch {
    return fallback;
  }
}

async function buildFileTree(workspaceRoot: string, directory: string): Promise<FileTreeNode[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map(async (entry) => {
        const absolutePath = join(directory, entry.name);
        const nodePath = relative(workspaceRoot, absolutePath);

        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: nodePath,
            type: 'directory' as const,
            children: await buildFileTree(workspaceRoot, absolutePath),
          };
        }

        return {
          name: entry.name,
          path: nodePath,
          type: 'file' as const,
        };
      }),
  );

  return nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

async function readGitWorkspaceStatus(workspaceRoot: string): Promise<{
  status: 'clean' | 'dirty' | 'unknown';
  dirty: boolean | null;
}> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workspaceRoot,
      'status',
      '--porcelain',
    ]);
    const dirty = stdout.trim().length > 0;

    return {
      status: dirty ? 'dirty' : 'clean',
      dirty,
    };
  } catch {
    return {
      status: 'unknown',
      dirty: null,
    };
  }
}

function resolveWorkspaceFile(workspaceRoot: string, path: string): string {
  if (!path.trim() || isAbsolute(path)) {
    throw new Error(`Invalid workspace relative path: ${path}`);
  }

  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part === '..' || part.startsWith('.'))) {
    throw new Error(`Invalid workspace relative path: ${path}`);
  }

  const absolutePath = resolve(workspaceRoot, path);
  const relativePath = relative(workspaceRoot, absolutePath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Path is outside workspace: ${path}`);
  }

  return absolutePath;
}

function requireActiveWorkspaceRoot(
  options: NovelBackendOptions,
  state: BackendState,
): string {
  const workspaceRoot = state.activeWorkspaceRoot ?? options.workspaceRoot;

  if (!workspaceRoot) {
    throw new Error('No active workspace selected.');
  }

  return workspaceRoot;
}

function resolveGlobalConfigDir(options: NovelBackendOptions): string {
  return resolveGlobalOanConfigDir({
    globalConfigDir: options.globalConfigDir ?? join(homedir(), '.oan'),
  });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function invalidWorkspace(
  path: string,
  name: string,
  reason: string,
): WorkspaceValidationResult {
  return {
    ok: false,
    path,
    name,
    novelName: name,
    reason,
  };
}

function isInternalWorkspacePath(path: string): boolean {
  const parts = path.split(sep).filter(Boolean);

  return parts.some((part, index) => {
    if (part === '.git' || part === '.workspace') {
      return true;
    }

    return part === '.oan' && parts[index + 1] === 'sessions';
  });
}

function readStringProperty(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
}

export type { LanguageModel };
