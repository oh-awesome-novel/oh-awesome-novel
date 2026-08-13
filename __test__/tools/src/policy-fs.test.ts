import { Bash, InMemoryFs } from 'just-bash';
import { describe, expect, it } from 'vitest';

import {
  PolicyFs,
  TrackingFs,
  createWorkspaceChangePolicy,
} from '@oh-awesome-novel/tools';

describe('PolicyFs', () => {
  it('enforces bootstrap lifecycle, read secrecy and the complete denied mutation surface', async () => {
    const memory = new InMemoryFs({
      '/workspace/chapters/0001/0001.md': 'visible\n',
      '/workspace/chapters/unprojected.md': 'must stay hidden\n',
      '/workspace/.oan/constitution/rules.md': 'readonly\n',
      '/workspace/.git/config': 'secret\n',
      '/workspace/.workspace/private': 'secret\n',
    });
    const tracking = new TrackingFs(memory, {
      baselineFiles: [{ path: 'chapters/0001/0001.md', content: 'visible\n' }],
    });
    const policy = new PolicyFs(tracking, {
      policy: createWorkspaceChangePolicy({
        capability: 'chapter.edit',
        exactWritablePaths: ['chapters/0001/0001.md'],
      }),
      baselineFiles: [{ path: 'chapters/0001/0001.md', content: 'visible\n' }],
      projectedPaths: ['chapters', 'chapters/0001', 'chapters/0001/0001.md', '.oan', '.oan/constitution', '.oan/constitution/rules.md'],
    });

    expect(() => policy.mkdirSync('/bin', { recursive: true })).not.toThrow();
    expect(() => policy.writeFileSync('/bin/cat', '# stub')).not.toThrow();
    await expect(policy.writeFile('/workspace/chapters/0001/0001.md', 'too early')).rejects.toThrow('bootstrap');
    policy.activate();
    expect(() => policy.writeFileSync('/bin/late', '# no')).toThrow('denied');

    await expect(policy.readFile('/workspace/chapters/0001/0001.md')).resolves.toBe('visible\n');
    await expect(policy.readFile('/workspace/.oan/constitution/rules.md')).resolves.toBe('readonly\n');
    await expect(policy.exists('/workspace/chapters/unprojected.md')).resolves.toBe(false);
    await expect(policy.exists('/workspace/.git/config')).resolves.toBe(false);
    await expect(policy.stat('/workspace/.workspace/private')).rejects.toThrow('ENOENT');
    expect(await policy.readdir('/workspace/chapters')).toEqual(['0001']);
    expect(policy.getAllPaths()).not.toContain('/workspace/chapters/unprojected.md');
    expect(policy.getAllPaths()).not.toContain('/workspace/.git/config');

    await expect(policy.writeFile('/workspace/.git/config', 'no')).rejects.toThrow('denied');
    await expect(policy.writeFile('/workspace/.oan/constitution/rules.md', 'no')).rejects.toThrow('denied');
    await expect(policy.writeFile('/workspace/chapters/0001/0002.md', 'no')).rejects.toThrow('denied');
    await expect(policy.writeFile('/workspace/../../escape', 'no')).rejects.toThrow('non-canonical');
    await expect(policy.writeFile('/etc/passwd', 'no')).rejects.toThrow('denied');
    await expect(policy.chmod('/workspace/chapters/0001/0001.md', 0o600)).rejects.toThrow('unsupported');
    await expect(policy.symlink('/tmp/x', '/workspace/chapters/0001/0001.md')).rejects.toThrow('unsupported');
    await expect(policy.link('/workspace/chapters/0001/0001.md', '/tmp/link')).rejects.toThrow('unsupported');
    await expect(policy.utimes('/workspace/chapters/0001/0001.md', new Date(), new Date())).rejects.toThrow('unsupported');
  });

  it('captures redirect, heredoc, append, sed, yq, copy, move and recursive removal in the VFS only', async () => {
    const baseline = [
      { path: 'chapters/a.md', content: 'alpha\n', mode: 0o644 },
      { path: 'chapters/delete.md', content: 'delete\n', mode: 0o644 },
    ];
    const memory = new InMemoryFs({
      '/workspace/chapters/a.md': 'alpha\n',
      '/workspace/chapters/delete.md': 'delete\n',
    });
    const tracking = new TrackingFs(memory, { baselineFiles: baseline });
    const policy = new PolicyFs(tracking, {
      policy: createWorkspaceChangePolicy({ capability: 'novel.multi-file-edit' }),
      baselineFiles: baseline,
      projectedPaths: ['chapters', 'chapters/a.md', 'chapters/delete.md'],
    });
    const bash = new Bash({
      fs: policy,
      cwd: '/workspace',
      commands: ['cat', 'printf', 'sed', 'yq', 'cp', 'mv', 'rm', 'mkdir'],
      python: false,
      javascript: false,
    });
    policy.activate();

    expect((await bash.exec("printf 'beta\\n' > chapters/new.md")).exitCode).toBe(0);
    expect((await bash.exec("printf 'tail\\n' >> chapters/a.md")).exitCode).toBe(0);
    expect((await bash.exec("cat <<'EOF' > chapters/heredoc.md\n中文 内容\nEOF")).exitCode).toBe(0);
    expect((await bash.exec("sed -i 's/alpha/ALPHA/' chapters/a.md")).exitCode).toBe(0);
    expect((await bash.exec("printf 'version: 1\\n' > chapters/config.yaml && yq -i '.version = 2' chapters/config.yaml")).exitCode).toBe(0);
    expect((await bash.exec('mkdir -p chapters/tmp && cp chapters/new.md chapters/tmp/copy.md')).exitCode).toBe(0);
    expect((await bash.exec('mv chapters/tmp/copy.md chapters/moved.md && rm -r chapters/tmp')).exitCode).toBe(0);
    expect((await bash.exec('rm chapters/delete.md')).exitCode).toBe(0);

    const reconciled = await tracking.reconcileWorkspace();
    expect(reconciled.candidatePaths).toEqual([
      'chapters/a.md',
      'chapters/config.yaml',
      'chapters/delete.md',
      'chapters/heredoc.md',
      'chapters/moved.md',
      'chapters/new.md',
    ]);
    expect(await memory.readFile('/workspace/chapters/a.md')).toBe('ALPHA\ntail\n');
    expect(await memory.readFile('/workspace/chapters/config.yaml')).toBe('version: 2\n');
  });

  it('fails closed for unknown capabilities and applies separate candidate/scratch quotas', async () => {
    const readonlyMemory = new InMemoryFs({ '/workspace/chapters/0001/0001.md': 'a\n' });
    const readonly = new PolicyFs(new TrackingFs(readonlyMemory), {
      policy: createWorkspaceChangePolicy({ capability: 'invented-capability' }),
      projectedPaths: ['chapters', 'chapters/0001', 'chapters/0001/0001.md'],
    });
    readonly.activate();
    await expect(readonly.writeFile('/workspace/chapters/0001/0001.md', 'no')).rejects.toThrow('denied');

    const memory = new InMemoryFs({ '/workspace/chapters/0001/0001.md': 'a\n' });
    const baseline = [{ path: 'chapters/0001/0001.md', content: 'a\n', mode: 0o644 }];
    const constrained = new PolicyFs(new TrackingFs(memory, { baselineFiles: baseline }), {
      policy: createWorkspaceChangePolicy({
        capability: 'chapter.edit',
        exactWritablePaths: ['chapters/0001/0001.md'],
        maxCandidateBytes: 5,
        maxFileBytes: 5,
      }),
      baselineFiles: baseline,
      projectedPaths: ['chapters', 'chapters/0001', 'chapters/0001/0001.md'],
      maxScratchBytes: 3,
    });
    constrained.activate();

    await expect(constrained.writeFile('/tmp/note', '1234')).rejects.toThrow('scratch');
    await expect(constrained.exists('/tmp/note')).resolves.toBe(false);
    await expect(constrained.writeFile('/workspace/chapters/0001/0001.md', '123456')).rejects.toThrow('EFBIG');
    expect(await memory.readFile('/workspace/chapters/0001/0001.md')).toBe('a\n');
    await constrained.writeFile('/tmp/note', '123');
    await constrained.writeFile('/workspace/chapters/0001/0001.md', '12345');
    await expect(constrained.getUsage()).resolves.toEqual({
      changedFiles: 1,
      candidateBytes: 5,
      scratchBytes: 3,
    });
  });

  it('isolates two policy sessions backed by independent fixed filesystems', async () => {
    const make = () => {
      const baseline = [{ path: 'chapters/0001/0001.md', content: 'same\n', mode: 0o644 }];
      const memory = new InMemoryFs({ '/workspace/chapters/0001/0001.md': 'same\n' });
      const tracking = new TrackingFs(memory, { baselineFiles: baseline });
      const policy = new PolicyFs(tracking, {
        policy: createWorkspaceChangePolicy({
          capability: 'chapter.edit',
          exactWritablePaths: ['chapters/0001/0001.md'],
        }),
        baselineFiles: baseline,
        projectedPaths: ['chapters', 'chapters/0001', 'chapters/0001/0001.md'],
      });
      policy.activate();
      return policy;
    };
    const first = make();
    const second = make();
    await first.writeFile('/workspace/chapters/0001/0001.md', 'first\n');
    await expect(second.readFile('/workspace/chapters/0001/0001.md')).resolves.toBe('same\n');
  });
});
