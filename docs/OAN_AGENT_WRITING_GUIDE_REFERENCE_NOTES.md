# OAN Agent Writing Guide Reference Notes

Status: Reference Notes

本文档记录 `oh-awesome-novel` 自身 agent 写作指引的当前状态，以及从参考项目 InkOS、StoryForge、SillyTavern、Webnovel Writer 和若干写作 skill 项目中可吸收的写作 workflow / Play 经验。

后续还会继续阅读其他参考项目。因此本文档刻意保留来源标注，避免把不同项目的启发混在一起，也避免把“候选改进”误认为 OAN 已实现能力。

## Source Tags

后续新增或修改本文件内容时，建议在小节或条目后标注来源：

- `[OAN-current]`：来自 OAN 当前稳定文档或已存在代码。
- `[OAN-constraint]`：来自 OAN 的架构边界或产品原则。
- `[InkOS-reference]`：来自 `reference-only/inkos` 的参考项目观察。
- `[StoryForge-reference]`：来自 `reference-only/storyforge` 的参考项目观察。
- `[SillyTavern-reference]`：来自 `reference-only/SillyTavern` 的参考项目观察。
- `[WebnovelWriter-reference]`：来自 `reference-only/webnovel-writer` 的参考项目观察。
- `[AwesomeNovelSkill-reference]`：来自 `reference-only/awesome-novel-skill` 当前版本的参考项目观察。
- `[AwesomeNovelSkill-v3-reference]`：来自 `awesome-novel-skill` v3.x 单 agent harness 历史版本的参考观察。
- `[NovelWriterSkills-reference]`：来自 `reference-only/novel-writer-skills` 的参考项目观察。
- `[OhAwesomeNovelSkill-reference]`：来自 `reference-only/oh-awesome-novel-skill` 的参考项目观察。
- `[OhStoryClaudeCode-reference]`：来自 `reference-only/oh-story-claudecode` 的参考项目观察。
- `[OAN-adaptation]`：基于参考项目启发，但已经按 OAN 边界重新改写。
- `[Future-reference]`：预留给后续其他参考项目。

标注原则：

- 候选升级方向必须说明参考来源。
- 不能把参考项目的自动化行为直接写成 OAN 当前行为。
- 不能复制参考项目的实现代码、prompt 原文或 UI 文案；对于 AGPL 或许可证未明确允许的项目，只能吸收产品模式和抽象方法。
- 如果同一个建议来自多个参考项目，应列出多个来源，而不是只保留最后一次阅读的项目。

## Current OAN Writing Guide State

### Product Boundary

OAN 的当前稳定定位是 filesystem-first 长篇小说 AI Copilot / Novel IDE。[OAN-current]

核心边界：

- Markdown / YAML / Object File Tree 是事实源。[OAN-current]
- Git 是历史引擎。[OAN-current]
- AI 是 Copilot，不是数据所有者。[OAN-current]
- 所有真实目标文件写入必须经过 PendingAction / diff / Human Approval。[OAN-constraint]
- Runtime 保持 Aider-style tool loop，不引入重型多 agent runtime。[OAN-constraint]

这些边界意味着：OAN 可以学习参考项目的写作阶段、上下文治理和中间产物，但不能照搬自主写作流水线、后台 daemon 或直接落盘行为。

### Filesystem Domains

OAN 本地小说 workspace 当前分为这些主要写作事实域。[OAN-current]

- `.oan/workflow.yaml`：项目级 workflow。
- `.oan/constitution/*`：小说宪法、风格、世界、角色、禁忌和方向约束。
- `characters/`：角色卡与关系。
- `world/`：世界观、势力、地理、规则、历史等对象文件。
- `chapters/`：正文。
- `state/`：最新状态，例如角色、物品、地点等 YAML。
- `timeline/`：事件与弧线。
- `foreshadow/`：伏笔池，分 active / resolved。
- `summaries/`：章节、卷、全局摘要。

这套分层已经适合承载长篇写作所需的“长期事实 + 最新状态 + 历史摘要 + 伏笔债务”。

### Current Novel Copilot Skill

当前内置 `novel-copilot` skill 已经定义了基础 agent 行为。[OAN-current]

每轮遵循：

```text
observe -> plan -> draft/propose -> verify -> settle
```

当前 observe 规则：

- 影响连续性时优先读取 `workflow.get`、`constitution.get`、`summary.get`、`state.get`、`timeline.list`、`foreshadow.list`。
- 改变角色声音、动机、关系、状态或出场作用前读取 `character.list` / `character.get`。
- 使用世界规则、势力、地点、力量体系、生物或设定事实前读取 `world.search`。
- 续写、审稿、整理或改写章节时读取 `chapter.get`。

当前 write-intent 规则：

- 章节正文使用 `chapter.createDraft`。
- 摘要使用 `summary.generateChapter`。
- 最新状态使用 `state.set`。
- 剧情事件使用 `timeline.add`。
- 伏笔使用 `foreshadow.create`。
- 角色卡局部更新使用 `character.updatePersonality`。

当前 settle 规则仍偏宽，需要在后续实现中收紧：

- 当前内置 skill 仍把章节完成、审稿或明确整理都视为 settlement 触发条件。[OAN-current]
- 建议修正为：章节完成、正文 PendingAction 被接受后、或用户明确要求整理时，才提出 settlement bundle。[OAN-adaptation]
- bundle 至少包括章节摘要、角色状态变化、时间线事件和伏笔更新。
- 证据不足时应说明无法确定，不编造事实。
- 纯 `/审稿` 默认只输出审稿报告，不隐式触发 settlement；只有用户要求“按审稿结果整理/落库”时才进入 settlement。

### Current Quick Commands

当前 quick commands 已经覆盖小说写作常见动作。[OAN-current]

- `/生成角色卡`
- `/规划下一章`
- `/写下一章`
- `/整理本章`
- `/审稿`
- `/更新状态`
- `/补伏笔`
- `/去AI味`

其中 `/规划下一章` 已要求读取 workflow、constitution、summary、state、timeline、foreshadow，并输出下一章目标、场景序列、角色出场、钩子和结尾变化。

`/写下一章` 已要求先读取必要角色卡和前章内容，并且正文只能通过 `chapter.createDraft` 创建 PendingAction。

`/整理本章` 已要求读取目标章节并生成章节摘要、角色状态、时间线和伏笔变更的 PendingAction。

### Current Gaps

OAN 当前指引已经有正确方向，但还偏粗。[OAN-current]

主要缺口：

- `/规划下一章` 还没有稳定的“本章契约”格式。
- 还缺少 `/规划大纲`、`/规划下一卷` 这类卷级 / 大纲级规划入口；复杂 gate、章节节点和节奏结构更适合放在这些入口，而不是默认压到每个普通单章。[WebnovelWriter-reference][OAN-adaptation]
- `/写下一章` 还没有要求 agent 在正文前输出写前校准表。
- 上下文选择还没有显式产出 `context-package`、`rule-stack`、`trace`。
- 上下文来源还没有轻量 source id、读取理由、预算层级和 omission 记录。
- agent capability / prompt provenance / run log 还没有形成可盘点目录。
- `/整理本章` 还没有要求先生成 observation log，再从正文证据生成状态增量。
- 伏笔推进、提及、回收、延后还没有区分得足够细。
- 审稿维度还没有稳定化为可复用 checklist。
- `/审稿` 还没有稳定 findings schema，例如 severity、category、location、evidence、issue、suggested fix、needs user decision。[NovelWriterSkills-reference][OhStoryClaudeCode-reference][OAN-adaptation]
- `/去AI味` 还没有明确“只改表达、不改剧情事实、不删除伏笔/钩子/关键信息”的保护规则。[AwesomeNovelSkill-reference][OhStoryClaudeCode-reference][OAN-adaptation]
- 状态、时间线、伏笔目前是事实源，但还缺少面向作者阅读的派生 projection 规范。
- 还缺少独立 Play / Roleplay Sandbox 产品面，让用户在阅读和写作之外沉浸式进入小说世界。[SillyTavern-reference][OAN-adaptation]
- 参考作品拆解 / 对标资料目前只在 `docs/tasks/0900.md` 规划中，还没有形成可运行的 reference deconstruction layer。[OhStoryClaudeCode-reference][OAN-adaptation]

## InkOS Learnings

以下内容来自 InkOS 参考项目观察，尚不是 OAN 当前行为，除非另有标注。[InkOS-reference]

### Long-Term Control Surface

InkOS 强调长期控制材料和短期 steering 分离：

- 作者长期意图：这本书要成为什么。
- 当前焦点：最近 1-3 章要把注意力拉回哪里。
- 故事规则、世界设定、卷纲、题材规则、文风约束。

OAN 可吸收为：在 `.oan/constitution/*` 和 `.oan/workflow.yaml` 之外，明确支持“长期方向”和“近期焦点”的 agent 读取优先级。[OAN-adaptation]

可能落点：

- `.oan/constitution/direction.md`
- `.oan/workflow.yaml`
- 未来的 `.oan/focus.md` 或 workflow 中的 `currentFocus`

### Protected / Compressible Context

InkOS 把上下文分为 protected 和 compressible。[InkOS-reference]

OAN 可吸收的分层：

- protected：用户本轮明确要求、constitution、workflow、当前章节目标、关键角色状态、未回收伏笔、硬世界规则。
- compressible：旧章节摘要、远期背景、低相关世界设定、历史聊天。
- excluded：未确认草稿、与当前任务无关且容易污染模型的旧候选内容。

这适合成为 OAN context package 的字段，而不是 runtime 核心架构。[OAN-adaptation]

### Plan / Compose / Trace

InkOS 在写正文前会区分 plan 和 compose。[InkOS-reference]

OAN 可吸收为写作前中间产物：

- `chapter-intent`：本章目标、冲突、必须推进的状态、禁止事项。
- `context-package`：本轮读取了哪些文件、为什么相关、哪些材料被压缩或排除。
- `rule-stack`：constitution、workflow、用户临时要求、题材规则的优先级。
- `trace`：工具读取、上下文选择和生成原因。

这些产物适合放在 `.workspace` shadow 区域或 `.oan/sessions/`，不要直接污染小说事实源。[OAN-adaptation]

### Chapter Intent Contract

InkOS 的章节 memo 思路值得拆成 OAN 的“本章契约”。[InkOS-reference]

OAN 规划下一章时可要求 agent 输出：

- 当前任务：本章实际要推进什么。
- 读者在等什么：本章是制造期待、延迟兑现，还是支付期待。
- 该兑现的伏笔：必须落地的 hook。
- 暂不掀开的底牌：本章不能提前暴露的秘密。
- 日常/过渡段落任务：非冲突段落承担铺垫、关系推进、信息递送还是节奏缓冲。
- 章尾必须发生的改变：信息、关系、身体状态、资源、目标、风险至少有一项发生可见变化。
- 不要做：禁止 OOC、禁止设定越界、禁止提前解决大冲突等。
- 当前锚点：地点、对手、收益目标或情绪压力。
- 本章冲突：一句话概括。
- 章节类型：主线推进、过渡、爆点、回收、铺垫等。

这能把 `/规划下一章` 从普通大纲升级成写作前契约。[OAN-adaptation]

### Pre-Write Check

InkOS 要求 writer 在正文前输出 `PRE_WRITE_CHECK`。[InkOS-reference]

OAN 可吸收为 `/写下一章` 的强制写前校准：

- 复述本章契约，不直接跳到正文。
- 明确上下文范围，例如上一章、相关角色卡、状态、世界规则、active hooks。
- 列出待推进或待回收伏笔，必须使用真实 hook id 或明确写“无”。
- 扫描 OOC、信息越界、设定冲突、战力/资源崩坏、节奏和词汇疲劳风险。
- 确认章尾必须发生的 1-3 个变化。

OAN 不应把 `PRE_WRITE_CHECK` 写进正文章节文件。它应作为 assistant 输出、session artifact 或 shadow metadata。[OAN-adaptation]

### Evidence-Only Settlement

InkOS 的结算纪律很适合 OAN：写后只记录正文实际支持的事实。[InkOS-reference]

OAN `/整理本章` 应强化这些规则：

- 如果正文只暗示，不记录成已确认事实。
- 不从大纲、卷纲或 agent 计划中补正文尚未到达的剧情。
- 不修改与本章无关的旧 hooks。
- 正文出现新的未解疑问、秘密、悬念或叙事承诺时，应提取为新伏笔候选。
- 旧 hook 只是被提到时，应记录为 mention，而不是推进。
- 旧 hook 有实质进展时，才记录推进。
- 回收和延后应和“提及”分开。

这条规则应成为 OAN settlement 的硬约束。[OAN-adaptation]

### Observation Log Before Settlement

InkOS 有先观察正文事实，再合并到 truth files 的思路。[InkOS-reference]

OAN 可要求 `/整理本章` 先输出 observation log，再生成 PendingAction bundle：

- 出场角色。
- 角色位置变化。
- 物品、资源、伤势、能力、身份等状态变化。
- 关系变化。
- 情绪弧线变化。
- 信息边界变化：谁知道了什么，谁仍不知道什么。
- 时间推进。
- 物理状态或场景状态变化。
- 伏笔新增、推进、提及、回收、延后。
- 世界观新硬事实。

然后再把 observation log 映射为：

- `summary.generateChapter`
- `state.set`
- `timeline.add`
- `foreshadow.create`
- 未来的 `foreshadow.resolve`
- 必要时的 `character.updatePersonality`
- 必要时的 world / constitution proposal

### Audit Checklist

InkOS 的审稿维度覆盖连续性、人设、节奏、伏笔、AI 味、信息边界等。[InkOS-reference]

OAN `/审稿` 可逐步固定为：

- 连续性：状态、位置、时间、物品、伤势、能力是否一致。
- 人设：声音、动机、关系反应、信息边界是否一致。
- 世界观：规则、势力、地理、力量体系是否越界。
- 剧情推进：本章是否有可见变化，而不是只有总结。
- 伏笔：是否遗漏应推进的 hook，是否提前掀底牌。
- 节奏：开场、转场、冲突密度、章尾钩子是否有效。
- 风格：是否符合 constitution/style，是否有词汇疲劳或 AI 味。
- 正文证据：所有建议应引用章节中的具体依据，避免空泛判断。

默认只输出审稿意见；只有用户要求改写时，才通过 `chapter.createDraft` 生成 PendingAction。[OAN-current][OAN-adaptation]

### Human-Readable Projections

InkOS 会把结构化状态渲染成作者可读 Markdown projection。[InkOS-reference]

OAN 可吸收：

- 从 `state/*.yaml` 派生当前状态阅读页。
- 从 `foreshadow/*.yaml` 派生伏笔池表。
- 从 `timeline/*.yaml` 派生按章节排序的时间线。
- 从 `summaries/` 派生长篇进度概览。

projection 应是派生物，可删除后重建，不替代事实源。[OAN-adaptation]

## StoryForge Learnings

以下内容来自 StoryForge 参考项目观察，尚不是 OAN 当前行为，除非另有标注。[StoryForge-reference]

### Lightweight Context Source Discipline

StoryForge 的 `CONTEXT_SOURCES + assembleContext` 值得吸收的是理念，而不是整套重型注册系统。[StoryForge-reference][OAN-adaptation]

OAN 不需要一开始实现完整的 runtime registry、动态 reader、复杂 token scheduler。更合适的第一阶段是轻量化：

- 为常用上下文来源定义稳定 source id，例如 `workflow`、`constitution`、`chapterOutline`、`previousChapterEnding`、`latestState`、`characters`、`worldRules`、`foreshadowLedger`、`timeline`、`styleGuide`。
- 在 `context-package` 中记录每个 source 的读取文件、读取理由、重要性和是否被省略。
- source id 只服务于 agent 解释和测试，不成为新的事实源，也不替代现有 tool API。
- 不为了 registry 而新增重型 planner；仍由 Aider-style loop 调用轻量工具读取文件。

这条可以和 InkOS 的 `protected / compressible / excluded` 合并：InkOS 给语义安全边界，StoryForge 给来源命名和预算解释。[OAN-adaptation][InkOS-reference][StoryForge-reference]

### L0-L3 Budget Layer

StoryForge 的 L0-L3 上下文层级适合补充 OAN 的 context package。[StoryForge-reference]

建议在 OAN 中按两套维度描述上下文：

- 语义边界：`protected / compressible / excluded`。
- 预算层级：`L0 / L1 / L2 / L3`。

推荐含义：

- L0：用户本轮明确要求、系统约束、不可裁剪的任务输入。
- L1：章节目标、本章契约、上一章结尾、最新状态、硬世界规则。
- L2：相关角色卡、相关地点、active hooks、时间线局部、故事线。
- L3：远期背景、旧摘要、参考资料、风格样例、历史聊天。

当上下文超预算时，agent 应先压缩或省略 L3，再处理 L2，不能丢掉 L0/L1。被省略的 source 必须进入 `context-package.omitted`。[OAN-adaptation]

### Capability And Prompt Provenance

StoryForge 把 AI 功能做成 PromptModuleKey、AI call category 和 generated manual，这对 OAN 的 agent 写作指引很有价值。[StoryForge-reference]

OAN 可吸收为：

- 为写作能力建立 capability id，例如 `novel.plan_chapter`、`novel.write_chapter`、`novel.review_chapter`、`novel.settle_chapter`、`novel.import_existing_text`。
- 每个 capability 声明允许读取的 source、允许生成的中间产物、允许提出的 SemanticPatch 类型和是否必须用户确认。
- 每轮写作保留 prompt / guide provenance：使用了哪个 agent guide 版本、genre/style pack、用户临时偏好。
- 生成只读能力说明或 manual，用于盘点 OAN 当前 AI 写作能力，避免 prompt 和行为散落在代码里。

这不要求复制 StoryForge 的 prompt 模板系统；OAN 应保留文件化、可 diff 的 guide / skill / rule pack。[OAN-adaptation]

### Chapter Writing Recipe

StoryForge 的章节编辑器提供了一个较完整的“写正文前读什么”配方。[StoryForge-reference]

OAN 可以吸收为默认读档策略，但不能变成每次全量读取。建议口径：

- 核心必读：本章契约或章节目标、上一章结尾、最新状态、相关角色、active hooks、硬世界规则。
- 条件读取：详细大纲、地点、势力、时间线局部、故事线、风格指南、参考资料。
- agent 必须在 `PRE_WRITE_CHECK` 中列出本章写作约束，包括不能改变的设定、人物信息边界、不能提前揭示的伏笔。
- scene / beat 列表可以作为 `chapter-intent` 的一部分，不强制每次落成独立事实文件。

这样可以吸收 StoryForge 的上下文覆盖面，同时避免上下文污染和工作流过重。[OAN-adaptation]

### Settlement Bundle Extensions

StoryForge 的章节后处理包含摘要、角色状态 diff，并在设计文档中覆盖物品、时间线、关系、伏笔推进等对象。[StoryForge-reference]

OAN 可吸收为 settlement bundle 的补充字段：

- 章节摘要候选。
- 状态变化 diff：entity、field、oldValue、newValue、evidence、confidence。
- 时间线事件候选。
- 伏笔新增、提及、推进、回收、延后。
- 角色卡局部更新候选。
- 下一章衔接点。
- 需要用户确认的疑点。

边界：事实源更新必须 evidence-only，并通过 PendingAction / SemanticPatch；下一章衔接点和疑点默认进入 settlement report 或 session artifact，不直接写入 `state/`、`timeline/`、`foreshadow/`。[OAN-adaptation]

### Review To Revision Loop

StoryForge 的审稿流程支持“报告 -> 按报告修订”的闭环。[StoryForge-reference]

OAN 的口径应更保守：

- `/审稿` 默认只输出报告。
- 报告必须按维度列出 evidence、severity、suggested fix。
- 只有用户确认要修哪些问题后，agent 才能生成局部或全文 SemanticPatch / `chapter.createDraft`。
- 审稿报告可以作为 session artifact 或 shadow 产物保留，方便追踪修改理由。

这与 InkOS 的“默认审稿不改正文”不冲突。[OAN-adaptation][InkOS-reference][StoryForge-reference]

### Import, Snapshot, Run Log, And Resumable Session

StoryForge 对长篇导入、context snapshot、AI usage log 和流式会话保持都有可吸收点。[StoryForge-reference]

OAN 可吸收为：

- 导入已有小说或设定集时采用 chunk + rolling context + structured extraction，输出 Object File Tree 候选文件和 PendingAction。
- context snapshot 可以作为 `.oan/indexes/context-snapshot.md` 这类派生索引，但不能替代状态、时间线、伏笔等 domain projection。
- 每次 agent 写作生成 run log，记录 capability id、guide version、context package id、read file list、proposed patch list、accepted/rejected、token usage。
- 长章节生成、导入、审稿等长任务可以有 resumable session；状态写入 workspace shadow / pending 区，不只留在内存。

## SillyTavern Learnings

以下内容来自 SillyTavern 参考项目观察，尚不是 OAN 当前行为，除非另有标注。[SillyTavern-reference]

### Independent Play Mode

SillyTavern 的核心价值不只是“写作前试跑场景”，而是让用户通过角色扮演进入一个小说世界。[SillyTavern-reference]

OAN 应把 Roleplay Sandbox / Scene Rehearsal 规划成独立 Play 功能，而不是仅作为 `/写下一章` 前的隐藏草稿工具。[OAN-adaptation]

Play Mode 的定位：

- 用户可以在阅读和写作之外，以第一人称、旁观者、指定角色或自定义 persona 进入小说世界。
- Play runtime 读取角色卡、世界规则、当前状态、时间线局部、active hooks 和用户选择的起点。
- Play transcript 对当前 Play session 有连续性，但默认不进入小说 canonical truth。
- Play 中产生的角色反应、对白、事件和状态变化，可以生成 observation log，作为写作 agent 的草稿或参考。
- 只有用户确认后，Play observation 才能转成章节草稿、状态、时间线或伏笔的 PendingAction。

这意味着 OAN 未来可以有两个并列产品面：

- Writing Mode：围绕章节、结算、状态、时间线、伏笔和 Git diff。
- Play Mode：围绕沉浸体验、角色互动、世界探索、分支试跑和 Play session continuity。

### Multi-Character Roleplay Runtime

对角色扮演效果来说，默认不应使用重型多 Agent runtime。[SillyTavern-reference][OAN-adaptation]

更合适的基础形态是：

```text
一个 Play runtime / 世界裁判
    +
多角色 voice/state modules
    +
发言调度策略
    +
Play-local transcript / state
```

原因：

- 单一世界裁判更容易保持叙事节奏、场景边界和世界规则一致。
- 角色模块可以提供角色声音、秘密、关系和短期动机，但不需要每个角色都是独立自主 agent。
- 发言调度可以覆盖 manual / natural / pooled / outline order 等 RP 场景需求。
- 重型多 Agent runtime 容易带来延迟、成本、上下文重复、角色互相抢戏、设定漂移和结算困难。

多 Agent 可以作为高级能力保留给少数场景：

- NPC 或阵营有隐藏目标。
- 需要模拟离屏事件。
- 用户明确想看角色或阵营自主博弈。
- Play session 内需要独立计划，但仍不能直接改真实小说事实源。

### Play Context And Dynamic Lore Activation

SillyTavern 的 WorldInfo / lorebook 说明：沉浸式 Play 不能每轮把全部世界观塞进 prompt，需要按场景动态激活相关材料。[SillyTavern-reference]

OAN 可吸收为 Play 版 context activation：[OAN-adaptation]

- 角色名、地点、物品、势力、术语、伏笔 id、当前场景目标都可以触发相关 source。
- 每次 Play turn 记录被激活的 source id、文件路径、触发原因和预算。
- 被激活材料只作为上下文，不自动写事实源。
- Play observation log 需要区分“正文已确认事实”“Play session 内事实”“只是模型即兴内容”。

### Character Interaction Surface

SillyTavern 的角色卡字段适合启发 OAN 的角色互动面。[SillyTavern-reference]

OAN 可在角色卡中区分 canonical facts 和 interaction hints：[OAN-adaptation]

- canonical facts：身份、经历、关系、状态、能力、秘密等正式事实。
- interaction hints：voice examples、scene entry、alternate greetings、interaction notes、depth prompt、character lorebook。

interaction hints 主要用于 Play、对白生成和场景试跑；只有用户确认后，才可转成 canonical character updates。

### Import Tavern-compatible Character Card

OAN 应支持导入 Tavern-compatible 角色卡，作为 Play Mode 和角色卡生态接入能力。[SillyTavern-reference][OAN-adaptation]

独立规范见：`docs/IMPORT_TAVERN_COMPATIBLE_CHARACTER_CARD.md`。

导入原则：

- 功能名使用 `Import Tavern-compatible Character Card`，不声称是 SillyTavern 官方导入器。
- 独立实现 PNG / JSON 解析，不复制 SillyTavern AGPL 代码。
- 支持本地 PNG / JSON、Tavern Card V1 / V2 / V3 normalization、内嵌 `character_book` 预览。
- 导入后接入 OAN 自己的 `characters/<id>/` Object File Tree。
- Canonical facts 和 interaction hints 分离。
- `system_prompt`、`post_history_instructions`、`character_book` 默认视为 untrusted imported content。
- 导入只能生成 PendingAction；用户确认前不得写真实角色卡文件。

OAN 角色卡可吸收 SillyTavern 的互动字段：

- `first_mes` -> `interaction.md#Scene Entry`
- `alternate_greetings` -> `interaction.md#Alternate Greetings`
- `mes_example` -> `interaction.md#Voice Examples`
- `scenario` -> `interaction.md#Scene Setup`
- `system_prompt` / `post_history_instructions` -> `interaction.md#Prompt Overrides`
- `extensions.depth_prompt` -> `interaction.md#Depth Prompts`
- `extensions.talkativeness` -> Play 多角色发言调度参数
- `character_book` -> `characters/<id>/lorebook.yaml`

这些字段能显著增强 Play 和对白生成，但不应自动覆盖 OAN 的 constitution、world、state、timeline 或 canonical character facts。

## Novel Writing Skill Learnings

以下内容来自 `awesome-novel-skill`、`novel-writer-skills`、`oh-awesome-novel-skill`、`oh-story-claudecode` 和 `webnovel-writer` 的写作 skill / 写作插件参考观察，尚不是 OAN 当前行为，除非另有标注。[AwesomeNovelSkill-reference][NovelWriterSkills-reference][OhAwesomeNovelSkill-reference][OhStoryClaudeCode-reference][WebnovelWriter-reference]

这些项目与 InkOS、StoryForge 的启发有大量重叠。因此本节只合并增量：写作 skill 里的具体 agent 指引、单章推进纪律、单 agent harness、去 AI 味保护和参考拆解 workflow。

### Concept Conflict Resolution

为避免后续文档概念分裂，OAN 统一采用以下口径。[OAN-adaptation]

- `chapter-intent`、`chapter-contract`、`Chapter Memo` 都归并为 **本章契约**。它是写作前中间产物，不是章节正文，也不默认成为长期事实源。[InkOS-reference][AwesomeNovelSkill-reference][OhAwesomeNovelSkill-reference][OhStoryClaudeCode-reference]
- `PRE_WRITE_CHECK`、写前读取清单、写前校准表都归并为 **写前校准表**。它可以作为 assistant 输出、session artifact 或 shadow metadata，不写进 `chapters/` 正文文件。[InkOS-reference][NovelWriterSkills-reference][OhStoryClaudeCode-reference]
- `minimal-memory` / 最简记忆包 是 `context-package` 的子字段，不是新的数据库或独立 truth source。[OhStoryClaudeCode-reference][OAN-adaptation]
- `SOLO Mode` / 快速推进模式只能影响确认频率和交互节奏，不能跳过 PendingAction、diff、Human Approval 和 evidence-only settlement。[AwesomeNovelSkill-v3-reference][OAN-constraint]
- `reference deconstruction` / 拆文 / 对标 是 task 0900 的参考材料层，不是当前小说 workspace 的事实源，也不应默认每章运行。[OhStoryClaudeCode-reference][OAN-adaptation]
- 固定多 agent 架构只作为参考项目实现观察，不进入 OAN 默认 runtime；OAN 默认仍是 Aider-style 单 agent tool loop，可选 specialist skill 按需启用。[AwesomeNovelSkill-reference][OhStoryClaudeCode-reference][OAN-constraint]
- Webnovel Writer 的 `prewrite / precommit / postcommit`、完整写作任务书、`CBN / CPNs / CEN` 不应作为 OAN 普通单章默认负担；更适合在 `/规划大纲`、`/规划下一卷`、卷首 / 卷末 / 关键转折章中启用。普通 `/规划下一章` 与 `/写下一章` 保持轻量校准。[WebnovelWriter-reference][OAN-adaptation]

### State-Driven Single Agent Harness

`awesome-novel-skill` v3.x 的早期形态不是当前固定 multi-agent 架构，而是单 agent 状态驱动 harness。[AwesomeNovelSkill-v3-reference]

OAN 可吸收：

- 每轮从文件系统重建状态：workflow、chapter status、draft / archive 是否存在、settlement 是否完成。
- 根据状态路由到规划、写作、审稿、整理、归档等阶段，但默认仍由同一个 Copilot 执行。
- 可提供低摩擦“快速推进模式”，但只减少确认次数，不允许直接写真实目标文件。
- 每章完成后依靠落盘 truth files 和 session artifact 恢复上下文，避免无限累积聊天历史。
- Specialist skill 只在需要时调用，例如去 AI 味、审稿、拆文、导入或角色扮演 rehearsal。

这与 OAN 当前 Aider-style runtime 不冲突；它强化的是状态机和文件证据，不是引入 planner 或常驻多 agent 平台。[OAN-adaptation][OAN-constraint]

### Chapter Contract Extensions

写作 skill 项目给“本章契约”补充了更具体的字段。[AwesomeNovelSkill-reference][OhAwesomeNovelSkill-reference][OhStoryClaudeCode-reference]

OAN `/规划下一章` 可在已有 InkOS chapter-intent 基础上补充轻量字段：

- chapter id / title candidate。
- 本章读者情绪目标。
- POV。
- 核心冲突或场景方向。
- 关键出场角色与状态前置。
- 涉及的伏笔操作：新增、推进、提及、回收、延后。
- 章尾必须发生的改变。
- 禁止事项。

更完整的字段应放到卷级或大纲级规划中，而不是默认每章必填：

- 冲突阶梯。
- 信息差变化。
- 场景序列或 8-12 个 key beats。
- 卷级角色成长段落与关系推进安排。
- 伏笔债清单与回收窗口。
- 关键章分布和卷末交付目标。
- `CBN / CPNs / CEN` 或类似结构化节点。

这些字段不要求一开始全部成为正式 schema；普通单章先保持短契约，复杂规范优先用于 `/规划大纲`、`/规划下一卷`、关键章规划，再根据实际写作体验固化。[WebnovelWriter-reference][OAN-adaptation]

### Planning Granularity

Webnovel Writer 的强 gate 和结构化节点提醒 OAN 需要区分规划粒度。[WebnovelWriter-reference]

建议新增或细化 quick commands：

- `/规划大纲`：面向全书或大阶段，适合使用读者承诺、主线 / 暗线、长期伏笔、角色成长段、卷级高潮等复杂规范。
- `/规划下一卷`：面向卷级推进，适合使用卷级 gate、时间线、关键章节点、伏笔债、读者期待和 CBN / CPNs / CEN 风格的拆章方法。
- `/规划下一章`：面向普通单章，默认只生成轻量本章契约；仅在用户要求“详细规划”或该章是关键章时启用结构化节点。
- `/写下一章`：只做短写前校准，避免把 planning 阶段的重规范重复压到 drafting 阶段。

这能把复杂规范留给真正需要结构控制的层级，同时保持日常写作低摩擦。[OAN-adaptation]

### Planning And Apply Gates

Webnovel Writer 的 `prewrite / precommit / postcommit` 适合转译为 OAN 的“按粒度启用的 gate”，而不是每章固定三关。[WebnovelWriter-reference][OAN-adaptation]

建议口径：

- `/规划大纲` / `/规划下一卷`：可以运行增强 planning gate，检查结构充分性、时间线、伏笔债、关键节点、读者承诺、禁区和卷级节奏。
- 关键章：可以启用增强 chapter gate，检查是否会写崩核心设定、时间线、信息差、伏笔回收或卷级高潮。
- 普通单章：只保留轻量写前校准，不把完整 gate 流程压到 drafting 阶段。
- Apply 前：检查 settlement bundle 是否有 evidence、是否触达预期文件、是否存在 unresolved ambiguity 或 user decision。
- Accept 后：做轻量 postaccept check，确认 Object File Tree 已更新；如果 projection 能力已启用，确认派生 projection 可重建；确认 auto-commit 是否成功，若配置关闭或提交失败，再提示 dirty state 和 quick commit 入口。

这条和 OAN 的 PendingAction / Apply Engine / Git diff 工作流兼容；它不要求新增 `.story-system`、投影状态五件套或独立提交链。[OAN-constraint][WebnovelWriter-reference]

### Pre-Write Calibration

`novel-writer-skills` 的 `/write` 强制读取顺序和写前 checklist 很适合 OAN 的 `/写下一章`。[NovelWriterSkills-reference]

OAN `/写下一章` 的写前校准表应默认保持短小，只合并这些必要来源：

- 已读取上下文：source id、文件路径、工具结果、读取理由。
- 本章契约复述：目标、冲突、情绪、POV、章尾变化。
- 必须兑现：hook id、状态变化、读者期待。
- 暂不暴露：秘密、底牌、未到时机的设定。
- 风险检查：OOC、信息越界、世界规则冲突、战力或资源异常、AI 味高危点。
- 写入方式：正文只能通过 `chapter.createDraft` 创建 PendingAction。

这与 InkOS `PRE_WRITE_CHECK` 和 StoryForge chapter context recipe 是同一个方向，应统一实现，而不是分成多个检查表。但它不应变成每章完整 planning gate；复杂检查应交给 `/规划大纲`、`/规划下一卷` 或关键章详细规划。[InkOS-reference][StoryForge-reference][NovelWriterSkills-reference][OhStoryClaudeCode-reference][WebnovelWriter-reference][OAN-adaptation]

### Settlement Artifacts

Webnovel Writer 的 `fulfillment_result / disambiguation_result / extraction_result` 可转译为 OAN 的 settlement bundle 分层。[WebnovelWriter-reference]

OAN `/整理本章` 或写章后的 settle 阶段可明确输出：

- `fulfillment`：本章契约 / 卷级节点中哪些已覆盖、哪些遗漏、哪些额外生成。
- `ambiguities`：新增名词、别名、角色身份、地点归属、信息边界或低置信推断，需要用户确认。
- `observations`：正文证据支持的角色状态、关系、时间、地点、物品、世界规则、伏笔和场景变化。
- `patches`：由 observations 转成的 PendingAction / SemanticPatch 候选。

这与 InkOS 的 evidence-only settlement、StoryForge 的 state diff 和 OAN Apply Engine 是同一个方向。关键边界：settlement bundle 不是事实源，只有用户接受后的 Object File Tree 变更才是事实。[InkOS-reference][StoryForge-reference][WebnovelWriter-reference][OAN-adaptation]

### Minimal Memory Package

`oh-story-claudecode` 的最简记忆包可作为 OAN `context-package` 的一个明确字段。[OhStoryClaudeCode-reference]

OAN 可定义：

- 角色状态：只保留本章涉及角色的最新身份、能力、关系、公众形象。
- 相关伏笔 / 前史：只保留本章会写错的因果信息。
- 世界约束：只保留本章涉及的规则、地点、能力或社会限制。
- omitted：说明哪些信息被排除，因为与本章无直接因果关系。

判断标准可以写成一句话：只保留“不知道这个，本章会写错”的信息。[OAN-adaptation]

这不替代 StoryForge 的 source id / budget layer，也不替代 InkOS 的 protected / compressible / excluded。它是三者之上的写作任务压缩视图。[InkOS-reference][StoryForge-reference][OhStoryClaudeCode-reference]

### Reference Loading Map

Webnovel Writer 的 reference loading map 提醒 OAN：写作知识和参考材料应按阶段读取，而不是一次性塞满 prompt。[WebnovelWriter-reference]

OAN 可吸收为轻量“资料读取地图”：

- `/规划大纲`：初次生成时读取 constitution、workflow、长期方向、已有摘要、当前状态和参考作品 distilled notes；修订已有大纲时再读取现有总纲、卷级摘要、长期伏笔。
- `/规划下一卷`：读取上一卷摘要或上一阶段摘要、当前状态、活跃伏笔、角色成长线、时间线和必要世界规则。
- `/规划下一章`：初次生成时读取上一章结尾、当前 workflow / constitution 摘要、相关角色、最新状态和 active hooks；修订已有章节计划时再读取已有本章契约。
- `/写下一章`：读取本章契约、上一章结尾、minimal-memory 和必要风格约束。
- `/审稿`：读取正文、契约、状态、时间线、角色卡、世界规则和伏笔。
- `/整理本章`：读取正文和本章契约，但不能用未发生的大纲内容补事实。

长 reference 或参考项目资料只能以 section / distilled summary 进入 context package，并标注 source id、读取理由和是否进入 prompt。原文 source 默认不进入写作 prompt。[OAN-adaptation]

### Reading Power Soft Signals

Webnovel Writer 的 Strand / 追读力分类适合作为 OAN 的软指标，不应成为硬模板。[WebnovelWriter-reference]

可吸收为规划和审稿提示：

- 当前章或当前卷的 dominant strand：主线推进、情感 / 关系、世界观 / 阵营扩展。
- 最近是否长期缺少某条线。
- 章尾 hook 类型和强度。
- 本章是否有微兑现、情绪钩、选择钩、渴望钩。
- 爽点 / 情绪点是否有铺垫、释放、反应和衔接。

这些指标适合用于 `/规划下一卷`、关键章规划和 `/审稿`，不应硬编码为每章阻断条件。[OAN-adaptation]

### De-AI Protection Rules

`awesome-novel-skill` 和 `oh-story-claudecode` 都强调去 AI 味不能破坏剧情功能。[AwesomeNovelSkill-reference][OhStoryClaudeCode-reference]

OAN `/去AI味` 应明确：

- 只改表达，不改剧情事实。
- 不删除伏笔、钩子、角色特征、关键信息或必要转折。
- 不把“更文学”当作默认目标，优先符合当前作品风格。
- 输出修改理由和风险点。
- 正文替换仍通过 PendingAction。

这条应作为 `/去AI味` 的硬保护规则，避免“修文风”时把可结算事实或后续钩子删掉。[OAN-adaptation]

### Review Findings Schema

`oh-story-claudecode` 的审稿报告格式和 `novel-writer-skills` 的分析命令都支持把审稿从泛泛建议变成可执行问题列表。[OhStoryClaudeCode-reference][NovelWriterSkills-reference]

OAN `/审稿` 可统一 findings schema：

- severity。
- category。
- location。
- evidence。
- issue。
- suggested fix。
- whether needs user decision。

这与 StoryForge 的 review-to-revision loop 不冲突：OAN 默认只输出报告；用户确认后，才把指定 finding 转成 `chapter.createDraft` 或 SemanticPatch。[StoryForge-reference][OAN-adaptation]

### Reference Deconstruction Layer

`oh-story-claudecode` 的 `story-long-analyze` 和 `story-import` 提醒 OAN：参考作品不应只是一段聊天里的“对标”，应成为可查询的 reference bundle。[OhStoryClaudeCode-reference]

OAN 可吸收为 task 0900 的方向：

- 用户提供合法持有或有权使用的参考文本。
- 先生成 quick preview，再决定是否全量拆解。
- 拆解产物包括章节摘要、剧情聚合、角色/关系/设定观察、文风 profile、场景技法和 distilled summary。
- 写作时只召回结构、节奏、文风观察，不复制桥段或表达。
- 原文 source 默认不进入 prompt。
- reference-derived adoption 必须生成 PendingAction / diff，由用户确认。

这与 StoryForge chunk import 和 InkOS style/import workflow 可以合并为一个 OAN reference deconstruction layer，当前落点是 `docs/tasks/0900.md`。[StoryForge-reference][InkOS-reference][OhStoryClaudeCode-reference][OAN-adaptation]

Webnovel Writer 的 deconstruction-agent 进一步补充了防污染字段，可纳入 task 0900 的目标 schema：[WebnovelWriter-reference]

- `borrowable_patterns`：可迁移的读者承诺、开篇钩子、爽点循环、压力模型、节奏结构和题材兑现方式。
- `do_not_copy`：不能复制的角色、地名、组织、金手指、剧情事实、表达方式。
- `differentiation_requirements`：必须如何换题材、人物关系、能力机制、情绪方向或冲突舞台。
- `canon_contamination_warnings`：候选内容与参考作品过近时必须提醒用户。
- `quality` / `coverage`：拆解置信度、覆盖范围和是否需要补材料。

参考拆解结果只能作为候选创意和写作知识，不能自动写入世界观、角色卡、时间线或伏笔事实。[OAN-adaptation]

### Run Resume And Author Report

Webnovel Writer 的 run ledger 与 user report 可以转译为 OAN 的轻量 session recovery 和作者报告。[WebnovelWriter-reference]

OAN 可吸收：

- 每次长任务记录关键输入 source、输出 artifact、hash、时间和 proposed patch list。
- 如果用户手改了章节或对象文件，下一轮先询问沿用手改、基于手改继续，还是放弃旧草稿。
- 不自动覆盖作者手改，不用旧 artifact 伪装成新结果。
- 最终报告面向作者，固定说明总状态、产生的候选产物、未决问题、自动处理事项和下一步。
- 技术日志可以保存在 shadow / session 区，最终回复不直接输出原始 JSON、traceback 或长命令日志。

这不需要 OAN 引入复杂 run ledger 数据库；第一版可以落在 `.workspace` shadow metadata 或 session artifact。[OAN-adaptation]

### Project Health And Guardrails

Webnovel Writer 的 Doctor、只读 Dashboard 和轻量 hook 适合转译为 OAN 的项目健康检查与 guardrail。[WebnovelWriter-reference]

OAN 可吸收：

- 只读 project health panel：缺失角色卡、未整理章节、active hooks、最新状态过期、时间线断层、未处理 PendingAction。
- 只读 Inspector / Dashboard：从 Object File Tree 和可重建 projection 展示项目状态，不承担事实写入。
- 会话开始时显示 workspace status 或 pending action summary。
- guardrail 阻止 agent 绕过 PendingAction 直接写真实目标文件。

不应吸收：

- hook 自动整理、自动写摘要、自动提交事实。
- Dashboard 静默修改 canon。
- 以 read-model / cache 作为事实源。

### Filesystem-First Confirmation

Webnovel Writer v7 Story Repo 草案与 OAN 当前方向高度同频：文件即真相、`.cache` 可丢弃、接受一章是原子 commit、不在 VCS 里再造 VCS。[WebnovelWriter-reference]

这不改变 OAN 架构，但提供外部印证：

- 继续坚持 Git 是历史引擎。
- 继续坚持 Markdown / YAML Object File Tree 为事实源。
- 继续坚持派生 projection 可删除重建。
- 继续坚持接受章节时做 evidence-based settlement。
- 不采用 Webnovel Writer v6 的 `.story-system` 平行提交链作为 OAN 核心。

OAN 也不需要照搬 Webnovel Writer v7 的中文目录命名或完整 Story Repo spec；保留 OAN 自己的 filesystem spec 即可。[OAN-adaptation]

## Proposed OAN Agent Writing Loop vNext

以下是综合 OAN 当前边界与 InkOS、StoryForge、SillyTavern、Webnovel Writer 和写作 skill 项目启发后的候选升级方向，不代表已实现。[OAN-adaptation][InkOS-reference][StoryForge-reference][SillyTavern-reference][WebnovelWriter-reference][AwesomeNovelSkill-reference][NovelWriterSkills-reference][OhAwesomeNovelSkill-reference][OhStoryClaudeCode-reference]

### 1. Intake

判断用户意图：

- 讨论/咨询：直接回答。
- 规划：进入 chapter intent。
- 写正文：必须先 observe + plan/intent。
- 审稿：只读和报告，除非用户要求改写。
- 整理/结算：读取已采纳正文，生成 observation log 和 PendingAction bundle。
- 改状态/伏笔/角色：先读对应事实源，再生成 PendingAction。
- 进入 Play：切换到独立 Play Mode，读取 Play 起点、角色、世界规则和当前状态；Play 结果默认只进入 Play session，不直接改事实源。
- 使用参考作品：进入 reference context selector，只读取已启用 reference 的 distilled summary；原文 source 默认不进 prompt。[OhStoryClaudeCode-reference][OAN-adaptation]
- 快速推进模式：可以降低交互摩擦，但仍必须走 PendingAction / diff / Human Approval，不允许直接写真实文件。[AwesomeNovelSkill-v3-reference][OAN-constraint]

### 2. Observe

基础读取：

- `workflow.get`
- `constitution.get`
- `summary.get`
- `state.get`
- `timeline.list`
- `foreshadow.list`

条件读取：

- 涉及角色：`character.list` / `character.get`
- 涉及设定：`world.search`
- 续写、审稿、整理、改写：`chapter.get`

轻量 source discipline：

- 每个被读取的材料应在 `context-package` 中有 source id、文件路径、读取理由和预算层级。
- 不默认全量读取；先读核心必需材料，再按任务相关性补读角色、世界、时间线、伏笔、风格和参考资料。
- 未读取但可能相关的材料，应进入 omitted 列表，避免 agent 假装知道。
- 对当前章节生成 `minimal-memory`：只保留“不知道这个，本章会写错”的角色状态、相关伏笔/前史和世界约束。[OhStoryClaudeCode-reference][OAN-adaptation]
- 如果读取 reference，只记录 distilled source；若用户显式要求读原文，必须说明原因和范围。[OhStoryClaudeCode-reference][OAN-adaptation]

### 3. Plan

按任务粒度选择规划强度：

- `/规划大纲`：生成故事级 planning packet，覆盖读者承诺、主线 / 暗线、长期伏笔、角色成长段、卷级高潮和关键回收窗口。
- `/规划下一卷`：生成卷级 planning packet，覆盖卷级目标、时间线、关键章分布、伏笔债、读者期待、角色成长段和必要结构化节点。
- `/规划下一章`：默认生成轻量本章契约，只包含 chapter id / title candidate、当前任务、POV、核心冲突或场景方向、出场角色、涉及 hook、章尾变化和禁止事项。
- 关键章或用户要求详细规划时，才启用冲突阶梯、信息差变化、8-12 个 key beats、`CBN / CPNs / CEN` 或类似结构化节点。

规划产物只作为写作前中间产物或 session artifact，不自动成为长期事实源。[WebnovelWriter-reference][OAN-adaptation]

### 4. Compose

生成或内部维护 context package：

- selected files。
- source ids。
- protected context。
- compressed context。
- excluded context。
- L0 / L1 / L2 / L3 budget layer。
- omitted sources。
- rule priority。
- risk notes。

第一版可以只作为 assistant 可见摘要或 session artifact，不必立刻设计成正式事实源。

### 5. Draft

写正文前输出短 `PRE_WRITE_CHECK`：

- 本章契约对齐。
- 上下文范围。
- 当前锚点。
- 待处理 hooks。
- 暂不暴露的秘密、底牌和设定。
- 风险扫描。
- 写入方式确认：只能通过 `chapter.createDraft` PendingAction。

然后才生成标题和正文草稿。普通单章不重复运行卷级 planning gate；正文写入只能通过 `chapter.createDraft` PendingAction。

### 6. Review

审稿默认不改正文，也不隐式进入 settlement。输出：

- severity。
- category。
- location。
- evidence。
- issue。
- suggested fix。
- whether needs user decision。
- blocking。
- dimension result：相关维度无问题时也显式 pass。

blocking issue 需要用户裁决或进入定点修复；非 blocking issue 可以进入修订候选。用户要求改写时，先确认要修哪些问题，再使用 `chapter.createDraft` 或 SemanticPatch 生成替换草稿 PendingAction。只有用户明确要求整理、落库或按审稿结果更新状态时，审稿结果才进入 settlement。[WebnovelWriter-reference][OAN-adaptation]

`/去AI味` 属于 review / revision 子类，必须遵守保护规则：只改表达，不改剧情事实，不删除伏笔、钩子、角色特征、关键信息或必要转折。[AwesomeNovelSkill-reference][OhStoryClaudeCode-reference][OAN-adaptation]

### 7. Settle

整理已接受或用户明确指定的章节时先输出 observation log，再生成 settlement bundle：

- fulfillment：本章契约或关键节点中哪些已覆盖、遗漏或额外生成。
- ambiguities：新增名词、别名、身份、地点归属、信息边界等待确认项。
- observations：正文证据支持的事实观察。
- chapter summary。
- state changes as diff：entity、field、oldValue、newValue、evidence、confidence。
- timeline events。
- foreshadow changes。
- character card scoped updates。
- next chapter handoff。
- unresolved ambiguity。

所有写入仍是 PendingAction。`next chapter handoff` 和 `unresolved ambiguity` 默认进入 settlement report 或 session artifact；除非用户确认，不直接写入事实源。

### 8. Verify

结束前检查：

- 必要上下文是否已读取。
- 输出是否满足用户请求。
- context package 是否记录 selected / omitted source。
- 长任务或需要续跑的 session artifact 是否记录关键输入 source、输出 artifact、proposed patch list、时间和未决问题。
- PendingAction 触达文件是否符合计划。
- 没有直接写真实目标文件。
- 证据不足处是否明确标出。
- 如果用户已接受 PendingAction，运行轻量 postaccept check：确认相关对象文件已更新；如果 projection 能力已启用，确认派生 projection 可重建；确认 auto-commit 是否成功，若配置关闭或提交失败，再提示 dirty state 和 quick commit 入口。
- 最终报告说明总状态、产生的候选产物、未决问题和下一步，不直接输出原始技术日志。

## Candidate Additions And Source Attribution

| Candidate | Type | Source | OAN status |
| --- | --- | --- | --- |
| 本章契约 `chapter-intent` | Add | InkOS chapter memo / plan idea + AwesomeNovelSkill chapter memo + OhAwesomeNovelSkill chapter loop + OhStoryClaudeCode detail outline | Accepted direction; not implemented |
| 普通单章轻量契约字段：POV、核心冲突、章尾改变 | Modify | AwesomeNovelSkill chapter outline + OhStoryClaudeCode long-write outline | Accepted direction; not implemented |
| 卷级 / 关键章增强字段：冲突阶梯、信息差、关键 beats、CBN / CPNs / CEN | Modify | Webnovel Writer write-gate / CBN-CPNs-CEN + AwesomeNovelSkill chapter outline + OhStoryClaudeCode long-write outline | Accepted direction; not implemented |
| `context-package` / `rule-stack` / `trace` | Add | InkOS plan/compose artifacts + StoryForge context assembly + NovelWriterSkills pre-write file checklist | Accepted direction; not implemented |
| `minimal-memory` 最简记忆包 | Add | OhStoryClaudeCode state-tracking protocol | Accepted direction; not implemented |
| 轻量 context source discipline，不新增重型 registry | Add | StoryForge `CONTEXT_SOURCES` idea | Accepted direction; not implemented |
| `protected / compressible / excluded` 语义分层 | Add | InkOS context governance | Accepted direction; not implemented |
| `L0 / L1 / L2 / L3` 预算层级 | Add | StoryForge context budget | Accepted direction; not implemented |
| `/写下一章` 前置 `PRE_WRITE_CHECK` / 写前校准表 | Modify | InkOS writer pre-write check + StoryForge chapter recipe + NovelWriterSkills write checklist + OhStoryClaudeCode daily workflow | Accepted direction; not implemented |
| 写前默认读档策略：核心必读 + 条件补读 | Modify | StoryForge chapter context recipe + NovelWriterSkills read order + OhStoryClaudeCode status filter | Accepted direction; not implemented |
| 状态驱动单 agent harness | Add | AwesomeNovelSkill v3 SOLO / state-driven loop + OhAwesomeNovelSkill lightweight single-agent workflow | Accepted direction; not implemented |
| `/规划大纲` / `/规划下一卷` 卷级规划入口 | Add | Webnovel Writer plan workflow + OAN user feedback | Accepted direction; not implemented |
| 复杂 gate 与结构化节点默认用于卷级 / 大纲级，普通单章轻量化 | Modify | Webnovel Writer write-gate / CBN-CPNs-CEN + OAN user feedback | Accepted direction; not implemented |
| 按粒度启用 planning/apply/postaccept gates | Add | Webnovel Writer write-gate + OAN Apply Engine | Accepted direction; not implemented |
| `/整理本章` 先 observation log 后 PendingAction bundle | Modify | InkOS Observer / settlement pattern + StoryForge settlement objects + AwesomeNovelSkill updater archive + OhAwesomeNovelSkill archive memory update | Accepted direction; not implemented |
| settlement bundle 拆分 fulfillment / ambiguities / observations / patches | Modify | Webnovel Writer data-agent artifacts + InkOS evidence-only settlement + StoryForge state diff | Accepted direction; not implemented |
| 状态变化以 diff 表达：old/new/evidence/confidence | Modify | StoryForge state diff + OAN Apply Engine | Accepted direction; not implemented |
| 伏笔 mention / advance / resolve / defer 分级 | Modify | InkOS hookOps discipline + AwesomeNovelSkill / OhStoryClaudeCode hooks update | Accepted direction; not implemented |
| evidence-only settlement 规则 | Modify | InkOS settler constraints + AwesomeNovelSkill updater archive + OhStoryClaudeCode tracking update + OAN human approval | Accepted direction; not implemented |
| settlement report 增加 next handoff / unresolved ambiguity | Add | StoryForge settlement extension + Webnovel Writer disambiguation artifact | Accepted direction; not implemented |
| 审稿 checklist 固定化 | Modify | InkOS continuity audit dimensions + StoryForge review dimensions + NovelWriterSkills analyze + OhStoryClaudeCode story-review | Accepted direction; not implemented |
| 审稿 findings schema / dimension pass / blocking | Add | OhStoryClaudeCode story-review + NovelWriterSkills analyze + Webnovel Writer reviewer schema | Accepted direction; not implemented |
| 审稿报告到修订 patch 的二段确认闭环 | Add | StoryForge review-to-revision flow | Accepted direction; not implemented |
| `/去AI味` 保护规则 | Modify | AwesomeNovelSkill anti-ai + OhStoryClaudeCode story-deslop | Accepted direction; not implemented |
| 状态/伏笔/时间线 Markdown projections | Add | InkOS Markdown projection idea | Accepted direction; not implemented |
| AI-readable context snapshot 作为派生索引 | Add | StoryForge context snapshot | Accepted direction; not implemented |
| capability id / prompt provenance / generated manual | Add | StoryForge PromptModuleKey and AI manual | Accepted direction; not implemented |
| run log 记录 capability、context package、patch 和 token usage | Add | StoryForge aiUsageLog + Webnovel Writer run ledger | Accepted direction; not implemented |
| session resume：根据输入/输出 artifact 判断续跑边界 | Add | Webnovel Writer run ledger | Accepted direction; not implemented |
| 作者友好最终报告 | Add | Webnovel Writer user-report | Accepted direction; not implemented |
| reference loading map / 资料按阶段读取 | Add | Webnovel Writer reference-loading-map + StoryForge source discipline | Accepted direction; not implemented |
| Strand / 追读力软指标 | Add | Webnovel Writer strand-weave / reading power taxonomy | Accepted direction; not implemented |
| 只读 project health panel / Inspector / guardrail | Add | Webnovel Writer doctor/dashboard/hooks + OAN Human Approval | Accepted direction; not implemented |
| 独立 Play Mode / Roleplay Sandbox | Add | SillyTavern roleplay workflow + InkOS Play | Accepted direction; not implemented |
| 多角色 roleplay runtime：单一世界裁判 + 多角色 voice/state modules | Add | SillyTavern group chat / WorldInfo + OAN runtime constraint | Accepted direction; not implemented |
| Play context activation / lorebook source trace | Add | SillyTavern WorldInfo / lorebook activation | Accepted direction; not implemented |
| Import Tavern-compatible Character Card 接入 OAN 角色卡体系 | Add | SillyTavern character card ecosystem | Accepted direction; separate spec drafted |
| 导入已有小说采用 chunk + rolling context + pending adoption | Add | InkOS import/continuation + StoryForge import pipeline | Accepted direction; not implemented |
| 参考作品拆解 / reference deconstruction layer | Add | OhStoryClaudeCode story-long-analyze/story-import + StoryForge import pipeline + InkOS import/style workflow + Webnovel Writer deconstruction-agent | Accepted direction; task 0900 planned |
| 参考拆解防污染字段：do_not_copy / differentiation / contamination warnings | Add | Webnovel Writer deconstruction-agent | Accepted direction; task 0900 planned |
| reference context selector：只召回 distilled technique notes | Add | OhStoryClaudeCode 对标 / 文风召回 + OAN task 0900 | Accepted direction; task 0900 planned |
| 长任务 resumable session 写入 shadow / pending 区 | Add | StoryForge stream session persistence + Webnovel Writer run ledger | Accepted direction; not implemented |
| filesystem-first / cache 可重建 / Git 历史原则外部印证 | Confirm | Webnovel Writer v7 Story Repo RFC + OAN architecture | Accepted direction; already OAN principle |

## Not Adopted From Reference Projects

以下参考项目能力不应进入 OAN，除非未来架构文档明确改变方向。[OAN-constraint][InkOS-reference][StoryForge-reference][SillyTavern-reference][WebnovelWriter-reference][AwesomeNovelSkill-reference][OhStoryClaudeCode-reference]

- 自主多 agent runtime。
- 固定多 agent 写作流水线作为 OAN 默认路径。
- 强制每个写章阶段必须调用固定 subagent。
- 每章默认强制完整 `prewrite / precommit / postcommit` gate、完整写作任务书或 `CBN / CPNs / CEN` 节点。
- 后台 daemon 自动写作。
- 直接写真实小说文件或直接写数据库作为最终持久化路径。
- `.story-system` 平行提交链作为 OAN 核心事实层。
- `.webnovel` / SQLite / vector read-model 作为 OAN 核心状态层。
- 复杂 projection chain 失败后阻断整个写作链作为第一版默认机制。
- SQLite / memory.db / IndexedDB 作为小说事实源。
- 自动无限修订闭环。
- 跳过 Human Approval 的批量状态更新。
- agent 起草、审稿或整理阶段自动备份 / 自动 commit。
- “快速推进模式”跳过 PendingAction / Git diff / Human Approval。
- 浏览器端直接保存 provider key 作为 OAN 主方案。
- localStorage context memo 作为可信来源。
- 重型 Context Source Registry runtime；当前只吸收轻量 source discipline。
- 大型 CSV 路由、RAG rerank、动态题材裁决引擎作为 OAN 第一版默认能力。
- 每章默认强制拆文、对标、文风召回。
- 参考作品原文默认进入写作 prompt。
- 参考作品角色、世界观、时间线或伏笔自动写入当前小说 truth files。
- 为了去 AI 味删除剧情事实、伏笔、钩子、角色特征或必要转折。
- 复制参考项目实现代码、prompt 原文或 UI 文案。

## Future Reference Merge Checklist

后续阅读其他参考项目时，新增建议应按以下格式进入本文档或后续总整理文档：

```text
Candidate:
Type: Add / Modify / Reject / Open Question
Source: Reference project name
OAN boundary check:
Target artifact:
Status: Candidate / Accepted / Rejected / Superseded
Notes:
```

每个建议至少回答：

- 它解决 OAN agent 写作指引里的哪个缺口？
- 它来自哪个参考项目？
- 是否违背 filesystem-first、Human Approval、Aider-style runtime？
- 它应该落在 skill prompt、workflow 文件、session artifact、tool contract，还是正式小说事实源？
- 需要新增工具，还是只需要修改 agent 指引？

## Related Files

- `packages/core/src/novel-copilot-skill.ts`
- `docs/NOVEL_AGENT_COPILOT_SPEC.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/HUMAN_APPROVAL_AND_GIT.md`
- `docs/INKOS_REFERENCE_OVERVIEW.md`
- `docs/INKOS_REFERENCE_LESSONS.md`
- `docs/STORYFORGE_REFERENCE_OVERVIEW.md`
- `docs/STORYFORGE_REFERENCE_LESSONS.md`
- `docs/NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md`
- `docs/WEBNOVEL_WRITER_REFERENCE_OVERVIEW.md`
- `docs/WEBNOVEL_WRITER_REFERENCE_LESSONS.md`
- `docs/tasks/0900.md`
- `docs/IMPORT_TAVERN_COMPATIBLE_CHARACTER_CARD.md`
- `reference-only/inkos/README.md`
- `reference-only/inkos/packages/core/src/agents/writer-prompts.ts`
- `reference-only/inkos/packages/core/src/agents/settler-prompts.ts`
- `reference-only/storyforge/README.md`
- `reference-only/storyforge/src/lib/registry/context-sources.ts`
- `reference-only/storyforge/src/lib/registry/assemble-context.ts`
- `reference-only/storyforge/src/components/editor/ChapterEditor.tsx`
- `reference-only/storyforge/src/lib/registry/adoption-schema.ts`
- `reference-only/awesome-novel-skill/SKILL.md`
- `reference-only/novel-writer-skills/templates/commands/write.md`
- `reference-only/oh-awesome-novel-skill/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-analyze/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-import/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-review/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-deslop/SKILL.md`
- `reference-only/webnovel-writer/README.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-plan/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-write/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/agents/deconstruction-agent.md`
