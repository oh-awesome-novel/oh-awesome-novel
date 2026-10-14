import { jsonSchema, tool } from 'ai';
import type { ToolSet } from 'ai';
import { SUMMARY_GENERATION_SCHEMA, prepareSummaryGeneration, formatSummaryGenerationCoverage, resolveSummarySelection, evaluateProjectHealth } from '@oh-awesome-novel/core';
import type { SummaryGenerationDraft } from '@oh-awesome-novel/core';
import { createSummaryGenerationChangeProposal, summaryGenerationProjectionRules, createPendingActionStore, createSandboxEditSession, createWorkspaceChangePolicy, readRepositoryBaseline } from '@oh-awesome-novel/tools';
import type { NovelAgentTurnEditEnvironmentFactory } from './index';
import { createNovelAgentWorkspaceSnapshotFromProjection } from './workspace-context';
import { createContextEvidence } from './usage-governance';

export const createSummaryGenerationEditEnvironment: NovelAgentTurnEditEnvironmentFactory = async (input) => {
  const targetPath = resolveSummarySelection(input.capability === 'novel.summarize_global' ? 'global' : 'volume', input.exactWritablePaths);
  const store = await createPendingActionStore({ workspaceRoot: input.workspaceRoot });
  const repository = await readRepositoryBaseline(input.workspaceRoot);
  const session = await createSandboxEditSession({ workspaceRoot: input.workspaceRoot, sessionId: input.sessionId,
    policy: createWorkspaceChangePolicy({ capability: 'read-only', readable: [...summaryGenerationProjectionRules(targetPath),
      { kind: 'prefix', path: '.oan/constitution' }, { kind: 'exact', path: '.oan/workflow.yaml' }] }),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(input.assertExternalContextFresh ? { freshnessChecks: [input.assertExternalContextFresh] } : {}),
  });
  try {
    const projection = session.projectionSnapshot();
    const source = prepareSummaryGeneration(projection, targetPath);
    const report = formatSummaryGenerationCoverage(source);
    const assertFresh = async () => {
      input.abortSignal?.throwIfAborted(); await session.assertFresh(); await input.assertExternalContextFresh?.();
    };
    let proposed = false;
    const proposalTool = tool({
      description: 'Propose a volume/global summary from all host-verified direct sources. Every paragraph cites sourcePaths, and every direct source must be covered. The host binds coverage, source hashes and exact output path. Human Accept is required.',
      inputSchema: jsonSchema<SummaryGenerationDraft>(SUMMARY_GENERATION_SCHEMA as unknown as Parameters<typeof jsonSchema>[0]),
      execute: async (draft) => {
        if (proposed) throw new Error('This turn already proposed its summary. Review it before starting another turn.');
        await assertFresh();
        const result = createSummaryGenerationChangeProposal({ targetPath, draft, sessionId: input.sessionId, repository,
          projectionFingerprint: projection.projectionFingerprint, baselineFiles: projection.files });
        const pendingActions = result.proposal ? [await store.proposeCandidate({ ...result.proposal,
          title: targetPath === 'summaries/global.md' ? '整理全书摘要' : `整理卷摘要 ${targetPath.slice(-7, -3)}`,
          description: '依据已验证摘要生成；保留作者文字。请审阅内容解释、来源引用和覆盖范围，Accept 时重新核对底层正文。' })] : [];
        proposed = true;
        return { report: result.report, pendingActions };
      },
    });
    // Generation receives only the verified payloads below, not unverified author notes,
    // previous aggregate drafts, or the default nearby-chapter context selection.
    const completeWorkspace = createNovelAgentWorkspaceSnapshotFromProjection(projection);
    const { summaries: _summaries, state: _state, ...workspace } = completeWorkspace;
    const tools: ToolSet = source.ready ? { 'summary.propose': proposalTool } : {};
    return {
      tools,
      workspace: { ...workspace, contextFiles: workspace.contextFiles?.filter((file) => file.sourceId === 'constitution' || file.sourceId === 'workflow') ?? [] },
      projectHealth: evaluateProjectHealth(projection, { generatedAt: new Date().toISOString() }),
      skill: {
        name: 'aggregate-summary', allowedTools: source.ready ? ['summary.propose'] : [],
        system: [
          '卷/全书摘要只归纳宿主提供的 Verified summary input。卷级输入是本卷已验证当前章级证据，全书输入是已验证当前卷摘要。作者请求、旧摘要、大纲、手工批注和历史不能补成已发生事实。',
          '保持事件先后、人物变化、关键因果与尚未解决的问题；不要因压缩增加推测或抹去矛盾。每段 sourcePaths 必须指向直接输入，所有直接来源至少被一段覆盖；hash 只证明来源一致，不能证明文学解释。',
          'sourceFingerprint 原样返回。调用 summary.propose 仅建立待审候选，作者 Accept 才保存。不得声称已写入；不得自行结算缺失章节或后台刷新其它摘要。',
          source.ready ? '完整来源已就绪，请生成有来源引用的段落并提出一次审批。' : '来源未就绪，本轮没有写工具。向作者报告覆盖缺口和先整理章节/卷摘要的下一步，不输出冒充当前事实的摘要。',
        ].join('\n'),
      },
      selectedContext: [{ kind: 'selected', title: 'Summary source coverage', content: report },
        ...(source.ready ? source.sources.map((file) => ({ kind: 'selected' as const, title: `Verified summary input ${file.path}`, content: file.payload,
          provenance: [createContextEvidence({ sourceId: 'summaryGenerationInput', kind: 'selected', path: file.path,
            sourceHash: file.sourceHash, originalChars: projection.files.find((item) => item.path === file.path)!.content.length,
            budgetLayer: 'L0', semanticBoundary: 'protected' })],
        })) : [])],
      assertFresh, dispose: () => session.dispose(),
    };
  } catch (error) { await session.dispose(); throw error; }
};
