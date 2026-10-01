import { createHash } from 'node:crypto';
import type { SandboxProjectionSnapshot } from '@oh-awesome-novel/tools';
import type { NovelAgentWorkspaceContextFile, NovelAgentWorkspaceSnapshot } from './index';
import { estimateContextTokens } from './context-budget';

type File = SandboxProjectionSnapshot['files'][number];

/** Selection only: the fixed VFS still contains every allowlisted source. */
export function createNovelAgentWorkspaceSnapshotFromProjection(
  projection: SandboxProjectionSnapshot,
  options: { targetPaths?: readonly string[] } = {},
): NovelAgentWorkspaceSnapshot {
  const select = (root: string, extensions: readonly string[]) => projection.files
    .filter((file) => file.path.startsWith(`${root}/`)
      && extensions.some((extension) => file.path.endsWith(extension))
      && file.content.length > 0)
    .toSorted((a, b) => compare(a.path, b.path));
  const format = (root: string, file: File) => `# ${file.path.slice(root.length + 1)}\n\n${file.content}`;
  // Constitution and current state are protected; never silently take only the
  // first N files. The adapter rejects an oversized request before provider I/O.
  const constitution = select('.oan/constitution', ['.md']);
  const state = select('state', ['.yaml', '.yml']);
  const timeline = select('timeline', ['.yaml', '.yml', '.md']);
  const foreshadow = select('foreshadow', ['.yaml', '.yml', '.md']);
  const allSummaries = select('summaries', ['.md']);
  const targets = (options.targetPaths ?? []).map(chapterPosition).filter((p) => p !== undefined);
  const latestChapter = allSummaries.map((file) => chapterPosition(file.path))
    .filter((position) => position !== undefined).toSorted((a, b) => b.order - a.order)[0];
  const latestVolume = allSummaries.map((file) => volumeNumber(file.path))
    .filter((volume) => volume !== undefined).toSorted((a, b) => b - a)[0];
  const activeVolumes = new Set(targets.length ? targets.map((target) => target.volume)
    : [latestChapter?.volume ?? latestVolume].filter((volume) => volume !== undefined));
  const summaries = allSummaries.toSorted((a, b) => {
    const rank = (file: File) => {
      if (file.path === 'summaries/global.md') return -3;
      const volume = volumeNumber(file.path);
      if (volume !== undefined && activeVolumes.has(volume)) return -2;
      const position = chapterPosition(file.path);
      if (!position) return Number.MAX_SAFE_INTEGER;
      if (!targets.length) return -position.order;
      // Prefer nearby chapters in the target volume, then the preceding volume.
      return Math.min(...targets.map((target) => Math.abs(target.order - position.order)
        + (position.order > target.order ? 0.5 : 0)));
    };
    return rank(a) - rank(b) || compare(b.path, a.path);
  });
  // Global/target-volume summaries do not displace the twelve chapter anchors.
  const required = summaries.filter((file) => file.path === 'summaries/global.md'
    || activeVolumes.has(volumeNumber(file.path)!));
  const chosen = [...required, ...summaries.filter((file) => !required.includes(file)
    && volumeNumber(file.path) === undefined).slice(0, 12)];
  const workflow = projection.files.find((file) => file.path === '.oan/workflow.yaml' && file.content.length > 0);
  const contextFiles: NovelAgentWorkspaceContextFile[] = [];
  const describe = (sourceId: string, root: string, files: File[]) => {
    for (const file of files) {
      const payload = root ? format(root, file) : file.content;
      contextFiles.push({ sourceId, path: file.path,
        sourceHash: hash(file.content), payloadHash: hash(payload),
        modelVisibleChars: payload.length, estimatedTokens: estimateContextTokens(payload),
        selectionReason: sourceId === 'previousChapterEnding'
          ? targets.length ? 'target-near chapter or volume/global summary' : 'latest numbered chapter or volume/global summary'
          : 'complete protected source or continuity ledger from the fixed projection',
      });
    }
  };
  describe('constitution', '.oan/constitution', constitution);
  describe('workflow', '', workflow ? [workflow] : []);
  describe('previousChapterEnding', 'summaries', chosen);
  describe('latestState', 'state', state);
  describe('timeline', 'timeline', timeline);
  describe('foreshadowLedger', 'foreshadow', foreshadow);
  return Object.freeze({
    workspaceRoot: projection.workspaceRoot,
    fixedFileHashes: Object.freeze(projection.files.map((file) => ({ path: file.path, hash: hash(file.content) }))),
    projectionFingerprint: projection.projectionFingerprint,
    ...(constitution.length ? { constitution: constitution.map((file) => format('.oan/constitution', file)).join('\n\n') } : {}),
    ...(workflow ? { workflow: workflow.content } : {}),
    ...(chosen.length ? { summaries: Object.freeze(chosen.map((file) => format('summaries', file))) } : {}),
    ...(state.length ? { state: state.map((file) => format('state', file)).join('\n\n') } : {}),
    ...(timeline.length ? { timeline: timeline.map((file) => format('timeline', file)).join('\n\n') } : {}),
    ...(foreshadow.length ? { foreshadow: foreshadow.map((file) => format('foreshadow', file)).join('\n\n') } : {}),
    contextFiles: Object.freeze(contextFiles),
    omittedContextFiles: Object.freeze(allSummaries.filter((file) => !chosen.includes(file)).map((file) => ({
      sourceId: 'previousChapterEnding', path: file.path, sourceHash: hash(file.content),
      modelVisibleChars: 0, estimatedTokens: 0,
      selectionReason: 'outside the twelve nearest/latest summary anchors; available through fixed-projection tools',
    }))),
  });
}

function volumeNumber(path: string): number | undefined {
  const value = /^summaries\/volume\/(\d+)\.md$/u.exec(path)?.[1];
  return value === undefined ? undefined : Number(value);
}

function chapterPosition(path: string): { volume: number; order: number } | undefined {
  const match = /^(?:chapters|summaries\/chapter)\/(\d+)\/(\d+)(?:[._/-]|$)/u.exec(path);
  return match ? { volume: Number(match[1]), order: Number(match[1]) * 1_000_000 + Number(match[2]) } : undefined;
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }
