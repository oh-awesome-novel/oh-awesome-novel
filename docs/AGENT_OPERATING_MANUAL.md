# Agent Operating Manual

本文件面向进入仓库的 Codex、Claude Code、Aider 等开发 Agent。项目级 `AGENTS.md` 优先级更高；本手册解释稳定架构与日常操作边界。

## Project Identity

`oh-awesome-novel` 是 filesystem-first 的长篇小说 AI Copilot / Novel IDE，不是通用 Agent framework、coding-agent 平台、多 Agent 编排系统或隐藏自治写作系统。

```text
Markdown / YAML / Object File Tree = database
Git = history engine
AI = copilot
Human = final authority
```

## Read Before Changing Code

1. `docs/ARCHITECTURE.md`
2. `docs/DEVELOPMENT_PLAN.md`
3. `docs/AGENT_OPERATING_MANUAL.md`
4. 当前 task 的 `docs/tasks/<id>.md`
5. task 列出的全部 Related Plans

涉及写入基础设施时再完整阅读：

1. `docs/FILESYSTEM_SPEC.md`
2. `docs/SANDBOX_CHANGE_ENGINE.md`
3. `docs/HUMAN_APPROVAL_AND_GIT.md`
4. `docs/adr/0004-sandbox-change-engine.md`

早期讨论、Superseded ADR、历史计划和参考项目不能覆盖这些当前合同。

## Repository Layout

- `packages/*`：核心能力。
- `apps/*`：桌面、renderer 和启动器。
- `__test__/<module>/`：独立测试 workspace。
- `docs/tasks/*.md`：scope/status/done criteria。
- `docs/superpowers/plans/*.md`：对应 task 的实施步骤。

不要新增旧式根目录 `src/`。测试不得放入 `packages/*/src/__tests__`。

## Architecture Formula

```text
Filesystem-first Novel IDE
  + Aider-style Runtime
  + Vercel AI SDK ToolSet
  + in-memory bash-tool / just-bash editing
  + CandidateChangeSet + PendingAction
  + ChangeMaterializer
  + Git diff human approval
```

## File Modification Rules

AI 发起的 canonical 修改必须遵循：

```text
trusted host selects capability
  -> fixed InMemoryFs projection
  -> sandbox editing or deterministic producer
  -> CandidateChangeSet
  -> PendingAction + diff
  -> human Accept
  -> ChangeMaterializer
  -> Git
```

### Never Bypass Approval

- Accept 前不写真实目标文件。
- Accept 不重放 shell command，不解析 diff。
- `changes` 是唯一 authority。
- 内部 immutable draft/recovery 可写入 `.workspace/change-engine/v1/`，但调用方不能把内部目录作为编辑目标。
- Git auto-commit 只能发生在 durable Accept 后。

### Sandbox Boundary

- 模型只见 allowlisted fixed projection。
- arbitrary host shell、host filesystem、network、Python、JavaScript 与 host process 禁止。
- capability 只能由可信 workflow 选择；unknown 为 `read-only`。
- read/enumeration 与 write 都必须通过 `PolicyFs`。
- 每个 writable file family 先有完整 final-content validator。
- command/output/snapshot/scratch/candidate/diff 都有独立 limits。

### Deterministic Workflows

Reference publish/adopt 与 Play adopt 可以直接生成 ChangeSet，不需要转为 shell source。它们仍必须携带 exact target policy、origin freshness、repository baseline，并进入同一 store/materializer。

## Runtime Rules

Runtime 只实现：

```text
LLM -> Tool Call -> Execute -> Append Result -> LLM
```

不得加入 Planner、Multi-Agent Runtime、autonomous background execution 或 hidden retry loop。AI SDK 只作为 ToolSet/model streaming 层，不能用另一个 framework 替换项目 Runtime。

同一 turn 共享一个 `SandboxEditSession`。completed/max-loop dirty state 可由 host finalizer fallback propose；abort/fatal error discard 未持久化候选。run/stream 必须 `finally` dispose。

原始 bash args 只存在于 transient execution；messages/events/SSE/session artifacts 只能保存 bounded command preview/hash。

## Package Boundaries

- `core`：纯合同、config、domain validation，以及明确隔离的 workspace / Play / Reference 文件存储。
- `tools`：read tools、projection/sandbox、ChangeSet/store/materializer/producers。
- `runtime`：provider-agnostic loop 与通用 finalizer seam。
- `agent`：prompt/context/provider/tool/session composition。
- `backend`：localhost HTTP/SSE 与 trusted controller routing。
- `client`：strict DTO guards。
- `desktop-ui`：展示与用户操作，不接触内部 artifact 或 filesystem。

不要让 frontend 绕过 backend；不要让 runtime import agent/tools；不要在 tools 中建立第二套 Tool abstraction。

## Filesystem-first Discipline

- Novel truth 放在 Markdown/YAML/Object File Tree。
- Git 历史可以解释所有 accepted canonical change。
- projection、index、chat、preview、PendingAction 与 recovery 是可重建或 disposable state，不得冒充 truth。
- 与小说内容有关的新持久数据优先加入对象文件树，不藏在私有数据库或全局内存。
- symlink、hidden path、secret/provider config 与 non-regular file 不进入模型 projection。

## Human Approval And Git

- auto commit 只 stage accepted action paths。
- unrelated staged/dirty work 不能混入。
- Git failure 不回滚 durable accepted canonical change；记录 receipt 并提供 quick commit。
- `git.autoCommitOnAccept: false` 时不得自动 commit 或 sync。
- 手动 Git 操作属于用户行为，不能成为 AI 绕过 PendingAction 的路径。

## Internal-state Reset

开发迁移只可在完成 Git tracked-file assertion、status/manifest 记录和 exact realpath validation 后删除：

```text
<workspace>/.workspace/
<workspace>/.oan/sessions/
```

禁止删除 workspace root、`.git/` 或整个 `.oan/`。reset 前后的 canonical SHA-256 manifest 与 Git status 必须一致；未提交 canonical 修改要保留，不能自动 commit/stash/discard。

## Coding Style

Prefer:

- small focused TypeScript files
- explicit types and strict parsers
- deterministic serialization
- composition over abstraction
- fail-closed errors with stable codes
- root-level module tests through package entrypoints
- operation/crash-boundary tests for persistent state

Avoid:

- deep inheritance or reflection-heavy systems
- hidden global state
- compatibility fallback without an explicit current design decision
- raw shell strings for host Git/filesystem operations
- diff parsing as business logic
- broad wildcard policies

## Task Status Discipline

- `Completed`：代码或文档已经落地并通过 done criteria。
- `Needs Review`：已有实现，但新 plan 暴露出复核/补测/补实现需求。
- `Planned`：尚未实现。
- `Blocked`：需要新设计决策或外部条件。

对 `Needs Review` 先按 Related Plans 复核代码/测试，再更新 task status 和 Implementation Notes。历史事实放入明确、带日期的 `Historical Implementation Notes`，不能与当前 Goal/Constraints 混写。

## Final Review Checklist

- 是否保持 filesystem-first 与 Git history？
- 是否只有 fixed in-memory shell，而没有 host shell？
- 是否由 host 选择 capability 并完整校验 final files？
- 是否在 Accept 前保持 canonical bytes 不变？
- 是否只从 structured changes 派生 UI/file scope？
- 是否覆盖 abort、stale、rollback、commit point 与 Git failure？
- 是否没有引入双引擎、兼容 reader 或旧 state migrator？
- 测试是否位于正确 root workspace 并通过 package entrypoint？
