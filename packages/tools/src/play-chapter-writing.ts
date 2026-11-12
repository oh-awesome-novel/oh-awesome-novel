import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizePlayChapterIntent, parsePlayChapterDraft, normalizePlayAdoptionBusinessTarget, readNextChapterTarget, validatePlayWritingReferenceAttachment } from '@oh-awesome-novel/core';
import type { PlayChapterWritingBinding } from '@oh-awesome-novel/core';
import { createWorkspaceProjection } from './workspace-projection';
import { CandidateChangeSetBuilder, finalizeDeterministicChangeProposal } from './deterministic-change-producers';
import { createWorkspaceChangePolicy } from './workspace-change-policy';
import type { RepositoryBaseline } from './candidate-change-set';
import type { PendingAction, PreparedChangePreviewV1 } from './pending-action-types';

export const PLAY_CHAPTER_WRITING_PRODUCER = 'play-chapter-writing';
export async function preparePlayChapterWritingInput(root: string, attachmentId: string, lens: 'player' | 'director', intentValue: unknown) {
  if (lens !== 'player' && lens !== 'director') throw new Error('请选择有效转写视角。');
  const intent = normalizePlayChapterIntent(intentValue);
  const reference = await validatePlayWritingReferenceAttachment(root, attachmentId);
  if (lens === 'player' && reference.items.some(item => item.visibility === 'playerUnknown')) throw new Error('参与者视角不能使用隐藏素材。');
  const target = await readNextChapterTarget(root);
  const volume = target.path.split('/')[1]!;
  const projection = await createWorkspaceProjection({ workspaceRoot: root, maxFileBytes: 128 * 1024, maxTotalBytes: 512 * 1024,
    rules: [
      { kind: 'prefix', path: '.oan/constitution' },
      ...['outline/main.md', `outline/volumes/${volume}.md`, 'world/rules.md', ...(target.previousPath ? [target.previousPath] : [])].map(path => ({ kind: 'exact' as const, path })),
    ],
  });
  if (projection.baselineFiles.length > 32) throw new Error('转写上下文文件过多，请先精简创作约束。');
  // Timestamps are not content evidence; same-byte touches do not invalidate a draft.
  const contextFingerprint = hash(projection.baselineFiles.map(file => ({ path: file.path, sha256: hashText(file.content), mode: file.mode })));
  const items = reference.items.map(item => ({ id: item.id, kind: item.kind, summary: item.summary }));
  const binding: PlayChapterWritingBinding = {
    attachmentId, reportFingerprint: reference.attachment.reportFingerprint, selectionHash: hash(items), lens,
    targetPath: target.path, chapterInventoryHash: target.inventoryHash, contextFingerprint, intent,
    contextFiles: projection.baselineFiles.map(file => ({ path: file.path, sourceHash: hashText(file.content) })),
  };
  return {
    binding, sessionId: reference.attachment.sessionId, items,
    range: { first: reference.attachment.selectedArtifactTurnRefs[0]!, last: reference.attachment.selectedArtifactTurnRefs.at(-1)!, turnCount: reference.attachment.selectedArtifactTurnRefs.length },
    context: projection.baselineFiles.map(file => ({ path: file.path, content: file.content, sourceHash: hashText(file.content) })),
  };
}

export function createPlayChapterWritingProposal(input: {
  source: Awaited<ReturnType<typeof preparePlayChapterWritingInput>>; draft: unknown; id: string; repository: RepositoryBaseline;
}) {
  const draft = parsePlayChapterDraft(input.draft, input.source.items.map(item => item.id));
  const binding = input.source.binding;
  const businessTarget = normalizePlayAdoptionBusinessTarget({ target: 'chapterDraft', payload: {
    chapterId: binding.targetPath.slice('chapters/'.length, -3), mode: 'create', title: draft.title,
    content: draft.paragraphs.map(paragraph => paragraph.text).join('\n\n'),
  } });
  if (businessTarget.target !== 'chapterDraft') throw new Error('转写目标必须是章节。');
  const content = businessTarget.content;
  const builder = new CandidateChangeSetBuilder({ sessionId: input.id, producer: PLAY_CHAPTER_WRITING_PRODUCER,
    capability: 'chapter.edit', repository: input.repository, baselineFiles: [] });
  builder.write(binding.targetPath, content);
  const origin = { kind: 'playChapterWriting' as const, ...binding };
  const proposal = finalizeDeterministicChangeProposal({ builder, origin, allowedTargets: [binding.targetPath],
    policy: createWorkspaceChangePolicy({ capability: 'chapter.edit', exactWritablePaths: [binding.targetPath], maxChangedFiles: 1 }) });
  if (!proposal) throw new Error('未生成章节内容。');
  return { ...proposal, draft };
}

/** Bound to live evidence at promotion and Accept, including after a restart. */
export async function assertPlayChapterWritingFresh(root: string, value: PendingAction | PreparedChangePreviewV1): Promise<void> {
  try {
    const origin = value.origin;
    const capability = value.kind === 'pending-action' ? value.source.capability : value.capability;
    if (origin?.kind !== 'playChapterWriting' || capability !== 'chapter.edit' || value.allowedTargets.length !== 1 || value.allowedTargets[0] !== origin.targetPath ||
      value.changes.length !== 1 || value.changes[0]!.path !== origin.targetPath || value.changes[0]!.operation !== 'create' ||
      value.kind === 'pending-action' && (value.source.kind !== 'deterministic-builder' || value.source.producer !== PLAY_CHAPTER_WRITING_PRODUCER)) throw new Error('转写候选范围不一致。');
    const current = await preparePlayChapterWritingInput(root, origin.attachmentId, origin.lens, origin.intent);
    const { kind: _kind, ...binding } = origin;
    if (!isDeepStrictEqual(current.binding, binding)) throw new Error('所选素材、章节槽位或小说上下文已变化。');
  } catch (error) {
    throw Object.assign(new Error(`转写提案已失效，请重新生成：${error instanceof Error ? error.message : String(error)}`), { code: 'STALE_PENDING_ACTION_BASELINE' });
  }
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function hashText(value: string): string { return createHash('sha256').update(value).digest('hex'); }
