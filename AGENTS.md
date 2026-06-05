# AGENTS.md

本文件给进入本仓库的 Codex / Claude Code / Aider 等开发 Agent 使用。

## 项目定位

`oh-awesome-novel` 不是通用 Agent 框架，而是一个 filesystem-first 的长篇小说 AI Copilot / Novel IDE。

最终方案已经从早期讨论中的 “StoryForge 二开 + Repository Layer” 收敛为：

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

## 稳定事实

- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 所有写入必须经过人类确认。
- Runtime 学 Aider 的极简循环，不做重型多 Agent 平台。
- 文件修改核心采用 `SemanticPatch + Apply Engine`，避免全文重写。

## 优先阅读

进入项目后，优先阅读以下文档：

1. `docs/ARCHITECTURE.md`
2. `docs/DEVELOPMENT_PLAN.md`
3. `docs/APPLY_ENGINE.md`
4. `docs/AGENT_OPERATING_MANUAL.md`

如需完整背景，再按以下顺序阅读：

1. `docs/PROJECT_VISION.md`
2. `docs/ARCHITECTURE.md`
3. `docs/FILESYSTEM_SPEC.md`
4. `docs/APPLY_ENGINE.md`
5. `docs/DEVELOPMENT_PLAN.md`

## 工作原则

- 不要把早期对话里的旧方案当作最终方案。
- 优先遵循 `docs/README.md` 和 `docs/` 下的稳定设计文档。
- 涉及文件修改、写入、生成、回滚时，必须尊重 Human Approval 与 Git diff 工作流。
- 实现时保持 filesystem-first：项目状态应能由文件树、Markdown、YAML 和 Git 历史解释。
- 不要引入重型多 Agent 平台或复杂 Repository Layer，除非后续设计文档明确改变方向。
- 与小说内容相关的数据应优先落到对象文件树，而不是隐藏在运行时状态或私有数据库中。

