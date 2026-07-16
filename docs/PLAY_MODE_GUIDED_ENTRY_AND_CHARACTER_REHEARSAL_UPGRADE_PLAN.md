# Play Mode 引导入场与角色推演升级计划

> 状态：F1 / F2 Completed / F3 Next
>
> 文档目标：在现有顶级 Play 工作区与世界事件底座上，补齐“从小说素材进入可玩场景、按角色知识与行为依据进行推演、由作者逐步导演、结束后形成可追溯写作参考”的产品闭环。
>
> 产品层级：Play 与 Writing 是 workspace 内同层级的顶级功能；角色推演是 Play 的一种 session purpose，不是 Writing 侧栏工具，也不是第二套独立 sandbox。
>
> 规划边界：本文规划后续能力，不修改稳定事实边界；`docs/tasks/1120.md` 的 Remaining Review Scope 继续独立追踪，但不再作为本计划全部功能开工的全局 Gate。
>
> 当前阶段排除：MuseAI P2 的沉浸与跨设备增强，包括 LAN / 移动端 / 跨设备、头像与语音、视觉附件、沉浸式演出、面向用户暴露的分阶段模型配置，以及高级 setup 升级 / 重建体验。
>
> 分析日期：2026-07-14。
>
> 执行顺序调整：2026-07-15。
>
> 当前执行原则：基础设施已经足够。世界事件 M1 与本计划 F1 已于 2026-07-15 完成，世界事件 M2 与本计划 F2 Source-backed Guided Start 已于 2026-07-16 完成；下一功能主线是 F3 Outcome / Writing Handoff，之后再推进 F4 advanced Director controls。耐久性、规模化和通用 transport 加固继续并行，只有被具体切片直接触及时才成为局部门槛。

## 1. 结论摘要

OAN 的 Play Mode 已经不再只是右侧面板中的角色聊天：它已经是与 Writing 同层级的顶级工作区，并拥有 world clock、typed event、visibility、observation / adoption、单一 world referee 和 Play-local 回合事务。下一步不应重做这些能力，而应补齐两个仍然断开的环节：

1. **进入之前**：用户如何从章节、角色卡、世界状态与时间线中选择一个入口，确认身份、目标、风险、参与角色和信息差。
2. **游玩之中与之后**：作者如何按角色逐步观察、校准和重演反应，并把最终选择的分支整理成带来源的场景报告或写作参考。

MuseAI 与 awesome-novel-skill 的角色推演沙盘恰好分别补充了这两个方向：

```text
MuseAI
  -> 世界装配、入场点、身份、scene / beat、记忆、结局与角色复盘

awesome-novel-skill 角色推演沙盘
  -> 舞台确认、角色顺序、知识边界、逐角色反应、作者干预、目标复盘

OAN
  -> 单一 World Referee、typed world event、可见性、来源证据、
     provisional attempt、原子提交、filesystem-first、Human Approval
```

组合后的产品公式是：

```text
Play Mode
  =
可复核的 Play Launch Package
  + Quick / Guided 两种开局方式
  + Immersive Journey / Scene Rehearsal 两种正交用途
  + Scene Contract 与 participant-specific perception
  + 单一 World Referee 下的角色步骤推演
  + 作者 Director interventions
  + 一次 Play Turn 的 provisional attempt 与原子提交
  + Outcome Report / Writing Reference
  + Observation -> PendingAction -> Human Approval
```

本计划最重要的架构判断有四个：

- **角色推演不是多 Agent 平台**。每个角色只是受限上下文中的 voice / state module，所有状态变化仍由一个 world referee 裁决。
- **角色步骤不是独立事实提交**。一个或多个角色步骤组成一次 provisional turn attempt；只有用户结束并确认后，所选步骤前缀才作为一个 Play-local turn 原子提交。
- **角色推演记录不是 canonical truth**。它既不自动写章节，也不自动注入后续写作 prompt；只有用户显式采用后，才进入现有 PendingAction / diff / approval 链路。
- **本期不包含 MuseAI P2**。当前阶段先保证推演正确、可控、可回退、可复核，不扩展跨设备与视听沉浸面。

## 2. 与现有 Play 规划的关系

### 2.1 当前已经落地的能力

本文以 `docs/tasks/1120.md` 和当前代码为事实基线，不沿用旧参考报告中“Play 尚未实现”的过时判断。当前已经具备：

- 顶级 `Writing | Play` workspace，Play 不再是 Writing 右侧 tab。
- session schema v4、`turns/*.yaml` 结构化回合事实与包含 event schedule 在内的 Play-local snapshot 文件；必需 branch base 与 legacy cutoff 为 root / legacy bridge 提供可验证前驱。
- world clock、event policy、typed world events 与 visibility。
- activated source 实际内容装载与路径约束。
- 单一只读 world referee endpoint。
- 必需的结构化 `oan-play-settlement`。
- staged directory snapshot、swap、恢复、单进程 session lock 与 commit 前 revision recheck。
- hidden event 的 spoiler gate。
- HUD、event feed、observation 与 adoption candidate 流程。
- committed-turn 隐式 checkpoint、selected path restore、variant 保留与原子 Retry；首回合可从共享虚拟 branch base 形成 sibling roots。
- 专用 turn SSE、provisional / committed 区分、Stop / reconcile 与 indeterminate 后的权威刷新恢复。

这些能力是本计划的底座，不作为新功能重复立项。

### 2.2 `1120` 底座判断：已经足够启动功能开发

`docs/tasks/1120.md` 保持 `Needs Review`，是因为它同时追踪耐久性、规模化、迁移体验和广覆盖 QA；这不等于 Play 的领域与 transport 底座尚不可用。当前 v4 turn facts / selected projection / branch base、strict settlement、hard-due evaluator、staged snapshot、session lock、typed SSE、Stop / reconcile、checkpoint / restore / Retry、visibility / provenance 已足以支持本计划的首个功能纵向切片。

因此，本计划取消“先把 1120 全部 Remaining Review Scope 收口”的统一 Gate，改为三类依赖：

1. **已满足的共用底座**：turn artifact、world settlement、hard-due、stream / cancel / reconcile、checkpoint / variant、visibility、observation / adoption 直接复用，不重复建设。
2. **按功能触发的局部 correctness gate**：F1 participant perception 必须带不可变、scene-local 的初始知识 evidence snapshot；F4 持久化 `grantKnowledge` 才要求完整 branch-local knowledge / reveal store。attempt finalize 必须复用现有 settlement validator、hard-due evaluator、session revision recheck 与一次提交；持久化 schema 升级旧 session 时必须同时提供 migration preview / backup / confirm / cancel；source-based setup 必须校验 ref、hash、missing / stale。
3. **非阻塞并行加固**：F1 已按局部 correctness gate 增加 cooperative cross-process session / attempt filesystem lock、持锁 CAS、staged attempt publish 与 crash self-healing；fsync、完整跨进程故障矩阵、可重启 terminal registry、graceful shutdown、通用 deadline / backpressure、summary / windowing、旧 endpoint deprecation 与浏览器级旅程仍不阻止 F2–F4。

`pressure / agenda / eligible evaluator` 是世界活性功能，而不是 Guided Start 的前置基础设施。Scene Rehearsal 第一版可以复用现有 hard-due evaluator；当对应体验承诺 NPC / 组织基于 agenda 主动推进时，再把 eligible evaluator 纳入该纵向切片。

本计划内部的交付顺序是：

```text
Slice 1：最小可玩 Scene Rehearsal
  -> Slice 2：完整 Guided Start / Scene Contract
  -> Slice 3：Outcome / Memory 与 Writing Handoff
  -> Slice 4：高级 Director controls 与长篇体验收口

并行：1120 correctness / durability / scale hardening
```

新的角色推演范围仍应由独立 task 追踪，不把 attempt、actor-step 或 report schema 静默塞进 `1120`。

### 2.3 与世界事件升级计划的分工

`docs/PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md` 已经定义世界时间、scheduled event、pressure、agenda、typed delta、回合事务、HUD、checkpoint 和 adoption。本文只在其上增加“如何入场”和“如何逐角色推演”。

两者分工如下：

| 领域 | 世界事件计划 | 本计划 |
|---|---|---|
| 世界时间与外部变化 | 定义与实现底座 | 读取并服从，不另造事件引擎 |
| NPC / 组织自主性 | schedule / pressure / agenda | 作为角色推演的环境输入 |
| 回合事务 | 一个 turn 的验证与原子提交 | 在提交前增加多步骤 provisional attempt |
| checkpoint / variant | 定义一致恢复能力 | 用于重演、修改较早步骤与保留分支 |
| UI | HUD、事件与 adoption | 增加入场向导、演员队列与导演控制 |
| 结果回流 | observation / adoption | 增加 outcome report 与显式写作参考 |

## 3. 参考分析与吸收边界

### 3.1 awesome-novel-skill 的版本增量

既有 `docs/NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md` 可以快速了解 awesome-novel-skill 的总体架构、单 / 多 Agent 演化、写前上下文包、写后证据链和 GPL-3.0 边界，但它的阅读快照是 2026-06-17 的 `d4891c6`。

本次阅读的参考仓库是：

| 项目 | 快照 | 时间 | 备注 |
|---|---|---|---|
| `reference-only/awesome-novel-skill` | `1f24b2c5cf2a89c8b4a44462095edce4a3341045` | 2026-07-10 | v4.8.1，working tree clean |
| 角色推演进入当前 main 历史 | `93decba` | 2026-07-06 | 晚于既有分析快照；全仓其它历史中另有更早的非 main 祖先提交 |
| 后续语义修正 | `651ad9b` | 2026-07 | 明确记录供作者编写章纲 / 正文时自行参考，不由 prompt-crafter 自动读取或注入任何后续流程 |

因此，既有分析的架构与许可证结论仍然有效，但不能代替对以下新增文件的阅读：

- `reference-only/awesome-novel-skill/skills/roleplay-sandbox.md`
- `reference-only/awesome-novel-skill/knowledge/format-specs/roleplay-sandbox-style.md`
- `reference-only/awesome-novel-skill/knowledge/format-specs/character-setting-style.md`

### 3.2 角色推演沙盘最值得吸收的能力

角色推演沙盘的价值不在其 Markdown 文件格式，而在一条清晰的作者校准流程：

1. 读取卷纲中本章的 `chapters_summary` 与角色设定 / 当前状态，并按需选读活跃钩子和前章归档正文的结尾画面。
2. 先确认地点、时间、气氛、人物位置、触发事件、信息差与推演目标。
3. 由作者确定角色行动顺序。
4. 每个角色只基于自身可知信息、当前目标、情绪与行为约束作出反应。
5. 输出可观察的语言、动作、表情和场景变化，不把未表达的内心活动泄露给其他角色。
6. 作者可以接受、修改、重演、插队、补充信息或终止。
7. 结束时比较初始目标与实际结果，并整理可用于写作的素材。

它对 OAN 的净新增启发是：

- 先确认 `Scene Contract`，再开始生成。
- 把角色知识边界变成一等输入，而不是只写在 prompt 中。
- 让角色输出附带可验证的 source refs、current goal 与 observable effects。
- 把作者干预建模为 typed intervention，而不是改写历史消息。
- 把停滞、OOC 风险、目标偏移和可用素材变成可复核的结束报告。

### 3.3 不能照搬的部分

awesome-novel-skill 的沙盘仍是一套 Markdown SOP，不是可执行运行时。它缺少 typed state、事件裁决、事务、真实 snapshot / branch、自动化测试与感知过滤器，因此不能替代 OAN 当前 Play 引擎。

以下做法不进入 OAN：

- 不建立常驻角色 Agent 或固定多 Agent 流水线。
- 不让每个角色直接修改 session 或 canonical 文件。
- 不新建 canonical `sandbox/vol-*.md` 作为事实源。
- 不强制固定轮序适用于所有 Play session。
- 不把“每个角色都必须改变状态”设为硬规则；允许 `pass / noMaterialEffect`。
- 不把固定字数、表情数量或特定“六层认知模型”写成核心 schema。
- 不记录或展示模型 chain-of-thought；只保留简短、可审计的行为依据与 source refs。
- 不复制 GPL-3.0 的 prompt、表格、文案、模板或代码。

许可证判断来自参考仓库的 `LICENSE-DECLARATION.md`：其中明确将 skills、agents、knowledge、templates 与 tools 纳入 GPL-3.0 范围。因此 OAN 只能 clean-room 重建抽象概念，不能把参考文件转写成实现规格或 prompt。

参考项目还存在路径命名、消费者契约、版本元数据与架构文档漂移，这进一步说明 OAN 应吸收概念并独立建模，而不是复制其文件协议。

### 3.4 MuseAI 与角色沙盘如何互补

| 维度 | MuseAI 启发 | awesome-novel-skill 沙盘启发 | OAN 组合方式 |
|---|---|---|---|
| 开局 | 素材装配、入场点、身份 | 初始舞台确认 | `PlayLaunchPackage + SceneContract` |
| 推进 | scene / beat、世界规划、记忆 | 逐角色反应与顺序 | 世界事件先评估，角色步骤按 perception 推演 |
| 控制 | 阶段反馈、局部重试 | 接受、修改、重演、插队、补信息、终止 | typed provisional attempt 与 Director interventions |
| 角色 | 角色关系与足迹复盘 | 目标、知识、行为依据 | participant state、behavior anchors、outcome report |
| 结束 | 世界线结局与总结 | 目标对照与素材整理 | evidence-backed Play Outcome Report |
| 正确性 | 本地保存与阶段流程 | 作者逐步确认 | OAN staged transaction、revision guards、visibility、PendingAction |

## 4. 产品目标与非目标

### 4.1 产品目标

升级完成后，用户应能：

- 从当前小说文件树选择章节、场景、角色、时间线或世界状态作为开局来源。
- 使用 Quick Start 保持现在的低摩擦开局，也能使用 Guided Start 复核完整入场条件。
- 选择“沉浸游历”或“场景推演”，而不把它与世界活跃度设置混为一谈。
- 明确玩家身份、导演目标、参与角色、行动顺序、每个角色的已知 / 未知信息与当前目标。
- 看见每个角色步骤的 provisional 状态，并执行接受、修改、重演、插队、补充信息、完成或取消。
- 在较早步骤改变时，从该步骤前的 snapshot 分叉并使后续步骤失效，而不是覆盖历史。
- 保证到期世界事件、NPC agenda 与 pressure 在角色推演中仍会发生。
- 在结束后获得带来源的场景结果、角色变化、知识变化、目标偏差与可用写作素材。
- 显式选择“作为写作参考”或走 adoption；未经选择的 Play 内容不进入 canonical truth。

### 4.2 非目标

本计划不做：

- 不把 Play 改造成后台实时运行的自治世界。
- 不按现实时间在用户离开时偷偷推进 session。
- 不引入 planner / writer / character swarm 等重型多 Agent runtime。
- 不让角色模块越过 referee 直接提交 state delta。
- 不把推演结果自动写入章节、章纲、角色卡、时间线或伏笔文件。
- 不替换现有 world event、transaction、checkpoint 或 adoption 设计。
- 不强制所有 Play 都逐角色暂停确认。
- 不要求小说项目采用 awesome-novel-skill 的角色字段或文件布局。
- 不包含第 19 节列出的 MuseAI P2 沉浸与跨设备增强。

## 5. 产品模型：用途、开局方式与世界活跃度正交

当前 `eventPolicy.simulationMode` 已表示世界活跃度：

```ts
type PlaySimulationMode =
  | 'conversation'
  | 'reactiveWorld'
  | 'activeWorld'
```

它不应被复用为“沉浸游历 / 角色推演”。建议新增两个正交维度：

```ts
type PlaySessionPurpose =
  | 'immersiveJourney'
  | 'sceneRehearsal'

type PlayStartMode =
  | 'quick'
  | 'guided'
```

三个维度回答不同问题：

| 字段 | 回答的问题 | 示例 |
|---|---|---|
| `purpose` | 用户为什么进入 Play | 沉浸体验 / 校准角色场景 |
| `startMode` | 用户需要多少开局引导 | 快速 / 完整向导 |
| `eventPolicy.simulationMode` | 外部世界多主动 | 只对话 / 响应式 / 活跃世界 |

合法组合包括：

- `immersiveJourney + quick + activeWorld`
- `immersiveJourney + guided + reactiveWorld`
- `sceneRehearsal + guided + reactiveWorld`
- `sceneRehearsal + quick + conversation`

`sceneRehearsal` 只是 Play 内的 opt-in purpose。它不能成为第三个顶级 workspace，也不应隐藏回 Writing inspector。

## 6. 核心用户旅程

### 6.0 首个可玩纵向切片

完整五步向导和七类 Director control 不应先被横向拆成“只有配置、没有推演”的半成品。第一项实际功能先交付一条 compact Scene Rehearsal 旅程：

```text
选择 Scene Rehearsal
  -> compact Scene / Cast / Review
  -> 确认固定 actor queue 与 participant perception
  -> 生成 provisional actor step
  -> Accept 或 Retry
  -> Finish 一次原子提交，或 Cancel 零提交
  -> 显示来自 committed selected branch 的简要结果
```

首个切片只需要 `Accept | Retry | Finish | Cancel`，但必须包含 Core 规则、Backend / Client、Desktop UI、visibility / hard-due 回归和一条完整用户旅程测试。`Revise | Insert | Grant Knowledge`、dynamic / hybrid order、完整双 Lens 与 memory 在后续切片扩展。

### 6.1 Quick Start 保持现有体验

Quick Start 继续允许用户只提供：

- session title；
- 开场文本；
- persona；
- character names；
- world activity 与 event density。

系统用保守默认值创建 `immersiveJourney + quick`。升级后不能要求所有旧用户先完成长向导。

### 6.2 Guided Immersive Journey

```text
选择 activated sources
  -> 查看来源、hash 与失效警告
  -> 选择入场点
  -> 选择玩家身份 / 自定义 persona
  -> 查看目标、风险、活跃角色和已知信息
  -> 确认初始 Scene Contract
  -> 进入现有沉浸式 Play
```

该旅程吸收 MuseAI 的入场闭环，但继续使用 OAN 的 source refs、visibility 与事务。

### 6.3 Guided Scene Rehearsal

```text
选择章节 / 场景方向与角色来源
  -> 设定本次推演目标
  -> 确认地点、时间、气氛、触发条件
  -> 设置参与者位置、目标、知识边界
  -> 选择 actor order strategy
  -> 确认 Launch Preview
  -> 逐角色生成 provisional step
  -> 作者接受 / 修改 / 重演 / 插队 / 补信息
  -> 世界事件与 referee 持续裁决
  -> 完成并原子提交一次 turn
  -> 生成 outcome report / 写作参考候选
```

### 6.4 Player Lens 与 Director Lens

同一 session 可以有两个阅读镜头，但不是两套事实：

- **Player Lens**：只显示玩家身份可以知道的叙事、角色语言、动作与可见世界事件。
- **Director Lens**：显示推演目标、actor queue、来源、知识边界诊断、隐藏事件提示与干预控件。

Director Lens 只能在用户主动切换后显示隐藏信息，且所有隐藏内容仍遵守 spoiler gate。切换镜头不改变 session truth。

## 7. 领域模型

以下名称是目标候选契约，不要求在首个切片中一次全部持久化。首版最小子集是 compact Scene Contract、session-local participant ref、filtered perception、attempt、step、NarrativeBlock 与 `Accept | Retry | Finish | Cancel`；完整 Launch Package、redirect / insert / grant、Memory 与 Writing Reference 按后续纵向切片增量冻结。

### 7.1 Play Launch Package

```ts
interface PlayLaunchPackage {
  id: string
  createdAt: string
  sourceBase: {
    gitHead?: string
    activatedSources: Array<PlayActivatedSource & {
      objectId?: string
      contentHash: string
      role: 'chapter' | 'character' | 'world' | 'timeline' | 'state' | 'other'
    }>
    contextTraceRef?: string
  }
  entryPoints: PlayEntryPoint[]
  participantRoles: PlayParticipantRole[]
  diagnostics: PlayLaunchDiagnostic[]
}
```

约束：

- `activatedSources` 复用现有 `PlayActivatedSource` 的 `sourceId / path / reason / budgetLayer / semanticBoundary / trust`，只增加 setup 所需的 object identity、hash 与 role；F2 不再定义平行 source identity。
- package 只保存引用、hash、结构化摘录与诊断，不复制一份 canonical 全文作为第二事实源。
- 创建或恢复时至少校验 source hash，并提示 stale；是否 rebase / fork 继续服从 `1120` 的 canonical drift 设计。
- 本阶段只做正确性所需的 hash / stale 保护，不实现高级 setup 版本升级、批量重建或跨设备同步体验。

### 7.2 Scene Contract

```ts
interface PlaySceneValue {
  value: string
  provenance:
    | { kind: 'sourceBacked'; sourceRefs: string[] }
    | { kind: 'authorProvided'; providedAt: string }
}

interface PlaySceneContract {
  sceneId: string
  entryPointRef?: string
  sourceRefs: string[]
  worldClock: PlayWorldClock
  clockProvenance:
    | {
        kind: 'sessionRevision'
        sessionId: string
        revision: number
        owningTurnRef?: string
      }
    | {
        kind: 'newSessionInitial'
        sourceRefs: string[]
        authorProvidedAt?: string
      }
  location?: PlaySceneValue
  atmosphere?: PlaySceneValue
  trigger?: PlaySceneValue
  objective?: PlaySceneValue
  risk?: PlaySceneValue
  hookRefs?: string[]
  participantRefs: string[]
  orderStrategy: 'directorFixed' | 'refereeDynamic' | 'hybrid'
  terminationPolicy: {
    goalReached: boolean
    naturalClosure: boolean
    stagnantRounds?: number
    maxRounds?: number
  }
}
```

Scene Contract 是一次场景推演的显式边界，不是 canonical scene outline。当前 `PlayWorldClock` 是内嵌值对象而非带 id 的独立 artifact，因此这里复用其原值，并用 `sessionId + revision + owningTurnRef` 或新 session 的 source / author provenance 定位时钟基线；不得虚构 `worldClockRef`。`hookRefs` 必须引用现有 source / event identity；自由文本必须显式标记 `authorProvided`，不能形成第二套 world clock、location 或 hook truth。用户确认它只表示“按这些条件开始试演”。

### 7.3 Participant State 与 Behavior Anchor

```ts
interface PlayParticipantState {
  participantRef: string
  canonicalCharacterRef?: string
  displayName: string
  position?: string
  emotion?: string
  currentGoal?: string
  conflict?: string
  knowledgeRef: string
  behaviorAnchorRefs: string[]
  status: 'active' | 'waiting' | 'absent' | 'exited'
}

interface BehaviorAnchor {
  id: string
  participantRef: string
  facet:
    | 'belief'
    | 'identity'
    | 'valueBoundary'
    | 'capability'
    | 'habit'
    | 'relationship'
    | 'currentState'
  summary: string
  sourceRefs: string[]
  confidence: 'explicit' | 'inferred' | 'authorProvided'
}
```

`BehaviorAnchor` 只抽象“角色为何可能这样反应”，不复制参考项目的固定认知层模型。`inferred` 必须可见且不得伪装为 canonical fact。

### 7.4 Participant-specific Perception Package

```ts
interface PlaySceneKnowledgeEvidence {
  id: string
  participantRef: string
  visibility: PlayEventVisibility
  fact: string
  provenance:
    | {
        kind: 'sourceBacked'
        sourceId: string
        sourcePath: string
        contentHash: string
        sourceFactRef?: string
      }
    | {
        kind: 'authorProvided'
        providedAt: string
      }
}

interface CharacterPerceptionPackage {
  id: string
  participantRef: string
  sceneRevision: number
  visibleFactRefs: string[]
  visibleEventRefs: string[]
  observedNarrativeBlockRefs: string[]
  initialKnowledgeEvidenceRefs: string[]
  grantedKnowledgeRefs: string[]
  omissionMetadata: Array<{
    reason: 'budget' | 'semanticBoundary'
    omittedCount?: number
    opaqueTraceRef?: string
  }>
}
```

每个角色步骤只能读取该角色的 perception package。F1 的 `initialKnowledgeEvidenceRefs` 必须解析到同一 committed Scene Contract sidecar 内的 versioned `PlaySceneKnowledgeEvidence` record；record 冻结最小必要 fact、participant、visibility、source identity / content hash 或 author provenance，生成 step 时不得重新读取可变 canonical source 来替换该 fact。它不复制整份 canonical 文件，也不声称封存旧回合全部 source bytes。`grantedKnowledgeRefs` 在 F1 保持为空，直到 F4 交付 branch-local knowledge / reveal store 与持久化 `grantKnowledge`。完整 hidden state 与带语义的 omitted trace 只属于 referee / Director；因 visibility 被排除的内容不得在角色 package 中留下“存在隐藏项”的提示。角色可见的 `omissionMetadata` 只用于 budget / semantic boundary，且只能包含通用 reason、数量和不透明引用，不能出现被省略事实的标题、实体、摘要或路径。不得把完整累积 transcript 原样发送给所有角色模块。

### 7.5 Turn Attempt、Step 与 Round

```ts
interface PlayTurnAttempt {
  id: string
  sessionId: string
  baseRevision: number
  attemptRevision: number
  sceneBeforeRef: string
  status: 'running' | 'prepared' | 'committed' | 'cancelled' | 'failed'
  actorOrder: string[]
  selectedStepRefs: string[]
  selectedHeadRef?: string
  currentStepRef?: string
  interventionRefs: string[]
  provisionalSnapshotRef: string
  mutationReceipts: Array<{
    idempotencyKey: string
    requestFingerprint: string
    resultingAttemptRevision: number
    resultRef: string
    responseDigest: string
  }>
  createdAt: string
  updatedAt: string
}

interface CharacterStepDraft {
  id: string
  attemptId: string
  participantRef: string
  beforeStepSnapshotRef: string
  perceptionRef: string
  intentSummary: string
  narrativeBlocks: NarrativeBlock[]
  effectContributionRefs: ProvisionalPlayEffectRef[]
  decisionBasisRefs: string[]
  validation: CharacterStepValidation
  variantOf?: string
  status: 'draft' | 'selected' | 'superseded' | 'discarded'
}

interface ProvisionalPlayEffectRef {
  kind: 'eventDraft' | 'stateDeltaDraft' | 'timeAdvanceDraft' | 'observationDraft'
  draftRef: string
  causeStepRef: string
}
```

`ProvisionalPlayEffectRef` 只引用 attempt 内、遵循现有 `PlayWorldRefereeSettlement`、typed event 与当前 state-delta validator 的子提案；需要更严格 field-level delta refs 的 effect 必须在对应功能切片内补齐，不能把尚未落地的契约写成既有事实。它不是第二套 effect schema，也没有自己的 reducer。当前 `parsePlayWorldRefereeResponse` 接收带 settlement fence 的 raw provider string，不能直接消费聚合后的 typed object；F1 必须从现有 `settlePlayWorldRefereeResponse` 最小抽取 typed normalize / validate / apply seam，让选中贡献形成一份 settlement 后复用同一领域校验与 staged writer，而不是新建第二套 commit framework。

F1 已冻结的实际 schema 比上述后续候选更小：attempt 使用 `dueScheduledEventIds`、`steps`、`queueIndex`、`beforeStepRef` 与内嵌 typed `settlementContribution`，不包含尚未交付的 `interventionRefs`、`provisionalSnapshotRef`、`effectContributionRefs` 或完整 validation report。committed step 额外持久化 `settlementEventRefs`，按 artifact event 顺序精确记录该 step 的非 hard-due 事件分段；这组 refs 是角色步骤事件归属的事实边界，不能只靠所有 notice refs 的全局并集推断。

术语必须冻结：

- **Turn**：用户 / Director 的一次意图最终形成的原子 Play-local commit。
- **Attempt**：一次尚未提交的 turn 尝试，包含若干角色 step 与干预。
- **Step**：一个角色在 attempt 内的一次 provisional 反应。
- **Round**：UI 中的一轮 actor queue 分组，不是事实、时钟或事件结算边界。

并发契约同样必须冻结：

- 同一 session 同时最多存在一个 active attempt；active 期间拒绝其它会改变 session revision 的请求，只允许读取和该 attempt 的 step / intervention / finalize / cancel。
- 每个 attempt mutation 都必须携带 `expectedAttemptRevision` 与客户端生成的 `idempotencyKey`；成功后递增 `attemptRevision` 并持久化 receipt。
- 同 key、同 request fingerprint 返回原 receipt 指向的结果；同 key、不同 payload 返回 idempotency conflict。revision 不匹配返回结构化 attempt conflict，不能按到达顺序偷偷覆盖。
- attempt 不长期持有进程锁。`finalize` 必须同时校验 `expectedAttemptRevision`、`selectedHeadRef` 和 session `baseRevision`，随后调用 F1 从现有 settlement 路径抽取的 typed normalize / validate / apply seam 与 staged session save 管线。
- session `baseRevision` recheck 冲突时 attempt 保持未提交，并引导用户 rebase / fork；不能只因 attempt 内部 revision guard 成功就覆盖新的 session revision。

F1 的持久化闭环是功能局部 correctness gate：selected step / NarrativeBlock 必须作为 committed rehearsal evidence 纳入同一次 staged snapshot，并由 owning `worldSettlement` artifact 以稳定 ref 关联；Core fixed-file / directory manifest、读取恢复、Client strict guard 和 selected-branch projection 必须同步认识这些文件。成功提交后清理对应 recovery shadow；取消、失败或未提交退出时 recovery 只能标为 abandoned / resumable，绝不能显示为 committed truth。具体 artifact / sidecar schema 在 F1 task 中冻结，不能依赖当前 writer 自动保留未知目录。

### 7.6 Narrative Block

当前 transcript 只有自由 `speaker / content`，无法可靠表达角色语言、动作、旁白和世界通知。建议引入一等 block：

```ts
interface NarrativeBlock {
  id: string
  kind:
    | 'narrator'
    | 'characterSpeech'
    | 'characterAction'
    | 'worldNotice'
  speakerRef?: string
  content: string
  visibility: PlayEventVisibility
  projection: 'transcript' | 'directorOnly'
  eventRefs: string[]
  sourceRefs: string[]
}
```

`transcript.md` 只投影 selected / committed blocks；superseded variants 不混入主 transcript。

F1 scene evidence v1 同时冻结：

- `steps[].narrativeBlocks` 只承载角色 step 与其 `playerVisible` contribution notice；provisional notice 尚无 committed event id，因此 `eventRefs` 必须为空。
- Finish 后 step notice 的 refs 必须精确等于该 step `settlementEventRefs` 中的 `playerVisible` 子集，内容必须按 ref 顺序严格派生为 `title: summary`。
- `hostNarrativeBlocks` 是必需数组；公开 hard-due events 只进入无 `speakerRef` / `sourceRefs` 的独立宿主 notice，不归最后一个角色。宿主 notice 同时进入主 transcript、Result、selected-branch reopen 与后续 actor 的已观察 blocks。
- 顶层 `evidence.narrativeBlocks` 必须 deep-equal 于全部 step blocks 展开后追加 `hostNarrativeBlocks`；Core / Client 同时校验 owning artifact、event partition、visibility dominance 与派生内容。
- F1 不把 `rumor` 或 `playerUnknown` event 包装成确定性的 rehearsal notice；一般 Event Feed 的 rumor 语义仍由世界事件计划保留。

### 7.7 Director Intervention

```ts
interface PlayDirectorInterventionBase {
  id: string
  attemptId: string
  createdAt: string
  provenance: {
    actor: 'user'
    source: 'directorControl'
  }
}

type PlayDirectorIntervention = PlayDirectorInterventionBase & (
  | { kind: 'accept'; stepRef: string }
  | {
      kind: 'reviseProjection'
      stepRef: string
      replacementBlocks: NarrativeBlock[]
      expectedEffectFingerprint: string
    }
  | {
      kind: 'redirectStep'
      stepRef: string
      directorIntent: string
      authorConstraintRefs: string[]
    }
  | { kind: 'retry'; stepRef: string; retryFromSnapshotRef: string }
  | {
      kind: 'insertActor'
      participantRef: string
      beforeStepRef?: string
      afterStepRef?: string
    }
  | {
      kind: 'grantKnowledge'
      participantRef: string
      effectiveFromStepRef: string
      grant:
        | { kind: 'existingFact'; factRefs: string[] }
        | {
            kind: 'authorProvidedPlayFact'
            summary: string
            visibility: PlayEventVisibility
            providedAt: string
          }
    }
  | { kind: 'finish'; selectedHeadRef: string }
  | { kind: 'cancel'; reason?: string }
)
```

UI 仍可把 `reviseProjection` 与 `redirectStep` 合并显示为“修改”，但二者语义必须分开：

- `reviseProjection` 只能改措辞或可见叙事，`expectedEffectFingerprint` 必须证明 event / state / time effects 未变。
- `redirectStep` 改变角色意图或结果，必须重新经过 referee 与 validator，并从目标 step 起失效后缀。

所有干预都必须追加记录，不能物理改写旧 step。`grantKnowledge` 只从指定步骤开始生效；已有 fact 必须引用稳定 id，作者新增信息必须明确是 Play-local、带 visibility 与 provenance，不能伪装成 canonical fact。

因此产品层仍是七个 Director 控制：接受、修改、重演、插队、补充信息、完成、取消；其中“修改”在协议层分成 `reviseProjection` 与 `redirectStep` 两种 typed artifact。

### 7.8 Outcome Report

```ts
interface EvidenceBackedOutcomeItem {
  id: string
  summary: string
  evidenceRefs: string[]
  sourceRefs: string[]
  turnRefs: string[]
  eventRefs: string[]
  visibility: PlayEventVisibility
  confidence?: 'confirmed' | 'inferred' | 'authorProvided'
}

interface PlayOutcomeReport {
  sessionId: string
  sceneId: string
  committedTurnRefs: string[]
  finalSceneSummary: EvidenceBackedOutcomeItem[]
  goalAssessment: Array<{
    goal: string
    status: 'reached' | 'partial' | 'missed' | 'changed'
    assessment: EvidenceBackedOutcomeItem
  }>
  participantOutcomes: Array<{
    participantRef: string
    stateChanges: EvidenceBackedOutcomeItem[]
    knowledgeChanges: EvidenceBackedOutcomeItem[]
    consistencyNotes: EvidenceBackedOutcomeItem[]
  }>
  worldChanges: EvidenceBackedOutcomeItem[]
  divergenceNotes: EvidenceBackedOutcomeItem[]
  writingMaterialCandidates: EvidenceBackedOutcomeItem[]
}
```

报告只来自 committed selected branch，不汇总被丢弃的 variant，不包含私有推理过程。宿主从同一结构化报告生成 Player / Director 两种 projection；每一项独立执行 visibility 检查，禁止用隐藏内容生成 player-visible 标题、摘要或 adoption label。

### 7.9 Scene Memory 与 Writing Reference Attachment

```ts
interface PlaySceneMemoryArtifact {
  id: string
  sessionId: string
  throughRevision: number
  selectedTurnRefs: string[]
  sourceHashes: Record<string, string>
  items: EvidenceBackedOutcomeItem[]
  status: 'current' | 'stale' | 'superseded'
  builtAt: string
}

interface PlayWritingReferenceAttachment {
  id: string
  sessionId: string
  reportRef: string
  selectedOutcomeItemRefs: string[]
  selectedTurnRefs: string[]
  evidenceClosureRefs: string[]
  sourceHashes: Record<string, string>
  status: 'active' | 'detached' | 'stale'
  createdAt: string
  detachedAt?: string
}
```

Memory 是可重建 projection，不是 transcript 的替代事实源：selected path、source hash 或 session revision 变化后必须标记 stale，并从 committed turn artifacts 重建。每个 outcome item 的 `id` 在同一 report lineage 内保持稳定；attachment 用 `selectedOutcomeItemRefs` 精确记录用户选择，并保存所需 turn / evidence closure，不能用可能被多项共享的 evidence ref 代替 item identity。

Writing Reference Attachment 默认不进入任何 prompt；writing context assembler 只在用户针对当前写作请求显式传入 attachment id 列表时，读取其中 active 且非 stale 的 attachment。`active` 只表示“可被选择”，不表示自动注入所有后续写作。用户可 detach，保留审计记录但停止消费；source drift 后先标记 stale，复核前不得静默注入。

## 8. 运行时与原子提交设计

### 8.1 单一裁决管线

建议逻辑管线如下：

```text
Launch Package / Scene Contract
  -> Host 计算 hard-due / eligible events
  -> 为当前参与者构造 perception package
  -> Character voice/state module 生成受限 intent
  -> 单一 World Referee 结合完整 state 裁决 effects
  -> Narrative projection 生成可见 blocks
  -> Director 接受 / 修改 / 重演 / 插队 / 补信息
  -> Host 验证整个 attempt
  -> 一次 staged snapshot commit
  -> Outcome / memory / adoption candidates
```

这是职责分层，不要求每层都对应一次模型调用。宿主可以在保证可测试边界的前提下合并调用，以控制延迟和成本。

### 8.2 为什么不能逐角色直接提交

如果每个角色接受后立刻成为一个完整 turn：

- world clock 和 `afterTurns` 可能每个角色都推进一次；
- 中间角色失败会留下半轮状态；
- 修改较早角色会要求破坏性回滚；
- 到期事件可能在同一叙事轮中重复结算；
- transcript、events、knowledge 与 state 很难保持同 revision。

因此首版采用：

```text
一个 rehearsal round
  = 一个 PlayTurnAttempt
  = N 个 provisional CharacterStepDraft
  = 用户 finish 时一次 commit
```

用户可以在 attempt 中选择步骤，但这些步骤在 `finish` 前仍不是 Play-local truth。`cancel` 后 session revision、world clock、events、knowledge 与主 transcript 都不得改变。

### 8.3 修改、重演与分支

- `retry current step`：从该 step 的 `beforeStepSnapshotRef` 重演，只替换 selected variant 指针。
- `reviseProjection`：只改叙事措辞且 effect fingerprint 不变，不重算 state / event。
- `redirectStep`：从较早 step 前的 snapshot 创建新分支并重新裁决；其后的旧步骤标记为 superseded，不能无条件复用。
- `insertActor`：更新当前 attempt 的 actor order，并从插入点重新计算受影响后缀。
- `grantKnowledge`：生成带 provenance 的 knowledge grant，从目标 step 开始重建 perception。
- `finish`：只提交当前 selected prefix；若后缀失效，UI 必须明确提示。
- `cancel`：丢弃 attempt 的 truth 候选，但保留最小 recovery artifact 供崩溃恢复 / 审计，不能显示为已发生剧情。

不允许 destructive overwrite。旧 variant 可以保留到 retention policy 清理，但不得混进主分支。

### 8.4 停滞与收束

角色可以选择沉默、观察、回避或暂不行动，因此 `noMaterialEffect` 是合法结果，并必须附原因。

当连续达到默认三轮无实质变化时：

- 系统提示 Director 场景可能停滞；
- 提供完成场景、加入触发、调整目标或继续的选择；
- 不自动强行制造冲突；
- hard-due world event 仍按确定性规则发生。

### 8.5 多步骤 attempt 中的 due event 时点

当前 evaluator 读取 committed session 的 before-turn snapshot，并不接受 provisional step overlay。为避免把尚未存在的能力写成 F1 前提，首版采用与普通 Play turn 相同的确定性边界：

1. attempt 从 base session snapshot 计算 immutable hard-due skeleton；在 base revision 已经到期的事件持续保留。
2. 每个角色 step 可以提出 provisional time / state contribution，但不推进 committed clock，也不在 F1 内重新解释 due set。
3. finalize 在单进程 session lock 与 commit 前 `baseRevision` recheck 下，对同一 base snapshot 运行现有 evaluator 与 settlement validator；hard-due event 只随最终 turn commit 一次。
4. 公开 hard-due 的叙事由宿主在角色步骤外生成 `hostNarrativeBlocks`，并与角色 blocks 一起进入 committed transcript；hidden / rumor hard-due 仍保留结构化事件，但不升级为角色已观察事实。
5. Pressure / Agenda / eligible evaluator 落地后可复用同一宿主入口，但不阻塞 F1。

F4 的 `redirectStep`、provisional time/state overlay 与 suffix invalidation 若需要在 selected head 上重算 due set，必须新增纯 overlay evaluator adapter，并证明与 committed evaluator 的排序、触发和验证一致；不得在 F1 中假装现有 API 已支持。F1 / F4 都不新建第二套 schedule 或 event engine。

## 9. 文件系统布局

目录按功能切片按需增加，不先冻结完整最终树。候选布局建立在现有 `.workspace/play-sessions/` 之上：

```text
.workspace/
  play-setups/                         # F2
    <setup-id>/
      setup.yaml
      source-map.yaml
      entry-points.yaml
      participant-roles.yaml
      diagnostics.yaml

  writing-references/                  # F3
    <attachment-id>.yaml

  play-sessions/
    <session-id>/
      session.yaml
      transcript.md
      play-local-state.yaml
      events.yaml
      activated-sources.yaml
      observations.yaml
      adoption-candidates.yaml
      scene-rehearsal.yaml               # F1 purpose / start mode / active scene

      turns/
        <turn-id>.yaml
      scenes/                          # F1
        <scene-id>.yaml
      memories/                        # F4，可从 committed facts 重建
        <revision>.yaml
      reports/                         # F3
        outcome.yaml
        outcome.md
      .recovery/                       # F1 shadow，不是 committed truth
        turn-attempts/
          <attempt-id>/
```

约束：

- `turns/*.yaml` 是结构化事实；`transcript.md` 是单向展示投影。
- F1 的 versioned `scene-rehearsal.yaml` 是 `purpose / startMode / activeSceneRef / participant setup / initial knowledge evidence` 的权威 sidecar。创建或转换 rehearsal session 时必须同步提升 parent `session.yaml` 的 schema version（当前预计从 v4 到 v5），使旧 v4 reader / writer 看到 future session 后 fail closed，不能在一次普通保存中静默删除 sidecar；没有 sidecar 的既有 v4 继续解释为 `immersiveJourney + quick`。parent 与 sidecar 必须双向、精确配对：旧 v1–v4 parent 旁出现 orphan rehearsal sidecar、新 parent 缺 sidecar、或 parent / sidecar capability / version 不匹配都必须 fail closed。新 sidecar 必须进入 Core staged snapshot manifest、读取恢复与 Client strict guard，不能依赖 writer 保留未知文件。
- `.recovery/turn-attempts/` 是 shadow recovery，不属于已提交剧情。
- setup 保存 source refs / hashes，不保存 canonical 全文副本。
- outcome YAML 是结构化报告，Markdown 是投影。
- `writing-references/<attachment-id>.yaml` 是 workspace-owned 的非 canonical attachment；它引用 session report / outcome item / turn / evidence，不复制 canonical truth，也不会因 `active` 自动进入 prompt。
- 所有真实 canonical 写入继续经过 PendingAction；Play-local session 写入遵循既有事务边界。
- 具体目录只有在对应功能切片冻结 schema 后才能实施，本文不提前改变稳定 Filesystem Spec。

目录所有权必须明确：committed checkpoint / variant 已由 `turns/*.yaml`、parent link、branch snapshot 与 `selectedTurnIds` 表达，本计划不得再创建 `checkpoints/` 或 `variants/` 平行事实目录。F1 只需要 versioned `scene-rehearsal.yaml`、committed `scenes/` evidence 与 `.recovery/turn-attempts/`；F2 再增加 `play-setups/`；F3 增加 `reports/` 与 workspace-level `writing-references/`；F4 才考虑可重建的 `memories/`。attempt-local step graph 和 recovery shadow 不能变成另一套 committed checkpoint / variant 实现。

## 10. 上下文、知识边界与可见性

### 10.1 三类上下文必须分开

| 上下文 | 可读取内容 | 使用者 |
|---|---|---|
| Referee Context | 完整 Play-local state、hidden event、due event、source trace | 单一 world referee |
| Character Perception | 当前角色可见事实、已观察 block、被授予知识、行为 anchors | 当前角色 voice/state module |
| Player Projection | 玩家身份可见 narrative blocks 与 HUD | UI / transcript |

不能为了方便把 Referee Context 直接传给角色模块。否则角色会使用只有其他角色或 Director 才知道的信息。

### 10.2 行为依据不是 chain-of-thought

可持久化的 `decisionBasisRefs` 只能包含：

- source-backed behavior anchor id；
- current goal ref；
- visible fact / event ref；
- author-provided constraint ref；
- 简短一致性标签或验证结果。

不得要求模型输出完整内心推理、隐藏思维链或长篇“为什么”。报告面向作者的是可审计证据，不是模型私有推理。

### 10.3 隐藏信息保护

- hidden event 不得通过 character step、suggestion、outcome preview 或 adoption label 泄漏。
- Director Lens 展示隐藏内容前必须服从现有 spoiler setting。
- `grantKnowledge` 只改变指定 participant 的 perception，不自动提升为全局可见。
- 当 narrative block 同时引用 visible 与 hidden effects 时，必须拆分 block 或采用最严格 visibility，不能用“任一隐藏则整回合全局隐藏”的粗粒度策略长期替代。
- F1 actor 只接收 selected transcript blocks 与这些 blocks 显式引用的可用事件；未被 block 引用的 event 即使是 player-visible，也不自动等于该角色已知。
- referee prompt 必须携带 Play-local visibility map；Director objective / risk、其它 participant 私有知识、`playerUnknown` state / event / schedule / momentum 与 hidden cause 都属于 referee-private context。公开 title / summary、observation、suggestion 与 state value 只能描述对应 visibility 下可感知的结果。
- persisted Player Result 只读取 selected committed branch，排除 `directorOnly` / `playerUnknown` blocks；nested `stateDelta` 先展开为 dotted leaves，只展示 exact `playerVisible`，缺失、`rumor`、`playerUnknown` 与 `worldMomentum.*` 一律 fail closed。

宿主能确定性保证的是输入过滤、结构化 ref / visibility 校验、projection 与已知 forbidden-ref 拒绝；它不能从语义上证明模型自然语言绝不暗示一个未显式引用的隐藏事实。F1 必须在 UI 与测试中保持这一区分，不把 prompt 约束宣传为零泄漏证明。

## 11. UI / UX 计划

### 11.1 Play Landing

顶级 Play 入口先呈现两类用途：

| 用途 | 面向用户的说明 |
|---|---|
| Immersive Journey | 以玩家身份进入世界，持续行动并观察外部变化 |
| Scene Rehearsal | 以作者 / 导演身份逐角色校准一个场景 |

然后选择：

- Quick Start：沿用当前短表单。
- Guided Start：进入五步向导。

### 11.2 Guided Start 五步向导

1. **Sources**：选择章节、角色、世界、时间线与状态来源，预览 activated content 与 stale diagnostics。
2. **Entry**：选择入场点，确认地点、时间、气氛、触发、目标与风险。
3. **Identity**：选择玩家 persona，或填写 Director rehearsal purpose。
4. **Cast**：确认参与者、位置、目标、知识边界与 order strategy。
5. **Review**：显示 Launch Package 摘要、隐藏信息警告与“开始 Play”确认。

向导中的 suggestion 只填充草稿，不自动进入下一步或创建 session。

### 11.3 Scene Rehearsal Workspace

建议布局：

```text
┌ Scene Contract / world clock / attempt status ┐
├ Actor Queue ┬ Narrative / Transcript ┬ Inspector ┤
│ 当前/等待   │ provisional step       │ Scene     │
│ 插队/跳过   │ selected variant       │ Knowledge │
│ 角色状态    │ committed history      │ Anchors   │
│             │                        │ Events    │
├─────────────┴ Director Control Bar ┴────────────┤
│ Accept · Revise · Retry · Insert · Grant · Finish │
└─────────────────────────────────────────────────┘
```

交互约束：

- provisional、selected 与 committed 必须在视觉和文案上明确区分。
- 修改较早步骤时，先显示将失效的后缀，再确认 fork。
- Immersive Journey 不强制显示逐角色确认条。
- Director controls 支持键盘操作、明确 focus 顺序与 `aria-live` 状态。
- streaming / resolving / validating / prepared / committing 使用文本与图标，不只依赖颜色。
- respect `prefers-reduced-motion`，状态变化不使用强制动画。

### 11.4 视觉设计约束

所有新增或触及的 Play UI 必须遵循根目录 `DESIGN.md`：

- 使用类似 Codex / WebStorm 的黑白、灰阶、简洁工作台视觉。
- 颜色只表达 error、warning、success、selected 等语义状态。
- 使用全局 design tokens，不新增组件私有暖棕、橙色、米黄背景或装饰色。
- 不在 Play 组件中硬编码 Georgia 等与全局产品不一致的字体。
- 当本计划触及现有 Play 组件时，应顺带迁移其暖色硬编码到中性 token；不要把局部暖色风格继续扩散。

这属于当前功能 UI 的一致性要求，不等同于 MuseAI P2 的视觉沉浸增强。

## 12. Writing Bridge 与 adoption

### 12.1 默认不自动进入写作上下文

角色推演结束后，报告默认留在 `.workspace/play-sessions/<id>/reports/`。系统不得：

- 自动修改章纲；
- 自动把全部 transcript 注入下一次写作 prompt；
- 自动更新角色卡或关系；
- 自动把“推演中发生”当作小说已发生。

### 12.2 两条显式回流路径

1. **Use as Writing Reference**
   - 在 `.workspace/writing-references/<attachment-id>.yaml` 创建由用户选择的非 canonical context attachment。
   - 记录 report ref、stable selected outcome item refs、selected turn / evidence closure、source base 与创建时间。
   - 写作时只有当前请求显式携带该 attachment id 才进入 context package；`active` 不等于自动注入。

2. **Adopt into Canon**
   - 从 outcome report 生成 observation / adoption candidates。
   - 映射到现有 `chapterDraft | state | timeline | foreshadow` 等合法目标。
   - 创建 PendingAction，展示 SemanticPatch / diff。
   - 用户 accept 后才写真实目标文件并按配置 Git commit。

当前 adoption target 不包含 `chapterPlan / sceneOutline`。如未来确有需求，应单独增加真实 write-intent target、schema 和测试，不能把章纲内容伪装成 `chapterDraft`。

## 13. API 与事件契约候选

### 13.1 Endpoint

候选接口：

```text
POST /api/workspace/play-setups/preview
POST /api/workspace/play-setups
POST /api/workspace/play-sessions
POST /api/workspace/play-sessions/:id/attempts
GET  /api/workspace/play-sessions/:id/attempts/active
GET  /api/workspace/play-sessions/:id/attempts/:attemptId
POST /api/workspace/play-sessions/:id/attempts/:attemptId/steps/next/stream
POST /api/workspace/play-sessions/:id/attempts/:attemptId/steps/:stepRunId/stop
POST /api/workspace/play-sessions/:id/attempts/:attemptId/interventions
POST /api/workspace/play-sessions/:id/attempts/:attemptId/finalize
POST /api/workspace/play-sessions/:id/attempts/:attemptId/cancel
POST /api/workspace/play-sessions/:id/reports/outcome
```

新 session 创建不需要 revision token；任何修改既有 session 的 setup / attempt 入口沿用 Play 的 `baseRevision` 术语，并由具体 route 明确 required / optional。attempt 创建后，每个 step、intervention、finalize 与 cancel 请求必须携带 `expectedAttemptRevision` 和 `idempotencyKey`；finalize 还必须携带 `selectedHeadRef` 并重新校验 session `baseRevision`。接口返回 session conflict 与 attempt conflict 两种结构化错误，不能把二者合并成一次 last-write-wins。接口命名应在 F1 task 中继续对照现有 backend route 风格冻结。

### 13.2 Stream Event

```text
play.attempt.started
play.actor.step.started
play.actor.step.delta
play.actor.step.prepared
play.actor.step.selected
play.actor.step.stream-aborted
play.director.intervention.recorded
play.attempt.prepared
play.attempt.committed
play.attempt.cancelled
play.attempt.failed
```

必须保证：

- client 在 backend 开始任务前注册 pending run / subscription，避免快任务先完成后丢 terminal event。
- actor-step 与 attempt terminal event 可幂等处理；重连不会重复干预或重复提交 turn。
- narrative delta 只是 provisional projection，不在流式过程中修改 committed transcript。
- `play.actor.step.stream-aborted` 只表示停止当前 step 的生成；`play.attempt.cancelled` 才表示丢弃整个 attempt。attempt 尚未形成 turn 时不得发出 `play.turn.cancelled`。
- 当前 turn stream 把 provider、settlement 与 write 绑定在一次 lifecycle 内，不能原样当作 actor-step stream。F1 需要最小抽取并复用 provider delta / reset / abort / run-registry primitive，为 step run 与 attempt 建立独立 identity、Stop 和 terminal truth；这属于 F1 功能 seam，不是新的通用 runtime。
- F1 的 `POST .../finalize` 是不调用 provider 的 typed transaction endpoint：在 session lock 下调用抽取后的 settlement apply seam 与 staged writer，成功时以 typed JSON 返回 committed session、owning turn artifact 和 attempt receipt，并可在 attempt channel 发布幂等 `play.attempt.committed`。它复用 commit barrier 的内部“提交开始后不可取消”语义，但不截取或伪造稳定 `play.turn.started -> ... -> play.turn.committed` SSE lifecycle 的尾段。
- finalize 实际返回 `session + optional attempt + artifact + evidence + receipt + replayed`；receipt-only replay 时 committed attempt recovery 可以已经清理。Stop 使用 `cancelling | aborted | committing | prepared | failed` 权威状态；Accept / Cancel / Finish 断响应时 Client / Desktop 先按 receipt 对账，再以同一 key replay，未确定期间锁定其它 mutation。
- actor step stop / attempt cancel 不得伪装成 `play.turn.cancelled`。如果未来产品需要把 finalize 改为 streaming run，必须定义完整的 attempt-finalize 协议并同步更新 Spec、Backend、Client 与 reducer。

## 14. Schema 与迁移策略

### 14.1 版本门槛

当前以 `1120` 已落地的 session v4 为兼容读取基线。F1 创建 rehearsal session 时必须升级 parent session schema（当前预计为 v5），并把纳入 staged snapshot 的 versioned `scene-rehearsal.yaml` 设为该版本的必需文件；旧 v4 reader 因 future session version fail closed，不能误按 Quick Start 打开后删掉 sidecar。既有 v4 若不转换，仍保持 `immersiveJourney + quick` 且无需重写；若转换为 rehearsal，则进入下面的条件式 migration confirmation。若 owning turn artifact 需要新增 rehearsal evidence ref，F1 task 必须同时冻结 artifact version、旧 artifact 兼容、Core / Client guard 与 round-trip fixture。

migration confirmation 是**条件式门槛**，不是所有功能的全局前置：只有某个切片需要把旧 session 本身持久化升级到新 schema，或把既有 session 转换为 rehearsal 时，才必须在该切片内同时交付 preview、backup、confirm、cancel 与错误恢复。任何升级都必须保留 v4 branch base / cutoff 证据，并遵循：

- 所有既有 v1–v4 session 仅在 rehearsal sidecar 同样缺失时解释为 `purpose: immersiveJourney`、`startMode: quick`；旧 parent + orphan sidecar、新 parent 缺 sidecar，或 parent / sidecar capability / version 不匹配都必须 fail closed。
- 不要求批量重写所有旧 session。
- 首次显式升级前生成 backup 与 preview。
- 保留未知字段，拒绝未来 schema，而不是静默丢弃。
- `branchSnapshotRequiredFromRevision` 与 `branchBaseSnapshot` 不得被删除或重算成宽松默认值；新 artifact 必须继续从完整 parent 或对齐的 branch base 验证。
- 旧 string character name 尽可能解析为 stable participant ref；无法解析时创建 guest ref，不伪造 canonical character id。

### 14.2 Setup stale

恢复 session 时：

- source hash 一致：正常继续。
- hash 变化但 refs 仍存在：提示 canonical drift，并进入 `1120` 的 rebase / fork 决策。
- source 删除或身份冲突：阻止无提示继续，展示缺失来源。

本阶段只实现最低正确性保护。可视化 setup 版本历史、跨设备共享、自动批量重建与复杂 upgrade wizard 暂缓。

## 15. 实施顺序：用户功能纵向切片

### Foundation Baseline：已满足，不是 Gate

现有 `1120` 能力足以开始开发。后续实现时按下列 F1–F4 建立独立 task，并让每个 task 同时包含必要的 Core、Backend / Client、Desktop UI 和用户旅程测试；不得把角色推演范围追加进 `1120`，也不得先拆成长期不可玩的横向平台任务。

### F1：First Playable Scene Rehearsal

状态：**Completed（2026-07-15）**。实现与验收记录见 `docs/tasks/1130.md` 和 `docs/superpowers/plans/2026-07-15-play-scene-rehearsal-f1.md`。

范围：

- parent session next schema version + versioned `scene-rehearsal.yaml` 中的 `purpose: sceneRehearsal`、`startMode`、active scene 与 compact Scene / Cast / Review；旧 writer 必须因 future parent version fail closed。
- 最小 Scene Contract、session-local participant ref、固定 actor queue、不可变 initial knowledge evidence 与 participant-specific perception。
- turn attempt、character step、NarrativeBlock 与单一 world referee 下的 voice / state module。
- `Accept | Retry | Finish | Cancel` 四个首版控制；Retry 只产生 attempt-local variant。
- selected steps 聚合成一份 `PlayWorldRefereeSettlement`；从现有 settlement 路径最小抽取 typed normalize / validate / apply seam，并复用 base-session hard-due evaluator 与 staged commit 一次提交。
- committed selected-step / NarrativeBlock evidence 与 owning turn artifact stable ref；Core writer / reader、Client guard 和 selected-branch projection 同步扩展。
- 每 step `settlementEventRefs`、exact derived world notice 与独立 `hostNarrativeBlocks`；公开 hard-due 同时进入主 transcript，但不归因给 participant。
- 最小抽取 provider delta / reset / abort / run primitive，建立独立 step-run / attempt identity；finalize 只复用 commit barrier 的内部不可取消提交语义，不发残缺的 `play.turn.*` lifecycle。
- Scene Contract 摘要、actor queue、provisional step、selected / committed 区分和简要结果面板。
- 单 active attempt、attempt revision、idempotency、finalize 时的 session revision recheck，以及 `.recovery` 中未提交 attempt 不冒充 truth。
- 四个控制、actor queue 与状态变化的 keyboard / focus、`aria-live`、screen-reader label 和 reduced-motion 基线。

Done Criteria：

- 用户能从 Play Landing 进入 Scene Rehearsal，并完成 compact Scene / Cast / Review。
- 每个角色输入与结构化 projection 只包含其 perception package；被排除的 hidden refs 在 package、structured effect、suggestion 与 Player result 中确定性不可见。自然语言仍受 prompt / forbidden-ref 检测约束，F1 不声称能从语义上证明模型绝不暗示未知事实。
- initial knowledge ref 解析到 sidecar 内冻结的 minimal fact + source identity / hash 或 author provenance；canonical source 后续变化不会静默改写当前 attempt 的 perception。
- Accept / Retry 能在 attempt 内选择结果，不改变 committed session。
- Cancel 后 revision、clock、state、events、schedule、knowledge 与 transcript 完全不变。
- Finish 只提交 selected steps 一次，session revision 只推进一次，base-session hard-due event 只结算一次；重开后 owning turn 仍能解析到 committed selected-step / block evidence。
- Core / Client 对 aggregate blocks、per-step / host event partition、visibility dominance 和 notice content fail closed；Player Result 对 nested state 与 hidden / rumor / `worldMomentum` fail closed。
- provisional / selected / committed 无需依赖颜色即可区分；step Stop、attempt Cancel 与 turn commit 使用不同 terminal truth，断流后都能对账。
- F1 四个控制可仅用键盘完成，焦点返回与状态播报可验证，并尊重 reduced motion。
- Quick Start 与 Immersive Journey 回归通过，并有一条 Desktop 完整旅程测试。

### F2：Source-backed Guided Start

状态：**Completed（2026-07-16）**。实现与验收记录见 `docs/tasks/1140.md` 和 `docs/superpowers/plans/2026-07-16-source-backed-guided-start-f2.md`。

范围：

- 完整 `PlaySessionPurpose` / `PlayStartMode` 与五步 Guided Start。
- Launch Package preview / create、真实 activated source 选择、entry point、player / director role。
- source identity、content hash、missing / stale diagnostics、participant role 与初始知识边界。
- Quick Start 继续使用保守默认值，不被强制进入向导。

Done Criteria：

- 用户可从真实 source refs 创建并预览开局包，且不建立平行 source map / world clock truth。
- 最终确认前不创建 session truth，也不修改 canonical 文件。
- source 缺失或 stale 时首版可阻止启动并要求重新确认，不等待完整 rebase / fork UI。
- 所有未转换且没有 rehearsal sidecar 的既有 v1–v4 session 继续解释为 `immersiveJourney + quick`；旧 parent + orphan sidecar、新 parent 缺 sidecar，或配对版本不一致均 fail closed。

实现记录：schema v1 Launch Package、raw-byte SHA-256 source evidence、zero-write preview、server-authoritative confirm、immutable `.workspace/play-setups`、全来源 drift revalidation、v4 / v5 bridge 与五步 Desktop Guided Start 已落地。session 继续以 `activated-sources.yaml` 为唯一 source hash truth；metadata 只保留 setup provenance。Quick Start、既有 v1–v4 与 F1 rehearsal 均通过回归。

### F3：Outcome And Explicit Writing Handoff

范围：

- 从 committed selected branch 按需生成 evidence-backed outcome report 与 per-character footprint。
- 每个 outcome item 携带 visibility、turn / event / source refs、goal / divergence / consistency 标签。
- Player / Director report projection 与 spoiler 防旁路。
- 用户选择具体 outcome item 创建非 canonical `Use as Writing Reference` attachment。
- observation / adoption candidate 分组审阅，继续走 PendingAction / diff / Human Approval。

Done Criteria：

- report 只来自 committed selected branch；discarded / unselected variant 不进入 report。
- 标题、label 与 Player projection 不泄漏 hidden outcome，也不保存 chain-of-thought。
- Writing Reference 只有在当前写作请求显式选择 active、非 stale attachment id 时才进入 context。
- detach 保留审计但停止消费；canonical 变化只有 PendingAction accept 后发生。

Outcome 不等待完整 Scene Memory。Memory 可随后作为可重建 projection 与长 session 优化增加，不能反过来阻塞写作回流。

### F4：Advanced Director Controls And Long-session Rehearsal

范围：

- `reviseProjection` 与重新裁决的 `redirectStep` typed artifact。
- earlier-step fork、provisional overlay evaluator、due-set 重算、suffix invalidation、step variant preservation 与 committed checkpoint / variant 对接。
- `insertActor`、持久化 `grantKnowledge`、dynamic / hybrid order、停滞检测与 `noMaterialEffect`。
- branch-local knowledge / reveal store、knowledge / behavior anchor / event inspector 与 Player / Director 双 Lens。
- visibility-aware Scene Memory、stale / rebuild、高级控制的完整键盘 / screen-reader 旅程与长列表体验。

Done Criteria：

- revise / redirect / insert / grant 均有严格 typed payload，不接受自由 `unknown` effect。
- 修改较早步骤前明确预告失效后缀；历史 variant 不被覆盖。
- `grantKnowledge` 只改变指定 participant 的 branch-local perception，并随 Restore / Retry 正确恢复。
- 通用 turn transport、reducer、event engine 与 committed checkpoint / variant 继续复用现有能力，不出现第二套实现。

### H：并行 Hardening / Release Track

- cooperative cross-process session / attempt lock 与当前 F1 触发的 crash recovery 已落地；fsync、完整故障注入矩阵、长期 quarantine / stage 清理、可重启 terminal registry 与 graceful shutdown 仍待完成。
- provider / source deadline、bounded read、SSE backpressure、summary / detail 与 windowing。
- 仅在持久化 schema 升级被具体切片触发时交付 migration confirmation。
- 更完整的 browser smoke、跨进程故障矩阵和旧 endpoint deprecation。

H 不作为 F1–F3 的统一前置。若出现可复现的数据丢失、历史覆盖、安全边界破坏，或某个切片直接改变对应持久化 / 并发保证，相关项才升级为该切片的局部 gate。

`chapterPlan / sceneOutline` 是否成为新 canonical adoption target 不属于 F3。当前继续使用既有目标；如需要新目标，必须形成独立 design decision，并由另一个 task 冻结 write intent、SemanticPatch 与审批测试。

## 16. 验收场景

以下场景是完整升级的验收目录，不代表实现顺序。F1 首先验收：进入 Scene Rehearsal、compact Scene / Cast / Review、perception 输入与结构化 projection 隔离、Accept / Retry 选择 attempt-local variant、Cancel 零提交、Finish 单 revision 原子提交，以及现有 Quick Start 无回归；之后再按 F2、F3、F4 扩展到完整 Guided、写作回流和高级 Director 控制。

### 16.1 Guided Start

1. 用户选择章节、两个角色和时间线，系统生成带 path / object id / hash 的 Launch Preview。
2. 用户修改入场点和角色位置，在最终确认前项目文件与 Play session 都不改变。
3. source hash 已变化时，系统展示 stale，而不是静默用旧摘要继续。
4. 用户仍可用现有短表单创建 `immersiveJourney + quick`。

### 16.2 知识边界

1. 角色 B 不知道只有角色 C 目击的事实。
2. B 的 perception package 与结构化 step refs 不包含该事实；检测到 forbidden ref 的输出被拒绝。自然语言仍按模型输出风险处理，不声称语义零泄漏证明。
3. Director 对 B 执行 `grantKnowledge` 后，新事实只从指定 step 生效。
4. grant 的来源、操作者和目标角色可审计。

### 16.3 修改与重演

1. A 的 step 被接受，B 已生成 provisional step。
2. Director 用 `redirectStep` 修改 A 的行动结果，而不是只改措辞。
3. 系统从 A 的 before-step snapshot 创建 variant，保留旧 A / B。
4. 旧 B 被标记 superseded，新 B 基于修改后的场景与 perception 生成。
5. 主 transcript 只投影最终 selected branch。

### 16.4 世界事件与原子性

1. 当前回合存在 hard-due event。
2. 即使角色顺序由 Director 固定，事件仍由 host / referee 在确定性边界结算。
3. `finish` 将 selected narrative、每 step 的 `settlementEventRefs`、独立 host hard-due notice、state、event、knowledge、clock 与 turn artifact 一次提交。
4. 任一验证或写入故障都不产生混合 revision。
5. `cancel` 后所有 committed 文件与开始前完全一致。
6. F4 中某个 provisional step 改变时间或 event precondition 时，纯 overlay evaluator 与 committed evaluator 输出一致，并在需要时失效后缀；F1 只冻结 base-session due skeleton，hard-due event 最终只提交一次。

### 16.5 结束与回流

1. 系统只从 committed selected branch 生成结果报告。
2. 报告列出目标达成、角色变化、知识变化、世界变化、偏离与 evidence refs。
3. 用户选择 `Use as Writing Reference` 后，它只成为 `.workspace` context attachment。
4. 用户选择 adoption 后，先看到 PendingAction diff。
5. 只有 accept 后 canonical 文件才改变。

### 16.6 兼容性

1. 所有未转换且没有 rehearsal sidecar 的既有 v1–v4 session 能按 `immersiveJourney + quick` 打开；旧 parent + orphan sidecar、新 parent 缺 sidecar，或配对版本不一致时拒绝读取。
2. 现有普通 Play 回合不出现 actor-by-actor 强制确认。
3. spoiler 关闭时，hidden event 不从 outcome、suggestion 或 inspector 泄漏。
4. H / 长篇 release 验收中，长 transcript 使用 windowing，恢复后 selected path 一致；这不阻塞 F1。

## 17. 测试计划

测试继续放在根目录独立 workspace，不在 `packages/*/src/__tests__` 新建测试。测试随 F1–F4 纵向增加，不要求 F1 开发前先完成全量 schema、windowing 或跨进程故障矩阵。F1 至少覆盖 compact setup、perception filtering、Accept / Retry / Finish / Cancel、hard-due 单次结算、零提交取消、一次原子 finalize 和一条 Desktop 完整旅程。

### 17.1 `__test__/core`

- parent session v5（以 task 冻结版本为准）+ versioned `scene-rehearsal.yaml` purpose / start mode / active scene / initial knowledge evidence schema；v1–v4 与 sidecar 同时缺失时使用兼容默认，旧 parent + orphan sidecar、新 parent 缺 sidecar、版本 / capability 不匹配全部 fail closed，旧 v4 reader 拒绝 future session。
- attempt state machine 与非法 transition。
- attempt revision guard、同 key 同 / 不同 payload、receipt replay、双 accept / 双 finalize 与单 active attempt。
- stable participant refs 与 guest migration。
- perception filtering 与 hidden visibility。
- initial knowledge evidence record 的 version / participant / visibility / source hash / frozen fact round-trip，以及 canonical source drift 后 perception 不被静默替换。
- omission metadata 不得包含 hidden fact 的标题、实体、路径或语义摘要。
- earlier-step fork / suffix invalidation。
- projection-only revise 保持 effect fingerprint；redirect step 必须重裁决。
- provisional contribution 只能汇入 F1 抽取的 typed settlement normalize / validate / apply seam，没有第二 reducer。
- F1 base-session due skeleton 与 finalize 单次提交；F4 overlay evaluator / suffix invalidation 一致性。
- finish atomicity、cancel no-op 与 recovery classification。
- committed selected-step / NarrativeBlock evidence、owning artifact ref、staged snapshot round-trip 与 Client guard。
- provisional / committed notice 的 exact cardinality、per-step event partition、host hard-due block、派生内容、top-level deep equality、hidden / rumor omission 与 visibility widening rejection。
- outcome / memory 只使用 selected committed branch，并逐项执行 visibility projection。
- memory source / revision / selected-path stale 与 rebuild。
- writing attachment active / detached / stale 生命周期。

### 17.2 `__test__/agent`

- 每个 participant 只得到允许的 context。
- omitted trace 的诊断本身也不能泄漏 hidden fact / entity / title。
- behavior anchors 和 source refs 正确进入受控 prompt package。
- 无 chain-of-thought 持久化。
- world referee 是唯一 effects 裁决者。
- `noMaterialEffect` 与停滞提示。
- invalid / leaked / unsupported effect 被拒绝。

### 17.3 `__test__/backend` 与 `__test__/client`

- session revision 与 attempt revision 两类 conflict。
- mutation idempotency receipt、同 key 不同 payload conflict 与重复 finalize 防护。
- active attempt 期间拒绝同 session 的 transcript append、observation、adoption、checkpoint restore、committed-turn Retry 与普通 turn，并允许只读查询及本 attempt mutation。
- F1 抽取的 provider delta / reset / abort primitive 保持现有 chunk / cancel 语义；step run、attempt 与 committed turn identity 严格分离。
- finalize typed JSON response / `play.attempt.committed` receipt 幂等；不发残缺的 `play.turn.*` SSE 尾段，并保持提交开始后不可取消的 barrier 语义。
- subscription-before-start race。
- step stream abort、attempt cancel 与 turn commit failure 的不同语义。
- reconnect 后不重复 finalize。
- setup stale / missing source diagnostics。

### 17.4 `__test__/desktop-ui`

- F1：compact Scene / Cast / Review、actor queue、provisional step、Accept / Retry / Finish / Cancel 与简要结果。
- Guided Start 五步流。
- 七个 Director 控制，以及“修改”的 projection-only / redirect 两种协议分支。
- provisional / selected / committed 展示。
- Player / Director lens 与 spoiler gate。
- Player outcome / attachment label 不旁路泄漏 hidden item。
- F1 四个控制、actor queue、focus return、screen-reader status announcement 与 reduced motion 基线。
- F4 全部高级 Director 控制的 keyboard-only / screen-reader 完整旅程。
- neutral token / no warm hardcoded style regression。

### 17.5 回归测试

- 现有 Quick Start。
- 现有 Immersive Journey turn。
- world HUD / event feed。
- observation / adoption。
- v2 session fixture。
- checkpoint / variant / retry 与新 attempt 的组合。

## 18. 风险与控制

| 风险 | 表现 | 控制 |
|---|---|---|
| 概念混淆 | rehearsal purpose 被误当 world mode | purpose、start mode、simulation mode 三个正交字段 |
| 多 Agent 蔓延 | 每角色一套 runtime / tool 权限 | 角色是受限 module，单一 referee 裁决 |
| 确认疲劳 | 每句话都阻断用户 | 只在 rehearsal purpose 启用逐步控制；支持连续 / hybrid 策略 |
| 串行延迟与成本 | 多角色步骤模型调用过多 | 逻辑分层不强制多调用；缓存 perception，允许批量准备 |
| 知识泄漏 | 角色使用 hidden facts | participant-specific perception + visibility tests |
| 强制造戏 | 每角色必须制造变化 | 合法 `noMaterialEffect`，停滞时询问而非自动加冲突 |
| 私有推理泄漏 | 报告保存 chain-of-thought | 只持久化 source refs、短标签与 validation |
| 分支爆炸 | retry / revise 产生大量 variant | selected path、retention policy、显式清理；不混入主 transcript |
| attempt 并发乱序 | 双 accept、重复 grant 或 finalize | attempt revision guard、idempotency key、单 active attempt、finalize 时再次检查 session `baseRevision` |
| provisional 被当真 | crash 后草稿显示为已发生 | `.recovery` 隔离、prepared / committed marker、原子 finalize |
| setup 成第二事实源 | canonical 已变但继续用旧副本 | refs + hash + drift / rebase / fork，不复制全文 |
| 世界事件被角色流程绕过 | 固定轮序阻止 hard-due event | host evaluator 在角色步骤外部保持权威 |
| 报告旁路剧透 | outcome / attachment label 暴露 hidden item | 逐项 visibility 与独立 Player / Director projection |
| GPL 污染 | 复制参考 prompt / schema / 文案 | 只吸收抽象方法，独立命名、建模、实现与测试 |
| 视觉回退 | 新 UI 继续扩散暖色局部样式 | `DESIGN.md` neutral tokens 作为 Done Criteria |
| 基础设施 Gate 无限延期用户价值 | 等待全部 durability / scale backlog 才开始 Play 功能 | F1–F4 纵向切片；只把具体触发的 correctness dependency 设为局部门槛 |
| 横向任务产生长期半成品 | Core、transport、UI 分别“完成”但没有可玩旅程 | 每个功能 task 同时包含最小 UI、真实交互验收与端到端回归 |

## 19. 当前阶段明确暂缓的 MuseAI P2

用户已明确当前阶段不需要 MuseAI P2：沉浸与跨设备增强。因此以下内容不进入 F1–F4，不作为当前验收依赖：

- LAN、远程访问、移动端适配与跨设备同步。
- 头像、立绘、场景图、视觉素材生成与附件演出。
- TTS、角色语音、音效与多媒体时间线。
- 全屏沉浸演出、动画化场景切换与视觉小说式呈现。
- 面向普通用户暴露 referee / planner / narrator 等分阶段模型 profile。
- 高级 Play Setup 版本管理、批量升级、自动重建与跨设备分发 UI。

以下内容虽然与 setup 有关，但因属于正确性底线而继续保留：

- source refs 与 content hash；
- stale / missing source 警告；
- canonical drift 时的 rebase / fork 边界；
- session 恢复的一致性检查。

暂缓 P2 不意味着降低当前 UI 的基础质量。Play 仍须响应当前桌面窗口尺寸、可键盘操作、可访问，并遵循 `DESIGN.md` 的黑白中性设计。

## 20. 完成定义

### 20.1 First Usable Rehearsal Done（F1）

状态：**已满足（2026-07-15）**。

首个可用里程碑不等待完整 Guided Start、七类控制、Memory 或通用 hardening；满足以下条件即可交付并进入真实使用反馈：

- Play 仍是与 Writing 同层级的顶级工作区，Quick Start 与 Immersive Journey 无回归。
- 用户能完成 compact Scene / Cast / Review，并按 participant perception 生成角色步骤。
- `Accept | Retry | Finish | Cancel` 可用，provisional / selected / committed 清楚区分。
- perception 输入和结构化 refs 确定性隔离 hidden evidence；自然语言输出风险被明确披露并有 forbidden-ref 拒绝边界。
- 所有角色 effects 仍由单一 world referee 裁决；base-session hard-due 与 visibility 规则没有被 attempt 绕过。
- step run / attempt / committed turn 的 identity 与 terminal truth 分离；Finish 通过 typed transaction endpoint 原子提交，不伪造 turn SSE lifecycle。
- Finish 只原子提交一次 turn，且重开后仍能从 owning artifact 找到 selected-step / NarrativeBlock evidence；Cancel 对权威 session 零写入。
- 新 UI 遵循黑白 / 灰阶全局 tokens，四个控制具备键盘、焦点、状态播报和 reduced-motion 基线，并有一条 Desktop 完整旅程测试。

### 20.2 Full Upgrade Done（F1–F4）

完整升级满足以下条件：

- Guided Start 能从真实来源构造可复核的 Scene Contract。
- Scene Rehearsal 能按角色知识边界逐步推演。
- 所有角色 effects 仍由单一 world referee 裁决。
- Director 七个用户控制不破坏历史；修改动作具有明确 typed 语义，较早重定向会形成 variant。
- 一轮推演只有 finalize 后才原子提交一次 turn。
- 世界时间、到期事件、state、knowledge 与 transcript 保持同 revision。
- outcome report 只使用 selected committed branch，并提供 evidence refs。
- 写作参考与 canonical adoption 都必须由用户显式选择。
- 新 UI 遵循黑白 / 灰阶全局 tokens，不扩散暖色局部设计。
- MuseAI P2 沉浸与跨设备增强没有混入当前里程碑。
- 对应 task、plan、schema fixture、根目录测试 workspace 与 Implementation Notes 在实施时完整更新。

## 21. 参考资料

OAN 稳定文档与当前计划：

- `DESIGN.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT_PLAN.md`
- `docs/PLAY_MODE_SPEC.md`
- `docs/PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md`
- `docs/MUSEAI_PLAY_MODE_REFERENCE_ANALYSIS.md`
- `docs/NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md`
- `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`
- `docs/NOVEL_AGENT_COPILOT_SPEC.md`
- `docs/tasks/1060.md`
- `docs/tasks/1090.md`
- `docs/tasks/1120.md`

本地 reference-only 资料：

- `reference-only/awesome-novel-skill/README.md`
- `reference-only/awesome-novel-skill/SKILL.md`
- `reference-only/awesome-novel-skill/ARCHITECTURE.md`
- `reference-only/awesome-novel-skill/LICENSE`
- `reference-only/awesome-novel-skill/LICENSE-DECLARATION.md`
- `reference-only/awesome-novel-skill/agents/novel-agent.md`
- `reference-only/awesome-novel-skill/skills/roleplay-sandbox.md`
- `reference-only/awesome-novel-skill/knowledge/format-specs/roleplay-sandbox-style.md`
- `reference-only/awesome-novel-skill/knowledge/format-specs/character-setting-style.md`
- `reference-only/MuseAI/README.md`
- `reference-only/MuseAI/PRODUCT.md`
- MuseAI 穿书、冒险、角色、记忆、session 与对应测试代码，详见 `docs/MUSEAI_PLAY_MODE_REFERENCE_ANALYSIS.md`。

以上 reference-only 项目仅用于静态研究。后续实现必须保持 OAN 的独立命名、独立 schema、独立 prompt、独立代码和独立测试。
