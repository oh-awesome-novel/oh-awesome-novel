import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  MAX_REFERENCE_MATERIAL_ADOPTION_TARGET_SUGGESTIONS,
  listReferenceMaterialAdoptionTargetSuggestions,
} from '@oh-awesome-novel/core';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oan-adoption-targets-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content, 'utf8');
  }
  return root;
}

describe('Reference Material adoption target suggestions', () => {
  it('suggests only existing files each material kind may legally target', async () => {
    const root = await workspace({
      'world/magic/rules.md': '# rules\n',
      'world/magic/notes.txt': 'not markdown\n',
      'world/top-level.md': 'too shallow to be a world target\n',
      'world/.hidden/secret.md': 'hidden\n',
      'characters/lin/personality.md': '# Lin\n',
      'characters/lin/meta.yaml': 'name: Lin\n',
      'characters/bad id/summary.md': 'the id is not a safe character id\n',
      'outline/main.md': '# outline\n',
      'timeline/events.yaml': 'events: []\n',
      'timeline/notes.md': 'not yaml\n',
      'chapters/0001.md': 'not an adoption domain\n',
    });
    await symlink(join(root, 'chapters/0001.md'), join(root, 'world/magic/link.md'));

    await expect(listReferenceMaterialAdoptionTargetSuggestions(root)).resolves.toEqual({
      world: ['world/magic/rules.md'],
      characters: ['characters/lin/personality.md'],
      // An existing character may receive relationships before the file exists.
      relationships: ['characters/lin/relationships.yaml'],
      outline: ['outline/main.md'],
      timeline: ['timeline/events.yaml'],
      truncated: false,
    });
  });

  it('returns empty lists for a workspace without those folders and bounds a large one', async () => {
    await expect(listReferenceMaterialAdoptionTargetSuggestions(await workspace({ 'README.md': 'x' })))
      .resolves.toEqual({
        world: [], characters: [], relationships: [], outline: [], timeline: [], truncated: false,
      });

    const many = Object.fromEntries(Array.from(
      { length: MAX_REFERENCE_MATERIAL_ADOPTION_TARGET_SUGGESTIONS + 5 },
      (_, index) => [`world/topic/entry-${String(index).padStart(4, '0')}.md`, 'x'],
    ));
    const suggestions = await listReferenceMaterialAdoptionTargetSuggestions(await workspace(many));
    expect(suggestions.world).toHaveLength(MAX_REFERENCE_MATERIAL_ADOPTION_TARGET_SUGGESTIONS);
    expect(suggestions.truncated).toBe(true);
  });
});
