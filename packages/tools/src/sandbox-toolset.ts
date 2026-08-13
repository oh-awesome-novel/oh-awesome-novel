import { createBashTool } from 'bash-tool';
import type { Sandbox as BashToolSandbox } from 'bash-tool';
import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

export const OAN_COMMAND_ALLOWLIST = Object.freeze([
  'echo',
  'printf',
  'cat',
  'ls',
  'mkdir',
  'touch',
  'rm',
  'cp',
  'mv',
  'pwd',
  'head',
  'tail',
  'wc',
  'stat',
  'grep',
  'rg',
  'sed',
  'awk',
  'sort',
  'uniq',
  'cut',
  'tr',
  'nl',
  'tee',
  'find',
  'basename',
  'dirname',
  'tree',
  'jq',
  'yq',
  'diff',
  'sha256sum',
  'file',
  'true',
  'false',
] as const);

export const DEFAULT_MODEL_TOOL_OUTPUT_CHARS = 64 * 1024;

export interface SandboxReadFileInput {
  path: string;
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}

export interface SandboxWriteFileInput {
  path: string;
  content: string;
}

export interface SandboxProposeChangesInput {
  title: string;
  description: string;
}

export interface CreateSandboxToolSetOptions {
  sandbox: BashToolSandbox;
  domainTools?: ToolSet;
  projectionSummary: {
    fileCount: number;
    totalBytes: number;
    capability: string;
  };
  readFile(input: SandboxReadFileInput): Promise<unknown>;
  writeFile(input: SandboxWriteFileInput): Promise<unknown>;
  previewChanges(): Promise<unknown>;
  proposeChanges?: (input: SandboxProposeChangesInput) => Promise<unknown>;
  maxBashOutputChars?: number;
}

/**
 * Assemble the model-visible tools around an OAN-owned sandbox. bash-tool is
 * used only for its AI SDK bash tool; its unbounded file tools are deliberately
 * replaced with the ranged/bounded implementations supplied by the session.
 */
export async function createSandboxToolSet(
  options: CreateSandboxToolSetOptions,
): Promise<ToolSet> {
  const toolkit = await createBashTool({
    sandbox: options.sandbox,
    destination: '/workspace',
    maxOutputLength: positiveInteger(
      options.maxBashOutputChars ?? DEFAULT_MODEL_TOOL_OUTPUT_CHARS,
      'maxBashOutputChars',
    ),
    promptOptions: {
      toolPrompt: createSandboxBashToolPrompt(options.projectionSummary),
    },
  });

  const sessionTools: ToolSet = {
    bash: toolkit.tools.bash,
    readFile: tool({
      description: [
        'Read UTF-8 text from the fixed in-memory workspace snapshot.',
        'Use 1-based startLine/endLine and maxBytes for bounded inspection.',
        'This tool never reads live host bytes.',
      ].join(' '),
      inputSchema: jsonSchema<SandboxReadFileInput>({
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', minLength: 1 },
          startLine: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
          maxBytes: { type: 'integer', minimum: 1 },
        },
      }),
      execute: (input) => options.readFile(input),
    }),
    writeFile: tool({
      description: [
        'Write one UTF-8 text file inside the fixed in-memory workspace.',
        'The host-selected turn capability and final-document validator apply.',
        'This never writes the canonical workspace before human approval.',
      ].join(' '),
      inputSchema: jsonSchema<SandboxWriteFileInput>({
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: {
          path: { type: 'string', minLength: 1 },
          content: { type: 'string' },
        },
      }),
      execute: (input) => options.writeFile(input),
    }),
    'workspace.previewChanges': tool({
      description: [
        'Validate the final virtual files and preview the current create/update/delete proposal.',
        'The returned diff is a bounded excerpt and is not the approval authority.',
      ].join(' '),
      inputSchema: jsonSchema<Record<string, never>>({
        type: 'object',
        additionalProperties: false,
        properties: {},
      }),
      execute: () => options.previewChanges(),
    }),
  };

  if (options.proposeChanges) {
    sessionTools['workspace.proposeChanges'] = tool({
      description: [
        'Seal the virtual workspace and create exactly one immutable PendingAction for human review.',
        'Call previewChanges first and only propose when the final virtual files are ready.',
      ].join(' '),
      inputSchema: jsonSchema<SandboxProposeChangesInput>({
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 240 },
          description: { type: 'string', minLength: 1, maxLength: 4_000 },
        },
      }),
      execute: (input) => options.proposeChanges!(input),
    });
  }

  return Object.freeze({
    ...(options.domainTools ?? {}),
    ...sessionTools,
  });
}

export function createSandboxBashToolPrompt(input: {
  fileCount: number;
  totalBytes: number;
  capability: string;
}): string {
  const fileCount = nonNegativeInteger(input.fileCount, 'fileCount');
  const totalBytes = nonNegativeInteger(input.totalBytes, 'totalBytes');
  const capability = oneLineText(input.capability, 'capability');
  return [
    'OAN fixed in-memory editing sandbox.',
    `Capability: ${capability}. Projected files: ${fileCount}; projected bytes: ${totalBytes}.`,
    `Available commands: ${OAN_COMMAND_ALLOWLIST.join(', ')}.`,
    'Network, host processes, Python, JavaScript, links, chmod, package managers and host filesystem access are unavailable.',
    'Only /workspace policy targets may become proposal candidates; /tmp is scratch space and is never proposed.',
  ].join('\n');
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function oneLineText(value: string, label: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || /[\r\n\p{Cc}]/u.test(value)
  ) {
    throw new Error(`${label} must be bounded single-line text.`);
  }
  return value;
}
