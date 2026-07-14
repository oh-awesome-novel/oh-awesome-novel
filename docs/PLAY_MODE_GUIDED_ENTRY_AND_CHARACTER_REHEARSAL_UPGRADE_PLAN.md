# Play Mode 引导入场与角色推演升级计划

> 状态：Planned
>
> 文档目标：在现有顶级 Play 工作区与世界事件底座上，补齐“从小说素材进入可玩场景、按角色知识与行为依据进行推演、由作者逐步导演、结束后形成可追溯写作参考”的产品闭环。
>
> 产品层级：Play 与 Writing 是 workspace 内同层级的顶级功能；角色推演是 Play 的一种 session purpose，不是 Writing 侧栏工具，也不是第二套独立 sandbox。
>
> 规划边界：本文只规划后续能力，不修改现有实现、稳定规格或 task 状态；`docs/tasks/1120.md` 的 Remaining Review Scope 仍保持原范围。
>
> 当前阶段排除：MuseAI P2 的沉浸与跨设备增强，包括 LAN / 移动端 / 跨设备、头像与语音、视觉附件、沉浸式演出、面向用户暴露的分阶段模型配置，以及高级 setup 升级 / 重建体验。
>
> 分析日期：2026-07-14。

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
- session schema v2 与七个 Play-local 文件。
- world clock、event policy、typed world events 与 visibility。
- activated source 实际内容装载与路径约束。
- 单一只读 world referee endpoint。
- 必需的结构化 `oan-play-settlement`。
- staged directory snapshot、swap、恢复、session lock 与 revision CAS。
- hidden event 的 spoiler gate。
- HUD、event feed、observation 与 adoption candidate 流程。

这些能力是本计划的底座，不作为新功能重复立项。

### 2.2 `1120` 仍需先收口的冻结范围

`docs/tasks/1120.md` 已经明确以下 Remaining Review Scope：

1. provisional narrative stream 与 stop / cancel；
2. `turns/*.yaml` 结构化事实和 `transcript.md` 单向 projection；
3. fsync、跨进程锁、故障注入与残留 stage 清理；
4. v1 migration backup / preview / unknown field preservation；
5. schedule / pressure / agenda / hard-due evaluator 与严格 delta refs；
6. checkpoint / variant / retry 对 state、events、schedule、knowledge 与 transcript path 的一致恢复；
7. context trace、omitted source、canonical drift / rebase / fork；
8. session summary / detail 与长 transcript / event 窗口化；
9. 根目录 `__test__/desktop-ui`。

本计划不得把上述事项改名后当作新增，也不得把新的角色推演范围静默塞进 `1120`。正确顺序是：

```text
Gate 0：收口 task 1120 的冻结范围
  -> 新建独立 task：Guided Start / Scene Contract
  -> 新建独立 task：Character Rehearsal Protocol
  -> 新建独立 task：Director UI / Streaming
  -> 新建独立 task：Outcome / Memory / Writing Handoff
```

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
| 正确性 | 本地保存与阶段流程 | 作者逐步确认 | OAN 事务、CAS、visibility、PendingAction |

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

以下名称是候选实现契约，应在独立 task 中通过 schema 与 fixture 冻结。

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

- `activatedSources` 复用现有 `PlayActivatedSource` 的 `sourceId / path / reason / budgetLayer / semanticBoundary / trust`，只增加 setup 所需的 object identity、hash 与 role；Task A 不再定义平行 source identity。
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
interface CharacterPerceptionPackage {
  id: string
  participantRef: string
  sceneRevision: number
  visibleFactRefs: string[]
  visibleEventRefs: string[]
  observedNarrativeBlockRefs: string[]
  grantedKnowledgeRefs: string[]
  omissionMetadata: Array<{
    reason: 'budget' | 'semanticBoundary'
    omittedCount?: number
    opaqueTraceRef?: string
  }>
}
```

每个角色步骤只能读取该角色的 perception package。完整 hidden state 与带语义的 omitted trace 只属于 referee / Director；因 visibility 被排除的内容不得在角色 package 中留下“存在隐藏项”的提示。角色可见的 `omissionMetadata` 只用于 budget / semantic boundary，且只能包含通用 reason、数量和不透明引用，不能出现被省略事实的标题、实体、摘要或路径。不得把完整累积 transcript 原样发送给所有角色模块。

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

`ProvisionalPlayEffectRef` 只引用 attempt 内、遵循 `1120` `PlayTurnDraft` / typed event / strict state-delta 契约的子提案。它不是第二套 effect schema，也没有自己的 reducer；只有现有 world referee + validator 将选中贡献聚合成唯一 turn draft 后，才能交给 `1120` 的 commit API。

术语必须冻结：

- **Turn**：用户 / Director 的一次意图最终形成的原子 Play-local commit。
- **Attempt**：一次尚未提交的 turn 尝试，包含若干角色 step 与干预。
- **Step**：一个角色在 attempt 内的一次 provisional 反应。
- **Round**：UI 中的一轮 actor queue 分组，不是事实、时钟或事件结算边界。

并发契约同样必须冻结：

- 同一 session 同时最多存在一个 active attempt；active 期间拒绝其它会改变 session revision 的请求，只允许读取和该 attempt 的 step / intervention / finalize / cancel。
- 每个 attempt mutation 都必须携带 `expectedAttemptRevision` 与客户端生成的 `idempotencyKey`；成功后递增 `attemptRevision` 并持久化 receipt。
- 同 key、同 request fingerprint 返回原 receipt 指向的结果；同 key、不同 payload 返回 idempotency conflict。revision 不匹配返回结构化 attempt conflict，不能按到达顺序偷偷覆盖。
- attempt 不长期持有进程锁。`finalize` 必须同时校验 `expectedAttemptRevision`、`selectedHeadRef` 和 session `baseRevision`，随后调用 `1120` 唯一的 turn prepare / commit API。
- session CAS 失败时 attempt 保持未提交，并引导用户 rebase / fork；不能只因 attempt 内部 CAS 成功就覆盖新的 session revision。

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

角色步骤可能提出时间推进或改变 event precondition，因此 due set 不能只在 attempt 开头计算一次，也不能每个 actor 都提交一次。确定性规则是：

1. attempt 从 base session snapshot 计算 immutable due skeleton；在 base revision 已经 hard-due 的事件必须持续保留。
2. 每个角色 step 只能增加 provisional time / state contribution，不推进 committed clock。
3. attempt 每次准备 selected head 时，调用 `1120` 同一个 schedule / pressure / agenda evaluator，基于聚合后的 provisional `PlayTurnDraft` 重算 eligible / hard-due 集合。
4. 如果 due set 或其可见后果变化，attempt 回到 `running`，从最早受影响 step 起失效并重建后缀；未重新准备前不能 finalize。
5. finalize 在 session CAS 下再次运行同一 evaluator 与 validator；hard-due event 只随最终 turn commit 一次。

这套规则只定义角色推演如何消费 `1120` evaluator，不在 Task B 新建第二套 schedule 或 event engine。

## 9. 文件系统布局

候选布局建立在现有 `.workspace/play-sessions/` 之内：

```text
.workspace/
  play-setups/
    <setup-id>/
      setup.yaml
      source-map.yaml
      entry-points.yaml
      participant-roles.yaml
      diagnostics.yaml

  writing-references/
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

      turns/
        <turn-id>.yaml
      scenes/
        <scene-id>.yaml
      memories/
        <revision>.yaml
      checkpoints/
      variants/
      traces/
      reports/
        outcome.yaml
        outcome.md
      .recovery/
        turn-attempts/
          <attempt-id>/
```

约束：

- `turns/*.yaml` 是结构化事实；`transcript.md` 是单向展示投影。
- `.recovery/turn-attempts/` 是 shadow recovery，不属于已提交剧情。
- setup 保存 source refs / hashes，不保存 canonical 全文副本。
- outcome YAML 是结构化报告，Markdown 是投影。
- `writing-references/<attachment-id>.yaml` 是 workspace-owned 的非 canonical attachment；它引用 session report / outcome item / turn / evidence，不复制 canonical truth，也不会因 `active` 自动进入 prompt。
- 所有真实 canonical 写入继续经过 PendingAction；Play-local session 写入遵循既有事务边界。
- 具体目录只有在对应 task 冻结 schema 后才能实施，本文不提前改变稳定 Filesystem Spec。

目录所有权必须明确：`turns/`、`checkpoints/`、committed `variants/` 与 `traces/` 由 `1120` 定义和维护；本计划只新增 `play-setups/`、workspace-level `writing-references/`、`scenes/`、`memories/`、`reports/` 与 `.recovery/turn-attempts/`，并通过既有 id 引用前述 artifact。Task B 的 attempt-local step graph 和 recovery shadow 不能变成另一套 committed checkpoint / variant 实现。

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
POST /play/setups/preview
POST /play/setups
POST /play/sessions
POST /play/sessions/:id/attempts
POST /play/sessions/:id/attempts/:attemptId/steps/next
POST /play/sessions/:id/attempts/:attemptId/interventions
POST /play/sessions/:id/attempts/:attemptId/finalize
POST /play/sessions/:id/attempts/:attemptId/cancel
POST /play/sessions/:id/reports/outcome
```

session 创建 / setup mutation 使用现有 `expectedRevision` 语义。attempt 创建后，每个 step、intervention、finalize 与 cancel 请求必须携带 `expectedAttemptRevision` 和 `idempotencyKey`；finalize 还必须携带 `selectedHeadRef` 并重新校验 session `baseRevision`。接口返回 session conflict 与 attempt conflict 两种结构化错误，不能把二者合并成一次 last-write-wins。接口命名应在任务实施时对照现有 backend route 风格调整。

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
play.attempt.cancelled
play.attempt.failed
play.turn.commit-started
play.turn.committed
play.turn.failed
```

必须保证：

- client 在 backend 开始任务前注册 pending run / subscription，避免快任务先完成后丢 terminal event。
- actor-step 与 attempt terminal event 可幂等处理；重连不会重复干预或重复提交 turn。
- narrative delta 只是 provisional projection，不在流式过程中修改 committed transcript。
- `play.actor.step.stream-aborted` 只表示停止当前 step 的生成；`play.attempt.cancelled` 才表示丢弃整个 attempt。attempt 尚未形成 turn 时不得发出 `play.turn.cancelled`。
- `play.turn.*` 复用 `1120` transport / commit 事件，Task B / C 只增加 actor-step 与 attempt phase，不复制 client adapter 或 reconnect runtime。

## 14. Schema 与迁移策略

### 14.1 版本门槛

不要在 `1120` 的 migration backup / preview / unknown field preservation 完成前仓促冻结 session v3。候选升级遵循：

- 旧 v2 session 默认解释为 `purpose: immersiveJourney`、`startMode: quick`。
- 不要求批量重写所有旧 session。
- 首次显式升级前生成 backup 与 preview。
- 保留未知字段，拒绝未来 schema，而不是静默丢弃。
- 旧 string character name 尽可能解析为 stable participant ref；无法解析时创建 guest ref，不伪造 canonical character id。

### 14.2 Setup stale

恢复 session 时：

- source hash 一致：正常继续。
- hash 变化但 refs 仍存在：提示 canonical drift，并进入 `1120` 的 rebase / fork 决策。
- source 删除或身份冲突：阻止无提示继续，展示缺失来源。

本阶段只实现最低正确性保护。可视化 setup 版本历史、跨设备共享、自动批量重建与复杂 upgrade wizard 暂缓。

## 15. 实施阶段与候选任务

### Gate 0：收口现有 `1120`

目标：`docs/tasks/1120.md` 当前列出的九项 Remaining Review Scope 全部收口，task 状态具备转为 Completed 的条件。不能只挑本计划最显眼的依赖项提前越过 Gate 0；其中 stream / cancel、turn artifact、事务硬化、evaluator、checkpoint / variant、context trace、migration、session summary / detail、windowing 与 `__test__/desktop-ui` 都必须完成。

约束：

- 不为赶角色推演而绕过 `1120` 的一致性门槛。
- 不把下面新任务内容追加进 `1120` Done Criteria。

### Task A：Play Guided Start And Scene Contracts

范围：

- `PlaySessionPurpose` 与 `PlayStartMode`。
- Launch Package preview / create。
- source map、hash、entry point、player / director role。
- Scene Contract、participant role 与初始知识边界。
- Quick Start 兼容。
- Guided Start 五步向导。

Done Criteria：

- 用户可从真实 source refs 创建并预览开局包。
- Launch Package 复用现有 activated source identity 与 context trace，不建立平行 source map / world clock truth。
- 创建前能看见 activated source、hash、缺失或 stale 诊断。
- Guided Start 在最终确认前不创建 session truth。
- 旧 v2 session 和 Quick Start 行为回归通过。
- 未产生任何 canonical 文件变化。

### Task B：Play Character Rehearsal Protocol

范围：

- turn attempt、character step、narrative block、perception package。
- actor order 与七个 Director 控制；“修改”细分为 projection-only 与重新裁决两类 typed artifact。
- 单 world referee 下的角色 voice / state module。
- attempt-local step graph、earlier-step fork、suffix invalidation 与 step variant preservation；committed variant / checkpoint 仍调用 `1120` 能力。
- attempt-level CAS、幂等 mutation、单 active attempt、finalize / cancel 与 recovery shadow。
- 选中 step contribution 聚合为 `1120` 唯一 `PlayTurnDraft`，并调用既有 validator / evaluator / commit API。
- 停滞检测与 `noMaterialEffect`。

Done Criteria：

- 每个角色只收到其 perception package。
- 世界到期事件在推演中仍由现有 evaluator 决定。
- accept / revise / retry / insert / grant / finish / cancel 均有 typed artifact，revise 不允许用自由 `unknown` payload。
- finish 只提交 selected prefix 一次。
- cancel 不改变 revision、clock、state、event、knowledge 与主 transcript。
- crash recovery 不把未提交 attempt 显示为真相。
- Task B 不实现第二套 reducer、event engine、committed checkpoint / variant 或 turn transport。

### Task C：Play Director UI And Actor-step Projection

范围：

- Scene Contract header、actor queue、first-class speaker blocks。
- Director control bar、Player / Director lens。
- 消费 `1120` 已收口的 stream / abort / reconnect / client adapter，仅增加 actor-step 与 attempt phase 的投影和控件；不重建 transport。
- knowledge / behavior anchor / event inspector。
- keyboard、screen reader、reduced motion。
- 触及组件的中性 design token 迁移。

Done Criteria：

- provisional / selected / committed 三种状态无需依赖颜色即可区分。
- earlier-step edit 会预告并正确失效后缀。
- Immersive Journey 不被强制进入逐角色确认流程。
- 所有 Director action 均有 loading、error、retry 和 conflict 状态。
- UI 不新增暖色硬编码，并符合 `DESIGN.md`。
- 通用 turn stop / cancel / reconnect 的所有权仍在 `1120`；Task C 只验证 actor-step / attempt 事件在现有通道上的正确呈现。

### Task D1：Play Memory And Outcome

范围：

- 带 selected turn refs、source hashes、session revision 与 stale / rebuild 状态的 visibility-aware scene memory。
- 逐项带 visibility、turn / event / source evidence 的 outcome report 与 per-character footprint。
- goal / divergence / consistency review。
- Player / Director report projection 与 spoiler 防旁路。

Done Criteria：

- memory 是可从 committed turn artifacts 重建的 projection，selected path / source / revision 变化会标记 stale。
- 报告只从 committed selected branch 生成。
- 角色复盘逐项引用 turn / event / source 证据，不输出 chain-of-thought。
- Player projection、标题与 label 都不会泄漏 hidden outcome。
- rejected / discarded variant 不进入 memory 或 report。

### Task D2：Play Writing Handoff

范围：

- `Use as Writing Reference` 非 canonical attachment。
- attachment 的 active / detached / stale 生命周期、source drift 与 writing context 显式选择。
- observation / adoption candidate 分组审阅。

Done Criteria：

- writing context 只有用户对当前写作操作显式勾选，并在请求中传入 active、非 stale attachment id 后才包含报告。
- detach 会停止消费但保留审计；source drift 会标记 stale 并阻止静默注入。
- canonical 变化只有 PendingAction accept 后发生。
- rejected / discarded variant 不进入 attachment 或 adoption。

`chapterPlan / sceneOutline` 是否成为新 canonical adoption target 不属于 Task D2。当前继续使用既有目标；如需要新目标，必须在 D2 之前形成独立 design decision，并由另一个 task 冻结 write intent、SemanticPatch 与审批测试。

## 16. 验收场景

### 16.1 Guided Start

1. 用户选择章节、两个角色和时间线，系统生成带 path / object id / hash 的 Launch Preview。
2. 用户修改入场点和角色位置，在最终确认前项目文件与 Play session 都不改变。
3. source hash 已变化时，系统展示 stale，而不是静默用旧摘要继续。
4. 用户仍可用现有短表单创建 `immersiveJourney + quick`。

### 16.2 知识边界

1. 角色 B 不知道只有角色 C 目击的事实。
2. B 的 perception package、生成 step 与 player-visible transcript 都不能使用该事实。
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
3. `finish` 将 selected narrative、state、event、knowledge、clock 与 turn artifact 一次提交。
4. 任一验证或写入故障都不产生混合 revision。
5. `cancel` 后所有 committed 文件与开始前完全一致。
6. 某个 provisional step 改变时间或 event precondition 时，prepare / finalize 用同一个 evaluator 重算 due set，并在需要时失效后缀；hard-due event 最终只提交一次。

### 16.5 结束与回流

1. 系统只从 committed selected branch 生成结果报告。
2. 报告列出目标达成、角色变化、知识变化、世界变化、偏离与 evidence refs。
3. 用户选择 `Use as Writing Reference` 后，它只成为 `.workspace` context attachment。
4. 用户选择 adoption 后，先看到 PendingAction diff。
5. 只有 accept 后 canonical 文件才改变。

### 16.6 兼容性

1. 旧 v2 session 能按 `immersiveJourney + quick` 打开。
2. 现有普通 Play 回合不出现 actor-by-actor 强制确认。
3. spoiler 关闭时，hidden event 不从 outcome、suggestion 或 inspector 泄漏。
4. 长 transcript 使用 windowing，恢复后 selected path 一致。

## 17. 测试计划

测试继续放在根目录独立 workspace，不在 `packages/*/src/__tests__` 新建测试。

### 17.1 `__test__/core`

- purpose / start mode / scene contract schema。
- attempt state machine 与非法 transition。
- attempt revision CAS、同 key 同 / 不同 payload、receipt replay、双 accept / 双 finalize 与单 active attempt。
- stable participant refs 与 guest migration。
- perception filtering 与 hidden visibility。
- omission metadata 不得包含 hidden fact 的标题、实体、路径或语义摘要。
- earlier-step fork / suffix invalidation。
- projection-only revise 保持 effect fingerprint；redirect step 必须重裁决。
- provisional contribution 只能汇入 `1120` 的 `PlayTurnDraft`，没有第二 reducer。
- due skeleton、prepare 重算与 finalize 单次提交。
- finish atomicity、cancel no-op 与 recovery classification。
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
- 复用 `1120` transport 的 stream event 顺序与 actor-step / attempt terminal idempotency。
- subscription-before-start race。
- step stream abort、attempt cancel 与 turn commit failure 的不同语义。
- reconnect 后不重复 finalize。
- setup stale / missing source diagnostics。

### 17.4 `__test__/desktop-ui`

- Guided Start 五步流。
- 七个 Director 控制，以及“修改”的 projection-only / redirect 两种协议分支。
- provisional / selected / committed 展示。
- Player / Director lens 与 spoiler gate。
- Player outcome / attachment label 不旁路泄漏 hidden item。
- keyboard-only 完整推演。
- screen reader status announcements。
- reduced motion。
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
| attempt 并发乱序 | 双 accept、重复 grant 或 finalize | attempt revision CAS、idempotency key、单 active attempt、finalize 双重 CAS |
| provisional 被当真 | crash 后草稿显示为已发生 | `.recovery` 隔离、prepared / committed marker、原子 finalize |
| setup 成第二事实源 | canonical 已变但继续用旧副本 | refs + hash + drift / rebase / fork，不复制全文 |
| 世界事件被角色流程绕过 | 固定轮序阻止 hard-due event | host evaluator 在角色步骤外部保持权威 |
| 报告旁路剧透 | outcome / attachment label 暴露 hidden item | 逐项 visibility 与独立 Player / Director projection |
| GPL 污染 | 复制参考 prompt / schema / 文案 | 只吸收抽象方法，独立命名、建模、实现与测试 |
| 视觉回退 | 新 UI 继续扩散暖色局部样式 | `DESIGN.md` neutral tokens 作为 Done Criteria |

## 19. 当前阶段明确暂缓的 MuseAI P2

用户已明确当前阶段不需要 MuseAI P2：沉浸与跨设备增强。因此以下内容不进入 Task A、B、C、D1、D2，不作为当前验收依赖：

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

本升级只有同时满足以下条件才算完成：

- Play 仍是与 Writing 同层级的顶级工作区。
- Quick Start 与现有 Immersive Journey 无回归。
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
