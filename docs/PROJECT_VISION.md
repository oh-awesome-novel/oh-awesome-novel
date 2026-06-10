# Project Vision

## Name

`oh-awesome-novel`

## One Sentence Vision

`oh-awesome-novel` 是一个 filesystem-first 的长篇小说 AI Copilot，让作者用 Markdown、YAML、Git 和可审阅 diff 管理小说工程，而不是把小说困在聊天记录、富文本数据库或黑箱 Agent 里。

## What It Is

`oh-awesome-novel` 是：

- 一个小说工程管理器。
- 一个长篇小说 Copilot。
- 一个 Markdown / YAML first 的 Novel IDE。
- 一个能读取、分析、修改、总结、同步小说项目文件的本地 Agent。
- 一个对 Codex、Crush、Aider、Claude Code、Obsidian、VSCode 友好的文件系统项目。

它应该让作者可以这样工作：

```text
用户：
女主在第 12 章重伤，后续性格开始外冷内热。

Copilot：
读取 chapters/0001/0012.md
读取 characters/heroine/personality.md
读取 state/characters.yaml
读取 timeline/events.yaml
生成以下修改：

- 更新第 12 章某一场景
- 更新女主状态
- 增加时间线事件
- 创建一个伏笔

展示 Git-style diff

用户：
Accept
```

## What It Is Not

`oh-awesome-novel` 不是：

- 通用 AI Agent Framework。
- 编程助手平台。
- 多 Agent 编排平台。
- 纯聊天 UI。
- 角色扮演前端。
- 富文本小说数据库。
- 自动代笔系统。
- 隐藏 prompt 和隐藏审查规则的黑箱。

## Core Principles

### Filesystem First

小说项目的永久数据必须落在文件系统中。

优先使用：

- Markdown
- YAML
- Git
- Object File Tree

避免使用：

- IndexedDB
- SQLite
- PostgreSQL
- MySQL
- Redis
- Vector database as source of truth

### Git Is The History Engine

Git 不只是版本控制。它承担：

- 历史记录
- diff
- undo
- branch
- merge
- human approval
- 回滚
- 与 Aider / Codex / Crush / Obsidian 的兼容

### AI Is The Copilot

AI 可以：

- 读取文件
- 搜索设定
- 分析上下文
- 提出修改
- 生成 SemanticPatch
- 生成摘要
- 生成 diff

AI 不可以：

- 静默写入真实目标文件
- 绕过确认
- 全自动重写项目
- 隐藏修改内容
- 直接拥有数据

审批前允许系统内部写入 `workspace/.workspace` shadow recovery / PendingAction 数据，用于 diff preview 和崩溃恢复；这不等于把修改 materialize 到小说 workspace 正式内容路径。

### Human Is Always In Control

所有写入必须进入：

```text
Tool Call
    ↓
SemanticPatch
    ↓
Apply Engine
    ↓
Diff Preview
    ↓
Accept / Reject
    ↓
Write
    ↓
Git Commit
```

### Simple Runtime

Runtime 学 Aider：

```text
messages
    ↓
LLM
    ↓
tool_calls?
    ↓
execute tools
    ↓
append tool results
    ↓
LLM
```

明确避免：

- Planner
- Multi-Agent Runtime
- Autonomous Loop
- Hidden Retry Engine
- LangChain
- AutoGen
- CrewAI
- Semantic Kernel

## Inspirations

### Aider

借鉴：

- 极简 Tool Loop
- Git diff preview
- Accept / Reject
- 文件编辑体验

不借鉴：

- 代码专用 UI

### StoryForge Reference

StoryForge 只作为历史参考来源，不是当前产品名、组件名、运行时目录名或兼容目标。

借鉴：

- 小说领域模型
- 角色、世界、章节、伏笔、状态、时间线、摘要等结构
- Workflow 思路

不照搬：

- 数据库优先的存储方式
- StoryForge 运行时目录、数据库模型或兼容层

### NovelBot

借鉴：

- 长篇一致性
- Memory / Summary 思路
- Agent 对章节状态的反提取

不照搬：

- 整套框架

### StoryWriter

只参考：

- Recursive Summary
- Hierarchical Summary
- Context Compression

不参考：

- Multi-Agent 论文架构
- Planner / Reviewer Agent

### Morph Fast Apply

借鉴：

- 主模型输出意图
- Apply 层负责精准合并
- 避免全文重写
- 避免脆弱 search/replace

本项目不一定接外部 Morph API，而是实现小说领域专用的 Apply Engine。

## Product Shape

MVP 可以先是 CLI / local dev harness。

成熟形态是一个 Novel IDE：

- 文件树
- Copilot Chat
- Tool Log
- Patch Preview
- Memory Preview
- Summary Panel
- Workflow Panel
- Git History

第一阶段不要急着做完整 UI。先把文件系统、AI SDK ToolSet、Aider-style Runtime、write-intent、`.workspace` shadow write 和人类确认链路跑通。

SemanticPatch + Apply Engine 仍是正式写入核心，但完整实现作为后续 `0800 SemanticPatch Apply Engine` 收敛任务，不要求早期 vertical slice 一开始就完成。
