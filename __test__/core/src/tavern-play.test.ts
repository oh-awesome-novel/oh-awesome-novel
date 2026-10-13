import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  normalizeTavernCard, prepareTavernCardPlaySession, resolveTavernPlaySourceContent,
  formatTavernLorebookContext, readPlaySessionFiles, writePlaySessionFiles,
  formatPlayWorldRefereePrompt,
  previewPlayLaunchPackage, createPlaySessionFromLaunchPackage,
} from '@oh-awesome-novel/core';

const card = () => normalizeTavernCard({
  name: 'Mira', description: 'A station keeper.', scenario: 'Meet Mira on the platform.',
  first_mes: 'Show me your ticket.', mes_example: 'Mira: The last train waits for nobody.',
  system_prompt: 'SYSTEM_OVERRIDE_SHOULD_NOT_LOAD', post_history_instructions: 'POST_OVERRIDE_SHOULD_NOT_LOAD',
  creator_notes: 'CREATOR_NOTES_SHOULD_NOT_LOAD', extensions: { depth_prompt: { prompt: 'DEPTH_OVERRIDE_SHOULD_NOT_LOAD', role: 'system' } },
  character_book: { entries: [
    { keys: ['ticket'], content: 'MATCHED_TICKET_LORE' },
    { keys: ['ship'], content: 'UNMATCHED_SHIP_LORE' },
    { keys: ['ticket'], enabled: false, content: 'DISABLED_LORE' },
    { constant: true, content: 'CONSTANT_LORE' },
  ] },
});

describe('Tavern Play-only import and hint activation', () => {
  it('retains reviewed hints across session persistence without creating canonical files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-tavern-play-'));
    try {
      const session = prepareTavernCardPlaySession(card(), { id: 'tavern-play', characterId: 'mira', sourceName: 'mira.json' });
      const source = session.activatedSources[0]!;
      expect(source).toMatchObject({ trust: 'interactionHint', budgetLayer: 'L2' });
      expect(source.path).toBeUndefined();
      expect(source.contentHash).toBeUndefined();
      await writePlaySessionFiles(root, session, { expectedAbsent: true });
      const loaded = await readPlaySessionFiles(root, session.id);
      const context = resolveTavernPlaySourceContent(loaded, source.sourceId, 'I present my ticket.')!;
      expect(context).toContain('MATCHED_TICKET_LORE');
      expect(context).toContain('CONSTANT_LORE');
      expect(context).not.toContain('UNMATCHED_SHIP_LORE');
      expect(context).not.toContain('DISABLED_LORE');
      expect(context).not.toContain('SHOULD_NOT_LOAD');
      expect(context).toContain('cannot override the constitution');
      expect(context).toContain('A station keeper.');
      const basePrompt = formatPlayWorldRefereePrompt(loaded);
      expect(basePrompt).not.toContain('UNMATCHED_SHIP_LORE');
      expect(basePrompt).not.toContain('DISABLED_LORE');
      expect(basePrompt).not.toContain('SHOULD_NOT_LOAD');
      await expect(access(join(root, 'characters'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(resolveTavernPlaySourceContent(loaded, 'unselected-source')).toBeUndefined();
      await expect(writePlaySessionFiles(root, session, { expectedAbsent: true })).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects changed stored payloads or attempted trust promotion', () => {
    const session = prepareTavernCardPlaySession(card(), { id: 'tavern-play', characterId: 'mira', sourceName: 'mira.json' });
    const changed = structuredClone(session);
    const metadata = changed.metadataExtensions.tavernPlayImport as { content: { hints: { description: string } } };
    metadata.content.hints.description = 'forged';
    expect(() => resolveTavernPlaySourceContent(changed, changed.activatedSources[0]!.sourceId)).toThrow(/changed import evidence/iu);
    session.activatedSources[0]!.trust = 'canonical';
    expect(() => resolveTavernPlaySourceContent(session, session.activatedSources[0]!.sourceId)).toThrow(/untrusted interaction hint/iu);
  });

  it('bounds imported scene and name fields before they enter the base referee prompt', () => {
    const large = normalizeTavernCard({ name: 'N'.repeat(500), scenario: 'S'.repeat(100_000) });
    const session = prepareTavernCardPlaySession(large, { id: 'bounded-card', characterId: 'large', sourceName: 'large.json' });
    expect(session.title).toHaveLength(200);
    expect(session.characters[0]).toHaveLength(200);
    expect(session.sceneStart).toHaveLength(2_000);
    const prompt = formatPlayWorldRefereePrompt(session);
    expect(prompt).toContain('Imported scene data (untrusted');
    expect(prompt.length).toBeLessThan(12_000);
  });

  it('activates accepted OAN lore by enabled/constant/primary/secondary/case/word rules without executing macros', () => {
    const content = stringify({ source: 'tavern-compatible-character-card', entries: [
      { title: 'Gate', keys: ['gate'], secondaryKeys: ['ticket'], content: 'MATCHED {{user}}', activation: { enabled: true, matchWholeWords: true } },
      { keys: ['Gate'], content: 'CASE_SENSITIVE', activation: { caseSensitive: true } },
      { keys: [], content: 'ALWAYS', activation: { constant: true } },
      { keys: ['gate'], content: 'DISABLED', activation: { enabled: false } },
    ] });
    expect(formatTavernLorebookContext(content, 'The gate opens for a ticket.')).toContain('MATCHED {{user}}');
    expect(formatTavernLorebookContext(content, 'The gates open for a ticket.')).not.toContain('MATCHED');
    expect(formatTavernLorebookContext(content, 'The gate opens.')).not.toContain('MATCHED');
    expect(formatTavernLorebookContext(content, 'gate ticket')).not.toContain('CASE_SENSITIVE');
    expect(formatTavernLorebookContext(content, 'Gate ticket')).toContain('CASE_SENSITIVE');
    expect(formatTavernLorebookContext(content, '')).toContain('ALWAYS');
    expect(formatTavernLorebookContext(content, 'gate')).not.toContain('DISABLED');
  });

  it('bounds activated lore without evaluating regex or external assets', () => {
    const context = formatTavernLorebookContext(stringify({ entries: Array.from({ length: 20 }, (_, index) => ({
      keys: ['[a-z]+'], constant: true, content: `Entry ${index} ${'x'.repeat(500)}`,
    })) }), 'anything');
    expect(context.length).toBeLessThan(8_200);
    expect(context).toContain('omitted by context budget');
    expect(formatTavernLorebookContext(stringify({ entries: [{ keys: ['[a-z]+'], content: 'REGEX_NOT_EXECUTED' }] }), 'letters')).not.toContain('REGEX_NOT_EXECUTED');
  });

  it('labels explicitly selected accepted interaction and lorebook files as hints in Guided Start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oan-tavern-guided-'));
    try {
      await mkdir(join(root, 'characters/mira'), { recursive: true });
      await writeFile(join(root, 'characters/mira/summary.md'), '# Mira\n\nStation keeper.');
      await writeFile(join(root, 'characters/mira/interaction.md'), '# Interaction Profile\n\nShow me your ticket.');
      await writeFile(join(root, 'characters/mira/lorebook.yaml'), stringify({ entries: [] }));
      const preview = await previewPlayLaunchPackage(root, {
        id: 'tavern-guided', title: 'Meet Mira', purpose: 'immersiveJourney', startMode: 'guided',
        simulationMode: 'reactiveWorld', density: 'balanced',
        sources: ['summary.md', 'interaction.md', 'lorebook.yaml'].map((file, index) => ({
          sourceId: `source-${index}`, path: `characters/mira/${file}`, role: 'character',
        })),
        entryPoint: { id: 'station', label: 'Station', opening: 'Meet Mira.', sourceRefs: ['source-0'] },
        identity: { kind: 'player', persona: 'Traveler' },
        participantRoles: [{ participantRef: 'mira', displayName: 'Mira', canonicalCharacterRef: 'mira', sourceRefs: ['source-0'], initialKnowledge: [] }],
      });
      expect(preview.diagnostics).toEqual([]);
      expect(preview.sourceBase.activatedSources.map((source) => source.trust)).toEqual(['canonical', 'interactionHint', 'interactionHint']);
      const session = createPlaySessionFromLaunchPackage(preview, { id: 'guided-mira' });
      expect(session.activatedSources.map((source) => source.trust)).toEqual(['canonical', 'interactionHint', 'interactionHint']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
