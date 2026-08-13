import { describe, expect, it } from 'vitest';

import { renderCandidateChangeDiff } from '@oh-awesome-novel/tools';

describe('candidate change diff', () => {
  it('renders deterministic Git-style create, update and delete patches', () => {
    const diff = renderCandidateChangeDiff([
      { operation: 'delete', path: 'world/old.md', oldContent: 'old\n' },
      { operation: 'create', path: 'chapters/new.md', newContent: 'new\n' },
      {
        operation: 'update',
        path: 'state/value.yaml',
        oldContent: 'value: old\n',
        newContent: 'value: new\n',
      },
    ]);

    expect(diff.indexOf('+++ b/chapters/new.md')).toBeLessThan(
      diff.indexOf('--- a/state/value.yaml'),
    );
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('diff --git a/chapters/new.md b/chapters/new.md');
    expect(diff).toContain('new file mode 100644');
    expect(diff).toContain('+++ b/chapters/new.md');
    expect(diff).toContain('-value: old');
    expect(diff).toContain('+value: new');
    expect(diff).toContain('+++ /dev/null');
    expect(diff).toContain('deleted file mode 100644');
  });

  it('rejects duplicate paths and oversized rendered output', () => {
    expect(() => renderCandidateChangeDiff([
      { operation: 'create', path: 'state/a.yaml', newContent: 'a: 1\n' },
      { operation: 'create', path: 'state/a.yaml', newContent: 'a: 2\n' },
    ])).toThrow('Duplicate diff path');

    expect(() => renderCandidateChangeDiff([
      { operation: 'create', path: 'state/a.yaml', newContent: 'a'.repeat(100) },
    ], { maxBytes: 20 })).toThrow('Rendered diff exceeds');
  });
});
