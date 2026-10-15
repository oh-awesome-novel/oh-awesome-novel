# Project Vision

> 定位调整：2026-10-15。早期文档中的 “Novel IDE / 小说工程管理器” 定位已废弃；本文是当前唯一产品定位来源。

## One Sentence Vision

`oh-awesome-novel`（OAN）是一个个人使用的、filesystem-first 的**同人与综漫故事创作工作台**：作者先在 Play 中“穿越”进原作或他人作品的世界，亲自改写剧情走向；再把值得保留的推演结果带回 Writing，与 AI 一起整理成可长期维护的小说。脑洞需要从零开写时，Writing 同样提供完整的“规划 → 写 → 审 → 整理”闭环。

## Who It Is For

OAN 首先服务项目作者本人：

- 主要创作同人与综漫（多部作品世界交叉）。
- 不以商业出版、网络连载或多人协作为目标；多作品版权意味着作品基本不可能商业化，也不需要商业化设计。
- 熟悉 Markdown、Git 与本地工具，能接受文件树和 diff 作为工作界面，但日常写作仍应以中文、作者语言完成。

因此：

- 不做商业写作、平台连载、付费、团队协作或发布流程方面的功能与指标。
- 不需要为“没有技术背景的大众作者”隐藏 Git 或文件结构，但新增界面与说明优先使用中文作者语言。
- “商业写作” Writing Profile 只作为可选提示风格保留；默认 Profile 是同人二创。

## Two Equal Ways To Create

### Play：在原作世界里改写剧情（高优先级）

不必从零开始。作者从原作或他人作品已有的角色、世界和剧情出发，以参与者（穿越者）或导演身份进入场景，推演“如果我在这里会发生什么”。

```text
原作/参考材料 → 角色卡与世界设定（Tavern 卡、拆书材料、作者笔记）
  → Guided Start 选择来源与入场点
  → Immersive Journey（作者亲自穿越）或 Scene Rehearsal（作者导演）
  → 世界事件、分支、checkpoint 与角色认知边界
  → Outcome Report / Writing Reference / 显式 adoption
  → Writing 整理成章节
```

Play 是与 Writing 并列的顶级模式，并保持高优先级。它的推演记录默认不改动正式小说内容；只有作者显式采纳，结果才进入正式文件。

### Writing：从零开写或整理推演结果

有些脑洞没有现成世界可推演，需要从零写。Writing 必须能独立完成核心闭环：

```text
新建作品 → 规划大纲/下一章 → 写下一章（系统自动确定章节文件）
  → 审稿 → 定稿 Accept → 整理本章（摘要/状态/时间线/伏笔）→ 写下一章
```

这条闭环是产品的底线能力：新建的空作品必须能直接写出并保存第一章，不要求作者手工建文件或复制聊天内容。

## What It Is

- 个人同人/综漫创作工作台，Play 推演与 Writing 写作双核心。
- Markdown / YAML first：作品资料、正文与记忆都是作者可读、可改、可 diff 的文件。
- 透明 Copilot：读取、分析、总结并提出跨文件修改，但写入必须由作者确认。
- 对 Codex、Aider、Claude Code、Obsidian、VS Code 与 Git 友好的本地项目。

## What It Is Not

- 不是 “Novel IDE” 或通用小说工程管理器；文件树与 Git 是数据底座，不是产品卖点。
- 不是商业写作、连载运营或团队协作平台。
- 不是通用 AI Agent Framework 或多 Agent 编排平台。
- 不是隐藏自治循环、后台自动代笔或无确认写作系统。
- 不是以私有数据库、向量数据库或运行时记忆作为事实源的产品。
- 不是把真实 host shell、host filesystem 或 network 暴露给模型的 coding sandbox。

## Core Principles

### Filesystem First

小说永久数据优先使用 Markdown、YAML 与细粒度 Object File Tree。SQLite、IndexedDB、云数据库和向量索引不得成为小说事实源；可重建索引必须明确标记为派生状态。

### Git Is The History Engine

Git 负责历史、diff、commit、branch、merge、undo 与 rollback。任何内部日志或 PendingAction 记录都不能替代 canonical 文件与 Git 历史。

### AI Is The Copilot

AI 可以读取固定投影、搜索设定、分析上下文、在 `bash-tool` / `just-bash` 内存环境中编辑候选、生成摘要并解释 diff。

AI 不可以静默修改 canonical 文件、扩大 host-selected capability、访问隐藏内部目录、解析 secrets、执行宿主进程或决定是否提交。

### Human Is Always In Control, With Proportionate Review

```text
fixed snapshot → in-memory editing → CandidateChangeSet
  → PendingAction + diff → Accept / Reject → ChangeMaterializer → Git
```

所有正式写入仍需作者确认，但审阅强度按风险分级：正文、人设与宪法逐项审阅；由已验证正文证据推导的派生记录（摘要、章级状态、时间线、伏笔）可以整批接受。目标是让审批保持有意义，而不是制造审批疲劳。

Accept 前允许 OAN 在 `.workspace/change-engine/v1/` 保存 immutable draft、proposal 与 recovery 数据；这些内部文件不是小说事实，也不代表候选已经写入 canonical 目标。

### Host Chooses Targets, Not The Author

写入范围由可信 host workflow 决定。对常见动作（写下一章、生成新角色卡、规划大纲），host 应自动推导精确目标路径，而不是要求作者先在文件树里选中“正确的文件”。这既保持安全边界，也去掉了不必要的操作负担。

### Simple Runtime

Runtime 保持 Aider-style 循环：

```text
messages -> LLM -> tool calls -> execute -> append results -> LLM
```

不引入 Planner、Multi-Agent Runtime、Autonomous Loop、隐藏重试引擎、LangChain、AutoGen、CrewAI 或 Semantic Kernel。

### One Change Authority

`CandidateChangeSet.changes` 是候选修改的唯一权威。diff、bash command preview 和 mutation log 只服务展示、调试与审计；Accept 不解析 diff，也不重放模型命令。

## Product Shape

桌面创作工作台：

- 作品列表与新建引导（默认同人二创 Profile）。
- `Play | Writing` 两个同级顶级模式。
- Play：session、Guided Start、穿越/导演视角、世界事件、分支与 checkpoint、Outcome 与 adoption。
- Writing：章节导航、Copilot、章节进度引导、PendingAction 审批、正文搜索与导出。
- 参考资料：Tavern 角色卡导入、参考作品拆解与材料采纳，作为 Play 和 Writing 的素材来源。
- Git 历史与快照。

Writing 与 Play 都汇入相同的 ChangeSet、PendingAction、materializer 与 Git 边界。确定性 producer 可直接构造 ChangeSet，不必伪造 shell 命令。

## Inspirations

- SillyTavern / MuseAI / OpenTavern：角色卡、世界书与沉浸式互动。
- Aider：极简 loop、Git-aware 人机协作与可见修改。
- NovelBot / StoryWriter / InkOS：长篇一致性、分层摘要与章节生命周期。
- Obsidian / VS Code：文件系统工作台和外部工具互操作。

参考项目只提供可吸收设计，不决定 OAN 的数据所有权、安全边界或运行时架构。研究材料见 [research/](research/)。
