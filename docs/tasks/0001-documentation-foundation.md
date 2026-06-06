# 0001 Documentation Foundation

> Status: Completed
> Milestone: M0 Documentation Foundation

## Goal

建立项目稳定蓝图，让后续开发不会重新漂移到旧的 Repository Layer 或重型 Agent 平台方案。

## Delivered

- `docs/README.md`
- `docs/PROJECT_VISION.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/APPLY_ENGINE.md`
- `docs/AGENT_RUNTIME_AND_TOOLS.md`
- `docs/HUMAN_APPROVAL_AND_GIT.md`
- `docs/NOVEL_CONSTITUTION.md`
- `docs/DEVELOPMENT_PLAN.md`
- `docs/AGENT_OPERATING_MANUAL.md`
- `docs/adr/`

## Done Criteria

- Filesystem-first 是稳定事实。
- Runtime 明确是 Aider-style loop。
- Vercel AI SDK 只作为 tool calling 实现层。
- SemanticPatch Apply Engine 是写入核心。
- Human Approval 与 Git diff 是写入边界。

## Notes

后续任务文档不能取代架构文档，只能把架构文档拆成可执行清单。
