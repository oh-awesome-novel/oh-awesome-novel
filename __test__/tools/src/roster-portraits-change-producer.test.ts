import { describe, expect, it } from 'vite-plus/test';
import {
  ROSTER_PORTRAITS_PRODUCER, applyRosterPortraitsEdit, createRosterPortraitsChangeProposal, rosterProfilePath, stripRosterStageFields,
} from '@oh-awesome-novel/tools';
import type { RosterPortraitsEdit } from '@oh-awesome-novel/tools';

const PROFILE = [
  '# 作者手写的注释：别名以后再补',
  'id: nian',
  'name: 念念',
  'aliases: [小念]',
  'genderKind: girl',
  'isPlayer: false',
  'looks:',
  '  fixedBooruTags: 1girl # 生图预留',
  '  outfitDescription: ""',
  '  outfitTags: ""',
  '  refImagePath: characters/nian/normal.png',
  '',
].join('\n');
const REPOSITORY = { repositoryId: 'repo-1', branch: 'main', head: 'abc123' };
const three: RosterPortraitsEdit = {
  nameColor: '#E9C983',
  portraits: {
    default: 'casual',
    items: [
      { id: 'uniform', label: '制服', description: '深蓝制服，领口别着校徽。', usage: '校内', image: 'assets/portraits/nian/uniform.png' },
      { id: 'casual', label: '常服', description: '米色开衫，袖口挽起。', image: 'assets/portraits/nian/missing-on-this-machine.png' },
      { id: 'night', label: '夜行', description: '黑色斗篷遮住半张脸。', prompt: { positive: 'black cloak', negative: 'lowres' } },
    ],
  },
};
const propose = (edit: RosterPortraitsEdit, content = PROFILE, characterId = 'nian') => createRosterPortraitsChangeProposal({
  characterId, edit, repository: REPOSITORY, sessionId: 'pa_test',
  baselineFiles: [{ path: rosterProfilePath(characterId), content, mode: 0o644 }],
});

describe('roster portrait change producer', () => {
  it('changes only the portraits and name colour of one roster profile and keeps the rest of the file', () => {
    const proposal = propose(three)!;
    expect(proposal.targetPath).toBe('characters/nian/roster-profile.yaml');
    expect(proposal.candidate.source).toMatchObject({ kind: 'deterministic-builder', producer: ROSTER_PORTRAITS_PRODUCER, capability: 'character.edit' });
    expect(proposal.candidate.changes.map(change => [change.operation, change.path])).toEqual([['update', 'characters/nian/roster-profile.yaml']]);
    const after = applyRosterPortraitsEdit(PROFILE, 'nian', three);
    // Everything the author wrote is still there, comments included.
    for (const line of PROFILE.trimEnd().split('\n')) expect(after).toContain(line);
    expect(after).toContain('  nameColor: "#E9C983"');
    expect(after).toContain('portraits:\n  default: casual\n  items:\n    - id: uniform\n      label: 制服');
    expect(after).toContain('image: assets/portraits/nian/missing-on-this-machine.png');
    // Text only: a candidate never carries image content.
    expect(after).not.toMatch(/data:image|base64/);
    expect(JSON.stringify(proposal.candidate)).not.toMatch(/data:image/);
    // The same form state produces the same bytes, and saving it again is not a change.
    expect(applyRosterPortraitsEdit(PROFILE, 'nian', structuredClone(three))).toBe(after);
    expect(propose(three, after)).toBeUndefined();
  });

  it('removes the section and the colour again without touching anything else', () => {
    const dressed = applyRosterPortraitsEdit(PROFILE, 'nian', three);
    expect(applyRosterPortraitsEdit(dressed, 'nian', { portraits: null, nameColor: null })).toBe(PROFILE);
    expect(stripRosterStageFields(dressed)).toBe(PROFILE);
    // A profile without the stage fields is handed to model context byte for byte.
    expect(stripRosterStageFields(PROFILE)).toBe(PROFILE);
  });

  it('rejects unsafe portraits before any candidate exists', () => {
    const item = { id: 'a', label: '常服', description: '描述' };
    const bad: Array<[string, RosterPortraitsEdit]> = [
      ['outside the asset folder', { nameColor: null, portraits: { default: 'a', items: [{ ...item, image: 'characters/nian/normal.png' }] } }],
      ['traversal', { nameColor: null, portraits: { default: 'a', items: [{ ...item, image: 'assets/../.oan/config.png' }] } }],
      ['duplicate id', { nameColor: null, portraits: { default: 'a', items: [item, { ...item }] } }],
      ['default names nothing', { nameColor: null, portraits: { default: 'b', items: [item] } }],
      ['name colour', { nameColor: 'gold', portraits: null }],
    ];
    for (const [name, edit] of bad) expect(() => propose(edit), name).toThrow();
    expect(() => propose(three, PROFILE, 'other')).toThrow(/identity/);
    expect(() => propose(three, 'id: [')).toThrow();
    expect(() => rosterProfilePath('../nian')).toThrow();
  });
});
