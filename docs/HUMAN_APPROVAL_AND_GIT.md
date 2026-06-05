# Human Approval And Git

## Principle

Human Approval 是横切层。

所有写入都必须经过：

```text
Generate Patch
    ↓
Preview Diff
    ↓
Accept / Reject
    ↓
Write
    ↓
Optional Git Commit
```

AI 永远不能静默写盘。

## PendingAction

每个写操作返回 `PendingAction`。

```ts
interface PendingAction {
  id: string;
  title: string;
  description: string;
  patches: SemanticPatch[];
  touchedFiles: string[];
  diff: string;
  createdAt: string;
  status: "pending" | "accepted" | "rejected" | "applied" | "failed";
}
```

## Approval UI

第一版可以是 CLI：

```text
Pending Action: Update heroine injury state

Touched files:
- state/characters.yaml
- timeline/events.yaml

Diff:
...

[a] accept
[r] reject
[d] show diff
[q] quit
```

成熟 UI：

- Chat
- Tool Log
- Patch Preview
- Pending Actions
- Memory Preview
- Git Status

## Write Flow

```text
Tool Call
    ↓
SemanticPatch[]
    ↓
ApplyEngine.preview()
    ↓
PendingAction
    ↓
User Accept
    ↓
ApplyEngine.apply()
    ↓
Write files
    ↓
git diff / git status
    ↓
Optional commit
```

## Git Commit

Git commit 不应默认自动执行。

建议两种模式：

### Manual Commit

默认：

```text
Apply writes files.
User reviews git diff.
User commits manually.
```

### Assisted Commit

可选：

```text
AI proposes commit message.
User confirms commit.
```

示例：

```text
feat(novel): update heroine injury state

- set heroine hp to injured
- add timeline event for chapter 003
- create black mark foreshadow
```

## Rejection

用户 Reject 后：

- 不写文件。
- 保留 action log。
- 可让 AI 重新生成更小的 patch。

## Partial Acceptance

Chapter Completion Assistant 可能生成多个 patch。

用户应能逐个接受：

```text
[x] state/characters.yaml
[x] timeline/events.yaml
[ ] foreshadow/active.yaml
[x] summaries/chapter/003.md
```

实现方式：

- 每个 patch 独立 action。
- 或一个 action 内支持 patch selection。

MVP 优先前者。

## Rollback

由于 Git 是历史引擎，回滚优先使用 Git。

系统可以提供辅助工具：

- `git.status`
- `git.diff`
- `git.restoreFile`
- `git.commit`

但这些也应走用户确认。

## Validation Before Write

写入前必须验证：

- YAML 语法有效。
- Markdown frontmatter 有效。
- touched files 在小说项目根目录内。
- patch 没有修改 `.git/`。
- patch 没有修改 Constitution，除非是明确的 human-approved constitution update。
- patch 没有超出 Tool allowed files。

## Audit Log

建议记录：

```text
.storyforge/logs/actions.jsonl
```

每行：

```json
{
  "id": "action_001",
  "tool": "state.set",
  "status": "applied",
  "touchedFiles": ["state/characters.yaml"],
  "createdAt": "...",
  "appliedAt": "..."
}
```

注意：日志不是事实源。事实源仍是文件和 Git。

