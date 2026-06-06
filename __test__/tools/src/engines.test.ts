import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendSection,
  loadMarkdown,
  loadYaml,
  parseSections,
  replaceSection,
  validateYamlDocument,
  yamlAppendDraft,
  yamlDeleteDraft,
  yamlGet,
  yamlSetDraft,
} from '@oh-awesome-novel/tools';

describe('Markdown engine', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oan-tools-md-'));
    filePath = join(tempDir, 'personality.md');
    await writeFile(
      filePath,
      `---
id: heroine
---

# 外在人格

冷淡克制。

# 内在人格

温柔但隐藏。
`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads frontmatter and parses heading sections', async () => {
    const document = await loadMarkdown(filePath);
    const sections = parseSections(document.raw);

    expect(document.frontmatter).toEqual({ id: 'heroine' });
    expect(sections.map((section) => section.title)).toEqual([
      '外在人格',
      '内在人格',
    ]);
  });

  it('returns a replacement draft without writing the file', async () => {
    const draft = await replaceSection(filePath, '外在人格', '更加疏离。');

    expect(draft.draft).toContain('更加疏离。');
    expect(draft.draft).not.toContain('冷淡克制。');
    await expect(readFile(filePath, 'utf-8')).resolves.toContain('冷淡克制。');
  });

  it('returns an append draft without writing the file', async () => {
    const draft = await appendSection(filePath, '内在人格', '仍会保护同伴。');

    expect(draft.draft).toContain('温柔但隐藏。');
    expect(draft.draft).toContain('仍会保护同伴。');
    await expect(readFile(filePath, 'utf-8')).resolves.not.toContain(
      '仍会保护同伴。',
    );
  });
});

describe('YAML engine', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'oan-tools-yaml-'));
    filePath = join(tempDir, 'characters.yaml');
    await writeFile(
      filePath,
      `characters:
  heroine:
    hp: injured
    flags:
      - black_mark_visible
`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads YAML with the yaml package and reads paths', async () => {
    const document = await loadYaml(filePath);

    expect(validateYamlDocument(document.data)).toEqual({ ok: true, errors: [] });
    await expect(yamlGet(filePath, 'characters.heroine.hp')).resolves.toBe(
      'injured',
    );
  });

  it('creates set, append, and delete drafts without writing the file', async () => {
    const setDraft = await yamlSetDraft(
      filePath,
      'characters.heroine.hp',
      'normal',
    );
    const appendDraft = await yamlAppendDraft(
      filePath,
      'characters.heroine.flags',
      'academy',
    );
    const deleteDraft = await yamlDeleteDraft(
      filePath,
      'characters.heroine.hp',
    );

    expect(setDraft.draft).toContain('hp: normal');
    expect(appendDraft.draft).toContain('- academy');
    expect(deleteDraft.draft).not.toContain('hp: injured');
    await expect(readFile(filePath, 'utf-8')).resolves.toContain('hp: injured');
  });
});
