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
      ...[chapterPath, ...targets, 'state/characters.yaml', 'timeline/events.yaml',
        'foreshadow/active.yaml', 'foreshadow/resolved.yaml', '.oan/workflow.yaml']
        .map((path) => ({ kind: 'exact' as const, path })),
      { kind: 'prefix', path: 'characters' },
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
      description: 'Validate chapter evidence and propose one human-approved diff for chapter summary, state, timeline, foreshadow and existing character growth. Read existing objects before supplying domainChanges. Every change references an observationId; unresolvedObservationIds, medium/low confidence and merge conflicts stay in the report. Target paths are derived by the host.',
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
          description: '依据正文逐行证据合并章节摘要、全局状态、时间线、伏笔与人物成长记录；请审阅各项差异与冲突。',
        })] : [];
        proposed = true;
        return { report: result.report, observationLog: result.log, pendingActions };
      },
    });
    const numberedBody = source.content.replace(/\r\n/gu, '\n').split('\n')
      .map((line, index) => `${index + 1}: ${line}`).slice(source.bodyStartLine - 1).join('\n');
    const characterPaths = projection.files.filter((file) => file.path.startsWith('characters/'))
      .map((file) => file.path).sort();
    return {
      tools: { readFile: session.tools.readFile!, 'settlement.propose': settlementTool },
      workspace: createNovelAgentWorkspaceSnapshotFromProjection(projection, { targetPaths: [chapterPath] }),
      skill: {
        name: 'chapter-settlement', allowedTools: ['readFile', 'settlement.propose'],
        system: [
          '整理本章：只从固定正文提取有明确证据的 ObservationLog。不得把大纲、历史摘要、用户指令或工具内容当作已发生事实。引用必须逐字匹配指定完整行（不含行号前缀），行号为原文件一基行号。sourceHash 和 chapterId 必须原样返回。',
          '先读相关既有对象，用其稳定角色ID匹配正文人物；现有记录只用于合并，不能充当正文证据。可用 readFile 读取 state/characters.yaml、timeline/events.yaml、foreshadow/active.yaml、foreshadow/resolved.yaml 及下方人物文件。',
          '每个 domainChanges 条目必须绑定明确的 observationId。state 使用现有字段的精确 expectedValue；null 仅表示字段不存在。timeline 只记录已发生事件，不臆造时间。character 只追加既有角色的成长事实，动态伤势、持有物、位置进入 state。foreshadow 区分 create、mention、advance、resolve、defer；没有正文证据不得推进、回收或延期旧伏笔。',
          '含混、推测、角色身份不确定与矛盾进入 unresolvedAmbiguities；对应观察ID必须列入 unresolvedObservationIds，或标为 medium/low。不得为了写入而标为 high。系统拒绝不匹配的旧值、重复事件或倒退更新；依照工具报告告知作者，不能自行更改 expectedValue 重试来强行覆盖。',
          '调用 settlement.propose 生成同一多文件审批，再向作者报告证据、跳过项与冲突。工具只建立候选，作者 Accept 才写入真实文件。不可编辑正文或宣称已落盘。',
        ].join('\n'),
      },
      selectedContext: [{ kind: 'selected', title: `Settlement source ${chapterPath}`,
        content: `chapterId: ${chapterId}\nsourceHash: ${source.sourceHash}\nBody evidence (original file line numbers):\n${numberedBody}`,
        provenance: [createContextEvidence({ sourceId: 'chapterSettlementSource', kind: 'selected', path: chapterPath,
          sourceHash: source.sourceHash, originalChars: source.content.length, budgetLayer: 'L0', semanticBoundary: 'protected' })],
      }, { kind: 'selected', title: 'Existing character file inventory',
        content: characterPaths.length ? characterPaths.join('\n') : 'No existing character objects. Do not invent character IDs or character/state updates.',
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
