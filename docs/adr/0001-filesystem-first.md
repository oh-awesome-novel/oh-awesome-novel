# ADR 0001: Filesystem First

## Status

Accepted

## Context

早期方案曾考虑 StoryForge 风格数据库模型，或者 Markdown Mirror。

这里的 StoryForge 只作为历史背景，不是当前组件名、运行时目录名或兼容目标。

对话后期明确收敛为：

- Markdown / YAML 是事实源。
- Git 是历史引擎。
- UI 从文件解析运行时状态。
- 不维护数据库和 Markdown 两份数据。

## Decision

`oh-awesome-novel` 采用 filesystem first。

永久数据存储为：

- Markdown
- YAML
- Object File Tree

不引入数据库作为 source of truth。

## Consequences

优点：

- Git diff 天然可用。
- Codex / Aider / Crush / Obsidian 兼容。
- 作者可手动编辑。
- 回滚和分支简单。

代价：

- 需要实现 Markdown / YAML Engine。
- 需要 schema validation。
- UI 状态需要从文件重建。

## Explicitly Avoid

- IndexedDB
- SQLite
- PostgreSQL
- Vector database as source of truth
