# 0600 Minimal Copilot Interface

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
- Runtime 调用 write intent tool。
- UI 展示 tool log 和 PendingAction。
- 用户确认后文件写入，`git diff` 可见。

## Constraints

- 不先做完整 IDE。
- 不做后台 autonomous agent。
- 不跳过 diff approval。
