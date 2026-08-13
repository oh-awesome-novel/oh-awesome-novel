import { createHash } from 'node:crypto';

export const DEFAULT_BASH_COMMAND_PREVIEW_BYTES = 2 * 1024;
export const DEFAULT_BASH_TURN_PREVIEW_BYTES = 8 * 1024;

export interface BashCommandAudit {
  commandPreview: string;
  commandHash: string;
  commandByteLength: number;
  previewByteLength: number;
  truncated: boolean;
}

export interface CreateBashCommandAuditOptions {
  maxPreviewBytes?: number;
}

/**
 * Turns bash-tool's raw `{ command }` input into display-only audit data.
 * The full command is hashed but is never returned or retained by this helper.
 */
export function createBashCommandAudit(
  args: unknown,
  options: CreateBashCommandAuditOptions = {},
): BashCommandAudit {
  const maxPreviewBytes = options.maxPreviewBytes
    ?? DEFAULT_BASH_COMMAND_PREVIEW_BYTES;
  assertPreviewLimit(maxPreviewBytes);

  const command = readBashCommand(args);
  const hashInput = command ?? '<invalid-bash-command-arguments>';
  const displayInput = command ?? '[invalid bash command arguments]';
  const sanitized = escapeCommandForPlainText(stripAnsiSequences(displayInput));
  const bounded = boundUtf8Text(sanitized, maxPreviewBytes);

  return {
    commandPreview: bounded.text,
    commandHash: createHash('sha256').update(hashInput, 'utf-8').digest('hex'),
    commandByteLength: Buffer.byteLength(command ?? '', 'utf-8'),
    previewByteLength: Buffer.byteLength(bounded.text, 'utf-8'),
    truncated: bounded.truncated,
  };
}

/** Revalidates an already-shaped audit before it crosses a public/durable boundary. */
export function normalizeBashCommandAudit(
  value: unknown,
  options: CreateBashCommandAuditOptions = {},
): BashCommandAudit | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => ![
      'commandPreview',
      'commandHash',
      'commandByteLength',
      'previewByteLength',
      'truncated',
    ].includes(key))
    || typeof record.commandPreview !== 'string'
    || record.commandPreview.includes('\0')
    || typeof record.commandHash !== 'string'
    || !/^[a-f0-9]{64}$/u.test(record.commandHash)
    || !Number.isSafeInteger(record.commandByteLength)
    || (record.commandByteLength as number) < 0
    || !Number.isSafeInteger(record.previewByteLength)
    || (record.previewByteLength as number) < 0
    || typeof record.truncated !== 'boolean'
  ) {
    return undefined;
  }

  const maxPreviewBytes = options.maxPreviewBytes
    ?? DEFAULT_BASH_COMMAND_PREVIEW_BYTES;
  assertPreviewLimit(maxPreviewBytes);
  const sanitized = escapeCommandForPlainText(stripAnsiSequences(record.commandPreview));
  const bounded = boundUtf8Text(sanitized, maxPreviewBytes);
  return {
    commandPreview: bounded.text,
    commandHash: record.commandHash,
    commandByteLength: record.commandByteLength as number,
    previewByteLength: Buffer.byteLength(bounded.text, 'utf-8'),
    truncated: record.truncated || bounded.truncated || sanitized !== record.commandPreview,
  };
}

function readBashCommand(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) {
    return undefined;
  }

  const command = (args as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function assertPreviewLimit(maxPreviewBytes: number): void {
  if (!Number.isSafeInteger(maxPreviewBytes) || maxPreviewBytes < 0) {
    throw new TypeError('maxPreviewBytes must be a non-negative safe integer.');
  }
}

function escapeCommandForPlainText(value: string): string {
  let escaped = '';

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (character === '\\') {
      escaped += '\\\\';
    } else if (character === '"') {
      escaped += '\\"';
    } else if (character === '\n') {
      escaped += '\\n';
    } else if (character === '\r') {
      escaped += '\\r';
    } else if (character === '\t') {
      escaped += '\\t';
    } else if (isUnsafeControlCodePoint(codePoint)) {
      escaped += `\\u${codePoint.toString(16).padStart(4, '0')}`;
    } else {
      escaped += character;
    }
  }

  return escaped;
}

function isUnsafeControlCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || codePoint === 0x2028
    || codePoint === 0x2029
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function stripAnsiSequences(value: string): string {
  let result = '';

  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);

    if (code === 0x1b) {
      const introducer = value.charCodeAt(index + 1);

      if (introducer === 0x5b) {
        index = consumeCsi(value, index + 2);
        continue;
      }

      if (introducer === 0x5d) {
        index = consumeOsc(value, index + 2);
        continue;
      }

      // Drop an unrecognized escape introducer while preserving following
      // printable text so the preview does not hide part of the command.
      index += 1;
      continue;
    }

    if (code === 0x9b) {
      index = consumeCsi(value, index + 1);
      continue;
    }

    if (code === 0x9d) {
      index = consumeOsc(value, index + 1);
      continue;
    }

    result += value[index];
    index += 1;
  }

  return result;
}

function consumeCsi(value: string, start: number): number {
  let index = start;

  while (index < value.length) {
    const code = value.charCodeAt(index);
    index += 1;

    if (code >= 0x40 && code <= 0x7e) {
      break;
    }
  }

  return index;
}

function consumeOsc(value: string, start: number): number {
  let index = start;

  while (index < value.length) {
    const code = value.charCodeAt(index);

    if (code === 0x07) {
      return index + 1;
    }

    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }

    index += 1;
  }

  return index;
}

function boundUtf8Text(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) {
    return { text: value, truncated: false };
  }

  const marker = '… [truncated]';
  const markerBytes = Buffer.byteLength(marker, 'utf-8');
  const contentBudget = Math.max(0, maxBytes - markerBytes);
  const prefix = takeUtf8Prefix(value, contentBudget);
  const remainingBytes = maxBytes - Buffer.byteLength(prefix, 'utf-8');

  return {
    text: prefix + takeUtf8Prefix(marker, remainingBytes),
    truncated: true,
  };
}

function takeUtf8Prefix(value: string, maxBytes: number): string {
  let result = '';
  let byteLength = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf-8');

    if (byteLength + characterBytes > maxBytes) {
      break;
    }

    result += character;
    byteLength += characterBytes;
  }

  return result;
}
