import { createHash } from 'node:crypto';
import { evaluateChapterEvidence } from './chapter-evidence-freshness.js';
import type { ChapterEvidenceAssessment, ChapterEvidenceCoverage, FrozenWorkspaceSnapshot } from './chapter-evidence-freshness.js';
import { assertSummaryTargetPath, parseSummaryDocument, renderSummaryParagraphs, SUMMARY_LIMITS } from './summary-document.js';
import type { SummarySourceReference } from './summary-document.js';

export interface SummaryInput extends SummarySourceReference { readonly payload: string }
export interface SummaryGenerationSource {
  readonly targetPath: string;
  readonly chapterIds: readonly string[];
  readonly sources: readonly SummaryInput[];
  readonly verifiedSourceCount: number;
  readonly sourceFingerprint: string;
  readonly ready: boolean;
  readonly problems: readonly { readonly path: string; readonly status: string; readonly reason: string }[];
}
export interface AggregateSummaryAssessment extends ChapterEvidenceAssessment { readonly sourceFingerprint?: string }

const CHAPTER = /^chapters\/((?!0000)\d{4}\/(?!0000)\d{4})\.md$/u;
const VOLUME = /^summaries\/volume\/((?!0000)\d{4})\.md$/u;

/** Evaluates all levels from one immutable snapshot; never re-reads host files. */
export function evaluateAggregateSummaries(snapshot: FrozenWorkspaceSnapshot, chapterCoverage = evaluateChapterEvidence(snapshot)): readonly AggregateSummaryAssessment[] {
  const evaluator = createEvaluator(snapshot, chapterCoverage);
  const volumePaths = new Set([...evaluator.chapterIds.map((id) => `summaries/volume/${id.slice(0, 4)}.md`),
    ...snapshot.files.map((file) => file.path).filter((path) => VOLUME.test(path))]);
  return Object.freeze([...volumePaths].sort().map((path) => evaluator.assess(path)).concat(evaluator.assess('summaries/global.md')));
}

export function prepareSummaryGeneration(snapshot: FrozenWorkspaceSnapshot, targetPath: string): SummaryGenerationSource {
  assertSummaryTargetPath(targetPath);
  const source = createEvaluator(snapshot, evaluateChapterEvidence(snapshot)).source(targetPath);
  const existing = snapshot.files.find((file) => file.path === targetPath)?.content;
  if (existing !== undefined) {
    try { parseSummaryDocument(existing, targetPath); } catch {
      return Object.freeze({ ...source, ready: false, problems: Object.freeze([Object.freeze({
        path: targetPath, status: 'target-invalid', reason: '目标摘要无法安全更新。请检查受管区块、frontmatter 身份或文件大小；系统不会覆盖损坏内容。',
      }), ...source.problems]) });
    }
  }
  return source;
}

export function formatSummaryGenerationCoverage(source: SummaryGenerationSource): string {
  return [
    `摘要目标：${source.targetPath}`,
    `覆盖正文：${source.chapterIds.length} 章；已验证直接来源：${source.verifiedSourceCount}；缺口：${source.problems.length}。`,
    `Source fingerprint: ${source.sourceFingerprint}`,
    source.ready ? '所有范围内来源均为 current；摘要解释仍需作者审阅。' : '未生成候选。请按下方诊断处理来源、目标或输入限额后重试；不会自动补写来源或覆盖损坏目标。',
    ...source.problems.slice(0, 12).map((problem) => `${problem.path}: ${problem.status} — ${problem.reason}`),
    ...(source.problems.length > 12 ? [`另有 ${source.problems.length - 12} 项缺口未在此有界报告展开。`] : []),
  ].join('\n');
}

export function formatAggregateSummaryCoverage(assessments: readonly AggregateSummaryAssessment[]): string {
  const counts = ['current', 'stale', 'missing', 'unverified'].map((status) => `${status}=${assessments.filter((item) => item.status === status).length}`).join(', ');
  const ordered = [...assessments].sort((a, b) => Number(b.path === 'summaries/global.md') - Number(a.path === 'summaries/global.md') || a.path.localeCompare(b.path));
  return ['Volume/global summary coverage (derived; no automatic canonical edits).', counts,
    ...ordered.slice(0, 12).map((item) => `${item.path}: ${item.status}.`),
    ...(ordered.length > 12 ? [`${ordered.length - 12} other summary statuses omitted.`] : [])].join('\n');
}

function createEvaluator(snapshot: FrozenWorkspaceSnapshot, chapterCoverage: readonly ChapterEvidenceCoverage[]) {
  const files = new Map(snapshot.files.map((file) => [file.path, file.content]));
  if (files.size !== snapshot.files.length) throw new Error('Summary snapshot contains duplicate paths.');
  const chapterIds = [...files.keys()].flatMap((path) => { const id = CHAPTER.exec(path)?.[1]; return id ? [id] : []; }).sort();
  const byChapter = new Map(chapterCoverage.map((item) => [item.chapterId, item.summary]));
  const assessments = new Map<string, AggregateSummaryAssessment>();
  const packages = new Map<string, SummaryGenerationSource>();
  const hashes = new Map<string, string>();
  const fileHash = (path: string) => {
    const content = files.get(path); if (content === undefined) return null;
    let digest = hashes.get(path); if (!digest) { digest = hash(content); hashes.set(path, digest); } return digest;
  };
  function source(targetPath: string): SummaryGenerationSource {
    const cached = packages.get(targetPath); if (cached) return cached;
    const volume = VOLUME.exec(targetPath)?.[1];
    const covered = volume ? chapterIds.filter((id) => id.startsWith(`${volume}/`)) : chapterIds;
    const directPaths = volume ? covered.map((id) => `summaries/chapter/${id}.md`)
      : [...new Set(covered.map((id) => `summaries/volume/${id.slice(0, 4)}.md`))];
    // Include absent .yaml/.yml alternatives and all raw chapter dependencies, even for
    // global summaries whose direct input volume files have not yet been regenerated.
    const dependencyPaths = new Set([...covered.flatMap((id) => [`chapters/${id}.md`, `summaries/chapter/${id}.md`, `state/chapters/${id}.yaml`, `state/chapters/${id}.yml`]), ...directPaths]);
    const sourceFingerprint = hash(JSON.stringify({ targetPath, chapterIds: covered,
      files: [...dependencyPaths].sort().map((path) => [path, fileHash(path)]) }));
    const sources: SummaryInput[] = []; const problems: Array<{ path: string; status: string; reason: string }> = [];
    let verifiedSourceCount = 0; let inputBytes = 2;
    let overLimit = covered.length > SUMMARY_LIMITS.chapters || directPaths.length > SUMMARY_LIMITS.sources;
    for (const path of directPaths) {
      const evidence = volume ? byChapter.get(path.slice('summaries/chapter/'.length, -3))! : assess(path);
      if (evidence.status !== 'current' || evidence.verifiedContent === undefined) {
        problems.push({ path, status: evidence.status, reason: evidence.reason }); continue;
      }
      const input = Object.freeze({ path, sourceHash: fileHash(path)!, payloadHash: hash(evidence.verifiedContent), payload: evidence.verifiedContent });
      inputBytes += Buffer.byteLength(JSON.stringify(input)) + (verifiedSourceCount++ ? 1 : 0);
      overLimit ||= inputBytes > SUMMARY_LIMITS.inputBytes;
      // Keep counting/validating coverage, but never retain a partial oversized payload.
      if (overLimit) sources.length = 0;
      else sources.push(input);
    }
    if (!covered.length) problems.push({ path: targetPath, status: 'missing', reason: '范围内没有正文章节；0000.md 卷信息不计入正文。' });
    if (overLimit) {
      problems.push({ path: targetPath, status: 'limit', reason: `摘要输入超出 4096 章 / 1024 来源 / 256 KiB 限额，不会静默截断。${volume
        ? '本卷固定覆盖全部正文；可按创作结构拆卷，或精简观察后重新整理并接受章摘要。'
        : '全书固定覆盖全部正文，不能选择卷子集；请用更简短的段落重新整理并接受各卷摘要。'}` });
    }
    const result = Object.freeze({ targetPath, chapterIds: Object.freeze([...covered]), sources: Object.freeze(sources), verifiedSourceCount, sourceFingerprint,
      ready: problems.length === 0, problems: Object.freeze(problems.map((problem) => Object.freeze(problem))) });
    packages.set(targetPath, result); return result;
  }
  function assess(path: string): AggregateSummaryAssessment {
    const cached = assessments.get(path); if (cached) return cached;
    const content = files.get(path);
    let result: AggregateSummaryAssessment;
    if (content === undefined) result = { path, status: 'missing', reason: 'No volume/global summary file.' };
    else {
      try {
        const parsed = parseSummaryDocument(content, path);
        if (!parsed) result = { path, status: 'unverified', reason: 'Author summary has no verified chapter source coverage.',
          context: `Freshness: unverified author reference. No verified chapter source coverage; check source chapters before using this as current facts.\n\n${content}` };
        else {
          const inputs = source(path); const document = parsed.document;
          const currentRefs = inputs.sources.map(({ path, sourceHash, payloadHash }) => ({ path, sourceHash, payloadHash }));
          if (document.sourceFingerprint !== inputs.sourceFingerprint || JSON.stringify(document.chapterIds) !== JSON.stringify(inputs.chapterIds)) {
            result = { path, status: 'stale', reason: 'Chapter inventory or transitive source bytes changed; regenerate from current evidence.', sourceFingerprint: document.sourceFingerprint };
          } else if (!inputs.ready || JSON.stringify(document.sources) !== JSON.stringify(currentRefs)) {
            result = { path, status: 'unverified', reason: 'Direct or transitive source evidence cannot verify this summary.' };
          } else {
            // The canonical file retains every citation. Carry only verified prose to
            // the next layer/default context so the full leaf inventory is not repeated.
            const verifiedContent = document.paragraphs.map((paragraph) => paragraph.text).join('\n\n');
            const renderedContent = renderSummaryParagraphs(document.paragraphs, { includeSourceReferences: false });
            result = { path, status: 'current', reason: 'Complete chapter inventory and transitive source hashes match verified current inputs.', sourceFingerprint: document.sourceFingerprint,
              verifiedContent, context: `Freshness: current summary; ${document.chapterIds.length} chapters covered. Hashes verify provenance, not literary interpretation. Full source citations remain in the canonical file; this is a derived prose view.\n\n${renderedContent}${parsed.authorContent.trim() ? `\n\nAuthor text (unverified reference; not covered by the evidence check):\n${parsed.authorContent.trim()}` : ''}` };
          }
        }
      } catch {
        result = { path, status: 'unverified', reason: 'Missing, edited, contradictory or unsupported managed summary metadata.' };
      }
    }
    result = Object.freeze(result); assessments.set(path, result); return result;
  }
  return { source, assess, chapterIds };
}
function hash(content: string): string { return createHash('sha256').update(content).digest('hex'); }
