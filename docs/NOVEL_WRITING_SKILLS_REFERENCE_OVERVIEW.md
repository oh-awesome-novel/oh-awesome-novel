# Novel Writing Skills Reference Overview

> 范围：本文合并分析 `reference-only/awesome-novel-skill`、`reference-only/novel-writer-skills`、`reference-only/oh-awesome-novel-skill`、`reference-only/oh-story-claudecode`。  
> 目的：这些项目都更接近“写作 skill / agent 写作指引”，不是完整 Novel IDE。本文重点分析它们如何指导 agent 写小说：写前读什么、生成什么中间产物、写作中如何控上下文、章节推进后记录什么，以及哪些思想适合 OAN 后续吸收。  
> 本次为静态阅读，没有运行这些参考项目的测试、安装脚本或构建流程。

## 基准信息

| 项目 | 本地版本 | 许可证观察 | 与 OAN 的关系 |
|------|----------|------------|---------------|
| `awesome-novel-skill` | `d4891c6`，2026-06-17，`fix: sync-project 版本检测，按小版本同步作家工作空间` | GPL-3.0；仓库声明核心 skill、agent、模板、工具均受 GPL-3.0 约束 | OAN 早期写作指引灵感之一；适合学习流程抽象，不适合复制 prompt、模板或实现 |
| `novel-writer-skills` | `5bc9b37`，2025-10-20，`fix: 修复 npm 发布时 dist 文件缺失问题 (v1.1.1)` | MIT | OAN 早期写作 skill 灵感之一；偏 slash command + spec workflow |
| `oh-awesome-novel-skill` | 单文件 `SKILL.md`，未见独立 git / LICENSE | 未发现明确许可证文件 | 基于前两者用 skill-creator 生成的轻量 skill，更接近 OAN 当前单 agent 写作指引 |
| `oh-story-claudecode` | `ef8ae1e`，2026-06-14，`chore(release): 0.6.16 (#146)` | MIT | 近期发现的写作 skill 集；偏网文工业化、拆文、对标、日更、去 AI 味与审稿 |

## 总体结论

这四个参考项目形成了一条很清楚的谱系：

```text
awesome-novel-skill
  多 agent、强流程、强交接、强 lore-keeping

novel-writer-skills
  slash commands、规格工程、追踪 JSON、严格写前读取协议

oh-awesome-novel-skill
  单 agent、轻文件、读前写后纪律、最贴近 OAN 当前方向

oh-story-claudecode
  网文生产工作台 skill 集：拆文、对标、文风召回、日更、去 AI 味、审稿
```

对 OAN 来说，它们最有价值的不是“多 agent 运行时”或“自动代写流水线”，而是写作指引中的几个稳定模式：

- 写作前必须产生可检查的上下文包，而不是直接生成正文。
- 章纲或本章契约必须说明本章要推进什么、兑现什么、保留什么、章尾改变什么。
- 正文生成应该由当前章节目标和最小必要上下文驱动，而不是把所有设定塞进模型。
- 写后整理必须只记录正文证据支持的事实，不能把计划中的内容提前写入真相文件。
- 长篇续写需要章节摘要、角色状态、时间线、伏笔和当前上下文快照共同维持。
- 去 AI 味、审稿、拆文、对标可以作为 skill 能力存在，但不应变成默认自动后台流水线。

## 与 OAN 当前边界的关系

OAN 当前稳定边界是 filesystem-first Novel IDE / Copilot：

- Markdown / YAML / Object File Tree 是事实源。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 所有真实目标文件写入必须经过 PendingAction / diff / Human Approval。
- Runtime 是 Aider-style tool loop，不引入重型多 agent runtime。

因此，本文后续提到的“可吸收”都应理解为：

- 吸收写作方法、上下文纪律、检查清单和中间产物设计。
- 不直接复制 GPL 项目的 prompt、模板或代码。
- 不把参考项目里的直接写文件行为带入 OAN。
- 不把固定多 agent 编排作为 OAN 默认路径。
- 所有写入仍应落到 OAN 的 Object File Tree，并通过 PendingAction 审批。

## awesome-novel-skill

### 实际定位

`awesome-novel-skill` 是一个 Claude Code 写作 skill 包，把小说创作拆成多 agent 流水线。它的入口 `SKILL.md` 负责检测项目状态、初始化或迁移工作区，然后要求通过 `@novel-agent` 进入后续创作。

它不是轻量 prompt，而是一个完整写作工程：

- `story.md`：主线拆纲。
- `settings/`：世界观、题材、文风、角色、时间线。
- `volumes/`、`chapters/`、`prompts/`、`archives/`：卷纲、章纲、写作提示词和归档正文。
- `.agent/status.md` 与 `.agent/task/*-order.md`：流程状态与 agent 交接文件。
- `.claude/agents`、`.claude/knowledge`、`.claude/memory`：agent 定义、写作知识和长期记忆。

### 实际写作 workflow

它的流程核心是“总指挥 + 专职 agent + order 文件交接”：

1. 入口检测当前目录是否已有 `story.md` 或旧版 `story.yaml`。
2. 无项目时先询问作者，再运行初始化脚本创建结构。
3. 设定阶段由 `novel-agent` 与作者讨论，但实际写入设定要交给 `updater`。
4. 规划阶段依次调度卷纲、章纲、提示词 agent。
5. 写作阶段由 `writer` 只读取当前章节 prompt 和必要 settings，保持纯净上下文。
6. 写完后走 anti-ai、reader review。
7. 归档阶段由 `updater` 对最终正文做 lore-keeping，更新角色状态、时间线、记忆和作者偏好。
8. 每个阶段通过 `.agent/task/*-order.md` 交接，完成后清理 order 文件。

### 历史演化与 v3 单 agent harness

查阅 `awesome-novel-skill` 本地 git 历史后，可以确认它早期并不是当前这种顶层 multi-agent 架构。

关键演化节点：

- `v1.0.0`：单个 `SKILL.md` monolith，没有 `agents/`，也没有 `skills/` 分层。主 Agent 按 Phase 引导作者；正文阶段只在需要时调用 `general-purpose` subagent 生成正文。
- `v2.0.0`：拆成 `skills/setup`、`outline`、`prompt`、`write`、`archive` 等 composable skills，但仍不是多角色 agent 架构，更像“单主控 agent + 子流程说明书”。
- `v3.0.0`：形成 5-phase harness，并引入 `SOLO Mode`。这是最值得 OAN 参考的单 agent 阶段。
- `v3.5.0`：章纲阶段加入 4 个 PreFlight subagents，是 multi-agent 化前奏，但还不是当前顶层 agent 架构。
- `2a37e61` / `v4.0.0` 前后：正式引入 `agents/novel-agent.md`、`writer.md`、`updater.md`、`chapter-planner.md` 等当前多 agent 架构。

`v3.0.0` 的独到之处在于：它不是靠多个角色 agent 分工，而是靠一个状态驱动主流程约束写作。

可学习点：

- **状态驱动循环**：每轮先读 `story.md`、`.agent/status.md`、chapter status，再判断下一步；流程可以跨会话恢复，不依赖聊天记忆。
- **SOLO Mode**：单 agent 可以快速推进，但仍必须完整产出设定、卷纲、章纲、prompt、正文、归档文件；它跳过的是确认摩擦，不跳过写作证据链。
- **Phase 顺序不可跳**：设定 → 卷纲 → 章纲 → prompt → 正文 → 归档。这个顺序把“写得快”和“写得不乱”分开处理。
- **Chapter Memo**：章纲阶段要求 reader expectation、payoff plan、knowledge state、required changes 等字段，把“下一章写什么”变成可检查契约。
- **Prompt 隔离边界**：正文生成主要读取 prompt，减少全量设定和历史上下文对 prose 的污染。
- **章节后上下文重置**：每章归档后建议通过 `/new` 或新会话继续，依靠落盘状态恢复上下文，避免长对话吞掉后续推理空间。

对 OAN 的启发是：OAN 不必在默认写作路径里引入固定多 agent。更适合的形态是“单 agent 状态机 + 明确中间产物 + 可选 specialist skill”。也就是说，OAN 可以吸收 `v3.0.0` 的 harness 思想，但落点应是 OAN 自己的 `context-package`、`chapter-contract`、`PendingAction settlement bundle` 和 Git diff，而不是复制其直接写文件流程。

### 写前读取与中间产物

`awesome-novel-skill` 的强项是把正文生成前的产物拆得很细：

- 卷纲：决定卷级情绪走向、冲突阶梯、信息差。
- 章纲：把卷级方向细化为情绪锚点、章内冲突阶梯、信息差变化、POV、场景卡、禁止清单、chapter memo、hooks。
- Prompt：把章纲和约束整理成 writer 可执行的写作输入。
- Writer：只读 prompt、writing-style 和 genre-setting，避免被卷纲、历史章节等材料污染。

这个设计强调：正文写作 agent 不负责规划，只负责执行已经校准好的章节契约。

### 写后记录

`updater` 的职责很清楚：

- 对比 AI 原版快照与最终正文，提取作者修改偏好。
- 更新出场角色的状态、情绪弧和关系变化。
- 追加时间线事件。
- 记录世界观新增事实。
- 合并反 AI 规则和作者文风偏好。
- 维护 memory 条目，查重、压缩、晋升为 permanent memory。

这里最值得学习的是“写后结算由证据和 diff 驱动”，而不是只相信 agent 的计划。

### 优点

- 写作职责拆分非常明确，适合理解长篇写作各阶段需要什么产物。
- 章纲方法论细，特别是情绪锚点、冲突阶梯、信息差、POV、场景卡和 hooks。
- 通过 order 文件让 agent 交接可观察。
- 归档流程重视角色状态、时间线、作者偏好和记忆压缩。
- Writer 纯净上下文的思想很有价值，可以降低模型被无关材料带偏的概率。

### 限制与风险

- 默认多 agent 流水线较重，不符合 OAN “不做重型多 agent runtime”的边界。
- GPL-3.0 风险明确，OAN 不应复制其 prompt、模板或 agent 文件。
- 真实文件写入由 agent 执行，不符合 OAN 的 PendingAction / Human Approval 约束。
- 文件结构与 OAN Object File Tree 不一致。
- 过度分工可能增加写作摩擦，尤其在作者只是想快速推进一章时。

## novel-writer-skills

### 实际定位

`novel-writer-skills` 是一个 Claude Code slash command + Agent Skills 项目。它不像 `awesome-novel-skill` 那样把每一步都做成专职 agent，而是把写小说包装成一套命令流：

```text
/constitution
  -> /specify
  -> /clarify
  -> /plan
  -> /tasks
  -> /write
  -> /analyze
```

同时提供追踪命令：

- `/track-init`
- `/track`
- `/plot-check`
- `/timeline`
- `/relations`
- `/world-check`

它的底层风格很像把软件工程里的 specification / plan / tasks 迁移到小说创作。

### 实际写作 workflow

`novel-writer-skills` 的主线是：

1. `constitution`：建立创作原则和长期约束。
2. `specify`：生成故事规格，定义题材、目标、结构、角色、线索等。
3. `clarify`：补齐关键不确定问题。
4. `plan`：把规格转化成创作计划，包括方法选择、章节架构、情绪曲线、线索分布、人物体系和世界观展开。
5. `tasks`：把计划拆成可执行写作任务。
6. `write`：选取待写任务，读取完整上下文，生成章节正文。
7. `analyze`：在写前分析框架完整性，或写后分析正文质量。

### 写前读取协议

它对 `/write` 的读取顺序要求很强，这一点尤其值得 OAN 学习。写作前必须按优先级读取：

- constitution 与 style reference。
- specification、creative plan、tasks。
- specification frontmatter 中声明的 style / requirements。
- character state、relationships、plot tracker、validation rules。
- 类型知识、写作规范、历史正文。
- 开篇阶段还会额外加载黄金开篇规则或前几章参照。

更关键的是：`/write` 要输出写前检查清单，说明已经读了哪些核心文件。也就是说，它把“读过必要上下文”变成一个作者可见的中间产物，而不是隐藏在模型内部。

### 追踪系统

`track-init` 会从 specification、creative-plan 和 outline 中初始化：

- plot-tracker
- timeline
- relationships
- character-state
- validation-rules

`track` 则整合写作进度、情节发展、时间线、角色状态和伏笔状态，并可做一致性检查和简单自动修复。

从 OAN 视角看，它的 JSON tracking 不应照搬，但“写作前初始化追踪对象，写作中持续核对”的思想与 OAN 的 `state/`、`timeline/`、`foreshadow/` 非常契合。

### 优点

- 命令序列清晰，适合作者理解“从创意到章节”的路径。
- 写前读取协议明确，能显著减少长篇写作漂移。
- 追踪系统覆盖 plot、timeline、relationships、character state 和 validation rules。
- `/analyze` 区分写前框架分析和写后正文分析，适合 OAN 的审稿与准备检查。
- 类型知识 skill 会根据题材自动参与，但原则上仍是建议而不是强制。

### 限制与风险

- spec-kit / slash command 味道很重，容易让小说创作变成填工程表格。
- 写入仍偏直接，不符合 OAN PendingAction 模式。
- tracking 使用 JSON，和 OAN 的 Markdown/YAML Object File Tree 需要重新映射。
- 自动修复章节文本的能力如果照搬，会越过 OAN 的人类确认边界。

## oh-awesome-novel-skill

### 实际定位

`oh-awesome-novel-skill` 是一个单文件轻量 skill，说明它是基于 `awesome-novel-skill` 与 `novel-writer-skills` 生成的精简版。

它与 OAN 当前方向最接近：

- 默认单 agent 直接执行。
- 不引入固定多 agent 架构。
- 使用少量 Markdown 文件保存长期状态。
- 写作前读必要上下文。
- 章节接受后再更新连续性、角色状态、伏笔和偏好。
- 规划服务写作，不让规划本身膨胀成系统。

### 实际 workflow

它的工作流可以概括为：

1. 入口检测项目文件。
2. 无项目时询问是否初始化，不擅自创建。
3. 读取最近状态，给作者一个简短状态报告。
4. 基础设定阶段整理读者承诺、主角、主冲突、类型契约和文风。
5. 大纲阶段只规划必要范围：短篇用场景列表，长篇用卷/阶段，远期不确定时只规划接下来 3-8 章。
6. 单章循环：
   - 读取 story、session、settings、当前 outline、最近 1-3 章 archive、未解决 hooks。
   - 生成或刷新章节 outline。
   - 写 draft。
   - 过质量门。
   - 作者选择修订、归档或继续。
   - 接受后归档正文并更新 memory。

### 写后记录

章节被接受后，它要求更新：

- continuity
- characters
- hooks
- preferences
- session
- chapter id / 当前进度

它没有复杂对象模型，但结算时机是对的：只有“被接受的章节”才进入长期记忆。

### 优点

- 轻量、清楚、低摩擦。
- 明确作者是最终权威。
- 默认不重型化，符合 OAN 的 Aider-style runtime。
- 强调读前写后纪律，但不会要求每一章都跑完整工业流程。
- 与 OAN 当前 `novel-copilot` 的 observe -> plan -> draft/propose -> verify -> settle 骨架高度兼容。

### 限制

- 文件结构过于简化，不能直接承载 OAN 的 Object File Tree。
- 没有 PendingAction、SemanticPatch、Git diff 等 OAN 核心写入机制。
- 章纲、context package、settlement bundle 的 schema 还偏粗。
- 缺少导入、拆文、对标、Play、Roleplay Sandbox 等更大的产品能力。

## oh-story-claudecode

### 实际定位

`oh-story-claudecode` 是一个面向网文创作的 Claude Code / OpenClaw skill 集。它的目标不是只写下一章，而是围绕商业网文生产建立完整能力：

- 选题与爆款逆向。
- 长篇 / 短篇扫描。
- 长篇 / 短篇拆文。
- 长篇 / 短篇写作。
- 导入已有小说为写作工程。
- 去 AI 味。
- 多视角审稿。
- 封面与浏览器辅助。

它最核心的写作观念是：先确定读者情绪满足，再组织故事。

### 实际长篇写作 workflow

`story-long-write` 会根据项目状态路由：

- 开书：从选题、核心设定、卷纲、细纲开始。
- 日更续写：加载 daily workflow。
- 大修：加载 revision workflow。

长篇日更流程尤其值得 OAN 参考：

1. 快速加载上下文：上次进度、伏笔、时间线、本章细纲。
2. 按细纲涉及角色加载角色文件。
3. 如果追踪为空，则从卷纲和最新正文重建上下文。
4. 每章开始前做状态筛选，只保留“如果不知道这个，本章会写错”的信息。
5. 做文风召回：读取对标书 `文风.md` 和匹配章节摘要 / 深度拆解。
6. 用一句话确认本章意图：情绪、节奏、文风指令。
7. 写正文。
8. 字数验证，不足则回到细纲补事件。
9. 检查章尾钩子、爽点、禁用词。
10. 每章写完立即更新伏笔、时间线、角色状态和上下文。
11. 批量写作时串行推进，不并发写多章。

这个流程的价值在于：它不是“读全部资料后写”，而是先筛出最小记忆包，再把状态、文风和本章意图压成可执行的写作上下文。

### 拆文与对标

`story-long-analyze` 是完整拆文管道：

- 备份原文。
- 切分章节。
- 黄金三章深度拆解。
- 逐章摘要。
- 剧情聚合。
- 角色、关系、设定提取。
- 汇总报告。
- 文风分析。

拆文结果落到 `拆文库/{书名}/`，写作项目可把它复制或引用为 `对标/`。这让“参考作品”不只是聊天里的一句话，而是可查询的结构化资料。

对 OAN 来说，这启发的是未来可以有“Reference Work / Deconstruction Library”能力，但应落成 OAN 的文件对象和人类确认流，而不是照搬目录和长 pipeline。

### 导入已有小说

`story-import` 会把已有小说先分析，再迁移成标准写作项目。它不是简单导入正文，而是试图重建：

- 设定。
- 角色。
- 关系。
- 世界观。
- 大纲。
- 追踪文件。
- 章节正文。
- 拆文库材料。

这与 OAN 后续“导入已有小说工程”高度相关。OAN 可吸收其“先分析再迁移”的原则：不要把外部文本直接当作真相文件，先形成可审阅的提取结果，再由用户确认进入 OAN Object File Tree。

### 审稿与去 AI 味

`story-review` 提供 full / lean / solo 三种模式，并要求报告 Requested Mode、Effective Mode、Fallback 和 Rubric 来源。它的 findings schema 包含严重程度、类别、位置、证据、问题和修复建议。

`story-deslop` 的优点是把“去 AI 味”拆成检测、分级、门禁和保护规则：

- 只改表达，不改剧情事实。
- 保留伏笔、钩子、角色特征和关键转折。
- 不整段删除正文。
- 根据禁用词、句式套路、心理告知、节奏均匀、对话标签等指标分级。

这些适合 OAN `/审稿` 与 `/去AI味` 吸收为检查清单和报告格式。

### 优点

- 拆文、对标、文风召回和日更写作形成闭环。
- “最简记忆包”概念非常适合长篇续写。
- 每章都要求细纲存在，不允许跳过本章计划直接写正文。
- 写作后立即更新伏笔、时间线、角色状态和上下文。
- 多模式审稿有降级机制，避免 agent 不可用时流程崩溃。
- 去 AI 味强调保留剧情功能，避免为去味牺牲正文信息。

### 限制与风险

- 技法和目录强烈面向网文商业生产，不应变成 OAN 默认美学。
- setup、hooks、agents、references 体系较重。
- 长 pipeline 容易让作者在创作前被流程淹没。
- 外部资料、拆文和对标涉及版权与来源使用边界，OAN 需要更严格的用户材料来源说明。
- 直接写文件和 hook 自动化不符合 OAN 的 PendingAction / Human Approval 边界。

## 横向对比

| 维度 | awesome-novel-skill | novel-writer-skills | oh-awesome-novel-skill | oh-story-claudecode | OAN 可取方向 |
|------|---------------------|---------------------|------------------------|---------------------|--------------|
| 默认形态 | 多 agent 流水线 | slash command 规格工程 | 单 agent 轻流程 | 多 skill 网文工作台 | 单 agent 默认，必要时有可选 specialist skill |
| 写前核心 | 卷纲、章纲、prompt 逐级生成 | constitution/spec/plan/tasks + tracking | 读近期状态后刷新章纲 | 状态筛选 + 文风召回 + 意图确认 | `context-package` + `chapter-contract` + `pre-write-check` |
| 正文生成 | writer 只读 prompt 和少量 settings | `/write` 读完整优先级上下文 | 直接写 draft，过质量门 | 串行日更，每章独立校准 | 不直接写真文件，只 `chapter.createDraft` PendingAction |
| 写后结算 | updater 更新角色、时间线、记忆、偏好 | tracking 持续更新 | archive 后更新 memory | 每章更新伏笔、时间线、角色状态、上下文 | settlement bundle 必须 evidence-only |
| 审稿 | reader + anti-ai | `/analyze` + consistency skills | 质量门 | `/story-review` + `/story-deslop` | `/审稿` 固定 checklist 与 findings schema |
| 上下文治理 | writer 纯净上下文 | 强制读取清单 | 最近章节 + 未解 hooks | 最简记忆包 + 对标召回 | source id、included/omitted、读取理由、预算层级 |
| 主要风险 | GPL + 多 agent 过重 | 规格工程过重 | schema 太粗 | 网文工业流程过重 | 吸收理念，不照搬架构 |

## OAN 已经吸收或基本覆盖的理念

这些内容在 OAN 当前稳定文档或 `novel-copilot` 指引中已经存在方向，不需要从参考项目重新引入：

- 文件即记忆：OAN 已经升级为 Markdown / YAML / Object File Tree。
- 单 agent tool loop：OAN 明确采用 Aider-style runtime，而不是固定多 agent runtime。
- 写前读取事实源：`novel-copilot` 已要求读取 workflow、constitution、summary、state、timeline、foreshadow、character、world、chapter。
- 写入前人类确认：OAN 的 PendingAction / diff / Human Approval 比这些参考 skill 更严格。
- 章节后结算：OAN 已有 summary、state、timeline、foreshadow、character update 的 settlement bundle 思路。
- 去 AI 味作为明确 quick command：OAN 已有 `/去AI味`。
- 伏笔、时间线、状态作为独立领域：OAN 已有 `foreshadow/`、`timeline/`、`state/`。

## OAN 可继续吸收的内容

以下是建议后续进入 `OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md` 时可考虑的候选点。此处只记录参考分析，不直接修改总 notes。

### 1. 写前校准表

来源：`novel-writer-skills`、`oh-story-claudecode`、`awesome-novel-skill`。

建议 OAN `/写下一章` 在正文前输出短表：

- 已读取上下文：按 source id / 文件 / 工具结果列出。
- 本章契约：目标、冲突、情绪、POV、章尾变化。
- 必须兑现：hook id、状态变化、读者期待。
- 暂不暴露：秘密、底牌、未到时机的设定。
- 风险检查：OOC、信息越界、世界规则冲突、战力或资源异常、AI 味高危点。
- 写入方式：只通过 `chapter.createDraft` 创建 PendingAction。

### 2. 本章契约 schema

来源：`awesome-novel-skill`、`oh-awesome-novel-skill`、`oh-story-claudecode`。

建议 `/规划下一章` 不只输出普通大纲，而是输出稳定的 `chapter-contract`：

- chapter id / title candidate。
- 本章读者情绪目标。
- 场景序列。
- POV。
- 冲突阶梯。
- 信息差变化。
- 角色出场与状态前置。
- 伏笔操作：新增、推进、提及、回收、延后。
- 章尾必须发生的改变。
- 禁止事项。

### 3. 最简记忆包

来源：`oh-story-claudecode`。

OAN 可以在 context package 中加入 `minimal-memory`：

- 角色状态：只保留本章涉及角色的最新身份、能力、关系、公众形象。
- 相关伏笔 / 前史：只保留本章会写错的因果信息。
- 世界约束：只保留本章涉及的规则、地点、能力或社会限制。
- 明确 omitted：说明哪些信息被排除，因为与本章无直接因果关系。

这可以避免长篇越写越把上下文塞满。

### 4. Evidence-only settlement 加强

来源：`awesome-novel-skill`、`oh-awesome-novel-skill`、`oh-story-claudecode`，也与 OAN 当前 notes 中 InkOS 方向一致。

建议 `/整理本章` 强化为：

- 先输出 observation log。
- 再从 observation log 生成 settlement bundle。
- 只记录正文实际发生或明确确认的事实。
- 大纲中计划但正文未发生的内容不得写入 truth files。
- 伏笔“提及 / 推进 / 回收 / 延后 / 新增”分开记录。
- 角色状态只在身份、能力、关系、位置、资源、伤势、公众形象等发生变化时更新。

### 5. 去 AI 味保护规则

来源：`oh-story-claudecode`、`awesome-novel-skill`。

OAN `/去AI味` 应明确：

- 只改表达，不改剧情事实。
- 不删除伏笔、钩子、角色特征、关键信息或必要转折。
- 不把“更文学”当作默认目标，优先符合当前作品风格。
- 输出修改理由和风险点。
- 正文替换仍通过 PendingAction。

### 6. 审稿 findings schema

来源：`oh-story-claudecode`、`novel-writer-skills`。

OAN `/审稿` 可统一报告格式：

- severity。
- category。
- location。
- evidence。
- issue。
- suggested fix。
- whether needs user decision。

这样后续可以把审稿意见转成可采纳的修订任务，而不是一段泛泛建议。

### 7. 参考作品拆解库

来源：`oh-story-claudecode`。

OAN 可规划独立的 reference / deconstruction 能力：

- 用户提供合法持有或有权使用的参考文本。
- 先生成拆解报告、风格摘要、章节节奏、角色/设定观察。
- 结果作为参考资料进入 OAN 文件树或 project-local reference directory。
- 写作时只召回“结构、节奏、文风观察”，不复制桥段或表达。

这应是可选工作流，不应进入默认写下一章路径。

### 8. 单 agent 默认 + 可选专家评审

来源：`oh-awesome-novel-skill`、`oh-story-claudecode`。

OAN 应保持单 agent 默认。需要复杂审稿、拆文、去 AI 味、导入时，可以把 specialist prompt pack 当作 skill 使用，但不把它们升级成常驻多 agent runtime。

### 9. 状态驱动单 agent harness

来源：`awesome-novel-skill v3.0.0`。

OAN 可吸收早期 `awesome-novel-skill` 的单 agent harness，而不是当前版本的固定 multi-agent 架构：

- 每轮从文件系统重建状态：workflow、chapter status、draft / archive 是否存在、settlement 是否完成。
- 根据状态路由到“规划、写作、审稿、整理、归档”等阶段，但默认由同一个 Copilot 执行。
- 高摩擦阶段提供普通模式；低摩擦推进可提供类似 SOLO 的“快速推进模式”，但仍生成 PendingAction，不直接写真实文件。
- 每章完成后依靠落盘 truth files 恢复上下文，鼓励新会话继续，而不是无限累积聊天历史。
- Specialist skill 只在需要时调用，例如去 AI 味、审稿、拆文、导入、角色扮演 rehearsal。

这条与 OAN 当前 Aider-style runtime 很契合：流程纪律来自状态机和文件证据，不来自常驻多 agent 平台。

## 不建议吸收或需要谨慎的内容

- 不建议照搬 `awesome-novel-skill` 的固定多 agent 流水线。它适合学习分工，不适合作为 OAN 默认架构。
- 不建议复制 GPL-3.0 项目的 prompt、模板、agent 文件或工具代码。
- 不建议把 `novel-writer-skills` 的 spec-kit command 结构完整搬进 OAN，否则会让小说写作过度工程化。
- 不建议把 `oh-story-claudecode` 的商业网文生产逻辑变成 OAN 默认美学。它应作为题材 / 平台 / 用户目标相关的可选 skill。
- 不建议让任何 skill 直接修改 OAN 真实目标文件。所有写入都必须走 PendingAction。
- 不建议默认每章都强制拆文、对标、文风召回。这些适合高目标项目或用户显式开启。
- 不建议自动修复正文并落盘。即使是简单角色名修复，也应生成 diff 给作者确认。

## 对 OAN 后续写作指引升级的建议归纳

如果后续要统一整理 OAN agent 写作指引，可以把这些 skill 的启发压缩成四个核心升级方向：

1. **写前产物标准化**  
   增加 `context-package`、`chapter-contract`、`pre-write-check`，让 agent 写正文前的判断可见。

2. **写中上下文最小化**  
   从“读取所有相关文件”升级为“读取并筛选最小必要记忆包”，同时记录 included / omitted / reason。

3. **写后结算证据化**  
   先 observation log，再 settlement bundle；计划不能冒充事实，伏笔状态必须细分。

4. **质量能力 skill 化**  
   去 AI 味、审稿、拆文、对标、导入、文风召回应作为可选 skill / workflow，不进入默认重型 runtime。

## 证据来源

- `reference-only/awesome-novel-skill/SKILL.md`
- `reference-only/awesome-novel-skill@v1.0.0:SKILL.md`
- `reference-only/awesome-novel-skill@v2.0.0:SKILL.md`
- `reference-only/awesome-novel-skill@v3.0.0:SKILL.md`
- `reference-only/awesome-novel-skill@v3.5.0:SKILL.md`
- `reference-only/awesome-novel-skill/README.md`
- `reference-only/awesome-novel-skill/LICENSE-DECLARATION.md`
- `reference-only/awesome-novel-skill/agents/novel-agent.md`
- `reference-only/awesome-novel-skill/agents/writer.md`
- `reference-only/awesome-novel-skill/agents/updater.md`
- `reference-only/awesome-novel-skill/skills/chapter-outline.md`
- `reference-only/awesome-novel-skill/skills/writing-execution.md`
- `reference-only/awesome-novel-skill/skills/memory-recording.md`
- `reference-only/novel-writer-skills/README.md`
- `reference-only/novel-writer-skills/LICENSE`
- `reference-only/novel-writer-skills/templates/commands/write.md`
- `reference-only/novel-writer-skills/templates/commands/analyze.md`
- `reference-only/novel-writer-skills/templates/commands/track.md`
- `reference-only/novel-writer-skills/templates/commands/track-init.md`
- `reference-only/novel-writer-skills/templates/commands/plan.md`
- `reference-only/novel-writer-skills/docs/skills-guide.md`
- `reference-only/oh-awesome-novel-skill/SKILL.md`
- `reference-only/oh-story-claudecode/README.md`
- `reference-only/oh-story-claudecode/LICENSE`
- `reference-only/oh-story-claudecode/skills/story-setup/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/workflow-daily.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/state-tracking.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/artifact-protocols.md`
- `reference-only/oh-story-claudecode/skills/story-long-analyze/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-import/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-review/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-deslop/SKILL.md`
- `docs/AGENT_OPERATING_MANUAL.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`
- `packages/core/src/novel-copilot-skill.ts`
