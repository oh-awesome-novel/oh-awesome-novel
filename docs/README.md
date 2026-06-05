# oh-awesome-novel Docs

本文档集根据 `ChatGPT对话.md` 中关于小说 Agent 的讨论整理而成。讨论中反复出现的 `StoryForge FS`，在本项目中统一命名为 `oh-awesome-novel`。

`oh-awesome-novel` 的定位不是通用 Agent 框架，而是一个 filesystem-first 的长篇小说 AI Copilot / Novel IDE。

核心原则：

- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 所有写入必须经过人类确认。
- Runtime 学 Aider 的极简循环，不做重型多 Agent 平台。
- 文件修改核心采用 `SemanticPatch + Apply Engine`，避免全文重写。

## 文档目录

- [PROJECT_VISION.md](PROJECT_VISION.md): 项目愿景、边界和非目标。
- [REQUIREMENTS.md](REQUIREMENTS.md): 产品需求、功能需求和约束。
- [ARCHITECTURE.md](ARCHITECTURE.md): 最终架构蓝图。
- [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md): 小说项目目录、对象文件树和文件格式。
- [AGENT_RUNTIME_AND_TOOLS.md](AGENT_RUNTIME_AND_TOOLS.md): Tool Registry、Vercel AI SDK 接入和极简 Agent Loop。
- [APPLY_ENGINE.md](APPLY_ENGINE.md): SemanticPatch 与 StoryForge Apply Engine 设计。
- [HUMAN_APPROVAL_AND_GIT.md](HUMAN_APPROVAL_AND_GIT.md): 写入确认、Git diff、commit 和回滚。
- [NOVEL_CONSTITUTION.md](NOVEL_CONSTITUTION.md): 小说创作宪法规格。
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md): 分阶段开发计划。
- [AGENT_OPERATING_MANUAL.md](AGENT_OPERATING_MANUAL.md): 给 Codex / Claude Code / Aider 等开发 Agent 的长期操作手册草案。

ADR：

- [adr/0001-filesystem-first.md](adr/0001-filesystem-first.md)
- [adr/0002-no-heavy-agent-frameworks.md](adr/0002-no-heavy-agent-frameworks.md)
- [adr/0003-semantic-patch-apply-engine.md](adr/0003-semantic-patch-apply-engine.md)

## 推荐阅读顺序

1. [PROJECT_VISION.md](PROJECT_VISION.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md)
4. [APPLY_ENGINE.md](APPLY_ENGINE.md)
5. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)

## 开发时的稳定事实

后续 Codex 或其它开发 Agent 进入项目时，应优先读取：

1. `docs/ARCHITECTURE.md`
2. `docs/DEVELOPMENT_PLAN.md`
3. `docs/APPLY_ENGINE.md`
4. `docs/AGENT_OPERATING_MANUAL.md`

不要再把早期对话里的旧方案当最终方案。最终方案已经从 “StoryForge 二开 + Repository Layer” 收敛为：

```text
oh-awesome-novel
    =
Filesystem First Novel IDE
    +
Aider-style Runtime
    +
Vercel AI SDK Tool Calling
    +
Object File Tree
    +
SemanticPatch Apply Engine
    +
Git Diff Human Approval
```

