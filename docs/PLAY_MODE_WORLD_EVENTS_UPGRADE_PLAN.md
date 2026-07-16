# Play Mode 世界事件升级计划

> 状态：Functional Delivery In Progress / Needs Review
>
> 文档目标：把 Play Mode 从“角色对话沙盒”升级为“角色、时间、场景与外部世界共同推进的互动小说沙盒”。
>
> 产品层级：Play 与 Writing 是 workspace 内同层级的顶级功能；Play 不是 Writing 右侧面板中的 tab。
>
> 适用范围：OAN 顶级模式导航、Play session、world referee、Play-local state、桌面端 Play 工作区、checkpoint / variant、observation / adoption；不改变 canonical truth 的审批边界。
>
> 分析日期：2026-07-10。
>
> 执行顺序调整：2026-07-15。
>
> 当前执行原则：现有 session / artifact / staged snapshot、专用 SSE 与顶级 Play 工作区已经满足继续交付产品功能的门槛。M1 与跨计划 F1 已于 2026-07-15 落地；M2 worldline / event explanation 与跨计划 F2 Source-backed Guided Start 已于 2026-07-16 落地。下一功能主线进入 M3 branch-local knowledge / reveal 或角色推演 F3 Outcome / Writing Handoff；事务耐久性、迁移 UI 与长列表性能仍作为并行 correctness lane。

## 1. 结论摘要

Play Mode 下一阶段不应只是让更多角色轮流说话，而应让每个回合都可能推动一个持续运行的故事世界：时间流逝、NPC 在场外行动、组织推进计划、天气和地点发生变化、期限逼近、物品或证据转移、关系和资源产生后果。

升级后的核心公式是：

```text
Play Mode
  =
单一 World Referee
  + Character Voice / State Modules
  + 确定性的到期事件与压力评估
  + 结构化 PlayWorldRefereeSettlement
  + Play-local Turn Transaction
  + 可见的世界状态、事件与来源
  + Observation -> PendingAction Adoption
```

这里的“世界会自己变化”不等于后台常驻 Agent 或按现实时间偷偷运行：

- 世界只在用户提交行动、明确等待或推进时间时结算。恢复 checkpoint、切换 variant 或重开 session 只重建既有 snapshot；继续推进仍需用户显式行动或等待。
- NPC 与组织的自主性表达为 agenda、pressure、scheduled event 和 world rule，不表达为长期运行的独立 Agent。
- 模型负责理解、叙述与提出结构化变化；宿主负责触发评估、校验、排序、事务提交和恢复。
- 所有变化先属于 Play-local truth；只有用户选择 adoption，并通过现有 PendingAction / diff 审批后，才可进入真实小说文件树。

产品信息架构同样是本次升级的硬约束：

- Workspace 顶级导航提供 `Writing | Play`。
- Writing 进入现有 Novel Agent / files / diff / approval 工作台。
- Play 进入独立的 session / transcript / world HUD / event / adoption 工作台。
- 早期右侧 `Play` tab 是已经结束的过渡实现；当前顶级 Play 工作区才是后续扩展容器。
- Play 内部仍可有右侧 inspector，但关闭 inspector 不等于退出 Play。

本升级由 `docs/tasks/1120.md` 独立追踪，不把世界事件范围悄悄并入原 `1090` 历史。`1090` 保留 UI / adoption 复核记录；`1120` 记录已落地纵向切片，以及后续 reveal / knowledge、branch UX、长篇体验和并行 correctness 范围。

### 1.1 当前实施进度与执行判断

第一阶段纵向切片已经落地：

- Play 已成为与 Writing 同层级的顶级工作区，并从 Writing right tabs 移除。
- session schema v4 已提供 revision、world clock、event policy、typed world events 与 `events.yaml`，并以 `turns/*.yaml` 保存结构化回合事实、以 `selectedTurnIds` 选择 transcript projection 路径。
- client / backend 已接通真实 world-referee turn；referee 只使用 read tools。
- Play turn 已升级为专用 SSE：provider response 会先隔离到检测到 settlement boundary，再把 boundary 前的正文作为 provisional delta 输出；无 fence / raw JSON 不进入 UI。中间 read-tool loop 通过 `play.narrative.reset` 清除旧 provisional block，结构化 settlement fence 保留在服务端；响应头预先提供 turn id，显式 Stop 与断流恢复通过 turn registry、cancel endpoint 与 commit barrier 确认 cancelled 或 committed truth。
- prompt 已加载最近 transcript、Play-local state、既有事件和 activated source 实际内容。
- narrative + 必需的 `oan-play-settlement` 通过宿主的 schema、事件预算和 cause reference 校验后才写入；无效 settlement 不产生部分回合。
- session 已采用 staged directory snapshot、ready marker、swap 与读取恢复；同 session 的所有 Play-local mutation 共享锁和 revision conflict 检查。
- v4 state / observation / adoption visibility 与 provenance 已严格校验；兄弟分支历史可保留但当前 UI 只投影 selected branch。spoiler 关闭时 hidden facts 和 `cause.reason` 不会从 HUD / event feed / adoption 旁路泄露，同时允许隐藏原因产生公开可感知的后果。
- activated sources 与 referee read tools 已增加 realpath workspace containment，重复 session id 与未来 schema 会被拒绝。
- v1 / v2 / v3 -> v4 的 Core migration preview、原始 snapshot 备份、未知顶层 session metadata 保留和 migration history 延续已落地。v3 仅在为空 session 或其 structured turns 仍为 legacy artifact v1 时可迁移；内含 artifact v2 但缺少 branch base / cutoff 的 v3 session 仍 fail closed。升级后会以当前 revision 作为 `branchSnapshotRequiredFromRevision` cutoff，并用 `branchBaseSnapshot` 封存 selected legacy head 的 clock / state / visibility / schedule / suggestions。
- typed `event-schedule.yaml`、`nextTurn` / `afterTurns` / `flagEquals` evaluator 与 hard-due settlement 已落地；到期事件必须用 `triggerId` 恰好结算一次且不占 spontaneous event budget。artifact schema v2 以版本化 branch snapshot 保存 world clock、Play-local state value / visibility、suggested actions、完整 schedule head 和 pre-turn hard-due evidence；完整 parent 或 v4 branch base 上会重跑 evaluator，selected path 与当前 projection 不一致时 fail closed，避免 root / legacy bridge 无前驱校验或 sibling branch 污染 evaluator / prompt / HUD。`atWorldTime` 在没有规范化 comparator 时继续保持 pending。
- M1 已增加 strict Pressure / Agenda schema、selected before-state 上的 deterministic eligible evaluator、simulation mode / density budget、wait action 的 typed relative time advance，以及 settlement 中只能推进 eligible pressure / agenda 的 typed change。world momentum 随 branch snapshot、Restore 与 Retry 一致恢复；非法 raw `stateDelta` 不能绕过 typed momentum contract。
- 跨计划 F1 已增加 parent v5 Scene Rehearsal、frozen participant perception、fixed actor queue、attempt-local Accept / Retry、零提交 Cancel 与一次原子 Finish；committed step 以 `settlementEventRefs` 精确拥有自己的 contribution events，公开 hard-due 进入独立 `hostNarrativeBlocks` 并同时进入主 transcript。turn artifact v3 与 `scenes/*.yaml` evidence 双向拥有这些 blocks，重开与 Restore 只投影 selected branch。
- F1 notice 只把显式 `playerVisible` 变化提升为角色已观察事实：provisional notice 没有伪造 event id，Finish 后 step / host notice 的 refs、顺序与 `title: summary` 由 owning artifact 精确派生；Core / Client 对 aggregate deep equality、visibility widening、跨 step / host 归属和遗漏覆盖 fail closed。referee prompt 同时携带 visibility map 与 anti-leak 规则，Player result 对 nested state、`directorOnly` / `playerUnknown` 与 `worldMomentum` fail closed。
- F1 correctness gate 同时补齐 cooperative cross-process session / attempt filesystem lock、authoritative revision CAS、attempt staged publish、active marker self-healing 和独立 step-run terminal reconciliation；这些能力复用既有 staged session writer，没有建立第二套 transaction / variant 事实源。
- Desktop Composer 已提供等待预设和自定义相对时间入口；HUD 以黑白中性样式展示 active pressure、deadline、agenda owner / next move，Event Feed 以安全 cause label 关联对应动力，spoiler gate 继续保护 `playerUnknown` 内容。
- `play.event.occurred` 只在 staged snapshot swap 写入成功后发布，terminal committed session 继续作为 UI 权威事实；cancel / provider / validation / commit failure 不发布 occurred。
- UI 已提供 committed transcript、真实 provisional block、Stop / cancel / failed / conflict / indeterminate 状态、action kind、suggestions、HUD、spoiler-aware pending schedule、visible / hidden event feed、source/state、observation 和 adoption candidate 表单；Play 组件统一使用共享黑白中性设计 token。
- workspace mode 与布局偏好按 workspace 恢复，session rail 具备明确 ARIA 状态。根目录 `__test__/desktop-ui` 已覆盖 stream reducer、terminal 幂等、cancel / commit race、中性设计、router 恢复与 mounted session rail；完整键盘旅程和浏览器级覆盖仍需扩展。
- committed turn artifact 已作为隐式 checkpoint 提供 list / restore 纵向能力；恢复会在 session reservation 与 cooperative filesystem lock 下用 mandatory `baseRevision` 检查重新投影 transcript、world state、event refs、schedule 与 suggestions，保留全部 ledger，并让下一回合自然形成 sibling variant。Desktop 以文本状态和 inline confirmation 呈现恢复，不把 variant 误报为已删除历史。
- 完整 `worldSettlement` artifact 已提供原子 Retry：独立 SSE route 从 source artifact 读取不可变行动，在同一 before-turn projection 上重新生成 sibling；旧结果和后续 ledger 保留。首回合使用共享虚拟 branch base 的完整 v2 root forest；Desktop 生成期间显示 before-state、原始行动、provisional 状态与 variant 保留事实。commit barrier 前确认取消、provider / validation failure 或检测到 revision drift 时不改变权威 session；晚到 Stop 会明确返回 `committing / committed`，不能再阻止已经开始的提交。

执行判断：上述底座已经能够安全支撑新的 Play 功能，不需要等 `docs/tasks/1120.md` 的所有 Remaining Review Scope 全部关闭后再继续。接下来的主线按用户价值排序：

1. 已完成角色推演计划 F1：复用世界动力与相对时间能力形成第一个可玩的 Scene Rehearsal。
2. 已完成 M2：事件原因 / 影响卡片、命名 checkpoint、初始世界入口、variant worldline 与 Retry / Restore 已形成非技术化的分支探索体验。
3. 已完成跨计划 F2：真实 workspace source 可经五步 Guided Start 创建 v4 Journey 或 v5 Rehearsal，Quick Start 保持兼容。
4. 下一步补 branch-local knowledge / reveal，或让 Play 结果生成带证据的 outcome / writing handoff 并进入现有人工审批链路。
5. 再按真实长篇使用压力补 context trace、source drift、summary / windowing 与完整旅程自动化。

F1 已因实际并发边界补入 cooperative cross-process session / attempt filesystem lock、持锁 CAS、staged attempt publish 与 crash self-healing。产品层 migration confirmation、fsync、完整跨进程故障矩阵、可重启 terminal registry、deadline / backpressure 等仍由 `docs/tasks/1120.md` 追踪，并保持为并行 correctness lane。

## 2. 规划依据与参考边界

### 2.1 已阅读资料

OAN 文档：

- `docs/PLAY_MODE_SPEC.md`
- `docs/SILLYTAVERN_REFERENCE_LESSONS.md`
- `docs/INKOS_REFERENCE_LESSONS.md`
- `docs/INKOS_REFERENCE_OVERVIEW.md`
- `docs/OPENTAVERN_PLAY_MODE_REFERENCE_ANALYSIS.md`
- `docs/tasks/1060.md`
- `docs/tasks/1090.md`

本地参考项目：

| 项目 | 本次阅读基准 | 重点阅读 |
|---|---|---|
| `reference-only/SillyTavern` | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` | World Info activation、timed effects、group activation、variables、bookmarks、应用事件总线 |
| `reference-only/inkos` | `d316c8e4fee9cf8f3b1dc8d8d5dd07967e129825` | play model、runner、reducer、store、agent prompts、HUD、checkpoint / variant、测试 |

以上结论来自本地静态阅读，不代表运行验证，也不代表允许复制参考实现的代码、prompt、文案或视觉资产。

### 2.2 两类参考各自解决什么

| 来源 | 最值得吸收 | 不应误读或照搬 |
|---|---|---|
| SillyTavern | 动态 lore 激活、群聊发言调度、Play-local 变量、checkpoint / branch、用户 steering、快速试错 | `eventSource` 是应用生命周期事件总线，不是故事世界事件系统；World Info 的 sticky / cooldown / delay 主要控制 prompt 激活，不等于世界时间；不复制 AGPL 代码或 prompt |
| InkOS | 行动解释、时间推进、NPC / 场外变化、结构化 mutation、render-before-commit、HUD、checkpoint / variant | 不引入四 Agent pipeline、SQLite 事实源、JSON event sourcing、后台自治 Agent；不复制 AGPL 代码或 prompt |
| OpenTavern | 流式 Play 闭环、消息操作、多角色轻量调度、context viewer、行动建议 | 不采用单 HTML / OPFS 架构、任意 preset、公共角色卡依赖、浏览器直连 provider |

三者在 OAN 中的组合边界是：

```text
SillyTavern / OpenTavern：怎么玩、怎么试、怎么控制上下文
InkOS：一个回合怎样让世界发生变化并完成结算
OAN：变化怎样保持 filesystem-first、可追溯，并在人工审批后进入真实作品
```

### 2.3 许可证边界

SillyTavern 与本地 InkOS 参考均按 AGPL 项目对待。本计划只吸收产品模式、领域概念、状态机思想和测试场景。实现时必须独立命名、独立建模、独立编写代码与 prompt，不复制源文件、prompt 片段、UI 文案或视觉资产。

## 3. 当前产品缺口

最初的结构化事实、回合事务、流式结算、HUD 与 checkpoint 基础已经解决；当前缺口不再是“Play 能否安全提交一个世界回合”，而是这些能力是否形成了足够有生命力、可理解、可控制的产品体验：

1. hard-due 与 M1 eligible event 已能推进世界，但 Event Feed 对 pressure、agenda、玩家行动与 source 的完整因果解释仍需继续收口。
2. typed 相对等待已有一等入口；绝对 `atWorldTime` 仍需和规范化 comparator 一起交付，宿主继续拒绝猜测自然语言时间顺序。
3. hidden event 已能安全保存和投影，但缺少 branch-local knowledge / reveal store 与正式的 `playerUnknown -> rumor / playerVisible` 因果揭示链。
4. checkpoint / restore / Retry 已经正确保留分支事实，但命名 checkpoint、可见初始世界入口与 branch timeline 仍偏技术化。
5. observation / adoption 已有正确审批边界，但从“值得采用的事件或结果”到可审阅 candidate 的路径仍可更短、更清楚。
6. context trace、omitted source、canonical drift 与长 session windowing 尚未形成面向用户的诊断和长篇使用体验。

因此，下一阶段不再默认扩建通用基础设施；新增 schema、store 或 endpoint 必须直接服务于可玩的行为、可见反馈、分支控制或可采纳结果。

## 4. 产品目标与非目标

### 4.1 产品目标

1. Play 作为与 Writing 同层级的顶级模式占据完整主工作区，不受限于 Writing 右侧面板。
2. 即使玩家只聊天或等待，世界也可以基于已有原因继续推进。
3. NPC、组织、地点、环境、期限和信息传播可以在场内或场外发生变化。
4. 每个外部事件都有来源、原因、世界时间、可见性和影响引用。
5. 作者可以看到“发生了什么”和“为什么发生”，也可以关闭 spoiler 查看沉浸视角。
6. 取消、失败、重试、切换 variant 和恢复 checkpoint 时，不留下半个回合的状态。
7. session 重开后能从文件恢复，不依赖进程内隐藏状态或私有数据库。
8. Play 产生的好结果可以带证据进入 adoption，但不能绕过 PendingAction。

### 4.2 非目标

- 不做后台常驻世界模拟或现实时间 cron。
- 不做每个角色一个 Agent 的多 Agent 社会。
- 不把完整物理模拟、经济模拟或规则引擎作为第一版目标。
- 不使用 SQLite、向量数据库或内存状态作为 Play 的唯一事实源。
- 不把事件 ledger 设计成重型 event sourcing；当前 snapshot 仍是恢复世界的主要事实。
- 不让 Play 直接修改 `chapters/`、`state/`、`timeline/`、`foreshadow/` 等 canonical 文件。
- 不实现任意表达式、任意 JavaScript、正则脚本或用户插件式触发器。
- 不暴露或保存模型私有 reasoning；只保存可解释的结构化 reason、source 和 validation trace。

## 5. 目标体验

### 5.1 一个典型回合

```text
当前世界：午夜前必须把证据交给报社；反派组织正在封锁车站。

玩家：我和林秋继续在咖啡馆讨论，不急着离开。

Play 结算：
1. 对话继续，林秋表现出犹豫。
2. 世界时间推进 35 分钟。
3. “车站封锁”压力跨过阈值，组织成员在场外控制了东侧入口。
4. 一名目击者因等待过久而离开，这是玩家暂时不知道的 hidden event。
5. HUD 显示截止时间缩短、可见的封锁消息和关系变化。
6. 后续玩家到达车站或收到电话时，hidden event 通过 consequence link 被揭示。
```

这不是随机插曲。封锁来自已有 faction agenda，目击者离开来自 deadline / pressure，时间变化来自本回合行动。

### 5.2 三种世界活跃度

`session.yaml` 应提供简单、可解释的事件策略：

| 模式 | 行为 | 建议用途 |
|---|---|---|
| `conversation` | 除明确行动后果和硬性到期事件外，不主动增加场外变化 | 纯对白试演 |
| `reactiveWorld` | 世界根据时间、压力、agenda 和玩家行动作出反应 | 默认 |
| `activeWorld` | 允许更多场外变化、组织行动和环境推进，但仍受事件预算与因果约束 | 高动态冒险 / 悬疑 |

事件密度单独配置为 `quiet | balanced | volatile`，用于控制 eligible pressure event 的数量，不得取消硬性到期事件。

## 6. 领域模型

### 6.1 核心术语

| 术语 | 含义 |
|---|---|
| Turn | 从一次玩家输入到 Play-local 原子提交的一次结算 |
| World Event | 已发生、可追溯的世界变化，不等同于一段叙事文本 |
| Scheduled Event | 在确定条件满足时必须进入结算的事件计划 |
| Pressure | 正在累积或逼近的威胁、机会、期限、追踪、舆论或关系张力 |
| Agenda | NPC 或组织的目标、下一步倾向和当前阻碍，不是独立 Agent |
| State Snapshot | 当前 Play-local 世界状态，是恢复的主要事实 |
| Turn Artifact | 一次已提交回合的结构化记录，用于审计、projection、checkpoint 与 adoption 证据 |
| Observation | Play 中值得进入正式创作流程的候选事实或灵感，不是 canonical truth |

### 6.2 外部事件类型

第一版使用有限枚举，不开放任意事件 DSL：

```ts
type PlayWorldEventKind =
  | 'environmentChanged'
  | 'locationChanged'
  | 'npcActed'
  | 'factionActed'
  | 'arrival'
  | 'departure'
  | 'deadlineAdvanced'
  | 'resourceChanged'
  | 'itemMoved'
  | 'evidenceChanged'
  | 'relationshipChanged'
  | 'informationSpread'
  | 'ruleConsequence'
  | 'manual';
```

该枚举可以扩展，但每次扩展都应有 reducer、UI 和测试语义，不能只让模型自由造字符串。

### 6.3 事件来源与因果

```ts
type PlayEventOrigin =
  | 'player'
  | 'npc'
  | 'faction'
  | 'clock'
  | 'environment'
  | 'worldRule'
  | 'manual';

interface PlayEventCause {
  sourceTurnIds?: string[];
  sourceEventIds?: string[];
  triggerId?: string;
  pressureId?: string;
  agendaId?: string;
  ruleSourceRef?: string;
  reason: string;
}
```

校验规则：

- 除 opening seed 与 `manual` 外，事件至少要有一个可定位的 cause reference。
- `reason` 是给作者看的简短解释，不是 chain-of-thought。
- 随机性只能影响同等 eligible 事件的选择，不能替代因果来源；默认第一版不启用随机选择。
- 事件造成的每项 state delta 都必须能回指 event id。

### 6.4 事件可见性

```ts
type PlayEventVisibility =
  | 'playerVisible'
  | 'rumor'
  | 'playerUnknown';

interface PlayEventKnowledge {
  visibility: PlayEventVisibility;
  knownByEntityIds: string[];
  revealedAtTurnId?: string;
  revealedByEventId?: string;
}
```

- `playerVisible`：可以立即进入 transcript / event feed。
- `rumor`：玩家知道有信息流动，但其真实性可以不确定。
- `playerUnknown`：只进入 referee context 和作者 spoiler inspector，不能泄露到沉浸视角。
- hidden event 后续被揭示时，必须记录 `revealedByEventId`，不能直接修改旧记录伪装成一直可见。
- Rehearsal F1 的 actor observed-event 链更严格：一般 Event Feed 可以保留 `rumor`，但 `rumor` / `playerUnknown` 不生成确定性的 rehearsal `worldNotice`；只有 selected block 显式引用的 `playerVisible` event 才进入后续角色 perception。

### 6.5 世界时间

世界时间同时需要语义表达与确定性顺序：

```ts
interface PlayWorldClock {
  turn: number;
  revision: number;
  anchor?: string;
  elapsed?: string;
  order: number;
}

interface PlayTimeAdvance {
  from: PlayWorldClock;
  to: PlayWorldClock;
  elapsed: string;
  rationale: string;
}
```

设计原则：

- `turn` / `revision` / `order` 必须单调，用于并发校验和确定性排序。
- `anchor` 与 `elapsed` 可以是自然语言，但若世界 contract 声明了可解析日历，才允许做绝对时间比较。
- “说一句话”和“穿越城市”不能默认消耗同样时间；时间推进由动作语义决定并受宿主校验。
- InkOS 的 `synchronized` 概念不保留为几条说明字符串，而升级为同一时间区间内的多个一等 `PlayWorldEvent`。

### 6.6 Scheduled Event

第一版只支持有限、可验证的触发器：

```ts
type PlayEventTrigger =
  | { type: 'nextTurn' }
  | { type: 'afterTurns'; turns: number }
  | { type: 'flagEquals'; path: string; value: string | number | boolean }
  | { type: 'atWorldTime'; value: string }
  | { type: 'manual' };
```

约束：

- `atWorldTime` 只在 world contract 提供规范化时间格式时启用。
- 不支持任意表达式、脚本、正则或循环触发。
- 到期 trigger 由宿主确定，不由模型自行声称“还没到”。
- scheduled event 可被明确取消或改期，但必须写入原因和来源 turn。

### 6.7 Pressure 与 Agenda

```ts
interface PlayPressure {
  id: string;
  kind: 'deadline' | 'pursuit' | 'factionProject' | 'environment' | 'rumor' | 'relationship';
  label: string;
  status: 'latent' | 'active' | 'resolved';
  level?: number;
  threshold?: number;
  causeRefs: string[];
  nextConsequence?: string;
  visibility: PlayEventVisibility;
}

interface PlayAgenda {
  id: string;
  ownerEntityId: string;
  goal: string;
  nextMove?: string;
  blockers: string[];
  status: 'active' | 'blocked' | 'completed' | 'abandoned';
  visibility: PlayEventVisibility;
  updatedAtTurnId: string;
}
```

`level` 只在世界 contract 明确允许数字化时使用。纯文学场景可以只保留 status、next consequence 和自然语言依据，避免把一切游戏化为数值条。

### 6.8 World Event

```ts
interface PlayWorldEvent {
  id: string;
  turnId: string;
  sequence: number;
  kind: PlayWorldEventKind;
  origin: PlayEventOrigin;
  title: string;
  summary: string;
  actorEntityIds: string[];
  targetEntityIds: string[];
  locationEntityId?: string;
  worldTime: PlayWorldClock;
  knowledge: PlayEventKnowledge;
  cause: PlayEventCause;
  stateDeltaRefs: string[];
  status: 'occurred' | 'cancelled';
  canonical: false;
}
```

### 6.9 PlayWorldRefereeSettlement 与 PlayTurnArtifact

当前真实实现 seam 是 narrative + `PlayWorldRefereeSettlement`；宿主解析、校验并提交后生成 `artifactKind: worldSettlement` 的 `PlayTurnArtifact`：

```ts
interface ParsedPlayWorldRefereeResponse {
  narrative: string;
  settlement: PlayWorldRefereeSettlement;
}

interface PlayWorldRefereeSettlement {
  elapsed?: string;
  worldTimeAnchor?: string;
  events: PlayWorldRefereeSettlementEvent[];
  scheduledEventChanges: PlayWorldRefereeScheduledEventChange[];
  stateDelta: Record<string, unknown>;
  observations: Array<{ summary: string; evidence: string }>;
  suggestedActions: string[];
}
```

Pressure / Agenda、typed delta refs 与 context trace 应作为这一 settlement / validation 管线的增量能力，或由独立深模块提供宿主输入；不再新建第二套 `PlayTurnDraft`、reducer 或 commit framework。artifact 继续保存 host-owned id、revision、typed input、parent、branch snapshot、event / schedule refs 与 `canonical: false` 证据。

## 7. 三层事件结算机制

外部变化应分成三层，不能全部交给模型自由发挥。

### 7.1 第一层：Hard Due Event

当前状态：**已完成基础闭环**。`nextTurn`、`afterTurns`、`flagEquals` 的宿主 evaluator、hard-due skeleton、唯一 `triggerId` 结算和预算豁免已经落地；`atWorldTime` 仍只在存在规范化 comparator 时启用。

满足确定触发条件的 scheduled event：

- 必须进入当前回合结算。
- 宿主先生成 due event skeleton，再交给 referee 结合场景叙述与补全影响。
- referee 若遗漏、取消或改期，必须提供符合规则的结构化原因；否则 draft 校验失败。
- Scene Rehearsal actor step 禁止携带 `triggerId` 或提前结算 hard-due；Finish 在 base-session skeleton 上只结算一次，公开结果进入独立 host notice，不归因给固定队列中的最后一个角色。

### 7.2 第二层：Eligible Pressure Event

当前状态：**M1 已完成基础可玩闭环**。宿主会从 selected before-state、active pressure / agenda、用户行动、typed wait、simulation mode 与 density 生成稳定候选；settlement 只能引用并实际推进 eligible 动力。

由 active pressure、agenda、时间推进和世界模式共同决定的候选事件：

- 宿主计算 eligible list 和本回合 event budget。
- referee 可以选择 0 到 N 个实现，但每个都必须引用 pressure / agenda。
- `conversation` 通常只处理强制后果；`reactiveWorld` 处理紧密相关候选；`activeWorld` 可处理更多场外候选。

### 7.3 第三层：Immediate Consequence

当前状态：**已有 typed event / cause 基础，继续提升因果质量与 UI 可解释性**。不为这一层新增第二套结算引擎。

由玩家本回合行为直接产生的即时结果：

- 必须引用当前 turn 或同 turn 前序 event。
- 可以创建新的 pressure / scheduled event。
- 不能用“世界本来就这样”跳过因果说明。

### 7.4 事件预算

每个 session 配置：

```yaml
eventPolicy:
  simulationMode: reactiveWorld
  density: balanced
  allowOffscreen: true
  allowHidden: true
  maxExternalEventsPerTurn: 2
```

预算只限制 eligible / spontaneous event；hard due event 不被静默丢弃。若同一回合到期事件过多，应按优先级全部记录，并允许叙事层合并表达，而不是删除状态变化。

## 8. 回合执行与事务

### 8.1 目标流程

```mermaid
flowchart TD
  A["用户提交行动 / 等待"] --> B["读取 session revision 与 Play snapshot"]
  B --> C["解析 action 与时间意图"]
  C --> D["宿主计算 hard-due / eligible pressure / agenda cues"]
  D --> E["组装 PlayContextPackage"]
  E --> F["单一 World Referee 生成 narrative + settlement"]
  F --> G["Schema、因果、时间、可见性与预算校验"]
  G -->|失败| H["可见错误 / 一次受控修正；不提交"]
  G -->|通过| I["构建 staged PlayTurnTransaction"]
  I --> J["原子提交 turn、snapshot、events、schedule 与 projections"]
  J --> K["发布 committed RuntimeEvents 并刷新 HUD"]
  K --> L["可选 observation / adoption"]
```

### 8.2 单 World Referee

不照搬 InkOS 的 interpreter、mutator、renderer、reconciler 四 Agent。OAN 使用一个 turn-scoped referee：

- character voice / state 是上下文模块，不是独立运行 Agent。
- 宿主先提供确定性的 due events、eligible pressures 和规则约束。
- referee 一次提出叙事与结构化结算。
- reducer 只执行通过 schema 与领域规则校验的 delta。
- 对可自动修复的格式错误，最多进行一次可观察的 correction；不得构造隐藏的无限重试循环。

### 8.3 流式正文与最终提交

- `messages[].content` 可以向 UI 发送 provisional delta，提升沉浸感。
- provisional 内容不等于已提交 transcript。
- 同一 turn 在中间 read-tool loop 后重新开始正文时，服务端发送 `play.narrative.reset`；UI 清空此前全部 provisional 文本，后续 delta 构造替代正文。reset 本身不产生事实、不推进 revision。
- 完整 narrative + `PlayWorldRefereeSettlement` 到达并通过验证后，才生成 committed turn。
- Scene Rehearsal 中，referee contribution 的公开变化先形成 `eventRefs: []` 的 provisional notice；Finish 分配宿主 event ids 后按 `steps[].settlementEventRefs` 重绑，并把公开 hard-due 追加为 evidence-level host block。三类 notice 都只是 transcript projection，结构化 settlement / artifact 才是事件事实。
- UI 需要区分 `streaming` 与 `committed`；失败时撤回或标记未提交的 provisional block。
- 取消、provider error、schema error、revision conflict 都不得留下 transcript-only 或 state-only 的半回合。

具体 AI SDK 输出方式可以在实施计划中根据当前依赖版本选择，但必须保持同一个 turn id、同一个结构化 draft 和一次最终提交，不能让第二次模型调用偷偷重写第一次叙事的事实。

### 8.4 已落地的 PlayTurnTransaction 基线

当前实现已经具备继续交付产品功能所需的回合级事务语义，不再计划另建一套 `.transactions/<id>/` manifest 框架：

1. 同一 session 的 Play-local mutation 共用进程内互斥锁；staged session writer、reader / recovery 与 rehearsal attempt recovery 还使用 cooperative cross-process filesystem lock。F1 Finish 在持锁 attempt transaction 内执行 session CAS 与 swap；普通 turn 与其它既有 mutation继续按各 route 的 `baseRevision` 契约执行冲突检查。
2. 候选 turn、state、event、schedule 与 projection 先在内存中完成结构化校验。
3. 完整 snapshot 写入 sibling staging directory，并使用 ready marker 与 directory swap 一次提交。
4. 读取器能够恢复带 ready marker 的中断 stage，避免把部分文件当成一个新 revision。
5. terminal committed event 只在 staged snapshot swap 写入成功后发布；取消、provider / validation failure 或 commit 前 drift 保持零写入。
6. Retry 与普通流式 turn 复用 run registry / commit barrier；Restore 复用权威 ledger、session lock 与 staged writer，但不进入流式 commit barrier。

cooperative cross-process session / attempt lock 与当前触发的 stage / marker crash recovery 已落地。fsync、逐故障点注入矩阵、长期 quarantine / stage 清理、可重启 terminal registry 与 graceful shutdown 继续作为并行 correctness lane；在完成这些项目之前不宣称断电级强耐久保证。

由于这些文件都位于 `.workspace/play-sessions/`，Play-local 提交不需要 canonical PendingAction；但它仍必须保持可观察、可恢复，并通过现有 Human Approval 边界与 canonical truth 隔离。

## 9. Filesystem-first 存储设计

### 9.1 当前布局与按需扩展

```text
.workspace/play-sessions/<session-id>/
├── session.yaml
├── transcript.md
├── play-local-state.yaml
├── activated-sources.yaml
├── events.yaml
├── event-schedule.yaml
├── observations.yaml
├── adoption-candidates.yaml
├── turns/
│   └── <turn-id>.yaml
└── .migrations/                 # 仅 legacy upgrade 后存在
    └── v1-to-v4/ | v2-to-v4/ | v3-to-v4/
```

checkpoint、variant 与 Retry 已由 `turns/*.yaml` ledger、parent link、branch snapshot 和 `selectedTurnIds` 表达，不新增平行事实目录。`traces/`、summary 或 branch-local knowledge 文件只在对应用户功能进入实施时按稳定 schema 增加；Core 使用的 sibling stage / backup 是内部提交机制，不作为 session 内长期产品数据布局。

### 9.2 事实与投影边界

| 文件 | 角色 |
|---|---|
| `session.yaml` | session metadata、schema version、revision、world clock、event policy、branch base / cutoff 与 selected path |
| `turns/*.yaml` | 已提交回合的结构化事实与证据 |
| `play-local-state.yaml` | 当前可恢复的 Play-local state value；M1 / M3 再按稳定 schema 增加 pressure、agenda、knowledge 投影，world clock 继续由 session / branch snapshot 持有 |
| `events.yaml` | 按 turn / sequence 排列的事件 ledger，用于审计和 UI；不是重建全部状态的唯一来源 |
| `event-schedule.yaml` | 尚未发生、已取消或已改期的计划事件 |
| `transcript.md` | 从 selected turn path 生成的人类可读 projection，不是第二份可独立修改的 transcript truth |

M5 若交付持久化 context trace，可按需增加 `traces/*.context.yaml`，只记录 source 选择、预算、omission 与规则来源，不保存私有 reasoning；在 schema 冻结前它不是当前事实布局。

必须消除 `session.yaml.transcript` 与 `transcript.md` 的双写歧义：

- 新 schema 不再把完整 transcript 嵌入 `session.yaml`。
- `turns/*.yaml` 保存结构化消息，`transcript.md` 由 selected branch 投影生成。
- `play-local-state.yaml` 是当前状态主快照；events 提供因果与审计，不能把系统演变成必须全量 replay 的 event sourcing。

### 9.3 Canonical base 与漂移

`session.yaml` 应记录创建 / 上次 rebase 时的：

- Git HEAD（若存在）。
- 已激活 canonical source path 与内容 hash。
- 关键角色、世界规则和状态源的 hash。

继续 Play 前若发现 canonical source 已变化：

- 显示 stale source 提示。
- 允许继续使用旧 snapshot、重新装配 context 或从当前 canonical fork 新 session。
- 不静默把新 canonical 内容混入旧 session，造成不可解释的时间线漂移。

## 10. PlayContextPackage

每个回合必须装配真实内容，而不是只把 source 元数据列给模型。

```text
protected
  - constitution / world contract
  - 当前 canonical base 摘要与关键规则
  - 当前 Play clock、scene、state、hard-due events

play-local
  - session steering
  - selected transcript window
  - prior summaries
  - active pressures / agendas / event schedule
  - visible 与 referee-only knowledge

activated
  - 本回合命中的角色、地点、世界设定、时间线和伏笔原文片段

untrusted
  - Tavern card hints、外部 lorebook、导入 preset 建议

omitted
  - 未命中、过预算或低优先级 sources 及原因
```

复用现有 `ContextBudgetLayer`、semantic boundary、trust、selected / omitted source 和 context trace 机制。新增 Play-specific assembler，但不要在 `packages/runtime` 写领域逻辑。

规则优先级：

```text
Novel Constitution / explicit world contract
  > canonical source facts
  > Play-local committed state
  > session steering
  > imported Tavern hints / lorebook / preset
```

隐藏事件可以进入 referee-only context，但不得进入 player-visible transcript。context inspector 在作者 spoiler 模式下可以查看其结构化摘要与来源。

## 11. 已冻结的顶级 Play 工作区与后续 UI / UX

Play 已经从早期狭窄右侧 tab 提升为与 Writing 同层级的顶级主工作区。后续 UI 不再重复迁移一级信息架构，而是在这条已冻结基线上交付 Pressure / Agenda、推进时间、事件原因、branch timeline 与 Adoption 等实际交互。

### 11.1 顶级模式导航

```text
Workspace
├── Writing
│   ├── Novel Agent Copilot
│   ├── files / chapters
│   └── diff / approval / health inspector
└── Play
    ├── session / branch
    ├── scene / transcript / actions
    └── world HUD / events / context / adoption inspector
```

行为约束：

- 顶级 `Writing | Play` 切换位于 workspace 主导航，不属于 `WorkspaceRightPanel` tabs。
- 切换到 Play 时，主区域完整替换为 `PlayWorkspace`；不能在 Writing 中间区旁边仅打开一个 Play panel。
- `workspaceMode`、active Play session、selected branch 和 Play 内部布局状态按 workspace 恢复。
- 从 Play 生成的 adoption candidate 可以打开共享 approval / diff 能力，但这不会自动把顶级模式切回 Writing，也不会直接写 canonical 文件。
- Play 内部的 HUD / Event / Context / Adoption 可以是 inspector tabs；它们是 Play 子级导航，不得再次等同于顶级 Play 入口。

### 11.2 建议布局

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Play session / branch / world time / streaming state / stop / retry │
├─────────────────┬──────────────────────────────┬────────────────────┤
│ Scene & Cast    │ Transcript / Narrative       │ World HUD          │
│ - 当前地点       │ - narrator                   │ - 世界时钟          │
│ - 在场角色       │ - character messages         │ - 最近事件          │
│ - speaker control│ - provisional stream         │ - active pressures  │
│ - source status  │ - variants / checkpoints     │ - agendas / changes │
│                 │ - action composer             │ - observations      │
├─────────────────┴──────────────────────────────┴────────────────────┤
│ Context / Event / Adoption inspector                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 11.3 Event Feed

事件卡至少显示：

- 类型、世界时间、地点和涉及实体。
- `visible now`、`rumor` 或 `offscreen revealed later` 状态。
- 简短 cause；可展开查看 trigger / pressure / agenda / source refs。
- 关联 state deltas。
- 是否已生成 observation / adoption candidate。

沉浸模式默认不显示 `playerUnknown`。作者可显式开启 spoiler inspector；切换行为只改变 UI 可见性，不改变已提交知识状态。

### 11.4 World HUD

第一版 HUD 保持 genre-neutral：

- 世界时间与本回合 elapsed。
- 当前地点、在场角色与主要关系变化。
- active pressure / deadline。
- 最近 visible event 与已揭示的 offscreen event。
- 关键持有物、证据、资源；仅在世界 contract 声明时显示数值 meter。
- activated source / omitted source / stale source 提示。

不要把所有小说类型强制变成 RPG 数值面板。

### 11.5 Composer

- 行动类型：`say | look | move | do | wait`。
- 多角色时支持 `manual | natural | roundRobin` speaker strategy。
- “推进时间”应有明确入口，可填写“等十分钟”“等到天亮”等语义时间。
- 建议行动是可选辅助，不应阻塞自由输入。
- streaming 时提供 stop；完成后提供 retry、fork、select variant 和 checkpoint。

## 12. Backend、Client 与 RuntimeEvent

### 12.1 建议 endpoint

```text
POST /api/workspace/play-sessions/:id/turns/stream
POST /api/workspace/play-sessions/:id/turns/:artifactId/retry/stream
GET  /api/workspace/play-sessions/:id/checkpoints
POST /api/workspace/play-sessions/:id/checkpoints/:artifactId/restore
GET  /api/workspace/play-sessions/:id/events
GET  /api/workspace/play-sessions/:id/context-traces/:turnId
POST /api/workspace/play-sessions/:id/events/:eventId/adoption-candidates
```

现有 world-referee endpoint 可兼容一段时间，但新 client / UI 应围绕 turn stream 与 committed artifact，而不是“返回一段 assistant 文本”。

### 12.2 Play RuntimeEvent taxonomy

```text
play.turn.started
play.context.ready
play.narrative.delta
play.narrative.reset
play.turn.prepared
play.event.occurred
play.turn.committed
play.turn.failed
play.turn.cancelled
```

约束：

- `play.narrative.delta` 明确标记 provisional。
- `play.narrative.reset` 清除同一 turn 此前全部 provisional 正文；它不撤销 committed turn，也不推进 revision。
- 当前实现以 `play.turn.committed.session` 作为 transcript、world state、observation 与 event feed 的权威刷新载荷。
- 独立 `play.event.occurred` 已在 staged snapshot swap 写入成功后、terminal `play.turn.committed` 前发布；它提供逐事件 committed 通知，但当前 UI 仍以随后到达的 committed session 作为 transcript、state、schedule 与 event feed 的权威刷新载荷。
- event payload 只包含 UI 所需结构化 trace，不包含 provider secret 或私有 reasoning。
- 复用已有 RuntimeEvent / SSE / AI SDK UI stream 基础设施，不新建第二套通用 runtime。

## 13. Checkpoint、Variant 与重试

checkpoint 必须覆盖：

- selected turn head 与 transcript projection 输入。
- `play-local-state.yaml`。
- world clock、events、schedule、pressures、agendas。
- activated sources、summaries 与 knowledge / reveal 状态。
- session revision 与 canonical base refs。

行为规则：

- retry 从同一个 before-turn checkpoint 重新生成，旧结果保存为 variant。
- 选择 variant 会切换 Play-local selected path，并重新投影 transcript / state / event feed。
- 不物理删除未选中的事件；它们属于对应 variant，不属于当前 selected world。
- restore checkpoint 必须回退事件计划和隐藏知识，不能只截断聊天文本。
- checkpoint / variant 是 Play-local 分支，不自动创建 Git branch。

当前已落地 committed-turn 隐式 checkpoint：任意带完整 branch snapshot 的 artifact 都可作为 selected path 恢复目标，legacy 仅允许恢复到 branch base head。restore 后 session revision 单调推进，目标之后的 ledger 保留并标记为 variant；再次选择旧 variant 或从恢复点继续推进都不需要复制或删除历史。完整 `worldSettlement` 还可直接发起原子 provider Retry：宿主从 source artifact 读取 typed action，在同一 before-turn projection 上生成 sibling，旧结果不覆盖；首回合以共享虚拟 branch base 的完整 v2 roots 表达。尚未落地命名 / 可见初始 checkpoint 与独立 knowledge / reveal snapshot，因此本节完整验收仍是部分完成。

## 14. Observation 与 Canonical Adoption

世界事件提供比纯聊天更好的 adoption 证据。候选映射包括：

| Play 结果 | 可能的 canonical target |
|---|---|
| 可用叙事段 | chapter draft / scene section |
| 角色或关系变化 | `state/characters.yaml` 或对应对象文件 |
| 已验证的时间推进 | timeline entry |
| 新线索、证据或未兑现后果 | foreshadow / clue / evidence object |
| 世界规则的可靠发现 | world object / rule section |

adoption candidate 应自动携带：

- session id、turn id、event ids。
- source refs 与 canonical base hashes。
- before / after Play-local state 摘要。
- 建议 target 与 semantic patch intent。
- 可见性；hidden event 默认不自动建议 adoption，作者显式选择时除外。

后续仍走：

```text
Play observation / event
  -> adoption candidate
  -> write intent / SemanticPatch draft
  -> PendingAction + diff
  -> human accept / reject
  -> optional Git commit
```

任何 event、checkpoint、retry 或 session close 都不能直接写 canonical target。

## 15. 兼容与迁移

当前已落地 `schemaVersion: 4` 的 turn fact 与迁移基础：

1. v1 / v2 session 继续可读；v3 只在为空 session，或 structured turns 仍为 artifact v1 且 projection 可验证时兼容读取与迁移。缺少 branch base / cutoff 却已包含 artifact v2 的 v3 session 会 fail closed，不静默推断前驱。
2. Core 可在写入前生成 migration preview；第一次写入 v4 staged snapshot 时保存原始备份和 preview，v1 / v2 / v3 备份路径分别为 `.migrations/v1-to-v4/`、`.migrations/v2-to-v4/` 与 `.migrations/v3-to-v4/`。backend / client / UI 的显式确认仍待实现。
3. 把旧 `session.yaml.transcript` 转换为 legacy turn artifacts。
4. 重新生成 `transcript.md` projection。
5. 保留未知顶层 session metadata，并让 `.migrations/` 历史跨后续保存延续；升级时用 `branchBaseSnapshot` 封存当前 selected legacy projection，以当前 revision 作为 cutoff。
6. v4 中 cutoff 与 branch base 都是必需证据，不得删除或静默重算；watermark 必须等于 base revision，revision 高于 cutoff 的 artifact 必须有完整 v2 snapshot，前驱、selected projection 或 schedule 不连续时 fail closed。
7. migration 与 v4 snapshot 在同一个持 filesystem lock 的 staged directory swap 中提交；更完整的 fsync 和逐故障点验证仍待实现。

不应在应用升级时批量静默重写全部 Play session。

## 16. 当前实施顺序：产品纵向切片优先

原 Phase 0–4 中的 session v4、structured settlement、staged snapshot、typed SSE、顶级 Play workspace、HUD、checkpoint / restore 与 Retry 已形成可复用底座。它们不再作为下一轮顺序执行的基础设施阶段，也不要求 `docs/tasks/1120.md` 先转为 `Completed`。

新的实现原则是：每个里程碑都要同时交付最小 Core 规则、referee context、Backend / Client 契约、Desktop UI 反馈和用户旅程测试；不先堆一批没有可玩入口的 schema。

### M1：让世界真正持续变化

状态：**Completed（2026-07-15）**。绝对 `atWorldTime` comparator 未被伪造；当前用户入口只提交可规范化的相对 elapsed，无法比较的绝对世界时间触发仍保持 pending。

范围：

- 最小可解释的 Pressure / Agenda schema 与 branch snapshot。
- eligible evaluator：结合 active pressure、agenda、时间推进、玩家行动和 simulation mode 生成稳定候选。
- `conversation | reactiveWorld | activeWorld` 与 density 真正影响 eligible budget。
- Composer 提供明确的“等待 / 推进时间”入口；相对 elapsed 先使用稳定规范化表示，`atWorldTime` / “等到天亮”必须同时交付 world contract comparator，宿主不得猜测自然语言时间顺序。
- HUD 展示 active pressure、deadline、NPC / 组织下一步倾向；Event Feed 展示对应 cause。

完成标准：玩家只聊天或等待时，外部世界仍能基于已有 agenda、pressure 或期限推进；相同 before-turn snapshot 产生稳定候选，事件不是随机插曲；任何绝对世界时间触发都有明确 comparator，无法规范化的值继续保持 pending。

### M2：让用户看懂并控制世界线

状态：**Completed（2026-07-16）**。实现与验收记录见 `docs/tasks/1120.md` 和 `docs/superpowers/plans/2026-07-16-play-worldline-m2.md`。

范围：

- 事件卡显示原因、影响、世界时间、相关实体与 pressure / agenda / action refs。
- 可见的初始世界 checkpoint、命名 checkpoint 与清晰的 branch timeline。
- Retry、Restore、选择 variant 使用统一的“从哪里重演 / 当前选择哪条世界线”交互。
- artifact id、revision 和图结构退到可展开的技术详情，不作为主要文案。

完成标准：用户无需理解 turn graph，也能试验不同选择、返回初始世界，并清楚旧结果仍被保留。

### M3：隐藏变化与因果揭示

范围：

- 最小 branch-local knowledge / reveal store，并随 selected branch 恢复。
- `playerUnknown -> rumor / playerVisible` 的显式 reveal link；旧 hidden event 不被原地篡改。
- Player / Author projection 继续服从 spoiler gate。

完成标准：场外事件可以先发生、后被有因果地揭示；Restore / Retry 后不会串用其他分支知识。context trace / source drift 不阻塞这一可玩闭环。

### M4：把 Play 结果带回创作流程

范围：

- event / observation 一键形成带 turn / event / source evidence 的 adoption candidate。
- 为 `chapterDraft | state | timeline | foreshadow` 提供合法目标建议和可编辑预览。
- PendingAction 前清楚展示将进入 canonical truth 的内容与差异。
- discarded / unselected variant 不进入 candidate，hidden provenance 不从 label 或 preview 泄漏。

完成标准：一次有价值的 Play 结果能用少量操作进入现有 Human Approval 流程，但永远不会因“在 Play 中发生过”而自动成为小说事实。

### M5：长篇使用与体验收口

范围：

- session summary + selected detail、transcript / event feed windowing。
- 完整键盘、screen reader 与浏览器级 Play journey。
- turn-scoped context trace 记录实际使用、遗漏和发生漂移的 source。
- canonical source drift 提供继续当前内容、重新装配或 fork 的明确选择。
- context / source 状态的简洁诊断，以及旧 endpoint / migration 入口收口。

完成标准：长 session 不需要一次加载全部事实，核心旅程在桌面真实交互中可回归验证。

### 并行 correctness lane：不作为全局 Gate

- cooperative cross-process session / attempt lock 已落地；fsync、ready / stage / backup 完整故障点注入、quarantine / 残留清理仍待完成。
- 可重启 terminal registry、graceful shutdown、provider / source deadline、bounded read 与 SSE backpressure。
- legacy migration confirmation、取消与错误恢复。
- 与正在交付功能直接相关的 typed delta / provenance 加固。

这条并行轨不能因为追求更完整的通用事务框架而暂停 M1–M4。只有可复现的数据丢失、历史覆盖、安全边界破坏，或某个里程碑直接需要改变对应持久化 / 并发保证时，相关项才成为该里程碑的局部 correctness gate。新增领域能力继续拆为独立深模块，由现有 facade 组合，不把新状态机堆回单个 `play-session.ts`。

## 17. 测试计划

测试继续放在仓库根目录 `__test__/<module>/`，通过包入口导入，并随 M1–M5 纵向增加。每个功能里程碑必须包含对应 Core invariant、transport contract、Desktop 交互与用户旅程；不要求 M1 开发前先完成 fsync、跨进程故障矩阵、windowing 或全部 browser smoke。

### 17.1 Core

- WorldEvent / Schedule / Pressure / Agenda schema round-trip。
- 无 cause 的事件被拒绝。
- world clock、revision、event sequence 单调。
- hard-due event 不受事件预算影响。
- `playerUnknown` 不进入 player-visible projection。
- hidden event reveal 保留原事件与 reveal link。
- trigger evaluator 对同一 snapshot 输出一致。
- invalid delta 不改变任何文件。
- 并行 correctness lane：staged transaction 在每个故障点可恢复 / 回滚。
- 两个相同 baseRevision 中只有一个可提交。
- checkpoint restore 同时恢复 state、events、schedule 与 knowledge。
- 条件式 migration slice：legacy session migration 保留未知字段和原始备份。

### 17.2 Agent

- M5：context 包含真实 transcript window、summary、current state、due events 与 source 内容。
- M5：omitted source 有预算原因。
- Tavern imported hint 不能覆盖 constitution / canonical rule。
- referee 输出必须引用宿主提供的 hard-due event。
- 场外事件不泄露到 player-visible narrative。
- 一次 turn 只有一份 final `PlayWorldRefereeSettlement`。

### 17.3 Backend / Client

- stream event 顺序稳定。
- cancel 后没有 committed turn 或部分文件。
- provider error / parse error 不追加 transcript。
- revision conflict 返回可处理的冲突。
- 并行 correctness lane：应用重开后能恢复 prepared transaction。
- client 能消费 provisional delta、committed artifact 与 world events。

### 17.4 UI

- transcript 只把 committed turn 视为事实。
- streaming block 在失败 / cancel 后正确处理。
- spoiler off 时不显示 hidden event。
- event feed 可追踪 cause 与 state delta。
- wait / advance time 能产生明确 action kind。
- branch / checkpoint 切换后 HUD 与 transcript 同步。
- 键盘操作、screen reader label、对比度和 reduced motion。

### 17.5 Adoption

- 生成 candidate 时自动附带 turn / event evidence。
- accept 前 canonical 文件保持不变。
- reject 不改变 Play session 已提交结果。
- source hash 变化时阻止静默套用旧 patch。

## 18. 端到端验收场景

1. 玩家选择等待两小时；world clock 推进，已到期的 NPC / faction 事件发生并进入 HUD。
2. 玩家一直聊天；一个已有 deadline 跨过阈值，场外世界发生可解释变化，而不是强制要求玩家先“触发剧情”。
3. 一个 `playerUnknown` 事件发生；当前 transcript 不泄露，后续通过有因果链接的新事件揭示。
4. 同一动作 retry；旧结果保留为 variant，新结果从相同 before-turn snapshot 开始。
5. restore checkpoint 后，后来发生的事件、schedule 变更、pressure 和角色知识一起回退。
6. 流式生成中取消；重新打开 session 时没有半条 transcript、半个状态或幽灵事件。
7. 在两个窗口同时提交；后提交者收到 revision conflict，不能覆盖先提交回合。
8. 关闭并重开应用；session 从 Markdown / YAML / turn artifacts 恢复完整世界。
9. canonical source 在 session 外发生变化；继续前出现 stale / rebase / fork 选择。
10. 作者把一个已发生事件 adoption 到 timeline / chapter；PendingAction accept 前真实文件无变化。
11. 相同 snapshot 与相同 trigger evaluator 输入得到同一 hard-due / eligible 集合。
12. `conversation`、`reactiveWorld`、`activeWorld` 三种模式的事件密度不同，但都不会吞掉硬性到期事件。

## 19. 风险与控制

| 风险 | 控制方式 |
|---|---|
| 模型滥造戏剧性事件 | cause 引用、三层结算、event budget、host validator |
| 状态与叙事矛盾 | 单一 settlement、render / validate before commit、state delta refs |
| 隐藏信息泄露 | knowledge projection 分层、player / referee context 分离、UI spoiler gate |
| 多文件半写入 | PlayTurnTransaction、revision lock、startup recovery |
| 事件系统演变为 event sourcing | snapshot 明确为恢复事实；ledger 只做审计、UI 与证据 |
| 多角色演变为多 Agent | 单 referee；speaker scheduler 与 agenda 只是确定性模块 |
| 数值化损害文学表达 | meter 可选；默认保留自然语言 pressure / agenda |
| 上下文无限增长 | transcript window、summary、source budget、context trace |
| Play 结果污染 canonical truth | `.workspace` 隔离、adoption candidate、PendingAction / diff |
| 参考代码许可证污染 | 只学模式；独立实现、独立 prompt、保留来源说明 |

## 20. 已冻结底座与下一功能缺口

以下清单用于防止把已完成的基础设施重新立项，也用于明确真正尚未交付的产品能力：

- [x] `turns/*.yaml` 是结构化回合事实，`transcript.md` 是 projection。
- [x] `play-local-state.yaml` 是当前 snapshot，events 不是唯一状态源。
- [x] 外部世界只在显式 Play turn / time advance 时结算。
- [x] 单 world referee，不引入 character agents 或 background agents。
- [x] hard-due evaluator 与 immediate consequence 的 typed event / cause 基础已落地。
- [x] Pressure / Agenda 与 eligible event evaluator 形成可玩的世界推进闭环。
- [x] event origin、cause、visibility 与 world time 已进入结构化结算和投影校验。
- [ ] 更严格的通用 typed state-delta refs 完成；M2 的 spoiler-safe 事件原因 / 影响 UI 已落地。
- [x] hidden event 的保存、Player / Author 投影与 adoption 防泄漏规则已明确。
- [x] Scene Rehearsal 的 per-step event partition、独立 host hard-due notice、exact derived content、selected aggregate projection 与 Client strict guard 已落地；`rumor` / hidden 不会被 notice 意外升级。
- [ ] branch-local knowledge、显式 reveal link 与随分支恢复完成。
- [x] PlayTurnTransaction、失败零写入、revision conflict、中断 stage 恢复，以及 cooperative cross-process session / attempt lock 与持锁 CAS 已明确。
- [ ] fsync、完整跨进程故障注入矩阵与可重启 terminal truth 作为并行加固闭环。
- [x] provisional stream 与 committed turn 在 UI 上有清晰区别；Stop 通过服务端 cancel confirmation 与 commit barrier 处理。
- [x] checkpoint / variant / Retry 已覆盖 transcript、state、events、schedule 与 suggestions。
- [x] 命名 checkpoint、可见初始世界与统一 worldline 已完成。
- [ ] knowledge / reveal / source trace 的分支语义完成。
- [x] canonical adoption 继续经过 PendingAction / diff / human approval。

## 21. 最终建议

“可解释、可回退、可提交”的底座已经成立，下一轮不再优先扩建通用基础设施。最小但完整的功能交付顺序是：

1. 已完成：Pressure / Agenda + eligible evaluator + 明确的相对等待 / 推进时间，让世界确实会继续变化。
2. 已完成：F1 Scene Rehearsal，让角色受限感知、导演控制与一次原子 Finish 成为可玩的纵向功能。
3. 已完成：M2 原因 / 影响 / worldline 与 F2 Source-backed Guided Start。
4. 下一候选：branch-local knowledge 与 reveal link，让隐藏变化可以安全地先发生、后揭示。
5. 下一候选：更短的 evidence-backed outcome / adoption 路径，让值得保留的 Play 结果进入人工审批。

这五项按纵向切片交付时，Play Mode 才会从“已经具备正确底座”继续成长为“世界会回应、作者能控制、结果可用于写作”的顶级功能。耐久性和规模化加固保持并行推进，但不再默认抢占功能主线。
