import { createTwoFilesPatch } from 'diff';

import { normalizeWorkspaceRelativePath } from './candidate-change-set';

export const DEFAULT_MAX_RENDERED_DIFF_BYTES = 10 * 1024 * 1024;

export type ChangeDiffInput =
  | {
      operation: 'create';
      path: string;
      oldContent?: never;
      newContent: string;
    }
  | {
      operation: 'update';
      path: string;
      oldContent: string;
      newContent: string;
    }
  | {
      operation: 'delete';
      path: string;
      oldContent: string;
      newContent?: never;
    };

export function renderCandidateChangeDiff(
  inputs: readonly ChangeDiffInput[],
  options: { maxBytes?: number; contextLines?: number } = {},
): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RENDERED_DIFF_BYTES;
  const context = options.contextLines ?? 3;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Rendered diff maxBytes must be a positive integer.');
  }
  if (!Number.isSafeInteger(context) || context < 0) {
    throw new Error('Rendered diff contextLines must be a non-negative integer.');
  }

  const seen = new Set<string>();
  const normalized = inputs.map((input) => {
    const path = normalizeWorkspaceRelativePath(input.path);
    if (seen.has(path)) {
      throw new Error(`Duplicate diff path: ${path}`);
    }
    seen.add(path);
    return { ...input, path };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  let rendered = '';
  for (const input of normalized) {
    const oldFile = input.operation === 'create' ? '/dev/null' : `a/${input.path}`;
    const newFile = input.operation === 'delete' ? '/dev/null' : `b/${input.path}`;
    const oldContent = input.operation === 'create' ? '' : input.oldContent;
    const newContent = input.operation === 'delete' ? '' : input.newContent;
    const body = createTwoFilesPatch(
      oldFile,
      newFile,
      oldContent,
      newContent,
      '',
      '',
      { context },
    ).replace(/^=+\n/u, '');
    const modeHeader = input.operation === 'create'
      ? 'new file mode 100644\n'
      : input.operation === 'delete'
        ? 'deleted file mode 100644\n'
        : '';
    rendered += `diff --git a/${input.path} b/${input.path}\n${modeHeader}${body}`;
    if (Buffer.byteLength(rendered, 'utf8') > maxBytes) {
      throw new Error(`Rendered diff exceeds ${maxBytes} bytes.`);
    }
  }
  return rendered;
}
