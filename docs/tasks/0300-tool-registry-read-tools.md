# 0300 Tool Registry And Read Tools

> Status: Planned
> Milestone: M5 Tool Registry And Read Tools

## Goal

暴露只读领域工具，让 Runtime 可以通过 tool calling 读取小说工程状态。

## Deliverables

- `defineStoryTool()`。
- Tool metadata。
- Tool registry。
- Read tool result schema。
- Tool call log shape。

## Initial Tools

- `character.get`
- `character.list`
- `world.search`
- `chapter.get`
- `state.get`
- `timeline.list`
- `foreshadow.list`
- `summary.get`
- `constitution.get`
- `workflow.get`

## Done Criteria

- read tools 返回结构化数据。
- tool registry 支持 register/get/list。
- Runtime 可以调用 read tools。
- tool call log 可用于 UI 展示。

## Constraints

- read tools 不写盘。
- tools 命名使用 `domain.action`。
- 不把业务逻辑藏进 Skill prompt。
