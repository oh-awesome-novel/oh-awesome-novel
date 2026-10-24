import type { ReferenceQuestionAnswer } from '@oh-awesome-novel/core';

export type { ReferenceQuestionAnswer, ReferenceQuestionFinding } from '@oh-awesome-novel/core';

export const MAX_REFERENCE_QUESTION_INPUT_CHARS = 1_000;

/** Advisory answer from free exploration of one reference; nothing is persisted. */
export type ReferenceQuestionResult =
  | { status: 'completed'; answer: ReferenceQuestionAnswer }
  | { status: 'failed'; error: { code: string; message: string; retryable: boolean } }
  | { status: 'aborted' };

const fail = (): never => { throw new Error('Invalid reference question response.'); };

function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key) && !optional.includes(key))
    || keys.some((key) => !Object.hasOwn(record, key))) return fail();
  return record;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) return fail();
  return value;
}

function line(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return fail();
  return value as number;
}

export function assertReferenceQuestionInput(question: string): string {
  const trimmed = typeof question === 'string' ? question.trim() : '';
  if (!trimmed || trimmed.length > MAX_REFERENCE_QUESTION_INPUT_CHARS) {
    throw new Error(`Reference question must be 1-${MAX_REFERENCE_QUESTION_INPUT_CHARS} characters.`);
  }
  return trimmed;
}

export function parseReferenceQuestionResult(value: unknown): ReferenceQuestionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const status = (value as Record<string, unknown>).status;
  if (status === 'aborted') {
    object(value, ['status']);
    return { status: 'aborted' };
  }
  if (status === 'failed') {
    const record = object(value, ['status', 'error']);
    const error = object(record.error, ['code', 'message', 'retryable']);
    if (typeof error.retryable !== 'boolean') fail();
    return {
      status: 'failed',
      error: {
        code: text(error.code, 64),
        message: text(error.message, 1_000),
        retryable: error.retryable as boolean,
      },
    };
  }
  if (status !== 'completed') return fail();
  const record = object(value, ['status', 'answer']);
  const answer = object(record.answer, ['question', 'answer', 'findings', 'uncertainties', 'evidence', 'copyRisk']);
  if (!Array.isArray(answer.findings) || answer.findings.length > 12
    || !Array.isArray(answer.uncertainties) || answer.uncertainties.length > 16
    || !Array.isArray(answer.evidence) || answer.evidence.length > 96
    || typeof answer.copyRisk !== 'boolean') fail();
  const evidence = (answer.evidence as unknown[]).map((item) => {
    const entry = object(item, ['pointerId', 'chapterId', 'lineStart', 'lineEnd']);
    const lineStart = line(entry.lineStart);
    const lineEnd = line(entry.lineEnd);
    if (lineEnd < lineStart) fail();
    return {
      pointerId: text(entry.pointerId, 256),
      chapterId: text(entry.chapterId, 256),
      lineStart,
      lineEnd,
    };
  });
  const cited = new Set(evidence.map((entry) => entry.pointerId));
  return {
    status: 'completed',
    answer: {
      question: text(answer.question, MAX_REFERENCE_QUESTION_INPUT_CHARS),
      answer: text(answer.answer, 6_000),
      findings: (answer.findings as unknown[]).map((item) => {
        const finding = object(item, ['observation', 'evidenceRefs'], ['technique']);
        if (!Array.isArray(finding.evidenceRefs) || !finding.evidenceRefs.length
          || finding.evidenceRefs.some((ref) => typeof ref !== 'string' || !cited.has(ref))) fail();
        return {
          observation: text(finding.observation, 2_000),
          ...(finding.technique === undefined ? {} : { technique: text(finding.technique, 2_000) }),
          evidenceRefs: finding.evidenceRefs as string[],
        };
      }),
      uncertainties: (answer.uncertainties as unknown[]).map((item) => text(item, 1_000)),
      evidence,
      copyRisk: answer.copyRisk as boolean,
    },
  };
}
