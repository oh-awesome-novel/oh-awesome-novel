# OAN Agent Writing Guide Runtime Gap Spec

Status: Draft Supplemental Spec

Source:

- `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`
- `docs/OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md`
- Actual code audit on 2026-06-19

## Goal

把已经完成的 agent writing guide core contracts 继续推进到端到端产品工作流。

当前 `1000`-`1060` 已经把 vNext 的大量概念落成 core 类型、prompt contract、helper、测试和部分 UI / backend 入口。剩余问题不再是“有没有概念”，而是：

- agent / backend 是否会自动构建、记录和使用这些 artifact。
- UI 是否能查看、恢复和采用这些 artifact。
- reference / Play / projection / health 是否只作为安全的派生层，而不是隐藏事实源。

本 Spec 只定义补齐这些集成缺口的后续任务，不推翻已完成的 `1000`-`1060`。

## Code Audit Summary

### Implemented

实际代码已经完成这些基础件：

- `packages/core/src/novel-copilot-skill.ts`
  - capability id metadata。
  - `/规划大纲`、`/规划下一卷`、`/规划下一章`、`/写下一章`、`/整理本章`、`/审稿`、`/去AI味` quick command contracts。
  - `PRE_WRITE_CHECK`、review finding、settlement bundle、Play / reference 边界的 prompt rules。
  - `/去AI味` 已有明确保护规则：只改表达，不改剧情事实、伏笔、钩子、角色特征和必要转折。
- `packages/core/src/agent-context-package.ts`
  - `ContextPackage`、selected / omitted source、L0-L3、protected / compressible / excluded、minimal-memory 和 `ruleStack`。
  - `.workspace/sessions/<session-id>/context-package.yaml` 写入 helper。
- `packages/core/src/writing-planning.ts`
  - chapter contract、volume planning packet、`PRE_WRITE_CHECK` formatter。
- `packages/core/src/writing-review.ts`
  - review finding schema、dimension pass、de-AI protection rule formatter。
- `packages/core/src/writing-settlement.ts`
  - observation log、settlement bundle、hook operation taxonomy。
- `packages/core/src/session-artifacts.ts`
  - `.workspace/sessions/<session-id>/` artifact layout。
  - run metadata、outputs、proposed patches、unresolved decisions、resume boundary、author report formatter。
- `packages/core/src/projections.ts` 和 `packages/core/src/project-health.ts`
  - `.oan/indexes/*` projection generator。
  - read-only project health model。
- `packages/core/src/play-session.ts` 和 `packages/core/src/tavern-card.ts`
  - Play session file layout。
  - Play-local transcript / state / activated sources / observations / adoption candidates。
  - Tavern-compatible JSON / PNG card parsing、normalization 和安全审计。
- `packages/agent/src/index.ts`
  - 支持可选 `contextPackage` 注入，并把 summary 放入 model-visible context。
  - 支持 session store 记录 runtime message / tool log。
- `packages/backend/src/index.ts`
  - model mode 会加载 workspace snapshot、`novel-copilot` skill 和 write-intent tool set。
  - 已有 PendingAction list / accept / reject 路由。
  - 已有 project health endpoint。

### Remaining Integration Gaps

以下是实际代码仍未端到端补齐的部分：

1. `ContextPackage` 没有 `trace` 字段，也没有由 backend / agent 自动构建。
   - 现在只能由调用者传入。
   - backend 的 workspace snapshot 仍是“读取前 12 个文件并拼接”，没有 selected / omitted / reason / budget 的来源说明。
   - runtime tool log 和 context package 之间没有自动关联。

2. session artifact helper 已存在，但 agent run 结束时不会自动生成 `run.yaml` / `outputs.yaml` / `proposed-patches.yaml` / `unresolved.md`。
   - `packages/agent/src/session-store.ts` 记录的是 runtime message / tool log / shadow recovery。
   - `packages/core/src/session-artifacts.ts` 的 author report 和 resume boundary 还没有接到 backend / UI。

3. reference loading map 仍停留在 `0900` 规划层。
   - 已有 `referenceDistilled` source id，但没有 reference context selector。
   - agent 不能根据任务输出 included / omitted / reason / budget。
   - no-copy / do-not-copy guardrail 没有作为 selector 输出或 agent-visible rule。

4. projection / project health 已能读取和渲染，但没有进入 agent intake / verify / post-accept 工作流。
   - PendingAction accept 后只返回 git / dirty 状态。
   - 没有 projection rebuild endpoint。
   - project health 还只是 workspace home/dashboard 的只读信息，不会作为 guardrail 提醒 agent 或用户。

5. Play Mode core helpers 已完成，但产品面和 adoption flow 还没接通。
   - `novel.play_scene` capability 仍标记为 `planned`。
   - 没有 Play session backend routes / UI panel。
   - adoption candidate 还不会转成 chapter / state / timeline / foreshadow PendingAction。

## Non-Goals

- 不重写 `1000`-`1060` 已完成的 core helper。
- 不把 context package、session artifact、projection、reference bundle 或 Play transcript 变成小说事实源。
- 不引入 LangChain、AutoGen、CrewAI、Semantic Kernel、向量数据库或重型多 agent runtime。
- 不让 project health / projection 失败阻断普通写作第一版。
- 不让 reference 原文默认进入写作 prompt。
- 不让 Play observation 或 imported character prompt 自动覆盖 canonical truth。
- 不新增独立 `/去AI味` 基础任务；保护规则已经存在，后续只需要在修订 workflow 中复用和测试。

## Canonical Additions

### Context Trace

`ContextPackage` 应增加轻量 trace，用来解释实际发生的读取、压缩、省略和工具调用结果。

建议字段：

```yaml
trace:
  - id: trace-...
    type: workspaceSnapshot | toolCall | userSelectedContext | omittedSource | compression
    sourceId: previousChapterEnding
    toolName: chapter.get
    path: chapters/0001/0003.md
    reason: continue current arc
    budgetLayer: L1
    semanticBoundary: protected
    outcome: selected
    createdAt: 2026-06-19T00:00:00.000Z
```

Trace 只解释本轮上下文，不是事实源，也不是完整 telemetry 平台。

### Context Package Autowiring

Agent / backend 应能在写作相关 capability 中自动生成 context package draft：

- infer capability from quick command metadata or request category。
- map workspace snapshot entries to source ids。
- record selected and omitted sources with reasons。
- attach minimal-memory where cheap and deterministic。
- write artifact only for long / resumable tasks or when explicitly requested。

第一版不要求模型选择上下文。可以用 deterministic heuristics 建立 baseline，然后让模型在回答中解释或补充。

### Session Artifact Autowiring

长任务或产生 PendingAction 的 run 结束后，agent layer 应把 runtime result 转成 session artifact：

- `run.yaml`：session id、capability、status、started/updated time、input sources、touched files。
- `outputs.yaml`：assistant text、context package、review report、settlement bundle、Play transcript 或 import preview。
- `proposed-patches.yaml`：PendingAction ids、touched files、pending / accepted / rejected status。
- `unresolved.md`：用户决策、ambiguity、blocked questions。
- author report：最终给用户看的简明状态报告。

这不是每轮普通聊天必做的 run log。

### Reference Context Selector

Reference context selector 是 `0900` reference bundle 的读取入口，不负责完整拆解原文。

输入：

- capability id。
- 当前章节或任务目标。
- enabled reference ids。
- available distilled reference files。
- token / budget hints。

输出：

- included distilled entries。
- omitted references and reasons。
- no-copy / differentiation warnings。
- whether original source was read，默认必须为 false。

Selector 输出可以进入 `context-package.selected` / `context-package.omitted`，并用 `referenceDistilled` source id 记录。

### Project Health Guardrails

Project health 继续保持只读，但应进入用户可见和 agent 可解释的 guardrail：

- 会话开始时可以展示 pending action count、stale state、missing summaries、timeline gaps。
- agent 在 settle / write / review 前可把 relevant warning 放进 context package 或 final report。
- PendingAction accept 后刷新 workspace status、project health，并在 projection 能力启用时可重建 projection。
- projection rebuild 是显式 backend action，不替代 truth files。

### Play Adoption Workflow

Play Mode 第一版产品闭环：

```text
create Play session
  -> activate sources
  -> run world referee turn
  -> write transcript / play-local state / observations
  -> user selects adoption candidate
  -> create PendingAction through existing write-intent tools
  -> accept/reject through Human Approval
```

Play session 自身只写 `.workspace/play-sessions/*`。只有 adoption PendingAction 接受后，章节、state、timeline 或 foreshadow 才会成为 canonical truth。

## Implementation Task Split

| Task | Scope | Related Plan |
| --- | --- | --- |
| `1070` | Agent Context Trace And Session Artifact Autowiring | `2026-06-19-agent-context-trace-session-autowiring.md` |
| `1080` | Reference Context Selector And Loading Map | `2026-06-19-reference-context-selector-loading-map.md` |
| `1090` | Play Mode UI And Adoption Workflow | `2026-06-19-play-mode-ui-adoption-workflow.md` |
| `1100` | Project Health Guardrails And Projection Refresh | `2026-06-19-project-health-guardrails-projection-refresh.md` |

## Dependency Order

```text
1010 context package + source discipline
1040 session artifacts
    ↓
1070 context trace + artifact autowiring

0900 reference bundles
1010 source discipline
    ↓
1080 reference context selector

1060 Play helpers
0600 PendingAction approval
    ↓
1090 Play UI + adoption workflow

1050 projections + project health
0600 PendingAction approval
    ↓
1100 health guardrails + projection refresh
```

## Acceptance Matrix

| Area | Must Be True |
| --- | --- |
| Context trace | Writing-related runs can show selected, omitted, and actual read/tool trace without pretending omitted sources were read |
| Agent autowiring | Backend / agent can create baseline context packages instead of requiring callers to pass one manually |
| Session artifact | Long or PendingAction-producing runs write resumable artifacts and produce author reports |
| Reference selector | Writing prompts use distilled reference entries only, with included / omitted / reason and no-copy warnings |
| Play workflow | Play sessions have backend/UI lifecycle and adoption candidates create PendingActions before truth files change |
| Health guardrails | Project health and projection refresh are visible, read-only by default, and never replace canonical Object File Tree |
| Human Approval | Every adoption or file change still goes through PendingAction / diff / Human Approval |

