import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  attachPlayCharacterRoster, buildPlayFrozenSystemPrompt, createPlaySessionDraft, formatForgePlanPrompt, formatPlayTurnTail,
  createEmptyForgeBrief, normalizeRosterCharacter, normalizeRosterPortraitSet, parseForgePlan, parseRosterProfile,
  serializeRosterProfile, writePlaySessionFiles, ROSTER_PORTRAIT_LIMITS,
} from '@oh-awesome-novel/core';
import type { ForgePlan, PlaySession, RosterCharacter } from '@oh-awesome-novel/core';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6kAAAAASUVORK5CYII=', 'base64');
// A few MiB behind a valid PNG signature: large enough to notice if it were ever copied into a session.
const BIG_PNG = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]);
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const base: RosterCharacter = { id: 'nian', name: '念念', aliases: ['小念'], genderKind: 'girl', isPlayer: false, looks: { fixedBooruTags: '', outfitDescription: '', outfitTags: '' } };
const threePortraits = {
  default: 'casual',
  items: [
    { id: 'uniform', label: '制服', description: '深蓝制服，领口别着校徽。', usage: '校内', image: 'assets/portraits/nian/uniform.png' },
    { id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/casual.png' },
    { id: 'night', label: '夜行', description: '黑色斗篷遮住半张脸。', prompt: { positive: 'black cloak, night', negative: 'lowres' } },
  ],
};

async function workspace(character: RosterCharacter, files: Record<string, Buffer> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-portraits-')); roots.push(root);
  await mkdir(join(root, 'characters', character.id), { recursive: true });
  await writeFile(join(root, `characters/${character.id}/roster-profile.yaml`), serializeRosterProfile(character));
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), bytes);
  }
  return root;
}
async function launch(root: string): Promise<PlaySession> {
  const session = createPlaySessionDraft({ id: 'stage', title: 'stage', sceneStart: '客栈', characters: ['小念'] });
  await attachPlayCharacterRoster(root, session);
  return session;
}
async function storedText(root: string): Promise<string> {
  const chunks: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path); else chunks.push(await readFile(path, 'latin1'));
    }
  };
  await walk(join(root, '.workspace'));
  return chunks.join('\n');
}

describe('roster portrait schema', () => {
  it('accepts portraits with or without an image, and does not require the image file to exist', () => {
    const character = normalizeRosterCharacter({ ...base, looks: { ...base.looks, nameColor: '#E9C983' }, portraits: threePortraits });
    expect(character.portraits).toEqual(threePortraits);
    expect(parseRosterProfile(serializeRosterProfile(character))).toEqual(character);
    // A profile without the new fields reads and writes exactly as before.
    expect(serializeRosterProfile(base)).not.toMatch(/portraits|nameColor/);
  });

  it('rejects unsafe image paths, duplicate ids, a default that names nothing, and malformed fields', () => {
    const withItem = (item: Record<string, unknown>) => ({ default: 'a', items: [{ id: 'a', label: '常服', description: '描述', ...item }] });
    for (const image of [
      'characters/nian/normal.png', 'world/places/inn.png', 'assets/../.oan/secret.png', '/assets/a.png', 'assets/.hidden/a.png',
      'assets/portraits/nian/a.svg', 'assets/portraits/nian/a.gif', 'assets\\a.png', 'https://example.invalid/a.png', '',
    ]) {
      expect(() => normalizeRosterPortraitSet(withItem({ image })), image).toThrow(/inside assets/);
    }
    expect(() => normalizeRosterPortraitSet({ default: 'a', items: [{ id: 'a', label: '一', description: '一' }, { id: 'a', label: '二', description: '二' }] })).toThrow(/Duplicate portrait id/);
    expect(() => normalizeRosterPortraitSet({ default: 'missing', items: [{ id: 'a', label: '一', description: '一' }] })).toThrow(/default/);
    expect(() => normalizeRosterPortraitSet({ default: 'a', items: [] })).toThrow();
    expect(() => normalizeRosterPortraitSet(withItem({ id: '常服' }))).toThrow(/Portrait id/);
    expect(() => normalizeRosterPortraitSet(withItem({ id: 'x'.repeat(33) }))).toThrow(/Portrait id/);
    expect(() => normalizeRosterPortraitSet(withItem({ label: '字'.repeat(17) }))).toThrow(/label/);
    expect(() => normalizeRosterPortraitSet(withItem({ description: '' }))).toThrow(/description/);
    expect(() => normalizeRosterPortraitSet(withItem({ description: '字'.repeat(ROSTER_PORTRAIT_LIMITS.maxDescription + 1) }))).toThrow(/description/);
    expect(() => normalizeRosterPortraitSet(withItem({ dataUrl: 'data:image/png;base64,AAAA' }))).toThrow(/Unknown portrait field/);
    expect(() => normalizeRosterPortraitSet(withItem({ prompt: { negative: 'lowres' } }))).toThrow(/prompt/);
    expect(() => normalizeRosterPortraitSet(withItem({ generation: { apiKey: 'secret' } }))).toThrow(/generation/);
    expect(normalizeRosterPortraitSet(withItem({ generation: { provider: 'local', seed: 42, generatedAt: '2026-11-12T00:00:00.000Z' } })).items[0]!.generation).toMatchObject({ seed: 42 });
    for (const nameColor of ['red', '#FFF', '#GGGGGG', 'E9C983', 12]) {
      expect(() => normalizeRosterCharacter({ ...base, looks: { ...base.looks, nameColor } }), String(nameColor)).toThrow(/nameColor/);
    }
    expect(() => normalizeRosterCharacter({ ...base, portraits: { default: 'a', items: [{ id: 'a', label: '一', description: '一', image: '../a.png' }] } })).toThrow();
  });
});

describe('portraits recorded by a Play session', () => {
  it('records descriptions, paths and hashes with the default first, and never stores image bytes', async () => {
    const root = await workspace({ ...base, portraits: threePortraits }, { 'assets/portraits/nian/casual.png': BIG_PNG });
    const session = await launch(root);
    expect(session.metadataExtensions.characterPortraitSets).toEqual({
      nian: {
        default: 'casual',
        items: [
          { id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/casual.png', sha256: sha(BIG_PNG) },
          // The file is not on this machine: the path is kept, without a hash.
          { id: 'uniform', label: '制服', description: '深蓝制服，领口别着校徽。', usage: '校内', image: 'assets/portraits/nian/uniform.png' },
          { id: 'night', label: '夜行', description: '黑色斗篷遮住半张脸。' },
        ],
        skipped: [],
      },
    });
    expect(session.metadataExtensions.characterPortraits).toEqual({});
    await writePlaySessionFiles(root, session, { expectedAbsent: true });
    const stored = await storedText(root);
    expect(stored).toContain(sha(BIG_PNG));
    expect(stored).not.toContain('data:image');
    expect(stored).not.toContain(PNG.toString('base64').slice(0, 40));
    expect(stored.length).toBeLessThan(200_000);
  });

  it('keeps at most eight portraits per character and names the ones it left out', async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({ id: `p${index + 1}`, label: `第${index + 1}套`, description: `描述 ${index + 1}` }));
    const root = await workspace({ ...base, portraits: { default: 'p10', items } });
    const session = await launch(root);
    const set = (session.metadataExtensions.characterPortraitSets as Record<string, { default: string; items: Array<{ id: string }>; skipped: string[] }>).nian!;
    expect(set.items.map(item => item.id)).toEqual(['p10', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    expect(set.skipped).toEqual(['p8', 'p9', 'p11']);
    expect(set.default).toBe('p10');
  });

  it('leaves the frozen prefix and the first turn request untouched by portraits and name colours', async () => {
    const plain = await launch(await workspace(base));
    const dressed = await launch(await workspace(
      { ...base, looks: { ...base.looks, nameColor: '#E9C983' }, portraits: threePortraits },
      { 'assets/portraits/nian/casual.png': PNG },
    ));
    expect(buildPlayFrozenSystemPrompt(dressed)).toBe(buildPlayFrozenSystemPrompt(plain));
    expect(formatPlayTurnTail(dressed, '', '我推门进去。')).toBe(formatPlayTurnTail(plain, '', '我推门进去。'));
    // The plain session is stored exactly as it was before portraits existed.
    expect(Object.keys(plain.metadataExtensions)).not.toContain('characterPortraitSets');
    expect(plain.metadataExtensions.characterRoster).toEqual([base]);
  });

  it('still freezes the single legacy image the old way when a profile has no portrait set', async () => {
    const legacy = { ...base, looks: { ...base.looks, refImagePath: 'characters/nian/normal.png' } };
    const root = await workspace(legacy, { 'characters/nian/normal.png': PNG });
    const session = await launch(root);
    expect(session.metadataExtensions.characterPortraits).toEqual({ nian: `data:image/png;base64,${PNG.toString('base64')}` });
    expect(session.metadataExtensions.characterPortraitSets).toBeUndefined();
    expect(session.metadataExtensions.characterRoster).toEqual([legacy]);
  });
});

describe('Forge portrait drafts', () => {
  const plan = (): ForgePlan => ({ title: '渡口', characters: [{ id: 'lin', name: '林', aliases: [], palette: { base: '害怕失约', mainTones: [{ name: '克制', behaviors: ['遇到催促先核对时刻', '遇到危机先找出口'] }], accents: [{ name: '护短', behaviors: ['同伴落后会停步', '同伴受伤会包扎'] }] }, facets: (['normal', 'pressure', 'private'] as const).map(kind => ({ kind, trigger: '船靠岸', state: '警觉', dialogue: ['走吧。', '看脚下。', '我等你。', '船来了。', '票在这里。'], habitualAction: '捏住船票' })), clarifications: [{ trait: '克制', meaning: '先观察', when: '陌生环境', not: '冷漠' }], desire: { goal: '过河', obstacle: '船将离岸', cost: '舍弃行李' }, choice: { dilemma: '同伴或行李', decision: '拉住同伴', sacrifice: '丢下行李', consequence: '两人上船' }, resources: [] }], world: { kind: 'fictional', premise: '夜渡', rules: ['末班船不回头'], factions: ['船行'], history: ['桥断了'] }, places: [{ id: 'pier', name: '渡口', appearance: '旧栈桥', atmosphere: '冷雨', characters: ['lin'], events: ['末班船靠岸'] }], opening: '空船上的钟自己响了。\n林攥紧船票。\n“上船，还是留在这里？”' });

  it('keeps well-formed portrait descriptions, drops the rest, and never carries an image', () => {
    const drafted = plan() as unknown as { characters: Array<Record<string, unknown>> };
    drafted.characters[0]!.portraits = [
      { id: 'casual', label: '常服', description: '灰布短褂，裤脚沾泥。', usage: '日常', image: 'assets/portraits/lin/a.png' },
      { id: 'casual', label: '重复', description: '重复的编号' },
      { id: '渡口', label: '坏编号', description: '编号不是 ASCII' },
      { id: 'long', label: '字'.repeat(17), description: '名称过长' },
      { id: 'rain', label: '雨具', description: '斗笠蓑衣。' },
      { id: 'a3', label: '三', description: '三' }, { id: 'a4', label: '四', description: '四' }, { id: 'a5', label: '五', description: '五' },
    ];
    expect(parseForgePlan(drafted).characters[0]!.portraits).toEqual([
      { id: 'casual', label: '常服', description: '灰布短褂，裤脚沾泥。', usage: '日常' },
      { id: 'rain', label: '雨具', description: '斗笠蓑衣。' },
      { id: 'a3', label: '三', description: '三' },
      { id: 'a4', label: '四', description: '四' },
    ]);
    // A plan without portraits is parsed to the same object as before.
    expect(parseForgePlan(plan())).toEqual(plan());
    expect('portraits' in parseForgePlan({ ...plan(), characters: [{ ...plan().characters[0]!, portraits: 'none' }] }).characters[0]!).toBe(false);
    expect(formatForgePlanPrompt(createEmptyForgeBrief())).toContain('portraits 可选');
  });
});
