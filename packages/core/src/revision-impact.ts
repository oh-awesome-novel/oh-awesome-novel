import { createHash } from 'node:crypto';
import { evaluateChapterEvidence } from './chapter-evidence-freshness.js';
import { evaluateAggregateSummaries } from './summary-evidence.js';
import { parseSummaryDocument } from './summary-document.js';
import type { RevisionImpactComparison, RevisionImpactItem, RevisionImpactKind } from './revision-impact-contract.js';

export interface RevisionImpactFrozenComparison extends RevisionImpactComparison {
  beforeText?: string; afterText?: string; identities: Array<{ namespace: string; id: string }>; names: string[];
}
export interface RevisionImpactReadEvidence { path: string; sourceHash?: string; generationId: string; targetPath?: string; location: string }
export function analyzeRevisionImpact(input: {
  comparisons: readonly RevisionImpactFrozenComparison[]; files: readonly { path: string; content: string }[]; complete: boolean; beforeComplete?: boolean;
  references: readonly { path: string; namespace: string; targetId: string; location: string }[];
  generations: readonly RevisionImpactReadEvidence[];
}) {
  const files = new Map(input.files.map(file => [file.path, file.content]));
  const afterChapters = evaluateChapterEvidence({ files: input.files }); const afterAggregate = evaluateAggregateSummaries({ files: input.files }, afterChapters);
  const beforeFiles = new Map(files); let beforeComplete = input.complete && input.beforeComplete !== false;
  for (const source of input.comparisons) {
    if (!source.beforeKnown || source.beforeHash !== null && source.beforeText === undefined) beforeComplete = false;
    if (source.beforeKnown && source.beforeHash === null) beforeFiles.delete(source.path);
    else if (source.beforeText !== undefined) beforeFiles.set(source.path, source.beforeText);
  }
  const before = [...beforeFiles].map(([path, content]) => ({ path, content }));
  const beforeChapters = beforeComplete ? evaluateChapterEvidence({ files: before }) : [];
  const beforeAggregate = beforeComplete ? evaluateAggregateSummaries({ files: before }, beforeChapters) : [];
  const buckets: Record<RevisionImpactKind, RevisionImpactItem[]> = { derived: [], reference: [], generationRead: [], mention: [] };
  const counts: Record<RevisionImpactKind, number> = { derived: 0, reference: 0, generationRead: 0, mention: 0 };
  const seen = new Set<string>(); const gaps = new Set<string>();
  const add = (item: Omit<RevisionImpactItem, 'id'>) => {
    const id = `impact-item-${digest(JSON.stringify([item.kind, item.sourcePath, item.path, item.location, item.generationId])).slice(0, 24)}`;
    if (seen.has(id)) return; seen.add(id); counts[item.kind]++;
    if (buckets[item.kind].length < 300) buckets[item.kind].push({ id, ...item, reason: clip(item.reason, 600), location: clip(item.location, 500), evidence: clip(item.evidence, 600) });
  };
  for (const source of input.comparisons.filter(source => source.change !== 'unchanged')) {
    // Without an old version the dependency is still registered, but nothing proves this edit touched it.
    const uncompared = source.change === 'unknown';
    const chapterId = /^chapters\/((?!0000)\d{4}\/(?!0000)\d{4})\.md$/u.exec(source.path)?.[1];
    if (chapterId) {
      const coverage = afterChapters.find(item => item.chapterId === chapterId);
      const old = beforeChapters.find(item => item.chapterId === chapterId);
      for (const key of ['summary', 'state'] as const) {
        const assessment = coverage?.[key];
        if (!assessment || assessment.status === 'missing') { gaps.add(`${source.path} 尚无可核验的${key === 'summary' ? '章摘要' : '章状态'}记录。`); continue; }
        if (!assessment.sourceHash) { gaps.add(`${assessment.path} 缺少可核验的章级来源证据。`); continue; }
        if (assessment.status === 'unverified') gaps.add(`${assessment.path} 的来源关系已登记，但目前无法验证内容。`);
        add({ kind: 'derived', sourcePath: source.path, path: assessment.path, reason: uncompared ? `该章级记录登记了正文来源；${UNCOMPARED}` : '该章级记录登记了正文来源；状态由现有 freshness evaluator 核对。',
          location: 'chapterRef / sourceHash', evidence: `正文来源 SHA-256: ${assessment.sourceHash}`, evidenceHash: digest(files.get(assessment.path)!),
          status: assessment.status, ...(old?.[key] ? { beforeStatus: old[key].status } : {}) });
      }
      for (const assessment of afterAggregate.filter(item => item.path === 'summaries/global.md' || item.path === `summaries/volume/${chapterId.slice(0, 4)}.md`)) {
        const content = files.get(assessment.path); if (content === undefined) continue;
        try {
          const parsed = parseSummaryDocument(content, assessment.path); if (!parsed) { gaps.add(`${assessment.path} 是未登记来源的作者文字。`); continue; }
          const previous = beforeAggregate.find(item => item.path === assessment.path);
          add({ kind: 'derived', sourcePath: source.path, path: assessment.path,
            reason: uncompared ? `摘要的覆盖范围包含该章节所在范围；${UNCOMPARED}` : input.complete ? '摘要的覆盖范围包含该章节所在范围；正文变化会传递到卷/全书来源核验。' : '摘要覆盖此范围，但扫描不完整，不能断言本次变化是否使其失效。',
            location: 'oan:summary:v1 / chapterIds / sourceFingerprint', evidence: `登记 ${parsed.document.chapterIds.length} 章；来源 fingerprint: ${parsed.document.sourceFingerprint}`,
            evidenceHash: digest(content), status: input.complete ? assessment.status : 'unverified', ...(previous ? { beforeStatus: previous.status } : {}) });
        } catch { gaps.add(`${assessment.path} 的受管来源区块不可验证。`); }
      }
    }
  }
  for (const source of input.comparisons.filter(source => source.change !== 'unchanged')) {
    const referenced = new Set<string>();
    for (const ref of input.references) {
      if (ref.path === source.path || !source.identities.some(identity => identity.namespace === ref.namespace && identity.id === ref.targetId)) continue;
      referenced.add(ref.path);
      add({ kind: 'reference', sourcePath: source.path, path: ref.path, reason: '已登记的对象引用指向这个对象；引用本身不证明剧情一定需要修改。',
        location: ref.location, evidence: `${ref.namespace} = ${ref.targetId}`, evidenceHash: digest(files.get(ref.path) ?? '') });
    }
    for (const read of input.generations.filter(read => read.path === source.path)) {
      add({ kind: 'generationRead', sourcePath: source.path, path: read.targetPath ?? source.path, reason: '这次生成读取过该来源；读取过不等于剧情必然受影响。',
        location: read.location, evidence: read.sourceHash ? `读取版本 SHA-256: ${read.sourceHash}${read.sourceHash === source.beforeHash ? '（与变更前相同）' : ''}` : '日志没有记录具体来源版本。',
        ...(read.sourceHash ? { evidenceHash: read.sourceHash } : {}), generationId: read.generationId, targetKnown: read.targetPath !== undefined });
    }
    for (const file of input.files) {
      if (file.path === source.path || referenced.has(file.path) || buckets.derived.some(item => item.sourcePath === source.path && item.path === file.path)) continue;
      const name = source.names.find(name => file.content.includes(name)); if (!name) continue;
      const start = file.content.indexOf(name); const line = file.content.slice(0, start).split('\n').length;
      add({ kind: 'mention', sourcePath: source.path, path: file.path, reason: `仅命中名称/词项「${name}」，可能是同名或无关表达，需作者判断。`,
        location: `line ${line}; UTF-16 ${start}–${start + name.length}`, line, evidence: file.content.slice(Math.max(0, start - 40), Math.min(file.content.length, start + name.length + 80)), evidenceHash: digest(file.content) });
    }
  }
  const items = [...buckets.derived, ...buckets.reference, ...buckets.generationRead, ...buckets.mention].slice(0, 300);
  return { items, counts, omittedItems: Object.values(counts).reduce((a, b) => a + b, 0) - items.length, gaps: [...gaps].slice(0, 40) };
}
const UNCOMPARED = '变更前版本无法比较，不能断言本次修改是否影响它；状态只反映当前文件，仅供人工复核。';
function digest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function clip(value: string, max: number): string { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
