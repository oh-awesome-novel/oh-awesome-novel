import { randomUUID } from 'node:crypto';

import type { RuntimeSteeringMessage, RuntimeSteeringSource } from '@oh-awesome-novel/runtime';

export const MAX_AGENT_STEER_CHARACTERS = 20_000;
const TURN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export interface AgentSteeringTurn extends RuntimeSteeringSource {
  dispose(): void;
}

export type AgentSteerResult =
  | { status: 'accepted'; message: RuntimeSteeringMessage }
  | { status: 'too_late' };

/**
 * Running Copilot turns that accept mid-turn author messages. A turn leaves
 * the registry as soon as the runtime starts finalizing it, so a late steer is
 * refused and the renderer queues it as a follow-up instead.
 */
export class AgentSteeringRegistry {
  private readonly turns = new Map<string, RuntimeSteeringMessage[]>();

  open(workspaceRoot: string, sessionId: string, turnId: string): AgentSteeringTurn {
    const key = steeringKey(workspaceRoot, sessionId, turnId);
    const queue: RuntimeSteeringMessage[] = [];
    this.turns.set(key, queue);
    const close = () => {
      if (this.turns.get(key) === queue) this.turns.delete(key);
    };
    return {
      drain: () => queue.splice(0),
      close,
      dispose: close,
    };
  }

  steer(workspaceRoot: string, sessionId: string, turnId: string, content: string): AgentSteerResult {
    const queue = this.turns.get(steeringKey(workspaceRoot, sessionId, turnId));
    if (!queue) return { status: 'too_late' };
    const message = { id: `steer-${randomUUID()}`, content };
    queue.push(message);
    return { status: 'accepted', message };
  }
}

export function isAgentTurnId(value: unknown): value is string {
  return typeof value === 'string' && TURN_ID_PATTERN.test(value);
}

function steeringKey(workspaceRoot: string, sessionId: string, turnId: string): string {
  return JSON.stringify([workspaceRoot, sessionId, turnId]);
}
