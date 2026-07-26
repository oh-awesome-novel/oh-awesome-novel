import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  assertReferenceContextIndex,
  createReferenceContextIndex,
  formatReferenceDistilledEntryContent,
  normalizeReferenceDistillationModelOutput,
} from '@oh-awesome-novel/core';
import type {
  ReferenceDeconstructionFinding,
  ReferenceDistilledCategory,
} from '@oh-awesome-novel/core';

const runId = 'distillation-run-001';
const sourceFinding: ReferenceDeconstructionFinding = {
  id: 'verified-finding-001',
  kind: 'pacing',
  observation: 'A verified abstract observation.',
  technique: 'Change pressure through consequences.',
  confidence: 'high',
  evidenceRefs: [],
  sourceFindingRefs: [],
  generalInference: false,
};
const unit = {
  id: 'distill-unit-001',
  ordinal: 3,
  stageId: 'distillForOan',
  kind: 'distill',
  predecessorUnitIds: ['aggregate-unit-001', 'style-unit-001'],
} as const;

describe('reference deconstruction distillation', () => {
  it('normalizes all five bounded categories into deterministic entries', () => {
    const result = createDistillation();

    expect(result.entries.map((entry) => entry.category)).toEqual([
      'writingStyle',
      'pacing',
      'hooks',
      'scene',
      'character',
    ]);
    expect(result.entries.every((entry) =>
      /^distilled-[a-f0-9]{24}$/u.test(entry.id)
      && entry.estimatedTokens > 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('source prose');
  });

  it('rejects unknown closure, capability, category coverage, and extra fields', () => {
    const base = validModelOutput();
    expect(() => normalizeReferenceDistillationModelOutput({
      ...base,
      entries: base.entries.map((entry, index) => index === 0
        ? { ...entry, sourceFindingRefs: ['unknown-finding'] }
        : entry),
    }, normalizeOptions())).toThrow('unknown source finding');
    expect(() => normalizeReferenceDistillationModelOutput({
      ...base,
      entries: base.entries.map((entry, index) => index === 0
        ? { ...entry, capabilityIds: ['novel.future_capability'] }
        : entry),
    }, normalizeOptions())).toThrow('capability id');
    expect(() => normalizeReferenceDistillationModelOutput({
      ...base,
      entries: [
        ...base.entries.slice(0, 4),
        {
          ...base.entries[3]!,
          title: 'second scene transformed technique',
        },
      ],
    }, normalizeOptions())).toThrow('must include category');
    expect(() => normalizeReferenceDistillationModelOutput({
      ...base,
      quotation: 'untrusted source quotation',
    }, normalizeOptions())).toThrow('Unknown field');
  });

  it('recomputes published entry ids even when content checksum is also forged', () => {
    const index = createReferenceContextIndex({
      referenceId: 'reference-alpha',
      publishedRunId: runId,
      sourceChecksumSha256: 'a'.repeat(64),
      structureFingerprint: 'b'.repeat(64),
      distillation: createDistillation(),
    });
    const forged = structuredClone(index);
    const entry = forged.entries[0]!;
    entry.id = 'distilled-ffffffffffffffffffffffff';
    entry.content = formatReferenceDistilledEntryContent(entry);
    entry.contentChecksumSha256 = sha256(entry.content);

    expect(() => assertReferenceContextIndex(forged, {
      referenceId: 'reference-alpha',
      publishedRunId: runId,
      sourceChecksumSha256: 'a'.repeat(64),
      structureFingerprint: 'b'.repeat(64),
    })).toThrow('stale deterministic id');
  });
});

function createDistillation() {
  return normalizeReferenceDistillationModelOutput(
    validModelOutput(),
    normalizeOptions(),
  );
}

function normalizeOptions() {
  return {
    runId,
    unit,
    verifiedFindings: { [sourceFinding.id]: sourceFinding },
    coveredUnitIds: ['chapter-unit-001'],
    coveredChapterIds: ['0001'],
  };
}

function validModelOutput() {
  return {
    entries: ([
      'writingStyle',
      'pacing',
      'hooks',
      'scene',
      'character',
    ] as const).map(distilledEntry),
    doNotCopyRules: ['Do not copy source expression, facts, or event order.'],
    differentiationWarnings: ['Change premise, motive, setting, and consequences.'],
    uncertainties: [],
  };
}

function distilledEntry(category: ReferenceDistilledCategory) {
  return {
    category,
    title: `${category} transformed technique`,
    technique: `Apply an original ${category} constraint to the current task.`,
    whenUseful: ['Use when this narrative function is required.'],
    constraints: ['Replace all story-specific expression and causal details.'],
    differentiationPrompts: ['Which original premise produces a different outcome?'],
    sourceFindingRefs: [sourceFinding.id],
    confidence: 'high' as const,
    tags: [category],
    capabilityIds: ['novel.write_chapter' as const],
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
