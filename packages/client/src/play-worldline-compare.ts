import type { PlayWorldlineComparison, PlayWorldlineCompareQuery } from '@oh-awesome-novel/core';
export type { PlayWorldlineComparison, PlayWorldlineCompareQuery, PlayWorldlineDifference, PlayWorldlineSection } from '@oh-awesome-novel/core';

const sections = ['actions', 'state', 'events', 'scheduled', 'knowledge', 'canon'];
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fields = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 640;

export function parsePlayWorldlineComparison(value: unknown, sessionId: string, query: PlayWorldlineCompareQuery): PlayWorldlineComparison {
  const fail = (): never => { throw new Error('Invalid Play worldline comparison response.'); };
  if (!record(value) || !fields(value, ['sessionId', 'revision', 'lens', 'page', 'pageSize', 'left', 'right', 'commonAncestor', 'unavailableReason', 'sections', 'canonical']) ||
      value.sessionId !== sessionId || !integer(value.revision) || value.lens !== query.lens || value.canonical !== false ||
      value.page !== (query.page ?? 0) || value.pageSize !== 40 || !Array.isArray(value.sections)) return fail();
  const side = (item: unknown, id: string): boolean => record(item) && fields(item, ['checkpointId', 'turnCount', 'divergentTurnCount', 'clock']) &&
    item.checkpointId === id && integer(item.turnCount) && integer(item.divergentTurnCount) && item.divergentTurnCount <= item.turnCount &&
    record(item.clock) && fields(item.clock, ['turn', 'revision', 'anchor', 'elapsed']) && integer(item.clock.turn) && integer(item.clock.revision) &&
    (item.clock.anchor === undefined || text(item.clock.anchor)) && (item.clock.elapsed === undefined || text(item.clock.elapsed));
  if (!side(value.left, query.left) || !side(value.right, query.right) ||
      (value.commonAncestor !== undefined && !text(value.commonAncestor)) ||
      (value.unavailableReason !== undefined && (!text(value.unavailableReason) || !value.unavailableReason))) return fail();
  if (value.unavailableReason !== undefined) {
    if (value.sections.length !== 0) return fail();
  } else if (!value.commonAncestor || value.sections.length !== sections.length) return fail();
  for (const [index, section] of value.sections.entries()) {
    if (!record(section) || !fields(section, ['kind', 'items', 'total']) || section.kind !== sections[index] || !integer(section.total) ||
        !Array.isArray(section.items) || section.items.length !== Math.min(40, Math.max(0, section.total - (query.page ?? 0) * 40))) return fail();
    const keys = new Set<string>();
    for (const row of section.items) {
      if (!record(row) || !fields(row, ['key', 'label', 'left', 'right']) || !text(row.key) || !text(row.label) ||
          (row.left === undefined && row.right === undefined) || (row.left !== undefined && !text(row.left)) ||
          (row.right !== undefined && !text(row.right)) || keys.has(row.key)) return fail();
      keys.add(row.key);
    }
  }
  return value as unknown as PlayWorldlineComparison;
}
