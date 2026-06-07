import { streamText } from 'ai';

import type { LlmProviderConfig } from '@oh-awesome-novel/core';
import { createReadTools } from '@oh-awesome-novel/tools';
import { createRuntime } from '@oh-awesome-novel/runtime';
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
  });

export const runNovelAgentTurn = async (
  input: NovelAgentRuntimeInput & NovelAgentMessageInput,
): Promise<RunTurnResult> => {
  const runtime = createNovelAgentRuntime(input);
  return runtime.runTurn(createRuntimeTurnInput(input));
};

export const streamNovelAgentTurn = (
  input: NovelAgentRuntimeInput & NovelAgentMessageInput,
): AsyncIterable<RuntimeEvent> => {
  const runtime = createNovelAgentRuntime(input);
  return runtime.streamTurn(createRuntimeTurnInput(input));
};

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
): ToolSet => input.tools ?? createReadTools({ workspaceRoot: input.workspaceRoot });

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
