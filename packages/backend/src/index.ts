import type { Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { createUIMessageStreamResponse } from 'ai';
import type { LanguageModel, ToolSet, UIMessage } from 'ai';
import { createAdaptorServer } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';

import {
  createEmptyLlmProviderConfigState,
  getDefaultLlmProviderConfig,
  initWorkspace,
  importReferenceWork,
  createPlayAdoptionCandidate,
  createPlaySessionDraft,
  formatPlayWorldRefereePrompt,
  formatProjectHealthMarkdown,
  formatReferenceContextSelectionMarkdown,
  loadAppConfig,
  saveAppConfig,
  loadWorkspaceConfig,
  loadNovelCopilotSkill,
  loadWorkspaceList,
  listPlaySessions,
  listReferenceWorks,
  normalizeLlmProviderConfig,
  readProjectHealth,
  readPlaySessionFiles,
  removeLlmProviderConfig,
  redactLlmProviderConfig,
  resolveGlobalOanConfigDir,
  saveWorkspaceOnboarding,
  saveWorkspaceList,
  selectReferenceContext,
  setDefaultLlmProviderConfig,
  setReferenceEnabled,
  upsertLlmProviderConfig,
  writePlaySessionFiles,
  writeWorkspaceProjections,
} from '@oh-awesome-novel/core';
import type {
  AppConfig,
  ComposerSubmitShortcutPreference,
  LlmProviderConfig,
  LlmProviderConfigState,
  LlmProviderKind,
  ThemePreference,
} from '@oh-awesome-novel/core';
import type { LlmProviderModel } from '@oh-awesome-novel/core';
import type {
  PlayActivatedSource,
  PlayAdoptionCandidate,
  PlayAdoptionTarget,
  PlayObservation,
  PlaySession,
  PlayTranscriptTurn,
  ProjectHealth,
  ReferenceAllowedUsage,
  ReferenceRights,
  ReferenceSourceType,
} from '@oh-awesome-novel/core';
import {
  inferNovelAgentCapability,
  runNovelAgentTurn,
  runtimeEventsToUiMessageStream,
  streamNovelAgentCheckpointTurn,
  streamNovelAgentTurn,
} from '@oh-awesome-novel/agent';
import type { AiSdkProviderResolver } from '@oh-awesome-novel/agent';
import type { RuntimeEvent } from '@oh-awesome-novel/runtime';
import {
  buildChapterIndex,
  acceptPendingAction,
  commitFiles,
  createWriteIntentTools,
  gitDiff,
  listPendingActions,
  listGitCommits,
  loadYaml,
  readGitStatus,
  readChapterIndexStatus,
  rejectPendingAction,
  showGitCommit,
  syncGit,
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

export type NovelHonoApp = Hono;

type NovelBackendContext = Context;

type JsonBody = Record<string, unknown>;

export function createNovelHonoApp(options: NovelBackendOptions): NovelHonoApp {
  const state: BackendState = {
    activeWorkspaceRoot: options.workspaceRoot,
    providerConfigState: options.providerConfig
      ? upsertLlmProviderConfig(createEmptyLlmProviderConfigState(), options.providerConfig)
      : createEmptyLlmProviderConfigState(),
    providerConfigLoaded: Boolean(options.providerConfig),
  };
  const app = new Hono();

  app.use('*', cors({
    origin: '*',
    allowHeaders: ['content-type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }));

  app.onError((error, context) => jsonResponse(context, 500, {
    error: error instanceof Error ? error.message : String(error),
  }));

  app.get('/api/health', (context) => context.json({ ok: true }));
  app.get('/api/app-config', (context) => handleGetAppConfig(options, context));
  app.patch('/api/app-config', (context) => handleSaveAppConfig(options, context));
  app.get('/api/workspaces', (context) => handleListWorkspaces(options, state, context));
  app.post('/api/workspaces/import', (context) => handleImportWorkspace(options, context));
  app.post('/api/workspaces/create', (context) => handleCreateWorkspace(options, state, context));
  app.post('/api/workspaces/open', (context) => handleOpenWorkspace(options, state, context));
  app.patch('/api/workspaces/name', (context) => handleRenameWorkspace(options, context));
  app.delete('/api/workspaces', (context) => handleRemoveWorkspace(options, state, context));
  app.get('/api/provider-config', (context) => handleGetProviderConfig(options, state, context));
  app.post('/api/provider-config', (context) => handleSaveProviderConfig(options, state, context));
  app.post('/api/provider-config/check', (context) => handleCheckProviderConfig(options, state, context));
  app.post('/api/provider-config/models', (context) => handleListProviderModels(options, state, context));
  app.post('/api/provider-config/:id/default', (context) =>
    handleSetDefaultProviderConfig(options, state, context.req.param('id') ?? '', context));
  app.delete('/api/provider-config/:id', (context) =>
    handleDeleteProviderConfig(options, state, context.req.param('id') ?? '', context));
  app.get('/api/workspace', (context) => handleGetActiveWorkspace(options, state, context));
  app.get('/api/workspace/tree', (context) => handleWorkspaceTree(options, state, context));
  app.get('/api/workspace/file', (context) => handleWorkspaceFile(options, state, context));
  app.get('/api/workspace/status', (context) => handleWorkspaceStatus(options, state, context));
  app.get('/api/workspace/references', (context) =>
    handleListReferenceWorks(options, state, context));
  app.post('/api/workspace/references/import', (context) =>
    handleImportReferenceWork(options, state, context));
  app.patch('/api/workspace/references/:id', (context) =>
    handleUpdateReferenceWork(options, state, context.req.param('id') ?? '', context));
  app.post('/api/workspace/references/context', (context) =>
    handleSelectReferenceContext(options, state, context));
  app.get('/api/git/status', (context) => handleGitStatus(options, state, context));
  app.get('/api/git/log', (context) => handleGitLog(options, state, context));
  app.get('/api/git/show/:hash', (context) =>
    handleGitShow(options, state, context.req.param('hash') ?? '', context));
  app.get('/api/git/diff', (context) => handleGitDiff(options, state, context));
  app.post('/api/git/commit', (context) => handleGitCommit(options, state, context));
  app.post('/api/git/sync', (context) => handleGitSync(options, state, context));
  app.post('/api/external-editor/open', (context) =>
    handleOpenExternalEditor(options, state, context));
  app.get('/api/workspace/project-health', (context) =>
    handleWorkspaceProjectHealth(options, state, context));
  app.post('/api/workspace/projections/rebuild', (context) =>
    handleWorkspaceProjectionRebuild(options, state, context));
  app.get('/api/workspace/play-sessions', (context) =>
    handleListPlaySessions(options, state, context));
  app.post('/api/workspace/play-sessions', (context) =>
    handleCreatePlaySession(options, state, context));
  app.get('/api/workspace/play-sessions/:id', (context) =>
    handleReadPlaySession(options, state, context.req.param('id') ?? '', context));
  app.post('/api/workspace/play-sessions/:id/transcript', (context) =>
    handleAppendPlayTranscript(options, state, context.req.param('id') ?? '', context));
  app.post('/api/workspace/play-sessions/:id/observations', (context) =>
    handleAddPlayObservation(options, state, context.req.param('id') ?? '', context));
  app.post('/api/workspace/play-sessions/:id/adoption-candidates', (context) =>
    handleAddPlayAdoptionCandidate(options, state, context.req.param('id') ?? '', context));
  app.post('/api/workspace/play-sessions/:id/world-referee-turn', (context) =>
    handlePlayWorldRefereeTurn(options, state, context.req.param('id') ?? '', context));
  app.post('/api/workspace/play-sessions/:id/adoption-candidates/:candidateId/pending-action', (context) =>
    handleCreatePlayAdoptionPendingAction(
      options,
      state,
      context.req.param('id') ?? '',
      context.req.param('candidateId') ?? '',
      context,
    ));
  app.post('/api/workspace/onboarding', (context) => handleSaveWorkspaceOnboarding(options, state, context));
  app.get('/api/workspace/pending-actions', (context) => handleListPendingActions(options, state, context));
  app.post('/api/workspace/pending-actions/:id/:decision', (context) => {
    const decision = context.req.param('decision');

    if (decision !== 'accept' && decision !== 'reject') {
      return jsonResponse(context, 404, { error: 'Not found.' });
    }

    return handlePendingActionDecision(
      options,
      state,
      context.req.param('id') ?? '',
      decision,
      context,
    );
  });
  app.get('/api/workspace/chapters', (context) => handleWorkspaceChapters(options, state, context));
  app.post('/api/workspace/chapters/rescan', (context) =>
    handleWorkspaceChapterRescan(options, state, context));
  app.post('/api/agent/chat', (context) => handleAgentChat(options, state, context));
  app.notFound((context) => jsonResponse(context, 404, { error: 'Not found.' }));

  return app;
}

export function createNovelHttpBackend(options: NovelBackendOptions): Server {
  const app = createNovelHonoApp(options);

  return createAdaptorServer({ fetch: app.fetch }) as Server;
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

async function handleAgentChat(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(context);
  const messages = Array.isArray(body.messages) ? (body.messages as UIMessage[]) : [];
  const requestText = getLastUserText(messages) ?? getOptionalString(body, 'request') ?? '';

  if (!requestText.trim()) {
    return jsonResponse(context, 400, { error: 'A user message is required.' });
  }

  const runtimeEvents = await createRuntimeEventStream(options, state, {
    request: requestText,
    workspaceRoot: requireActiveWorkspaceRoot(options, state),
    messages,
  });
  const stream = runtimeEventsToUiMessageStream(runtimeEvents);

  return createUIMessageStreamResponse({
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
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const workspaces = await loadLauncherWorkspaces(options);

  return jsonResponse(context, 200, {
    workspaces,
    activeWorkspacePath: state.activeWorkspaceRoot,
    providerConfigured: state.providerConfigState.providers.length > 0,
  });
}

async function handleImportWorkspace(
  options: NovelBackendOptions,
  context: NovelBackendContext,
): Promise<Response> {
  const body = await readJsonBody(context);
  const requestedPath = getOptionalString(body, 'path');
  const displayName = getOptionalString(body, 'name');

  if (!requestedPath) {
    return jsonResponse(context, 400, { error: 'Workspace path is required.' });
  }

  const validation = await validateOanWorkspace(requestedPath);
  if (!validation.ok) {
    return jsonResponse(context, 400, { error: validation.reason ?? 'Not an OAN workspace.' });
  }

  const workspaces = await upsertLauncherWorkspace(options, {
    name: displayName?.trim() || validation.name,
    path: validation.path,
    novelName: validation.novelName,
    addedAt: new Date().toISOString(),
  });

  return jsonResponse(context, 200, {
    workspace: workspaces.find((item) => item.path === validation.path),
  });
}

async function handleGetAppConfig(
  options: NovelBackendOptions,
  context: NovelBackendContext,
): Promise<Response> {
  const config = await loadAppConfig(resolveGlobalConfigDir(options));

  return jsonResponse(context, 200, { config });
}

async function handleSaveAppConfig(
  options: NovelBackendOptions,
  context: NovelBackendContext,
): Promise<Response> {
  const body = await readJsonBody(context);
  const configDir = resolveGlobalConfigDir(options);
  const nextConfig: AppConfig = {
    ...(await loadAppConfig(configDir)),
  };

  if (hasOwn(body, 'theme')) {
    const theme = getOptionalString(body, 'theme');

    if (!theme || !isThemePreference(theme)) {
      return jsonResponse(context, 400, { error: 'Theme preference is invalid.' });
    }

    nextConfig.theme = theme;
  }

  if (hasOwn(body, 'composerSubmitShortcut')) {
    const shortcut = getOptionalString(body, 'composerSubmitShortcut');

    if (!shortcut || !isComposerSubmitShortcutPreference(shortcut)) {
      return jsonResponse(context, 400, {
        error: 'Composer submit shortcut preference is invalid.',
      });
    }

    nextConfig.composerSubmitShortcut = shortcut;
  }

  await saveAppConfig(configDir, nextConfig);

  return jsonResponse(context, 200, { config: nextConfig });
}

async function handleCreateWorkspace(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(context);
  const requestedPath = getOptionalString(body, 'path');

  if (!requestedPath) {
    return jsonResponse(context, 400, { error: 'Workspace path is required.' });
  }

  const targetPath = resolve(requestedPath);

  if (isInternalWorkspacePath(targetPath)) {
    return jsonResponse(context, 400, {
      error: 'Cannot create a workspace inside an internal runtime directory.',
    });
  }

  try {
    await mkdir(targetPath, { recursive: true });
    await initWorkspace(targetPath);
  } catch (error) {
    return jsonResponse(context, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const validation = await validateOanWorkspace(targetPath);
  if (!validation.ok) {
    return jsonResponse(context, 400, {
      error: validation.reason ?? 'Failed to create an OAN workspace.',
    });
  }

  state.activeWorkspaceRoot = validation.path;
  const now = new Date().toISOString();
  const workspaces = await upsertLauncherWorkspace(options, {
    name: validation.name,
    path: validation.path,
    novelName: validation.novelName,
    addedAt: now,
    lastOpenedAt: now,
  });

  return jsonResponse(context, 200, {
    workspace: workspaces.find((item) => item.path === validation.path),
    providerConfigured: state.providerConfigState.providers.length > 0,
    onboarding: { show: true },
  });
}

async function handleOpenWorkspace(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(context);
  const requestedPath = getOptionalString(body, 'path');

  if (!requestedPath) {
    return jsonResponse(context, 400, { error: 'Workspace path is required.' });
  }

  const validation = await validateOanWorkspace(requestedPath);
  if (!validation.ok) {
    return jsonResponse(context, 400, { error: validation.reason ?? 'Not an OAN workspace.' });
  }

  state.activeWorkspaceRoot = validation.path;
  const workspaces = await upsertLauncherWorkspace(options, {
    name: validation.name,
    path: validation.path,
    novelName: validation.novelName,
    lastOpenedAt: new Date().toISOString(),
  }, { preserveName: true });

  return jsonResponse(context, 200, {
    workspace: workspaces.find((item) => item.path === validation.path),
    providerConfigured: state.providerConfigState.providers.length > 0,
  });
}

async function handleRenameWorkspace(
  options: NovelBackendOptions,
  context: NovelBackendContext,
): Promise<Response> {
  const body = await readJsonBody(context);
  const requestedPath = getOptionalString(body, 'path');
  const name = getOptionalString(body, 'name')?.trim();

  if (!requestedPath || !name) {
    return jsonResponse(context, 400, { error: 'Workspace path and name are required.' });
  }

  const workspaces = await loadRawLauncherWorkspaces(options);
  const normalizedPath = resolve(requestedPath);
  const next = workspaces.map((workspace) =>
    workspace.path === normalizedPath ? { ...workspace, name } : workspace,
  );
  await saveRawLauncherWorkspaces(options, next);

  return jsonResponse(context, 200, { workspaces: await loadLauncherWorkspaces(options) });
}

async function handleRemoveWorkspace(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const body = await readJsonBody(context);
  const requestedPath = getOptionalString(body, 'path');

  if (!requestedPath) {
    return jsonResponse(context, 400, { error: 'Workspace path is required.' });
  }

  const normalizedPath = resolve(requestedPath);
  const workspaces = (await loadRawLauncherWorkspaces(options))
    .filter((workspace) => workspace.path !== normalizedPath);
  await saveRawLauncherWorkspaces(options, workspaces);

  if (state.activeWorkspaceRoot === normalizedPath) {
    state.activeWorkspaceRoot = undefined;
  }

  return jsonResponse(context, 200, { workspaces: await loadLauncherWorkspaces(options) });
}

async function handleGetProviderConfig(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const providers = state.providerConfigState.providers.map(redactLlmProviderConfig);

  return jsonResponse(context, 200, {
    providers,
    defaultProviderId: state.providerConfigState.defaultProviderId,
    configured: providers.length > 0,
  });
}

async function handleSaveProviderConfig(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(context);
  const id = getOptionalString(body, 'id')?.trim() || 'default';
  const kind = getOptionalString(body, 'kind') as LlmProviderKind | undefined;
  const models = readProviderModels(body);
  const model = getOptionalString(body, 'model')?.trim()
    || models.find((item) => item.default)?.id
    || models[0]?.id;

  if (!kind || !isSupportedProviderKind(kind)) {
    return jsonResponse(context, 400, { error: 'Provider kind is invalid.' });
  }

  if (!model) {
    return jsonResponse(context, 400, { error: 'Model is required.' });
  }

  const existingProvider = state.providerConfigState.providers.find((provider) => provider.id === id);
  const apiKey = getOptionalString(body, 'apiKey')?.trim() || existingProvider?.apiKey;

  const provider: LlmProviderConfig = {
    id,
    kind,
    model,
    models,
    displayName: getOptionalString(body, 'displayName')?.trim() || id,
    baseUrl: getOptionalString(body, 'baseUrl')?.trim() || providerDefaultBaseUrl(kind),
    apiKey,
    apiKeyEnv: existingProvider?.apiKeyEnv,
    default: body.default === true || state.providerConfigState.providers.length === 0,
  };

  state.providerConfigState = upsertLlmProviderConfig(state.providerConfigState, provider);
  await saveProviderConfigState(options, state.providerConfigState);
  return handleGetProviderConfig(options, state, context);
}

async function handleSetDefaultProviderConfig(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);

  try {
    state.providerConfigState = setDefaultLlmProviderConfig(state.providerConfigState, id);
    await saveProviderConfigState(options, state.providerConfigState);
    return handleGetProviderConfig(options, state, context);
  } catch (error) {
    return jsonResponse(context, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDeleteProviderConfig(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  state.providerConfigState = removeLlmProviderConfig(state.providerConfigState, id);
  await saveProviderConfigState(options, state.providerConfigState);
  return handleGetProviderConfig(options, state, context);
}

async function handleListProviderModels(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(context);
  const providerId = getOptionalString(body, 'providerId')?.trim();
  const savedProvider = providerId
    ? state.providerConfigState.providers.find((provider) => provider.id === providerId)
    : undefined;
  const kind = (getOptionalString(body, 'kind') ?? savedProvider?.kind ?? 'custom') as
    | LlmProviderKind
    | undefined;
  const baseUrl = normalizeProviderBaseUrl(
    getOptionalString(body, 'baseUrl') ?? savedProvider?.baseUrl ?? (kind ? providerDefaultBaseUrl(kind) : undefined),
  );
  const apiKey = getOptionalString(body, 'apiKey')?.trim() || savedProvider?.apiKey;

  if (!kind || !isSupportedProviderKind(kind)) {
    return jsonResponse(context, 400, { error: 'Provider kind is invalid.' });
  }

  if (!baseUrl) {
    return jsonResponse(context, 400, { error: 'Base URL is required.' });
  }

  if (providerRequiresApiKey(kind) && !apiKey) {
    return jsonResponse(context, 400, { error: 'API key is required.' });
  }

  try {
    const result = await fetchProviderModelList({ kind, baseUrl, apiKey });

    if (!result.ok) {
      return jsonResponse(context, result.status, { error: result.error });
    }

    return jsonResponse(context, 200, { models: result.models });
  } catch (error) {
    return jsonResponse(context, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCheckProviderConfig(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const body = await readJsonBody(context);
  const providerId = getOptionalString(body, 'providerId')?.trim();
  const savedProvider = providerId
    ? state.providerConfigState.providers.find((provider) => provider.id === providerId)
    : undefined;
  const kind = (getOptionalString(body, 'kind') ?? savedProvider?.kind) as LlmProviderKind | undefined;
  const model = getOptionalString(body, 'model')?.trim() || savedProvider?.model;

  if (!kind || !isSupportedProviderKind(kind)) {
    return jsonResponse(context, 400, { error: 'Provider kind is invalid.' });
  }

  if (!model) {
    return jsonResponse(context, 400, { error: 'Model is required.' });
  }

  const baseUrl = normalizeProviderBaseUrl(
    getOptionalString(body, 'baseUrl') ?? savedProvider?.baseUrl ?? providerDefaultBaseUrl(kind),
  );
  const apiKey = getOptionalString(body, 'apiKey')?.trim() || savedProvider?.apiKey;

  if (!baseUrl) {
    return jsonResponse(context, 400, { error: 'Base URL is required.' });
  }

  if (providerRequiresApiKey(kind) && !apiKey) {
    return jsonResponse(context, 400, { error: 'API key is required.' });
  }

  const result = await checkOpenAiCompatibleProvider({ baseUrl, apiKey, model });
  return jsonResponse(context, 200, result);
}

async function handleGetActiveWorkspace(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const validation = await validateOanWorkspace(workspaceRoot);

  return jsonResponse(context, 200, {
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
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = await realpath(requireActiveWorkspaceRoot(options, state));
  return jsonResponse(context, 200, { tree: await buildFileTree(workspaceRoot, workspaceRoot) });
}

async function handleWorkspaceFile(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = await realpath(requireActiveWorkspaceRoot(options, state));
  const filePath = resolveWorkspaceFile(workspaceRoot, context.req.query('path') ?? '');
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    return jsonResponse(context, 400, { error: 'Selected path is not a file.' });
  }

  return jsonResponse(context, 200, {
    path: relative(workspaceRoot, filePath),
    content: await readFile(filePath, 'utf-8'),
  });
}

async function handleWorkspaceChapters(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const [index, status] = await Promise.all([
    buildChapterIndex({ workspaceRoot }),
    readChapterIndexStatus({ workspaceRoot }),
  ]);

  return jsonResponse(context, 200, { index, status });
}

async function handleWorkspaceStatus(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const [pendingActions, gitStatus, gitConfig] = await Promise.all([
    listPendingActions({ workspaceRoot }),
    readGitStatus(workspaceRoot),
    readWorkspaceGitConfig(workspaceRoot),
  ]);

  return jsonResponse(context, 200, {
    pendingActionCount: pendingActions.length,
    git: gitStatus,
    gitConfig,
  });
}

async function handleListReferenceWorks(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  return jsonResponse(context, 200, { references: await listReferenceWorks(workspaceRoot) });
}

async function handleImportReferenceWork(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const title = getOptionalString(body, 'title')?.trim();
  const sourcePath = getOptionalString(body, 'sourcePath')?.trim();
  const sourceText = getOptionalString(body, 'sourceText');
  const sourceType = readReferenceSourceType(body, 'sourceType');
  const rights = readReferenceRights(body, 'rights');
  const allowedUsage = readReferenceAllowedUsageArray(body, 'allowedUsage');

  if (!title) {
    return jsonResponse(context, 400, { error: 'Reference title is required.' });
  }

  if (!sourcePath && !sourceText?.trim()) {
    return jsonResponse(context, 400, { error: 'Reference sourcePath or sourceText is required.' });
  }

  if (getOptionalString(body, 'sourceType') && !sourceType) {
    return jsonResponse(context, 400, { error: 'Reference sourceType is invalid.' });
  }

  if (getOptionalString(body, 'rights') && !rights) {
    return jsonResponse(context, 400, { error: 'Reference rights is invalid.' });
  }

  if (Array.isArray(body.allowedUsage) && allowedUsage.length !== body.allowedUsage.length) {
    return jsonResponse(context, 400, { error: 'Reference allowedUsage contains invalid values.' });
  }

  try {
    const result = await importReferenceWork({
      workspaceRoot,
      title,
      sourcePath,
      sourceText,
      originalFileName: getOptionalString(body, 'originalFileName'),
      sourceType,
      rights,
      allowedUsage: allowedUsage.length ? allowedUsage : undefined,
      enabled: body.enabled === false ? false : true,
      notes: getOptionalString(body, 'notes'),
    });

    return jsonResponse(context, 200, result);
  } catch (error) {
    return jsonResponse(context, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleUpdateReferenceWork(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);

  if (typeof body.enabled !== 'boolean') {
    return jsonResponse(context, 400, { error: 'Reference enabled must be a boolean.' });
  }

  try {
    const reference = await setReferenceEnabled(workspaceRoot, id, body.enabled);
    return jsonResponse(context, 200, { reference });
  } catch (error) {
    return jsonResponse(context, 404, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleSelectReferenceContext(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const tokenBudget = getOptionalNumber(body, 'tokenBudget');
  const maxReferences = getOptionalNumber(body, 'maxReferences');
  const selection = await selectReferenceContext({
    workspaceRoot,
    tokenBudget,
    maxReferences,
  });

  return jsonResponse(context, 200, { selection });
}

async function handleGitStatus(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  return jsonResponse(context, 200, await readGitStatus(workspaceRoot));
}

async function handleGitLog(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const maxCount = Number(context.req.query('maxCount') ?? 30);
  const result = await listGitCommits(workspaceRoot, {
    maxCount: Number.isFinite(maxCount) ? maxCount : 30,
  });

  return jsonResponse(context, result.error ? 409 : 200, result);
}

async function handleGitShow(
  options: NovelBackendOptions,
  state: BackendState,
  hash: string,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const result = await showGitCommit(workspaceRoot, hash);

  return jsonResponse(context, 'error' in result ? 409 : 200, result);
}

async function handleGitDiff(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const files = context.req.queries('file') ?? [];

  try {
    return jsonResponse(context, 200, {
      diff: await gitDiff(workspaceRoot, files),
    });
  } catch (error) {
    return jsonResponse(context, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleGitCommit(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const message = getOptionalString(body, 'message')?.trim();

  if (!message) {
    return jsonResponse(context, 400, { error: 'Commit message is required.' });
  }

  const status = await readGitStatus(workspaceRoot);
  if (!status.repository || status.status === 'unknown') {
    return jsonResponse(context, 409, {
      status: 'failed',
      message,
      error: status.error ?? {
        code: 'not_git_repository',
        message: 'Workspace is not a Git repository.',
      },
    });
  }

  const dirtyFiles = status.files.map((file) => file.path);
  const requestedFiles = readStringArray(body, 'files');
  const files = requestedFiles.length ? requestedFiles : dirtyFiles;
  const invalidFiles = files.filter((file) => !dirtyFiles.includes(file));

  if (invalidFiles.length > 0) {
    return jsonResponse(context, 400, {
      error: `Commit files must come from current dirty status: ${invalidFiles.join(', ')}`,
    });
  }

  const result = await commitFiles({
    workspaceRoot,
    files,
    message,
  });

  return jsonResponse(context, result.status === 'committed' ? 200 : 409, result);
}

async function handleGitSync(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const result = await syncGit(workspaceRoot);

  return jsonResponse(context, result.status === 'synced' ? 200 : 409, result);
}

async function handleOpenExternalEditor(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = await realpath(requireActiveWorkspaceRoot(options, state));
  const body = await readJsonBody(context);
  const editor = getOptionalString(body, 'editor');
  const command = editor ? externalEditorCommand(editor) : undefined;

  if (!command) {
    return jsonResponse(context, 400, { error: 'External editor is not supported.' });
  }

  try {
    await execFileAsync(command.executable, [...command.args, workspaceRoot]);
    return jsonResponse(context, 200, { opened: true, editor });
  } catch (error) {
    return jsonResponse(context, 409, {
      opened: false,
      editor,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleWorkspaceProjectHealth(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const pendingActions = await listPendingActions({ workspaceRoot });
  const health = await readProjectHealth(workspaceRoot, {
    pendingActionCount: pendingActions.length,
  });

  return jsonResponse(context, 200, { health });
}

async function handleWorkspaceProjectionRebuild(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);

  try {
    const documents = await writeWorkspaceProjections(workspaceRoot);
    return jsonResponse(context, 200, {
      projections: documents.map((document) => ({
        target: document.target,
        path: document.path,
      })),
      warnings: [
        'Projection files are generated read-models under .oan/indexes and are not canonical truth.',
      ],
    });
  } catch (error) {
    return jsonResponse(context, 409, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleListPlaySessions(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  return jsonResponse(context, 200, { sessions: await listPlaySessions(workspaceRoot) });
}

async function handleCreatePlaySession(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const title = getOptionalString(body, 'title')?.trim();
  const sceneStart = getOptionalString(body, 'sceneStart')?.trim();

  if (!title || !sceneStart) {
    return jsonResponse(context, 400, { error: 'Play session title and sceneStart are required.' });
  }

  try {
    const session = createPlaySessionDraft({
      id: getOptionalString(body, 'id')?.trim() || createPlaySessionId(),
      title,
      userPersona: getOptionalString(body, 'userPersona')?.trim(),
      sceneStart,
      characters: readStringArray(body, 'characters'),
      activatedSources: readPlayActivatedSources(body),
    });
    const files = await writePlaySessionFiles(workspaceRoot, session);
    return jsonResponse(context, 200, { session, files });
  } catch (error) {
    return jsonResponse(context, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleReadPlaySession(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);

  try {
    return jsonResponse(context, 200, {
      session: await readPlaySessionFiles(workspaceRoot, id),
    });
  } catch (error) {
    return jsonResponse(context, 404, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleAppendPlayTranscript(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const turn = readPlayTranscriptTurn(body);

  if (!turn) {
    return jsonResponse(context, 400, { error: 'speaker and content are required.' });
  }

  const session = await readPlaySessionFiles(workspaceRoot, id);
  const next: PlaySession = {
    ...session,
    transcript: [...session.transcript, turn],
  };
  await writePlaySessionFiles(workspaceRoot, next);

  return jsonResponse(context, 200, { session: next });
}

async function handleAddPlayObservation(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const observation = readPlayObservation(body);

  if (!observation) {
    return jsonResponse(context, 400, { error: 'observation summary and evidence are required.' });
  }

  const session = await readPlaySessionFiles(workspaceRoot, id);
  const next: PlaySession = {
    ...session,
    observations: [...session.observations, observation],
  };
  await writePlaySessionFiles(workspaceRoot, next);

  return jsonResponse(context, 200, { session: next });
}

async function handleAddPlayAdoptionCandidate(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const candidate = readPlayAdoptionCandidate(body);

  if (!candidate) {
    return jsonResponse(context, 400, {
      error: 'adoption target, summary, and evidence are required.',
    });
  }

  const session = await readPlaySessionFiles(workspaceRoot, id);
  const next: PlaySession = {
    ...session,
    adoptionCandidates: [...session.adoptionCandidates, candidate],
  };
  await writePlaySessionFiles(workspaceRoot, next);

  return jsonResponse(context, 200, { session: next, candidate });
}

async function handlePlayWorldRefereeTurn(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  context: NovelBackendContext,
): Promise<Response> {
  await ensureProviderConfigLoaded(options, state);
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const providerConfig = options.providerConfig ?? getDefaultLlmProviderConfig(state.providerConfigState);

  if (!providerConfig || !options.resolveModel) {
    return jsonResponse(context, 409, {
      error: 'World referee turn requires model mode with provider config.',
    });
  }

  const body = await readJsonBody(context);
  const userText = getOptionalString(body, 'userText')?.trim();
  let session = await readPlaySessionFiles(workspaceRoot, id);

  if (userText) {
    session = {
      ...session,
      transcript: [
        ...session.transcript,
        {
          speaker: 'user',
          content: userText,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  const result = await runNovelAgentTurn({
    providerConfig,
    resolveModel: options.resolveModel,
    workspaceRoot,
    workspace: await loadNovelAgentWorkspaceSnapshot(workspaceRoot),
    request: [
      formatPlayWorldRefereePrompt(session),
      '',
      userText ? `User turn: ${userText}` : 'Continue the Play scene by one world referee turn.',
    ].join('\n'),
    skill: await loadNovelCopilotSkill({ workspaceRoot }),
    tools: options.tools,
    session: { metadata: { title: `Play ${session.id}` } },
  });
  const refereeText = result.assistantMessage?.content?.trim();
  const next = refereeText
    ? {
        ...session,
        transcript: [
          ...session.transcript,
          {
            speaker: 'world-referee',
            content: refereeText,
            createdAt: new Date().toISOString(),
          },
        ],
      }
    : session;
  await writePlaySessionFiles(workspaceRoot, next);

  return jsonResponse(context, 200, { session: next, result });
}

async function handleCreatePlayAdoptionPendingAction(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  candidateId: string,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const session = await readPlaySessionFiles(workspaceRoot, id);
  const candidate = session.adoptionCandidates.find((item) => item.id === candidateId);

  if (!candidate) {
    return jsonResponse(context, 404, { error: `Adoption candidate not found: ${candidateId}` });
  }

  const payload = isRecord(body.payload) ? body.payload : candidate.payload;
  const toolRequest = createPlayAdoptionToolRequest(candidate.target, payload);

  if ('error' in toolRequest) {
    return jsonResponse(context, 400, { error: toolRequest.error });
  }

  const result = await executeWriteIntentTool(
    createWriteIntentTools({ workspaceRoot }),
    toolRequest.toolName,
    toolRequest.args,
  );

  return jsonResponse(context, 200, {
    candidate,
    pendingActionResult: result,
    refresh: await buildPostDecisionRefresh(workspaceRoot),
  });
}

async function handleSaveWorkspaceOnboarding(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const body = await readJsonBody(context);
  const config = await saveWorkspaceOnboarding(workspaceRoot, {
    novelName: getOptionalString(body, 'novelName'),
    inspiration: getOptionalString(body, 'inspiration'),
    characterSeed: getOptionalString(body, 'characterSeed'),
    startGoal: getOptionalString(body, 'startGoal'),
    skipped: body.skipped === true,
  });
  const validation = await validateOanWorkspace(workspaceRoot);

  if (!validation.ok) {
    return jsonResponse(context, 400, {
      error: validation.reason ?? 'Workspace config became invalid.',
    });
  }

  const workspaces = await upsertLauncherWorkspace(options, {
    name: validation.name,
    path: validation.path,
    novelName: validation.novelName,
    lastOpenedAt: new Date().toISOString(),
  });

  return jsonResponse(context, 200, {
    config,
    workspace: workspaces.find((item) => item.path === validation.path),
  });
}

async function handleListPendingActions(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const pendingActions = await listPendingActions({ workspaceRoot });

  return jsonResponse(context, 200, { pendingActions });
}

async function handlePendingActionDecision(
  options: NovelBackendOptions,
  state: BackendState,
  id: string,
  decision: 'accept' | 'reject',
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const gitConfig = await readWorkspaceGitConfig(workspaceRoot);
  const result = decision === 'accept'
    ? await acceptPendingAction({
        workspaceRoot,
        id,
        autoCommitOnAccept: gitConfig.autoCommitOnAccept,
      })
    : await rejectPendingAction({ workspaceRoot, id });

  return jsonResponse(context, 200, {
    ...result,
    refresh: await buildPostDecisionRefresh(workspaceRoot),
  });
}

async function handleWorkspaceChapterRescan(
  options: NovelBackendOptions,
  state: BackendState,
  context: NovelBackendContext,
): Promise<Response> {
  const workspaceRoot = requireActiveWorkspaceRoot(options, state);
  const index = await writeChapterIndexFile({ workspaceRoot });
  const status = await readChapterIndexStatus({ workspaceRoot });

  return jsonResponse(context, 200, { index, status });
}

async function createRuntimeEventStream(
  options: NovelBackendOptions,
  state: BackendState,
  input: NovelBackendAgentInput,
): Promise<AsyncIterable<RuntimeEvent>> {
  if (options.runAgent) {
    return options.runAgent(input);
  }

  const providerConfig = options.providerConfig ?? getDefaultLlmProviderConfig(state.providerConfigState);
  const shouldUseModel = options.mode === 'model' || Boolean(providerConfig);

  if (shouldUseModel) {
    if (!providerConfig || !options.resolveModel) {
      throw new Error('Model mode requires provider config and a model resolver.');
    }

    const [workspace, skill] = await Promise.all([
      loadNovelAgentWorkspaceSnapshot(input.workspaceRoot),
      loadNovelCopilotSkill({ workspaceRoot: input.workspaceRoot }),
    ]);
    const capability = inferNovelAgentCapability(input.request, skill.quickCommands);
    const pendingActions = await listPendingActions({ workspaceRoot: input.workspaceRoot });
    const [projectHealth, referenceSelection] = await Promise.all([
      readProjectHealth(input.workspaceRoot, {
        pendingActionCount: pendingActions.length,
      }),
      selectReferenceContext({
        workspaceRoot: input.workspaceRoot,
        capability,
        goal: input.request,
        tokenBudget: 1_500,
        maxReferences: 3,
      }),
    ]);
    const selectedContext = [
      ...(projectHealth.issues.length
        ? [{
            kind: 'selected' as const,
            title: 'Project Health Guardrails',
            content: formatProjectHealthMarkdown(projectHealth),
          }]
        : []),
      ...(
        referenceSelection.included.length || referenceSelection.omitted.length
          ? [{
              kind: 'selected' as const,
              title: 'Reference Context Selection',
              content: formatReferenceContextSelectionMarkdown(referenceSelection),
            }]
          : []
      ),
    ];

    return streamNovelAgentTurn({
      providerConfig,
      resolveModel: options.resolveModel,
      workspaceRoot: input.workspaceRoot,
      workspace,
      request: input.request,
      skill,
      tools: options.tools,
      referenceSelection,
      projectHealth,
      selectedContext,
      session: { metadata: { title: input.request } },
    });
  }

  return streamNovelAgentCheckpointTurn({
    workspaceRoot: input.workspaceRoot,
    request: input.request,
    tools: options.tools,
  });
}

async function loadNovelAgentWorkspaceSnapshot(workspaceRoot: string): Promise<{
  workspaceRoot: string;
  constitution?: string;
  workflow?: string;
  summaries?: string[];
  state?: string;
  timeline?: string;
  foreshadow?: string;
}> {
  const [
    constitution,
    workflow,
    summaries,
    stateFiles,
    timelineFiles,
    foreshadowFiles,
  ] = await Promise.all([
    readMarkdownDirectoryAsContext(join(workspaceRoot, '.oan', 'constitution')),
    readTextFileIfExists(join(workspaceRoot, '.oan', 'workflow.yaml')),
    readContextFiles(join(workspaceRoot, 'summaries'), ['.md']),
    readContextFiles(join(workspaceRoot, 'state'), ['.yaml', '.yml']),
    readContextFiles(join(workspaceRoot, 'timeline'), ['.yaml', '.yml', '.md']),
    readContextFiles(join(workspaceRoot, 'foreshadow'), ['.yaml', '.yml', '.md']),
  ]);

  return {
    workspaceRoot,
    constitution,
    workflow,
    summaries,
    state: stateFiles?.join('\n\n'),
    timeline: timelineFiles?.join('\n\n'),
    foreshadow: foreshadowFiles?.join('\n\n'),
  };
}

async function readMarkdownDirectoryAsContext(directory: string): Promise<string | undefined> {
  const files = await readContextFiles(directory, ['.md']);
  return files?.join('\n\n');
}

async function readContextFiles(
  directory: string,
  extensions: string[],
): Promise<string[] | undefined> {
  const files = await listContextFiles(directory, extensions);
  const selectedFiles = files.slice(0, 12);
  const contents = await Promise.all(
    selectedFiles.map(async (filePath) => {
      const content = await readTextFileIfExists(filePath);
      return content ? `# ${relative(directory, filePath)}\n\n${content}` : undefined;
    }),
  );
  const compact = contents.filter((content): content is string => Boolean(content));

  return compact.length ? compact : undefined;
}

async function listContextFiles(directory: string, extensions: string[]): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.flatMap(async (entry) => {
        const filePath = join(directory, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          return listContextFiles(filePath, extensions);
        }

        if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
          return [filePath];
        }

        return [];
      }),
    );

    return files.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function readTextFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
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
      const state = parsed.state as unknown as LlmProviderConfigState;

      return {
        ...state,
        providers: state.providers.map(normalizeLlmProviderConfig),
      };
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
  const normalizedState: LlmProviderConfigState = {
    ...state,
    providers: state.providers.map(normalizeLlmProviderConfig),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({
      kind: 'llm-provider-config',
      version: 1,
      state: normalizedState,
    }, null, 2)}\n`,
    'utf-8',
  );
}

function providerConfigFilePath(options: NovelBackendOptions): string {
  return join(resolveGlobalConfigDir(options), 'llm-providers.json');
}

function isSupportedProviderKind(value: string): value is LlmProviderKind {
  return [
    'openai',
    'openai-compatible',
    'deepseek',
    'opencode-go',
    'xiaomi-mimo',
    'ollama',
    'custom',
  ].includes(value);
}

function isThemePreference(value: string): value is ThemePreference {
  return value === 'light' || value === 'dark';
}

function isComposerSubmitShortcutPreference(
  value: string,
): value is ComposerSubmitShortcutPreference {
  return value === 'enter' || value === 'meta-enter' || value === 'ctrl-enter';
}

function providerDefaultBaseUrl(kind: LlmProviderKind): string | undefined {
  const presets: Partial<Record<LlmProviderKind, string>> = {
    openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com',
    'opencode-go': 'https://api.opencodego.com/v1',
    'xiaomi-mimo': 'https://api.mimo.mi.com/v1',
    ollama: 'http://127.0.0.1:11434/v1',
  };

  return presets[kind];
}

function providerRequiresApiKey(kind: LlmProviderKind): boolean {
  return kind !== 'ollama';
}

function normalizeProviderBaseUrl(value?: string): string | undefined {
  const baseUrl = value?.trim();
  return baseUrl ? baseUrl.replace(/\/+$/u, '') : undefined;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

async function fetchProviderModelList(input: {
  kind: LlmProviderKind;
  baseUrl: string;
  apiKey?: string;
}): Promise<
  | { ok: true; models: LlmProviderModel[] }
  | { ok: false; status: number; error: string }
> {
  if (input.kind === 'ollama') {
    return fetchOllamaModelList(input.baseUrl);
  }

  const modelsUrl = new URL('models', ensureTrailingSlash(input.baseUrl)).toString();
  const modelsResponse = await fetch(modelsUrl, {
    headers: createProviderAuthHeaders(input.apiKey),
  });
  const data = await modelsResponse.json() as unknown;

  if (!modelsResponse.ok) {
    return {
      ok: false,
      status: modelsResponse.status,
      error: readProviderErrorMessage(data) ?? 'Failed to fetch model list.',
    };
  }

  return {
    ok: true,
    models: extractOpenAiCompatibleModels(data),
  };
}

async function fetchOllamaModelList(baseUrl: string): Promise<
  | { ok: true; models: LlmProviderModel[] }
  | { ok: false; status: number; error: string }
> {
  const modelsResponse = await fetch(ollamaTagsUrl(baseUrl));
  const data = await modelsResponse.json() as unknown;

  if (!modelsResponse.ok) {
    return {
      ok: false,
      status: modelsResponse.status,
      error: readProviderErrorMessage(data) ?? 'Failed to fetch Ollama model list.',
    };
  }

  return {
    ok: true,
    models: extractOllamaModels(data),
  };
}

function ollamaTagsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const trimmedPath = url.pathname.replace(/\/+$/u, '');

  url.pathname = trimmedPath.endsWith('/v1')
    ? `${trimmedPath.slice(0, -3)}/api/tags`
    : `${trimmedPath}/api/tags`;
  url.search = '';
  url.hash = '';

  return url.toString();
}

function createProviderAuthHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function extractOpenAiCompatibleModels(data: unknown): LlmProviderModel[] {
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return [];
  }

  return data.data
    .map((item): LlmProviderModel | undefined => {
      if (!isRecord(item) || typeof item.id !== 'string') {
        return undefined;
      }

      const model: LlmProviderModel = { id: item.id };

      if (typeof item.name === 'string') {
        model.displayName = item.name;
      }

      if (typeof item.context_length === 'number') {
        model.contextWindow = item.context_length;
      }

      return model;
    })
    .filter((item): item is LlmProviderModel => Boolean(item));
}

function extractOllamaModels(data: unknown): LlmProviderModel[] {
  if (!isRecord(data) || !Array.isArray(data.models)) {
    return [];
  }

  return data.models
    .map((item): LlmProviderModel | undefined => {
      if (!isRecord(item)) {
        return undefined;
      }

      const id = getOptionalString(item, 'model')?.trim()
        || getOptionalString(item, 'name')?.trim();

      if (!id) {
        return undefined;
      }

      const model: LlmProviderModel = { id };
      const details = isRecord(item.details) ? item.details : undefined;
      const parameterSize = details
        ? getOptionalString(details, 'parameter_size')?.trim()
        : undefined;

      if (parameterSize) {
        model.displayName = `${id} (${parameterSize})`;
      }

      return model;
    })
    .filter((item): item is LlmProviderModel => Boolean(item));
}

function readProviderErrorMessage(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  if (typeof data.error === 'string') {
    return data.error;
  }

  if (typeof data.message === 'string') {
    return data.message;
  }

  if (isRecord(data.error) && typeof data.error.message === 'string') {
    return data.error.message;
  }

  return undefined;
}

async function checkOpenAiCompatibleProvider(input: {
  baseUrl: string;
  apiKey?: string;
  model: string;
}): Promise<{
  ok: boolean;
  model: string;
  latencyMs: number;
  status?: number;
  message: string;
}> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const chatUrl = new URL('chat/completions', ensureTrailingSlash(input.baseUrl)).toString();
    const providerResponse = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        ...createProviderAuthHeaders(input.apiKey),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          {
            role: 'system',
            content: 'You are a connectivity check. Reply with OK only.',
          },
          {
            role: 'user',
            content: 'Reply OK.',
          },
        ],
        max_tokens: 4,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    const data = await readProviderResponse(providerResponse);
    const latencyMs = Date.now() - startedAt;

    if (!providerResponse.ok) {
      return {
        ok: false,
        model: input.model,
        latencyMs,
        status: providerResponse.status,
        message: readProviderErrorMessage(data)
          ?? `Model check failed with HTTP ${providerResponse.status}.`,
      };
    }

    return {
      ok: true,
      model: input.model,
      latencyMs,
      status: providerResponse.status,
      message: extractOpenAiCompatibleReplyText(data) ?? '模型检测通过。',
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';

    return {
      ok: false,
      model: input.model,
      latencyMs: Date.now() - startedAt,
      message: aborted
        ? 'Model check timed out after 15s.'
        : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readProviderResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function extractOpenAiCompatibleReplyText(data: unknown): string | undefined {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return undefined;
  }

  for (const choice of data.choices) {
    if (!isRecord(choice)) {
      continue;
    }

    if (isRecord(choice.message) && typeof choice.message.content === 'string') {
      return choice.message.content.trim() || undefined;
    }

    if (typeof choice.text === 'string') {
      return choice.text.trim() || undefined;
    }
  }

  return undefined;
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

async function readWorkspaceGitConfig(workspaceRoot: string): Promise<{
  autoCommitOnAccept: boolean;
}> {
  try {
    const config = await loadWorkspaceConfig(workspaceRoot);
    const git = isRecord(config.git) ? config.git : {};

    return {
      autoCommitOnAccept: typeof git.autoCommitOnAccept === 'boolean'
        ? git.autoCommitOnAccept
        : true,
    };
  } catch {
    return { autoCommitOnAccept: true };
  }
}

function externalEditorCommand(editor: string): {
  executable: string;
  args: string[];
} | undefined {
  const commands: Record<string, { executable: string; args: string[] }> = {
    vscode: { executable: 'code', args: [] },
    zed: { executable: 'zed', args: [] },
    webstorm: { executable: 'webstorm', args: [] },
  };

  return commands[editor];
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

async function buildPostDecisionRefresh(workspaceRoot: string): Promise<{
  workspaceStatus: {
    pendingActionCount: number;
    git: Awaited<ReturnType<typeof readGitStatus>>;
    gitConfig: Awaited<ReturnType<typeof readWorkspaceGitConfig>>;
  };
  projectHealth: ProjectHealth;
}> {
  const pendingActions = await listPendingActions({ workspaceRoot });
  const [gitStatus, projectHealth, gitConfig] = await Promise.all([
    readGitStatus(workspaceRoot),
    readProjectHealth(workspaceRoot, {
      pendingActionCount: pendingActions.length,
    }),
    readWorkspaceGitConfig(workspaceRoot),
  ]);

  return {
    workspaceStatus: {
      pendingActionCount: pendingActions.length,
      git: gitStatus,
      gitConfig,
    },
    projectHealth,
  };
}

function createPlaySessionId(): string {
  return `play-${randomUUID()}`;
}

function readPlayActivatedSources(value: Record<string, unknown>): PlayActivatedSource[] {
  const raw = value.activatedSources;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item): PlayActivatedSource | undefined => {
      if (!isRecord(item)) {
        return undefined;
      }

      const sourceId = getOptionalString(item, 'sourceId')?.trim();
      const reason = getOptionalString(item, 'reason')?.trim();

      if (!sourceId || !reason) {
        return undefined;
      }

      return {
        sourceId,
        path: getOptionalString(item, 'path')?.trim(),
        reason,
        budgetLayer: readBudgetLayer(item, 'budgetLayer') ?? 'L2',
        semanticBoundary: readSemanticBoundary(item, 'semanticBoundary') ?? 'compressible',
        trust: readPlaySourceTrust(item, 'trust') ?? 'playLocal',
      };
    })
    .filter((item): item is PlayActivatedSource => Boolean(item));
}

function readPlayTranscriptTurn(value: Record<string, unknown>): PlayTranscriptTurn | undefined {
  const speaker = getOptionalString(value, 'speaker')?.trim();
  const content = getOptionalString(value, 'content')?.trim();

  if (!speaker || !content) {
    return undefined;
  }

  return {
    speaker,
    content,
    createdAt: getOptionalString(value, 'createdAt') ?? new Date().toISOString(),
  };
}

function readPlayObservation(value: Record<string, unknown>): PlayObservation | undefined {
  const summary = getOptionalString(value, 'summary')?.trim();
  const evidence = getOptionalString(value, 'evidence')?.trim();

  if (!summary || !evidence) {
    return undefined;
  }

  return {
    id: getOptionalString(value, 'id')?.trim() || `obs-${randomUUID()}`,
    summary,
    evidence,
    canonical: false,
  };
}

function readPlayAdoptionCandidate(
  value: Record<string, unknown>,
): PlayAdoptionCandidate | undefined {
  const target = readPlayAdoptionTarget(value, 'target');
  const summary = getOptionalString(value, 'summary')?.trim();
  const evidence = getOptionalString(value, 'evidence')?.trim();

  if (!target || !summary || !evidence) {
    return undefined;
  }

  return createPlayAdoptionCandidate({
    id: getOptionalString(value, 'id')?.trim() || `adopt-${randomUUID()}`,
    target,
    summary,
    evidence,
    ...(isRecord(value.payload) ? { payload: value.payload } : {}),
  });
}

function createPlayAdoptionToolRequest(
  target: PlayAdoptionTarget,
  payload: Record<string, unknown> | undefined,
):
  | { toolName: string; args: Record<string, unknown> }
  | { error: string } {
  if (!payload) {
    return { error: 'Adoption payload is required before creating a PendingAction.' };
  }

  if (target === 'chapterDraft') {
    const chapterId = getOptionalString(payload, 'chapterId')?.trim();
    const content = getOptionalString(payload, 'content')?.trim();

    if (!chapterId || !content) {
      return { error: 'chapterDraft adoption requires chapterId and content.' };
    }

    return {
      toolName: 'chapter.createDraft',
      args: omitUndefined({
        chapterId,
        content,
        title: getOptionalString(payload, 'title')?.trim(),
        file: getOptionalString(payload, 'file')?.trim(),
        mode: getOptionalString(payload, 'mode')?.trim(),
      }),
    };
  }

  if (target === 'state') {
    const file = getOptionalString(payload, 'file')?.trim();
    const path = getOptionalString(payload, 'path')?.trim();

    if (!file || !path || !Object.prototype.hasOwnProperty.call(payload, 'value')) {
      return { error: 'state adoption requires file, path, and value.' };
    }

    return {
      toolName: 'state.set',
      args: {
        file,
        path,
        value: payload.value,
      },
    };
  }

  if (target === 'timeline') {
    if (!Object.prototype.hasOwnProperty.call(payload, 'event')) {
      return { error: 'timeline adoption requires event.' };
    }

    return {
      toolName: 'timeline.add',
      args: omitUndefined({
        event: payload.event,
        file: getOptionalString(payload, 'file')?.trim(),
        path: getOptionalString(payload, 'path')?.trim(),
      }),
    };
  }

  if (!Object.prototype.hasOwnProperty.call(payload, 'item')) {
    return { error: 'foreshadow adoption requires item.' };
  }

  return {
    toolName: 'foreshadow.create',
    args: omitUndefined({
      item: payload.item,
      file: getOptionalString(payload, 'file')?.trim(),
      path: getOptionalString(payload, 'path')?.trim(),
    }),
  };
}

async function executeWriteIntentTool(
  tools: ToolSet,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const executable = tools[name] as {
    execute?: (args: unknown, context: unknown) => Promise<unknown> | unknown;
  };

  if (!executable?.execute) {
    throw new Error(`Write-intent tool is not available: ${name}`);
  }

  return executable.execute(args, {});
}

function readBudgetLayer(
  value: Record<string, unknown>,
  key: string,
): PlayActivatedSource['budgetLayer'] | undefined {
  const raw = getOptionalString(value, key);
  return raw && ['L0', 'L1', 'L2', 'L3'].includes(raw)
    ? raw as PlayActivatedSource['budgetLayer']
    : undefined;
}

function readSemanticBoundary(
  value: Record<string, unknown>,
  key: string,
): PlayActivatedSource['semanticBoundary'] | undefined {
  const raw = getOptionalString(value, key);
  return raw && ['protected', 'compressible', 'excluded'].includes(raw)
    ? raw as PlayActivatedSource['semanticBoundary']
    : undefined;
}

function readPlaySourceTrust(
  value: Record<string, unknown>,
  key: string,
): PlayActivatedSource['trust'] | undefined {
  const raw = getOptionalString(value, key);
  return raw && ['canonical', 'interactionHint', 'playLocal', 'modelImprovisation'].includes(raw)
    ? raw as PlayActivatedSource['trust']
    : undefined;
}

function readPlayAdoptionTarget(
  value: Record<string, unknown>,
  key: string,
): PlayAdoptionTarget | undefined {
  const raw = getOptionalString(value, key);
  return raw && ['chapterDraft', 'state', 'timeline', 'foreshadow'].includes(raw)
    ? raw as PlayAdoptionTarget
    : undefined;
}

function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
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

async function readJsonBody(context: NovelBackendContext): Promise<JsonBody> {
  const text = await context.req.text();

  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text) as JsonBody;
}

function getOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function getOptionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : undefined;
}

function readStringArray(value: Record<string, unknown>, key: string): string[] {
  const raw = value[key];

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readReferenceSourceType(
  value: Record<string, unknown>,
  key: string,
): ReferenceSourceType | undefined {
  const raw = getOptionalString(value, key);
  return raw && isReferenceSourceType(raw) ? raw : undefined;
}

function readReferenceRights(
  value: Record<string, unknown>,
  key: string,
): ReferenceRights | undefined {
  const raw = getOptionalString(value, key);
  return raw && isReferenceRights(raw) ? raw : undefined;
}

function readReferenceAllowedUsageArray(
  value: Record<string, unknown>,
  key: string,
): ReferenceAllowedUsage[] {
  return readStringArray(value, key)
    .filter((item): item is ReferenceAllowedUsage => isReferenceAllowedUsage(item));
}

function isReferenceSourceType(value: string): value is ReferenceSourceType {
  return ['novel', 'chapterSample', 'styleSample', 'settingBible', 'notes'].includes(value);
}

function isReferenceRights(value: string): value is ReferenceRights {
  return ['owned', 'publicDomain', 'licensed', 'excerpt', 'unknown'].includes(value);
}

function isReferenceAllowedUsage(value: string): value is ReferenceAllowedUsage {
  return [
    'analysisOnly',
    'styleInspiration',
    'structureReference',
    'noDirectQuotation',
  ].includes(value);
}

function readProviderModels(value: Record<string, unknown>): LlmProviderModel[] {
  const rawModels = Array.isArray(value.models) ? value.models : [];

  return rawModels
    .map((item): LlmProviderModel | undefined => {
      if (!isRecord(item)) {
        return undefined;
      }

      const id = getOptionalString(item, 'id')?.trim();
      if (!id) {
        return undefined;
      }

      const model: LlmProviderModel = {
        id,
        default: item.default === true,
      };
      const displayName = getOptionalString(item, 'displayName')?.trim();
      const contextWindow = getOptionalNumber(item, 'contextWindow');
      const maxOutputTokens = getOptionalNumber(item, 'maxOutputTokens');

      if (displayName) {
        model.displayName = displayName;
      }

      if (contextWindow !== undefined) {
        model.contextWindow = contextWindow;
      }

      if (maxOutputTokens !== undefined) {
        model.maxOutputTokens = maxOutputTokens;
      }

      return model;
    })
    .filter((item): item is LlmProviderModel => Boolean(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function jsonResponse(
  _context: NovelBackendContext,
  statusCode: number,
  payload: unknown,
): Response {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export type { LanguageModel };
