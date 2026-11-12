import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PlayLaunchPackagePreviewInput } from '@oh-awesome-novel/core';

export const workA = { id: 'work-a', title: '甲作' };
export const workB = { id: 'work-b', title: '乙作' };
export async function crossoverFixture(root: string, purpose: PlayLaunchPackagePreviewInput['purpose'] = 'immersiveJourney'): Promise<PlayLaunchPackagePreviewInput> {
  const sources: PlayLaunchPackagePreviewInput['sources'] = [];
  for (const work of [workA, workB]) {
    const letter = work.id === 'work-a' ? 'A' : 'B';
    for (const n of [1, 2]) {
      const id = `${letter.toLowerCase()}${n}`;
      const path = `characters/${id}/profile.md`;
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), `# ${id}\n${letter}_ONLY_CHARACTER_${n}。只在${work.title}中生活。\n`);
      sources.push({ sourceId: id, path, role: 'character', originWork: work });
    }
    const path = `world/${letter.toLowerCase()}.md`;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), `${letter}_ONLY_WORLD_RULE：这是${work.title}的世界规则。`);
    sources.push({ sourceId: `world-${letter.toLowerCase()}`, path, role: 'world', originWork: work });
  }
  await mkdir(join(root, 'chapters'), { recursive: true }); await writeFile(join(root, 'chapters/opening.md'), '共同的路口。');
  sources.push({ sourceId: 'opening', path: 'chapters/opening.md', role: 'chapter' });
  return {
    title: '两作相遇', purpose, startMode: 'guided', simulationMode: 'reactiveWorld', density: 'balanced', sources,
    entryPoint: { id: 'entry', label: '路口', opening: '四人在路口相遇。', sourceRefs: ['opening'] },
    identity: purpose === 'sceneRehearsal' ? { kind: 'director', directorPurpose: '观察四人见面' } : { kind: 'player', persona: '路过的人' },
    participantRoles: ['a1', 'a2', 'b1', 'b2'].map(id => ({ participantRef: id, displayName: id, canonicalCharacterRef: id, sourceRefs: [id], currentGoal: '了解眼前局势', initialKnowledge: [] })),
    crossover: { works: [workA, workB], fusion: 'merged', knowledge: 'isolated', rulePrecedence: [] },
  };
}
