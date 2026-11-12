import type {
  PlayCharacterCheckCategory, PlayCharacterCheckFinding, PlayCharacterCheckLens, PlayCharacterCheckReport, PlayCharacterCheckTarget,
} from '@oh-awesome-novel/core';
export type {
  PlayCharacterCheckCategory, PlayCharacterCheckFinding, PlayCharacterCheckLens, PlayCharacterCheckReport, PlayCharacterCheckTarget,
} from '@oh-awesome-novel/core';

/** A stored report plus whether the selected branch (or the attempt) still runs through its target. */
export type PlayCharacterCheckReportView = PlayCharacterCheckReport & { stale: boolean };

export interface PlayCharacterCheckInput {
  /** `turnMessage` names a committed narrative message; the host resolves it to its turn on the selected branch. */
  target: PlayCharacterCheckTarget | { kind: 'turnMessage'; messageId: string };
  lens: PlayCharacterCheckLens;
}

const CATEGORIES: readonly PlayCharacterCheckCategory[] = ['voice', 'motivation', 'knowledge', 'relationship'];
export const PLAY_CHARACTER_CHECK_CATEGORY_LABELS: Record<PlayCharacterCheckCategory, string> = {
  voice: '声线', motivation: '动机', knowledge: '认知', relationship: '关系',
};

const fail = (): never => { throw new Error('角色贴合度检查响应无效。'); };
const record = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const text = (v: unknown): string => typeof v === 'string' && v ? v : fail();
const texts = (v: unknown): string[] => Array.isArray(v) ? v.map(text) : fail();
const only = (v: Record<string, unknown>, keys: readonly string[]): void => { if (Object.keys(v).some((key) => !keys.includes(key))) fail(); };

function parseTarget(value: unknown): PlayCharacterCheckTarget {
  const v = record(value);
  if (v.kind === 'turn') { only(v, ['kind', 'turnId']); return { kind: 'turn', turnId: text(v.turnId) }; }
  if (v.kind === 'rehearsalStep') { only(v, ['kind', 'attemptId', 'stepRef']); return { kind: 'rehearsalStep', attemptId: text(v.attemptId), stepRef: text(v.stepRef) }; }
  return fail();
}

export function samePlayCharacterCheckTarget(a: PlayCharacterCheckTarget, b: PlayCharacterCheckTarget): boolean {
  return a.kind === 'turn' ? b.kind === 'turn' && a.turnId === b.turnId
    : b.kind === 'rehearsalStep' && a.attemptId === b.attemptId && a.stepRef === b.stepRef;
}

/** Strict: unknown fields, scores or a report for another session or lens are rejected. */
export function parsePlayCharacterCheckReportView(value: unknown, sessionId: string, lens: PlayCharacterCheckLens): PlayCharacterCheckReportView {
  const v = record(value);
  only(v, ['schemaVersion', 'id', 'sessionId', 'target', 'lens', 'branchTurnIds', 'narrativeHash', 'createdAt', 'characters', 'findings', 'discardedCount', 'omissions', 'stale']);
  if (v.schemaVersion !== 1 || v.sessionId !== sessionId || v.lens !== lens || typeof v.stale !== 'boolean') fail();
  if (typeof v.discardedCount !== 'number' || !Number.isSafeInteger(v.discardedCount) || v.discardedCount < 0) fail();
  if (!Array.isArray(v.characters) || !Array.isArray(v.findings) || v.findings.length > 12) fail();
  return {
    schemaVersion: 1,
    id: text(v.id),
    sessionId,
    target: parseTarget(v.target),
    lens,
    branchTurnIds: texts(v.branchTurnIds),
    narrativeHash: text(v.narrativeHash),
    createdAt: text(v.createdAt),
    characters: (v.characters as unknown[]).map((input) => {
      const c = record(input);
      only(c, ['ref', 'name', 'status']);
      const status = c.status === 'referenced' || c.status === 'noReference' || c.status === 'omitted' ? c.status : fail();
      return { ref: text(c.ref), name: text(c.name), status };
    }),
    findings: (v.findings as unknown[]).map((input): PlayCharacterCheckFinding => {
      const f = record(input);
      only(f, ['id', 'characterRef', 'character', 'category', 'quote', 'segmentId', 'evidence', 'evidenceSource', 'note']);
      const category = CATEGORIES.find((item) => item === f.category) ?? fail();
      return {
        id: text(f.id), characterRef: text(f.characterRef), character: text(f.character), category,
        quote: text(f.quote), segmentId: text(f.segmentId), evidence: text(f.evidence), evidenceSource: text(f.evidenceSource), note: text(f.note),
      };
    }),
    discardedCount: v.discardedCount as number,
    omissions: texts(v.omissions),
    stale: v.stale as boolean,
  };
}

export function parsePlayCharacterCheckResult(value: unknown, sessionId: string, input: PlayCharacterCheckInput): PlayCharacterCheckReportView {
  const v = record(value);
  only(v, ['report']);
  const report = parsePlayCharacterCheckReportView(v.report, sessionId, input.lens);
  if (input.target.kind === 'turnMessage' ? report.target.kind !== 'turn' : !samePlayCharacterCheckTarget(report.target, input.target)) fail();
  return report;
}

export function parsePlayCharacterCheckList(value: unknown, sessionId: string, lens: PlayCharacterCheckLens): PlayCharacterCheckReportView[] {
  const v = record(value);
  only(v, ['reports']);
  if (!Array.isArray(v.reports)) fail();
  return (v.reports as unknown[]).map((item) => parsePlayCharacterCheckReportView(item, sessionId, lens));
}

const clip = (value: string, max: number): string => {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
};

/** Editable starting text for a guided Retry or a rehearsal redirect; always within `max` characters. */
export function formatPlayCharacterCheckGuidance(
  finding: Pick<PlayCharacterCheckFinding, 'character' | 'quote' | 'evidence' | 'note' | 'category'>,
  max = 500,
): string {
  const head = `${finding.character}的这句不太像本人（${PLAY_CHARACTER_CHECK_CATEGORY_LABELS[finding.category]}）：`;
  return clip(`${head}“${clip(finding.quote, 120)}”。${clip(finding.note, 160)} 角色资料里写的是：“${clip(finding.evidence, 120)}”。`, max);
}
