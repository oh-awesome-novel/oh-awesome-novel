# OAN Agent Writing Guide Implementation Spec

Status: Draft Spec

Source: `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`

Supplemental runtime gap spec:

- `docs/OAN_AGENT_WRITING_GUIDE_RUNTIME_GAP_SPEC.md`

## Goal

把参考笔记中的 agent 写作指引升级方向，转成 OAN 可实现、可测试、可分阶段交付的产品与工程规格。

本 Spec 的核心目标不是引入新的 agent 平台，而是让现有 `novel-copilot` 从“基础 prompt + quick commands”升级为一套可观察、可审阅、可恢复的长篇小说写作工作流：

```text
intake
  -> observe
  -> plan
  -> compose context package
  -> draft / review / settle
  -> verify
  -> PendingAction / session artifact / projection
```

## Non-Goals

- 不引入 LangChain、AutoGen、CrewAI、Semantic Kernel 或重型多 agent runtime。
- 不把 reference notes 中的参考项目实现代码、prompt 原文或 UI 文案复制进 OAN。
- 不把 `context-package`、`run log`、projection 或 Play transcript 变成小说事实源。
- 不让 `/写下一章` 默认承担卷级 gate、完整写作任务书或 `CBN / CPNs / CEN`。
- 不让 `/审稿` 隐式修改正文或隐式整理状态。
- 不绕过 PendingAction、diff、Human Approval 和 Git 历史边界。

## Existing Baseline

当前已存在：

- `packages/core/src/novel-copilot-skill.ts`
  - `observe -> plan -> draft/propose -> verify -> settle`
  - quick commands：`/生成角色卡`、`/规划下一章`、`/写下一章`、`/整理本章`、`/审稿`、`/更新状态`、`/补伏笔`、`/去AI味`
  - write-intent tools：`chapter.createDraft`、`summary.generateChapter`、`state.set`、`timeline.add`、`foreshadow.create`、`character.updatePersonality`
- `docs/NOVEL_AGENT_COPILOT_SPEC.md`
  - 当前 Copilot workflow 与 UI / approval 规格
- `docs/HUMAN_APPROVAL_AND_GIT.md`
  - PendingAction accept 后按配置 auto commit
- `docs/tasks/0900.md`
  - Reference Work Deconstruction / 参考作品拆解层
- `docs/IMPORT_TAVERN_COMPATIBLE_CHARACTER_CARD.md`
  - Tavern-compatible 角色卡导入规格

需要修正的当前问题：

- 当前内置 skill 把“审稿”也写成 settlement 触发点，后续应收紧为：纯 `/审稿` 只输出报告；只有用户要求整理、落库或按审稿结果更新状态时才进入 settlement。
- `/规划下一章` 还没有稳定本章契约。
- `/写下一章` 还没有短 `PRE_WRITE_CHECK`。
- 上下文读取还没有 `context-package`、source id、预算层级、omitted source 和 minimal-memory。
- `/整理本章` 还没有 observation log -> settlement bundle 的证据链。
- projection、session artifact、Play Mode 和 Tavern-compatible import 还没有进入可执行任务链。

## Canonical Concepts

### Capability

每个 agent 写作能力必须有稳定 capability id，用于 prompt provenance、session artifact 和测试。

建议第一批：

- `novel.plan_outline`
- `novel.plan_volume`
- `novel.plan_chapter`
- `novel.write_chapter`
- `novel.review_chapter`
- `novel.revise_chapter`
- `novel.settle_chapter`
- `novel.update_state`
- `novel.plan_foreshadow`
- `novel.de_ai`
- `novel.play_scene`
- `novel.import_tavern_character`
- `novel.deconstruct_reference`

Capability 不是 runtime plugin system。第一版可以是 core 中的类型、metadata map 和 prompt section。

### Context Package

`context-package` 是每轮 agent 写作的上下文解释产物，不是小说事实源。

字段建议：

```yaml
id: ctx-...
capability: novel.write_chapter
createdAt: 2026-06-19T00:00:00.000Z
selected:
  - sourceId: previousChapterEnding
    path: chapters/0001/0003.md
    reason: continue current arc
    budgetLayer: L1
    semanticBoundary: protected
omitted:
  - sourceId: distantWorldHistory
    reason: not causally relevant to current chapter
minimalMemory:
  characters: []
  hooks: []
  worldRules: []
ruleStack:
  - constitution
  - workflow
  - userRequest
  - chapterContract
```

第一版存储策略：

- 普通短任务可以只作为 assistant 可见摘要或 streamed artifact。
- 长任务、需要续跑的任务或用户显式保存时，写入 `.workspace/sessions/<session-id>/context-package.yaml`。
- 不写入 `state/`、`timeline/`、`foreshadow/`、`chapters/` 等事实域。

### Chapter Contract

本章契约是 `/规划下一章` 的输出，也是 `/写下一章` 的输入。

普通单章默认字段：

- chapter id / title candidate
- 当前任务
- POV
- 核心冲突或场景方向
- 关键出场角色与状态前置
- 涉及 hook：新增、推进、提及、回收、延后
- 章尾必须发生的改变
- 禁止事项

卷级 / 关键章增强字段：

- 冲突阶梯
- 信息差变化
- 8-12 个 key beats
- 卷级角色成长段
- 伏笔债和回收窗口
- `CBN / CPNs / CEN` 或类似结构化节点

### Pre-Write Check

`PRE_WRITE_CHECK` 是 `/写下一章` 前的短校准表，不写入章节正文。

字段：

- 本章契约对齐
- 上下文范围
- 当前锚点
- 待处理 hooks
- 暂不暴露的秘密、底牌和设定
- 风险扫描：OOC、信息越界、世界规则冲突、战力/资源异常、AI 味高危点
- 写入方式确认：只能通过 `chapter.createDraft` PendingAction

### Review Finding

`/审稿` 默认只读和报告。

Finding schema：

```yaml
severity: blocking | high | medium | low
category: continuity | character | world | plot | hook | pacing | style | evidence
location: chapters/0001/0003.md#...
evidence: "short quoted or paraphrased evidence"
issue: "what is wrong"
suggestedFix: "what to change"
needsUserDecision: true
blocking: true
```

Review 输出应包含 dimension pass：相关维度没有问题时也显式 pass，避免只输出负面问题。

### Observation Log And Settlement Bundle

`/整理本章` 或章节接受后的 settle 阶段先生成 observation log，再生成 settlement bundle。

Observation log 只记录正文证据支持的事实：

- 出场角色
- 位置、物品、资源、伤势、能力、身份变化
- 关系变化
- 情绪弧线变化
- 信息边界变化
- 时间推进
- 伏笔新增、提及、推进、回收、延后
- 世界观新硬事实

Settlement bundle：

- `fulfillment`
- `ambiguities`
- `observations`
- `patches`
- chapter summary
- state changes as diff：entity、field、oldValue、newValue、evidence、confidence
- timeline events
- foreshadow changes
- character card scoped updates
- next chapter handoff
- unresolved ambiguity

只有用户接受 PendingAction 后，Object File Tree 才成为事实源。

### Session Artifact

Session artifact 用于解释、恢复和复核 agent run。

第一版只要求长任务或需要续跑的任务记录：

- 关键输入 source
- 输出 artifact
- proposed patch list
- 时间
- 未决问题

不要求每个普通 agent turn 都生成完整 run log。

### Projection

Projection 是从事实源派生的作者可读 Markdown 或只读 index。

候选：

- `.oan/indexes/state.md`
- `.oan/indexes/foreshadow.md`
- `.oan/indexes/timeline.md`
- `.oan/indexes/progress.md`
- `.oan/indexes/context-snapshot.md`

Projection 可删除重建，不替代 `state/`、`timeline/`、`foreshadow/`、`summaries/`。

### Play Mode

Play Mode 是独立产品面，不只是写作前草稿。

边界：

- Play session 有自己的 transcript / play-local state。
- Play 读取角色卡、interaction hints、lorebook、世界规则、当前状态和起点。
- Play 结果默认不进入 canonical truth。
- Play observation 可以作为写作参考；只有用户确认后才生成章节草稿、状态、时间线或伏笔 PendingAction。
- 默认使用单一世界裁判 + 多角色 voice/state modules，不引入重型多 agent runtime。

## Implementation Task Split

| Task | Scope | Related Plan |
| --- | --- | --- |
| `1000` | Agent Writing Guide vNext Spec And Skill Contracts | `2026-06-19-agent-writing-guide-vnext-spec.md` |
| `1010` | Context Package And Source Discipline | `2026-06-19-context-package-source-discipline.md` |
| `1020` | Planning Commands And Prewrite Calibration | `2026-06-19-planning-and-prewrite-workflow.md` |
| `1030` | Review And Settlement Workflow | `2026-06-19-review-and-settlement-workflow.md` |
| `1040` | Session Artifacts And Author Reports | `2026-06-19-session-artifacts-author-reports.md` |
| `1050` | Projections And Project Health | `2026-06-19-projections-project-health.md` |
| `1060` | Play Mode And Tavern Character Import | `2026-06-19-play-mode-tavern-import.md` |
| `0900` | Reference Work Deconstruction | existing `docs/tasks/0900.md` |

## Dependency Order

```text
1000 Spec / skill contract
    ↓
1010 context package + source discipline
    ↓
1020 planning commands + prewrite calibration
    ↓
1030 review + settlement
    ↓
1040 session artifacts + author report
    ↓
1050 projections + project health

1060 Play Mode can start after 1010 and the Tavern import spec are stable.
0900 Reference Deconstruction can proceed in parallel after 1010 defines reference source metadata.
```

## Acceptance Matrix

| Area | Must Be True |
| --- | --- |
| Prompt behavior | `novel-copilot` distinguishes planning, writing, review, settle, Play and reference use |
| Context | Every writing action can explain selected and omitted sources |
| Planning | `/规划下一章` emits light chapter contract; `/规划下一卷` and `/规划大纲` hold heavier structure |
| Drafting | `/写下一章` emits short `PRE_WRITE_CHECK` before `chapter.createDraft` |
| Review | `/审稿` reports findings and does not implicitly settle or rewrite |
| Settlement | `/整理本章` uses evidence-only observation log before PendingAction bundle |
| Session | Long tasks write resumable artifacts under `.workspace` or session area |
| Projection | Derived Markdown views can be rebuilt and do not become truth |
| Play | Play sessions remain separate from canonical truth until user accepts adoption |
| Human Approval | No task bypasses PendingAction / diff / Human Approval |
