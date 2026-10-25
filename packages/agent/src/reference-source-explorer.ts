import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';

import type { ReferenceChapterWorkUnitWindow } from '@oh-awesome-novel/core';

export const MAX_REFERENCE_SOURCE_SEARCH_RESULTS = 20;
export const MAX_REFERENCE_SOURCE_READ_CHARS = 4_000;
export const MAX_REFERENCE_SOURCE_QUERY_CHARS = 200;
const SEARCH_SNIPPET_RADIUS = 60;

interface IndexedLine {
  readonly pointerId: string;
  readonly chapterId: string;
  readonly line: number;
  readonly text: string;
}

export interface ReferenceSourceExplorer {
  readonly tools: ToolSet;
  /** Pointer ids the model has searched into or read during this call. */
  readonly visitedPointerIds: ReadonlySet<string>;
}

/**
 * Read-only, in-memory access to the host-selected source windows of one
 * reduction call. Results always name the host pointer that contains them so
 * the model can cite what it read without inventing paths or line ranges.
 */
export function createReferenceSourceExplorer(
  windows: readonly ReferenceChapterWorkUnitWindow[],
): ReferenceSourceExplorer {
  const windowsById = new Map(windows.map((window) => [window.pointerId, window]));
  const lines: IndexedLine[] = windows.flatMap((window) =>
    window.content.split(/\r?\n/u).map((text, offset) => ({
      pointerId: window.pointerId,
      chapterId: window.pointer.chapterId,
      line: window.pointer.lineStart + offset,
      text,
    })));
  const visitedPointerIds = new Set<string>();

  const searchReferenceSource = tool({
    description: [
      'Search the reference source covered by this reduction.',
      'Every term must appear on the same line; matching ignores case.',
      'Returns short snippets with the evidence pointer that contains each line.',
    ].join(' '),
    inputSchema: jsonSchema<{ query: string }>({
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: MAX_REFERENCE_SOURCE_QUERY_CHARS },
      },
      required: ['query'],
    }),
    execute: async ({ query }) => {
      const terms = String(query).slice(0, MAX_REFERENCE_SOURCE_QUERY_CHARS)
        .toLocaleLowerCase()
        .split(/\s+/u)
        .filter(Boolean);
      if (!terms.length) return { matches: [], truncated: false };
      const matches: Array<{ pointerId: string; chapterId: string; line: number; snippet: string }> = [];
      let truncated = false;
      for (const entry of lines) {
        const lower = entry.text.toLocaleLowerCase();
        if (!terms.every((term) => lower.includes(term))) continue;
        if (matches.length === MAX_REFERENCE_SOURCE_SEARCH_RESULTS) {
          truncated = true;
          break;
        }
        const at = lower.indexOf(terms[0]!);
        const start = Math.max(0, at - SEARCH_SNIPPET_RADIUS);
        matches.push({
          pointerId: entry.pointerId,
          chapterId: entry.chapterId,
          line: entry.line,
          snippet: entry.text.slice(start, at + terms[0]!.length + SEARCH_SNIPPET_RADIUS),
        });
        visitedPointerIds.add(entry.pointerId);
      }
      return { matches, truncated };
    },
  });

  const readReferenceSource = tool({
    description: [
      'Read lines from one evidence pointer returned by the search or listed in the input.',
      `Returns at most ${MAX_REFERENCE_SOURCE_READ_CHARS} characters.`,
    ].join(' '),
    inputSchema: jsonSchema<{ pointerId: string; startLine?: number; endLine?: number }>({
      type: 'object',
      additionalProperties: false,
      properties: {
        pointerId: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
      required: ['pointerId'],
    }),
    execute: async ({ pointerId, startLine, endLine }) => {
      const window = windowsById.get(String(pointerId));
      if (!window) return { error: 'Unknown pointerId. Use a pointer from the search or the input.' };
      const first = window.pointer.lineStart;
      const last = window.pointer.lineEnd;
      const from = clampLine(startLine, first, last, first);
      const to = clampLine(endLine, from, last, last);
      const text = lines
        .filter((entry) =>
          entry.pointerId === window.pointerId && entry.line >= from && entry.line <= to)
        .map((entry) => entry.text)
        .join('\n');
      visitedPointerIds.add(window.pointerId);
      return {
        pointerId: window.pointerId,
        chapterId: window.pointer.chapterId,
        lineStart: from,
        lineEnd: to,
        text: text.slice(0, MAX_REFERENCE_SOURCE_READ_CHARS),
        truncated: text.length > MAX_REFERENCE_SOURCE_READ_CHARS,
      };
    },
  });

  return {
    tools: { searchReferenceSource, readReferenceSource },
    visitedPointerIds,
  };
}

function clampLine(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isSafeInteger(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
