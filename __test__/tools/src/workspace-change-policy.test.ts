import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
  createNotAnalyzedReferenceManifest,
  createReferenceDiagnostics,
  createReferenceProgressProjection,
} from '@oh-awesome-novel/core';

import {
  createCandidateChangeSet,
  createWorkspaceChangePolicy,
  pathMatchesRule,
  sha256Text,
  validateCandidateChangeSetAgainstPolicy,
} from '@oh-awesome-novel/tools';

const SHA = 'a'.repeat(64);

describe('workspace change policy', () => {
  it('reduces missing and unknown host capabilities to read-only', () => {
    for (const capability of [undefined, 'chapter.write', { capability: 'chapter.edit' }]) {
      const policy = createWorkspaceChangePolicy({
        capability,
        exactWritablePaths: ['chapters/0001/0001.md'],
      });
      expect(policy.capability).toBe('read-only');
      expect(policy.writable).toEqual([]);
      expect(policy.validators).toEqual([]);
    }
  });

  it('matches exact and segment-bounded prefix rules', () => {
    expect(pathMatchesRule('state/plot.yaml', { kind: 'exact', path: 'state/plot.yaml' }))
      .toBe(true);
    expect(pathMatchesRule('state/plot.yaml.bak', { kind: 'exact', path: 'state/plot.yaml' }))
      .toBe(false);
    expect(pathMatchesRule('state/nested/plot.yaml', { kind: 'prefix', path: 'state' }))
      .toBe(true);
    expect(pathMatchesRule('statement/plot.yaml', { kind: 'prefix', path: 'state' }))
      .toBe(false);
  });

  it.each([
    '../outside.md',
    '/absolute.md',
    'state/../outside.yaml',
    '.git/config',
    '.workspace/change-engine/v1/action.yaml',
    'characters/.hidden/profile.md',
    'state/.secret.yaml',
  ])('rejects hidden, internal, absolute, or traversal write paths: %s', (path) => {
    expect(() => createWorkspaceChangePolicy({
      capability: 'play.adopt',
      exactWritablePaths: [path],
    })).toThrow();
  });

  it('requires exact host selection for chapters and bounded character/world objects', () => {
    expect(createWorkspaceChangePolicy({ capability: 'chapter.edit' }).writable).toEqual([]);
    expect(createWorkspaceChangePolicy({
      capability: 'chapter.edit',
      exactWritablePaths: ['chapters/0001/0002.md'],
    }).writable).toEqual([{ kind: 'exact', path: 'chapters/0001/0002.md' }]);

    expect(createWorkspaceChangePolicy({
      capability: 'character.edit',
      writablePrefixes: ['characters/mira'],
    }).validators).toEqual(['character-object']);
    expect(() => createWorkspaceChangePolicy({
      capability: 'character.edit',
      writablePrefixes: ['characters'],
    })).toThrow(/cannot be granted/u);
    expect(() => createWorkspaceChangePolicy({
      capability: 'world.edit',
      writablePrefixes: ['world'],
    })).toThrow(/cannot be granted/u);
  });

  it('binds every broad novel family to a complete validator', () => {
    const policy = createWorkspaceChangePolicy({ capability: 'novel.multi-file-edit' });
    expect(policy.validators).toEqual([
      'chapter-markdown',
      'character-object',
      'foreshadow-yaml',
      'outline-markdown',
      'state-yaml',
      'summary-markdown',
      'timeline-yaml',
      'world-object',
    ]);
  });

  it('keeps reference and play adoption constrained to exact host targets', () => {
    const reference = createWorkspaceChangePolicy({
      capability: 'reference.adopt',
      exactWritablePaths: ['world/adopted/rain.md', 'timeline/events.yaml'],
    });
    expect(reference.writable).toEqual([
      { kind: 'exact', path: 'timeline/events.yaml' },
      { kind: 'exact', path: 'world/adopted/rain.md' },
    ]);
    expect(() => createWorkspaceChangePolicy({
      capability: 'reference.adopt',
      writablePrefixes: ['world/adopted'],
    })).toThrow(/cannot be granted/u);

    const play = createWorkspaceChangePolicy({
      capability: 'play.adopt',
      exactWritablePaths: ['state/characters.yaml'],
    });
    expect(play.writable).toEqual([{ kind: 'exact', path: 'state/characters.yaml' }]);
  });

  it('rechecks capability, exact path, draft metadata and final validator', () => {
    const candidate = createCandidateChangeSet({
      sessionId: 'session-policy',
      createdAt: '2026-08-12T00:00:00.000Z',
      finalizedAt: '2026-08-12T00:00:01.000Z',
      projectionFingerprint: SHA,
      repository: { repositoryId: 'repo', branch: 'main', head: 'abc' },
      source: {
        kind: 'bash-session',
        capability: 'chapter.edit',
        commandLogHash: SHA,
        commandCount: 1,
        finalization: 'explicit-tool',
      },
      baselineFiles: [{ path: 'chapters/0001/0001.md', content: '# Old\n' }],
      finalFiles: [{ path: 'chapters/0001/0001.md', content: '# New\n\nScene.\n' }],
    });
    expect(candidate).toBeDefined();
    const policy = createWorkspaceChangePolicy({
      capability: 'chapter.edit',
      exactWritablePaths: ['chapters/0001/0001.md'],
      expectedProjectionFingerprint: SHA,
    });
    expect(validateCandidateChangeSetAgainstPolicy(candidate!, policy)).toBe(candidate);

    const otherChapter = createWorkspaceChangePolicy({
      capability: 'chapter.edit',
      exactWritablePaths: ['chapters/0001/0002.md'],
    });
    expect(() => validateCandidateChangeSetAgainstPolicy(candidate!, otherChapter))
      .toThrow(/outside the turn-scoped policy/u);
  });

  it('verifies a bounded reference publication inventory against draft bytes', () => {
    const referenceId = 'rain-book';
    const report = '# Rain report\n\nAnalysis.\n';
    const sourceChecksum = 'b'.repeat(64);
    const manifest = {
      ...createNotAnalyzedReferenceManifest({
        referenceId,
        sourceChecksumSha256: sourceChecksum,
        structureFingerprint: 'c'.repeat(64),
      }),
      revision: 1,
      status: 'stale' as const,
      publishedRunId: 'run-1',
      outputs: [{
        kind: 'deconstruction' as const,
        path: 'deconstruction/report.md',
        checksumSha256: sha256Text(report),
        sourceRunId: 'run-1',
        sourceChecksumSha256: sourceChecksum,
        stale: false,
      }],
    };
    const generatedAt = '2026-08-12T00:00:00.000Z';
    const files = [
      {
        path: 'examples/references.yaml',
        content: `version: 1\nreferences:\n  - id: ${referenceId}\n`,
      },
      {
        path: `examples/references/${referenceId}/deconstruction-manifest.yaml`,
        content: stringify(manifest),
      },
      {
        path: `examples/references/${referenceId}/diagnostics.yaml`,
        content: stringify(createReferenceDiagnostics({
          referenceId,
          sourceChecksumSha256: sourceChecksum,
          generatedAt,
        })),
      },
      {
        path: `examples/references/${referenceId}/progress.yaml`,
        content: stringify(createReferenceProgressProjection(manifest, generatedAt)),
      },
      {
        path: `examples/references/${referenceId}/deconstruction/report.md`,
        content: report,
      },
    ];
    const candidate = createCandidateChangeSet({
      sessionId: 'reference-publication',
      createdAt: '2026-08-12T00:00:00.000Z',
      finalizedAt: '2026-08-12T00:00:01.000Z',
      projectionFingerprint: SHA,
      repository: { repositoryId: 'repo', branch: 'main', head: 'abc' },
      source: {
        kind: 'deterministic-builder',
        producer: 'reference-publisher',
        capability: 'reference.publish',
      },
      baselineFiles: [],
      finalFiles: files,
    });
    const policy = createWorkspaceChangePolicy({
      capability: 'reference.publish',
      referenceId,
    });
    expect(validateCandidateChangeSetAgainstPolicy(candidate!, policy)).toBe(candidate);
  });

  it('allows a partial reference publication change set without requiring retained files', () => {
    const manifest = createNotAnalyzedReferenceManifest({
      referenceId: 'book-a',
      sourceChecksumSha256: 'b'.repeat(64),
      structureFingerprint: 'c'.repeat(64),
    });
    const progress = stringify(createReferenceProgressProjection(
      manifest,
      '2026-08-12T00:00:00.000Z',
    ));
    const candidate = createCandidateChangeSet({
      sessionId: 'reference-partial',
      createdAt: '2026-08-12T00:00:00.000Z',
      finalizedAt: '2026-08-12T00:00:01.000Z',
      projectionFingerprint: SHA,
      repository: { repositoryId: 'repo', branch: 'main', head: 'abc' },
      source: {
        kind: 'deterministic-builder',
        producer: 'reference-publisher',
        capability: 'reference.publish',
      },
      baselineFiles: [{
        path: 'examples/references/book-a/progress.yaml',
        content: `${progress}# previous projection\n`,
      }],
      finalFiles: [{
        path: 'examples/references/book-a/progress.yaml',
        content: progress,
      }],
    });
    const policy = createWorkspaceChangePolicy({
      capability: 'reference.publish',
      referenceId: 'book-a',
    });
    expect(validateCandidateChangeSetAgainstPolicy(candidate!, policy)).toBe(candidate);
  });
});
