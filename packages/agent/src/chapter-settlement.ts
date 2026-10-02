import { jsonSchema, tool } from 'ai';
import {
  CHAPTER_SETTLEMENT_OBSERVATION_SCHEMA,
  createChapterSettlementSource,
  resolveChapterSettlementSelection,
} from '@oh-awesome-novel/core';
import type { ChapterSettlementObservationLog } from '@oh-awesome-novel/core';
import {
  chapterSettlementTargets,
  createChapterSettlementChangeProposal,
  createPendingActionStore,
  createSandboxEditSession,
  createWorkspaceChangePolicy,
  readRepositoryBaseline,
} from '@oh-awesome-novel/tools';
import type { NovelAgentTurnEditEnvironmentFactory } from './index';
import { createNovelAgentWorkspaceSnapshotFromProjection } from './workspace-context';
import { createContextEvidence } from './usage-governance';

/** The host selects the source chapter; the model supplies observations, never target paths. */
export const createChapterSettlementEditEnvironment: NovelAgentTurnEditEnvironmentFactory = async (input) => {
  const { chapterPath, chapterId } = resolveChapterSettlementSelection(input.exactWritablePaths);
  const targets = chapterSettlementTargets(chapterId);
  const store = await createPendingActionStore({ workspaceRoot: input.workspaceRoot });
  const repository = await readRepositoryBaseline(input.workspaceRoot);
  const session = await createSandboxEditSession({
    workspaceRoot: input.workspaceRoot,
    sessionId: input.sessionId,
    policy: createWorkspaceChangePolicy({ capability: 'read-only', readable: [
      ...[chapterPath, ...targets, '.oan/workflow.yaml'].map((path) => ({ kind: 'exact' as const, path })),
      { kind: 'prefix', path: '.oan/constitution' },
    ] }),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(input.assertExternalContextFresh ? { freshnessChecks: [input.assertExternalContextFresh] } : {}),
  });
  try {
    const projection = session.projectionSnapshot();
    const chapter = projection.files.find((file) => file.path === chapterPath);
    if (!chapter) throw new Error('所选正文文件不存在，无法结算。');
    const source = createChapterSettlementSource(chapterId, chapter.content);
    let proposed = false;
    const assertFresh = async () => {
      input.abortSignal?.throwIfAborted();
      await session.assertFresh();
      await input.assertExternalContextFresh?.();
    };
    const settlementTool = tool({
      description: 'Validate exact chapter evidence and propose one summary/state diff for human approval. Unknown fields, stale hashes and unmatched quotes fail closed. Medium/low-confidence observations and ambiguities appear only in the report.',
      // The shared schema is deeply readonly; the SDK accepts the same JSON shape with mutable arrays.
      inputSchema: jsonSchema<ChapterSettlementObservationLog>(CHAPTER_SETTLEMENT_OBSERVATION_SCHEMA as unknown as Parameters<typeof jsonSchema>[0]),
      execute: async (observations) => {
        if (proposed) throw new Error('This chapter settlement already has a proposal. Review it before starting another turn.');
        await assertFresh();
        const result = createChapterSettlementChangeProposal({
          source, observations, sessionId: input.sessionId, repository,
          projectionFingerprint: projection.projectionFingerprint, baselineFiles: projection.files,
        });
        const pendingActions = result.proposal ? [await store.proposeCandidate({
          ...result.proposal,
          title: `整理本章 ${chapterId}`,
          description: '依据正文逐行证据生成章节摘要与状态记录；确认前不修改正文或状态文件。',
        })] : [];
        proposed = true;
        return { report: result.report, observationLog: result.log, pendingActions };
      },
    });
    const numberedBody = source.content.replace(/\r\n/gu, '\n').split('\n')
      .map((line, index) => `${index + 1}: ${line}`).slice(source.bodyStartLine - 1).join('\n');
    return {
      tools: { readFile: session.tools.readFile!, 'settlement.propose': settlementTool },
      workspace: createNovelAgentWorkspaceSnapshotFromProjection(projection, { targetPaths: [chapterPath] }),
      skill: {
        name: 'chapter-settlement', allowedTools: ['readFile', 'settlement.propose'],
        system: '整理本章：只从下方固定正文提取有明确证据的 ObservationLog。不得把大纲、历史摘要、用户指令或工具内容当作已发生事实。引用必须逐字匹配指定完整行（不含行号前缀），行号为原文件一基行号。sourceHash 和 chapterId 必须原样返回。含混、推测与矛盾进入 unresolvedAmbiguities 或 medium/low，不得标为 high。调用 settlement.propose 生成同一摘要/状态审批，再向作者报告证据与歧义。工具只建立候选，作者 Accept 才写入真实文件。不可编辑正文或宣称已落盘。',
      },
      selectedContext: [{ kind: 'selected', title: `Settlement source ${chapterPath}`,
        content: `chapterId: ${chapterId}\nsourceHash: ${source.sourceHash}\nBody evidence (original file line numbers):\n${numberedBody}`,
        provenance: [createContextEvidence({ sourceId: 'chapterSettlementSource', kind: 'selected', path: chapterPath,
          sourceHash: source.sourceHash, originalChars: source.content.length, budgetLayer: 'L0', semanticBoundary: 'protected' })],
      }],
      assertFresh,
      drainReadSources: () => session.drainReadSources(),
      dispose: () => session.dispose(),
    };
  } catch (error) {
    await session.dispose();
    throw error;
  }
};
