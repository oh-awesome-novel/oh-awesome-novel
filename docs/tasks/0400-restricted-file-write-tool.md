# 0400 Restricted File Write Tool

> Status: Planned
> Milestone: Fast Agent Loop Validation

## Goal

快速实现一个简单文件写入 tool，用来尽早验证完整 agent 流程：

```text
User request
  -> Runtime
  -> Tool call
  -> Restricted file write
  -> Tool result
  -> Assistant response
```

这是临时验证路径，不替代后期 Human Approval 和 SemanticPatch Apply Engine。

为了便于异常崩溃后恢复，文件写入可以先写入到 workspace 内部的 shadow 路径：

```text
workspace/.workspace/
```

`.workspace` 只能由 tool 内部按硬编码规则使用，调用方不能把 `.workspace` 当作可写目标传入。

## Deliverables

- `file.write` 或 `workspace.writeFile` tool。
- 只允许操作当前 active workspace 内的文件。
- 硬编码 workspace boundary check。
- 内部 shadow write 到 `workspace/.workspace`，再按任务策略 materialize 到目标路径。
- 结构化 tool result。
- 针对路径逃逸的单元测试。

## Required Safety Rules

写入 tool 内部必须硬编码这些限制：

- 输入路径必须解析到 active workspace 内部。
- 拒绝绝对路径。
- 拒绝 `..` path traversal。
- 拒绝解析后不以 workspace realpath 开头的路径。
- 拒绝 symlink 逃逸到 workspace 外部。
- 拒绝写入 workspace 外的 `.git`、用户目录、系统目录、临时目录。
- 拒绝用户输入路径指向 workspace 内任何隐藏文件或隐藏目录。
- 拒绝用户输入路径指向 `workspace/.oan`。
- 拒绝用户输入路径指向 `workspace/.workspace`。
- 写入前必须确保 parent directory 仍位于 workspace 内部。
- shadow root 必须由实现内部固定为 `workspace/.workspace`，不能由 tool args 覆盖。

## Done Criteria

- Runtime 可以调用该 tool 写入 workspace 中的一个普通正文文件。
- workspace 外路径全部失败。
- `../outside.md` 失败。
- `.hidden.md` 失败。
- `characters/.hidden/file.md` 失败。
- `.oan/session.json` 失败。
- `.workspace/shadow.md` 失败。
- workspace 内 symlink 指向外部时写入失败。
- crash recovery shadow 文件可在 `workspace/.workspace` 中找到。
- tool result 能被 Runtime 追加回消息循环。

## Constraints

- 不运行 shell 命令。
- 不执行任意用户脚本。
- 不 commit。
- 不作为长期写入架构。
- 后续必须被 PendingAction + Human Approval + Apply Engine 替代。
