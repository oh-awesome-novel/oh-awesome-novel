# 0500 Minimal Copilot Interface

> Status: Planned
> Milestone: M8 Minimal Copilot Interface

## Goal

实现最小可用 Copilot 交互，跑通从自然语言请求到 PendingAction 审批的 vertical slice。

## Preferred Shape

桌面应用可以承载最终体验；早期也可以用一个最小 panel 或 dev harness 来验证链路。

## Deliverables

- Chat input。
- Assistant message。
- Tool log。
- Pending action list。
- Diff preview。
- Accept / Reject controls。

## Done Criteria

- 用户输入自然语言请求。
- Runtime 调用 read tool。
- Runtime 调用受限文件写入 tool，快速验证完整 agent loop。
- UI 展示 tool log 和写入结果。
- 后续 Human Approval 任务接管正式写入链路。

## Constraints

- 不先做完整 IDE。
- 不做后台 autonomous agent。
- 不把受限文件写入 tool 当成长期写入架构。
