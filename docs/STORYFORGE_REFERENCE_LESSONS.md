# StoryForge 可吸收点候选清单

> 状态：候选参考笔记。  
> 约束：本文不会自动修改 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`。所有“可吸收点”都标记为来自 StoryForge，等待用户确认后，才能合并进 OAN 的 agent 写作指引参考笔记。  
> 基准：`reference-only/storyforge` 本地当前 HEAD `f0389bb`。

## 吸收原则

StoryForge 不能作为 OAN 的直接架构模板。OAN 的稳定事实仍然是：

- filesystem-first。
- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 真实目标文件写入必须经过人类确认。
- Runtime 学 Aider 的极简循环，不引入重型多 Agent 平台。
- 文件修改核心采用 SemanticPatch + Apply Engine。

因此，StoryForge 中可以吸收的是 **写作工作流组织方式、上下文编排纪律、Prompt 可见化、章节后结算对象、质量检查闭环和工程自检思想**。不能吸收的是 IndexedDB 作为主数据库、直接写库、浏览器端 provider secret 管理、无确认的后台自动改稿。

## 候选吸收点

### 1. 建立 OAN 自己的“AI 写作能力目录”

来源：StoryForge 的 `PromptModuleKey`、`aiUsageLog` category、`AI-FUNCTIONS-MANUAL.generated.md`。

StoryForge 把 AI 功能列成明确模块，例如起书、世界观、角色、大纲、章节正文、续写、润色、扩写、去 AI 味、伏笔生成、资料解析、状态抽取等，并能生成 AI functions manual。这能避免 prompt 和 AI 调用散落在代码里。

OAN 可吸收方式：

- 为 OAN agent 写作能力定义稳定 capability id，例如：
  - `novel.plan_story`
  - `novel.write_chapter`
  - `novel.continue_chapter`
  - `novel.revise_chapter`
  - `novel.settle_chapter`
  - `novel.extract_state`
  - `novel.update_timeline`
  - `novel.update_character_card`
  - `novel.review_chapter`
- 每个 capability 声明：
  - 允许读取的对象文件。
  - 允许生成的中间产物。
  - 允许提出的 SemanticPatch 类型。
  - 是否必须用户确认。
  - 是否产生日志。
- 生成一个只读 manual，用来盘点 OAN 当前 agent 能力和实际读写边界。

确认状态：待用户确认后，可写入 `OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`，来源标注为 StoryForge。

### 2. 把“读什么”做成 Context Source Registry

来源：StoryForge 的 `CONTEXT_SOURCES + assembleContext`。

StoryForge 最有价值的机制之一，是每个上下文来源都被注册成一个显式 source，带 scope、layer、budget、requirements 和 read 函数。AI 调用不是随手拼 prompt，而是先选择来源，再组装上下文。

OAN 可吸收方式：

- 为 Object File Tree 建立 OAN 版 context source registry。
- 每个 source 对应一个小说对象或派生索引，例如：
  - `projectBrief`
  - `worldview`
  - `worldRules`
  - `characters`
  - `characterCards`
  - `latestState`
  - `timeline`
  - `chapterOutline`
  - `detailedOutline`
  - `previousChapterEnding`
  - `foreshadowLedger`
  - `styleGuide`
  - `referenceNotes`
- 每次 agent 写作前输出一份 context package：
  - included sources。
  - omitted sources。
  - token budget。
  - 为什么读取这些文件。
  - 哪些文件只读，哪些文件可作为 patch target。

这可以直接增强 OAN agent 写作指引中的“什么时候读取什么”。

确认状态：待用户确认。

### 3. 引入 L0-L3 上下文层级和预算解释

来源：StoryForge 的 `context-budget.ts` 与 `assembleContext`。

StoryForge 把上下文分成：

- L0：不可裁剪的系统 / 手工输入。
- L1：核心任务上下文，如故事核心、章节大纲、上一章结尾。
- L2：扩展小说资产，如世界观、角色、伏笔、状态卡。
- L3：增强上下文，如引用资料、备忘、few-shot。

OAN 可吸收方式：

- 在 agent 写作指引中规定上下文优先级：
  - 写正文必须读 L1。
  - 涉及设定、角色、伏笔时按需读 L2。
  - 风格模仿、参考资料、历史记录放 L3。
- 当 token 不足时，agent 应先压缩或放弃 L3，再处理 L2，不能丢掉章节目标、上一章结尾和最新状态。
- context package 应记录被省略的来源，避免 agent 假装知道未读取内容。

确认状态：待用户确认。

### 4. 将 Prompt 变成可见、可版本化、可覆盖的资产

来源：StoryForge 的 `PromptRunPanel`、`prompt-engine.ts`、`prompt-seeds.ts`。

StoryForge 的 prompt 系统支持模板、变量、参数、good / bad examples、临时覆盖、另存用户版本。这个设计对小说写作很重要，因为不同作者对叙事节奏、文风、心理描写、对白密度的偏好差异很大。

OAN 可吸收方式：

- 将 OAN 的写作 prompt / agent 指令拆成可读模板，而不是隐藏在代码常量里。
- 在每次写作任务中保留 prompt provenance：
  - 使用了哪个 agent guide 版本。
  - 使用了哪个 genre / style pack。
  - 用户临时补充了什么写作偏好。
- 支持用户为某个项目覆盖局部写作规则，但覆盖结果应落到项目文件中，而不是隐藏在运行时状态。

确认状态：待用户确认。

### 5. Prompt Workflow 可转化为 OAN 的“写作流水线”

来源：StoryForge 的 `PromptWorkflow`、`WorkflowRunner`、`workflow-seeds.ts`。

StoryForge 的 workflow 是可暂停的 prompt chain。每一步有输入、输出、用户确认和 saveTarget。它不是完整 Agent runtime，但很适合整理“写小说时先产出什么中间产物，再进入下一步”。

OAN 可吸收方式：

- 定义 OAN 写作流水线，而不是只给 agent 一个“写下一章”的笼统请求。
- 典型章节流水线可以是：
  1. 读取章节目标、上一章结尾、最新状态、相关角色、相关伏笔。
  2. 生成本章写作意图卡。
  3. 生成场景 / beat 列表。
  4. 生成正文草稿。
  5. 生成章节后结算包。
  6. 生成 SemanticPatch 候选。
  7. 用户确认后应用。
- 每一步都应该有产物名和落盘位置，不能只在聊天上下文里消失。

确认状态：待用户确认。

### 6. 章节写作前的上下文配方可作为 OAN 默认读档策略

来源：StoryForge 的 `ChapterEditor` 章节生成上下文组合。

StoryForge 写正文时会读取章节大纲、详细大纲、世界观、故事核心、力量体系、Codex、创作规则、世界规则、历史、地点、伏笔、故事弧、情绪节拍、状态卡、引用资料、用户风格和上一章结尾。角色上下文被单独传入，以减少重复 token。

OAN 可吸收方式：

- 对“写新章节”规定默认读取顺序：
  1. 本章 outline / detailed outline。
  2. 上一章结尾和上一章摘要。
  3. 最新状态。
  4. 本章涉及角色卡。
  5. 本章涉及世界观 / 地点 / 规则。
  6. 本章可能触发的伏笔、故事线、时间线。
  7. 项目风格指南和禁忌。
  8. 用户临时指令。
- agent 必须在生成正文前列出“本章写作约束”，例如不能改变哪些设定、哪些人物此时不知道什么、哪些伏笔不能提前揭示。

确认状态：待用户确认。

### 7. 章节后结算应成为 OAN 的硬性步骤

来源：StoryForge 的 state diff、summary adapter、DATA-FLOW-MAP、AI-COPILOT-DESIGN。

StoryForge 当前已经实现了生成 / 续写后自动摘要和角色状态 diff；更完整的 settlement agent 还在设计中。这个方向非常适合 OAN，但需要按 OAN 的文件和确认机制重做。

OAN 可吸收方式：

- 正文推进后，agent 不能只交付正文，还应生成章节后结算包。
- 结算包至少包括：
  - 章节摘要候选。
  - 角色状态变化候选。
  - 地点 / 阵营 / 物品变化候选。
  - 时间线事件候选。
  - 伏笔 planted / echoed / resolved 候选。
  - 下一章衔接点。
  - 需要用户确认的疑点。
- 所有结算结果都应先作为 PendingAction / SemanticPatch，而不是直接写真实目标文件。

确认状态：待用户确认。

### 8. 状态变化使用 diff modal 思维，但改为 Git diff / PendingAction

来源：StoryForge 的 `state-extract-adapter.ts`、`StateDiffModal`、`state-card.ts`。

StoryForge 的状态抽取会比较当前状态和新章节内容，只输出明确变化，再让用户确认后写入状态卡。这比直接让 AI 覆盖角色卡安全。

OAN 可吸收方式：

- 将“状态变化”建模为 diff，而不是全文重写角色卡。
- agent 应输出：
  - entity id / name。
  - field。
  - old value。
  - new value。
  - evidence：来自正文的依据。
  - confidence。
- Apply Engine 应把这些 diff 转成 SemanticPatch，并在 Git diff 中给用户确认。

确认状态：待用户确认。

### 9. 章节审稿可形成“报告 -> 修订草案 -> 确认应用”的闭环

来源：StoryForge 的 `ReviewPanel`、`review-adapter.ts`。

StoryForge 的章节质量检查包含结构审稿、AI 味检测、可读性 / 追读感分析，并支持按审稿报告生成修订稿。这种闭环比单纯“帮我润色”更适合长篇小说。

OAN 可吸收方式：

- 增加 OAN 的章节 review workflow：
  1. 读取正文、章节目标、角色状态、伏笔、时间线。
  2. 输出审稿报告。
  3. 报告按维度归类：逻辑、角色、设定、伏笔、节奏、文风、信息量。
  4. 用户确认哪些问题需要修。
  5. agent 基于报告生成局部或全文 SemanticPatch。
- 报告本身可以作为中间产物落盘，方便后续追踪修改理由。

确认状态：待用户确认。

### 10. 长篇导入 pipeline 可作为 OAN 导入已有小说 / 设定集的参考

来源：StoryForge 的 `import/pipeline.ts`、`chunk-writer.ts`。

StoryForge 的导入不是一次性让 AI 吞全文，而是分块解析、滚动上下文、结构化写入、合并角色和世界观。这对百万字级文本很实用。

OAN 可吸收方式：

- 对导入已有小说或设定集建立专门 workflow：
  - 切块。
  - 逐块摘要。
  - 抽取角色、地点、世界规则、时间线、伏笔。
  - 每 N 块做一次合并去重。
  - 最后生成 Object File Tree 候选文件。
- 导入结果必须先写 shadow / pending 目录或导入报告，用户确认后再成为正式小说对象文件。

确认状态：待用户确认。

### 11. Context Snapshot 可变成 OAN 的派生索引

来源：StoryForge 的 `export/context-snapshot.ts`。

StoryForge 能把项目压缩成 AI 可读 Markdown snapshot。OAN 本身已经 filesystem-first，因此更适合把 snapshot 视作派生索引，而不是手工维护的真相来源。

OAN 可吸收方式：

- 为项目生成 AI-readable context snapshot，例如 `.oan/indexes/context-snapshot.md`。
- snapshot 来源于正式对象文件，不能成为唯一真相。
- agent 使用 snapshot 时要记录它的生成时间和源文件版本。
- 如果 snapshot 过期，agent 应提示重新生成，而不是继续基于旧快照写作。

确认状态：待用户确认。

### 12. Adoption Schema 思想可转成 OAN 的 Patch Schema

来源：StoryForge 的 `adopt.ts`、`adoption-schema.ts`、`field-registry.ts`。

StoryForge 用 Adoption Schema 限定 AI 可写字段、必填字段、外键、重复策略、类型校验。这是防止 AI 任意写库的重要层。

OAN 可吸收方式：

- OAN 不采用直接 adopt 到数据库，但可以吸收 schema 思想。
- 每类对象文件定义允许的 patch shape：
  - 角色卡允许改哪些字段。
  - 时间线事件必须有哪些字段。
  - 伏笔状态迁移必须满足哪些条件。
  - 章节正文 patch 是全文替换、局部替换还是追加。
- Apply Engine 在生成 diff 前先做 schema validation。

确认状态：待用户确认。

### 13. AI 使用记录应包含任务类别和上下文来源

来源：StoryForge 的 `aiUsageLog` 与 AI call category。

StoryForge 记录 AI 调用 category、provider、model、token usage 等。OAN 如果要长期维护写作质量，也需要知道某个修改是哪个 agent 能力产生的。

OAN 可吸收方式：

- 每次 agent 写作生成一个 run log：
  - capability id。
  - prompt guide version。
  - context package id。
  - read file list。
  - proposed patch list。
  - accepted / rejected 状态。
  - token usage。
- 这能和 Git commit 形成双重历史：Git 记录文件变化，run log 记录 AI 为什么提出变化。

确认状态：待用户确认。

### 14. 流式生成的“会话保持”可优化 OAN 交互体验

来源：StoryForge 的 `useAIStream.ts`。

StoryForge 的流式输出支持 sessionKey，组件卸载后还能保留当前输出和操作状态。对写作工具来说，这可以减少用户切换界面时丢失 AI 结果的风险。

OAN 可吸收方式：

- 对长章节生成、导入、审稿等长任务建立 resumable session。
- session 状态应写入 OAN 的 workspace shadow / pending 区，而不是只留在内存。
- 用户可以恢复未采纳的草稿、查看上次生成结果、选择继续、重试或废弃。

确认状态：待用户确认。

## 不建议直接吸收的部分

以下内容即使来自 StoryForge，也不建议直接进入 OAN：

- IndexedDB 作为小说数据库。
- Dexie store 直接写入作为最终持久化路径。
- AI 自动后处理后直接更新正式数据。
- 浏览器端直接保存 provider key 作为 OAN 主方案。
- localStorage context memo 作为可信来源。
- ChatCopilot / Background Agents 的完整多 Agent 平台化设计。
- 未确认许可证下的代码、prompt 原文或 UI 文案直接复制。

这些内容最多只能作为“问题空间参考”，不能作为实现来源。

## 若用户确认，建议合并到 OAN 参考笔记的条目

后续如果确认吸收，可以把以下条目追加到 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`，每条标注来源 `[StoryForge]`：

- `[StoryForge]` OAN 应建立 context source registry，并在每次写作前生成 context package。
- `[StoryForge]` OAN 写章节前应读取 outline、上一章结尾、最新状态、角色卡、世界规则、伏笔、时间线和风格指南，并明确哪些上下文被省略。
- `[StoryForge]` OAN 章节推进后必须生成 settlement bundle，包括摘要、状态变化、时间线事件、伏笔状态、下一章衔接点。
- `[StoryForge]` OAN 的状态更新应是 diff / patch，而不是 AI 直接覆写角色卡或最新状态。
- `[StoryForge]` OAN 应把 prompt / agent guide / capability 目录化，并生成只读能力说明。
- `[StoryForge]` OAN 的审稿应走“报告 -> 用户选择 -> 修订 patch -> Git diff 确认”闭环。
- `[StoryForge]` OAN 的导入已有小说流程应采用 chunk + rolling context + structured extraction + pending adoption。

这些只是候选写入内容，不在本文创建时自动合并。
