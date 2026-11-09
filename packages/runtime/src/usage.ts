import { asSchema } from 'ai';
import { createHash } from 'node:crypto';
import { estimateTextTokens, USAGE_ESTIMATOR, usageSourceKey } from '@oh-awesome-novel/core/agent-usage';
import type { ModelRequestStats, UsageRequestFingerprint } from '@oh-awesome-novel/core/agent-usage';
import type { RuntimeModelRequest } from './types';

/** Estimates the serialized, model-visible messages and resolved tool schemas. */
export async function estimateRuntimeModelRequest(request: RuntimeModelRequest): Promise<ModelRequestStats> {
  const messages = request.messages.map(({ provenance: _provenance, ...message }) => message);
  const tools = Object.fromEntries(await Promise.all(Object.entries(request.tools).map(async ([name, tool]) => [name, {
    description: tool.description,
    inputSchema: await asSchema(tool.inputSchema).jsonSchema,
  }])));
  const stats = request.messages.map((message, index) => ({
    index, role: message.role, chars: message.content.length,
    estimatedTokens: estimateTextTokens(JSON.stringify(messages[index])),
    sourceRefs: (message.provenance ?? []).map(usageSourceKey),
  }));
  return {
    messageCount: messages.length, messages: stats,
    estimatedMessageTokens: stats.reduce((sum, message) => sum + message.estimatedTokens, 0),
    estimatedRequestTokens: Math.ceil(estimateTextTokens(JSON.stringify({ messages, tools })) * 1.2),
    toolCount: Object.keys(tools).length, estimator: USAGE_ESTIMATOR,
    estimationScope: 'messages-tools-json-with-20-percent-margin',
  };
}

/** Hash only provider-visible definitions, never tool functions or raw tool arguments. */
export async function fingerprintRuntimeModelRequest(
  request: RuntimeModelRequest,
  frozenSystemPrompt?: string,
): Promise<UsageRequestFingerprint> {
  const tools = Object.fromEntries(await Promise.all(Object.entries(request.tools).sort(([a], [b]) => a.localeCompare(b)).map(async ([name, tool]) => [name, {
    description: tool.description,
    inputSchema: await asSchema(tool.inputSchema).jsonSchema,
  }])));
  const prefix = frozenSystemPrompt ?? request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  return {
    prefixHash: createHash('sha256').update(prefix).digest('hex'),
    prefixKind: frozenSystemPrompt === undefined ? 'system-messages' : 'frozen-system',
    toolSchemaHash: createHash('sha256').update(JSON.stringify(sortValue(tools))).digest('hex'),
  };
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortValue(child)]));
  return value;
}
