import { describe, expect, it, vi } from 'vitest';
import { createReadTools } from '@oh-awesome-novel/tools';
import type { WorkspaceReader } from '@oh-awesome-novel/tools';

// Native Windows path functions must never leak into the POSIX projection.
vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:path')>();
  return { ...original.win32, posix: original.posix, win32: original.win32, default: original.win32 };
});

function fixture() {
  const files: Record<string, string> = {
    '/workspace/chapters/0001/0001.md': '# Chapter\nProjected chapter.\n',
    '/workspace/.oan/workflow.yaml': 'name: novel\n',
    '/workspace/.oan/constitution/rules.md': '# Rules\nKeep continuity.\n',
    '/workspace/characters/hero/meta.yaml': 'id: hero\n',
    '/workspace/characters/hero/bio.md': '# Hero\nA traveler.\n',
    '/workspace/state/current.yaml': 'scene: gate\n',
    '/workspace/timeline/main.yaml': 'events: []\n',
    '/workspace/foreshadow/main.yaml': 'items: []\n',
    '/workspace/summaries/global.md': '# Summary\nThe journey.\n',
    '/workspace/world/places/gate.md': '# Gate\nA stone gate.\n',
  };
  const paths: string[] = [];
  const reader: WorkspaceReader = {
    async readFile(path) {
      paths.push(path);
      if (!Object.hasOwn(files, path)) throw new Error(`Unexpected projected path: ${path}`);
      return files[path]!;
    },
    async readdir(path) {
      paths.push(path);
      const prefix = `${path}/`;
      const names = new Map<string, boolean>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const tail = file.slice(prefix.length);
        names.set(tail.split('/')[0]!, tail.includes('/'));
      }
      return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymbolicLink: false }));
    },
  };
  const tools = createReadTools({ workspaceRoot: '/workspace', reader });
  const execute = (name: string, args: unknown) => tools[name]!.execute!(args as never, {
    toolCallId: 'windows-projection', messages: [], context: undefined,
  });
  return { paths, execute };
}

describe('read tools on a Windows host with the fixed POSIX projection', () => {
  it('reads every domain using projected paths and returns portable relative paths', async () => {
    const { paths, execute } = fixture();
    expect(await execute('chapter.get', { id: '0001/0001' })).toMatchObject({ file: 'chapters/0001/0001.md' });
    expect(await execute('workflow.get', {})).toEqual({ file: '.oan/workflow.yaml', data: { name: 'novel' } });
    expect(await execute('character.list', {})).toMatchObject({ characters: [{ id: 'hero' }] });
    expect(await execute('character.get', { id: 'hero' })).toMatchObject({ files: { 'meta.yaml': { id: 'hero' } } });
    expect(await execute('state.get', { file: 'current.yaml' })).toMatchObject({ file: 'state/current.yaml' });
    expect(await execute('state.get', {})).toMatchObject({ files: [{ file: 'current.yaml' }] });
    expect(await execute('timeline.list', {})).toMatchObject({ files: [{ file: 'main.yaml' }] });
    expect(await execute('foreshadow.list', {})).toMatchObject({ files: [{ file: 'main.yaml' }] });
    expect(await execute('summary.get', {})).toMatchObject({ file: 'summaries/global.md' });
    expect(await execute('constitution.get', {})).toMatchObject({ files: [{ file: '.oan/constitution/rules.md' }] });
    expect(await execute('constitution.get', { file: 'rules.md' })).toMatchObject({ file: '.oan/constitution/rules.md' });
    expect(await execute('world.search', { topic: 'places', query: 'stone' })).toMatchObject({ matches: [{ file: 'world/places/gate.md' }] });
    expect(paths.length).toBeGreaterThan(10);
    expect(paths.every((path) => path.startsWith('/workspace/') && !path.includes('\\'))).toBe(true);
  });

  it.each(['..\\secret.yaml', 'C:/secret.yaml', '/secret.yaml', '../secret.yaml', 'current.yaml:secret'])('rejects non-protocol path %s before any read', async (file) => {
    const { paths, execute } = fixture();
    await expect(execute('state.get', { file })).rejects.toThrow('Invalid workspace relative path');
    expect(paths).toEqual([]);
  });
});
