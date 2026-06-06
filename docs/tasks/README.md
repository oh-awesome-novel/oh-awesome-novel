# Development Tasks

本目录把 `docs/DEVELOPMENT_PLAN.md` 拆成可执行开发任务。

架构事实仍以这些文档为准：

- `docs/ARCHITECTURE.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/APPLY_ENGINE.md`
- `docs/AGENT_RUNTIME_AND_TOOLS.md`
- `docs/HUMAN_APPROVAL_AND_GIT.md`

任务文档只回答：

- 当前要交付什么。
- 不能做什么。
- 完成标准是什么。
- 是否已经完成。

## Status Legend

- `Completed`: 已完成并已有代码或文档落地。
- `Planned`: 尚未完成，后续开发任务。
- `Blocked`: 需要新的设计决策或外部条件。

## Completed Tasks

- [0001 Documentation Foundation](0001-documentation-foundation.md)
- [0002 Desktop Build Foundation](0002-desktop-build-foundation.md)
- [0003 Lightweight Runtime](0003-lightweight-runtime.md)
- [0004 Runtime Test Workspace](0004-runtime-test-workspace.md)
- [0005 Strict TypeScript Configs](0005-strict-typescript-configs.md)

## Planned Tasks

- [0100 Filesystem Example Novel](0100-filesystem-example-novel.md)
- [0200 Markdown YAML Engine](0200-markdown-yaml-engine.md)
- [0300 SemanticPatch Apply Engine](0300-semantic-patch-apply-engine.md)
- [0400 Tool Registry And Read Tools](0400-tool-registry-read-tools.md)
- [0500 Write Intent And Human Approval](0500-write-intent-human-approval.md)
- [0600 Minimal Copilot Interface](0600-minimal-copilot-interface.md)
- [0700 Summary Workflow Extensions Polish](0700-summary-workflow-extensions-polish.md)

## Global Rules

Every task must preserve these constraints:

- Do not introduce LangChain, AutoGen, CrewAI, Semantic Kernel, or a heavy agent framework.
- Keep Runtime as an Aider-style loop, not a planner or multi-agent platform.
- Keep project data filesystem-first: Markdown, YAML, Object File Tree, and Git.
- Write tools must produce visible `PendingAction` / diff output before any file write.
- Prefer SemanticPatch and Apply Engine over full-file rewrites.
