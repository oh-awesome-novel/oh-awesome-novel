import { describe, expect, it } from 'vitest';

import {
  createCandidateChangeSet,
  createCandidateChangeSetBuilder,
  normalizeWorkspaceRelativePath,
  sha256Text,
} from '@oh-awesome-novel/tools';

const fingerprint = 'a'.repeat(64);
const commandLogHash = 'b'.repeat(64);

describe('CandidateChangeSet', () => {
  it('normalizes create, update and delete changes in stable path order', () => {
    const result = createCandidateChangeSet({
      sessionId: 'session-1',
      createdAt: '2026-08-12T00:00:00.000Z',
      finalizedAt: '2026-08-12T00:00:01.000Z',
      projectionFingerprint: fingerprint,
      repository: { repositoryId: 'repo-1', branch: 'main', head: 'abc123' },
      source: {
        kind: 'bash-session',
        capability: 'novel.multi-file-edit',
        commandLogHash,
        commandCount: 3,
        finalization: 'explicit-tool',
      },
      baselineFiles: [
        { path: 'world/old.md', content: 'old\n', mode: 0o644 },
        { path: 'state/value.yaml', content: 'value: old\n', mode: 0o644 },
      ],
      finalFiles: [
        { path: 'state/value.yaml', content: 'value: new\n', mode: 0o644 },
        { path: 'chapters/0001/新章.md', content: '# 新章\n', mode: 0o644 },
      ],
    });

    expect(result?.changes.map((change) => [change.operation, change.path])).toEqual([
      ['create', 'chapters/0001/新章.md'],
      ['update', 'state/value.yaml'],
      ['delete', 'world/old.md'],
    ]);
    expect(result?.stats).toEqual({
      created: 1,
      updated: 1,
      deleted: 1,
      changedBytes: Buffer.byteLength('# 新章\nvalue: new\nold\n', 'utf8'),
    });
    expect(result?.changes[1]).toMatchObject({
      baseline: {
        exists: true,
        sha256: sha256Text('value: old\n'),
        byteLength: 11,
        mode: 0o644,
      },
      draft: {
        sha256: sha256Text('value: new\n'),
        byteLength: 11,
        content: 'value: new\n',
      },
    });
  });

  it('eliminates no-op changes and returns undefined for a clean candidate', () => {
    const result = createCandidateChangeSet({
      sessionId: 'session-1',
      projectionFingerprint: fingerprint,
      repository: { repositoryId: 'repo-1', branch: 'main', head: 'abc123' },
      source: {
        kind: 'deterministic-builder',
        producer: 'test-producer',
        capability: 'state.edit',
      },
      baselineFiles: [{ path: 'state/value.yaml', content: 'value: same\n' }],
      finalFiles: [{ path: 'state/value.yaml', content: 'value: same\n' }],
    });

    expect(result).toBeUndefined();
  });

  it('normalizes a rename into delete plus create', () => {
    const result = createCandidateChangeSet({
      sessionId: 'session-1',
      projectionFingerprint: fingerprint,
      repository: { repositoryId: 'repo-1', branch: 'main', head: 'abc123' },
      source: {
        kind: 'deterministic-builder',
        producer: 'test-producer',
        capability: 'outline.edit',
      },
      baselineFiles: [{ path: 'outline/old.md', content: '# Outline\n' }],
      finalFiles: [{ path: 'outline/new.md', content: '# Outline\n' }],
    });

    expect(result?.changes).toMatchObject([
      { operation: 'create', path: 'outline/new.md' },
      { operation: 'delete', path: 'outline/old.md' },
    ]);
  });

  it('rejects duplicate, non-canonical, invalid text and mode changes', () => {
    const base = {
      sessionId: 'session-1',
      projectionFingerprint: fingerprint,
      repository: { repositoryId: 'repo-1', branch: 'main', head: 'abc123' },
      source: {
        kind: 'deterministic-builder' as const,
        producer: 'test-producer',
        capability: 'state.edit' as const,
      },
    };

    expect(() => createCandidateChangeSet({
      ...base,
      baselineFiles: [],
      finalFiles: [
        { path: 'state/a.yaml', content: 'a: 1\n' },
        { path: 'state/a.yaml', content: 'a: 2\n' },
      ],
    })).toThrow('Duplicate final candidate path');
    expect(() => normalizeWorkspaceRelativePath('chapters/../secret.md')).toThrow(
      'Invalid workspace-relative path',
    );
    expect(() => normalizeWorkspaceRelativePath('chapters/e\u0301.md')).toThrow('NFC-normalized');
    expect(() => createCandidateChangeSet({
      ...base,
      baselineFiles: [],
      finalFiles: [{ path: 'state/a.yaml', content: 'bad\0text' }],
    })).toThrow('NUL');
    expect(() => createCandidateChangeSet({
      ...base,
      baselineFiles: [{ path: 'state/a.yaml', content: 'a: 1\n', mode: 0o644 }],
      finalFiles: [{ path: 'state/a.yaml', content: 'a: 2\n', mode: 0o600 }],
    })).toThrow('mode changes are unsupported');
  });

  it('supports deterministic producers without constructing shell commands', () => {
    const builder = createCandidateChangeSetBuilder({
      sessionId: 'builder-1',
      producer: 'reference-publish',
      capability: 'reference.publish',
      repository: { repositoryId: 'repo-1', branch: 'main', head: 'abc123' },
      baselineFiles: [{ path: 'examples/references/ref-1/old.md', content: 'old\n' }],
      createdAt: '2026-08-12T00:00:00.000Z',
    });
    const result = builder
      .delete('examples/references/ref-1/old.md')
      .write('examples/references/ref-1/new.md', 'new\n')
      .finalize('2026-08-12T00:00:01.000Z');

    expect(result?.source).toMatchObject({
      kind: 'deterministic-builder',
      producer: 'reference-publish',
    });
    expect(result?.changes.map((change) => change.operation)).toEqual(['create', 'delete']);
    expect(() => builder.write('examples/references/ref-1/later.md', 'later'))
      .toThrow('already finalized');
  });
});
