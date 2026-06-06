import { generateText, jsonSchema, tool } from 'ai';

import type { LlmProviderConfig } from '@oh-awesome-novel/core';
import type {
  RunTurnInput,
  RuntimeContextItem,
  RuntimeMessage,
  RuntimeModelAdapter,
  RuntimeModelResponse,
  RuntimeSkill,
  RuntimeTool,
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

export interface AiSdkRuntimeModelAdapterInput {
  providerConfig: LlmProviderConfig;
  resolveModel(
    providerConfig: LlmProviderConfig,
  ): LanguageModel | Promise<LanguageModel>;
}

export const createAiSdkRuntimeModelAdapter = (
  input: AiSdkRuntimeModelAdapterInput,
): RuntimeModelAdapter => ({
  async generate(request): Promise<RuntimeModelResponse> {
    const model = await input.resolveModel(input.providerConfig);
    const result = await generateText({
      model,
      messages: request.messages.map(toModelMessage),
      tools: toAiSdkTools(request.tools),
      abortSignal: request.abortSignal,
      maxRetries: 0,
    });

    return {
      message: result.text
        ? {
            role: 'assistant',
            content: result.text,
          }
        : undefined,
      toolCalls: result.toolCalls.map(toRuntimeToolCall),
    };
  },
});

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

const toAiSdkTools = (runtimeTools: RuntimeTool[]): ToolSet =>
  Object.fromEntries(
    runtimeTools.map((runtimeTool) => [
      runtimeTool.id,
      tool({
        description: runtimeTool.description,
        inputSchema: jsonSchema({
          type: 'object',
          additionalProperties: true,
        }),
      }),
    ]),
  );

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
