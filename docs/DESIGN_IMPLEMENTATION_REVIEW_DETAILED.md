# 设计与实现评估：详细说明

> 评估日期：2026-10-01
> 源码基线：`c0a9386f4dcb9d065cd7d8a3556727f0263116d2`
> 简短结论见 [简短说明](DESIGN_IMPLEMENTATION_REVIEW_SUMMARY.md)。
> 本文是评估与后续开发建议，未修改产品合同、原 task 状态或业务实现。
> 后续实施追踪：[1230 修正任务](tasks/1230.md)。本文保留评估基线，完成状态以该任务及关联 task 的验证记录为准。

> 2026-10-01 续作：标准Agent完整 [usage治理](tasks/1110.md)、[单章结构化结算](tasks/1030.md)、[正文搜索](tasks/0570.md)、[Markdown/TXT导出](tasks/1270.md) 与 [Play底层窗口读取/减少重写](tasks/1260.md) 已落地。广义多领域结算、完整snapshot写入线性成本、旧稿导入/上层摘要等剩余项仍见1230；Extension继续暂缓。以下保留原评审事实，不作为续作后的缺陷清单。

## 1. 结论与评估方法

**应保留核心架构，修正完成状态和几个实际调用链缺口，并暂停进一步扩大功能面。** 固定内存投影、结构化候选、人工审批、事务落盘、Git side effect 与 deterministic producers 已有代码和测试。旧写入方案已明确被替代，不能因为发现缺口而恢复双引擎或兼容写入链路。

本次先读稳定文档和 task 索引，再按 task 的 Related Plans 检查 Runtime/Agent、Tools、Backend/Client、工作台、Play/Reference 与根目录测试。重点是当前五项显式 backlog（`0570`、`0580`、`0700`、`1110`、`1120`），以及相关 Completed task 是否真的闭环。文中代码位置对应上述基线。

判断区分三种证据：

- **实现事实**：由源码调用链、测试或最小运行确认。
- **文档漂移**：文档与当前实现相矛盾，或将合同/helper 完成写成产品完成。
- **设计建议**：关于价值、范围和优先级的判断，需要后续真实创作旅程验证，不作为已证实的缺陷。

P1 表示主流程、正确性或可靠交付前应处理；P2 表示创作效率与体验；P3 表示有条件推进。这里不使用“已有数据损坏”的结论：本次确认了功能阻断，未证明断电等场景已经造成数据丢失。定向测试和静态检查也不代表全仓、真实 provider 或全平台发布验收通过。

## 2. 值得保留的设计

| 决策 | 当前证据与价值 | 后续边界 |
| --- | --- | --- |
| Markdown/YAML/Object File Tree + Git | 核心对象、引用与历史可被作者及外部工具理解。 | 派生索引、Play-local ledger、会话审计各自说明事实边界，不取代 canonical 文件。 |
| 固定内存沙箱 | `workspace-projection.ts`、`policy-fs.ts`、`sandbox-edit-session.ts` 已有投影、路径与执行限制。 | 大工程可收窄 turn 开始时的可信投影，保持 turn 内固定；不能改成任意 host lazy-read。 |
| CandidateChangeSet 唯一权威 | store、materializer、Reference/Play producers 与公共 DTO 已统一。 | Accept 继续只应用 immutable candidate，不解析 diff，不重放命令。 |
| 文件事务与 Git 分离 | durable accepted terminal 是 commit point，Git 有独立 receipt。 | 应真正结束已完成文件事务，避免 Git 重试继续约束作者后续编辑。 |
| Aider-style Runtime | Runtime 保持模型→工具→结果循环；领域逻辑主要位于外层。 | 上下文治理和 Play 可靠性通过明确的组合边界接入，不引入隐藏 planner 或后台自治写作。 |

对应稳定合同见 [ARCHITECTURE](ARCHITECTURE.md)、[SANDBOX_CHANGE_ENGINE](SANDBOX_CHANGE_ENGINE.md)、[HUMAN_APPROVAL_AND_GIT](HUMAN_APPROVAL_AND_GIT.md)。发现问题的方向是补通这些合同，而不是重新选择整体架构。

## 3. 优先修正的实现与设计缺口

### A01. 新建项目与 Git 前置条件脱节（P1，已运行确认）

**事实。** `initWorkspace` 创建目录、workflow 和 config，但不初始化 Git。Backend 创建成功后直接进入该 workspace。普通 Agent 使用默认 sandbox factory；sandbox 创建时，无论是否只读，都先要求 repository baseline，包括已有 HEAD。

最小重现：在仓库外的临时空目录调用 `initWorkspace`，再创建 `read-only` sandbox session，得到 `not_git_repository: Workspace is not a Git repository.`。仅执行 `git init` 也没有首个 HEAD，仍不满足 baseline。测试或 smoke 中注入 repository reader 不能证明生产首次使用成功。

**影响。** 用户通过“新建项目”获得看似有效的 workspace，却可能在普通 Copilot 请求调用模型前失败。这是首次旅程缺口，优先于 Git 美化或新增写作模式。

**建议。** 在可信 workspace 创建流程明确完成仓库初始化、首个基线和可见 Git 状态；不要修改用户全局 Git identity，也不要隐式提交已有导入工程的修改。Git 不可用、无首个提交或 identity 缺失时，给出具体可恢复状态。可以评估让真正只读的会话不依赖 HEAD；写候选仍需满足同一种 ChangeSet 的 repository 合同，不引入第二套写入引擎。

**验收。** 真实默认 factory 完成“空目录→创建→首次只读 Copilot→首次候选→Accept”；另覆盖 Git 不可用、unborn HEAD、导入已有 dirty 仓库。运行时不得靠测试专用 repository reader 通过。

证据：[core/workspace.ts](../packages/core/src/workspace.ts) L354–415；[backend/index.ts](../packages/backend/src/index.ts) L1166–1223；[sandbox-edit-session.ts](../packages/tools/src/sandbox-edit-session.ts) L186–199；[agent/index.ts](../packages/agent/src/index.ts) L387–404；[git-integration.ts](../packages/tools/src/git-integration.ts) L166–176。需求 [REQUIREMENTS.md](REQUIREMENTS.md) F1 与 [0580](tasks/0580.md) L69 也需与生产前置条件对齐。

### A02. Git 未提交的 accepted action 阻断后续审批（P1，已运行确认）

**事实。** Accept 在请求自动提交但 Git 未成功时保留 journal。后续每次 Accept/Reject 都先运行全局 `recover()`；恢复旧 accepted journal 时再次要求目标保持当时 approved bytes，否则抛 `ACCEPTED_TARGET_DRIFT`。

已确认的重现链：

1. 目标在 proposal 前已有作者的未提交修改。
2. Accept 成功，Git receipt 因 `dirty_before_proposal` 降级，journal 保留。
3. 作者通过外部编辑器继续修改已接受目标。
4. 对另一个无关 pending action 执行 Accept 或 Reject，均被旧 action 的恢复错误阻断，新 action 仍为 pending。

**影响。** 系统虽没有回滚作者文件，却让一个已结束的文件事务变成后续全部审批的前置障碍。它与“外部编辑器互操作”“Git 失败只保留 dirty state/quick commit”的产品语义不一致。

**建议。** 区分文件事务恢复和 Git side effect 对账。完成 accepted 文件事务的清理与 durable receipt 后，不应为了无限期 Git 重试保留要求 canonical bytes 永久不变的全局事务。后续 target drift 应拒绝该 action 的自动/精确 quick commit，记录需人工处理的 Git 状态；真正未完成或损坏的文件事务仍 fail closed，不能简单吞掉所有 recovery 错误。

**验收。** 上述链、commit 失败、缺 identity、receipt 写入中断、作者改回/删除目标、外部手动 commit 后，其他无关审批继续工作；不会重复提交、混入作者新修改或回滚 durable accepted 文件。

证据：[change-materializer.ts](../packages/tools/src/change-materializer.ts) L178、L258–259、L272、L615–710、L780–841；[HUMAN_APPROVAL_AND_GIT.md](HUMAN_APPROVAL_AND_GIT.md) L108–116、L174–185。

### A03. Git 路径仍使用展示文本解析（P2，已运行确认）

**事实。** status 使用非 NUL 的 porcelain 文本，再按行解析；带中文等路径会返回 Git 的引号/八进制转义形式。最小运行返回的 path 不是实际文件路径。Git 页面把这些值直接交给 diff 和 quick commit。另一个 name-status parser 也按空白拆分路径。

**影响。** 中文文件名是本产品的正常输入；空格、tab、换行、rename 等同样不能依赖可读文本还原。页面显示出来并不代表可操作路径正确。

**建议。** 对路径输出统一使用 NUL 分隔的机器格式，并按 status/rename 协议解码；展示 raw 文本与操作路径分开。已有部分 baseline/commit identity 读取使用 `-z`，可沿同一原则修正，无需换 Git GUI 或引入新 Git 框架。

普通 `gitDiff` 目前只调用 unstaged `git diff`，不能完整预览 staged 或 untracked 的待提交内容，失败还返回空字符串。需要将“无变化”“预览失败”分开，并展示实际用户 commit 将包含的内容；不能让“Commit dirty files”与作者看见的 diff 范围不同。

**验收。** 合同支持的中文、空格、引号、前导连字符和 rename 路径完成 status→diff→明确用户 commit，路径逐字节一致，不提交额外文件；对合同不支持的 tab/换行等控制字符路径正确展示并明确、安全拒绝，不能误解析成其他路径。staged/untracked 内容也在提交前可见，错误不伪装成空 diff。

证据：[git-integration.ts](../packages/tools/src/git-integration.ts) L129–150、L203–215、L674–724；[GitReviewTab.vue](../apps/desktop-ui/src/components/workspace/GitReviewTab.vue) L30–88。

### A04. “完整 final validator”尚未等于最终对象树一致性（P1）

**事实。** 各文件族已有 final-content validator，远不止 YAML parse；但 `validateKnownReferences` 在缺少 `knownObjectIds` 时直接返回。生产 policy 接受这个可选字段，普通 Agent 的默认创建路径未建立对象 ID 集合。单文件通过不保证多文件 ChangeSet 的最终树引用正确，也不保证删除不会留下悬空引用。

另外，稳定 [FILESYSTEM_SPEC](FILESYSTEM_SPEC.md) 的 timeline 示例没有 validator 要求的 date/time/order，foreshadow 示例没有显式 status；照示例构造文件会被当前校验拒绝。

**建议。** 分清语法/单文件领域校验、跨文件引用校验和语义质量。对需要引用约束的 family，host 基于固定投影与本次 create/update/delete 的**最终树**建立类型化 ID/path 集合，并在 proposal 与 Accept 保持同一合同。先确定允许哪些引用字段、对象 ID 的 namespace 和删除规则，不把一个混合字符串集合称为完整引用校验。保留已经实现的 validator，修正不实覆盖声明和样例。

**验收。** 同 action 新建被引用对象成功；未知对象、删除仍被引用对象、跨 namespace 错配失败；文档样例经真实 validator 全部通过；缺必需验证上下文的能力关闭写入或明确拒绝。

证据：[workspace-change-policy.ts](../packages/tools/src/workspace-change-policy.ts) L41–52、L159–163；[final-document-validator.ts](../packages/tools/src/final-document-validator.ts) L435–554、L860–894；[agent/index.ts](../packages/agent/src/index.ts) L470–475；[change-materializer.ts](../packages/tools/src/change-materializer.ts) L1116–1120 的 Accept 默认 policy 同样未提供 inventory；[FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md) L388–423。这里没有否定已有单文件结构校验的价值。

### A05. 上下文选择与预算比 usage 面板更紧迫（P1）

**事实。** `createNovelAgentWorkspaceSnapshotFromProjection` 对 constitution、summary、state、timeline、foreshadow 分别过滤后取前 12 个文件。投影按路径排序；这个选择并不基于当前章节、章节时间或任务相关性。因此长篇的“最近摘要”可能实际是前几章摘要。来源标签不能证明选择正确。

`ContextPackage` 已有 selected/omitted/trace，但 source ref 没有逐文件 hash、实际 payload hash 或 token 占用。`protected` 等标签也不等于已执行预算约束。[1110](tasks/1110.md) 已诚实记录这些差距，方向值得继续。

**建议。** 将 1110 顺序收窄为：目标章节与必需 source 选择→来源/payload 证据→已知预算下的 protected overflow 与明确省略→tool result/历史消息同样计入实际消息预算→provider actual usage→轻量 inspector。预算未知就标 unknown，不伪造 token 精确值或计费信息。对工具读入与后续 step 也记录来源，不能只审计初始 prompt。

标准 adapter 的 `streamText` 调用尚未传入配置的 `maxOutputTokens`，也未采集 usage。预算预留应与真正执行的输出上限一致；中文/混合文本的估算需要校准余量，不能把粗估数直接宣传成精确容量保证。

固定 VFS 与模型输入是两层预算。当前投影默认单文件 2 MiB、总计 32 MiB、内存 64 MiB；**投影全量不等于全部送给模型**，但文件数上限也不能代替 prompt budget。优先按可信任务收窄 turn 开始时的读取范围，保持同一 turn 快照不变。

**验收。** 超过 12 个摘要时仍选目标附近章节、卷/全局摘要和明确依赖；完整 constitution 不静默遗漏；给定上下文窗口时 provider 前可解释 overflow；tool-loop 消息超预算有可见处理；selected、实际发送、estimated、actual 四者不混用。

证据：[agent/index.ts](../packages/agent/src/index.ts) L337–367、L548–603、L1371–1405；[workspace-projection.ts](../packages/tools/src/workspace-projection.ts) L29–31、L322；[agent-context-package.ts](../packages/core/src/agent-context-package.ts) L29–36、L81–89；[1110](tasks/1110.md) L34–43、L88–99。

### A06. 恢复会话和结构化结算存在接线缺口（P2）

**事实。** `1070` Done Criteria 要求 resume 时提醒文件变化；`checkSessionResumeBoundary` 已有 helper 和 Core 测试，但生产 `prepareAgentSession` 只 ensure/create session 并记录 events，未调用该检查。重新创建固定投影能避免直接用旧 baseline 写盘，但不能替代向作者说明历史对话已经过时。

`1030` 已实现 ReviewFinding、ObservationLog、SettlementBundle 类型、formatter 和 prompt 保护规则；在 Agent/Backend/UI 没有找到这些结构的生产消费链。当前存在通用 prompt + sandbox 编辑能力，不能据此声称“结算完全不存在”；同样不能把类型和 formatter 测试当作 schema 驱动的端到端验收。

**建议。** 给 1070 拆出 resume 接线任务；给 1030 增加最小“正文 evidence→结构化 observation→候选摘要/状态→作者审批”旅程。先实现一个章节，不做巨大的工作流引擎。涉及新写入仍复用唯一 ChangeSet/materializer，不新增领域直接写盘工具。

**验收。** 恢复会话时文件改动/删除可见；过时历史不会被当成当前事实。结算报告能引用正文来源，歧义只报告，不从大纲补事实；结构错误、source hash 或证据位置不匹配的 observation/candidate 被拒绝；Accept 前 canonical 不变。程序验证结构和来源对应关系，文学事实解释仍由作者审阅。现有固定投影/baseline 保护依然成立，不把恢复提示缺失说成已绕过写入审批。

证据：[1070](tasks/1070.md) L51–58；[session-artifacts.ts](../packages/core/src/session-artifacts.ts) L290–318；[agent/index.ts](../packages/agent/src/index.ts) L1089–1117；[1030](tasks/1030.md) L12–33、L43–47；[writing-settlement.ts](../packages/core/src/writing-settlement.ts)、[writing-review.ts](../packages/core/src/writing-review.ts)。

### A07. Play 下一步应是可靠性收尾（P1，发布前验证）

**事实。** `1120` Remaining Review Scope 中的 durability、可重启 terminal registry、shutdown、deadline/backpressure 是真实剩余范围。当前已有 staged directory swap、跨进程协作锁、CAS、cancel/commit barrier；不能描述成“没有事务”。但写 stage 和 ready 标记的路径不等于已完成文件/目录 fsync 的断电合同；turn registry 仍在进程内且终态保留 60 秒。

**建议。** 按故障边界完成 terminal 对账、耐久性、取消/超时与流控。只持久化必要运行终态和对应 committed revision，不把 SSE 日志再做成第二个世界事实源。重启后先依据 durable session 判断 committed，再解释未提交/未知；不要仅凭连接断开断言取消成功。

通用 state refs 按实际领域增量补齐；绝对世界时间 comparator 只有具体玩法需要时再推进，先明确一种可验证的格式/排序语义。可靠性主线不等待通用世界历法，也不让模型猜测排序。保持目前单 referee 和领域模块，不增加后台多 Agent。

**验收。** 在 stage、ready、backup rename、session swap、terminal 发布各边界中断/重启，能确定 committed 或未提交；shutdown 等待 commit barrier；不配合 abort 的 provider、慢 reader、断开 SSE、deadline 到期能释放锁和资源；不会产生 transcript-only/state-only 半回合。

证据：[1120](tasks/1120.md) L45–54；[play-session.ts](../packages/core/src/play-session.ts) L687–734；[backend/index.ts](../packages/backend/src/index.ts) L998–1007、L3954–4126、L4408。现有测试证明若干逻辑/进程中断场景，不证明完整断电矩阵。

### A08. 长会话窗口化还没有解决底层读写成本（P1/P2）

**事实。** M5/1180 的 API 和 renderer 窗口化已经实现。但 `listPlaySessionSummaries` 先 `listPlaySessions`，后者并行完整读取所有 session；selected detail handler 先完整 `readPlaySessionFiles`，再截取窗口。返回较小 DTO 不代表读取成本有界。

写入侧也将所有 turn artifact 序列化，复制已有 reports/memories/traces，再写整个 staged snapshot。它保留了易理解的原子提交语义，但历史增长会带来写放大；这是应测量的成本，不能只靠响应分页解决。

**建议。** 优先测实际读取 bytes、文件数、锁持有时间和延迟，再建立可重建的轻量 summary/head 索引及按 selected branch 读取窗口的路径。事务校验、Retry/Restore 按需要读取完整图；不要让普通列表每次支付全历史成本。可缓存已验证 immutable artifact，但必须有 revision/hash 和失效/损坏检查，不跳过必要校验，也不把缓存升级为数据库事实源。

**验收。** 多 session、长 transcript、多个 sibling branch 的列表/选中详情读取成本可解释；增加无关历史不会让每次窗口读取都线性重读全库；新回合写入 bytes/延迟有实测门槛；索引删除可重建，stale cursor 和 hidden projection 仍 fail closed。任何增量写优化仍须证明原子提交/CAS/恢复成立，不能把散文件 append 当事务。先用数据建立规模门槛，本文不虚构性能结果。

证据：[play-session.ts](../packages/core/src/play-session.ts) L653–691、L1029–1062；[backend/index.ts](../packages/backend/src/index.ts) L2707–2725；[1180](tasks/1180.md) L13–23、L35–40。`1120` L49 的“仅显式 Retry 才读完整 ledger”描述也应收窄。

### A09. Health 能提醒缺失，但不能证明摘要/状态仍新鲜（P2）

**事实。** 目前 summary 检查以对应路径存在为准；state stale 比较全部章节和 state 文件的最大 mtime。已有 summary 的章节改写不会因此被标成 stale，更新不相关 state 文件也可能清掉整体提醒。现有 “may be stale” 文案是启发式提醒，不是内容已结算的证明。

Agent 另外实现了投影版本 evaluator，pendingActionCount 固定为 0；Backend 则调用 Core evaluator 并传真实 pending count。两者运行时刻/投影范围可能不同，不能要求任何时候数值一致；对同一冻结输入的规则却应共用，避免持续分叉。

**建议与验收。** 区分“缺失”“来源版本落后”“尚未验证”；以已接受 summary/settlement 的 source hash/覆盖范围建立 freshness。章节变更但摘要仍存在时可见 stale；纯 touch 不声称剧情变化；无关 state 更新不证明目标章节已整理。抽取接收冻结数据的纯 evaluator，host 传允许的 bounded metadata，不能为了 health 让模型读取内部 artifact。保持 soft warning，不将文学一致性启发式升格为硬写入 gate。

证据：[project-health.ts](../packages/core/src/project-health.ts) L51–56、L222–235；[agent/index.ts](../packages/agent/src/index.ts) L625–709；[backend/index.ts](../packages/backend/src/index.ts) L7076–7083；相关任务 [1050](tasks/1050.md)、[1100](tasks/1100.md)。

## 4. 值得继续但应收窄的功能

### B01. `0570` 全局搜索：继续，修订需求（P2）

当前 toolbar/dialog 已存在；`WorkspaceShell` 只从文件树过滤 name/path。`useWorkspaceSearch` 中的 MiniSearch 索引是 launcher 的 workspace 名称/路径搜索，不是小说正文全文索引。不能把“用了 MiniSearch”当作 0570 已完成。

旧 task 还写“中间查看文件、右侧 Copilot”；实际 Writing 是中央 Copilot、右侧 FileViewer。搜索范围漏了 canonical `outline/`，而隐藏路径规则对允许的 constitution/workflow 例外需明确。

建议先交付 Backend 只读扫描→正文/标题/路径检索→snippet/命中定位→打开右侧文件。MiniSearch 可保留为现有技术选择；真正的验收是中文短语、角色名、连续汉字、拼音/英文混排和刷新效果，不是绑定某个库名称。若分词需要调整，先用本地样本证明问题，不提前造搜索平台。

验收覆盖 accept 后刷新、外部编辑/删除/rename、workspace 切换、outline 和允许的隐藏控制文件、symlink/越界排除。第一版可手动刷新，明确索引是否过期；搜索不会自动加入 Agent context。

证据：[0570](tasks/0570.md) L14–35、L71–89；[WorkspaceShell.vue](../apps/desktop-ui/src/components/workspace/WorkspaceShell.vue) L79–89、L225–234；[useWorkspaceSearch.ts](../apps/desktop-ui/src/composables/useWorkspaceSearch.ts) L1–23；[WorkspaceRightPanel.vue](../apps/desktop-ui/src/components/workspace/WorkspaceRightPanel.vue) L60–65。

### B02. `0580` Git：复核已有能力，补正确性（P1/P2）

Backend/Client 有 status、log、show、diff、commit、sync；`GitReviewTab` 已展示状态、历史、diff、quick commit、手动 Sync，并真实挂载在右栏。该 task 的 Planned 状态不准确；也没有必要为了“开源优先”重新替换现有小页面。

剩余价值是 A01–A03、错误/缺 identity/remote 状态、明确 commit 的文件范围、同步预检与反馈，以及发行时的 Git binary 可用性。Phase B bundled Git 是否必须，应依据目标作者电脑上的可用性决定；当前调用依赖全局 Git 是已知边界。

同步保持作者明确触发。task 的自动同步设想，以及稳定 Git 文档“成功后允许可配置 sync”，应与 explicit user sync 合同统一；不要在完成 auto commit 时悄悄增加网络操作。non-Git workspace 能否 Accept 也必须与 repository baseline 统一决策，不能继续同时承诺相反行为。

证据：[backend/index.ts](../packages/backend/src/index.ts) L698–706；[client/index.ts](../packages/client/src/index.ts) L2505–2522；[GitReviewTab.vue](../apps/desktop-ui/src/components/workspace/GitReviewTab.vue)；[WorkspaceRightPanel.vue](../apps/desktop-ui/src/components/workspace/WorkspaceRightPanel.vue) L88；[0580](tasks/0580.md) L69、L222–240、L297–309；[HUMAN_APPROVAL_AND_GIT.md](HUMAN_APPROVAL_AND_GIT.md) L143、L164。

### B03. `0700`：摘要、旧稿导入、导出分开推进（P2）

task 已承认它是 umbrella，且正确列出卷/全局摘要、旧稿导入、可读导出和 Extension 未实现。不要再用一个大任务把成熟度不同的模块统一标完成。

- **卷/全局摘要值得继续。** 先修 A05 的选择策略，再做从已接受 canonical 章节/下层摘要生成上层候选。定义 input hash、覆盖章节范围和失效标记；摘要是作者可审阅文本，不能因“派生”就允许 AI 绕过审批改写 canonical summary。禁止用未接受 draft 或计划冒充已发生事实。
- **最小正文导出值得优先做。** 按稳定章节顺序生成可读 Markdown/TXT 到作者选择的目标，明确覆盖行为；只读 canonical，不把 State YAML、Reference 资料与 session artifact 拼入正文，也不改变小说源文件。它直接验证“文件优先”的可用性。
- **作者自有旧稿导入值得做最小版。** 先本地 Markdown/TXT、稳定编号和清晰拆章预览，再创建同一 ChangeSet；已有未提交稿件和重名路径不能隐式覆盖。外部 Reference 分析与导入为小说事实是两个不同 workflow。
- **Extension 暂缓。** 先保留现有 skill override、prompt pack 和 workflow 配置。没有具体扩展用例前不做动态 Tool 注册；不得执行 extension host code 或扩大 host capability。后续若只需要模板，优先数据/模板 manifest。

验收以真实作者工程完成“导入→编辑/结算→审阅→Accept→导出”为准，测试放在根目录相应 workspace。导出新文件也须是明确用户操作；AI 发起的 canonical 修改继续全部经过审批。

依据：[0700](tasks/0700.md) L24–65、L86–97；[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) L130–152。

### B04. Tavern、Director 与 Reference：纠正状态，暂停扩面（P3）

Tavern 的 JSON/PNG 解析、normalization、安全审计和预览 helper 已实现；预览只是目标文件名、field mapping 与 `requiresPendingAction` 标记，没有候选文件内容或完整导入旅程。能力表仍是 planned。`1060` 及其 plan 不应把这些当成 create/merge/activation 全链路完成。

如果近期确实需要角色卡入口，先完成“选择本地卡→预览来源/不可信 prompt→显式 Play-only 激活→一回合”最小旅程。canonical create/merge 需通过最终 validator、exact target producer 和统一审批，放在真实需求之后；不扩大 prompt 权限或抓取第三方卡站。

首次产品接入还需 JSON/PNG metadata/lorebook 的硬输入大小和条目限额。现 helper 的正则风险提示与 “too large” warning 不等于执行限额，也不能单独证明 imported prompt 的权限隔离。

F1–F4/M1–M5 与 Reference D0–D5、素材分析/adoption 已有大量实现，不能继续沿旧升级计划重做。保留现有能力，先用少量真实创作样本检验来源证据、adoption 的可审阅性、改稿时间和最终正文帮助；合同测试能证明数据流程，不能自动证明文学质量、商业效果或粉丝作品体验。更多导演控制、长程自动策划和素材分析层暂缓到已有闭环验证之后。

证据：[1060](tasks/1060.md) L12、L26–29、L49–50；[tavern-card.ts](../packages/core/src/tavern-card.ts) L165–202；[novel-copilot-skill.ts](../packages/core/src/novel-copilot-skill.ts) L314–318；任务 [1130](tasks/1130.md)–[1190](tasks/1190.md)、[1210](tasks/1210.md)、[1220](tasks/1220.md)。

## 5. 应修正的文档与边界

### 5.1 当前合同、历史记录和完成状态

| 位置 | 实际问题 | 建议 |
| --- | --- | --- |
| `tasks/0580.md` | 仍标 Planned；描述展示内部候选路径、non-Git Accept 和自动同步；基础 UI/API 已存在。 | 写明已交付基础能力，残余正确性/发行工作单独追踪；只通过 public DTO 审阅。 |
| `tasks/1030.md`、`1070.md`、`1060.md` | 部分 Done Criteria 只有类型/helper/prompt 或尚未接线。 | 区分合同交付、生产调用链和真实旅程；残余项标 Needs Review 或拆 follow-up，不重写历史事实。 |
| `WORKSPACE_FRONTEND_LAYOUT_PLAN.md` L39–59 | “当前没有 hover rail/多 tab/结构化 timeline”等描述已过时。 | 将旧 current state 标为带日期的设计背景，列出实际剩余 old/new view、响应式/键盘 polish，不重做 shell。 |
| `PLAY_MODE_SPEC.md` L30、L94 | 已交付顶级 Play、命名 checkpoint、初始世界、knowledge 等仍写为待实现。 | 按 task1120 与 M2/M3/F4 的实际范围更新；world settlement 与 rehearsal 分别说明版本。 |
| `OAN_AGENT_WRITING_GUIDE_RUNTIME_GAP_SPEC.md` L63–87 | 仍将 trace/autowiring、reference selector、projection refresh、Play UI/adoption 称为未实现；这些已被后续任务部分覆盖。 | 标为 2026-06-19 历史审计，链接当前 task；保留尚未接线的具体项，不整体重新实施。 |
| `REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md` L99、L693 | 正文仍用旧 import stub 与质量硬阻断描述；顶部已有 1205 覆盖声明。 | 读者应能在对应段落看到“当时基线”和当前实现链接，不能把旧缺陷重新列为当前 backlog。 |
| `FILESYSTEM_SPEC.md` L388–423 | timeline/foreshadow 示例被现 validator 拒绝。 | 明确统一 schema，以可执行样例/测试固定合同。 |
| `ARCHITECTURE.md` L50 | core 被描述为“纯合同与 validator”，实际有 workspace/Play/Reference 文件存储。 | 明确纯 domain 和文件存储子模块边界；按后续改动逐步拆，不为符合一句话大规模搬包或引入 Repository Layer。 |
| `scripts/check-legacy-write-architecture-terms.mjs` | 术语 gate 很有用，但还强制 task0800 永远 Completed。 | 继续检查架构不变量和历史标记；让 task 状态可以依新证据复核，或明确把修正另立任务。文本 gate 不替代源码/行为校验。 |

注意版本并非简单“全部升级”：当前 world session 为 v4、world turn artifact 为 v2；rehearsal 分别有 v5/v3。不同语义不能混为一个“最新版本”。Play session 兼容历史数据与 Change Engine 禁止旧审批协议 reader 也属于不同合同；不能据稳定写入禁令直接删除 Play 兼容读取。

历史 ADR、带日期的 superseded plan 和参考研究无需机械清除。它们已有明确约束；优先修正仍声称“当前”的段落。新评估不是新的架构权威。

### 5.2 “冻结上下文”与精确重演应分开

`continueFrozen` 保留 Play-local 状态和 activated source metadata，并排除发生 drift 的 canonical source；它没有保存旧 source 原文供继续读取。现有 UI 确认与测试已经说明省略行为，而 `1180` 的“继续当前冻结上下文”容易被理解为精确保留原文。

建议改成“沿用 Play-local 状态并省略漂移来源”，列出 omitted source 与可能影响。如果未来确有精确 replay 需求，再独立设计有大小/保留期限制的 immutable source snapshot；不要因为词语模糊就新增第二套 canonical truth。证据：[play-source-drift.ts](../packages/core/src/play-source-drift.ts) L118–135；[1180](tasks/1180.md) L13、L21、L39。

同样，当前 `atWorldTime` 在未提供 comparator 时不会触发，而 session 调用未传 comparator。不支持的绝对时间 trigger 应明确不可用；若要继续，先选定一种可验证的世界时间合同，别让自然语言“明晨”或任意历法变成永远 pending 的 schedule。证据：[play-event-schedule.ts](../packages/core/src/play-event-schedule.ts) L352；[play-session.ts](../packages/core/src/play-session.ts) L1065–1082。

### 5.3 多 PendingAction 与严格 baseline 的代价

repository HEAD、投影 fingerprint 与目标 baseline 的严格检查是有价值的安全选择。它也意味着：一个 action Accept 后自动 commit，可能让同时生成的其他 action stale；外部编辑可能使既有候选失效。这是设计取舍，本文没有把它判成 bug。

建议 UI 明确当前候选的 baseline/stale 状态，先按 turn 串行完成审批或将同一意图合成一个可审阅 action。需要重做候选时必须重新校验并再次让作者审阅，不能静默改 baseline、自动 merge 或放宽 HEAD guard。否则“多个 pending”会给作者制造可连续接受的错误预期。

## 6. 推荐实施顺序与停止扩展条件

| 顺序 | 交付范围 | 完成证明 |
| --- | --- | --- |
| 1 | A01 新建/导入 Git 前置条件，A02 文件恢复与 Git 处理分离，A03 正确路径 | 不注入生产假基线的首次使用旅程；失败后继续外部编辑与无关审批；中文路径闭环。 |
| 2 | A04 最终树验证与样例，A05 上下文选择/预算，A06 resume 与最小结算 | 文档示例通过实际 validator；长篇选择正确；provider 前 overflow；恢复会话与证据→审批旅程。 |
| 3 | A07 Play durability/terminal/deadline，A08 实际存储预算 | 故障边界矩阵、重启对账、锁/资源回收；实际 I/O 随窗口和选中范围受控。 |
| 4 | 0570 正文搜索、最小可读导出；再按真实需求补卷/全局摘要与旧稿导入 | 一个作者工程能定位正文、完成改稿、接受修改并得到可读稿件。 |
| 5 | 最小 Tavern 或模板扩展，以及已有 Reference/Director 质量复核 | 已有创作旅程证明需要；新增功能收益超过交互与维护成本。 |

建议将一至三作为下一次可靠交付的范围，第四项按作者使用反馈排序。若这些证明尚未完成，不再追加 Director、动态 Extension、后台生成或新的分析层。不要用总测试数或文档页数代替旅程完成标准。

## 7. 验证记录与限制

本次新增的成果是评估文档和入口链接；业务代码和原 task 状态未改。已有测试只用来说明当前覆盖范围；最小重现仅操作仓库外临时小说工程，不改作者真实 workspace。

本次实际验证如下，同一组重复运行不重复计数：

| 范围 | 结果 | 可信边界 |
| --- | --- | --- |
| Tools：materializer / final validator | 2 文件、44 测试通过；Tools 构建成功。 | 覆盖已有事务与单文件规则；新增恢复阻断依靠独立重现确认，不声称现有测试已覆盖。 |
| Agent：message assembly / session store | Agent 重新构建成功；2 文件、18 测试通过。 | 证明已有拼装和持久化合同，不证明 resume 接线或逐文件预算已实现。 |
| Core：Play / Reference / Tavern | lifecycle 自动先构建 Core；9 文件、59 测试通过。 | 证明当前 reader/分页/schema/helper 合同，不证明 I/O 规模、真实模型质量或端到端 Tavern 导入。 |
| Core：Context / artifacts / health / writing | 7 文件、27 测试通过；该组使用当时已有 dist，未单独运行 build。 | 仅作为已有 helper 覆盖记录；结论以源码调用链核对为主。 |
| 临时运行探针 | 确认新建 workspace 失败、accepted/Git failure 后阻断无关 Accept/Reject、Git 转义路径、文档样例拒绝、默认生产参数下未知引用通过。 | 仅使用临时本地工程；未证明真实 UI 全旅程或所有 producer 分支。 |
| 13 文件的内存投影探针 | 第 13 summary/state/constitution 被遗漏；声明仍为 recent/latest/protected。 | 未调用 provider、未写 canonical。 |
| 文档检查 | 旧术语 gate 通过（133 Markdown 文件）；两份报告本地链接全部存在；tracked 与新增文档 diff/空白检查通过。 | 词汇与链接检查不判断实现正确性。 |

定向测试命令（在仓库根目录，最后一项从对应测试 workspace 运行）：

```sh
npm exec --workspace @oh-awesome-novel/test-tools -- vitest run src/change-materializer.test.ts src/final-document-validator.test.ts
npm run test:run --workspace @oh-awesome-novel/test-agent -- src/message-assembly.test.ts src/session-store.test.ts
npm run test:run --workspace @oh-awesome-novel/test-core -- src/play-session-read-model.test.ts src/play-source-drift.test.ts src/play-event-schedule.test.ts src/play-director-controls.test.ts src/play-adoption.test.ts src/reference-work.test.ts src/reference-story-material.test.ts src/reference-material-adoption.test.ts src/tavern-card.test.ts
# CWD: __test__/core
../../node_modules/.bin/vitest run src/agent-context-package.test.ts src/session-artifacts.test.ts src/project-health.test.ts src/projections.test.ts src/writing-planning.test.ts src/writing-review.test.ts src/writing-settlement.test.ts
```

代表性运行输出：

```text
fresh workspace read-only session: not_git_repository
accept dirty baseline: accepted, git.failed(dirty_before_proposal)
unrelated later action accept/reject: ACCEPTED_TARGET_DRIFT
later action: still pending
timeline spec example: rejected (date/order missing)
foreshadow spec example: rejected (status invalid/missing)
production-like policy: nonexistent characterRef accepted
```

未执行全仓回归、真实付费模型调用、远程 Git sync、断电/跨进程故障矩阵、规模 benchmark 或本次跨平台 Electron 打包；这些不能从历史 task 的通过记录继承为本次结论。第三方库的维护状态和新版本也未作为本次判断依据。
