import { lstat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { evaluateChapterEvidence } from './chapter-evidence-freshness.js';
import type { FrozenWorkspaceSnapshot } from './chapter-evidence-freshness.js';
import { readWorkspaceTextFile } from './workspace-text.js';

export type ProjectHealthSeverity = 'info' | 'warning' | 'error';
export interface ProjectHealthIssue { id: string; severity: ProjectHealthSeverity; title: string; detail: string; path?: string }
export interface ProjectHealth {
  generatedAt: string; missingCharacterCards: string[]; chaptersWithoutSummaries: string[];
  activeHookCount: number;
  /** Known chapter evidence whose source hash is stale; missing/unverified are separate issues. */
  latestStateStale: boolean;
  timelineGapCount: number; pendingActionCount: number; issues: ProjectHealthIssue[];
}
export interface ReadProjectHealthOptions { generatedAt?: string; pendingActionCount?: number }

/** Pure shared evaluator for host-captured health data and the Agent's fixed projection. */
export function evaluateProjectHealth(snapshot: FrozenWorkspaceSnapshot, options: ReadProjectHealthOptions = {}): ProjectHealth {
  const files = new Map(snapshot.files.map((file) => [file.path, file.content]));
  const characterIds = [...new Set([...snapshot.directories ?? [], ...files.keys()].flatMap((path) => {
    const id = /^characters\/([^/]+)(?:\/|$)/u.exec(path)?.[1]; return id ? [id] : [];
  }))].sort();
  const missingCharacterCards = characterIds.filter((id) => !files.has(`characters/${id}/meta.yaml`) || !files.has(`characters/${id}/summary.md`));
  const coverage = evaluateChapterEvidence(snapshot);
  const chapters = snapshot.files.flatMap(({ path }) => {
    const id = /^chapters\/(.+)\.md$/u.exec(path)?.[1]; return id && !id.endsWith('/0000') ? [id] : [];
  }).sort();
  const chaptersWithoutSummaries = chapters.filter((id) => !files.has(`summaries/chapter/${id}.md`));
  const active = readYaml(files.get('foreshadow/active.yaml'));
  const activeHookCount = record(active) && Array.isArray(active.active) ? active.active.length : 0;
  const timeline = readYaml(files.get('timeline/events.yaml'));
  const timelineChapters = new Set(record(timeline) && Array.isArray(timeline.events) ? timeline.events.filter(record).map((event) => event.chapter) : []);
  const timelineGaps = chapters.filter((id) => !timelineChapters.has(id));
  const latestStateStale = coverage.some((item) => item.state.status === 'stale');
  const issues: ProjectHealthIssue[] = [
    ...missingCharacterCards.map((id): ProjectHealthIssue => ({ id: `missing-character-card:${id}`, severity: 'warning', title: 'Missing character card file', detail: `${id} is missing meta.yaml or summary.md.`, path: `characters/${id}` })),
    ...chaptersWithoutSummaries.map((id): ProjectHealthIssue => ({ id: `chapter-summary:${id}`, severity: 'warning', title: 'Chapter has no summary', detail: `${id} has no matching summaries/chapter file.`, path: `chapters/${id}.md` })),
    ...coverage.flatMap((item) => (['summary', 'state'] as const).flatMap((kind): ProjectHealthIssue[] => {
      const assessment = item[kind];
      if (assessment.status === 'current' || (kind === 'summary' && assessment.status === 'missing')) return [];
      return [{ id: `chapter-${kind}-${assessment.status}:${item.chapterId}`, severity: assessment.status === 'stale' ? 'warning' : 'info',
        title: `Chapter ${kind} ${assessment.status}`, detail: `${item.chapterId}: ${assessment.reason}`, path: assessment.path }];
    })),
    ...timelineGaps.map((id): ProjectHealthIssue => ({ id: `timeline-gap:${id}`, severity: 'info', title: 'No timeline event for chapter', detail: `${id} has chapter text but no timeline event.`, path: `chapters/${id}.md` })),
  ];
  if (latestStateStale) issues.push({ id: 'latest-state-stale', severity: 'warning', title: 'Chapter state has stale source evidence', detail: 'At least one settled chapter no longer matches its recorded source hash. Global state is not automatically retracted.', path: 'state/chapters' });
  if (options.pendingActionCount && options.pendingActionCount > 0) issues.push({ id: 'pending-actions', severity: 'info', title: 'PendingAction exists', detail: `${options.pendingActionCount} pending action(s) need review.` });
  return { generatedAt: options.generatedAt ?? '1970-01-01T00:00:00.000Z', missingCharacterCards, chaptersWithoutSummaries, activeHookCount, latestStateStale, timelineGapCount: timelineGaps.length, pendingActionCount: options.pendingActionCount ?? 0, issues };
}

/** Capture only public novel roots. Hidden paths, symlinks and non-regular files never enter health inputs. */
export async function readProjectHealth(workspaceRoot: string, options: ReadProjectHealthOptions = {}): Promise<ProjectHealth> {
  const root = await realpath(workspaceRoot);
  const files: Array<{ path: string; content: string }> = [];
  const directories: string[] = [];
  let entries = 0;
  let totalBytes = 0;
  async function visit(path: string, depth = 0): Promise<void> {
    if (++entries > 10_000 || depth > 24) throw new Error('Project health capture exceeds its entry/depth limit.');
    const absolute = join(root, path);
    let info;
    try { info = await lstat(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      if (await realpath(absolute) !== absolute) throw new Error('Project health directory changed during capture.');
      directories.push(path);
      for (const entry of (await readdir(absolute)).sort()) if (!entry.startsWith('.')) await visit(`${path}/${entry}`, depth + 1);
      const after = await lstat(absolute);
      if (!after.isDirectory() || after.ino !== info.ino || after.dev !== info.dev || await realpath(absolute) !== absolute) throw new Error('Project health directory changed during capture.');
    } else if (info.isFile() && info.nlink === 1 && /\.(md|ya?ml)$/u.test(path)) {
      if (info.size > 2 * 1024 * 1024 || totalBytes + info.size > 32 * 1024 * 1024) throw new Error('Project health capture exceeds its 2 MiB file / 32 MiB total limit.');
      const file = await readWorkspaceTextFile(root, path, { preserveBOM: true });
      totalBytes += Buffer.byteLength(file.content);
      if (totalBytes > 32 * 1024 * 1024) throw new Error('Project health capture exceeds its 32 MiB total limit.');
      files.push(file);
    }
  }
  for (const root of ['characters', 'chapters', 'summaries', 'state', 'foreshadow', 'timeline']) await visit(root);
  return evaluateProjectHealth({ files, directories }, { ...options, generatedAt: options.generatedAt ?? new Date().toISOString() });
}

/** Bounded model/report text; the UI DTO retains every issue. */
export const formatProjectHealthMarkdown = (health: ProjectHealth): string => [
  '## Project Health', '', `Generated: ${health.generatedAt}`, '',
  `- missing character cards: ${health.missingCharacterCards.length}`,
  `- chapters without summaries: ${health.chaptersWithoutSummaries.length}`,
  `- active hooks: ${health.activeHookCount}`,
  `- latest state stale: ${health.latestStateStale ? 'yes' : 'no'} (source hash; missing/unverified evidence is listed separately)`,
  `- timeline gaps: ${health.timelineGapCount}`, `- pending actions: ${health.pendingActionCount}`, '', '### Issues',
  health.issues.length ? health.issues.slice(0, 20).map((issue) => `- [${issue.severity}] ${issue.title}: ${issue.detail}`).join('\n') : '- none',
  ...(health.issues.length > 20 ? [`- ${health.issues.length - 20} additional issues omitted from this bounded report; inspect project health for details.`] : []),
].join('\n');
function readYaml(content: string | undefined): unknown {
  if (content === undefined) return undefined;
  try { const doc = parseDocument(content, { uniqueKeys: true }); return doc.errors.length ? undefined : doc.toJS({ maxAliasCount: 100 }); } catch { return undefined; }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
