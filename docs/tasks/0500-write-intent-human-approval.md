# 0500 Write Intent And Human Approval

> Status: Planned
> Milestone: M6 Write Intent Tools And Human Approval

## Goal

把所有写操作转成 PendingAction，由人类通过 diff 明确确认。

## Deliverables

- `character.updatePersonality`
- `state.set`
- `timeline.add`
- `foreshadow.create`
- `summary.generateChapter` 初版
- PendingAction list。
- Diff preview。
- Accept / Reject flow。
- Git diff integration。

## Done Criteria

- 所有写工具只返回 PendingAction。
- Accept 后写文件。
- Reject 不写文件。
- 写入后 `git diff` 可见。
- Apply Engine 是唯一写入路径。

## Constraints

- Runtime 不直接写文件。
- Tool 不直接 commit。
- 不允许静默修改小说工程。
