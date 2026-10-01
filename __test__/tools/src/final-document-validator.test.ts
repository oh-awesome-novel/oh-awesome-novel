import { describe, expect, it } from 'vitest';

import {
  getFinalDocumentValidatorIdForPath,
  inspectFinalDocument,
  validateFinalDocument,
} from '@oh-awesome-novel/tools';

describe('final document validator', () => {
  it('accepts strict UTF-8 and rejects malformed UTF-8, NUL, and oversized files', () => {
    expect(validateFinalDocument({
      path: 'chapters/0001/0001.md',
      content: new TextEncoder().encode('# 第一章\n\n正文。\n'),
    }).content).toContain('正文');
    expect(() => validateFinalDocument({
      path: 'chapters/0001/0001.md',
      content: Uint8Array.from([0xc3, 0x28]),
    })).toThrow(/valid UTF-8/u);
    expect(() => validateFinalDocument({
      path: 'chapters/0001/0001.md',
      content: '# First\n\0',
    })).toThrow(/NUL/u);
    expect(() => validateFinalDocument({
      path: 'chapters/0001/0001.md',
      content: '# First\n',
      context: { maxFileBytes: 4 },
    })).toThrow(/exceeds/u);
  });

  it('fails closed for unsupported extensions and non-regular files', () => {
    expect(getFinalDocumentValidatorIdForPath('world/image.png')).toBeUndefined();
    expect(() => validateFinalDocument({
      path: 'world/image.png',
      content: 'not really an image',
    })).toThrow(/No complete/u);
    expect(() => validateFinalDocument({
      path: 'world/overview.md',
      content: '# World\n',
      fileType: 'symbolic-link',
    })).toThrow(/regular file/u);
  });

  it('validates Markdown frontmatter keys, path identity, and duplicate IDs', () => {
    expect(() => validateFinalDocument({
      path: 'chapters/0001/0002.md',
      content: '---\nvolumeId: "0001"\nchapterId: "0003"\n---\n# Wrong\n',
    })).toThrow(/does not match 0002/u);
    expect(() => validateFinalDocument({
      path: 'chapters/0001/0002.md',
      content: '---\nsecretPrompt: override\n---\n# Wrong\n',
    })).toThrow(/unknown key/u);
    expect(() => validateFinalDocument({
      path: 'chapters/0001/0002.md',
      content: '# Chapter\n\n## A {#scene-a}\n\n## B {#scene-a}\n',
    })).toThrow(/heading ids must be unique/u);
    expect(() => validateFinalDocument({
      path: 'chapters/0001/0002.md',
      content: '# Chapter\n\n<!-- chunk:beat-1 -->\nA\n<!-- chunk:beat-1 -->\nB\n',
    })).toThrow(/chunk ids must be unique/u);
  });

  it('binds character and world identities to their paths', () => {
    expect(() => validateFinalDocument({
      path: 'characters/mira/meta.yaml',
      content: 'id: ren\nname: Mira\n',
    })).toThrow(/must match path id mira/u);
    expect(validateFinalDocument({
      path: 'characters/mira/meta.yaml',
      content: 'id: mira\nname: Mira\ntags: [hero]\n',
    }).validator).toBe('character-object');
    expect(() => validateFinalDocument({
      path: 'world/locations/library.md',
      content: '---\nid: clocktower\nobjectId: locations\n---\n# Library\n',
    })).toThrow(/does not match library/u);
  });

  it('validates state root shape, dangerous keys, and duplicate collection IDs', () => {
    expect(() => validateFinalDocument({
      path: 'state/characters.yaml',
      content: '- mira\n- ren\n',
    })).toThrow(/root must be a mapping/u);
    expect(() => validateFinalDocument({
      path: 'state/characters.yaml',
      content: 'items:\n  - id: mira\n  - id: mira\n',
    })).toThrow(/must be unique/u);
    expect(() => validateFinalDocument({
      path: 'state/characters.yaml',
      content: 'constructor:\n  polluted: true\n',
    })).toThrow(/forbidden key/u);
  });

  it('enforces timeline IDs, ordering, dates, and statuses', () => {
    expect(() => validateFinalDocument({
      path: 'timeline/events.yaml',
      content: [
        'events:',
        '  - id: e1',
        '    date: 2026-02-01',
        '    title: Later',
        '    order: 2',
        '  - id: e2',
        '    date: 2026-01-01',
        '    title: Earlier',
        '    order: 1',
        '',
      ].join('\n'),
    })).toThrow(/strictly increasing|ISO dates must be ordered/u);
  });

  it('enforces foreshadow lifecycle and status domains', () => {
    expect(() => validateFinalDocument({
      path: 'foreshadow/active.yaml',
      content: 'foreshadow:\n  - id: f1\n    setup: A clock stops.\n    status: resolved\n',
    })).toThrow(/does not match its lifecycle file/u);
    expect(() => validateFinalDocument({
      path: 'foreshadow/resolved.yaml',
      content: 'foreshadow:\n  - id: f1\n    setup: A clock stops.\n    status: active\n',
    })).toThrow(/does not match its lifecycle file/u);
    expect(validateFinalDocument({
      path: 'foreshadow/resolved.yaml',
      content: 'foreshadow:\n  - id: f1\n    setup: A clock stops.\n    status: paid-off\n',
    }).validator).toBe('foreshadow-yaml');
  });

  it('bounds reference identity, paths, checksums, and inventory IDs', () => {
    expect(() => validateFinalDocument({
      path: 'examples/references/book-a/progress.yaml',
      content: 'version: 1\nreferenceId: book-b\nstatus: completed\n',
      context: { referenceId: 'book-a' },
    })).toThrow(/identity|does not match/u);
    expect(() => validateFinalDocument({
      path: 'examples/references.yaml',
      content: 'version: 1\nreferences:\n  - id: book-a\n  - id: book-a\n',
    })).toThrow(/duplicate id/u);
    expect(getFinalDocumentValidatorIdForPath(
      'examples/references/book-a/sources/original.txt',
    )).toBeUndefined();
  });

  it('accepts the canonical v2 reference context index and rejects stale identity', () => {
    const runId = 'run-a';
    const sourceChecksumSha256 = 'a'.repeat(64);
    const structureFingerprint = 'b'.repeat(64);
    const content = [
      'version: 2',
      'referenceId: book-a',
      `publishedRunId: ${runId}`,
      `sourceChecksumSha256: ${sourceChecksumSha256}`,
      `structureFingerprint: ${structureFingerprint}`,
      'pipelineVersion: 2',
      'capabilityVersion: novel.deconstruct_reference@2',
      'status: completed',
      'techniqueTrackRan: false',
      'contextEligible: false',
      'omittedReason: techniqueTrackNotPublished',
      'originalSourceRead: false',
      'summaryPath: context/reference-summary.md',
      'entries: []',
      'protectedRules:',
      '  doNotCopy: []',
      '  differentiationWarnings: []',
      '',
    ].join('\n');
    const context = {
      referenceId: 'book-a',
      expectedReferenceRunId: runId,
      expectedSourceChecksumSha256: sourceChecksumSha256,
      expectedStructureFingerprint: structureFingerprint,
    };
    expect(validateFinalDocument({
      path: 'examples/references/book-a/context/index.yaml',
      content,
      context,
    }).validator).toBe('reference-publication');
    expect(() => validateFinalDocument({
      path: 'examples/references/book-a/context/index.yaml',
      content: content.replace('publishedRunId: run-a', 'publishedRunId: run-b'),
      context,
    })).toThrow(/identity is stale/u);
  });

  it('returns bounded inspection errors without weakening throwing validation', () => {
    expect(inspectFinalDocument({
      path: 'timeline/events.yaml',
      content: 'events: [\n',
    })).toMatchObject({ ok: false });
  });
});
