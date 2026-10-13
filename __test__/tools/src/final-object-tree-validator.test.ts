import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import {
  createCandidateChangeSet,
  createChangeMaterializer,
  createPendingActionStore,
  createSandboxEditSession,
  createWorkspaceChangePolicy,
  readRepositoryBaseline,
  fingerprintFileSnapshots,
  validateFinalDocument,
  validateFinalObjectTreeReferences,
} from '@oh-awesome-novel/tools';
import type { CandidateFileSnapshot, SandboxEditSession } from '@oh-awesome-novel/tools';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const character = { path: 'characters/mira/meta.yaml', content: 'id: mira\nname: Mira\n' };
const chapter = { path: 'chapters/0001/0001.md', content: '# Chapter\n' };
const world = { path: 'world/locations/library.md', content: '# Library\n' };
const state = { path: 'state/characters.yaml', content: 'characters:\n  mira:\n    locationRef: locations/library\n    chapterRef: 0001/0001\n' };
const timeline = { path: 'timeline/events.yaml', content: 'events:\n  - id: meeting\n    order: 1\n    title: Meeting\n    characterRef: mira\n    chapter: 0001/0001\n' };
const baseline = [character, chapter, world, state, timeline];

function update(path: string, content: string) { return { path, content, operation: 'update' as const }; }
function validate(changes: Parameters<typeof validateFinalObjectTreeReferences>[0]['changes'], files = baseline) {
  return validateFinalObjectTreeReferences({ baselineFiles: files, changes });
}

describe('final object tree references', () => {
  it('resolves typed identities from the complete tree and permits same-action creations', () => {
    expect(() => validate([
      { operation: 'create', path: 'characters/ren/meta.yaml', content: 'id: ren\nname: Ren\n' },
      update(state.path, 'characters:\n  ren:\n    eventRef: meeting\n    locationRef: locations/library\n'),
    ])).not.toThrow();
  });

  it('rejects unknown IDs and namespace mismatches even if another family has that ID', () => {
    expect(() => validate([update(state.path, 'characterRef: missing\n')])).toThrow(/unknown character reference/u);
    expect(() => validate([update(state.path, 'worldRef: mira\n')])).toThrow(/unknown world reference/u);
    expect(() => validate([update(state.path, 'characterRef: locations/library\n')])).toThrow(/unknown character reference/u);
    expect(() => validate([update(state.path, 'chapterRef: "0001"\n')])).toThrow(/unknown chapter reference/u);
    expect(() => validate([update(state.path, 'characterRefs: mira\n')])).toThrow(/must be an array/u);
  });

  it('checks untouched referencers when deleting character, world and chapter objects', () => {
    for (const file of [character, world, chapter]) {
      expect(() => validate([{ operation: 'delete', path: file.path }])).toThrow(/unknown .* reference/u);
    }
  });

  it('allows removing or updating referencers with the target in the same action', () => {
    expect(() => validate([
      { operation: 'delete', path: character.path },
      { operation: 'delete', path: state.path },
      update(timeline.path, 'events: []\n'),
    ])).not.toThrow();
  });

  it('fails closed for existing dangling references but permits a same-action repair', () => {
    const files = [...baseline, { path: 'state/broken.yaml', content: 'characterRef: missing\n' }];
    expect(() => validate([update(chapter.path, '# Revised\n')], files)).toThrow(/missing/u);
    expect(() => validate([update('state/broken.yaml', 'characterRef: mira\n')], files)).not.toThrow();
    expect(() => validate([update('summaries/global.md', '# Summary\n')], files)).not.toThrow();
  });

  it('rejects ambiguous world identities and duplicate collection IDs across documents', () => {
    expect(() => validate([{ operation: 'create', path: 'world/locations/library.yaml', content: 'id: library\n' }])).toThrow(/Duplicate world id/u);
    expect(() => validate([{ operation: 'create', path: 'timeline/other.yaml', content: timeline.content }])).toThrow(/Duplicate event id/u);
    expect(() => validate([
      { operation: 'create', path: 'foreshadow/active.yaml', content: 'active:\n  - id: mark\n    status: active\n    description: Mark\n' },
      { operation: 'create', path: 'foreshadow/resolved.yaml', content: 'resolved:\n  - id: mark\n    status: resolved\n    description: Mark\n' },
    ])).toThrow(/Duplicate foreshadow id/u);
  });

  it('checks documented Markdown metadata without interpreting prose and labels as IDs', () => {
    expect(() => validate([update(chapter.path, '---\ncharacters: [mira]\nlocations: [locations/library]\n---\n# Chapter\n')])).not.toThrow();
    expect(() => validate([update(chapter.path, '---\ncharacters: [missing]\n---\n# Chapter\n')])).toThrow(/unknown character reference/u);
    expect(() => validate([update(state.path, 'location: unknown place\ntoString: plain label\nnotes: characterRef means a reference\n')])).not.toThrow();
  });

  it('keeps YAML inspection bounded, including unchanged source documents', () => {
    const files = [...baseline, { path: 'state/cycle.yaml', content: 'cycle: &loop\n  next: *loop\n' }];
    expect(() => validate([update(chapter.path, '# Revised\n')], files)).toThrow(/too complex/u);
  });

  it('keeps the filesystem timeline and foreshadow examples executable', async () => {
    const specification = await readFile(new URL('../../../docs/FILESYSTEM_SPEC.md', import.meta.url), 'utf8');
    const examples = ['timeline/events.yaml', 'foreshadow/active.yaml', 'foreshadow/resolved.yaml'].map((path) => {
      const heading = specification.indexOf(`### \`${path}\``);
      const section = specification.slice(heading);
      const content = /```yaml\r?\n([\s\S]*?)```/u.exec(section)?.[1]?.replaceAll('\r\n', '\n');
      expect(content).toBeDefined();
      validateFinalDocument({ path, content: content! });
      return { path, content: content! };
    });
    expect(() => validateFinalObjectTreeReferences({
      baselineFiles: [
        { path: 'characters/heroine/meta.yaml', content: 'id: heroine\nname: Heroine\n' },
        ...['0001', '0003', '0010'].map((id) => ({ path: `chapters/0001/${id}.md`, content: '# Chapter\n' })),
      ],
      changes: examples.map((file) => ({ operation: 'create', ...file })),
    })).not.toThrow();
  });
});

describe('production proposal and Accept reference gates', () => {
  it('checks a restricted sandbox against a fixed host-only reference closure', async () => {
    const root = await workspace(baseline);
    const session = await createSandboxEditSession({
      workspaceRoot: root,
      policy: createWorkspaceChangePolicy({ capability: 'character.edit', readable: [], writablePrefixes: ['characters/mira'] }),
    });
    try {
      expect(session.projectionSnapshot().files.every((file) => file.path.startsWith('characters/mira/'))).toBe(true);
      await execute(session, 'bash', { command: 'rm characters/mira/meta.yaml' });
      await expect(session.preview()).rejects.toThrow(/unknown character reference/u);
      expect(await readFile(join(root, character.path), 'utf8')).toBe(character.content);
      await writeFile(join(root, state.path), 'characters: {}\n');
      await expect(session.preview()).rejects.toMatchObject({ code: 'WORKSPACE_PROJECTION_STALE' });
    } finally { await session.dispose(); }
  });

  it('rejects an invalid direct producer before persistence', async () => {
    const root = await workspace(baseline);
    const store = await createPendingActionStore({ workspaceRoot: root });
    const candidate = createCandidateChangeSet({
      sessionId: 'direct-invalid', repository: await readRepositoryBaseline(root),
      source: { kind: 'deterministic-builder', producer: 'test', capability: 'state.edit' },
      projectionFingerprint: fingerprintFileSnapshots([state]),
      baselineFiles: [state], finalFiles: [{ ...state, content: 'characterRef: missing\n' }],
    })!;
    await expect(store.proposeCandidate({ candidate, title: 'Invalid', description: 'Invalid references' })).rejects.toThrow(/unknown character reference/u);
    expect(await store.listViews()).toEqual([]);
  });

  it('creates a referenced object and its referencer together through the default sandbox and Accept', async () => {
    const root = await workspace([chapter]);
    const store = await createPendingActionStore({ workspaceRoot: root });
    const session = await createSandboxEditSession({
      workspaceRoot: root, policy: createWorkspaceChangePolicy({ capability: 'novel.multi-file-edit' }),
      pendingActionStore: store,
    });
    try {
      await execute(session, 'writeFile', { path: character.path, content: character.content });
      await execute(session, 'writeFile', { path: state.path, content: 'characters:\n  mira:\n    chapterRef: 0001/0001\n' });
      const candidate = await session.finalizeCandidate({ finalization: 'runtime-fallback' });
      const action = await store.proposeCandidate({ candidate: candidate!, title: 'Introduce Mira', description: 'Create a character and state' });
      await expect(createChangeMaterializer({ store }).accept({ actionId: action.id, autoCommitOnAccept: false })).resolves.toMatchObject({ action: { status: 'accepted' } });
      expect(await readFile(join(root, character.path), 'utf8')).toBe(character.content);
    } finally { await session.dispose(); }
  });

  it('revalidates unchanged referencers at Accept before any canonical write', async () => {
    const root = await workspace(baseline);
    const store = await createPendingActionStore({ workspaceRoot: root });
    const candidate = createCandidateChangeSet({
      sessionId: 'accept-recheck', repository: await readRepositoryBaseline(root),
      source: { kind: 'deterministic-builder', producer: 'test', capability: 'chapter.edit' },
      projectionFingerprint: fingerprintFileSnapshots([chapter]),
      baselineFiles: [chapter], finalFiles: [{ ...chapter, content: '# Revised\n' }],
    })!;
    const action = await store.proposeCandidate({ candidate, title: 'Revise', description: 'Revise chapter' });
    await writeFile(join(root, state.path), 'characterRef: missing\n');
    await expect(createChangeMaterializer({ store }).accept({ actionId: action.id, autoCommitOnAccept: false })).rejects.toThrow(/unknown character reference/u);
    expect(await readFile(join(root, chapter.path), 'utf8')).toBe(chapter.content);
    expect((await store.readRecord(action.id)).status).toBe('pending');
  });
});

async function workspace(files: readonly CandidateFileSnapshot[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-final-tree-'));
  roots.push(root);
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  for (const args of [['init'], ['config', 'user.name', 'Reference Tests'], ['config', 'user.email', 'references@example.test'], ['add', '.'], ['commit', '-m', 'Baseline']]) {
    await execFileAsync('git', args, { cwd: root });
  }
  return root;
}

async function execute(session: SandboxEditSession, name: string, input: unknown): Promise<unknown> {
  const tool = session.tools[name];
  if (!tool?.execute) throw new Error(`Tool unavailable: ${name}`);
  return tool.execute(input as never, { toolCallId: `test-${name}`, messages: [], context: undefined });
}
