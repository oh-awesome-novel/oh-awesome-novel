import { buildPlayCompactionPrompt, buildPlayPhaseCatalog, estimateTextTokens, formatPlayWorldRefereeTurnContext,
  getPlayFrozenSystemPrompt, isPlayCompactionActive, readAgentGovernanceHistory, readPlaySessionFiles } from '@oh-awesome-novel/core';
import type { LlmProviderConfig, PlayPhaseBudget, PlaySession } from '@oh-awesome-novel/core';
import { resolveContextBudget } from '@oh-awesome-novel/agent';
import { playContextHistory } from './play-context-history.js';

function phaseHistory(session: PlaySession) {
  const marker = session.metadataExtensions.playCompaction;
  const boundary = isPlayCompactionActive(session) && marker && typeof marker === 'object' && 'sourceTurnId' in marker
    ? session.selectedTurnIds.indexOf(String(marker.sourceTurnId)) + 1 : 0;
  const ids = new Set(session.selectedTurnIds.slice(boundary));
  return session.turnArtifacts.filter(turn => ids.has(turn.id));
}
function continuation(session: PlaySession) {
  return isPlayCompactionActive(session) && typeof session.metadataExtensions.playContinuation === 'string'
    ? session.metadataExtensions.playContinuation : '';
}
function phaseInputBudget(provider?: LlmProviderConfig) {
  return provider ? resolveContextBudget(provider) : { inputTokens: undefined, maxOutputTokens: undefined };
}
export function playPhaseBudget(session: PlaySession, provider?: LlmProviderConfig, previousRequestTokens?: number): PlayPhaseBudget {
  const { inputTokens, maxOutputTokens } = phaseInputBudget(provider);
  const context = formatPlayWorldRefereeTurnContext(session);
  const fixed = [getPlayFrozenSystemPrompt(session), context.state, context.requirements, continuation(session)]
    .reduce((total, text) => total + estimateTextTokens(text), 0);
  const recent = phaseHistory(session).slice(-2).flatMap(turn => turn.messages);
  const protectedTokens = fixed + recent.reduce((sum, msg) => sum + estimateTextTokens(msg.content), 0);
  const estimatedTokens = fixed + playContextHistory(session).reduce((sum, msg) => sum + estimateTextTokens(msg.content), 0);
  const pressure = Math.max(estimatedTokens, previousRequestTokens ?? 0);
  return { estimatedTokens, protectedTokens, inputTokens, outputReserve: maxOutputTokens, previousRequestTokens,
    status: inputTokens === undefined ? 'unknown' : protectedTokens > inputTokens ? 'protected-overflow'
      : pressure > inputTokens ? 'overflow' : pressure >= inputTokens * 0.85 ? 'near-limit' : 'within' };
}

export async function playPhaseOverview(root: string, session: PlaySession, provider?: LlmProviderConfig) {
  const catalog = await buildPlayPhaseCatalog(session, id => readPlaySessionFiles(root, id));
  // Usage records have a shorter id limit than existing Play session files.
  const usageId = 'play-' + session.id;
  const history = usageId.length <= 128 ? await readAgentGovernanceHistory(root, usageId) : undefined;
  const last = history?.records.findLast(row => row.recordType === 'request' && row.operation?.stage === 'world'
    && row.operation.contextTraceId === catalog.headId && row.egress?.modelId === provider?.model && row.egress?.providerId === provider?.id);
  return { ...catalog, budget: playPhaseBudget(session, provider, last?.recordType === 'request' ? last.request.estimatedRequestTokens : undefined) };
}

/** Keep whole recent turns and the previous archive. Spend remaining input space on whole older turns. */
export function playArchiveQuestion(session: PlaySession, provider?: LlmProviderConfig, repair = '') {
  const frozenSystemPrompt = getPlayFrozenSystemPrompt(session);
  const baseInstruction = buildPlayCompactionPrompt(session, []) + repair;
  const previous = continuation(session);
  const turns = phaseHistory(session);
  const { inputTokens } = phaseInputBudget(provider);
  const eventsById = new Map(session.events.map(event => [event.id, event]));
  let available = Math.floor((inputTokens ?? Infinity) / 1.2) - [frozenSystemPrompt, baseInstruction, previous].reduce((sum, text) => sum + estimateTextTokens(text), 0);
  let start = turns.length;
  while (start > 0) {
    const turn = turns[start - 1]!;
    const cost = turn.messages.reduce((sum, m) => sum + estimateTextTokens(JSON.stringify({ role: m.speaker, content: m.content })), 0)
      + estimateTextTokens(JSON.stringify(turn.eventIds.map(id => eventsById.get(id)))) + estimateTextTokens(turn.id) + 4;
    if (cost > available) break;
    available -= cost;
    start--;
  }
  if (start > Math.max(0, turns.length - 2) || available < 0) throw new Error('完整最近两轮、当前状态与归档指令超出配置的输入预算。请调整模型窗口或输出预留。');
  const instruction = buildPlayCompactionPrompt(session, turns.slice(start).map(turn => turn.id)) + repair;
  const priorMessages = [
    ...(previous ? [{ role: 'user' as const, content: previous }] : []),
    ...turns.slice(start).flatMap(turn => turn.messages.map(m => ({ role: m.speaker === 'user' ? 'user' as const : 'assistant' as const, content: m.content }))),
  ];
  return { frozenSystemPrompt, priorMessages, omittedHistoryTurns: start, request: [
    ...(start ? [`本次窗口未纳入本阶段较早的 ${start} 轮原文。只能从所见证据提炼事实。`] : []),
    `<暂停推演：只读辅助请求>\n${instruction}\n</暂停推演：只读辅助请求>`,
  ].join('\n') };
}
