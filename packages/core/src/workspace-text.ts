import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

const ROOTS = ['chapters', 'characters', 'world', 'state', 'timeline', 'foreshadow', 'summaries', 'outline', '.oan/constitution', '.oan/workflow.yaml'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const TEXT_EXTENSION = /\.(?:md|yaml|yml|txt)$/u;

export interface WorkspaceSearchResult {
  path: string;
  name: string;
  domain: string;
  line: number;
  snippet: string;
  matchedField: 'content' | 'path';
}
export interface WorkspaceSearchResponse {
  schemaVersion: 1;
  query: string;
  scannedAt: string;
  scannedFiles: number;
  sourceFingerprint: string;
  truncated: boolean;
  results: WorkspaceSearchResult[];
}
export interface ManuscriptExport {
  schemaVersion: 1;
  format: 'md' | 'txt';
  fileName: string;
  content: string;
  chapterPaths: string[];
  generatedAt: string;
  sourceFingerprint: string;
}

interface TextFile { path: string; content: string }

function safePath(value: string): string {
  const parts = value.split('/');
  const allowedHidden = value === '.oan/workflow.yaml' || value.startsWith('.oan/constitution/');
  if (!value || value !== value.normalize('NFC') || /[\\\x00-\x1f\x7f]/u.test(value)
    || parts.some((part, index) => !part || part === '.' || part === '..'
      || (part.startsWith('.') && !(allowedHidden && part === '.oan' && index === 0)))) {
    throw new Error('Invalid workspace text path.');
  }
  return value;
}

async function safeAncestors(root: string, path: string): Promise<void> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || await realpath(root) !== root) throw new Error('Unsafe workspace text root.');
  let cursor = root;
  for (const part of path.split('/').slice(0, -1)) {
    cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(cursor) !== cursor) {
      throw new Error(`Unsafe workspace text directory: ${path}`);
    }
  }
}

/** Safe plain-text viewer read; only constitution/workflow are hidden-path exceptions. */
export async function readWorkspaceTextFile(workspaceRoot: string, inputPath: string): Promise<TextFile> {
  const root = await realpath(workspaceRoot);
  const path = safePath(inputPath);
  await safeAncestors(root, path);
  const absolute = join(root, ...path.split('/'));
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE_BYTES) throw new Error(`Unsafe or oversized workspace text file: ${path}`);
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(absolute);
    await safeAncestors(root, path);
    if (length !== before.size || before.ino !== current.ino || before.dev !== current.dev
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== before.size || current.isSymbolicLink()
      || current.nlink !== 1 || after.nlink !== 1) throw new Error(`Workspace text changed during reading: ${path}`);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    if (content.includes('\0')) throw new Error(`Workspace text contains binary data: ${path}`);
    return { path, content };
  } finally { await handle.close(); }
}

async function scan(workspaceRoot: string, roots: readonly string[]): Promise<TextFile[]> {
  const root = await realpath(workspaceRoot);
  const files: TextFile[] = [];
  let entries = 0;
  let totalBytes = 0;
  const walk = async (path: string, depth: number): Promise<void> => {
    if (++entries > MAX_ENTRIES || depth > 24) throw new Error('Workspace text scan exceeds its entry/depth limit.');
    const absolute = join(root, ...path.split('/'));
    await safeAncestors(root, path);
    let info;
    try { info = await lstat(absolute); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Workspace text source is a symbolic link: ${path}`);
    if (info.isDirectory()) {
      const children = await readdir(absolute);
      for (const child of children.sort()) {
        if (child.startsWith('.')) continue;
        await walk(`${path}/${child}`, depth + 1);
      }
    } else if (!info.isFile() || info.nlink !== 1) {
      throw new Error(`Workspace text source is not a regular single-link file: ${path}`);
    } else if (TEXT_EXTENSION.test(path)) {
      const file = await readWorkspaceTextFile(root, path);
      totalBytes += Buffer.byteLength(file.content);
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Workspace text scan exceeds its 32 MiB limit.');
      files.push(file);
    }
  };
  for (const path of roots) {
    // An absent .oan parent is a normal workspace without control files.
    try { await walk(path, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function fingerprint(files: readonly TextFile[]): string {
  return createHash('sha256').update(JSON.stringify(files.map((file) => [file.path,
    createHash('sha256').update(file.content).digest('hex')]))).digest('hex');
}

/** Literal Unicode substring matching needs no word tokenizer for Chinese. */
export async function searchWorkspaceText(workspaceRoot: string, input: string): Promise<WorkspaceSearchResponse> {
  const query = input.trim().normalize('NFC');
  if (!query || query.length > 160 || /[\x00-\x1f\x7f]/u.test(query)) throw new Error('Search query must contain 1–160 printable characters.');
  const files = await scan(workspaceRoot, ROOTS);
  const needle = query.toLowerCase();
  const matches: WorkspaceSearchResult[] = [];
  for (const file of files) {
    const lines = file.content.replace(/\r\n?/gu, '\n').split('\n');
    const lineIndex = lines.findIndex((line) => line.normalize('NFC').toLowerCase().includes(needle));
    const pathMatch = file.path.toLowerCase().includes(needle);
    if (lineIndex === -1 && !pathMatch) continue;
    const line = (lines[Math.max(0, lineIndex)] ?? '').normalize('NFC');
    const index = line.toLowerCase().indexOf(needle);
    const chars = Array.from(line);
    const matchStart = index < 0 ? 0 : Array.from(line.slice(0, index)).length;
    const start = Math.max(0, matchStart - 50);
    const snippet = `${start ? '…' : ''}${chars.slice(start, start + 240).join('')}${chars.length > start + 240 ? '…' : ''}`;
    matches.push({ path: file.path, name: basename(file.path), domain: file.path.startsWith('.oan/') ? 'constitution/workflow' : file.path.split('/')[0]!,
      line: Math.max(0, lineIndex) + 1, snippet, matchedField: lineIndex < 0 ? 'path' : 'content' });
  }
  return { schemaVersion: 1, query, scannedAt: new Date().toISOString(), scannedFiles: files.length,
    sourceFingerprint: fingerprint(files), truncated: matches.length > 100, results: matches.slice(0, 100) };
}

export async function exportManuscript(workspaceRoot: string, format: 'md' | 'txt'): Promise<ManuscriptExport> {
  if (format !== 'md' && format !== 'txt') throw new Error('Manuscript format must be md or txt.');
  const files = (await scan(workspaceRoot, ['chapters'])).filter((file) => /^chapters\/\d{4}\/(?!0000)\d{4}\.md$/u.test(file.path));
  if (!files.length) throw new Error('No canonical chapters are available for export.');
  const bodies = files.map((file) => {
    const lines = file.content.replace(/\r\n?/gu, '\n').split('\n');
    if (lines[0] === '---') {
      const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
      if (end === -1) throw new Error(`Unterminated chapter frontmatter: ${file.path}`);
      lines.splice(0, end + 1);
    }
    const body = lines.join('\n').trim();
    return format === 'txt' ? body.replace(/^#{1,6}[ \t]+/gmu, '') : body;
  });
  const generatedAt = new Date().toISOString();
  return { schemaVersion: 1, format, fileName: `manuscript-${generatedAt.replace(/[:.]/gu, '-')}.${format}`,
    content: `${bodies.join(format === 'md' ? '\n\n---\n\n' : '\n\n')}\n`,
    chapterPaths: files.map((file) => file.path), generatedAt, sourceFingerprint: fingerprint(files) };
}
