# Project Vision

## One Sentence Vision

`oh-awesome-novel` 是一个 filesystem-first 的长篇小说 AI Copilot，让作者用 Markdown、YAML、Git 和可审阅 diff 管理小说工程，而不是把小说困在聊天记录、富文本数据库或黑箱 Agent 中。

## What It Is

- 小说工程管理器与本地 Novel IDE。
- Markdown / YAML first 的长篇小说 Copilot。
- 能读取、分析、总结并提出跨文件修改的透明 Agent。
- 对 Codex、Aider、Claude Code、Obsidian、VS Code 与普通 Git 工具友好的文件系统项目。

典型体验：

```text
作者：
女主在第 12 章重伤，后续性格开始外冷内热。

Copilot：
读取固定 workspace 投影中的章节、人设、状态与时间线
在受限内存沙箱中迭代修改
生成 create / update / delete CandidateChangeSet
展示 Git-style diff

作者：
Accept

系统：
事务化写入候选并按配置创建 Git commit
```

## What It Is Not

- 通用 AI Agent Framework 或多 Agent 编排平台。
- 隐藏自治循环、后台自动代笔或无确认写作系统。
- 纯聊天 UI、角色扮演前端或富文本小说数据库。
- 以私有数据库、向量数据库或运行时记忆作为事实源的产品。
- 把真实 host shell、host filesystem 或 network 暴露给模型的 coding sandbox。

## Core Principles

### Filesystem First

小说永久数据优先使用 Markdown、YAML 与细粒度 Object File Tree。SQLite、IndexedDB、云数据库和向量索引不得成为小说事实源；可重建索引必须明确标记为派生状态。

### Git Is The History Engine

Git 负责历史、diff、commit、branch、merge、undo 与 rollback。任何内部日志或 PendingAction 记录都不能替代 canonical 文件与 Git 历史。

### AI Is The Copilot

AI 可以读取固定投影、搜索设定、分析上下文、在 `bash-tool` / `just-bash` 内存环境中编辑候选、生成摘要并解释 diff。

AI 不可以静默修改 canonical 文件、扩大 host-selected capability、访问隐藏内部目录、解析 secrets、执行宿主进程或决定是否提交。

### Human Is Always In Control

```text
fixed snapshot
    ↓
in-memory editing
    ↓
CandidateChangeSet
    ↓
PendingAction + diff
    ↓
Accept / Reject
    ↓
ChangeMaterializer
    ↓
Git
```

Accept 前允许 OAN 在 `.workspace/change-engine/v1/` 保存 immutable draft、proposal 与 recovery 数据；这些内部文件不是小说事实，也不代表候选已经写入 canonical 目标。

### Simple Runtime

Runtime 保持 Aider-style 循环：

```text
messages -> LLM -> tool calls -> execute -> append results -> LLM
```

不引入 Planner、Multi-Agent Runtime、Autonomous Loop、隐藏重试引擎、LangChain、AutoGen、CrewAI 或 Semantic Kernel。

### One Change Authority

`CandidateChangeSet.changes` 是候选修改的唯一权威。diff、bash command preview 和 mutation log 只服务展示、调试与审计；Accept 不解析 diff，也不重放模型命令。

## Product Shape

产品成熟形态是桌面 Novel IDE：

- workspace / file tree
- Writing 与 Play 顶级模式
- Copilot chat 与 tool activity
- context / source inspector
- create / update / delete diff review
- PendingAction approval
- Reference deconstruction 与显式 adoption
- Git status、history、commit 与 sync

Writing 与 Play 可以产生候选修改，但都必须汇入相同的 ChangeSet、PendingAction、materializer 与 Git 边界。确定性 producer 可直接构造 ChangeSet，不必伪造 shell 命令。

## Inspirations

- Aider：极简 loop、Git-aware 人机协作与可见修改。
- NovelBot / StoryWriter：长篇一致性、分层摘要与上下文压缩。
- Obsidian / VS Code：文件系统工作台和外部工具互操作。
- `bash-tool` / `just-bash`：模型熟悉的文本编辑方式，但只连接 OAN 构造的固定内存投影。

参考项目只提供可吸收设计，不决定 OAN 的数据所有权、安全边界或运行时架构。
