# Play Mode / Roleplay Sandbox Spec

Status: Implemented specification with reliability follow-up in [1120](tasks/1120.md).

## 综漫融合契约（1500）

Launch Package schemaVersion 1 的来源可带 `originWork: { id, title }`。作品 id 是有界稳定标识，标题是作者显示名；同 id 不得有不同标题，不自动合并同名角色。选了两个以上作品时必须显式提交可选的 `crossover`：`works: {id,title}[]`、`fusion: merged | visitor | layered`、`knowledge: isolated | shared`、`rulePrecedence: {topic,winner,note}[]`，winner 引用 works 的 id。契约作品清单必须与标注来源一致。

旧 Launch Package 没有这些字段仍按原合同读取，不补默认契约，不进行迁移。未启用契约的会话保持原有序列化和冻结前缀。作品归属可单独标注；只有两部以上才启用融合。来源未标注作品、多作品都有 world 来源但没有裁定条目，均为非阻断警告，宿主不判断语义冲突。

1530 的正式作品登记见 `works.yaml` 与对象的 `originWorkId`。开局来源选择会预填正式归属，角色同目录的各文件共用 meta 归属；作者仍可调整并确认。显式“预填作品归属”先读正式文件，未标注时才查仍保留的 accepted 采纳记录。`original` 不回退到参考来源；没有清单不创建默认文件，旧 Launch Package 的字段与读取合同不变。

确认开局后在会话 metadata 的 `playCrossover` 冻结契约、来源摘要/hash 与参与者的作品/初始来源边界，进入固定系统前缀。isolated 下初始资料只来自本人作品；未标注的角色不自动得到任意作品的知识。shared 下使用已选来源。作者提供的当前场景与人物意图仍是显式输入。场景试演按此边界构造逐角色的初始感知资料，跨作品资料使用现有 Director 显式知识授予并记录来源回合。

启用契约的沉浸会话允许 `knowledgeChanges` 中 `learnSource: {type, participantRef, sourceId, eventRef}`（eventRef 是本回合 informationSpread 事件的一基位置）。宿主校验参与者、冻结来源、重复授予和事件依据，生成 `playKnowledge` 内的 `sourceGrant`：`id, kind, participantRef, sourceId, learnedAtTurnId, learnedByEventId, canonical:false`。该记录属于原有分支快照，不能通过 stateDelta 伪造；Restore/Retry 不继承兄弟分支的获知。没有融合契约的会话拒绝此变更。Player 通用状态不展示私有的参与者认知。

认知边界限定模型输入和可追溯的状态变化，不宣称自然语言叙述绝无语义泄漏。契约不修改正式 world/、角色或 timeline 文件。

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
- 顶级 Writing / Play 独立导航已交付；旧 `rightTab: play` 是历史过渡形态，不再作为迁移 backlog。

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

Core 提供 v1 / v2 / v3 -> v4 migration preview。旧 session 在用户明确确认升级后才写入 v4 snapshot，原始 session 会完整备份到 `.migrations/v1-to-v4/original/`、`.migrations/v2-to-v4/original/` 或 `.migrations/v3-to-v4/original/`，同目录保存 `preview.yaml`；旧 `session.yaml` 的未知顶层 metadata 会写回 v4 metadata。迁移同时把当前 legacy projection 封存为 `branchBaseSnapshot`，并把当前 revision 记为 cutoff；只有此后的 artifact 被强制使用完整 v2 branch snapshot，因此不需要伪造 legacy 前史。已有 `.migrations/` 历史必须复制进后续每次 staged snapshot，不能因普通保存而丢失。Backend / Client / UI 已接入显式预览确认，确认绑定 revision 和原始文件指纹；普通 mutation 不能隐式升级，旧 transcript 可在升级面板只读查看。

`event-schedule.yaml` 保存 Play-local scheduled event 的当前状态与证据。第一阶段 trigger 只允许 `nextTurn`、`afterTurns`、`flagEquals`、`atWorldTime` 和 `manual`；`atWorldTime` 没有 world contract 提供的规范化比较器时保持 pending，宿主不得猜测自然语言时间顺序。到期判断是纯函数，`nextTurn` / `afterTurns` / `flagEquals` 在相同 snapshot 上必须产生稳定排序的相同结果。

scheduled event 到期后成为 hard-due skeleton。referee 必须在 settlement 中用 `cause.triggerId` 恰好结算一次，并保持 host template 的 kind、origin、title 与 visibility；遗漏、重复、伪造或试图取消已到期事件都会使整个回合失败。hard-due event 不占 `maxExternalEventsPerTurn`，而非到期的 spontaneous event 继续受预算约束。referee 可通过 typed `scheduledEventChanges` 创建、取消或改期未来事件；宿主分配 id、revision、turn 与来源证据。Core 与 Client 都必须复核完整 transition：不能删除 predecessor schedule；未变项必须逐字段相等；取消 / 已发生必须保持原 plan 且绑定当前 referee resolution；改期只能修改允许的 trigger / priority 并携带当前回合证据；新建 schedule 也必须有当前 referee 的创建证据。

每个 v2 turn artifact 都以 `branchSnapshotVersion: 1` 标记完整分支快照，并保存该 artifact 的 world clock、Play-local state value / visibility after-state、suggested actions 与完整 schedule head（`scheduledEventIds` + after-state snapshots）。`worldSettlement` 还保存宿主在调用模型前确定的 `dueScheduledEventIds`；读取器必须从完整 parent snapshot，或从 `parentTurnId` 与 artifact 对齐的 `branchBaseSnapshot`，取得可验证的前驱 clock / state / visibility / schedule / suggestions。在这份前驱上重跑纯 evaluator 并核对 evidence，因而 root 或 legacy bridge 也不能提前发生、漏掉 hard-due，或在到期后取消 / 改期。父子 artifact 的 kind、消息形状、clock、state delta、visibility 和 schedule transition 必须连续，event clock、resolution turn 与 host template 必须能回指所属 artifact；普通 `transcriptAppend` 不得伪造 input、event、state delta、observation 或 schedule change。任意嵌套 Play-local state 在 session、delta 与 snapshot 之间必须深拷贝，历史证据不能因内存别名被同步改写。

`session.yaml` 的 world clock、state visibility、suggested actions，`play-local-state.yaml` 和 `event-schedule.yaml` 必须与 `selectedTurnIds` 的 head snapshot 一致；兄弟分支的时钟、状态、可见性、建议或计划不能进入当前 evaluator、prompt 或 HUD，event / observation / candidate UI 也只投影 selected artifact refs。ledger 可以保留合法兄弟分支的历史事实，因此持久化校验要求 provenance 全局存在且落在同一条连贯分支，不要求所有历史都属于当前 selected path；但手工新建 observation / candidate 时只能引用当时选中的分支。无法可靠投影时必须 fail closed。只有 revision 不高于 cutoff 的 artifact schema v1 历史记录才走 legacy 兼容投影；当 selected head 仍是 legacy 时，它必须等于 base parent，且 session projection 必须逐项等于 base。legacy 兼容不得向后续完整 v2 head 注入无来源 schedule 或其他分支状态。

已提交 turn artifact 同时充当 Play-local 隐式 checkpoint，不建立第二套分支事实。完整 v2 branch snapshot，以及与 `branchBaseSnapshot.parentTurnId` 对齐的 legacy base head，可以成为恢复目标；列表摘要只使用用户输入或 artifact id，不能把 referee / hidden narrative 暴露为 player-visible preview。恢复操作必须携带 `baseRevision`，与其他同 session mutation 共用互斥锁，并通过 staged snapshot 一次写入。

恢复 checkpoint 会把 `selectedTurnIds` 切换为目标的 root-to-head path，同时恢复 transcript、world turn / anchor / elapsed、Play-local state value / visibility、schedule 与 suggested actions。session revision 和 session world-clock revision 仍单调增加，不能退回目标 artifact 的旧 revision；完整 artifact、event、observation 和 adoption ledger 均保留。旧后续回合因此成为可再次选择的 variant，恢复后提交的新回合则从目标 head 创建 sibling。

原子 Retry 使用独立 SSE 路由，请求必须携带 `baseRevision`，可选携带重演指引 `guidance`，不接受其他字段；行动文本与 action kind 必须从目标 `worldSettlement` artifact 的不可变 typed input 读取，调用方不能覆盖。Core 只在内存中投影到该 artifact 的 before-turn state，provider、prompt 与 hard-due evaluator 都读取这份投影；最终 settlement 直接在权威 ledger 上生成同 parent sibling，session revision 只增加一次。旧 source artifact、其 descendants、event、observation 与 adoption ledger 均保留，只有新 sibling 成为 selected head；取消、provider / schema failure 或 commit 前 revision drift 都保持 session 零写入。首回合 Retry 通过共享虚拟 branch base 的两个完整 v2 root 表达，而不是把新结果错误挂到旧回合的 after-state。

### 带指引的重演（Guided Retry）

[1450](tasks/1450.md) 为 Retry 增加作者指引，记录方式为规划中的方案 B。

- 请求：`guidance` 为可选字符串。去掉首尾空白后为空等同于没有指引；否则最多 500 个字符（按 Unicode code point 计），非字符串或超长时返回 400 `invalidGuidance`，不调用模型、不写入。
- 提示：指引只作为 `<本次重演要求>` 块出现在这一次 Retry 请求的消息尾部，位于本轮回合要求之后、玩家输入之前。它不进入冻结前缀，也不进入任何后续回合的请求；块内说明行动不变、不得在叙述中提及重演，也不能越过隐藏信息、因果约束与结算格式。
- 存储：新 sibling 是 v2 `worldSettlement`，带可选字段 `retryGuidance: { sourceArtifactId, text }`。`text` 已去除首尾空白且非空、不超过 500 字符；`sourceArtifactId` 必须是 ledger 中 revision 更早、`parentTurnId` 相同的 sibling，不能指向自己。源 artifact 及所有其他 ledger 事实逐字节不变。
- 兼容：这是 artifact v2 的可选字段，不提升 artifact 或 session schema 版本。没有该字段的旧 artifact 读取结果与之前完全相同；v4 严格读取不放宽：字段只允许出现在 v2 `worldSettlement` 且带 input 的 artifact 上，结构不合法、引用不存在或不是更早 sibling 时整个 session 读取失败，不静默丢弃。不认识该字段的旧客户端会按未知字段拒绝，属于 fail closed。
- 可见性：`retryGuidance` 是导演信息。存档点摘要通过可选 `retryGuidance` 字段携带它，Desktop 只在导演视角渲染；参与者视角的存档点、世界线预览与采纳表单不显示它。`preview` 仍只使用作者行动文本。
- 不带指引的 Retry 与此前逐字段一致；取消、provider / schema 失败或 revision 漂移仍保持零写入。

### 补充行动建议（Extra Suggestions）

`POST /api/workspace/play-sessions/:id/suggestions` 接收 `{ baseRevision, headId?, existing? }`，返回 `{ suggestions, baseRevision, headId? }`。

- 只读：一次请求最多一次模型调用，复用会话内只读提问通道（冻结前缀 + 选中分支的已提交叙述 + `<暂停推演：只读辅助请求>`），初始世界只带开场。指令要求只按参与者已知内容给出 3–4 条带类型前缀的行动，并避开 `existing` 中已显示的条目。不追加 `<当前状态>` 块。
- 不写入：不改 session 快照、revision、`suggestedActions` 或选中分支；结果由界面临时显示，直接选与改一改走普通回合事务。
- 并发：会话被回合或其他操作占用时返回 409；请求本身不占用会话锁，因此普通读取不受影响。生成结束后若 revision 或选中 head 已变化，返回 409，不交付过期建议。模型回复不是合法的 `oan-play-suggestions` JSON 或没有新条目时返回 422，不重试。
- 与 [1520](tasks/1520.md) 的“生成候选项 / 换一批”共用这一入口。

命名 checkpoint、可直接选择的初始世界、branch-local knowledge / reveal、context trace 与 source drift 已由 M2/M3/1180 交付。Retry 仍不承诺旧 activated source bytes 的精确复现；continueFrozen 表示沿用 Play-local 状态并省略漂移来源。world session/artifact 为 v4/v2，rehearsal 的 v5/v3 另有合同，不能混称统一最新版本。

session snapshot 采用 sibling staging directory + ready marker + directory swap 写入，固定 YAML / Markdown 文件、`turns/` 回合事实、event schedule 和 migration history 处于同一 snapshot。提交中断时，读取器可以恢复完整 stage 或已有 backup；不得并行直写目标文件形成混合 revision。同一 session 的 world turn、transcript、observation 和 adoption mutation 必须共享互斥锁，并支持 `baseRevision` 冲突检查。

这些文件用于恢复、复核和继续 Play，不进入 `chapters/`、`state/`、`timeline/`、`foreshadow/` 等事实域。

### Play Message Log

每个 Play session 另有一份只追加的调试日志 `.oan/sessions/.play-logs/<session-id>/messages.jsonl`（已被 `.gitignore` 忽略）。world-referee 回合记录 `author_action`、`model_request`（完整 prompt）、`model_reasoning`、`model_output` 与 `turn_committed` / `turn_cancelled` / `turn_failed`；rehearsal 的 actor 与 referee 调用按 `attemptId`、`participantRef`、`stepRef` 记录请求、思考与输出，并在 `data.outcome` 标出 completed / aborted / failed。

- 日志只用于作者调试：不进入 turn artifact、rehearsal evidence、context trace、adoption、导出或 Git；Play 状态与 projection 不读取它；写入失败不影响回合结果。
- 思考内容不出现在 Play SSE 与 Play 主界面。Desktop 在 inspector 中提供“消息日志”入口，按时间顺序分页列出全部条目，可按类型与角色筛选，思考与请求默认折叠；无法解析的行被跳过并提示数量。
- `GET /api/workspace/play-sessions/:id/message-log?cursor=&limit=` 按行游标分页（默认 200，最多 1000），活跃回合期间也可读取。
- world referee 通过 agent turn 运行时固定使用 `novel.play_scene` capability，不再依赖关键词推断（referee prompt 中的 `oan-play-settlement` 曾被误判为“整理本章”写能力）。

### Steer And Follow-up

- 已提交的回合不因插话改写。world-referee 回合的插话就是“取消 + 重发”：前端用现有 cancel 端点取消未提交生成，确认 `cancelled` 后以原行动加补充文本、同一 `baseRevision` 重发；取消晚于提交时，插话变成下一条排队行动。不新增 artifact 字段，schema 不变。
- 排队行动只在内存中，按 session 隔离；回合提交后用新 revision 发送下一条，未提交、revision 冲突、结果未知、来源变化待决定或其他操作占用时暂停，等作者“继续发送”。
- `POST .../turns/stream` 可带可选 `delivery: 'steer' | 'follow_up'`，只记入消息日志 `author_action.data.delivery`。
- Rehearsal 中 actor 生成时的插话映射为该 step 的 `redirectStep`（Retry 立即停止后改写原 step；新 step 等 draft 生成后改写），沿用 redirect 的约束校验；可选 `delivery: 'steer'` 只进入消息日志。

### Turn Choice Options

每回合的本轮回合要求向裁判要求 3–4 条候选行动，写入结算的 `suggestedActions`。存储合同不变：最多 6 条字符串，随分支快照保存；规则在消息尾部，冻结前缀不含它，因此旧会话同样适用。

- 每条以一个类型前缀开头：`[say]`、`[look]`、`[move]`、`[do]`，或带整数时长的 `[wait Nm]`、`[wait Nh]`、`[wait Nd]`。`play-turn-choices.ts` 的 `parsePlayTurnChoice` 是唯一把存储字符串转成行动类型、等待时长和显示文本的地方；界面不显示前缀。
- 没有可识别前缀的字符串按原文显示，行动类型沿用措辞推断。宿主不从措辞推断等待时长：只有前缀写明且不超过一年的时长才成为 typed wait，否则由作者在输入区选择。
- 候选项是输入辅助。直接选、修改后选和自己写提交的都是普通作者行动，走同一回合事务；候选项不足不使回合失败。
- 结算可见性为 `playerUnknown` 的回合仍不保存候选项。候选项为空、不足或想换一批时，界面使用上文的补充行动建议，结果只临时显示。

### Canon Beats And Divergence Ledger

沉浸推演（v4）可以在引导开局时带一张原作节点表，记录哪些原作事件照常发生、被改写、被阻止或不再适用。范围与验收见 [1480](tasks/1480.md)，核实结论见[实施计划](superpowers/plans/2026-11-10-play-canon-beats.md)。

**存储。** 节点表是 Play-local state 的保留键 `canonBeats`，做法与 `worldMomentum` 相同：随 `branchBaseSnapshot` 和每个 turn artifact 的状态快照保存，Restore、Retry 与阶段归档不需要另一套逻辑。它属于会话，不修改 `timeline/` 文件；进入正式文件只有显式采纳一条路。

```yaml
canonBeats:
  schemaVersion: 1
  protagonistKnowsCanon: false
  beats:
    - id: canon-beat-1            # 宿主分配
      label: 码头仓库暑期读书会
      expectedWhen: 今年七月十七日   # 只作说明，宿主不比较
      source:
        kind: sourceBacked         # 或 authorProvided + providedAt
        sourceId: source-timeline-events
        path: timeline/events.yaml
        contentHash: <sha256>
        quote: 码头仓库暑期读书会   # 冻结时在来源里逐字存在
      status: pending              # pending | occurredAsCanon | altered | prevented | obsolete
      visibility: playerUnknown    # 由 protagonistKnowsCanon 决定
      causeEventIds: []
  changes: []                      # 只增不改的变更记录
```

**兼容规则。**

- session schema 仍为 v4，artifact schema 与 branch snapshot watermark 不变。
- 是否启用在创建时决定：`canonBeats` 键的有无在 predecessor 与当前快照之间必须一致。旧会话没有这个键，不能追加启用。
- 未启用的会话在存储与模型请求上与之前逐字节一致：冻结前缀不含节点协议，回合尾部没有节点段，结算里没有 `canonBeatChanges`，launch package 没有 `canonBeats` 字段。
- 场景试演（v5）不支持节点表。

**开局。** `PlayLaunchPackage` 增加可选 `canonBeats: { protagonistKnowsCanon, beats[] }`，上限 24 条，只对 `immersiveJourney` 有效。来源节点必须引用一个已选的 `timeline` 来源，`quote` 必须是该文件当前内容的逐字子串；宿主冻结 `path`、`contentHash` 与 `quote`。找不到引文时给出 `canonBeatQuoteMissing` 诊断并阻止创建。手写节点没有引文，标为 `authorProvided`。来源文件之后变化走现有来源漂移流程，节点保留冻结时的引文。

**结算协议。** 启用节点表的会话，冻结前缀在创建时追加一段节点协议，回合尾部列出全部节点及状态。结算增加可选字段：

```json
"canonBeatChanges": [
  { "beatId": "canon-beat-1", "status": "prevented", "reason": "仓库在活动前被封", "eventRefs": [1] }
]
```

- `eventRefs` 是本回合 `events` 数组里的 1 起始位置，至少一个。模型不知道宿主分配的事件 id，所以不用 id 引用。
- 裁判只能把 `pending` 改成四种终态之一，每回合每条节点至多一次。
- 节点不存在、迁移不合法、引用越界或不是整数、会话没有节点表，都使整回合失败且零写入，与其它结算校验一致。
- 宿主不判断自然语言剧情是否“算发生”，不自动推进节点，不自动生成被阻止后的连锁后果；后果由裁判作为普通事件或 Pressure 提出，受现有事件预算约束。

**导演操作。** 两个操作都写成一条导演记录：`artifactKind: transcriptAppend`、说话人 `director`、消息内容不含节点文本。只有导演记录可以：

- 带 `stateDelta.canonBeats`：手动更正节点状态，记为 `origin: manual` 的变更记录。可以把 `pending` 改成终态，或在终态之间改写；不能回到 `pending`（改回只能通过重演该回合）。
- 在计划表里新增 `scheduled` 条目：把一条待发生节点转成计划事件，使用现有触发类型，`sourceTurnId` 指向这条导演消息。绝对时间仍须是带时区的 ISO 格式。没有转成计划事件的节点不会自己发生。

其它 `transcriptAppend` 的规则不变。Core `play-session-facts.ts` / `play-event-schedule-history.ts` 与 Client 的重放校验按同一规则放宽。

**可见性。** `canonBeats` 在通用状态里固定为 `playerUnknown`，不出现在“推演内状态”。专用投影按节点 `visibility` 过滤：穿越者不知道原作时，参与者视角的世界面板、结果报告和采纳表单都拿不到节点的标签、引文、理由与状态；导演视角全部可见。

**结果报告。** 报告增加“与原作的差异”分组：已改写、已阻止、不再适用的节点各成一项，证据指向造成变化的回合与事件，可以保存为写作参考或进入采纳。手动更正的节点标明来源是作者。

**阶段归档。** 开启新阶段时宿主克隆整个会话，节点表完整带入。归档提示与 `resourceState` 审计不包含 `canonBeats`，不要求模型复述。

### 角色贴合度检查（In-character Check）

[1510](tasks/1510.md) 交付。作者在一个已提交的沉浸推演回合，或场景试演当前 attempt 的一个角色步骤上显式发起；每次点击最多一次只读模型调用。结果是带引文的意见，不打分、不阻断任何操作、不自动重演或改写。

**入口。** `POST /api/workspace/play-sessions/:id/character-checks` 接收 `{ target, lens }`，不接受其他字段；`GET` 同一路径加 `?lens=player|director` 列出该视角的报告。`target` 是 `{ kind: 'turn', turnId }`、`{ kind: 'turnMessage', messageId }`（宿主解析为选中分支上包含该消息的回合，报告里统一记为 `turn`）或 `{ kind: 'rehearsalStep', attemptId, stepRef }`。调用方不能自带材料。

**固定材料。** 由宿主构造，模型不拿到别的会话内容、兄弟分支或内部路径：

- 叙述：回合里说话人不是 `user` / `director` 的已提交消息；试演步骤的 narrative blocks。
- 沉浸推演的角色资料只取会话创建时冻结进 `frozenSystemPrompt` 的角色块（`characters/<id>/` 下的来源、`role: character` 的来源、导入角色卡的会话内来源）和 `characterRoster` 的名册档案（姓名、别名、外貌与着装）。只识别宿主自己写下的块头，不重新读取正式文件，因此来源漂移不影响检查。
- 场景试演的角色资料是 sidecar 里该参与者的试演设定与 `initialKnowledgeEvidence` 事实，加名册档案。
- 出场判断：名册与会话角色按姓名、别名是否出现在叙述里；叙述中宿主能识别出说话人、但会话没有任何资料的角色记为 `noReference`。

**视角。** `lens: 'player'` 时，试演步骤的 `directorOnly` / `playerUnknown` 段落和 `playerUnknown` 事实不进入材料，结果因而也不可能引用它们。沉浸推演的已提交叙述与冻结角色来源本身都是参与者可见内容，两种视角的材料相同。列表接口只返回所请求视角的报告，Desktop 的参与者视角不加载导演视角的报告。

**体积上限。** 叙述加角色资料上限 48,000 字。叙述必须完整放入，放不下时不发起检查（422 `narrativeTooLarge`）。资料按整块取舍，按角色轮流放入；放不下的块整块省略，并在报告的 `omissions` 里逐条写明省略了谁的哪份资料、多少字。不按字符截断。资料全部被省略的角色记为 `omitted`，与 `noReference` 区分。

**回复与核对。** 模型只输出一个 `oan-play-character-check` 代码块：`{"findings":[{ character, quote, category, evidence, note }]}`，`category` 是 `voice`（声线）/ `motivation`（动机）/ `knowledge`（认知）/ `relationship`（关系）。宿主逐条核对：`quote` 必须是某一条被检查消息（或段落）的逐字子串；`evidence` 必须是该角色某一块资料的逐字子串；角色必须是本次带资料的角色。核对不过、结构不合法、重复或超过 12 条的意见丢弃，计入 `discardedCount`。整个回复不是合法 JSON 或缺少 `findings` 时返回 422 `invalidResponse`，不重试。

**没有可对照的角色时** 不调用模型，直接返回只含角色状态的报告。`noReference` 在界面上显示为“无可对照资料”，不显示为“没有问题”。

**存储。** 报告写在 `.oan/sessions/.play-checks/<session-id>/character-checks.json`（`.oan/sessions/` 已被 `.gitignore` 忽略），整文件经临时文件替换。它不进入 session 快照、turn artifact、rehearsal evidence、采纳证据闭包、导出或 Git，不推进 revision；删除该文件只丢失过往意见。同一目标同一视角的新报告替换旧报告，每个会话最多保留 60 份。取消、provider 失败、格式错误或检查期间分支变化都不留下报告。

**过期。** 回合报告记录检查时从根到该回合的选中路径 `branchTurnIds`；当前选中路径不再以它为前缀（Restore / Retry 离开该回合）即为过期。试演步骤的报告在 attempt 结束、被取消、不再是当前 attempt，或该步骤被替换后过期。过期只是读取时计算出的 `stale` 标记，报告本身不改。过期报告的“带着这条意见重演”入口禁用。

**出口。** 每条意见两个出口，都只是预填，不自动执行：

- 带着这条意见重演：回合报告把可改写的文字放进 [带指引的重演](#带指引的重演guided-retry) 的指引框（上限 500 字），确认后走普通的带指引 Retry；试演步骤把文字放进“修改 → 改变走向”的导演意图。
- 记为观察笔记：预填现有观察笔记表单，来源消息是包含该原句的消息，保存走普通 observation 写入。场景试演会话没有观察笔记，不提供这个出口。

**用量。** 检查作为 `stage: characterCheck` 的 Play 用量记录出现在用量检查器里。

## Core Module Seams

Play Core 的实现保持以下单向依赖，`play-session.ts` 仅作为兼容 facade、settlement orchestration 与 filesystem persistence 入口：

- `play-types.ts`：无 Play 运行时依赖的公共领域类型叶。
- `play-event-schedule.ts`：trigger / template / schedule codec 与纯 due-event evaluator。
- `play-turn-artifact.ts`：turn artifact codec、legacy artifact conversion 与 selected transcript projection。
- `play-event-schedule-history.ts`：schedule history、due evidence、transition、ancestor ownership 与 snapshot clone。
- `play-session-facts.ts`：selected path、branch snapshot、ledger provenance、事实 projection 与严格 stored-fact codec。
- `play-turn-graph.ts`：隐式 checkpoint 摘要、selected path 恢复与 sibling variant 语义。
- `play-turn-retry.ts`：before-turn 投影、typed source action、可选重演指引、原子 sibling settlement 与稳定 retry error code。
- `play-extra-suggestions.ts`：补充行动建议的只读指令与回复解析。
- `play-turn-choices.ts`：候选行动的回合规则与类型前缀解析，无 Play 运行时依赖。
- `play-canon-beats.ts`：原作节点表的类型、codec、状态迁移纯函数、历史校验、视角投影与候选节点提取。
- `play-relationship-timeline.ts`：关系与态度面板的只读投影，无存储。
- `play-launch-reuse.ts`：从已有会话读取开局并按当前文件重新核对来源，只读。
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

该协议提供单 backend 内的 stop / commit 一致性；协作式跨进程锁、staged snapshot fsync、durable run receipt 与重启 artifact 对账、graceful shutdown、deadline 和 SSE 队列上界也已由 [1120](tasks/1120.md) 接通并有进程故障回归。剩余是安全离线 tombstone 清理、设备断电/更多跨平台故障矩阵及真实 provider 资源边界验收，不能把进程中断测试当作断电证明。provisional narrative 仍依赖 referee 遵守 hidden-information 叙事约束；响应隔离能阻止缺失 / 变体 fence 下的结构化结算外泄，但不能证明模型没有在 narrative 自然语言中写出隐藏事实。

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
