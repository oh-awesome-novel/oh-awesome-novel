import { randomUUID } from 'node:crypto';

import { createRuntime } from '@oh-awesome-novel/runtime';
import {
  createPendingActionStore,
  createSandboxEditSession,
  createWorkspaceChangePolicy,
} from '@oh-awesome-novel/tools';
import type {
  RuntimeEvent,
  RuntimeMessage,
  RuntimeModelAdapter,
  RuntimeModelRequest,
  RuntimeModelResponse,
  RuntimeModelStreamEvent,
  RuntimeToolCall,
} from '@oh-awesome-novel/runtime';
import type { ToolSet } from 'ai';

export type CheckpointLevel = 'level-1' | 'level-2' | 'level-3';

export interface NovelAgentCheckpointInput {
  workspaceRoot: string;
  request: string;
  level?: CheckpointLevel;
  tools?: ToolSet;
}

export function streamNovelAgentCheckpointTurn(
  input: NovelAgentCheckpointInput,
): AsyncIterable<RuntimeEvent> {
  return streamCheckpoint(input);
}

async function* streamCheckpoint(
  input: NovelAgentCheckpointInput,
): AsyncIterable<RuntimeEvent> {
  const level = input.level ?? inferCheckpointLevel(input.request);
  const sessionId = `checkpoint_${randomUUID()}`;
  const targetPath = 'chapters/0001/9999.md';
  const sandbox = input.tools
    ? undefined
    : await createSandboxEditSession({
        workspaceRoot: input.workspaceRoot,
        sessionId,
        policy: createWorkspaceChangePolicy(level === 'level-3'
          ? {
              capability: 'chapter.edit',
              exactWritablePaths: [targetPath],
            }
          : { capability: 'read-only' }),
        pendingActionStore: await createPendingActionStore({
          workspaceRoot: input.workspaceRoot,
        }),
        proposalOrigin: {
          kind: 'agentTurn',
          sessionId,
          turnId: `turn_${randomUUID()}`,
        },
      });
  const runtime = createRuntime({
    model: createCheckpointModelAdapter(level),
    tools: input.tools ?? sandbox!.tools,
    maxToolLoops: 4,
    ...(sandbox
      ? {
          turnFinalizer: {
            async finalizeTurn(finalizeInput) {
              if (finalizeInput.stoppedReason === 'aborted') {
                await sandbox.discard();
                return finalizeInput.pendingActions;
              }
              if (
                sandbox.isSealed()
                || !sandbox.isDirty()
                || finalizeInput.stoppedReason === 'error'
              ) {
                return finalizeInput.pendingActions;
              }
              const proposal = await sandbox.proposeChanges({
                title: 'Checkpoint sandbox change',
                description: 'Real in-memory checkpoint edit awaiting human approval.',
                finalization: 'runtime-fallback',
              });
              return [
                ...finalizeInput.pendingActions,
                ...proposal.pendingActions.map((action) => ({
                  ...action,
                  changes: action.changes.map((change) => ({ ...change })),
                })),
              ];
            },
          },
        }
      : {}),
  });

  try {
    yield* runtime.streamTurn({
      messages: [
        {
          role: 'system',
          content: [
            'You are running an oh-awesome-novel checkpoint validation turn.',
            'Every edit occurs in the fixed in-memory workspace and requires a PendingAction.',
          ].join('\n'),
        },
        { role: 'user', content: input.request },
      ],
    });
  } finally {
    await sandbox?.dispose();
  }
}

function createCheckpointModelAdapter(level: CheckpointLevel): RuntimeModelAdapter {
  let step = 0;

  return {
    async generate(request): Promise<RuntimeModelResponse> {
      let response: RuntimeModelResponse = {};

      for await (const event of this.stream?.(request) ?? []) {
        if (event.type === 'finish') {
          response = event.response;
        }
      }

      return response;
    },
    async *stream(request: RuntimeModelRequest): AsyncIterable<RuntimeModelStreamEvent> {
      const response = nextCheckpointResponse(level, step, request.messages);
      step += 1;

      for (const chunk of splitText(response.text)) {
        yield {
          type: 'text_delta',
          text: chunk,
        };
      }

      yield {
        type: 'finish',
        response: {
          message: {
            role: 'assistant',
            content: response.text,
          },
          toolCalls: response.toolCalls,
        },
      };
    },
  };
}

function nextCheckpointResponse(
  level: CheckpointLevel,
  step: number,
  messages: RuntimeMessage[],
): { text: string; toolCalls: RuntimeToolCall[] } {
  if (step > 0) {
    return {
      text: summarizeToolResults(level, messages),
      toolCalls: [],
    };
  }

  if (level === 'level-1') {
    return {
      text: 'Level 1: reading workflow and constitution so the UI can watch tool activity.',
      toolCalls: [
        { id: 'checkpoint-workflow', name: 'workflow.get', args: {} },
        { id: 'checkpoint-constitution', name: 'constitution.get', args: {} },
      ],
    };
  }

  if (level === 'level-2') {
    return {
      text: 'Level 2: reading heroine and state data through the runtime tool loop.',
      toolCalls: [
        { id: 'checkpoint-character', name: 'character.get', args: { id: 'heroine' } },
        {
          id: 'checkpoint-state',
          name: 'state.get',
          args: { file: 'characters.yaml', path: 'characters.heroine.hp' },
        },
      ],
    };
  }

  return {
    text: 'Level 3: editing the in-memory checkpoint target for PendingAction review.',
    toolCalls: [
      {
        id: 'checkpoint-pending-write',
        name: 'writeFile',
        args: {
          path: 'chapters/0001/9999.md',
          content: '# 闯卡验证\n\n这里是一次待审批的写入预览。\n',
        },
      },
    ],
  };
}

function summarizeToolResults(level: CheckpointLevel, messages: RuntimeMessage[]): string {
  const toolMessages = messages.filter((message) => message.role === 'tool');
  const names = toolMessages.map((message) => message.name).filter(Boolean);

  if (level === 'level-3') {
    return `Level 3 complete: pending action is ready. Tools: ${names.join(', ')}.`;
  }

  return `Checkpoint complete. Tools: ${names.join(', ')}.`;
}

function inferCheckpointLevel(request: string): CheckpointLevel {
  const text = request.toLowerCase();

  if (text.includes('level 3') || text.includes('写入') || text.includes('pending')) {
    return 'level-3';
  }

  if (text.includes('level 2') || text.includes('character') || text.includes('state')) {
    return 'level-2';
  }

  return 'level-1';
}

function splitText(text: string): string[] {
  return text.match(/.{1,18}/g) ?? [text];
}
