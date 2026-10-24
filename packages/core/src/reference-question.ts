import {
  createReferenceDeconstructionWorkPlan,
  DEFAULT_REFERENCE_CHAPTER_ANALYSIS_CHUNK_CHARS,
  resolveReferenceChapterWorkUnitWindow,
} from './reference-deconstruction-full.js';
import type { ReferenceChapterWorkUnitWindow } from './reference-deconstruction-full.js';
import { readReferencePreviewSource } from './reference-deconstruction-store.js';
import type { ReferenceEvidencePointerMap } from './reference-deconstruction.js';

export const MAX_REFERENCE_QUESTION_CHARS = 1_000 as const;
export const MAX_REFERENCE_QUESTION_ANSWER_CHARS = 6_000 as const;
export const MAX_REFERENCE_QUESTION_FINDINGS = 12 as const;
/** Exact source runs at least this long in an answer are flagged as copy risk. */
export const REFERENCE_QUESTION_COPY_WINDOW_CHARS = 80 as const;

export interface ReferenceQuestionSource {
  referenceId: string;
  title: string;
  windows: ReferenceChapterWorkUnitWindow[];
}

export interface ReferenceQuestionFinding {
  observation: string;
  technique?: string;
  evidenceRefs: string[];
}

export interface ReferenceQuestionAnswer {
  question: string;
  answer: string;
  findings: ReferenceQuestionFinding[];
  uncertainties: string[];
  /** Host pointers cited by the answer, resolved to chapter and lines. */
  evidence: Array<{ pointerId: string; chapterId: string; lineStart: number; lineEnd: number }>;
  copyRisk: boolean;
}

/**
 * Split an imported reference into host pointers for a read-only, one-off
 * question. Nothing is written: the answer is advisory and never becomes a
 * deconstruction run, a published bundle or novel canon.
 */
export async function prepareReferenceQuestionSource(
  workspaceRoot: string,
  referenceId: string,
  options: { maxChunkChars?: number } = {},
): Promise<ReferenceQuestionSource> {
  const source = await readReferencePreviewSource(workspaceRoot, referenceId);
  const plan = createReferenceDeconstructionWorkPlan({
    referenceId: source.metadata.id,
    sourceChecksumSha256: source.sourceManifest.checksumSha256,
    structureFingerprint: source.sourceManifest.structureFingerprint,
    sourceText: source.sourceText,
    chapters: source.sourceManifest.detectedStructure.chapters,
    outputs: ['techniques'],
    maxChunkChars: options.maxChunkChars ?? DEFAULT_REFERENCE_CHAPTER_ANALYSIS_CHUNK_CHARS,
  });
  return {
    referenceId: source.metadata.id,
    title: source.metadata.title,
    windows: plan.units
      .filter((unit) => unit.kind === 'chapterChunk')
      .map((unit) => resolveReferenceChapterWorkUnitWindow(source.sourceText, unit)),
  };
}

export function normalizeReferenceQuestion(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Reference question must be a string.');
  const question = value.trim();
  if (!question || question.length > MAX_REFERENCE_QUESTION_CHARS) {
    throw new Error(`Reference question must be 1-${MAX_REFERENCE_QUESTION_CHARS} characters.`);
  }
  return question;
}

/** Validate a model answer against the pointers the model actually opened. */
export function normalizeReferenceQuestionAnswer(
  value: unknown,
  options: {
    question: string;
    allowedPointers: ReferenceEvidencePointerMap;
    windows: readonly ReferenceChapterWorkUnitWindow[];
  },
): ReferenceQuestionAnswer {
  if (!isRecord(value)) throw new Error('Reference question answer must be an object.');
  assertOnlyKnownFields(value, ['answer', 'findings', 'uncertainties']);
  const answer = requireText(value.answer, 'answer', MAX_REFERENCE_QUESTION_ANSWER_CHARS);
  if (!Array.isArray(value.findings) || value.findings.length > MAX_REFERENCE_QUESTION_FINDINGS) {
    throw new Error('Reference question findings are out of bounds.');
  }
  const findings = value.findings.map((item, index): ReferenceQuestionFinding => {
    if (!isRecord(item)) throw new Error(`findings[${index}] must be an object.`);
    assertOnlyKnownFields(item, ['observation', 'technique', 'evidenceRefs']);
    const observation = requireText(item.observation, `findings[${index}].observation`, 2_000);
    const technique = item.technique === null || item.technique === undefined
      ? undefined
      : requireText(item.technique, `findings[${index}].technique`, 2_000);
    if (!Array.isArray(item.evidenceRefs) || !item.evidenceRefs.length || item.evidenceRefs.length > 8) {
      throw new Error(`findings[${index}].evidenceRefs must cite 1-8 pointers.`);
    }
    const evidenceRefs = [...new Set(item.evidenceRefs.map((ref) => {
      if (typeof ref !== 'string' || !options.allowedPointers[ref]) {
        throw new Error(`findings[${index}] cites a pointer that was not opened: ${String(ref)}.`);
      }
      return ref;
    }))];
    return { observation, ...(technique ? { technique } : {}), evidenceRefs };
  });
  if (
    !Array.isArray(value.uncertainties)
    || value.uncertainties.length > 16
    || value.uncertainties.some((item) => typeof item !== 'string' || item.length > 1_000)
  ) {
    throw new Error('Reference question uncertainties are out of bounds.');
  }
  const cited = [...new Set(findings.flatMap((finding) => finding.evidenceRefs))];
  const texts = [answer, ...findings.flatMap((finding) =>
    [finding.observation, finding.technique ?? ''])];
  return {
    question: options.question,
    answer,
    findings,
    uncertainties: value.uncertainties as string[],
    evidence: cited.map((pointerId) => {
      const pointer = options.allowedPointers[pointerId]!;
      return {
        pointerId,
        chapterId: pointer.chapterId,
        lineStart: pointer.lineStart,
        lineEnd: pointer.lineEnd,
      };
    }),
    copyRisk: texts.some((text) => containsSourceRun(text, options.windows)),
  };
}

/**
 * Probe aligned windows of the text against the source. Any copied run of at
 * least 1.5x the window length contains one aligned probe, which keeps the
 * check linear in the source size.
 */
function containsSourceRun(
  text: string,
  windows: readonly ReferenceChapterWorkUnitWindow[],
): boolean {
  const size = REFERENCE_QUESTION_COPY_WINDOW_CHARS;
  const step = Math.floor(size / 2);
  for (let index = 0; index + size <= text.length; index += step) {
    const probe = text.slice(index, index + size);
    if (windows.some((window) => window.content.includes(probe))) return true;
  }
  return false;
}

function requireText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Reference question ${label} must be 1-${maximum} characters.`);
  }
  return value.trim();
}

function assertOnlyKnownFields(value: Record<string, unknown>, fields: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length) {
    throw new Error(`Reference question answer has unknown fields: ${unknown.join(', ')}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
