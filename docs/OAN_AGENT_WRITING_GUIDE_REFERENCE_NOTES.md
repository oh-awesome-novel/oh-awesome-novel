# OAN Agent Writing Guide Reference Notes

Status: Reference Notes

本文档记录 `oh-awesome-novel` 自身 agent 写作指引的当前状态，以及从参考项目 InkOS、StoryForge 中可吸收的写作 workflow 经验。

后续还会继续阅读其他参考项目。因此本文档刻意保留来源标注，避免把不同项目的启发混在一起，也避免把“候选改进”误认为 OAN 已实现能力。

## Source Tags

后续新增或修改本文件内容时，建议在小节或条目后标注来源：

- `[OAN-current]`：来自 OAN 当前稳定文档或已存在代码。
- `[OAN-constraint]`：来自 OAN 的架构边界或产品原则。
- `[InkOS-reference]`：来自 `reference-only/inkos` 的参考项目观察。
- `[StoryForge-reference]`：来自 `reference-only/storyforge` 的参考项目观察。
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

当前 settle 规则：

- 章节完成、审稿或明确整理时，提出 settlement bundle。
- bundle 至少包括章节摘要、角色状态变化、时间线事件和伏笔更新。
- 证据不足时应说明无法确定，不编造事实。

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
- `/写下一章` 还没有要求 agent 在正文前输出写前校准表。
- 上下文选择还没有显式产出 `context-package`、`rule-stack`、`trace`。
- 上下文来源还没有轻量 source id、读取理由、预算层级和 omission 记录。
- agent capability / prompt provenance / run log 还没有形成可盘点目录。
- `/整理本章` 还没有要求先生成 observation log，再从正文证据生成状态增量。
- 伏笔推进、提及、回收、延后还没有区分得足够细。
- 审稿维度还没有稳定化为可复用 checklist。
- 状态、时间线、伏笔目前是事实源，但还缺少面向作者阅读的派生 projection 规范。

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

## Proposed OAN Agent Writing Loop vNext

以下是综合 OAN 当前边界与 InkOS、StoryForge 启发后的候选升级方向，不代表已实现。[OAN-adaptation][InkOS-reference][StoryForge-reference]

### 1. Intake

判断用户意图：

- 讨论/咨询：直接回答。
- 规划：进入 chapter intent。
- 写正文：必须先 observe + plan/intent。
- 审稿：只读和报告，除非用户要求改写。
- 整理/结算：读取已采纳正文，生成 observation log 和 PendingAction bundle。
- 改状态/伏笔/角色：先读对应事实源，再生成 PendingAction。

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

### 3. Plan

如果任务涉及下一章或较大剧情推进，生成本章契约：

- 当前任务。
- 场景序列。
- 可选 scene / beat 列表。
- 出场角色。
- 读者期待处理方式。
- 伏笔推进/回收/暂压。
- 章尾必须变化。
- 禁止事项。
- 预期 settlement 文件。

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

写正文前输出 `PRE_WRITE_CHECK`：

- 本章契约对齐。
- 上下文范围。
- 当前锚点。
- 待处理 hooks。
- 风险扫描。

然后才生成标题和正文草稿。正文写入只能通过 `chapter.createDraft` PendingAction。

### 6. Review

审稿默认不改正文。输出：

- findings by severity。
- evidence。
- suggested fix。
- whether rewrite is needed。

用户要求改写时，先确认要修哪些问题，再使用 `chapter.createDraft` 或 SemanticPatch 生成替换草稿 PendingAction。

### 7. Settle

整理章节时先输出 observation log，再生成 settlement bundle：

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
- run log 是否记录 capability id、guide version、read file list 和 proposed patch list。
- PendingAction 触达文件是否符合计划。
- 没有直接写真实目标文件。
- 证据不足处是否明确标出。

## Candidate Additions And Source Attribution

| Candidate | Type | Source | OAN status |
| --- | --- | --- | --- |
| 本章契约 `chapter-intent` | Add | InkOS chapter memo / plan idea | Accepted direction; not implemented |
| `context-package` / `rule-stack` / `trace` | Add | InkOS plan/compose artifacts + StoryForge context assembly | Accepted direction; not implemented |
| 轻量 context source discipline，不新增重型 registry | Add | StoryForge `CONTEXT_SOURCES` idea | Accepted direction; not implemented |
| `protected / compressible / excluded` 语义分层 | Add | InkOS context governance | Accepted direction; not implemented |
| `L0 / L1 / L2 / L3` 预算层级 | Add | StoryForge context budget | Accepted direction; not implemented |
| `/写下一章` 前置 `PRE_WRITE_CHECK` | Modify | InkOS writer pre-write check + StoryForge chapter recipe | Accepted direction; not implemented |
| 写前默认读档策略：核心必读 + 条件补读 | Modify | StoryForge chapter context recipe | Accepted direction; not implemented |
| `/整理本章` 先 observation log 后 PendingAction bundle | Modify | InkOS Observer / settlement pattern + StoryForge settlement objects | Accepted direction; not implemented |
| 状态变化以 diff 表达：old/new/evidence/confidence | Modify | StoryForge state diff + OAN Apply Engine | Accepted direction; not implemented |
| 伏笔 mention / advance / resolve / defer 分级 | Modify | InkOS hookOps discipline | Accepted direction; not implemented |
| evidence-only settlement 规则 | Modify | InkOS settler constraints + OAN human approval | Accepted direction; not implemented |
| settlement report 增加 next handoff / unresolved ambiguity | Add | StoryForge settlement extension | Accepted direction; not implemented |
| 审稿 checklist 固定化 | Modify | InkOS continuity audit dimensions + StoryForge review dimensions | Accepted direction; not implemented |
| 审稿报告到修订 patch 的二段确认闭环 | Add | StoryForge review-to-revision flow | Accepted direction; not implemented |
| 状态/伏笔/时间线 Markdown projections | Add | InkOS Markdown projection idea | Accepted direction; not implemented |
| AI-readable context snapshot 作为派生索引 | Add | StoryForge context snapshot | Accepted direction; not implemented |
| capability id / prompt provenance / generated manual | Add | StoryForge PromptModuleKey and AI manual | Accepted direction; not implemented |
| run log 记录 capability、context package、patch 和 token usage | Add | StoryForge aiUsageLog | Accepted direction; not implemented |
| 导入已有小说采用 chunk + rolling context + pending adoption | Add | InkOS import/continuation + StoryForge import pipeline | Accepted direction; not implemented |
| 长任务 resumable session 写入 shadow / pending 区 | Add | StoryForge stream session persistence | Accepted direction; not implemented |

## Not Adopted From Reference Projects

以下参考项目能力不应进入 OAN，除非未来架构文档明确改变方向。[OAN-constraint][InkOS-reference][StoryForge-reference]

- 自主多 agent runtime。
- 后台 daemon 自动写作。
- 直接写真实小说文件或直接写数据库作为最终持久化路径。
- SQLite / memory.db / IndexedDB 作为小说事实源。
- 自动无限修订闭环。
- 跳过 Human Approval 的批量状态更新。
- 浏览器端直接保存 provider key 作为 OAN 主方案。
- localStorage context memo 作为可信来源。
- 重型 Context Source Registry runtime；当前只吸收轻量 source discipline。
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
- `reference-only/inkos/README.md`
- `reference-only/inkos/packages/core/src/agents/writer-prompts.ts`
- `reference-only/inkos/packages/core/src/agents/settler-prompts.ts`
- `reference-only/storyforge/README.md`
- `reference-only/storyforge/src/lib/registry/context-sources.ts`
- `reference-only/storyforge/src/lib/registry/assemble-context.ts`
- `reference-only/storyforge/src/components/editor/ChapterEditor.tsx`
- `reference-only/storyforge/src/lib/registry/adoption-schema.ts`
