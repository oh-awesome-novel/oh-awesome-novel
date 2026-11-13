import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { forgeCanonicalFiles, loadCanonicalWritingContext, startNovelHttpBackend } from '@oh-awesome-novel/backend';
import { forgeChunkKeys, parseRosterProfile } from '@oh-awesome-novel/core';
import type { ForgePlan, PlaySession } from '@oh-awesome-novel/core';

const git = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6kAAAAASUVORK5CYII=', 'base64');
const BIG_PNG = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]);
const OTHER_PNG = Buffer.concat([PNG, Buffer.from([1, 2, 3])]);
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const PROFILE = '# 作者的注释\nid: nian\nname: 念念\naliases: [小念]\ngenderKind: girl\nisPlayer: false\nlooks:\n  fixedBooruTags: ""\n  outfitDescription: ""\n  outfitTags: ""\n';
const settlement = (narrative: string) => `${narrative}\n\`\`\`oan-play-settlement\n${JSON.stringify({ events: [], stateDelta: {}, observations: [], suggestedActions: [] })}\n\`\`\``;
const portraits = {
  default: 'casual',
  items: [
    { id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/casual.png' },
    { id: 'uniform', label: '制服', description: '深蓝制服，领口别着校徽。', usage: '校内', image: 'assets/portraits/nian/not-here.png' },
    { id: 'night', label: '夜行', description: '黑色斗篷遮住半张脸。', prompt: { positive: 'black cloak, night' } },
  ],
};

async function setup(profile: string | null = PROFILE) {
  const root = await mkdtemp(join(tmpdir(), 'oan-character-portraits-'));
  await mkdir(join(root, '.oan'));
  await mkdir(join(root, 'characters/nian'), { recursive: true });
  await writeFile(join(root, '.oan/config.yaml'), 'version: 1\nnovelName: Test\ngit:\n  autoCommitOnAccept: false\n');
  await writeFile(join(root, 'characters/nian/profile.md'), '# 念念\n\n念念说话很轻。\n');
  if (profile !== null) await writeFile(join(root, 'characters/nian/roster-profile.yaml'), profile);
  await writeFile(join(root, '.gitignore'), '.workspace/\n/assets/\n');
  await git('git', ['init', '-b', 'main', root]);
  await git('git', ['-C', root, 'config', 'user.name', 'Test']);
  await git('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  await git('git', ['-C', root, 'add', '.']);
  await git('git', ['-C', root, 'commit', '-m', 'baseline']);
  const turnRequests: string[] = [];
  const backend = await startNovelHttpBackend({
    workspaceRoot: root,
    providerConfig: { id: 'stage', kind: 'custom', model: 'stage-model', baseUrl: 'https://provider.example/v1', models: [{ id: 'stage-model', contextWindow: 100_000 }] },
    streamPlayTurn: async function* (input: unknown) {
      turnRequests.push(JSON.stringify(input, (key, value) => (key === 'abortSignal' || key === 'signal' ? undefined : value)));
      yield settlement('念念抬起头：“你来了。”');
    },
  });
  cleanups.push(async () => { await backend.close(); await rm(root, { recursive: true, force: true }); });
  const url = (path: string) => `${backend.url}${path}`;
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const form = async () => (await (await fetch(url('/api/workspace/characters/nian/portraits'))).json()) as { profile: { sourceHash: string; portraits: unknown; nameColor: string | null; legacyRefImagePath: string | null; missingImages: Array<{ id: string }> } | null };
  const propose = (body: Record<string, unknown>) => fetch(url('/api/workspace/characters/nian/portraits/propose'), json({ expectedWorkspaceRoot: root, ...body }));
  const upload = (name: string, bytes: Buffer) => fetch(url(`/api/workspace/image-assets/portraits/nian?name=${name}`), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
  const launch = async (id: string) => {
    const created = await fetch(url('/api/workspace/play-sessions'), json({ id, title: id, sceneStart: '雨夜客栈', characters: ['nian'] }));
    expect(created.status, await created.clone().text()).toBe(200);
    return (await (await fetch(url(`/api/workspace/play-sessions/${id}`))).json() as { session: PlaySession }).session;
  };
  const turn = async (id: string, session: PlaySession) => {
    const response = await fetch(url(`/api/workspace/play-sessions/${id}/turns/stream`), json({ userText: '推门进去', actionKind: 'do', baseRevision: session.revision }));
    expect(await response.text()).toContain('play.turn.committed');
  };
  const rosterFile = () => readFile(join(root, 'characters/nian/roster-profile.yaml'), 'utf8');
  return { root, url, json, form, propose, upload, launch, turn, rosterFile, turnRequests };
}

describe('character portrait form over HTTP', () => {
  it('edits three portraits through approval, then a new session records them without image bytes', async () => {
    const f = await setup();
    expect((await f.upload('casual.png', BIG_PNG)).status).toBe(201);
    const before = await f.form();
    expect(before.profile).toMatchObject({ sourceHash: sha(PROFILE), portraits: null, nameColor: null, legacyRefImagePath: null, missingImages: [] });

    const response = await f.propose({ sourceHash: before.profile!.sourceHash, portraits, nameColor: '#E9C983' });
    expect(response.status, await response.clone().text()).toBe(200);
    const proposed = await response.json() as { pendingActionId: string; targetPath: string; missingImages: Array<{ id: string; image: string; reason: string }> };
    expect(proposed.targetPath).toBe('characters/nian/roster-profile.yaml');
    // A path whose file is not here is saved all the same, with a reminder.
    expect(proposed.missingImages).toEqual([{ id: 'uniform', image: 'assets/portraits/nian/not-here.png', reason: expect.any(String) }]);
    // Nothing canonical changed yet.
    expect(await f.rosterFile()).toBe(PROFILE);

    const view = await (await fetch(f.url(`/api/workspace/pending-actions/${proposed.pendingActionId}`))).json() as { pendingAction: { status: string; changes: Array<{ path: string; operation: string }> } };
    expect(view.pendingAction.status).toBe('pending');
    expect(view.pendingAction.changes.map(change => [change.operation, change.path])).toEqual([['update', 'characters/nian/roster-profile.yaml']]);
    const serialized = JSON.stringify(view);
    expect(serialized).toContain('米色开衫');
    expect(serialized).not.toMatch(/data:image|iVBORw0KGgo/);

    const accepted = await fetch(f.url(`/api/workspace/pending-actions/${proposed.pendingActionId}/accept`), f.json({}));
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const written = await f.rosterFile();
    expect(written.startsWith(PROFILE.replace('  outfitTags: ""\n', ''))).toBe(true);
    expect(written).toContain('# 作者的注释');
    const roster = parseRosterProfile(written);
    expect(roster.portraits).toEqual(portraits);
    expect(roster.looks.nameColor).toBe('#E9C983');
    // Only the YAML changed; the image folder is still invisible to Git.
    expect((await git('git', ['-C', f.root, 'status', '--porcelain', '--untracked-files=all'])).stdout.trim()).toBe('M characters/nian/roster-profile.yaml');

    const after = await f.form();
    expect(after.profile).toMatchObject({ portraits, nameColor: '#E9C983', missingImages: [{ id: 'uniform' }] });
    expect(after.profile!.sourceHash).toBe(sha(written));

    const session = await f.launch('dressed');
    expect(session.metadataExtensions.characterPortraitSets).toEqual({
      nian: {
        default: 'casual',
        items: [
          { id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/casual.png', sha256: sha(BIG_PNG) },
          { id: 'uniform', label: '制服', description: '深蓝制服，领口别着校徽。', usage: '校内', image: 'assets/portraits/nian/not-here.png' },
          { id: 'night', label: '夜行', description: '黑色斗篷遮住半张脸。' },
        ],
        skipped: [],
      },
    });
    expect(JSON.stringify(session).length).toBeLessThan(200_000);
    // The stage reads the original bytes through the asset endpoint.
    const image = await fetch(f.url(`/api/workspace/image-assets/file?path=${encodeURIComponent('assets/portraits/nian/casual.png')}`));
    expect(Buffer.from(await image.arrayBuffer()).equals(BIG_PNG)).toBe(true);

    // Replaced after launch: the new bytes are served and no longer match the recorded hash. Deleted: a reason.
    await writeFile(join(f.root, 'assets/portraits/nian/casual.png'), OTHER_PNG);
    const replaced = await fetch(f.url(`/api/workspace/image-assets/file?path=${encodeURIComponent('assets/portraits/nian/casual.png')}`));
    expect(sha(Buffer.from(await replaced.arrayBuffer()))).toBe(sha(OTHER_PNG));
    await unlink(join(f.root, 'assets/portraits/nian/casual.png'));
    const gone = await fetch(f.url(`/api/workspace/image-assets/file?path=${encodeURIComponent('assets/portraits/nian/casual.png')}`));
    expect(gone.status).toBe(404);
    // The session keeps what it recorded when it started.
    const reread = (await (await fetch(f.url('/api/workspace/play-sessions/dressed'))).json() as { session: PlaySession }).session;
    expect(reread.metadataExtensions.characterPortraitSets).toEqual(session.metadataExtensions.characterPortraitSets);
  });

  it('sends the same first turn request whether or not the roster has portraits', async () => {
    const plain = await setup();
    const dressed = await setup();
    const hash = (await dressed.form()).profile!.sourceHash;
    const { pendingActionId } = await (await dressed.propose({ sourceHash: hash, portraits, nameColor: '#E9C983' })).json() as { pendingActionId: string };
    expect((await fetch(dressed.url(`/api/workspace/pending-actions/${pendingActionId}/accept`), dressed.json({}))).status).toBe(200);

    const a = await plain.launch('first');
    const b = await dressed.launch('first');
    expect(b.metadataExtensions.frozenSystemPrompt).toBe(a.metadataExtensions.frozenSystemPrompt);
    expect(typeof a.metadataExtensions.frozenSystemPrompt).toBe('string');
    await plain.turn('first', a);
    await dressed.turn('first', b);
    expect(plain.turnRequests).toHaveLength(1);
    // What the model is sent: the frozen prefix and this turn's request text. The session object
    // beside them is host data and is where the recorded portraits live.
    const sent = (captured: string) => {
      const input = JSON.parse(captured) as { request: string; session: PlaySession };
      return { request: input.request, prefix: input.session.metadataExtensions.frozenSystemPrompt };
    };
    expect(sent(dressed.turnRequests[0]!)).toEqual(sent(plain.turnRequests[0]!));
    expect(JSON.stringify(sent(dressed.turnRequests[0]!))).not.toMatch(/米色开衫|portraits|E9C983|assets\//);
  });

  it('refuses unsafe, stale and empty edits without creating anything to approve', async () => {
    const f = await setup();
    const hash = (await f.form()).profile!.sourceHash;
    const item = { id: 'a', label: '常服', description: '描述' };
    const reject = async (body: Record<string, unknown>, status: number, code: string) => {
      const response = await f.propose({ sourceHash: hash, nameColor: null, portraits: null, ...body });
      expect(response.status, await response.clone().text()).toBe(status);
      expect((await response.json() as { error: { code: string; message: string } }).error.code).toBe(code);
    };
    await reject({ portraits: { default: 'a', items: [{ ...item, image: 'characters/nian/normal.png' }] } }, 400, 'invalid_portrait_request');
    await reject({ portraits: { default: 'a', items: [{ ...item, image: 'assets/../.oan/config.png' }] } }, 400, 'invalid_portrait_request');
    await reject({ portraits: { default: 'a', items: [item, item] } }, 400, 'invalid_portrait_request');
    await reject({ portraits: { default: 'b', items: [item] } }, 400, 'invalid_portrait_request');
    await reject({ nameColor: 'gold' }, 400, 'invalid_portrait_request');
    await reject({ extra: true }, 400, 'invalid_portrait_request');
    await reject({}, 400, 'no_portrait_change');
    await reject({ sourceHash: sha('older content'), portraits: { default: 'a', items: [item] } }, 409, 'stale_roster_profile');
    await reject({ expectedWorkspaceRoot: '/elsewhere', portraits: { default: 'a', items: [item] } }, 409, 'workspace_changed');
    expect(await f.rosterFile()).toBe(PROFILE);
    expect(await (await fetch(f.url('/api/workspace/pending-actions'))).json()).toEqual({ pendingActions: [] });

    const bare = await setup(null);
    expect((await bare.form()).profile).toBeNull();
    const missing = await bare.propose({ sourceHash: hash, nameColor: null, portraits: { default: 'a', items: [item] } });
    expect(missing.status).toBe(404);
    expect((await missing.json() as { error: { code: string } }).error.code).toBe('roster_profile_missing');
  });

  it('points an old single-image profile at the migration and leaves it working', async () => {
    const legacy = PROFILE.replace('looks:\n', 'looks:\n  refImagePath: characters/nian/normal.png\n');
    const f = await setup(legacy);
    await writeFile(join(f.root, 'characters/nian/normal.png'), PNG);
    expect((await f.form()).profile).toMatchObject({ portraits: null, legacyRefImagePath: 'characters/nian/normal.png' });
    const session = await f.launch('legacy');
    expect(session.metadataExtensions.characterPortraits).toEqual({ nian: `data:image/png;base64,${PNG.toString('base64')}` });
    expect(session.metadataExtensions.characterPortraitSets).toBeUndefined();
  });
});

describe('portraits outside the stage', () => {
  it('keeps portraits and name colours out of the writing context', async () => {
    const f = await setup();
    const plainItems = (await loadCanonicalWritingContext(f.root, ['characters/nian/roster-profile.yaml'])).items;
    expect(plainItems[0]!.content).toBe(PROFILE);
    const hash = (await f.form()).profile!.sourceHash;
    const { pendingActionId } = await (await f.propose({ sourceHash: hash, portraits, nameColor: '#E9C983' })).json() as { pendingActionId: string };
    await fetch(f.url(`/api/workspace/pending-actions/${pendingActionId}/accept`), f.json({}));
    expect(await f.rosterFile()).toContain('portraits:');
    const dressedItems = (await loadCanonicalWritingContext(f.root, ['characters/nian/roster-profile.yaml'])).items;
    expect(dressedItems[0]!.content).toBe(PROFILE);
  });

  it('writes Forge portrait drafts into the roster profile as descriptions only', () => {
    const plan: ForgePlan = { title: '渡口', characters: [{ id: 'lin', name: '林', aliases: [], genderKind: 'girl', portraits: [{ id: 'casual', label: '常服', description: '灰布短褂，裤脚沾泥。', usage: '日常' }, { id: 'rain', label: '雨具', description: '斗笠蓑衣。' }], palette: { base: '害怕失约', mainTones: [{ name: '克制', behaviors: ['遇到催促先核对时刻', '遇到危机先找出口'] }], accents: [{ name: '护短', behaviors: ['同伴落后会停步', '同伴受伤会包扎'] }] }, facets: (['normal', 'pressure', 'private'] as const).map(kind => ({ kind, trigger: '船靠岸', state: '警觉', dialogue: ['走吧。', '看脚下。', '我等你。', '船来了。', '票在这里。'], habitualAction: '捏住船票' })), clarifications: [], desire: { goal: '过河', obstacle: '船将离岸', cost: '舍弃行李' }, choice: { dilemma: '同伴或行李', decision: '拉住同伴', sacrifice: '丢下行李', consequence: '两人上船' }, resources: [] }], world: { kind: 'fictional', premise: '夜渡', rules: ['末班船不回头'], factions: ['船行'], history: ['桥断了'] }, places: [{ id: 'pier', name: '渡口', appearance: '旧栈桥', atmosphere: '冷雨', characters: ['lin'], events: ['末班船靠岸'] }], opening: '空船上的钟自己响了。' };
    const chunks = Object.fromEntries(forgeChunkKeys(plan).map(key => [key, `${key} 正文`]));
    const roster = forgeCanonicalFiles(plan, chunks).find(file => file.path === 'characters/lin/roster-profile.yaml')!.content;
    expect(parseRosterProfile(roster).portraits).toEqual({ default: 'casual', items: plan.characters[0]!.portraits });
    expect(roster).not.toMatch(/image:|assets\//);
    const without = { ...plan, characters: [{ ...plan.characters[0]!, portraits: undefined }] };
    expect(forgeCanonicalFiles(without, chunks).find(file => file.path === 'characters/lin/roster-profile.yaml')!.content).not.toContain('portraits');
  });
});
