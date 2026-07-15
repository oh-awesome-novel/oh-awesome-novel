# Play Mode / Roleplay Sandbox Spec

Status: Draft Implementation Spec

## Goal

Play Mode 是 OAN 中与 Writing Mode 并列的沉浸式小说世界体验。它可以用于角色扮演、场景 rehearsal、多角色对话试跑和世界观体验，但默认不修改 canonical truth。

## Product And Navigation Level

Play Mode 是 workspace 内的顶级产品模式，不是 Writing 工作台右侧面板中的辅助 tab。

目标信息架构：

```text
Workspace
├── Writing
│   └── Novel Agent / file tree / chapter / diff / approval
└── Play
    └── Play session / transcript / scene / world HUD / events / adoption
```

约束：

- Workspace 顶级导航必须提供 `Writing | Play` 模式切换。
- 进入 Play 后，中间主区域切换为完整 Play workspace；不得继续以 `WorkspaceRightPanel` 中的 `Play` tab 作为主容器。
- Play 可以拥有自己的右侧 HUD / Event / Context / Adoption inspector，但它们属于 Play workspace 内部布局，不是 Writing review panel 中的 Play 入口。
- 顶级模式、当前 Play session 和选中 branch 应可恢复，并支持刷新或重新打开 workspace 后回到原位置。
- Writing 与 Play 共享同一小说 workspace、provider、canonical source 和 PendingAction 基础设施，但拥有独立的主交互状态与布局状态。
- 当前 `PlayModeTab.vue` / `rightTab: 'play'` 形态属于过渡实现，后续应迁移而不是继续扩展。

## Mode Boundary

- Writing Mode 面向正文、状态、时间线、伏笔和摘要的 PendingAction。
- Play Mode 面向互动 transcript、play-local state、activated sources、observations 和 adoption candidates。
- Play transcript 和 play-local state 不是小说事实源。
- 用户确认 adoption 后，Play observation 才能变成章节草稿、state、timeline 或 foreshadow PendingAction。

## Session Layout

Play session 使用 workspace 内部目录：

```text
.workspace/play-sessions/<session-id>/
  session.yaml
  transcript.md
  turns/
    <turn-id>.yaml
  play-local-state.yaml
  activated-sources.yaml
  events.yaml
  event-schedule.yaml
  observations.yaml
  adoption-candidates.yaml
  .migrations/                 # 仅在 legacy upgrade 后存在
    v1-to-v4/ | v2-to-v4/ | v3-to-v4/
      preview.yaml
      original/
```

当前 session schema 为 v4，turn artifact schema 为 v2。`turns/<turn-id>.yaml` 是已提交回合的结构化事实源；v2 artifact 用 `artifactKind` 区分 `worldSettlement` 与 `transcriptAppend`，可记录输入、消息、parent turn、revision、world clock、event / scheduled event / observation 引用、hard-due evidence、state delta、分支快照与 suggested actions，并始终保持 `canonical: false`。artifact v1 只用于旧 session 兼容读取。

非空 turn artifact ledger 必须形成至少包含一个 root 的无环图，父子 revision 严格递增；通常 `selectedTurnIds` 是一条连续的 root-to-head 路径。新 session 的完整 v2 root 可以共享 `parentTurnId` 为空的虚拟 branch base：首回合 Retry 会在这里形成多个 sibling root，before-turn / virtual-base selection 也可以显式使用空 selected path。只要存在 legacy / 不完整 root，或 branch base 已锚定 legacy head，就仍必须保持单 root 且禁止空 selected path。artifact、message、event、observation 和 adoption candidate id 必须唯一，artifact 对 `events.yaml` / `observations.yaml` 的引用及分支内来源引用在 staged write 前统一校验。无法识别或不完整的 v4 committed fact 必须拒绝，不能用默认值静默修补。

`session.yaml` 只保存 session metadata、revision、world clock、event policy、suggested actions、Play-local state visibility、`selectedTurnIds`，以及必需的 `branchSnapshotRequiredFromRevision` 与 `branchBaseSnapshot`。它不再保存完整 `transcript`；当 turn artifacts 存在时，`selectedTurnIds` 明确给出当前选中路径，或在上述完整 v2 forest 上显式给出虚拟初始基线的空路径，读取器不得自行猜测或混合分支。

v4 的 `playLocalStateVisibility` 必须与 Play-local state 的叶路径精确对应；缺项、多项、危险 dotted path 或非法 visibility 都必须拒绝。observation 与 adoption candidate 同样必须显式携带合法 visibility。只有 v1 / v2 / 可迁移 v3 读取允许用旧版兼容规则补足缺失 metadata，写入 v4 前必须完成规范化，不能把 legacy 默认继续传播为新事实。

`branchSnapshotRequiredFromRevision` 是 legacy cutoff / branch snapshot watermark：revision 高于 cutoff 的 artifact 必须是带完整 branch snapshot 的 v2 fact。`branchBaseSnapshot` 封存 cutoff 处的 parent turn、world clock、Play-local state value / visibility、schedule head 和 suggested actions，作为第一个新 v2 artifact 的可验证前驱。新 session 的 cutoff 为 `0`，base 是 revision / turn 均为 `0` 的初始快照；legacy session 升级时，cutoff 固定为当前 revision，base 锚定当时的 selected legacy head 和完整 session projection。v4 不得删除这两个字段或用推导默认值回填；watermark 必须等于 base clock revision 且不得超过 session revision，base 与 selected projection 或后续 artifact 不连续时 fail closed。

branch base 没有可验证的 v2 resolution owner，因此其中的 schedule 只能是 host-owned、尚未发生的 `scheduled` seed：不得携带 source / change / occurrence / cancellation evidence，且创建时间不能晚于 base clock。`occurred` / `cancelled` 历史必须由 turn artifact 闭环证明，不能以 revision 较高或“迁移数据”为由塞进 base；否则会出现 session 能创建却无法继续下一回合的幽灵计划。

`transcript.md` 是从 `selectedTurnIds` 指向的 turn artifacts 单向生成的人类可读 projection，不是可独立修改的第二事实源。读取 session 时不会把手工修改的 `transcript.md` 反向合并进回合事实；后续保存会按选中路径重新生成 projection。Core 为现有调用方保留的内存 `transcript` 同样来自该 projection。

旧 v1 / v2 session 继续兼容读取，并在内存中把 `session.yaml.transcript` 转为确定性的 legacy turn artifacts。高于当前 session 或 turn artifact schema version 的数据必须拒绝，避免旧客户端破坏未来数据。
旧 v3 session 只在其结构化 turns 仍为 artifact v1 且 selected projection 可验证时兼容读取，并在内存中把当前 selected head / projection 锚定为 v4 branch base。这类空 session 或 legacy artifact v1 session 会进入显式 v3 -> v4 migration preview / backup。若 v3 已包含 artifact v2，却没有 v4 必需的 branch base / cutoff 证据，读取器必须按“前驱不可验证”拒绝，不得自行推断 base 或生成迁移 snapshot。

Core 提供 v1 / v2 / v3 -> v4 migration preview。旧 session 第一次写入 v4 snapshot 时，原始 session 会完整备份到 `.migrations/v1-to-v4/original/`、`.migrations/v2-to-v4/original/` 或 `.migrations/v3-to-v4/original/`，同目录保存 `preview.yaml`；旧 `session.yaml` 的未知顶层 metadata 会写回 v4 metadata。迁移同时把当前 legacy projection 封存为 `branchBaseSnapshot`，并把当前 revision 记为 cutoff；只有此后的 artifact 被强制使用完整 v2 branch snapshot，因此不需要伪造 legacy 前史。已有 `.migrations/` 历史必须复制进后续每次 staged snapshot，不能因普通保存而丢失。当前 Core 已具备 preview 与备份基础，但 backend / client / UI 的显式迁移确认流程仍属于待实现范围。

`event-schedule.yaml` 保存 Play-local scheduled event 的当前状态与证据。第一阶段 trigger 只允许 `nextTurn`、`afterTurns`、`flagEquals`、`atWorldTime` 和 `manual`；`atWorldTime` 没有 world contract 提供的规范化比较器时保持 pending，宿主不得猜测自然语言时间顺序。到期判断是纯函数，`nextTurn` / `afterTurns` / `flagEquals` 在相同 snapshot 上必须产生稳定排序的相同结果。

scheduled event 到期后成为 hard-due skeleton。referee 必须在 settlement 中用 `cause.triggerId` 恰好结算一次，并保持 host template 的 kind、origin、title 与 visibility；遗漏、重复、伪造或试图取消已到期事件都会使整个回合失败。hard-due event 不占 `maxExternalEventsPerTurn`，而非到期的 spontaneous event 继续受预算约束。referee 可通过 typed `scheduledEventChanges` 创建、取消或改期未来事件；宿主分配 id、revision、turn 与来源证据。Core 与 Client 都必须复核完整 transition：不能删除 predecessor schedule；未变项必须逐字段相等；取消 / 已发生必须保持原 plan 且绑定当前 referee resolution；改期只能修改允许的 trigger / priority 并携带当前回合证据；新建 schedule 也必须有当前 referee 的创建证据。

每个 v2 turn artifact 都以 `branchSnapshotVersion: 1` 标记完整分支快照，并保存该 artifact 的 world clock、Play-local state value / visibility after-state、suggested actions 与完整 schedule head（`scheduledEventIds` + after-state snapshots）。`worldSettlement` 还保存宿主在调用模型前确定的 `dueScheduledEventIds`；读取器必须从完整 parent snapshot，或从 `parentTurnId` 与 artifact 对齐的 `branchBaseSnapshot`，取得可验证的前驱 clock / state / visibility / schedule / suggestions。在这份前驱上重跑纯 evaluator 并核对 evidence，因而 root 或 legacy bridge 也不能提前发生、漏掉 hard-due，或在到期后取消 / 改期。父子 artifact 的 kind、消息形状、clock、state delta、visibility 和 schedule transition 必须连续，event clock、resolution turn 与 host template 必须能回指所属 artifact；普通 `transcriptAppend` 不得伪造 input、event、state delta、observation 或 schedule change。任意嵌套 Play-local state 在 session、delta 与 snapshot 之间必须深拷贝，历史证据不能因内存别名被同步改写。

`session.yaml` 的 world clock、state visibility、suggested actions，`play-local-state.yaml` 和 `event-schedule.yaml` 必须与 `selectedTurnIds` 的 head snapshot 一致；兄弟分支的时钟、状态、可见性、建议或计划不能进入当前 evaluator、prompt 或 HUD，event / observation / candidate UI 也只投影 selected artifact refs。ledger 可以保留合法兄弟分支的历史事实，因此持久化校验要求 provenance 全局存在且落在同一条连贯分支，不要求所有历史都属于当前 selected path；但手工新建 observation / candidate 时只能引用当时选中的分支。无法可靠投影时必须 fail closed。只有 revision 不高于 cutoff 的 artifact schema v1 历史记录才走 legacy 兼容投影；当 selected head 仍是 legacy 时，它必须等于 base parent，且 session projection 必须逐项等于 base。legacy 兼容不得向后续完整 v2 head 注入无来源 schedule 或其他分支状态。

已提交 turn artifact 同时充当 Play-local 隐式 checkpoint，不建立第二套分支事实。完整 v2 branch snapshot，以及与 `branchBaseSnapshot.parentTurnId` 对齐的 legacy base head，可以成为恢复目标；列表摘要只使用用户输入或 artifact id，不能把 referee / hidden narrative 暴露为 player-visible preview。恢复操作必须携带 `baseRevision`，与其他同 session mutation 共用互斥锁，并通过 staged snapshot 一次写入。

恢复 checkpoint 会把 `selectedTurnIds` 切换为目标的 root-to-head path，同时恢复 transcript、world turn / anchor / elapsed、Play-local state value / visibility、schedule 与 suggested actions。session revision 和 session world-clock revision 仍单调增加，不能退回目标 artifact 的旧 revision；完整 artifact、event、observation 和 adoption ledger 均保留。旧后续回合因此成为可再次选择的 variant，恢复后提交的新回合则从目标 head 创建 sibling。

原子 Retry 使用独立 SSE 路由，并且请求只能携带 mandatory `baseRevision`；行动文本与 action kind 必须从目标 `worldSettlement` artifact 的不可变 typed input 读取，调用方不能覆盖。Core 只在内存中投影到该 artifact 的 before-turn state，provider、prompt 与 hard-due evaluator 都读取这份投影；最终 settlement 直接在权威 ledger 上生成同 parent sibling，session revision 只增加一次。旧 source artifact、其 descendants、event、observation 与 adoption ledger 均保留，只有新 sibling 成为 selected head；取消、provider / schema failure 或 commit 前 revision drift 都保持 session 零写入。首回合 Retry 通过共享虚拟 branch base 的两个完整 v2 root 表达，而不是把新结果错误挂到旧回合的 after-state。

当前切片仍不包含命名 checkpoint、在历史 UI 中可直接选择的初始空世界 checkpoint，也没有独立的 branch-local knowledge / reveal store。Retry 会重新读取当前 activated source path 对应内容，因此在 context trace / source drift 封存落地前，只保证现有 transcript、state、events、schedule 与 suggestions 的同 before-turn projection，不能声称复现旧回合当时完全相同的外部 source bytes。

session snapshot 采用 sibling staging directory + ready marker + directory swap 写入，固定 YAML / Markdown 文件、`turns/` 回合事实、event schedule 和 migration history 处于同一 snapshot。提交中断时，读取器可以恢复完整 stage 或已有 backup；不得并行直写目标文件形成混合 revision。同一 session 的 world turn、transcript、observation 和 adoption mutation 必须共享互斥锁，并支持 `baseRevision` 冲突检查。

这些文件用于恢复、复核和继续 Play，不进入 `chapters/`、`state/`、`timeline/`、`foreshadow/` 等事实域。

## Core Module Seams

Play Core 的实现保持以下单向依赖，`play-session.ts` 仅作为兼容 facade、settlement orchestration 与 filesystem persistence 入口：

- `play-types.ts`：无 Play 运行时依赖的公共领域类型叶。
- `play-event-schedule.ts`：trigger / template / schedule codec 与纯 due-event evaluator。
- `play-turn-artifact.ts`：turn artifact codec、legacy artifact conversion 与 selected transcript projection。
- `play-event-schedule-history.ts`：schedule history、due evidence、transition、ancestor ownership 与 snapshot clone。
- `play-session-facts.ts`：selected path、branch snapshot、ledger provenance、事实 projection 与严格 stored-fact codec。
- `play-turn-graph.ts`：隐式 checkpoint 摘要、selected path 恢复与 sibling variant 语义。
- `play-turn-retry.ts`：before-turn 投影、typed source action、原子 sibling settlement 与稳定 retry error code。
- `play-session.ts`：session lifecycle、referee settlement、staged snapshot、migration 与兼容 public interface。

后续 Pressure / Agenda、checkpoint / variant、context trace、migration confirmation 等新增能力应建立独立深模块，再由 facade 组合；不得把新的领域状态机继续直接堆入 `play-session.ts`。包入口继续通过现有 Play public interface 暴露能力，包内文件拆分不应迫使 Backend、Client 或 Desktop UI 改用私有路径。

## Runtime Shape

第一版采用：

```text
single world referee
  + character voice/state modules
  + activated canonical sources
  + imported interaction hints / lorebook
  + play-local state
  + world clock / typed external events
  + structured settlement before Play-local commit
```

不引入重型多 agent runtime。多角色效果优先通过明确的角色 voice/state module 和世界裁判 prompt 达成。

Play turn transport 使用专用 typed SSE，而不是把 Play transcript 伪装为普通聊天消息。生命周期为 `started -> context.ready -> narrative.delta* -> (narrative.reset -> narrative.delta*)* -> prepared -> (event.occurred*) -> committed | cancelled | failed`：

- `narrative.delta` 永远是 provisional，不能写入 `turns/*.yaml`、`transcript.md`、state 或 event ledger。
- `narrative.reset` 表示同一 turn 在完成中间 read-tool loop 后开始生成替代正文；UI 必须丢弃该 turn 此前的全部 provisional 文本，再从后续 `narrative.delta` 重新构造 provisional block。它不表示回合已提交，也不推进 revision。
- `oan-play-settlement` fence 与其 JSON 仅在服务端缓冲和校验，不进入 provisional UI。服务端会先隔离完整 provider response，只有观察到 settlement boundary 后才检查并释放 boundary 之前的 narrative prefix；prefix 必须是纯 prose，出现花括号、settlement 字段标签、额外 fence 或 raw marker 会使整次响应失败。因此完全省略 fence、在合法 fence 前偷放 raw JSON、或只有普通文本的无效响应都不会产生 provisional delta / commit。为避免不完整或变体 fence 在 chunk 边界泄出，filter 遇到任意 backtick / tilde fenced block 或原始 settlement marker 都会保守停止；失败 / conflict 等未提交终态会清空 provisional block。这以 token-by-token 延迟和少量 prose 语法限制换取结构化结算 fail-closed，仍不能从语义上证明自然语言正文绝不提及隐藏事实。
- Stop 通过服务端 turn registry 和显式 cancel endpoint 执行；响应头会在首个 SSE event 前提供 turn id，使首帧前断流也能查询服务端终态；浏览器仅停止读取流不能单独证明回合已取消。
- `prepared` 后、commit barrier 前仍可取消；进入 staged snapshot commit 后不再用 AbortSignal 中断文件交换，晚到取消必须返回 committing / committed truth。
- UI 只有收到 `play.turn.committed` 或 cancel 查询返回 committed session 时才替换 authoritative Play session；cancel / provider / schema failure 不推进 revision。
- 若 stream 与终态查询同时不可达，UI 必须进入 indeterminate / refresh-required 状态，不得声称“未提交”；刷新成功前禁止发起新的 Play-local mutation。
- turn registry 绑定启动时的不可变 workspace；活跃 Play turn 期间不得切换或移除 active workspace，迟到的 committed 对账也不得用旧 revision 回滚 UI。
- `play.event.occurred` 只会在包含该事件与 schedule 状态的 staged snapshot 已持久化成功后发布；cancel、provider error、schema failure 或写入失败都不得发布。它提供逐事件 committed 通知，但 `play.turn.committed.session` 仍是 transcript、world state、schedule、observation 和 event feed 的权威 UI 刷新载荷。
- `POST /api/workspace/play-sessions/:id/turns/:artifactId/retry/stream` 复用同一 lifecycle、run registry、Stop / reconcile 与 commit barrier；SSE `turnId` / 响应头表示 execution run id，source artifact 与新 sibling artifact 使用独立字段。Desktop 在生成期间展示 before-turn projection、原始 action 和明确的 provisional / variant 保留提示，只有 authoritative committed session 才切换分支。

当前该协议保证单 backend 进程内的 stop / commit 一致性；跨进程锁、fsync、可重启 terminal registry、graceful shutdown、SSE backpressure 和逐故障点耐久性仍由 task 1120 后续范围追踪。provisional narrative 仍依赖 referee 遵守 hidden-information 叙事约束；响应隔离能阻止缺失 / 变体 fence 下的结构化结算外泄，但不能证明模型没有在 narrative 自然语言中写出隐藏事实。

## Activated Sources

Play session 可激活：

- character card canonical facts
- `interaction.md`
- `lorebook.yaml`
- world rules
- current state
- timeline anchor
- active hooks
- location / faction / item context

每个 activated source 必须记录 source id、path、trigger reason、budget layer 和 trust level。

## Observations And Adoption

Play observation 只表示“在这次 Play 中发生或显露的内容”。它可以被用户选中并转为 adoption candidate：

- chapter draft candidate
- state update candidate
- timeline event candidate
- foreshadow candidate

Adoption candidate 仍不是事实。它必须进入 PendingAction / diff / Human Approval。

`playerUnknown` event 产生的 Play-local state、observation 和 candidate 必须携带明确 visibility / provenance。隐藏原因可以产生玩家可感知的结果（例如暗处行动带来脚步声），所以宿主不能用 source visibility 的简单单调关系否决正常因果；player-visible / rumor summary 只能描述可感知后果，`cause.reason` 与 `playerUnknown` 内容始终属于 author view。spoiler 默认关闭时，隐藏内容和因果分析不能出现在 player-visible HUD 或 adoption 表单中；作者显式开启 author view 后才可查看。candidate 至少记录去重的 source observation ids，并继承其 turn / event refs；candidate id 由宿主生成，调用方不能指定或复用 ledger identity。

## Tavern-Compatible Character Import

Play Mode 支持导入 Tavern-compatible Character Card 用作 Play-only 角色或 OAN 角色卡导入预览。

规则：

- 独立解析 JSON / PNG metadata，不复制 SillyTavern AGPL 代码。
- `system_prompt`、`post_history_instructions`、`character_book` 默认是 untrusted imported content。
- imported lorebook 可用于 Play context activation，但不自动写入 `world/` 或 `state/`。
- 不声称官方 SillyTavern 兼容。
- 不自动抓取分享站点角色卡。
