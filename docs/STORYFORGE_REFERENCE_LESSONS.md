# StoryForge 可吸收点候选清单

> 状态：候选参考笔记，不是 OAN 架构规范或实施计划。
>
> 当前基准：`reference-only/storyforge` 已检出 `main@f3316b119175ce1f630f8fc5469cd5cab5a009ca`（2026-07-31），并与 `origin/main` 一致；最新功能提交为 `efe8f04`（2026-07-27）。
>
> 配套现状分析：`docs/STORYFORGE_REFERENCE_OVERVIEW.md`。
>
> 约束：本文不会自动修改 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`。只有用户明确确认的条目，才能以 `[StoryForge]` 来源标记合并到 OAN 的正式参考笔记、task 或 plan。

## 本轮更新纠正了什么

上一版以 `f0389bb`（2026-06-19）为基准，已经不足以描述当前 StoryForge。本轮需要明确修正以下判断：

- StoryForge 已经不只是 Panel / Prompt Workflow；它已有单一前台主 Agent、只读 AgentRunner、固定五领域调度、可恢复候选和独立 Node Mode。
- “完整 settlement 尚未落地”已经过时；显式“整理本章”已能一次生成六类候选，并支持逐字证据、正文 hash、逐项选择和分领域采纳。
- 长篇一致性已经扩展到章节记忆、时序事实、角色知识、世界宪法、故事线进度、层级摘要和历史修改影响分析。
- RAG 已有可见资料目录、稳定资料 ID、字段策略和真实召回证据；但非章节资料仍不是全面向量检索。
- 参考分析已从单次覆盖升级为 active / ready / superseded 版本链，并带来源 hash、权利声明、失败隔离和引文回查。
- 模拟运行时已经有 append-only 事件、确定性骰子、回放、检查点和分支；但仍只是早期地基。
- StoryForge 当前许可证是 MIT。即便如此，OAN 仍应遵守自身 reference no-copy 约束，不直接复制其 prompt、源码结构、UI 文案或产品表达。

因此，本文件不再只罗列“StoryForge 有什么”，而是区分：OAN 已有但值得复核的能力、真正的新候选，以及明确不应进入 OAN 核心的部分。

## 吸收原则

StoryForge 不能作为 OAN 的直接架构模板。OAN 的稳定事实仍然是：

- filesystem-first。
- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 所有真实目标文件写入都必须经过人类确认。
- Runtime 学 Aider 的极简循环，并使用 Vercel AI SDK Tool Calling。
- 文件修改通过 `SemanticPatch + Apply Engine + PendingAction + Git diff` 完成。
- 不把固定领域编排扩张成重型多 Agent 平台。

吸收时应遵守四条转换规则：

1. 吸收产品纪律，不照搬 IndexedDB 表结构。
2. 吸收可见候选和证据，不绕过 PendingAction 写正式文件。
3. 吸收确定性校验，不引入隐藏自动修订循环。
4. 吸收派生索引和运行日志，不把它们提升为 Canon 真相源。

## 建议优先级

### P0：优先对照现有实现复核

这些能力与 OAN 当前方向高度一致。重点不是重新设计，而是检查现有 task、UI、schema 和 Apply Engine 是否已形成端到端闭环：

- 候选卡的真实上下文证据与预算。
- 六领域章节后整理及逐项确认。
- LLM finding 与确定性 Canon guard 分离。
- 参考分析版本的 active / ready 隔离。
- 可见资料目录、字段选择和最近实际召回。

### P1：核心闭环稳定后再增强

- Prompt provenance 与项目级覆盖。
- 审稿报告到局部 SemanticPatch 的闭环。
- 长篇导入、断点续跑和 source drift。
- 可恢复长任务与 AI run log。
- Play Mode 的事件连续性、检查点 hash 和分支校验。

### P2：只保留为产品形态参考

- 单一主 Agent 入口和候选依赖 UI。
- 自由节点画布。
- 固定五领域幕后调度。

这些形态可能改善交互，但不能反向决定 `packages/runtime` 的核心抽象。

## 候选吸收点

### 1. 建立稳定的 AI 能力与读写边界目录

来源：`PromptModuleKey`、AI usage category、AI Functions Manual、Tool Registry、Adoption Schema。

StoryForge 的真正价值不只是“功能很多”，而是逐步把 AI 能力、上下文入口、只读工具和结构化写回登记为可检查的注册表。OAN 可以把这一思想映射到 filesystem-first 架构：

- 为写作能力定义稳定 capability id，例如：
  - `novel.plan_story`
  - `novel.write_chapter`
  - `novel.continue_chapter`
  - `novel.review_chapter`
  - `novel.settle_chapter`
  - `novel.extract_observations`
  - `novel.update_timeline`
  - `novel.update_character_card`
- 每项能力声明允许读取的对象文件、可生成的中间产物、可提出的 patch 类型和确认要求。
- 从注册信息生成只读 manual，用检查保证文档与代码一致。
- 不为此建立第二套业务数据库；能力目录应描述现有 ToolSet、ContextPackage 和 Apply Engine 边界。

建议状态：保留为 P0 复核项，先盘点 OAN 已有能力，避免重复创建新抽象。

### 2. 把实际上下文、裁剪和预算变成候选证据

来源：`CONTEXT_SOURCES`、`assembleContext()`、主 Agent context profile、team budget、Node Run 证据。

旧版 lessons 只建议“建立 Context Source Registry”。当前更具体的启示是：作者应该看到某次候选实际读了什么，而不只是看到配置上允许读取什么。

OAN 可吸收方式：

- 继续以 Object File Tree 和 `ContextPackage.trace` 记录 selected / omitted / compressed。
- 在候选卡或运行详情中展示：
  - 实际包含的文件和对象。
  - 被省略或压缩的来源及原因。
  - token 预算和各层消耗。
  - 只读证据与 patch target 的区别。
  - 候选依赖了哪些尚未采纳的 non-Canon 产物。
- 当上下文不足时显式降级或阻止生成，不能让 Agent 假装读取过未加载资料。
- 保留 L0-L3 或等价优先级：章节目标、上一章结尾和最新状态不能先于增强资料被裁掉。

建议状态：P0。OAN 已有 trace 基础，重点复核 UI 与审计产物是否完整。

### 3. 将“整理本章”落实为六领域 SettlementBundle

来源：`chapter-organization.ts` 与显式“整理本章”入口。

StoryForge 当前一次整理会生成六类候选：

- 角色状态。
- 时序事实。
- 物品流水。
- 故事年表。
- 角色关系。
- 伏笔推进。

值得吸收的不是这六个 Dexie 写入器，而是其交互纪律：

- 每条候选绑定正文逐字证据。
- 整批候选绑定正文 SHA-256，正文变化后必须显示过期。
- 作者可按领域、逐项选择。
- 各领域分别记录 adopted / failed / skipped。
- 新批次失败不能破坏上一批有效数据。
- 事实候选不会因为“被整理出来”就自动升为 confirmed Canon。

OAN 应把这些约束映射到现有 `ObservationLog -> SettlementBundle -> PendingAction -> SemanticPatch -> Git diff` 流程。正文、状态、时间线、关系、伏笔和物品文件仍然分别形成可审查 patch，而不是一次性覆盖对象树。

建议状态：P0。旧版“完整 settlement 仍未落地”的表述作废。

### 4. 分离 LLM finding、闭集校验和 Canon 采纳

来源：一致性 Agent、Canon validator、temporal facts、knowledge ledger。

StoryForge 已把几类职责拆开：

- LLM 负责从正文提出 observation / finding，并给出引文。
- 代码验证引文、枚举、实体、范围和来源 hash。
- 物品重复获得、角色认知、存亡和部分时序冲突由确定性逻辑判断。
- finding 只进入报告或 candidate，不自动改正文，不直接成为 confirmed Canon。

OAN 可吸收方式：

- 对“正文中发生了什么”使用 observation-first schema。
- 对“是否违反已确认事实”使用 closed-set validator 和对象投影。
- 将证据不足、来源过期和时序不明作为可见 warning，而不是让模型自行补全。
- 确定性失败产生 repair candidate 或阻止采纳；不要隐藏调用模型自动重写。
- 报告、候选和 patch 都绑定源文件 hash / Git blob 身份，源文件变化后失效。

建议状态：P0。适合复核 OAN review、settlement 和 Apply Engine 之间的职责边界。

### 5. 为参考分析建立 active / ready 版本隔离

来源：`referenceAnalysisRuns`、`referenceAnalysisSources`、reference analysis lifecycle。

StoryForge 最新参考分析最值得借鉴的是版本纪律：

- 新分析 run 绑定文件 hash、深度、来源类别、权利声明和使用范围。
- 首版之外的新结果先进入 ready，不静默替换 active。
- 失败或取消不会破坏最后一个可用 active 版本。
- 作者显式激活、回滚或比较版本。
- 原文引文必须能回查来源块。
- 分析上下文只读取唯一 active run。

OAN 可吸收方式：

- 继续使用 filesystem-first run store、publication 和 accepted bundle。
- 给已接受参考包增加明确的 active pointer 或等价声明。
- 新 run 与旧 active 并存；source drift、失败和恢复不能覆盖已发布版本。
- 把来源声明、允许用途和 no-copy 限制写入 run / publication 元数据。
- 引文无法回查时，不允许进入正式 reference note。

建议状态：P0。复核现有 reference pipeline 是否已覆盖激活、回滚和失败隔离的 UI / 文件协议。

### 6. 提供可见资料目录与最近实际召回

来源：Visible RAG Library、`ragDocumentId`、`ragPolicy`、`ragSelection`。

StoryForge 没有另建第二份 Canon 文本表，而是给原业务记录分配稳定资料 ID 和字段级策略，再记录运行时实际召回。这比“后台有一个不可见向量库”更适合作者工具。

OAN 可吸收方式：

- 从 Object File Tree 派生可见资料目录，不复制真相内容。
- 允许作者选择记录、字段、启用状态、权重和预算上限。
- 在每次 run 中冻结实际 included / omitted / compressed 证据。
- 支持查看“最近哪些写作任务使用过这个资料”。
- 关键词、对象索引和精确字段选择应先于 embedding；embedding 只能是可删除重建的加速层。

建议状态：P0 / P1 之间。先做可见性和稳定 ID，再讨论向量化。

### 7. Prompt 作为可见且有 provenance 的项目资产

来源：Prompt Run Panel、prompt engine、prompt seeds、用户版本和临时覆盖。

OAN 可以吸收以下纪律：

- agent guide、genre / style pack、项目覆盖和临时要求分别记录来源。
- 每次 run 记录使用版本、变量、参数和用户补充，不只保存最终拼接字符串。
- 项目长期覆盖必须落到项目文件；临时覆盖只属于当前 run。
- good / bad examples 可以作为显式参考资产，但必须遵守来源和 no-copy 规则。
- 修改 prompt 不应绕过 task / plan 或悄然改变历史 run 的解释。

不建议把 Prompt Panel、Workflow 和 Runtime 合并为同一个执行核心。Prompt 是资产，ToolSet 是能力边界，Runtime 是循环，三者应保持分离。

建议状态：P1。

### 8. 写作流水线应产出可恢复的中间对象

来源：Prompt Workflow、GenerationNode、Node Run、主 Agent 候选事件。

章节创作不应只留下最终正文和聊天记录。一个可解释的流程可以包含：

1. 读取章节目标、上一章结尾、最新状态和相关对象。
2. 生成本章写作意图或约束卡。
3. 生成场景 / beat 候选。
4. 生成正文候选。
5. 生成章节后 SettlementBundle。
6. 生成 SemanticPatch 候选。
7. 用户通过 Git diff 确认应用。

每一步需要稳定产物名、来源 hash、状态和恢复入口。它们可以位于 workspace shadow / PendingAction 区，但不能偷偷成为正式小说对象。

建议状态：P1。使用现有 session artifacts，不另造通用 DAG runtime。

### 9. 审稿采用“报告 → 选择 → 修订 patch”闭环

来源：ReviewPanel、review adapter、一致性 Fast / Deep Audit。

OAN 可吸收方式：

- 审稿报告按逻辑、角色、设定、时序、认知、伏笔、节奏和文风分类。
- 每项 finding 带正文证据、关联 Canon 证据、严重度和置信度。
- 报告本身只读且绑定正文版本。
- 用户选择要处理的问题后，Agent 才生成局部 SemanticPatch。
- 修订稿必须经过 PendingAction 和 Git diff，不能由审稿调用直接覆盖正文。
- Fast / Deep 应表示上下文深度和预算，不应暗示更高层级拥有自动写入权限。

建议状态：P1。

### 10. 长篇导入采用分块、滚动上下文和版本化发布

来源：import pipeline、chunk writer、reference analysis resumability。

OAN 可吸收方式：

- 对已有小说或大型设定集切块并记录稳定 source hash。
- 逐块抽取角色、地点、规则、时间线、伏笔和章节摘要。
- 每 N 块做确定性合并、去重和冲突报告。
- 允许取消、续跑和 source drift 检测。
- 新分析先进入 run / pending publication，不直接写正式对象文件。
- 用户确认发布后，再由多个 SemanticPatch 建立 Object File Tree。

建议状态：P1。重点吸收恢复和版本隔离，不复制 StoryForge 的 Dexie chunk 表。

### 11. AI run log 应解释“为什么产生这个 patch”

来源：`aiUsageLog`、Agent conversations / events、Node runs。

Git 能说明文件发生了什么变化，但不能完整说明 AI 为什么提出变化。OAN 的 run log 可以记录：

- capability id、provider、model 和 token usage。
- agent guide / prompt provenance。
- ContextPackage id 与实际读取文件。
- observation、candidate 和 proposed patch 的关联。
- accepted / rejected / expired / failed 状态。
- 用户编辑候选的差异。
- 最终对应的 Git commit（如果采纳后自动提交）。

run log 属于审计与恢复信息，不是小说 Canon，也不能取代 Git 历史。

建议状态：P1。

### 12. 长任务需要可恢复 session，而不是只保存在组件内存

来源：流式 sessionKey、Agent event、Node Run、reference analysis resume。

OAN 可吸收方式：

- 长章节生成、导入、审稿和整理任务写入 workspace shadow / PendingAction。
- 页面关闭或崩溃后可以恢复输出、取消、重试或废弃。
- 恢复时重新验证源文件 hash，不能对已变化的目标直接继续采纳。
- 明确区分 provider 调用状态、候选状态和正式写入状态。

建议状态：P1。OAN 的 shadow recovery 已提供合适载体。

### 13. 模拟存档使用 append-only 事件与可验证检查点

来源：SIM-1A shared simulation runtime。

StoryForge 当前模拟运行时尚未形成完整产品，但其底层约束可作为 OAN Play Mode 的复核项：

- 事件序号严格连续。
- reducer 回放产生状态，不直接信任任意快照。
- 随机结果由 session seed、事件序号、骰式和 nonce 确定。
- checkpoint 保存状态 hash，并可通过回放验证。
- 分支记录父会话和分叉序号。

OAN 可吸收的是验证方式，而不是表结构。它不能替代 OAN 已有的 branch-local knowledge、world referee、typed intervention、variant、settlement 和 Human Approval。

建议状态：P1，仅用于 Play Mode 存档协议复核。

### 14. 自动治理应跟随注册表和能力增长

来源：required tables、AI manual、AST architecture guard、source reachability、roadmap、agent context、Canon coverage 和 project metrics 检查。

StoryForge 快速扩张到 58 张表、45 个 Context Sources 和多种执行原语后，开始用自动检查维持边界。OAN 虽不应复制这种复杂度，但可以吸收“声明必须可验证”的原则：

- capability manual 与 ToolSet / schema 保持生成或测试一致。
- 所有正式写入路径都必须经过 Apply Engine，使用架构守卫防止旁路。
- task 状态、代码入口和测试覆盖之间建立检查。
- ContextPackage 的固定入口设置体积或预算回归检查。
- 每条 Canon 规则至少有一个可执行反例。
- 派生索引必须能从正式文件重建，并由测试证明不会反向覆盖真相文件。

建议状态：P0 / P1。应优先补在已有架构边界上，而不是先增加指标数量。

### 15. 单一主 Agent 入口可作交互参考，固定五领域团队不可作 runtime 模板

来源：ChatCopilotPanel、master orchestrator、team execution。

值得参考的产品体验：

- 用户只面对一个入口，不必理解内部能力目录。
- 计划、上下文、候选和依赖关系可见。
- 候选可编辑、拒绝、恢复和逐项确认。
- 下游可以显式依赖未采纳候选，但采纳顺序受约束。

不应吸收的实现方式：

- 世界、角色、灵感、大纲、正文固定五领域成为 OAN runtime 的硬编码 Agent 团队。
- 每轮最多五任务的主 Agent planner 取代 Aider-style 极简工具循环。
- 模型间自由协商、投票或长期后台自治。
- 为产品文案而引入复杂调度层。

OAN 应优先让一个 Runtime 通过明确 ToolSet 和 capability 完成工作；只有真实任务边界证明有必要时，才在应用层组合步骤。

建议状态：P2，只参考候选交互和依赖可见性。

### 16. Node Mode 只适合作为可选创作壳

来源：Node Flow / Node Run。

StoryForge 的自由节点具备 DAG 校验、局部执行、上游证据冻结和确认写回，这些是合理的产品能力。但它目前没有条件、循环、并行、插件、脏下游失效和主 Agent 自动建图，而且与 Prompt Workflow、AgentRunner 和主 Agent 并存。

OAN 若未来需要可视化流程，应满足：

- 节点只是现有 capability / ToolSet 的可视化组合。
- 运行产物仍进入 session artifact / PendingAction。
- 不为画布重新实现一套写入、重试、历史和权限系统。
- 不把 Node Mode 作为当前核心 Runtime 的前置依赖。

建议状态：P2，当前不进入核心开发优先级。

### 17. Context Snapshot 只能是可重建派生索引

来源：context snapshot、retrieval chunks、narrative summary nodes。

OAN 可生成 AI-readable snapshot 或层级摘要，但必须：

- 从正式对象文件确定性生成。
- 记录源文件 hash / Git identity 和生成时间。
- 源变化后显示 stale 并重新生成。
- 删除 snapshot 不影响项目真相。
- Agent run 记录使用了哪个 snapshot 版本。
- snapshot、embedding 和摘要都不能反向覆盖正式对象文件。

建议状态：P1，在真实上下文性能问题出现后再实现。

## 不建议直接吸收的部分

以下内容不应进入 OAN 的稳定核心：

- IndexedDB / Dexie 作为小说 Canon 数据库。
- 58 张表式领域生命周期和级联管理。
- `adopt()` 直接写数据库作为最终持久化路径。
- AI 后处理自动更新正式状态、记忆或对象文件。
- 浏览器端 provider secret 管理作为 OAN 主方案。
- localStorage、embedding、摘要、Agent event 或 checkpoint 成为可信真相源。
- 自定义严格 JSON Agent 协议替代 Vercel AI SDK Tool Calling。
- 固定五领域多 Agent 调度进入 `packages/runtime`。
- Panel、PromptWorkflow、NodeFlow、AgentRunner 和 Orchestrator 各自发展为独立核心 runtime。
- 自动 Canon retry、隐藏修订循环或未向作者解释的模型重试。
- 把“整理本章”设为无确认后台写入。
- 直接复制 StoryForge 的 prompt 原文、源码结构、UI 文案或产品表达。

StoryForge 的 MIT 许可证解决的是许可证授权问题，不会改变 OAN 的独立架构选择、reference no-copy 纪律和人类确认边界。

## 建议合并到 OAN 写作参考笔记的最小条目

如果用户后续明确确认，建议只把以下稳定、写作相关的条目追加到 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`，每条标注来源 `[StoryForge]`：

- `[StoryForge]` 每次写作候选应记录实际 included / omitted / compressed 上下文、预算和来源版本，不能只记录理论可读范围。
- `[StoryForge]` 写章节前应优先读取章节目标、上一章结尾、最新状态、相关角色、世界规则、伏笔、时间线和风格约束，并明确被省略的上下文。
- `[StoryForge]` 章节推进后应生成带正文证据和源 hash 的 SettlementBundle，至少覆盖状态、事实、物品、时间线、关系和伏笔。
- `[StoryForge]` 章节整理结果应按领域、逐项确认；事实观察不会因被抽取就自动成为 confirmed Canon。
- `[StoryForge]` LLM 负责提出带引文的 finding，确定性代码负责闭集校验和 Canon 冲突判断，两者都不得直接覆盖正文。
- `[StoryForge]` 参考分析的新 run 不应覆盖当前 active 版本；失败、取消、source drift 和回滚必须保持最后一个可用版本。
- `[StoryForge]` 审稿应走“报告 → 用户选择 → 修订 SemanticPatch → Git diff 确认”的闭环。
- `[StoryForge]` Prompt、agent guide、ContextPackage 和 run log 应保留 provenance，使每个 patch 的生成依据可追溯。

这些仍是候选内容。本文更新不会自动合并它们，也不会创建对应 task 或 plan。

## 主要证据路径

参考目录当前已检出最新 `main`，可直接阅读：

- `reference-only/storyforge/docs/roadmap/CAPABILITY-BASELINE.md`
- `reference-only/storyforge/docs/AUTHORING-PLATFORM-DESIGN.md`
- `reference-only/storyforge/docs/AGENT-RUNNER-DESIGN.md`
- `reference-only/storyforge/docs/AGENT-TOOL-REGISTRY-DESIGN.md`
- `reference-only/storyforge/docs/RAG-VISIBLE-LIBRARY.md`
- `reference-only/storyforge/docs/REFERENCE-ANALYSIS-EVOLUTION-DESIGN.md`
- `reference-only/storyforge/docs/SIM-RUNTIME-DESIGN.md`
- `reference-only/storyforge/src/lib/agent/runner.ts`
- `reference-only/storyforge/src/lib/agent/tool-registry.ts`
- `reference-only/storyforge/src/lib/agent/orchestrator.ts`
- `reference-only/storyforge/src/lib/agent/chapter-organization.ts`
- `reference-only/storyforge/src/lib/agent/consistency-agent.ts`
- `reference-only/storyforge/src/lib/registry/context-sources.ts`
- `reference-only/storyforge/src/lib/registry/assemble-context.ts`
- `reference-only/storyforge/src/lib/reference-analysis/pipeline.ts`
- `reference-only/storyforge/src/lib/reference-analysis/lifecycle.ts`
- `reference-only/storyforge/src/lib/retrieval/rag-library.ts`
- `reference-only/storyforge/src/lib/simulation/runtime.ts`

本文只吸收设计与现状判断。OAN 的正式实现仍应以自身 task、plan、Object File Tree、AI SDK ToolSet、SemanticPatch、PendingAction 和 Git diff approval 为准。
