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

## Git Integration Phases

Git 是 OAN 的历史引擎，但 Git 操作实现分阶段推进。

### Phase A: Global Git Command

当前实现优先假设用户电脑已经存在可用的全局 `git` 命令。

Git integration 层可以通过 Node.js `child_process.execFile` 调用：

```ts
execFile('git', ['-C', workspaceRoot, 'status', '--porcelain'])
```

要求：

- Git 命令只能在 backend / Electron main / Git integration 层调用。
- Vue frontend 只能调用 backend API，不能直接执行 Git 或访问 filesystem。
- 必须使用 `execFile` 或等价的非 shell API，不拼接 shell 字符串。
- 所有命令都必须显式使用 `-C <workspaceRoot>` 或等价 cwd，并锁定到当前 workspace root。
- `workspaceRoot` 必须来自 backend 当前 active workspace，不接受 frontend 任意传入。
- 文件参数必须是 workspace 内的相对路径，并使用 `--` 分隔 revision/option 与 file path。
- 不允许 frontend 传入任意 Git 子命令、shell 参数或可执行路径。
- Git 不存在、不是 Git 仓库、identity 未配置、remote 不存在、鉴权失败等错误必须以结构化错误返回 UI。
- Git 不可用时，读写链路仍可完成 PendingAction materialize，但 Git status / commit / sync 功能必须显示不可用或失败状态。

Phase A 的目标是先让本地开发和早期桌面版本可用，不要求打包内置 Git binary。

### Phase B: Bundled Git Binary

后续 Electron 打包版本应内嵌一个 Git 二进制，避免依赖用户系统环境。

要求：

- 应用启动时解析 bundled Git binary path。
- Git integration 层使用明确的 Git binary path，而不是默认搜索 `PATH`。
- UI 能区分 `globalGit` 和 `bundledGit` 的能力来源，便于诊断。
- 如果 bundled Git 在某个平台不可用，可以临时 fallback 到 global Git，但 UI 需要显示降级状态。
- 打包、签名和平台兼容性需要单独验证。

### Phase C: Git Library Wrapper

`simple-git` 可以作为后续包装层，用于把 Git 命令调用和结果解析收敛到更清晰的 TypeScript API。

约束：

- `simple-git` 只能运行在 backend / Electron main / Git integration 层。
- 即使使用 `simple-git`，也必须绑定到 Phase B 的 bundled Git binary。
- 不因为引入 wrapper 而放宽命令 allowlist、workspace boundary 或 Human Approval 边界。

## Git Command Boundary

第一版允许封装的 Git 能力：

| Operation | Command Shape | Notes |
| --- | --- | --- |
| availability | `git --version` | 只用于诊断 Git 是否可用。 |
| repo root | `git -C <workspace> rev-parse --show-toplevel` | 用于确认当前 workspace 是否在 Git 仓库内。 |
| head | `git -C <workspace> rev-parse HEAD` | 用于 index stale 判断和历史状态。 |
| status | `git -C <workspace> status --porcelain` / `--short` | 用于 clean/dirty 和 quick commit 文件列表。 |
| diff | `git -C <workspace> diff -- <files...>` | 只读取 diff，不写入。 |
| log | `git -C <workspace> log --oneline --decorate --max-count <n>` | 第一版只展示列表。 |
| show | `git -C <workspace> show --name-status --format=fuller <commit>` | commit detail 只接受已验证 commit hash。 |
| add | `git -C <workspace> add -- <files...>` | 只允许 accepted PendingAction touchedFiles 或用户确认的 quick commit files。 |
| commit | `git -C <workspace> commit -m <message>` | 只能发生在 Human Approval 后。 |
| fetch | `git -C <workspace> fetch` | 同步能力第一版可选。 |
| pull | `git -C <workspace> pull --ff-only` | 禁止自动 merge/rebase。 |
| push | `git -C <workspace> push` | 失败只提示，不回滚本地 commit。 |

第一版禁止：

- 任意 shell 命令。
- 任意 Git 子命令 passthrough。
- `git reset --hard`、`git clean`、`git checkout -- <file>` 等 destructive 操作，除非后续设计了明确的用户确认和恢复策略。
- 自动处理 merge conflict。
- 自动创建、删除、切换 branch。

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

Phase A 中，自动提交通过用户电脑上的全局 `git` 命令完成。后续 Phase B 再切换为 Electron 内嵌 Git binary。这个切换不应改变 Human Approval 语义、API 返回形状或用户看到的审批流程。

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
- 提交前必须校验 `git status --short -- <touchedFiles>` 确认实际 dirty 范围和 touched files 对齐。
- PendingAction reject 不创建 commit。
- 自动提交失败时展示错误，保留已经 materialize 的文件和可见 dirty 状态。
- 自动提交失败不回滚已写入文件。
- 没有 Git 仓库、全局 Git 不可用、commit identity 缺失等错误都必须可见。
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
- 提交前必须再次读取 Git status，避免提交用户未看到的新变更。
- Quick commit files 必须来自 backend 返回的 dirty file list 或 accepted PendingAction touched files，不能接受 frontend 任意路径。
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

Phase A 中，外部编辑器入口和内置 Git 页面都可以复用用户系统 Git。Phase B 切换到 bundled Git 后，外部编辑器仍然使用编辑器自身 Git 能力；OAN 内置 Git 页面使用 bundled Git。

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
