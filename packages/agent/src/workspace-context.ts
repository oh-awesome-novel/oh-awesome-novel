import { createHash } from 'node:crypto';
import { evaluateChapterEvidence, formatChapterEvidenceCoverage } from '@oh-awesome-novel/core';
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
  const allState = select('state', ['.yaml', '.yml']);
  const coverage = evaluateChapterEvidence(projection);
  const bySummary = new Map(coverage.map((item) => [item.summary.path, item.summary]));
  const byState = new Map(coverage.map((item) => [item.state.path, item.state]));
  const selectedPaths = new Set(options.targetPaths ?? []);
  const selectedChapterIds = new Set((options.targetPaths ?? []).flatMap((path) => {
    const id = /^(?:chapters|summaries\/chapter|state\/chapters)\/(\d{4}\/\d{4})\.(?:md|ya?ml)$/u.exec(path)?.[1]; return id ? [id] : [];
  }));
  const selectedStatePaths = new Set(coverage.filter((item) => selectedChapterIds.has(item.chapterId)).map((item) => item.state.path));
  const state = allState.filter((file) => !file.path.startsWith('state/chapters/') || selectedPaths.has(file.path)
    || selectedStatePaths.has(file.path));
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
  const summaries = allSummaries.filter((file) => !bySummary.has(file.path) || bySummary.get(file.path)!.context !== undefined).toSorted((a, b) => {
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
  const payloadFor = (sourceId: string, root: string, file: File) => {
    if (sourceId === 'previousChapterEnding') {
      const evidence = bySummary.get(file.path);
      return `# ${file.path.slice(root.length + 1)}\n\n${evidence?.context ?? `Freshness: unverified author reference. This volume/global summary has no verified chapter source coverage; check source chapters before using it as current facts.\n\n${file.content}`}`;
    }
    if (sourceId === 'latestState' && file.path.startsWith('state/chapters/')) {
      const evidence = byState.get(file.path);
      if (selectedPaths.has(file.path)) return `${format(root, file)}\n\nExplicitly selected complete file. Freshness: ${evidence?.status ?? 'unverified'}; historical records and unverified author fields are not automatically current facts.`;
      return `# ${file.path.slice(root.length + 1)}\n\n${evidence?.context ?? `Freshness: ${evidence?.status ?? 'unverified'}. ${evidence?.reason ?? 'No supported chapter evidence metadata.'} This source is not current evidence; read it explicitly through the fixed projection if needed.`}`;
    }
    return root ? format(root, file) : file.content;
  };
  const describe = (sourceId: string, root: string, files: File[]) => {
    for (const file of files) {
      const payload = payloadFor(sourceId, root, file);
      contextFiles.push({ sourceId, path: file.path,
        sourceHash: hash(file.content), payloadHash: hash(payload), payload, originalChars: file.content.length,
        modelVisibleChars: payload.length, estimatedTokens: estimateContextTokens(payload),
        selectionReason: sourceId === 'previousChapterEnding'
          ? `${bySummary.get(file.path)?.status ?? 'unverified'} summary: current evidence only, or explicitly unverified author reference; historical snapshots omitted`
          : file.path.startsWith('state/chapters/') ? selectedPaths.has(file.path) ? 'explicitly selected complete chapter state file' : 'derived selected chapter current evidence and author fields; historical records omitted'
          : 'complete protected current source or continuity ledger from the fixed projection',
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
    ...(chosen.length ? { summaries: Object.freeze(chosen.map((file) => payloadFor('previousChapterEnding', 'summaries', file))) } : {}),
    ...(state.length ? { state: state.map((file) => payloadFor('latestState', 'state', file)).join('\n\n') } : {}),
    chapterEvidenceCoverage: formatChapterEvidenceCoverage(coverage, [...selectedChapterIds]),
    ...(timeline.length ? { timeline: timeline.map((file) => format('timeline', file)).join('\n\n') } : {}),
    ...(foreshadow.length ? { foreshadow: foreshadow.map((file) => format('foreshadow', file)).join('\n\n') } : {}),
    contextFiles: Object.freeze(contextFiles),
    omittedContextFiles: Object.freeze([...allSummaries.filter((file) => !chosen.includes(file)).map((file) => ({
      sourceId: 'previousChapterEnding', path: file.path, sourceHash: hash(file.content),
      modelVisibleChars: 0, estimatedTokens: 0,
      selectionReason: bySummary.get(file.path)?.context === undefined && bySummary.has(file.path)
        ? `${bySummary.get(file.path)!.status}: ${bySummary.get(file.path)!.reason} Available only through explicit fixed-projection reads.`
        : 'outside the twelve nearest/latest summary anchors; available through fixed-projection tools',
    })), ...allState.filter((file) => !state.includes(file)).map((file) => ({
      sourceId: 'latestState', path: file.path, sourceHash: hash(file.content), modelVisibleChars: 0, estimatedTokens: 0,
      selectionReason: 'unselected chapter evidence/history is not default current state; available through fixed-projection reads',
    }))]),
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
