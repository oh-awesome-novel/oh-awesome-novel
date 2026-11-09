import type { PlayPhaseOverview, PlayPhaseQuery, PlayPhaseRecall } from '@oh-awesome-novel/core';
export type { PlayPhaseOverview, PlayPhaseQuery, PlayPhaseRecall } from '@oh-awesome-novel/core';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(v) && !v.includes('..');

export function parsePhaseOverview(value: unknown, sessionId: string): PlayPhaseOverview {
  if (!record(value) || value.sessionId !== sessionId || !count(value.revision) || value.headId !== null && !id(value.headId)
    || !record(value.budget) || !Array.isArray(value.phases) || value.phases.length > 64) throw new Error('阶段目录响应无效。');
  const b = value.budget;
  if (!count(b.estimatedTokens) || !count(b.protectedTokens) || [b.inputTokens, b.outputReserve, b.previousRequestTokens].some(n => n !== undefined && !count(n))
    || !['unknown', 'within', 'near-limit', 'overflow', 'protected-overflow'].includes(String(b.status)) || (b.inputTokens === undefined) !== (b.status === 'unknown')) throw new Error('阶段预算响应无效。');
  if (value.gap !== undefined && !['invalid-archive', 'depth-limit', 'source-unavailable'].includes(String(value.gap))) throw new Error('阶段来源响应无效。');
  let end: number | undefined;
  const seen = new Set<string>();
  for (const [index, phase] of value.phases.entries()) {
    if (!record(phase) || !id(phase.sessionId) || seen.has(phase.sessionId) || !count(phase.firstTurn) || phase.firstTurn < 1 || !count(phase.lastTurn)
      || phase.firstTurn > phase.lastTurn + 1 || end !== undefined && phase.firstTurn !== end + 1 || phase.headId !== null && !id(phase.headId)
      || phase.current !== (phase.sessionId === sessionId) || phase.current !== (index === value.phases.length - 1)
      || phase.current && phase.headId !== value.headId) throw new Error('阶段覆盖范围无效。');
    seen.add(phase.sessionId); end = phase.lastTurn;
  }
  return value as unknown as PlayPhaseOverview;
}

export function parsePhaseRecall(value: unknown, expected: PlayPhaseQuery): PlayPhaseRecall {
  if (!record(value) || !record(value.scope) || Object.keys(value.scope).length !== Object.keys(expected).length
    || Object.entries(expected).some(([k,v]) => (value.scope as Record<string, unknown>)[k] !== v)
    || !Array.isArray(value.hits) || value.hits.length > 20 || !count(value.candidateBytes) || value.candidateBytes > 256 * 1024
    || !count(value.omittedMessages) || !count(value.omittedHits)) throw new Error('历史检索响应与请求不一致。');
  for (const hit of value.hits) {
    if (!record(hit) || !count(hit.turn) || hit.turn < expected.firstTurn || hit.turn > expected.lastTurn || !id(hit.turnId) || !id(hit.messageId)
      || !count(hit.start) || !count(hit.end) || typeof hit.quote !== 'string' || hit.end - hit.start !== hit.quote.length || !hit.quote.includes(expected.query)
      || typeof hit.quoteHash !== 'string' || !/^[a-f0-9]{64}$/u.test(hit.quoteHash) || !record(hit.historicalState)
      || typeof hit.stateRecorded !== 'boolean' || !(expected.lens === 'player' ? ['playerVisible'] : ['playerVisible', 'rumor', 'playerUnknown']).includes(String(hit.visibility))
      || !count(hit.omittedStateFields)) throw new Error('历史证据响应无效。');
  }
  const selected = value.selectedMessageIds;
  if (expected.selectEvidence ? !Array.isArray(selected) || selected.length > value.hits.length || new Set(selected).size !== selected.length
    || selected.some(id => !(value.hits as { messageId: string }[]).some(hit => hit.messageId === id)) : selected !== undefined) throw new Error('模型选择超出检索窗口。');
  return value as unknown as PlayPhaseRecall;
}
