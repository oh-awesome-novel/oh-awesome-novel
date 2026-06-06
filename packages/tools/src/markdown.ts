import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export interface MarkdownDocument {
  filePath: string;
  raw: string;
  frontmatter?: Record<string, unknown>;
  body: string;
}

export interface MarkdownSection {
  title: string;
  level: number;
  heading: string;
  content: string;
  startOffset: number;
  contentStartOffset: number;
  endOffset: number;
}

export interface MarkdownDraft {
  filePath: string;
  original: string;
  draft: string;
}

export async function loadMarkdown(filePath: string): Promise<MarkdownDocument> {
  const raw = await readFile(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);

  return {
    filePath,
    raw,
    frontmatter,
    body,
  };
}

export function parseFrontmatter(markdown: string): {
  frontmatter?: Record<string, unknown>;
  body: string;
} {
  if (!markdown.startsWith('---\n')) {
    return { body: markdown };
  }

  const end = markdown.indexOf('\n---', 4);
  if (end === -1) {
    return { body: markdown };
  }

  const yamlText = markdown.slice(4, end);
  const bodyStart = markdown[end + 4] === '\n' ? end + 5 : end + 4;
  const parsed = parseYaml(yamlText) as unknown;

  return {
    frontmatter: isRecord(parsed) ? parsed : undefined,
    body: markdown.slice(bodyStart),
  };
}

export function parseSections(markdown: string): MarkdownSection[] {
  const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  const headings = [...markdown.matchAll(headingPattern)];

  return headings.map((match, index) => {
    const heading = match[0];
    const startOffset = match.index ?? 0;
    const contentStartOffset = startOffset + heading.length;
    const nextStartOffset = headings[index + 1]?.index ?? markdown.length;
    const content =
      markdown.slice(contentStartOffset, nextStartOffset).replace(/^\n/, '');

    return {
      title: match[2].trim(),
      level: match[1].length,
      heading,
      content,
      startOffset,
      contentStartOffset,
      endOffset: nextStartOffset,
    };
  });
}

export async function replaceSection(
  filePath: string,
  sectionTitle: string,
  content: string,
): Promise<MarkdownDraft> {
  const original = await readFile(filePath, 'utf-8');
  const section = findSection(original, sectionTitle);
  const nextContent = normalizeSectionContent(content);
  const draft =
    original.slice(0, section.contentStartOffset) +
    `\n${nextContent}` +
    original.slice(section.endOffset);

  return { filePath, original, draft };
}

export async function appendSection(
  filePath: string,
  sectionTitle: string,
  content: string,
): Promise<MarkdownDraft> {
  const original = await readFile(filePath, 'utf-8');
  const section = parseSections(original).find(
    (candidate) => candidate.title === sectionTitle,
  );
  const nextContent = normalizeSectionContent(content);

  if (!section) {
    const separator = original.endsWith('\n') ? '\n' : '\n\n';
    return {
      filePath,
      original,
      draft: `${original}${separator}# ${sectionTitle}\n\n${nextContent}`,
    };
  }

  const existing = original.slice(section.contentStartOffset, section.endOffset);
  const separator = existing.endsWith('\n\n') || existing.trim().length === 0
    ? ''
    : '\n';
  const draft =
    original.slice(0, section.endOffset) +
    `${separator}${nextContent}` +
    original.slice(section.endOffset);

  return { filePath, original, draft };
}

function findSection(markdown: string, sectionTitle: string): MarkdownSection {
  const section = parseSections(markdown).find(
    (candidate) => candidate.title === sectionTitle,
  );

  if (!section) {
    throw new Error(`Markdown section "${sectionTitle}" does not exist.`);
  }

  return section;
}

function normalizeSectionContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length === 0 ? '\n' : `${trimmed}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
