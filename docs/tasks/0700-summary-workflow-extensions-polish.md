# 0700 Summary Workflow Extensions Polish

> Status: Planned
> Milestones: M9 Summary And Memory Layer / M10 Workflow And Skills / M11 Extension System / M12 Polish

## Goal

在核心写入链路稳定后，补齐长篇小说所需的摘要、Workflow、Skill、Extension 与导入导出能力。

## Deliverables

- Chapter summary generator。
- Volume summary generator。
- Global summary generator。
- Context assembler。
- `.storyforge/workflow.yaml` loader。
- Skill loader。
- Allowed tool filter。
- Extension manifest。
- Tool / prompt pack / workflow template registration。
- Import old flat Markdown。
- Export readable manuscript。
- Git helper。
- Better validation。

## Done Criteria

- 生成新章节时不加载整本小说。
- Context 来自摘要、状态、时间线、伏笔。
- Workflow 不变成隐藏 planner。
- Skills 只包含 prompt pack 和 allowed tools。
- Extension 可插拔但不引入复杂 runtime。
- 可以管理一个小型真实小说项目。

## Constraints

- 不使用 vector DB 作为事实源。
- 不引入 extension marketplace。
- 不把 Skill 写成业务逻辑容器。
