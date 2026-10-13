import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

export const TAVERN_IMPORT_LIMITS = Object.freeze({
  fileBytes: 10 * 1024 * 1024,
  jsonBytes: 1024 * 1024,
  pngMetadataBytes: 2 * 1024 * 1024,
  pngChunks: 4096,
  lorebookEntries: 500,
  lorebookBytes: 256 * 1024,
});

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
    assertByteLimit(input, TAVERN_IMPORT_LIMITS.jsonBytes, 'Card JSON');
    return normalizeTavernCard(JSON.parse(input) as unknown, input);
  }

  const card = normalizeTavernCard(extractTavernCardJsonFromPng(input));
  return { ...card, sourceHash: createHash('sha256').update(input).digest('hex') };
};

export const normalizeTavernCard = (
  raw: unknown,
  sourceText?: string,
): NormalizedTavernCard => {
  if (!isRecord(raw)) {
    throw new Error('Tavern-compatible card must be a JSON object.');
  }
  assertBoundedJson(raw);
  const serialized = JSON.stringify(raw);
  assertByteLimit(serialized, TAVERN_IMPORT_LIMITS.jsonBytes, 'Card JSON');
  const source = sourceText ?? serialized;
  assertByteLimit(source, TAVERN_IMPORT_LIMITS.jsonBytes, 'Card JSON');
  if (raw.spec !== undefined && !['chara_card_v2', 'chara_card_v3'].includes(String(raw.spec))) {
    throw new Error('Unsupported Tavern-compatible card specification.');
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
  if (name.length > 512 || name.includes('\0')) throw new Error('Character name must be at most 512 characters without NUL.');
  const characterBook = data.character_book ?? raw.character_book;
  if (countLorebookEntries(characterBook) > TAVERN_IMPORT_LIMITS.lorebookEntries) {
    throw new Error(`Lorebook exceeds ${TAVERN_IMPORT_LIMITS.lorebookEntries} entries.`);
  }
  assertByteLimit(JSON.stringify(characterBook ?? {}), TAVERN_IMPORT_LIMITS.lorebookBytes, 'Lorebook');

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
    characterBook,
    rawExtensions: { ...extensions },
    sourceHash: createHash('sha256').update(source).digest('hex'),
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
    card.depthPrompt?.prompt,
    JSON.stringify(card.characterBook ?? {}),
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
  const characterId = options.characterId ?? slugifyCharacterId(card.name, card.sourceHash);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(characterId)) {
    throw new Error('Character id must be 1–64 ASCII letters, numbers, underscores or hyphens.');
  }
  if (!['preview', 'create', 'merge', 'playOnly'].includes(options.mode)) throw new Error('Invalid Tavern import mode.');
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
  if (input.byteLength > TAVERN_IMPORT_LIMITS.fileBytes) throw new Error('PNG card exceeds 10 MiB.');
  const buffer = Buffer.from(input);

  if (!isPng(buffer)) {
    throw new Error('PNG Tavern card input must start with a PNG signature.');
  }

  const metadata = readPngTextChunks(buffer);
  const raw = metadata.ccv3 ?? metadata.chara;

  if (!raw) {
    throw new Error('PNG does not contain chara or ccv3 metadata.');
  }

  // Both chara and ccv3 embed UTF-8 JSON as base64 (CCv3 SPEC_V3.md).
  if (raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(raw)) {
    throw new Error('PNG card metadata must contain valid base64.');
  }
  const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'base64'));
  assertByteLimit(jsonText, TAVERN_IMPORT_LIMITS.jsonBytes, 'Card JSON');

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
  const chunks: Record<string, string> = Object.create(null);
  let offset = 8;
  let metadataBytes = 0;
  let count = 0;
  let ended = false;

  while (offset + 12 <= buffer.length) {
    if (++count > TAVERN_IMPORT_LIMITS.pngChunks) throw new Error('PNG has too many chunks.');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buffer.length) {
      throw new Error('Invalid PNG chunk length.');
    }

    if (crc32(buffer.subarray(offset + 4, dataEnd)) !== buffer.readUInt32BE(dataEnd)) {
      throw new Error('PNG chunk checksum does not match its content.');
    }
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IEND') {
      if (length !== 0 || dataEnd + 4 !== buffer.length) throw new Error('Invalid PNG end chunk.');
      ended = true;
      break;
    }

    if (['tEXt', 'iTXt', 'zTXt'].includes(type)) {
      metadataBytes += length;
      if (metadataBytes > TAVERN_IMPORT_LIMITS.pngMetadataBytes) throw new Error('PNG metadata exceeds 2 MiB.');
    }
    const record = (keyword: string, text: string) => {
      if (!['chara', 'ccv3'].includes(keyword)) return;
      if (Object.hasOwn(chunks, keyword)) throw new Error('PNG has duplicate character metadata.');
      assertByteLimit(text, TAVERN_IMPORT_LIMITS.pngMetadataBytes, 'PNG metadata');
      chunks[keyword] = text;
    };

    if (type === 'tEXt') {
      const separator = data.indexOf(0);

      if (separator > 0) {
        record(data.subarray(0, separator).toString('latin1'), data.subarray(separator + 1).toString('latin1'));
      }
    }

    if (type === 'iTXt') {
      const parsed = parseITxtChunk(data);

      if (parsed) {
        record(parsed.keyword, parsed.text);
      }
    }

    if (type === 'zTXt') {
      const separator = data.indexOf(0);
      const keyword = data.subarray(0, separator).toString('latin1');
      if (['chara', 'ccv3'].includes(keyword)) {
        if (separator <= 0 || data[separator + 1] !== 0) throw new Error('Invalid compressed PNG metadata.');
        record(keyword, inflateSync(data.subarray(separator + 2), { maxOutputLength: TAVERN_IMPORT_LIMITS.pngMetadataBytes }).toString('latin1'));
      }
    }

    offset = dataEnd + 4;
  }
  if (!ended) throw new Error('PNG card is truncated or missing its end chunk.');

  return chunks;
}

function parseITxtChunk(data: Buffer): { keyword: string; text: string } | undefined {
  const keywordEnd = data.indexOf(0);

  if (keywordEnd <= 0 || keywordEnd + 5 >= data.length) {
    return undefined;
  }

  const keyword = data.subarray(0, keywordEnd).toString('utf-8');
  if (!['chara', 'ccv3'].includes(keyword)) return undefined;
  const compressed = data[keywordEnd + 1];
  if ((compressed !== 0 && compressed !== 1) || data[keywordEnd + 2] !== 0) throw new Error('Invalid PNG text compression.');
  let offset = keywordEnd + 3;

  for (let index = 0; index < 2; index += 1) {
    const next = data.indexOf(0, offset);

    if (next < 0) {
      throw new Error('Invalid PNG text metadata.');
    }

    offset = next + 1;
  }

  return {
    keyword,
    text: new TextDecoder('utf-8', { fatal: true }).decode(compressed === 1
      ? inflateSync(data.subarray(offset), { maxOutputLength: TAVERN_IMPORT_LIMITS.pngMetadataBytes })
      : data.subarray(offset)),
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

function slugifyCharacterId(name: string, sourceHash: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 64) || `imported-${sourceHash.slice(0, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertByteLimit(text: string, limit: number, label: string): void {
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error(`${label} exceeds ${limit} bytes.`);
}

function assertBoundedJson(value: unknown): void {
  let nodes = 0;
  function visit(current: unknown, depth: number) {
    if (++nodes > 20_000 || depth > 32) throw new Error('Card JSON structure exceeds safe limits.');
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Card contains an unsafe field name.');
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
}

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let remainder = value;
  for (let bit = 0; bit < 8; bit++) remainder = (remainder >>> 1) ^ ((remainder & 1) ? 0xedb88320 : 0);
  return remainder >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let remainder = 0xffffffff;
  for (const byte of bytes) remainder = (remainder >>> 8) ^ PNG_CRC_TABLE[(remainder ^ byte) & 0xff]!;
  return (remainder ^ 0xffffffff) >>> 0;
}
