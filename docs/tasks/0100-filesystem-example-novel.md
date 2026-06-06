# 0100 Filesystem Example Novel

> Status: Planned
> Milestone: M2 Filesystem Spec And Example Novel

## Goal

把 `docs/FILESYSTEM_SPEC.md` 中的小说工程目录变成可验证样例。

## Deliverables

- `examples/sample-novel/`
- `.storyforge/workflow.yaml`
- `.storyforge/constitution/`
- `characters/`
- `world/`
- `chapters/`
- `state/`
- `timeline/`
- `foreshadow/`
- `summaries/`
- `schemas/`

## Done Criteria

- 样例包含 Character、World、Chapter、State、Timeline、Foreshadow、Summary、Constitution。
- 基础 YAML 文件可以被 parser 验证。
- 章节样例包含 frontmatter 和 scene headings。
- 样例能支撑 MVP vertical slice。

## Constraints

- 不使用隐藏数据库。
- 不把所有设定塞进一个大 Markdown。
- 不提前引入 vector DB。
