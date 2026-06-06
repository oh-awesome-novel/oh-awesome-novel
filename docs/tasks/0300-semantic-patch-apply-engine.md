# 0300 SemanticPatch Apply Engine

> Status: Planned
> Milestone: M4 SemanticPatch Apply Engine

## Goal

实现 `SemanticPatch -> diff -> PendingAction`，让 AI 输出编辑意图而不是全文内容。

## Deliverables

- SemanticPatch 类型。
- ObjectPatch executor。
- CollectionPatch executor。
- NarrativePatch 初版。
- Diff generator。
- Patch validator。
- PendingAction store。

## Done Criteria

- `state.set` 能生成 YAML diff。
- `character.updatePersonality` 能生成 Markdown section diff。
- NarrativePatch 能按 scene 或 chunk 修改章节。
- 用户确认前不写盘。
- PendingAction 可被 UI 或 CLI 展示。

## Constraints

- 不做通用 patch 引擎。
- 优先覆盖小说固定领域。
- 不绕过 Human Approval。
