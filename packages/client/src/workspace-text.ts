export interface WorkspaceSearchResult {
  path: string; name: string; domain: string; line: number; snippet: string; matchedField: 'content' | 'path';
}
export interface WorkspaceSearchResponse {
  schemaVersion: 1; query: string; scannedAt: string; scannedFiles: number; sourceFingerprint: string;
  truncated: boolean; results: WorkspaceSearchResult[];
}
export interface ManuscriptExport {
  schemaVersion: 1; format: 'md' | 'txt'; fileName: string; content: string; chapterPaths: string[];
  generatedAt: string; sourceFingerprint: string;
}
const fail = (): never => { throw new Error('Invalid workspace text response.'); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) return fail();
  return record;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) return fail();
  return value;
}
function date(value: unknown): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
}
function fingerprint(value: unknown): void { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(); }
function path(value: unknown): string {
  const p = text(value, 4096);
  const parts = p.split('/');
  if (!p || p !== p.normalize('NFC') || /[\\\x00-\x1f\x7f]/u.test(p) || parts.some((part, index) => !part || part === '.' || part === '..'
    || (part.startsWith('.') && !(part === '.oan' && index === 0 && (p === '.oan/workflow.yaml' || p.startsWith('.oan/constitution/')))))) fail();
  if (!/^(?:chapters|characters|world|state|timeline|foreshadow|summaries|outline)\//u.test(p)
    && p !== '.oan/workflow.yaml' && !p.startsWith('.oan/constitution/')) fail();
  return p;
}
export function parseWorkspaceSearchResponse(value: unknown): WorkspaceSearchResponse {
  const r = object(value, ['schemaVersion', 'query', 'scannedAt', 'scannedFiles', 'sourceFingerprint', 'truncated', 'results']);
  if (r.schemaVersion !== 1 || !text(r.query, 160).trim() || /[\x00-\x1f\x7f]/u.test(r.query as string)
    || typeof r.truncated !== 'boolean' || !Number.isInteger(r.scannedFiles) || Number(r.scannedFiles) < 0 || Number(r.scannedFiles) > 10_000
    || !Array.isArray(r.results) || r.results.length > 100 || r.results.length > Number(r.scannedFiles)) fail();
  date(r.scannedAt); fingerprint(r.sourceFingerprint);
  const seen = new Set<string>();
  for (const item of r.results as unknown[]) {
    const hit = object(item, ['path', 'name', 'domain', 'line', 'snippet', 'matchedField']);
    const p = path(hit.path);
    if (seen.has(p) || hit.name !== p.split('/').at(-1) || hit.domain !== (p.startsWith('.oan/') ? 'constitution/workflow' : p.split('/')[0])
      || !Number.isInteger(hit.line) || Number(hit.line) < 1 || Number(hit.line) > 2_097_153
      || !['content', 'path'].includes(String(hit.matchedField)) || !/\.(?:md|yaml|yml|txt)$/u.test(p)) fail();
    if (/[\r\n\0]/u.test(text(hit.snippet, 484))) fail(); seen.add(p);
  }
  return r as unknown as WorkspaceSearchResponse;
}
export function parseManuscriptExport(value: unknown): ManuscriptExport {
  const r = object(value, ['schemaVersion', 'format', 'fileName', 'content', 'chapterPaths', 'generatedAt', 'sourceFingerprint']);
  if (r.schemaVersion !== 1 || !['md', 'txt'].includes(String(r.format)) || typeof r.fileName !== 'string'
    || !/^manuscript-[0-9TZ-]+\.(?:md|txt)$/u.test(r.fileName) || !r.fileName.endsWith(`.${r.format}`)
    || !Array.isArray(r.chapterPaths) || !r.chapterPaths.length || r.chapterPaths.length > 10_000) fail();
  text(r.content, 34 * 1024 * 1024); date(r.generatedAt); fingerprint(r.sourceFingerprint);
  let last = '';
  for (const item of r.chapterPaths as unknown[]) {
    const p = path(item);
    if (!/^chapters\/\d{4}\/(?!0000)\d{4}\.md$/u.test(p) || p <= last) fail();
    last = p;
  }
  return r as unknown as ManuscriptExport;
}
