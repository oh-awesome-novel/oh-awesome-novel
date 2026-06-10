import { streamText } from 'ai';

import type { LlmProviderConfig } from '@oh-awesome-novel/core';
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
}

export interface NovelAgentMessageInput {
  request: string;
  workspace: NovelAgentWorkspaceSnapshot;
  skill?: RuntimeSkill;
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

export type AiSdkProviderResolver = (
  providerConfig: LlmProviderConfig,
) => LanguageModel | Promise<LanguageModel>;

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
  const result = streamText({
    model,
    messages: request.messages.map(toModelMessage),
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
  const runtime = createNovelAgentRuntime({
    ...input,
    onEvent: composeRuntimeEventHandlers(input.onEvent, session?.onEvent),
  });
  const result = await runtime.runTurn(createRuntimeTurnInput(input));

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
  const runtime = createNovelAgentRuntime({
    ...input,
    onEvent: composeRuntimeEventHandlers(input.onEvent, session?.onEvent),
  });

  for await (const event of runtime.streamTurn(createRuntimeTurnInput(input))) {
    yield event;
  }
}

export {
  createAgentSessionStore,
} from './session-store';
export {
  createNovelAgentValidationTools,
  streamNovelAgentCheckpointTurn,
} from './checkpoint-runner';
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

const toModelMessage = (message: RuntimeMessage): ModelMessage => {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: message.toolCallId ?? message.name ?? 'tool-call',
          toolName: message.name ?? 'tool',
          output: {
            type: 'text',
            value: message.content,
          },
        },
      ],
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
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
