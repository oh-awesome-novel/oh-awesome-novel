/** Browser-safe contracts shared by the persisted Play ledger and HTTP guards. */

/**
 * Explicit ISO calendar only: a Gregorian date, wall time and timezone are
 * required. Natural-language anchors and timezone-less times are not ordered.
 */
export function normalizePlayIsoWorldTime(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! ||
      hour > 23 || minute > 59 || second > 59) return undefined;
  const zoneHour = zone === 'Z' ? 0 : Number(zone!.slice(1, 3));
  const zoneMinute = zone === 'Z' ? 0 : Number(zone!.slice(4, 6));
  // -00:00 denotes an unknown local offset rather than a declared timezone.
  if (zoneHour > 23 || zoneMinute > 59 || zone === '-00:00') return undefined;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number((fraction ?? '').padEnd(3, '0')));
  const offset = (zoneHour * 60 + zoneMinute) * (zone?.startsWith('-') ? -1 : 1);
  return new Date(date.getTime() - offset * 60_000).toISOString();
}

export function comparePlayIsoWorldTime(current: string, target: string): number | undefined {
  const left = normalizePlayIsoWorldTime(current);
  const right = normalizePlayIsoWorldTime(target);
  return left === undefined || right === undefined
    ? undefined
    : Math.sign(Date.parse(left) - Date.parse(right));
}

export function normalizePlayStateDeltaRefs(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error('Play event stateDeltaRefs must be a bounded array.');
  }
  const refs = value.map((path: unknown) => {
    if (typeof path !== 'string' || path.length > 256 || path.split('.').some((segment) =>
      !/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(segment) ||
      ['__proto__', 'prototype', 'constructor'].includes(segment))) {
      throw new Error('Play event stateDeltaRefs contains an unsafe state path.');
    }
    if (['worldMomentum', 'playKnowledge'].includes(path.split('.')[0]!)) {
      throw new Error('Play event stateDeltaRefs cannot reference reserved typed state.');
    }
    return path;
  });
  if (new Set(refs).size !== refs.length) {
    throw new Error('Play event stateDeltaRefs must not contain duplicates.');
  }
  return refs;
}

/** Explicit refs own changed leaf values in this artifact, never sibling facts. */
export function assertPlayEventStateDeltaRefs(
  events: readonly { stateDeltaRefs?: string[] }[],
  stateDelta: Record<string, unknown>,
  predecessorState?: Record<string, unknown>,
): void {
  for (const event of events) {
    for (const path of normalizePlayStateDeltaRefs(event.stateDeltaRefs) ?? []) {
      const value = readStatePath(stateDelta, path);
      if (!value.found || (isRecord(value.value) && Object.keys(value.value).length > 0)) {
        throw new Error(`Play event stateDeltaRefs references an unknown or non-leaf delta: ${path}.`);
      }
      if (predecessorState) {
        const previous = readStatePath(predecessorState, path);
        if (previous.found && equalJson(previous.value, value.value)) {
          throw new Error(`Play event stateDeltaRefs references unchanged state: ${path}.`);
        }
      }
    }
  }
}

function readStatePath(state: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  let value: unknown = state;
  for (const segment of path.split('.')) {
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return { found: false };
    value = value[segment];
  }
  return { found: true, value };
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equalJson(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) =>
      Object.hasOwn(right, key) && equalJson(left[key], right[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
