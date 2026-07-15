import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

import {
  NOVEL_COPILOT_QUICK_COMMANDS,
  createContextPackageDraft,
  createSessionResumeBoundary,
  formatAuthorReportMarkdown,
  formatContextPackageSummary,
  writeAgentSessionArtifact,
  writeContextPackageArtifact,
} from '@oh-awesome-novel/core';
import type {
  AgentSessionArtifact,
  AuthorReport,
  ContextBudgetLayer,
  ContextPackage,
  ContextSourceId,
  ContextSourceRef,
  ContextTraceEntry,
  LlmProviderConfig,
  NovelCopilotCapabilityId,
  NovelCopilotQuickCommand,
  NovelCopilotSkill,
  ProjectHealth,
  ReferenceContextSelection,
  SemanticBoundary,
} from '@oh-awesome-novel/core';
import { createReadTools, createWriteIntentTools } from '@oh-awesome-novel/tools';
import { createRuntime } from '@oh-awesome-novel/runtime';
import { createAgentSessionStore } from './session-store';
import type {
  RunTurnResult,
  RunTurnInput,
  RuntimeEvent,
  RuntimeSession,
  RuntimeContextItem,
  RuntimeMessage,
  RuntimeModelAdapter,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeModelStreamEvent,
  RuntimeSkill,
  RuntimeToolCall,
} from '@oh-awesome-novel/runtime';
import type {
  AgentSessionMetadata,
  AgentSessionMetadataInput,
  AgentSessionStore,
} from './session-store';
import type {
  LanguageModel,
  ModelMessage,
  ToolSet,
} from 'ai';

export interface NovelAgentWorkspaceSnapshot {
  workspaceRoot: string;
  constitution?: string;
  workflow?: string;
  summaries?: string[];
  state?: string;
  timeline?: string;
  foreshadow?: string;
  contextFiles?: NovelAgentWorkspaceContextFile[];
}

export interface NovelAgentWorkspaceContextFile {
  sourceId: ContextSourceId | string;
  path: string;
  title?: string;
}

export interface NovelAgentMessageInput {
  request: string;
  workspace: NovelAgentWorkspaceSnapshot;
  abortSignal?: AbortSignal;
  skill?: RuntimeSkill;
  contextPackage?: ContextPackage;
  referenceSelection?: ReferenceContextSelection;
  projectHealth?: ProjectHealth;
  selectedContext?: RuntimeContextItem[];
  priorMessages?: RuntimeMessage[];
}

export interface NovelAgentMessageAssembly {
  messages: RuntimeMessage[];
  context: RuntimeContextItem[];
  skill?: RuntimeSkill;
}

export interface NovelAgentToolSetInput {
  workspaceRoot: string;
  tools?: ToolSet;
}

export interface NovelAgentSessionInput {
  id?: string;
  metadata?: AgentSessionMetadataInput;
  store?: AgentSessionStore;
}

export interface NovelAgentContextPackageInput {
  request: string;
  workspace: NovelAgentWorkspaceSnapshot;
  skill?: RuntimeSkill | Pick<NovelCopilotSkill, 'quickCommands'>;
  capability?: NovelCopilotCapabilityId;
  createdAt?: string;
  referenceSelection?: ReferenceContextSelection;
  projectHealth?: ProjectHealth;
}

export interface NovelAgentSessionArtifactWriteResult {
  artifactPaths: string[];
  authorReport: string;
}

export type AiSdkProviderResolver = (
  providerConfig: LlmProviderConfig,
) => LanguageModel | Promise<LanguageModel>;

export const createAiSdkProviderResolver = (): AiSdkProviderResolver =>
  (providerConfig) => {
    const baseURL = resolveProviderBaseUrl(providerConfig);
    const apiKey = resolveProviderApiKey(providerConfig);
    const provider = createOpenAI({
      name: providerConfig.kind === 'custom' ? providerConfig.id : providerConfig.kind,
      ...(baseURL ? { baseURL } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(providerConfig.headers ? { headers: providerConfig.headers } : {}),
    });

    return provider.chat(providerConfig.model);
  };

function resolveProviderBaseUrl(providerConfig: LlmProviderConfig): string | undefined {
  if (providerConfig.baseUrl?.trim()) {
    return providerConfig.baseUrl.trim();
  }

  if (providerConfig.kind === 'ollama') {
    return 'http://127.0.0.1:11434/v1';
  }

  if (providerConfig.kind === 'deepseek') {
    return 'https://api.deepseek.com';
  }

  if (providerConfig.kind === 'opencode-go') {
    return 'https://api.opencodego.com/v1';
  }

  if (providerConfig.kind === 'xiaomi-mimo') {
    return 'https://api.mimo.mi.com/v1';
  }

  return undefined;
}

function resolveProviderApiKey(providerConfig: LlmProviderConfig): string | undefined {
  const apiKey = providerConfig.apiKey?.trim();

  if (apiKey) {
    return apiKey;
  }

  if (providerConfig.kind === 'ollama') {
    return 'ollama';
  }

  return undefined;
}

export interface AiSdkModelAdapterInput {
  providerConfig: LlmProviderConfig;
  resolveModel: AiSdkProviderResolver;
}

export interface NovelAgentRuntimeInput extends AiSdkModelAdapterInput {
  workspaceRoot: string;
  tools?: ToolSet;
  maxToolLoops?: number;
  onEvent?: (event: RuntimeEvent) => void | Promise<void>;
}

export const createAiSdkModelAdapter = (
  input: AiSdkModelAdapterInput,
): RuntimeModelAdapter => ({
  async generate(request): Promise<RuntimeModelResponse> {
    let response: RuntimeModelResponse | undefined;

    for await (const event of streamAiSdkModelResponse(input, request)) {
      if (event.type === 'finish') {
        response = event.response;
      }
    }

    return response ?? {};
  },
  stream(request): AsyncIterable<RuntimeModelStreamEvent> {
    return streamAiSdkModelResponse(input, request);
  },
});

async function* streamAiSdkModelResponse(
  input: AiSdkModelAdapterInput,
  request: RuntimeModelRequest,
): AsyncIterable<RuntimeModelStreamEvent> {
  const model = await input.resolveModel(input.providerConfig);
  const system = toModelSystemPrompt(request.messages);
  const result = streamText({
    model,
    ...(system ? { system } : {}),
    messages: request.messages
      .filter((message) => message.role !== 'system')
      .map(toModelMessage),
    tools: toModelVisibleToolSet(request.tools),
    abortSignal: request.abortSignal,
    maxRetries: 0,
  });
  let text = '';

  for await (const textPart of result.textStream) {
    text += textPart;
    yield {
      type: 'text_delta',
      text: textPart,
    };
  }

  yield {
    type: 'finish',
    response: {
      message: text
        ? {
            role: 'assistant',
            content: text,
          }
        : undefined,
      toolCalls: (await result.toolCalls).map(toRuntimeToolCall),
    },
  };
}

export const createAiSdkRuntimeModelAdapter = createAiSdkModelAdapter;

export const createNovelAgentRuntime = (
  input: NovelAgentRuntimeInput,
): RuntimeSession =>
  createRuntime({
    model: createAiSdkModelAdapter(input),
    tools: createNovelAgentToolSet({
      workspaceRoot: input.workspaceRoot,
      tools: input.tools,
    }),
    maxToolLoops: input.maxToolLoops,
    onEvent: input.onEvent,
  });

export const runNovelAgentTurn = async (
  input: NovelAgentRuntimeInput & NovelAgentMessageInput & {
    session?: NovelAgentSessionInput;
  },
): Promise<RunTurnResult & { session?: AgentSessionMetadata }> => {
  const session = await prepareAgentSession(input);
  const contextPackage = input.contextPackage
    ?? createBaselineNovelAgentContextPackage(input);
  const runtime = createNovelAgentRuntime({
    ...input,
    onEvent: composeRuntimeEventHandlers(input.onEvent, session?.onEvent),
  });
  const result = await runtime.runTurn(createRuntimeTurnInput({
    ...input,
    contextPackage,
  }));
  await maybeWriteNovelAgentSessionArtifacts({
    workspaceRoot: input.workspaceRoot,
    request: input.request,
    contextPackage,
    result,
    session: session?.metadata,
  });

  return {
    ...result,
    ...(session ? { session: session.metadata } : {}),
  };
};

export async function* streamNovelAgentTurn(
  input: NovelAgentRuntimeInput & NovelAgentMessageInput & {
    session?: NovelAgentSessionInput;
  },
): AsyncIterable<RuntimeEvent> {
  const session = await prepareAgentSession(input);
  const contextPackage = input.contextPackage
    ?? createBaselineNovelAgentContextPackage(input);
  const runtime = createNovelAgentRuntime({
    ...input,
    onEvent: composeRuntimeEventHandlers(input.onEvent, session?.onEvent),
  });
  let finalResult: RunTurnResult | undefined;

  for await (const event of runtime.streamTurn(createRuntimeTurnInput({
    ...input,
    contextPackage,
  }))) {
    if (event.type === 'message_finish') {
      finalResult = event.result;
    }

    yield event;
  }

  if (finalResult) {
    await maybeWriteNovelAgentSessionArtifacts({
      workspaceRoot: input.workspaceRoot,
      request: input.request,
      contextPackage,
      result: finalResult,
      session: session?.metadata,
    });
  }
}

export {
  createAgentSessionStore,
} from './session-store';
export {
  createNovelAgentValidationTools,
  streamNovelAgentCheckpointTurn,
} from './checkpoint-runner';
export {
  PLAY_REHEARSAL_ACTOR_SYSTEM_PROMPT,
  PLAY_REHEARSAL_REFEREE_SYSTEM_PROMPT,
  MAX_PLAY_REHEARSAL_REFEREE_RESPONSE_CHARACTERS,
  completePlayRehearsalReferee,
  formatPlayRehearsalActorPrompt,
  streamPlayRehearsalActorGeneration,
} from './play-rehearsal.js';
export { runtimeEventsToUiMessageStream } from './ui-stream';
export type {
  AgentSessionMetadata,
  AgentSessionMetadataInput,
  AgentSessionRecovery,
  AgentSessionToolLogEntry,
  AgentSessionStore,
  AgentSessionStoreOptions,
  RecoveredAgentSession,
} from './session-store';
export type {
  CheckpointLevel,
  NovelAgentCheckpointInput,
} from './checkpoint-runner';
export type {
  CompletePlayRehearsalRefereeInput,
  PlayRehearsalActorBehaviorAnchor,
  PlayRehearsalActorGenerationError,
  PlayRehearsalActorGenerationEvent,
  PlayRehearsalActorNarrativeBlockKind,
  PlayRehearsalActorPerceptionSnapshot,
  PlayRehearsalActorPromptInput,
  PlayRehearsalActorSceneContractSnapshot,
  PlayRehearsalActorVisibleEvent,
  PlayRehearsalActorVisibleFact,
  PlayRehearsalActorVisibleNarrativeBlock,
  PlayRehearsalActorWorldClockSnapshot,
  PlayRehearsalModelResolver,
  PlayRehearsalRefereeCompletionError,
  PlayRehearsalRefereeCompletionResult,
  StreamPlayRehearsalActorGenerationInput,
} from './play-rehearsal.js';
export type { RuntimeEventUiStreamOptions } from './ui-stream';

async function prepareAgentSession(input: {
  workspaceRoot: string;
  request: string;
  session?: NovelAgentSessionInput;
}): Promise<
  | {
      metadata: AgentSessionMetadata;
      onEvent: (event: RuntimeEvent) => Promise<void>;
    }
  | undefined
> {
  if (!input.session) {
    return undefined;
  }

  const store = input.session.store ?? createAgentSessionStore({
    workspaceRoot: input.workspaceRoot,
  });
  const metadata = input.session.id
    ? await store.ensureSession(input.session.id, input.session.metadata)
    : await store.createSession({
        title: input.request,
        ...input.session.metadata,
      });

  return {
    metadata,
    onEvent: (event) => store.recordRuntimeEvent(metadata.id, event),
  };
}

function composeRuntimeEventHandlers(
  first: ((event: RuntimeEvent) => void | Promise<void>) | undefined,
  second: ((event: RuntimeEvent) => void | Promise<void>) | undefined,
): ((event: RuntimeEvent) => Promise<void>) | undefined {
  if (!first && !second) {
    return undefined;
  }

  return async (event) => {
    await first?.(event);
    await second?.(event);
  };
}

export const createNovelAgentSystemPrompt = (
  input: NovelAgentMessageInput,
): string => {
  const lines = [
    'You are the oh-awesome-novel Copilot for a filesystem-first novel workspace.',
    'Use tools to inspect or edit the active workspace.',
    'Do not operate outside the active workspace.',
    'Do not target hidden files or hidden directories.',
    'Prefer structured workspace context over broad file loading.',
    `Workspace root: ${input.workspace.workspaceRoot}`,
  ];

  if (input.skill) {
    lines.push(`Active skill: ${input.skill.name}`);
  }

  return lines.join('\n');
};

export const assembleNovelAgentMessages = (
  input: NovelAgentMessageInput,
): NovelAgentMessageAssembly => {
  const context = createNovelAgentContext(input);
  const messages: RuntimeMessage[] = [
    {
      role: 'system',
      content: createNovelAgentSystemPrompt(input),
    },
    ...(input.priorMessages ?? []),
    {
      role: 'user',
      content: input.request,
    },
  ];

  return {
    messages,
    context,
    skill: input.skill,
  };
};

export const createRuntimeTurnInput = (
  input: NovelAgentMessageInput,
): RunTurnInput => {
  const assembly = assembleNovelAgentMessages(input);

  return {
    messages: assembly.messages,
    context: assembly.context,
    skill: assembly.skill,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  };
};

export const createNovelAgentToolSet = (
  input: NovelAgentToolSetInput,
): ToolSet => input.tools ?? {
  ...createReadTools({ workspaceRoot: input.workspaceRoot }),
  ...createWriteIntentTools({ workspaceRoot: input.workspaceRoot }),
};

export const createNovelAgentReadTools = (workspaceRoot: string): ToolSet =>
  createReadTools({ workspaceRoot });

export const inferNovelAgentCapability = (
  request: string,
  quickCommands: NovelCopilotQuickCommand[] = NOVEL_COPILOT_QUICK_COMMANDS,
): NovelCopilotCapabilityId | undefined => {
  const normalized = request.trim();
  const quickCommand = quickCommands.find((command) =>
    normalized.startsWith(command.slashCommand),
  );

  if (quickCommand) {
    return quickCommand.capabilityId;
  }

  const lowered = normalized.toLowerCase();
  const keywordMatches: Array<{
    capability: NovelCopilotCapabilityId;
    patterns: RegExp[];
  }> = [
    {
      capability: 'novel.write_chapter',
      patterns: [/写.*章/u, /下一章/u, /chapter draft/u, /\bdraft\b/u],
    },
    {
      capability: 'novel.settle_chapter',
      patterns: [/整理本章/u, /结算/u, /settle/u],
    },
    {
      capability: 'novel.review_chapter',
      patterns: [/审稿/u, /review/u, /检查.*章节/u],
    },
    {
      capability: 'novel.de_ai',
      patterns: [/去\s*ai\s*味/u, /去ai味/u, /de-?ai/u],
    },
    {
      capability: 'novel.plan_chapter',
      patterns: [/规划.*章/u, /chapter plan/u],
    },
    {
      capability: 'novel.plan_volume',
      patterns: [/规划.*卷/u, /volume plan/u],
    },
    {
      capability: 'novel.plan_outline',
      patterns: [/大纲/u, /outline/u],
    },
    {
      capability: 'novel.update_state',
      patterns: [/更新状态/u, /state/u],
    },
    {
      capability: 'novel.plan_foreshadow',
      patterns: [/伏笔/u, /foreshadow/u],
    },
    {
      capability: 'novel.play_scene',
      patterns: [/play mode/u, /play scene/u, /跑团/u, /扮演/u],
    },
    {
      capability: 'novel.deconstruct_reference',
      patterns: [/参考/u, /reference/u, /拆解/u],
    },
  ];

  return keywordMatches.find((match) =>
    match.patterns.some((pattern) => pattern.test(lowered)),
  )?.capability;
};

export const createBaselineNovelAgentContextPackage = (
  input: NovelAgentContextPackageInput,
): ContextPackage | undefined => {
  const capability = input.capability
    ?? inferNovelAgentCapability(input.request, readQuickCommands(input.skill));

  if (!capability) {
    return undefined;
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const selected: ContextSourceRef[] = [];
  const omitted: ContextSourceRef[] = [];
  const trace: ContextTraceEntry[] = [];

  const addWorkspaceSource = (source: {
    sourceId: ContextSourceId;
    content?: string | string[];
    reason: string;
    omittedReason: string;
    budgetLayer: ContextBudgetLayer;
    semanticBoundary: SemanticBoundary;
    path?: string;
    title?: string;
  }): void => {
    const hasContent = Array.isArray(source.content)
      ? source.content.length > 0
      : Boolean(source.content?.trim());
    const paths = contextPathsForSource(input.workspace, source.sourceId);
    const path = source.path ?? paths[0];

    if (hasContent) {
      selected.push({
        sourceId: source.sourceId,
        reason: source.reason,
        budgetLayer: source.budgetLayer,
        semanticBoundary: source.semanticBoundary,
        ...(path ? { path } : {}),
        ...(source.title ? { title: source.title } : {}),
      });
      trace.push(createTraceEntry(trace.length, createdAt, {
        type: 'workspaceSnapshot',
        sourceId: source.sourceId,
        reason: source.reason,
        budgetLayer: source.budgetLayer,
        semanticBoundary: source.semanticBoundary,
        outcome: 'selected',
        path,
      }));
      return;
    }

    omitted.push({
      sourceId: source.sourceId,
      reason: source.omittedReason,
      budgetLayer: source.budgetLayer,
      semanticBoundary: 'excluded',
      ...(source.title ? { title: source.title } : {}),
    });
    trace.push(createTraceEntry(trace.length, createdAt, {
      type: 'omittedSource',
      sourceId: source.sourceId,
      reason: source.omittedReason,
      budgetLayer: source.budgetLayer,
      semanticBoundary: 'excluded',
      outcome: 'omitted',
    }));
  };

  addWorkspaceSource({
    sourceId: 'constitution',
    content: input.workspace.constitution,
    reason: 'highest-priority novel rules loaded for writing guardrails',
    omittedReason: 'constitution files were not available in the workspace snapshot',
    budgetLayer: 'L0',
    semanticBoundary: 'protected',
    path: '.oan/constitution',
  });
  addWorkspaceSource({
    sourceId: 'workflow',
    content: input.workspace.workflow,
    reason: 'workflow loaded to keep the agent inside the author-defined process',
    omittedReason: 'workflow file was not available in the workspace snapshot',
    budgetLayer: 'L0',
    semanticBoundary: 'protected',
    path: '.oan/workflow.yaml',
  });
  addWorkspaceSource({
    sourceId: 'previousChapterEnding',
    content: input.workspace.summaries,
    reason: 'recent summaries loaded as continuation anchors',
    omittedReason: 'no summaries were available in the workspace snapshot',
    budgetLayer: 'L1',
    semanticBoundary: 'compressible',
    path: 'summaries',
  });
  addWorkspaceSource({
    sourceId: 'latestState',
    content: input.workspace.state,
    reason: 'latest state loaded to avoid continuity drift',
    omittedReason: 'state files were not available in the workspace snapshot',
    budgetLayer: 'L1',
    semanticBoundary: 'protected',
    path: 'state',
  });
  addWorkspaceSource({
    sourceId: 'timeline',
    content: input.workspace.timeline,
    reason: 'timeline loaded to check chronology',
    omittedReason: 'timeline files were not available in the workspace snapshot',
    budgetLayer: 'L2',
    semanticBoundary: 'compressible',
    path: 'timeline',
  });
  addWorkspaceSource({
    sourceId: 'foreshadowLedger',
    content: input.workspace.foreshadow,
    reason: 'foreshadow ledger loaded to avoid losing active hooks',
    omittedReason: 'foreshadow files were not available in the workspace snapshot',
    budgetLayer: 'L2',
    semanticBoundary: 'compressible',
    path: 'foreshadow',
  });

  if (input.referenceSelection) {
    for (const reference of input.referenceSelection.included) {
      selected.push({
        sourceId: 'referenceDistilled',
        reason: reference.reason,
        budgetLayer: reference.budgetLayer ?? 'L2',
        semanticBoundary: 'compressible',
        path: reference.path,
        title: reference.title,
      });
      trace.push(createTraceEntry(trace.length, createdAt, {
        type: 'userSelectedContext',
        sourceId: 'referenceDistilled',
        reason: reference.reason,
        budgetLayer: reference.budgetLayer ?? 'L2',
        semanticBoundary: 'compressible',
        outcome: 'selected',
        path: reference.path,
      }));
    }

    for (const reference of input.referenceSelection.omitted) {
      omitted.push({
        sourceId: 'referenceDistilled',
        reason: reference.reason,
        budgetLayer: reference.budgetLayer ?? 'L3',
        semanticBoundary: 'excluded',
        title: reference.title,
      });
      trace.push(createTraceEntry(trace.length, createdAt, {
        type: 'omittedSource',
        sourceId: 'referenceDistilled',
        reason: reference.reason,
        budgetLayer: reference.budgetLayer ?? 'L3',
        semanticBoundary: 'excluded',
        outcome: 'omitted',
      }));
    }
  }

  const healthIssues = input.projectHealth?.issues.slice(0, 5) ?? [];
  if (healthIssues.length) {
    selected.push({
      sourceId: 'projectHealth',
      reason: 'project health warnings loaded as read-only guardrails',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
      title: 'Project Health',
    });
    trace.push(createTraceEntry(trace.length, createdAt, {
      type: 'workspaceSnapshot',
      sourceId: 'projectHealth',
      reason: 'read-only project health warnings attached to context package',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
      outcome: 'selected',
    }));
  }

  return createContextPackageDraft({
    capability,
    createdAt,
    selected,
    omitted,
    trace,
    minimalMemory: {
      recentFacts: [
        ...healthIssues.map((issue) => `${issue.severity}: ${issue.title}`),
        ...(input.referenceSelection?.noCopyWarnings ?? []),
      ],
      styleNotes: input.referenceSelection?.noCopyWarnings,
    },
    ruleStack: [
      {
        id: 'human-approval',
        label: 'Every real file change must go through PendingAction and human approval.',
        priority: 100,
        sourceId: 'workflow',
      },
      {
        id: 'context-package-boundary',
        label: 'Context package explains this run; it is not canonical story truth.',
        priority: 90,
      },
    ],
  });
};

export const createAgentSessionArtifactFromRunResult = async (input: {
  workspaceRoot: string;
  request: string;
  session: AgentSessionMetadata;
  result: RunTurnResult;
  contextPackage?: ContextPackage;
  updatedAt?: string;
}): Promise<{
  artifact: AgentSessionArtifact;
  contextPackage?: ContextPackage;
  authorReport: string;
}> => {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const contextPackage = input.contextPackage
    ? appendToolTraceToContextPackage(input.contextPackage, input.result, updatedAt)
    : undefined;
  const touchedFiles = uniqueStrings(
    input.result.pendingActions.flatMap((action) => action.touchedFiles),
  );
  const resumeBoundary = touchedFiles.length
    ? await createSessionResumeBoundary(
        input.workspaceRoot,
        input.session.id,
        touchedFiles,
        updatedAt,
      )
    : undefined;
  const authorReport = createAuthorReport({
    request: input.request,
    result: input.result,
  });
  const contextPackagePath = contextPackage
    ? `.workspace/sessions/${input.session.id}/context-package.yaml`
    : undefined;

  return {
    contextPackage,
    authorReport: formatAuthorReportMarkdown(authorReport),
    artifact: {
      run: {
        sessionId: input.session.id,
        capability: contextPackage?.capability,
        status: toSessionRunStatus(input.result.stoppedReason),
        startedAt: input.session.createdAt,
        updatedAt,
        inputSources: (contextPackage?.selected ?? []).map((source) => ({
          sourceId: source.sourceId,
          ...(source.path ? { path: source.path } : {}),
        })),
        touchedFiles,
        ...(resumeBoundary ? { resumeBoundary } : {}),
      },
      outputs: [
        ...(input.result.assistantMessage?.content
          ? [{
              id: 'assistant-response',
              type: 'assistantText' as const,
              title: 'Assistant Response',
              summary: summarizeText(input.result.assistantMessage.content),
            }]
          : []),
        ...(contextPackage
          ? [{
              id: 'context-package',
              type: 'contextPackage' as const,
              title: 'Context Package',
              path: contextPackagePath,
              summary: `${contextPackage.selected.length} selected, ${contextPackage.omitted.length} omitted, ${contextPackage.trace.length} trace entries.`,
            }]
          : []),
        {
          id: 'author-report',
          type: 'assistantText',
          title: 'Author Report',
          summary: formatAuthorReportMarkdown(authorReport),
        },
      ],
      proposedPatches: input.result.pendingActions.map((action) => ({
        id: action.id,
        title: action.title,
        touchedFiles: action.touchedFiles,
        status: 'pending',
      })),
      unresolved: input.result.stoppedReason === 'completed'
        ? []
        : [`Run stopped with ${input.result.stoppedReason}. Review the transcript before resuming.`],
    },
  };
};

export const writeNovelAgentSessionArtifacts = async (input: {
  workspaceRoot: string;
  request: string;
  session: AgentSessionMetadata;
  result: RunTurnResult;
  contextPackage?: ContextPackage;
}): Promise<NovelAgentSessionArtifactWriteResult> => {
  const artifactResult = await createAgentSessionArtifactFromRunResult(input);
  const artifactPaths = await writeAgentSessionArtifact(
    input.workspaceRoot,
    artifactResult.artifact,
  );

  if (artifactResult.contextPackage) {
    artifactPaths.push(await writeContextPackageArtifact({
      workspaceRoot: input.workspaceRoot,
      sessionId: input.session.id,
      contextPackage: artifactResult.contextPackage,
    }));
  }

  return {
    artifactPaths,
    authorReport: artifactResult.authorReport,
  };
};

const toModelVisibleToolSet = (tools: ToolSet): ToolSet =>
  Object.fromEntries(
    Object.entries(tools).map(([name, value]) => [
      name,
      {
        ...value,
        execute: undefined,
      },
    ]),
  ) as ToolSet;

const toModelSystemPrompt = (messages: RuntimeMessage[]): string =>
  messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');

const toModelMessage = (message: RuntimeMessage): ModelMessage => {
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: [
        ...(message.content
          ? [{
              type: 'text' as const,
              text: message.content,
            }]
          : []),
        ...message.toolCalls.map((toolCall) => ({
          type: 'tool-call' as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.args,
        })),
      ],
    };
  }

  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: message.toolCallId ?? message.name ?? 'tool-call',
          toolName: message.name ?? 'tool',
          output: toModelToolResultOutput(message.content),
        },
      ],
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
};

const toModelToolResultOutput = (
  content: string,
): { type: 'json'; value: unknown } | { type: 'text'; value: string } => {
  try {
    return {
      type: 'json',
      value: JSON.parse(content),
    };
  } catch {
    return {
      type: 'text',
      value: content,
    };
  }
};

const toRuntimeToolCall = (toolCall: {
  toolCallId: string;
  toolName: string;
  input: unknown;
}): RuntimeToolCall => ({
  id: toolCall.toolCallId,
  name: toolCall.toolName,
  args: toolCall.input,
});

const createNovelAgentContext = (
  input: NovelAgentMessageInput,
): RuntimeContextItem[] => {
  const context: RuntimeContextItem[] = [];

  pushContext(
    context,
    'constitution',
    'Novel Constitution',
    input.workspace.constitution,
  );
  pushContext(context, 'workflow', 'Workflow', input.workspace.workflow);

  for (const summary of input.workspace.summaries ?? []) {
    pushContext(context, 'summary', 'Summary', summary);
  }

  pushContext(context, 'state', 'State', input.workspace.state);
  pushContext(context, 'timeline', 'Timeline', input.workspace.timeline);
  pushContext(context, 'foreshadow', 'Foreshadow', input.workspace.foreshadow);
  pushContext(
    context,
    'selected',
    'Context Package Summary',
    input.contextPackage
      ? formatContextPackageSummary(input.contextPackage)
      : undefined,
  );
  context.push(...(input.selectedContext ?? []));

  return context;
};

const pushContext = (
  context: RuntimeContextItem[],
  kind: RuntimeContextItem['kind'],
  title: string,
  content: string | undefined,
): void => {
  if (!content) {
    return;
  }

  context.push({
    kind,
    title,
    content,
  });
};

async function maybeWriteNovelAgentSessionArtifacts(input: {
  workspaceRoot: string;
  request: string;
  session?: AgentSessionMetadata;
  result: RunTurnResult;
  contextPackage?: ContextPackage;
}): Promise<void> {
  if (!input.session || !shouldWriteSessionArtifacts(input)) {
    return;
  }

  await writeNovelAgentSessionArtifacts({
    workspaceRoot: input.workspaceRoot,
    request: input.request,
    session: input.session,
    result: input.result,
    contextPackage: input.contextPackage,
  });
}

function shouldWriteSessionArtifacts(input: {
  result: RunTurnResult;
  contextPackage?: ContextPackage;
}): boolean {
  if (input.result.pendingActions.length > 0) {
    return true;
  }

  if (!input.contextPackage) {
    return false;
  }

  return [
    'novel.plan_outline',
    'novel.plan_volume',
    'novel.plan_chapter',
    'novel.write_chapter',
    'novel.review_chapter',
    'novel.revise_chapter',
    'novel.settle_chapter',
    'novel.update_state',
    'novel.plan_foreshadow',
    'novel.de_ai',
    'novel.play_scene',
    'novel.deconstruct_reference',
  ].includes(input.contextPackage.capability);
}

function appendToolTraceToContextPackage(
  contextPackage: ContextPackage,
  result: RunTurnResult,
  createdAt: string,
): ContextPackage {
  const existingTrace = contextPackage.trace ?? [];
  const trace = result.toolLog.map((entry, index) => {
    const source = inferSourceFromTool(entry.toolCall.name);
    const pendingAction = entry.result.pendingActions?.[0];
    const failed = !entry.result.ok;
    const reason = failed
      ? `tool ${entry.toolCall.name} failed: ${entry.result.error.message}`
      : pendingAction
        ? `tool ${entry.toolCall.name} produced PendingAction ${pendingAction.id}`
        : `tool ${entry.toolCall.name} completed during this run`;

    return createTraceEntry(existingTrace.length + index, createdAt, {
      type: 'toolCall',
      sourceId: source?.sourceId,
      toolName: entry.toolCall.name,
      path: pendingAction?.touchedFiles[0] ?? inferPathFromToolResult(entry.result.content),
      reason,
      budgetLayer: source?.budgetLayer,
      semanticBoundary: source?.semanticBoundary,
      outcome: failed ? 'failed' : pendingAction ? 'pendingAction' : 'read',
    });
  });

  return {
    ...contextPackage,
    trace: [...existingTrace, ...trace],
  };
}

function inferSourceFromTool(toolName: string): {
  sourceId: ContextSourceId | string;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: SemanticBoundary;
} | undefined {
  const map: Record<string, {
    sourceId: ContextSourceId | string;
    budgetLayer: ContextBudgetLayer;
    semanticBoundary: SemanticBoundary;
  }> = {
    'workflow.get': {
      sourceId: 'workflow',
      budgetLayer: 'L0',
      semanticBoundary: 'protected',
    },
    'constitution.get': {
      sourceId: 'constitution',
      budgetLayer: 'L0',
      semanticBoundary: 'protected',
    },
    'summary.get': {
      sourceId: 'previousChapterEnding',
      budgetLayer: 'L1',
      semanticBoundary: 'compressible',
    },
    'chapter.get': {
      sourceId: 'previousChapterEnding',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
    },
    'state.get': {
      sourceId: 'latestState',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
    },
    'timeline.list': {
      sourceId: 'timeline',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
    },
    'foreshadow.list': {
      sourceId: 'foreshadowLedger',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
    },
    'character.list': {
      sourceId: 'characters',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
    },
    'character.get': {
      sourceId: 'characters',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
    },
    'world.search': {
      sourceId: 'worldRules',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
    },
    'chapter.createDraft': {
      sourceId: 'chapterContract',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
    },
    'state.set': {
      sourceId: 'latestState',
      budgetLayer: 'L1',
      semanticBoundary: 'protected',
    },
    'timeline.add': {
      sourceId: 'timeline',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
    },
    'foreshadow.create': {
      sourceId: 'foreshadowLedger',
      budgetLayer: 'L2',
      semanticBoundary: 'compressible',
    },
    'summary.generateChapter': {
      sourceId: 'previousChapterEnding',
      budgetLayer: 'L1',
      semanticBoundary: 'compressible',
    },
  };

  return map[toolName];
}

function contextPathsForSource(
  workspace: NovelAgentWorkspaceSnapshot,
  sourceId: ContextSourceId | string,
): string[] {
  return (workspace.contextFiles ?? [])
    .filter((file) => file.sourceId === sourceId)
    .map((file) => file.path);
}

function readQuickCommands(
  skill: RuntimeSkill | Pick<NovelCopilotSkill, 'quickCommands'> | undefined,
): NovelCopilotQuickCommand[] | undefined {
  return skill && 'quickCommands' in skill ? skill.quickCommands : undefined;
}

function createTraceEntry(
  index: number,
  createdAt: string,
  entry: Omit<ContextTraceEntry, 'id' | 'createdAt'>,
): ContextTraceEntry {
  return {
    id: `trace-${String(index + 1).padStart(3, '0')}`,
    createdAt,
    ...entry,
  };
}

function createAuthorReport(input: {
  request: string;
  result: RunTurnResult;
}): AuthorReport {
  return {
    status: input.result.stoppedReason,
    candidateOutputs: [
      input.result.assistantMessage?.content
        ? summarizeText(input.result.assistantMessage.content)
        : `Request recorded: ${summarizeText(input.request)}`,
    ],
    acceptedActions: [],
    rejectedActions: [],
    pendingActions: input.result.pendingActions.map((action) =>
      `${action.id}: ${action.title}`,
    ),
    unresolvedDecisions: input.result.stoppedReason === 'completed'
      ? []
      : [`Run stopped with ${input.result.stoppedReason}.`],
    nextSuggestedAction: input.result.pendingActions.length
      ? 'Review the PendingAction diff and accept or reject it before treating changes as canon.'
      : 'Continue the next writing step from the recorded session artifacts.',
  };
}

function toSessionRunStatus(
  stoppedReason: RunTurnResult['stoppedReason'],
): AgentSessionArtifact['run']['status'] {
  if (stoppedReason === 'completed') {
    return 'completed';
  }

  if (stoppedReason === 'error') {
    return 'failed';
  }

  return 'blocked';
}

function summarizeText(text: string, maxLength = 280): string {
  const compact = text.replaceAll(/\s+/g, ' ').trim();
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength - 1)}...`;
}

function inferPathFromToolResult(content: unknown): string | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const directPath = ['path', 'file', 'targetFile', 'shadowFile']
    .map((key) => content[key])
    .find((value): value is string => typeof value === 'string');

  if (directPath) {
    return directPath;
  }

  const pendingActions = content.pendingActions;
  if (Array.isArray(pendingActions) && isRecord(pendingActions[0])) {
    const touchedFiles = pendingActions[0].touchedFiles;
    if (Array.isArray(touchedFiles) && typeof touchedFiles[0] === 'string') {
      return touchedFiles[0];
    }
  }

  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].toSorted();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
