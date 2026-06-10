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
Materialize accepted shadow write
    ↓
Git Commit if auto-commit is enabled
```

AI 永远不能静默写盘。

AI 只能产生文件修改建议和 `.workspace` shadow write。Accept 前真实 workspace 文件不变，Git working tree 不应因为 AI 建议而 dirty。

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
.workspace shadow write
    ↓
User Accept
    ↓
ApplyEngine.apply()
    ↓
Write files
    ↓
git diff / git status
    ↓
auto-commit enabled?
    ↓ yes
git add accepted touched files
    ↓
git commit generated message
    ↓ no
visible dirty state + quick commit button
```

## Git Commit

Git commit 和 AI 自主行为无关。AI 只生成 PendingAction 建议，不能在 Human Approval 前写入真实文件或提交 Git。

PendingAction 被用户 Accept 后，Git integration 默认自动提交本次 PendingAction 的 touched files。

自动提交必须可配置。第一版使用 workspace 配置：

```yaml
git:
  autoCommitOnAccept: true
```

默认值是 `true`。如果用户关闭该配置，Accept 只 materialize shadow write 到真实 workspace 文件，随后展示 dirty 状态，并提供快捷提交入口。

默认流程：

```text
AI proposes change
    ↓
.workspace shadow write
    ↓
User reviews PendingAction diff
    ↓
User accepts
    ↓
Materialize touched files
    ↓
autoCommitOnAccept?
    ↓ true
git add accepted touched files
    ↓
git commit with generated message
    ↓ false
show dirty state and Commit now button
```

自动提交必须满足：

- 只提交 accepted PendingAction 的 `touchedFiles`。
- 不提交 workspace 中其它 dirty 文件。
- PendingAction reject 不创建 commit。
- 自动提交失败时展示错误，保留已经 materialize 的文件和可见 dirty 状态。
- 自动提交失败不回滚已写入文件。
- 没有 Git 仓库、Git binary 不可用、commit identity 缺失等错误都必须可见。
- 后续自动同步只能在自动提交成功后触发。
- `git.autoCommitOnAccept: false` 时不得自动 commit，也不得自动 sync。

Commit message 第一版使用确定性模板：

```text
chore(novel): apply pending action <short-id>

<PendingAction title>
```

后续可以让 AI 建议 commit message，但 commit 仍只能发生在用户 Accept PendingAction 之后。

### Quick Commit

关闭自动提交后，UI 必须提供随时可用的快捷提交入口，让用户可以在任何想提交的时候提交当前 dirty 变更。

快捷提交要求：

- 入口可出现在 workspace toolbar、Git 页面和 PendingAction accept 成功后的 dirty 状态提示中。
- 点击后展示当前 dirty 文件列表和 diff。
- 用户必须能确认 commit message。
- 默认提交范围可以是当前 dirty files，但 UI 必须清楚展示将被提交的文件。
- 快捷提交是用户显式 Git 操作，不属于 AI 自主行为。
- 快捷提交成功后刷新 Git status / Git history。
- 快捷提交失败时展示错误，并保留 dirty 状态。

### Manual Git Operations

用户可以通过外部编辑器或 Git 页面手动执行 Git 操作。这类操作属于用户显式手动行为，不属于 PendingAction auto commit。

示例：

```text
User opens workspace in VS Code / Zed / WebStorm.
User uses editor Git UI.
Application later refreshes Git status/history.
```

手动 Git 操作不能绕过 PendingAction 写入链路：AI 发起的文件修改仍必须先进入 `.workspace` shadow write，并等待用户 Accept。

### Assisted Commit Message

可选后续能力：AI 可以建议 commit message 文案，但不能决定是否提交，也不能扩大提交文件范围。

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
[x] summaries/chapter/0001/0003.md
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
.oan/logs/actions.jsonl
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
