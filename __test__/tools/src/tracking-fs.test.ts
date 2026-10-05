import { InMemoryFs, latin1FromBytes } from 'just-bash';
import { describe, expect, it } from 'vitest';

import { TrackingFs } from '@oh-awesome-novel/tools';

const baseline = [
  { path: 'chapters/a.md', content: 'alpha\n', mode: 0o644 },
  { path: 'chapters/b.md', content: 'bravo\n', mode: 0o644 },
];

describe('TrackingFs', () => {
  it.each([0o600, 0o640, 0o666])('preserves mode %s when overwriting projected content', async (mode) => {
    const path = 'chapters/a.md';
    const memory = new InMemoryFs({
      [`/workspace/${path}`]: { content: 'before\n', mode },
    });
    const fs = new TrackingFs(memory, {
      baselineFiles: [{ path, content: 'before\n', mode }],
    });
    fs.activate();

    await fs.writeFile(`/workspace/${path}`, 'after\n');
    const reconciliation = await fs.reconcileWorkspace();
    expect(reconciliation.finalFiles).toEqual([{ path, content: 'after\n', mode }]);
    expect(reconciliation.candidatePaths).toEqual([path]);

    await fs.writeFile(`/workspace/${path}`, 'before\n');
    expect((await fs.reconcileWorkspace()).candidatePaths).toEqual([]);
  });

  it('covers the complete async mutation surface and raw byte reads', async () => {
    const memory = new InMemoryFs({
      '/workspace/chapters/a.md': 'alpha\n',
      '/workspace/chapters/b.md': 'bravo\n',
    });
    const fs = new TrackingFs(memory, { baselineFiles: baseline });
    fs.mkdirSync('/bin', { recursive: true });
    fs.writeFileSync('/bin/test', '# stub');
    expect(fs.getMutationLog()).toEqual([]);
    fs.activate();

    await fs.writeFile('/workspace/chapters/a.md', 'changed\n');
    await fs.appendFile('/workspace/chapters/a.md', 'again\n');
    await fs.mkdir('/workspace/new', { recursive: true });
    await fs.cp('/workspace/chapters/a.md', '/workspace/new/copy.md');
    await fs.mv('/workspace/new/copy.md', '/workspace/new/moved.md');
    await fs.rm('/workspace/new/moved.md');
    await fs.chmod('/workspace/chapters/a.md', 0o600);
    await fs.symlink('a.md', '/workspace/chapters/link.md');
    await fs.link('/workspace/chapters/b.md', '/workspace/chapters/hard.md');
    await fs.utimes('/workspace/chapters/b.md', new Date(0), new Date(1));

    expect(fs.getMutationLog().map((entry) => entry.operation)).toEqual([
      'writeFile',
      'appendFile',
      'mkdir',
      'cp',
      'mv',
      'rm',
      'chmod',
      'symlink',
      'link',
      'utimes',
    ]);
    expect(Buffer.from(latin1FromBytes(await fs.readFileBytes('/workspace/chapters/b.md')), 'latin1').toString()).toBe('bravo\n');
    expect(() => fs.writeFileSync('/bin/late', 'no')).toThrow('frozen');
    expect(() => fs.mkdirSync('/usr/bin', { recursive: true })).toThrow('frozen');
  });

  it('reconciles actual final bytes and eliminates log-only no-ops', async () => {
    const memory = new InMemoryFs({
      '/workspace/chapters/a.md': 'alpha\n',
      '/workspace/chapters/b.md': 'bravo\n',
    });
    const fs = new TrackingFs(memory, { baselineFiles: baseline });
    fs.activate();

    await fs.writeFile('/workspace/chapters/a.md', 'temporary\n');
    await fs.writeFile('/workspace/chapters/a.md', 'alpha\n');
    await fs.mv('/workspace/chapters/b.md', '/workspace/chapters/temp.md');
    await fs.mv('/workspace/chapters/temp.md', '/workspace/chapters/b.md');
    await fs.writeFile('/workspace/chapters/new.md', 'new\n');
    await fs.rm('/workspace/chapters/b.md');

    const reconciled = await fs.reconcileWorkspace();
    expect(fs.getMutationLog()).toHaveLength(6);
    expect(reconciled.candidatePaths).toEqual([
      'chapters/b.md',
      'chapters/new.md',
    ]);
    expect(reconciled.finalFiles.map((file) => file.path)).toEqual([
      'chapters/a.md',
      'chapters/new.md',
    ]);
  });

  it('keeps sessions isolated even when they begin from identical snapshots', async () => {
    const first = new TrackingFs(new InMemoryFs({
      '/workspace/chapters/a.md': 'alpha\n',
    }), { baselineFiles: baseline.slice(0, 1) });
    const second = new TrackingFs(new InMemoryFs({
      '/workspace/chapters/a.md': 'alpha\n',
    }), { baselineFiles: baseline.slice(0, 1) });
    first.activate();
    second.activate();

    await first.writeFile('/workspace/chapters/a.md', 'first\n');
    expect(await second.readFile('/workspace/chapters/a.md')).toBe('alpha\n');
    expect((await first.reconcileWorkspace()).candidatePaths).toEqual(['chapters/a.md']);
    expect((await second.reconcileWorkspace()).candidatePaths).toEqual([]);
  });

  it('rejects invalid final binary and symlink states during authoritative reconciliation', async () => {
    const memory = new InMemoryFs({ '/workspace/chapters/a.md': 'alpha\n' });
    const fs = new TrackingFs(memory, { baselineFiles: baseline.slice(0, 1) });
    fs.activate();
    await fs.writeFile('/workspace/chapters/a.md', new Uint8Array([0xff]));
    await expect(fs.reconcileWorkspace()).rejects.toThrow('valid UTF-8');

    await fs.rm('/workspace/chapters/a.md');
    await fs.symlink('/tmp/elsewhere', '/workspace/chapters/a.md');
    await expect(fs.reconcileWorkspace()).rejects.toThrow('symbolic link');
  });
});
