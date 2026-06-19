# InkOS Reference Overview

本文档基于 `reference-only/inkos` 本地源码与 README，对 InkOS 的产品定位、功能、特色和优点做归纳。InkOS 是参考项目，不是 `oh-awesome-novel` 的目标架构。

## 项目定位

InkOS 是一个面向故事内容生产的 AI 创作系统，覆盖长篇小说、短篇小说、同人、番外、仿写续写、封面生成和开放世界互动。它同时提供 Studio Web 工作台、CLI、TUI 和外部 Agent Skill 入口。

从源码看，InkOS 的核心不是单一聊天 UI，而是一组围绕“创作动作”的本地工程系统：

- `packages/core`：长篇写作流水线、状态管理、LLM provider、交互会话、Play 世界、短篇生产、审稿和导出能力。
- `packages/cli`：`inkos` 命令行入口，暴露建书、写章、审稿、修订、导入、导出、短篇、同人、TUI、Studio 等命令。
- `packages/studio`：React + Hono Studio，提供可视化工作台、服务配置、会话、书籍管理、Play 世界和 SSE 事件。

## 功能范围

### 长篇小说生产

InkOS 支持从创作简报创建书籍，再推进章节生产流程。核心流程包含基础设定生成、章节意图、上下文组装、正文写作、审稿、修订、状态结算和导出。

源码中 `PipelineRunner` 暴露了 `planChapter`、`composeChapter`、`auditDraft`、`reviseDraft`、`writeNextChapter`、`importChapters`、`generateStyleGuide`、`importCanon` 等能力，说明它把写作拆成可单独运行和复用的阶段。

### Studio / CLI / TUI 统一入口

InkOS 不只提供原子命令，也提供统一自然语言入口。README 和 `skills/SKILL.md` 都强调 `inkos interact --json --message ...` 是推荐的外部 Agent 入口，Studio Chat、TUI 和 CLI 共用同一套 action surface。

这个 action surface 的特点是：

- 普通讨论直接回答。
- 重动作先生成确认卡。
- 确认后才切换到建书、短篇、Play 或封面等专门 session。
- 完成状态以工具结果和落盘文件为准，不以模型口头声明为准。

### 短篇、封面和衍生创作

InkOS 将长篇写作之外的创作场景产品化：

- InkOS Short：生成完整短篇包，包括正文、 outline 记录、审稿记录、简介卖点、封面提示词和可选封面图。
- Cover：可单独为标题、简介或视觉方向生成封面提示词和图片。
- Fanfic / continuation / spinoff / style imitation：提供同人、续写、番外、仿写和风格分析入口。

这些不是散落的 prompt，而是进入 Studio/CLI 的一等工作流。

### InkOS Play 互动世界

InkOS Play 是开放世界或分支互动玩法。它支持自然语言创建世界契约、玩家身份、初始场景、可点击动作、自由动作、角色/物品/证据/关系状态，以及可选配图。

`PlayRunner` 将一次玩家回合拆成：

1. 解释玩家动作。
2. 由世界 mutator 生成状态突变。
3. 渲染场景。
4. reconcile 场景与状态。
5. 在场景生成成功后一次性提交图谱、事件、投影和转录。

这种提交顺序避免“状态已经推进但场景失败”的半状态。

### 状态、记忆和投影

InkOS 使用多层状态材料：

- `book.json` 和项目 `inkos.json` 保存工程配置。
- `story/state/*.json` 保存结构化 truth files。
- Markdown projections 把结构化状态渲染成作者可读的当前状态、章节摘要和伏笔池。
- `story/memory.db` 使用 Node SQLite 保存时间有效性 facts、章节摘要和 hooks，用作检索/加速索引。

README 将这种结构描述为 truth files + Markdown projections + temporal memory 的组合。源码中 `state-projections.ts` 和 `memory-db.ts` 可以看到这种实现。

### Provider、模型和服务配置

InkOS 有比较完整的模型配置体系：

- Studio 使用 service 配置和 `.inkos/secrets.json`。
- CLI / daemon / deploy 支持 env 和命令行覆盖。
- provider bank 内置 OpenAI、Anthropic、Google、DeepSeek、Moonshot、MiniMax、OpenRouter、Ollama、kkaiapi、自定义 OpenAI-compatible 等服务。
- 服务测试、模型列表探测、模型归属校验和 doctor 诊断都进入 Studio/API。

这使它对多模型、多服务商和代理服务较友好。

### Genre Profile 与审稿规则

InkOS 把 genre profile 放在 `packages/core/genres/*.md`。例如 LitRPG profile 包含：

- frontmatter 元数据：语言、章节类型、疲劳词、数值系统、力量成长、节奏规则、满足感类型、审稿维度。
- 正文规则：题材禁忌、系统设定规则、节奏指导。

这说明 InkOS 把“题材知识”和“审稿标准”作为可维护的创作规则资产，而不是只藏在代码 prompt 里。

## 特色

### 1. 创作入口产品化

InkOS 将“长篇、短篇、封面、开放世界、同人、续写、仿写”拆成明确入口。用户不需要记住底层命令或工具名，可以从 Studio Chat 的确认卡进入对应流程。

### 2. 确认式 action surface

它明确区分普通聊天和重动作执行。确认卡避免自然语言误触发，工具结果避免“模型说做完了但没有文件”的假完成。

### 3. 上下文治理

InkOS 强调 protected / compressible context。长期事实、当前目标、作者意图等应受到保护；历史聊天和可压缩材料在预算紧张时再压缩。

### 4. 分阶段写作流水线

长篇写作不是直接让模型写正文，而是分为 plan、compose、draft、audit、revise、settle 等阶段。每一阶段可以输出中间产物或用于调试。

### 5. 状态可视化投影

结构化状态不是只给机器看，还会生成 Markdown projection 给作者和 reviewer 阅读。这对长篇一致性维护很有帮助。

### 6. 多入口共享同一控制脑

CLI、TUI、Studio 和外部 Skill 尽量走同一 interaction / action 层，减少不同入口行为不一致的问题。

### 7. Provider 兼容和诊断做得较细

InkOS 对不同 provider 的 base URL、协议、模型列表、API Key 来源、stream 兼容和错误来源做了显式处理，降低配置问题对写作流程的干扰。

### 8. 测试覆盖面广

本地统计显示 `packages/core/src`、`packages/cli/src`、`packages/studio/src` 下有约 186 个测试文件，覆盖 pipeline、planner、writer、state、play、provider、Studio API、TUI 等多个层面。

## 优点

- 产品功能完整：从建书到写章、审稿、导出、短篇、封面和互动世界都有闭环。
- 写作领域建模较丰富：章节、状态、hooks、genre profile、style profile、audit dimensions 都有明确对象。
- 用户入口清晰：Studio Chat 与确认卡降低误执行概率。
- 调试面较多：CLI 原子命令、Studio API、SSE 事件、日志和测试都有对应支撑。
- 长篇一致性意识强：状态投影、时间 facts、hooks 和章节摘要围绕“写久了不乱”展开。
- 配置现实感强：服务商、模型、密钥、env、Studio 配置和诊断路径都考虑到了真实使用中的混乱。
- 互动世界实现有工程边界：Play 的事件、图谱、投影、checkpoint、variant restore 形成可恢复的状态模型。

## 与 oh-awesome-novel 的关键差异

InkOS 更像“创作生产系统”，包含多 Agent 流水线、自动审稿修订、后台 daemon、SQLite memory index 和较强自主生产倾向。

`oh-awesome-novel` 的稳定定位不同：

- OAN 是 filesystem-first Novel IDE / Copilot，不是自动代笔系统。
- OAN 要求 AI 写入先形成 PendingAction / diff，并由作者 Accept 后落盘。
- OAN 不引入重型多 Agent runtime，不把 SQLite 或私有数据库作为小说事实源。
- OAN 的长期事实以 Markdown / YAML / Object File Tree 和 Git 为准。

因此 InkOS 适合作为产品功能、交互模式、上下文治理和写作领域建模参考，不适合直接照搬其自主多 Agent 生产架构。

## 证据来源

- `reference-only/inkos/README.md`
- `reference-only/inkos/README.en.md`
- `reference-only/inkos/skills/SKILL.md`
- `reference-only/inkos/package.json`
- `reference-only/inkos/packages/core/package.json`
- `reference-only/inkos/packages/cli/package.json`
- `reference-only/inkos/packages/studio/package.json`
- `reference-only/inkos/packages/core/src/index.ts`
- `reference-only/inkos/packages/core/src/pipeline/runner.ts`
- `reference-only/inkos/packages/core/src/agent/agent-system-prompt.ts`
- `reference-only/inkos/packages/core/src/agent/agent-tools.ts`
- `reference-only/inkos/packages/core/src/interaction/runtime.ts`
- `reference-only/inkos/packages/core/src/state/state-projections.ts`
- `reference-only/inkos/packages/core/src/state/memory-db.ts`
- `reference-only/inkos/packages/core/src/play/play-runner.ts`
- `reference-only/inkos/packages/studio/src/api/server.ts`
- `reference-only/inkos/packages/core/genres/litrpg.md`
