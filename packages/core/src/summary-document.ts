import { parseDocument } from 'yaml';

/** Canonical aggregate summary format. Source freshness is evaluated separately. */
export interface SummaryParagraph { readonly text: string; readonly sourcePaths: readonly string[] }
export interface SummarySourceReference { readonly path: string; readonly sourceHash: string; readonly payloadHash: string }
export interface SummaryGenerationDraft {
  readonly schemaVersion: 1;
  readonly sourceFingerprint: string;
  readonly paragraphs: readonly SummaryParagraph[];
}
export interface SummaryDocument extends SummaryGenerationDraft {
  readonly targetPath: string;
  readonly chapterIds: readonly string[];
  readonly sources: readonly SummarySourceReference[];
}
export const SUMMARY_LIMITS = Object.freeze({ chapters: 4096, sources: 1024, paragraphs: 32, paragraphChars: 2048, inputBytes: 256 * 1024, documentBytes: 1024 * 1024 });
const HASH = /^[a-f0-9]{64}$/u;
const CHAPTER_ID = /^(?!0000)\d{4}\/(?!0000)\d{4}$/u;
const START = '<!-- oan:summary:v1\n';
const END = '<!-- /oan:summary:v1 -->';
// Only actual reserved comments own a block; prose may discuss marker names.
const MANAGED_COMMENT = /<!--\s*\/?oan:summary:/u;

export const SUMMARY_GENERATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'sourceFingerprint', 'paragraphs'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    sourceFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    paragraphs: { type: 'array', minItems: 1, maxItems: SUMMARY_LIMITS.paragraphs, items: {
      type: 'object', additionalProperties: false, required: ['text', 'sourcePaths'], properties: {
        text: { type: 'string', minLength: 1, maxLength: SUMMARY_LIMITS.paragraphChars },
        sourcePaths: { type: 'array', minItems: 1, maxItems: SUMMARY_LIMITS.sources, uniqueItems: true, items: { type: 'string' } },
      },
    } },
  },
} as const;

export function assertSummaryTargetPath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || !(path === 'summaries/global.md' || /^summaries\/volume\/(?!0000)\d{4}\.md$/u.test(path))) throw new Error('Summary target must be summaries/volume/<four-digit-volume>.md or summaries/global.md.');
}

export { resolveSummarySelection } from './novel-copilot-contract.js';

export function parseSummaryGenerationDraft(value: unknown, sourceFingerprint: string, sourcePaths: readonly string[]): SummaryGenerationDraft {
  exact(value, ['schemaVersion', 'sourceFingerprint', 'paragraphs']);
  if (value.schemaVersion !== 1 || value.sourceFingerprint !== sourceFingerprint || !HASH.test(sourceFingerprint)) throw new Error('Summary input fingerprint does not match the fixed source evidence.');
  const paragraphs = parseParagraphs(value.paragraphs, sourcePaths);
  return Object.freeze({ schemaVersion: 1, sourceFingerprint, paragraphs });
}

/** Undefined means author-owned prose; any malformed managed marker throws. */
export function parseSummaryDocument(content: string, targetPath: string): { document: SummaryDocument; block: string; start: number; end: number; authorContent: string } | undefined {
  assertSummaryTargetPath(targetPath);
  if (Buffer.byteLength(content) > SUMMARY_LIMITS.documentBytes) throw new Error('Managed summary exceeds its document limit.');
  assertFrontmatterIdentity(content, targetPath);
  if (!MANAGED_COMMENT.test(content)) return undefined;
  const starts = [...content.matchAll(/<!-- oan:summary:v1\r?\n/gu)];
  const start = starts[0]?.index ?? -1; const ending = content.indexOf(END);
  if (starts.length !== 1 || ending < start || content.indexOf(END, ending + END.length) >= 0) throw new Error('Missing, duplicate or unsupported summary evidence block.');
  const end = ending + END.length;
  const authorContent = content.slice(0, start) + content.slice(end);
  if (MANAGED_COMMENT.test(authorContent)) throw new Error('Unsupported summary evidence marker.');
  // Normalize only for parsing/comparison. Offsets and author bytes stay original.
  const block = content.slice(start, end);
  const normalizedBlock = block.replaceAll('\r\n', '\n');
  const metadataEnd = normalizedBlock.indexOf('\n-->\n', START.length);
  if (metadataEnd < 0 || metadataEnd >= normalizedBlock.length - END.length) throw new Error('Malformed summary evidence metadata.');
  const value: unknown = JSON.parse(normalizedBlock.slice(START.length, metadataEnd));
  exact(value, ['schemaVersion', 'targetPath', 'chapterIds', 'sources', 'sourceFingerprint', 'paragraphs']);
  if (value.targetPath !== targetPath) throw new Error('Summary evidence identity differs from its path.');
  const chapterIds = orderedStrings(value.chapterIds, SUMMARY_LIMITS.chapters, (id) => CHAPTER_ID.test(id));
  const volume = /^summaries\/volume\/(\d{4})\.md$/u.exec(targetPath)?.[1];
  if (volume && chapterIds.some((id) => !id.startsWith(`${volume}/`))) throw new Error('Summary chapter coverage escapes its volume.');
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > SUMMARY_LIMITS.sources) throw new Error('Invalid summary source count.');
  const expectedPaths = volume ? chapterIds.map((id) => `summaries/chapter/${id}.md`)
    : [...new Set(chapterIds.map((id) => `summaries/volume/${id.slice(0, 4)}.md`))];
  const sources = value.sources.map((source: unknown, index: number) => {
    exact(source, ['path', 'sourceHash', 'payloadHash']);
    if (source.path !== expectedPaths[index] || typeof source.sourceHash !== 'string' || !HASH.test(source.sourceHash)
      || typeof source.payloadHash !== 'string' || !HASH.test(source.payloadHash)) throw new Error('Summary source references do not match ordered coverage.');
    return Object.freeze({ path: expectedPaths[index]!, sourceHash: source.sourceHash, payloadHash: source.payloadHash });
  });
  if (sources.length !== expectedPaths.length) throw new Error('Summary source coverage is incomplete.');
  const draft = parseSummaryGenerationDraft(valueWithoutMetadata(value), String(value.sourceFingerprint), expectedPaths);
  const document: SummaryDocument = Object.freeze({ schemaVersion: 1, targetPath, chapterIds, sources: Object.freeze(sources), sourceFingerprint: draft.sourceFingerprint, paragraphs: draft.paragraphs });
  if (normalizedBlock !== renderSummaryBlock(document).replaceAll('\r\n', '\n')) throw new Error('Managed summary content or metadata was edited.');
  return { document, block, start, end, authorContent };
}

export function renderSummaryParagraphs(paragraphs: readonly SummaryParagraph[], options: { includeSourceReferences?: boolean } = {}): string {
  return paragraphs.map((item) => `${escapeText(item.text)}${options.includeSourceReferences === false ? '' : `\n\n来源：${item.sourcePaths.map((path) => `\`${path}\``).join('、')}`}`).join('\n\n');
}

export function mergeSummaryDocument(existing: string | undefined, document: SummaryDocument): string {
  let block = renderSummaryBlock(document);
  // Validate even internally assembled metadata through the same canonical parser.
  parseSummaryDocument(block, document.targetPath);
  const previous = existing === undefined ? undefined : parseSummaryDocument(existing, document.targetPath);
  const newline = (previous?.block ?? existing)?.includes('\r\n') ? '\r\n' : '\n';
  if (newline === '\r\n') block = block.replace(/\r?\n/gu, newline);
  const body = (previous?.authorContent ?? existing ?? '').replace(/^\uFEFF/u, '').replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u, '');
  const heading = /^#[ \t]+\S.*$/mu.test(body) ? ''
    : `# ${document.targetPath === 'summaries/global.md' ? '全书摘要' : `第 ${document.targetPath.slice(-7, -3)} 卷摘要`}${newline}${newline}`;
  const result = existing === undefined
    ? `${heading}${block}${newline}`
    : previous ? `${existing.slice(0, previous.start)}${heading && previous.start > 0 && existing[previous.start - 1] !== '\n' ? newline + newline : ''}${heading}${block}${existing.slice(previous.end)}`
    : `${existing}${existing.endsWith('\n') ? newline : newline + newline}${heading}${block}${newline}`;
  if (Buffer.byteLength(result) > SUMMARY_LIMITS.documentBytes) throw new Error('Managed summary exceeds its document limit.');
  return result;
}

function renderSummaryBlock(document: SummaryDocument): string {
  const metadata = JSON.stringify(document).replace(/[<>&]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `${START}${metadata}\n-->\n${renderSummaryParagraphs(document.paragraphs)}\n${END}`;
}
function parseParagraphs(value: unknown, paths: readonly string[]): readonly SummaryParagraph[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > SUMMARY_LIMITS.paragraphs) throw new Error('Summary requires 1–32 source-backed paragraphs.');
  const allowed = new Set(paths); const covered = new Set<string>();
  const result = value.map((paragraph: unknown) => {
    exact(paragraph, ['text', 'sourcePaths']);
    if (typeof paragraph.text !== 'string' || !paragraph.text.trim() || paragraph.text.length > SUMMARY_LIMITS.paragraphChars
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(paragraph.text)) throw new Error('Invalid summary paragraph text.');
    if (!Array.isArray(paragraph.sourcePaths) || paragraph.sourcePaths.length === 0 || paragraph.sourcePaths.length > SUMMARY_LIMITS.sources
      || new Set(paragraph.sourcePaths).size !== paragraph.sourcePaths.length
      || paragraph.sourcePaths.some((path: unknown) => typeof path !== 'string' || !allowed.has(path))) throw new Error('Summary paragraph must reference verified direct inputs.');
    const sourcePaths = [...paragraph.sourcePaths as string[]].sort(); sourcePaths.forEach((path) => covered.add(path));
    return Object.freeze({ text: paragraph.text, sourcePaths: Object.freeze(sourcePaths) });
  });
  if (covered.size !== allowed.size) throw new Error('Summary paragraphs must account for every source in the reviewed coverage.');
  return Object.freeze(result);
}
function valueWithoutMetadata(value: Record<string, unknown>) { return { schemaVersion: value.schemaVersion, sourceFingerprint: value.sourceFingerprint, paragraphs: value.paragraphs }; }
function orderedStrings(value: unknown, max: number, valid: (item: string) => boolean): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max || value.some((item: unknown, index: number) => typeof item !== 'string' || !valid(item) || (index > 0 && value[index - 1] >= item))) throw new Error('Invalid ordered summary coverage.');
  return Object.freeze([...value] as string[]);
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error('Invalid summary schema or unknown fields.');
}
function escapeText(text: string): string { return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
function assertFrontmatterIdentity(content: string, targetPath: string): void {
  const text = content.replace(/^\uFEFF/u, '');
  if (!/^---\r?\n/u.test(text)) return;
  const raw = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/u.exec(text)?.[1];
  if (raw === undefined) throw new Error('Malformed summary frontmatter.');
  const parsed = parseDocument(raw, { uniqueKeys: true }); const value: unknown = parsed.toJS({ maxAliasCount: 100 });
  if (parsed.errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid summary frontmatter.');
  const volume = /^summaries\/volume\/(\d{4})\.md$/u.exec(targetPath)?.[1];
  const expected = volume ?? 'global';
  for (const key of volume ? ['id', 'volume', 'volumeId', 'volumeNumber'] : ['id', 'scope']) {
    const actual = (value as Record<string, unknown>)[key];
    if (actual !== undefined && ((typeof actual !== 'string' && typeof actual !== 'number') || String(actual).padStart(expected.length, '0') !== expected)) throw new Error('Summary frontmatter identity differs from its path.');
  }
}
