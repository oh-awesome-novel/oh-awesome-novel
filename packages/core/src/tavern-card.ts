import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export type TavernCardSpec = 'v1' | 'v2' | 'v3' | 'unknown';

export type TavernImportMode = 'preview' | 'create' | 'merge' | 'playOnly';

export interface TavernDepthPrompt {
  prompt?: string;
  depth?: number;
  role?: string;
}

export interface NormalizedTavernCard {
  spec: TavernCardSpec;
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  messageExamples?: string;
  alternateGreetings: string[];
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  tags: string[];
  creator?: string;
  characterVersion?: string;
  talkativeness?: number;
  depthPrompt?: TavernDepthPrompt;
  characterBook?: unknown;
  rawExtensions: Record<string, unknown>;
  sourceHash: string;
}

export interface TavernImportSafetyAudit {
  containsPromptOverrides: boolean;
  containsPromptInjectionRisk: boolean;
  containsExternalUrls: boolean;
  containsHtml: boolean;
  containsScriptLikeContent: boolean;
  lorebookEntryCount: number;
  lorebookTooLarge: boolean;
  missingCreator: boolean;
  warnings: string[];
}

export interface OanTavernImportPreview {
  mode: TavernImportMode;
  characterId: string;
  displayName: string;
  requiresPendingAction: boolean;
  files: string[];
  canonicalFields: string[];
  interactionFields: string[];
  lorebookEntryCount: number;
  safety: TavernImportSafetyAudit;
}

export interface CreateOanTavernImportPreviewOptions {
  mode: TavernImportMode;
  characterId?: string;
}

export const parseTavernCardInput = (
  input: string | Uint8Array,
): NormalizedTavernCard => {
  if (typeof input === 'string') {
    return normalizeTavernCard(JSON.parse(input) as unknown, input);
  }

  return normalizeTavernCard(extractTavernCardJsonFromPng(input), Buffer.from(input).toString('base64'));
};

export const normalizeTavernCard = (
  raw: unknown,
  sourceText = JSON.stringify(raw),
): NormalizedTavernCard => {
  if (!isRecord(raw)) {
    throw new Error('Tavern-compatible card must be a JSON object.');
  }

  const data = isRecord(raw.data) ? raw.data : raw;
  const extensions = isRecord(data.extensions)
    ? data.extensions
    : isRecord(raw.extensions)
      ? raw.extensions
      : {};
  const depthPrompt = isRecord(extensions.depth_prompt)
    ? extensions.depth_prompt
    : undefined;
  const name = getString(data, 'name') ?? getString(raw, 'name');

  if (!name) {
    throw new Error('Tavern-compatible card is missing a character name.');
  }

  return {
    spec: detectTavernSpec(raw),
    name,
    description: getString(data, 'description') ?? getString(raw, 'description'),
    personality: getString(data, 'personality') ?? getString(raw, 'personality'),
    scenario: getString(data, 'scenario') ?? getString(raw, 'scenario'),
    firstMessage: getString(data, 'first_mes') ?? getString(raw, 'first_mes'),
    messageExamples: getString(data, 'mes_example') ?? getString(raw, 'mes_example'),
    alternateGreetings: getStringArray(data, 'alternate_greetings'),
    creatorNotes: getString(data, 'creator_notes') ?? getString(raw, 'creator_notes'),
    systemPrompt: getString(data, 'system_prompt') ?? getString(raw, 'system_prompt'),
    postHistoryInstructions:
      getString(data, 'post_history_instructions') ??
      getString(raw, 'post_history_instructions'),
    tags: getStringArray(data, 'tags'),
    creator: getString(data, 'creator') ?? getString(raw, 'creator'),
    characterVersion:
      getString(data, 'character_version') ?? getString(raw, 'character_version'),
    talkativeness: getNumber(extensions, 'talkativeness'),
    depthPrompt: depthPrompt
      ? {
          prompt: getString(depthPrompt, 'prompt'),
          depth: getNumber(depthPrompt, 'depth'),
          role: getString(depthPrompt, 'role'),
        }
      : undefined,
    characterBook: data.character_book ?? raw.character_book,
    rawExtensions: { ...extensions },
    sourceHash: createHash('sha256').update(sourceText).digest('hex'),
  };
};

export const auditTavernCardSafety = (
  card: NormalizedTavernCard,
): TavernImportSafetyAudit => {
  const textFields = [
    card.description,
    card.personality,
    card.scenario,
    card.firstMessage,
    card.messageExamples,
    card.creatorNotes,
    card.systemPrompt,
    card.postHistoryInstructions,
  ].filter((value): value is string => Boolean(value));
  const allText = textFields.join('\n');
  const lorebookEntryCount = countLorebookEntries(card.characterBook);
  const containsPromptOverrides = Boolean(
    card.systemPrompt || card.postHistoryInstructions || card.depthPrompt?.prompt,
  );
  const audit: TavernImportSafetyAudit = {
    containsPromptOverrides,
    containsPromptInjectionRisk: /ignore (all )?(previous|prior) instructions|jailbreak|developer message|system prompt|bypass/i.test(allText),
    containsExternalUrls: /https?:\/\//i.test(allText),
    containsHtml: /<[^>]+>/.test(allText),
    containsScriptLikeContent: /<script|onerror\s*=|onclick\s*=|javascript:/i.test(allText),
    lorebookEntryCount,
    lorebookTooLarge: lorebookEntryCount > 100 || JSON.stringify(card.characterBook ?? '').length > 50_000,
    missingCreator: !card.creator,
    warnings: [],
  };

  audit.warnings = buildSafetyWarnings(audit);

  return audit;
};

export const createOanTavernImportPreview = (
  card: NormalizedTavernCard,
  options: CreateOanTavernImportPreviewOptions,
): OanTavernImportPreview => {
  const characterId = options.characterId ?? slugifyCharacterId(card.name);
  const safety = auditTavernCardSafety(card);
  const base = `characters/${characterId}`;

  return {
    mode: options.mode,
    characterId,
    displayName: card.name,
    requiresPendingAction: options.mode !== 'preview' && options.mode !== 'playOnly',
    files: [
      `${base}/meta.yaml`,
      `${base}/summary.md`,
      `${base}/personality.md`,
      `${base}/interaction.md`,
      `${base}/lorebook.yaml`,
      `${base}/assets.yaml`,
      `${base}/imports/tavern-card.yaml`,
    ],
    canonicalFields: [
      ...(card.name ? ['meta.displayName'] : []),
      ...(card.description ? ['summary'] : []),
      ...(card.personality ? ['personality'] : []),
    ],
    interactionFields: [
      ...(card.scenario ? ['scenario'] : []),
      ...(card.firstMessage ? ['firstMessage'] : []),
      ...(card.messageExamples ? ['messageExamples'] : []),
      ...(card.alternateGreetings.length ? ['alternateGreetings'] : []),
      ...(card.systemPrompt ? ['systemPrompt:untrusted'] : []),
      ...(card.postHistoryInstructions ? ['postHistoryInstructions:untrusted'] : []),
    ],
    lorebookEntryCount: safety.lorebookEntryCount,
    safety,
  };
};

export const extractTavernCardJsonFromPng = (input: Uint8Array): unknown => {
  const buffer = Buffer.from(input);

  if (!isPng(buffer)) {
    throw new Error('PNG Tavern card input must start with a PNG signature.');
  }

  const metadata = readPngTextChunks(buffer);
  const raw = metadata.ccv3 ?? metadata.chara;

  if (!raw) {
    throw new Error('PNG does not contain chara or ccv3 metadata.');
  }

  const jsonText = metadata.ccv3 ? raw : Buffer.from(raw, 'base64').toString('utf-8');

  return JSON.parse(jsonText) as unknown;
};

function detectTavernSpec(raw: Record<string, unknown>): TavernCardSpec {
  const spec = getString(raw, 'spec')?.toLowerCase();

  if (spec?.includes('v3')) {
    return 'v3';
  }

  if (spec?.includes('v2')) {
    return 'v2';
  }

  if (isRecord(raw.data)) {
    return 'v2';
  }

  return 'v1';
}

function readPngTextChunks(buffer: Buffer): Record<string, string> {
  const chunks: Record<string, string> = {};
  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buffer.length) {
      throw new Error('Invalid PNG chunk length.');
    }

    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'tEXt') {
      const separator = data.indexOf(0);

      if (separator > 0) {
        chunks[data.subarray(0, separator).toString('latin1')] =
          data.subarray(separator + 1).toString('latin1');
      }
    }

    if (type === 'iTXt') {
      const parsed = parseITxtChunk(data);

      if (parsed) {
        chunks[parsed.keyword] = parsed.text;
      }
    }

    offset = dataEnd + 4;
  }

  return chunks;
}

function parseITxtChunk(data: Buffer): { keyword: string; text: string } | undefined {
  const keywordEnd = data.indexOf(0);

  if (keywordEnd <= 0 || keywordEnd + 5 >= data.length) {
    return undefined;
  }

  const keyword = data.subarray(0, keywordEnd).toString('utf-8');
  let offset = keywordEnd + 3;

  for (let index = 0; index < 2; index += 1) {
    const next = data.indexOf(0, offset);

    if (next < 0) {
      return undefined;
    }

    offset = next + 1;
  }

  return {
    keyword,
    text: data.subarray(offset).toString('utf-8'),
  };
}

function countLorebookEntries(characterBook: unknown): number {
  if (!isRecord(characterBook)) {
    return 0;
  }

  if (Array.isArray(characterBook.entries)) {
    return characterBook.entries.length;
  }

  return 0;
}

function buildSafetyWarnings(audit: TavernImportSafetyAudit): string[] {
  return [
    audit.containsPromptOverrides ? 'Imported prompt overrides are untrusted.' : '',
    audit.containsPromptInjectionRisk ? 'Possible prompt injection or jailbreak text detected.' : '',
    audit.containsExternalUrls ? 'External URLs are present.' : '',
    audit.containsHtml ? 'HTML-like content is present.' : '',
    audit.containsScriptLikeContent ? 'Script-like content is present.' : '',
    audit.lorebookTooLarge ? 'Lorebook is large and should be previewed before import.' : '',
    audit.missingCreator ? 'Creator metadata is missing.' : '',
  ].filter(Boolean);
}

function isPng(buffer: Buffer): boolean {
  return buffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === 'string' && value.trim() ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];

  return typeof value === 'number' ? value : undefined;
}

function getStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function slugifyCharacterId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '') || 'imported-character';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
