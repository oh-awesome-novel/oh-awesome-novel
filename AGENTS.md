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

- 当前源码布局是 monorepo：核心能力在 `packages/*`，桌面和前端在 `apps/*`，测试在根目录 `__test__/*`。不要新增旧式根目录 `src/` 实现。
- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 所有写入真实目标文件必须经过人类确认。
- Runtime 学 Aider 的极简循环，不做重型多 Agent 平台。
- 文件修改核心采用 `SemanticPatch + Apply Engine`，避免全文重写。

## 优先阅读

进入项目后，优先阅读以下文档：

1. `docs/ARCHITECTURE.md`
2. `docs/DEVELOPMENT_PLAN.md`
3. `docs/AGENT_OPERATING_MANUAL.md`

如需完整背景，再按以下顺序阅读：

1. `docs/PROJECT_VISION.md`
2. `docs/ARCHITECTURE.md`
3. `docs/FILESYSTEM_SPEC.md`
4. `docs/APPLY_ENGINE.md`
5. `docs/DEVELOPMENT_PLAN.md`

## 工作原则

- 不要把早期对话里的旧方案当作最终方案。
- 优先遵循 `docs/README.md` 和 `docs/` 下的稳定设计文档。
- 开始实现前先看 `docs/tasks/README.md`，从具体 task 进入，不要直接从零散 plan 开始。
- `docs/tasks/*.md` 是范围、状态和验收入口；`docs/superpowers/plans/*.md` 是对应 task 的实施步骤。
- 如果 task 有 `Related Plans`，实现时必须先阅读这些 plan，再对照代码逐项执行。
- `Completed` 表示已有代码或文档落地；`Needs Review` 表示已有实现但新增 plan 暴露出需要复核、补测或补实现的差异；`Planned` 表示尚未实现。
- 对 `Needs Review` task，先按关联 plan 复核代码和测试，补齐缺口后再更新 task 状态和 Implementation Notes。
- 对 `Planned` task，先按 task 的 scope / constraints / done criteria 确认范围，再执行关联 plan。
- 涉及文件修改、写入、生成、回滚时，必须尊重 Human Approval 与 Git diff 工作流。
- 移动或重命名已被 Git 跟踪的文件时，优先使用 `git mv`，保留清晰的文件历史。
- 实现时保持 filesystem-first：项目状态应能由文件树、Markdown、YAML 和 Git 历史解释。
- 不要引入重型多 Agent 平台或复杂 Repository Layer，除非后续设计文档明确改变方向。
- 与小说内容相关的数据应优先落到对象文件树，而不是隐藏在运行时状态或私有数据库中。
- 用户确认前不得写真实目标文件；允许系统内部写入 `workspace/.workspace` shadow recovery / PendingAction 数据用于 diff preview 和崩溃恢复。
- AI 发起的文件修改在 PendingAction accept 后默认应按配置自动 Git commit；`git.autoCommitOnAccept: false` 时不得自动 commit 或 sync，并应提供用户显式 quick commit 入口。

## 测试放置规则

- 测试统一放在仓库根目录 `__test__/` 下，不要放进 `packages/*/src/__tests__/`。
- 按被测模块创建对应测试 workspace，例如：
  - `packages/core` 的测试放在 `__test__/core/`。
  - `packages/runtime` 的测试放在 `__test__/runtime/`。
  - 后续新增 `packages/tools`、`packages/agent` 等模块时，分别使用 `__test__/tools/`、`__test__/agent/`。
- 每个 `__test__/<module>/` 应作为独立 npm workspace，包含自己的 `package.json`、`vitest.config.ts` 和 `src/**/*.test.ts`。
- 测试应优先通过包入口导入被测代码，例如 `@oh-awesome-novel/core`，避免直接导入 `packages/<module>/src/*` 私有路径。
