# Agent Runtime And Tools

## Goal

实现极简、可观察、可控的小说 Copilot Runtime，并把每个写 turn 绑定到一个固定内存编辑 session。

```text
LLM -> tool calls -> execute -> append results -> LLM
```

不实现 Planner、Multi-Agent、Subagent orchestration、后台自治循环、隐藏重试或通用 Agent framework。

## Package Responsibilities

### `packages/runtime`

- 接收 `RuntimeModelAdapter`、AI SDK `ToolSet` 与通用 async turn finalizer。
- 执行 provider-agnostic Aider-style loop。
- 维护 messages、bounded tool audit、PendingAction views 和 RuntimeEvents。
- 输出 text/tool/pending/error/finish events。
- 不 import `packages/agent` 或 `packages/tools`，不认识 filesystem、HTTP、Vue 或具体 provider。

### `packages/agent`

- 组装 Constitution、Workflow、Writing Profile、Skill、selection 和 ContextPackage。
- 从可信 user-facing action 推导 edit capability；未知 action 使用 `read-only`。
- 为每个 turn 创建一个 `SandboxEditSession`，并把同一固定 projection 注入 read/edit tools。
- 组合 provider adapter、ToolSet、runtime 与 finalizer。
- 在 run/stream 的 `finally` 中 dispose session。
- 把 RuntimeEvent 转换为 Vercel AI UI stream/SSE。

### `packages/tools`

- 定义 AI SDK read tools 和 sandbox toolset。
- 构造 fixed projection、`InMemoryFs -> TrackingFs -> PolicyFs -> Bash`。
- finalize `CandidateChangeSet`，persist PendingAction，并提供 deterministic producers/materializer。
- 不实现 model loop。

### Backend / Client / UI

- Backend 只做 localhost transport、trusted workflow routing 与 domain controller composition。
- Client strict parse public DTO。
- Vue 使用 `@ai-sdk/vue`，不直接执行 tools/filesystem/Git/materializer。
- Electron main 负责 backend 生命周期和 packaged dependency resources。

## Turn Flow

```text
User request
  -> host selects workflow/capability
  -> snapshot repository + allowlisted canonical files
  -> create one SandboxEditSession
  -> build context from that projection
  -> RuntimeModelAdapter.stream()/generate()
  -> read tools or sandbox tools
  -> append bounded results
  -> explicit propose or host fallback finalize
  -> pending_action events
  -> message_finish
  -> dispose session
```

建议默认 `maxToolLoops = 8`。tool error 作为结构化 tool result 返回，使模型可以在当前 VFS 中修正；fatal provider/runtime error 走 error finish。

## ToolSet

实现只使用 AI SDK `ToolSet`、`tool()`、`jsonSchema()` 与 streaming/generation API。不得定义第二套 `StoryTool`、`RuntimeToolRegistry` 等抽象。

### Read Tools

典型只读工具：

```text
character.get
character.list
world.search
chapter.get
state.get
timeline.list
foreshadow.list
summary.get
constitution.get
workflow.get
```

文件型 read tools 在写 turn 中必须读取 session projection，不得重新读取实时 host files。

### Sandbox Tools

模型可见编辑能力：

- `bash`：受限命令、bounded output。
- `readFile`：要求 range/limit，返回总 byte/line 与 truncation。
- `writeFile`：只写 PolicyFs 允许的 virtual path。
- `workspace.previewChanges`：bounded summary/diff excerpt，不创建 action。
- `workspace.proposeChanges`：seal session，persist action once，返回 public view。

领域业务意图通过 host capability、prompt 和 policy 表达，不再为每个写动作创建专用 canonical-write tool 名称。

### Deterministic Producers

Reference publication/adoption、Play adoption 等 host workflow 可以直接使用 builder/virtual writer 生成 ChangeSet。它们不向模型暴露 shell，也不伪造 command log，但仍必须通过 exact policy、final validators、PendingAction 与 materializer。

## Capability Selection

capability 是 trusted host input，不是 tool argument：

```text
read-only
chapter.edit / character.edit / world.edit
state.edit / timeline.edit / foreshadow.edit
summary.edit / outline.edit
novel.multi-file-edit
reference.publish / reference.adopt / play.adopt
```

General chat、unknown skill 或缺失 mapping 均为 `read-only`。明确作者编辑 action 才能获得 writable capability。producer controller 只能传 exact target list。

Skill 是 Prompt Pack + Allowed Tool List。Tool filtering 不能扩大 capability；即使 Skill 暴露了 `bash`，PolicyFs 仍是最终强制边界。

## Session Finalization

Runtime 只依赖通用 finalizer：

```ts
interface RuntimeTurnFinalizer {
  finalizeTurn(input: {
    stoppedReason: 'completed' | 'max_tool_loops' | 'aborted' | 'error';
    pendingActions: PendingActionView[];
    abortSignal?: AbortSignal;
  }): Promise<PendingActionView[]>;
}
```

冻结行为：

- completed + clean：不创建 action。
- completed/max loops + dirty + no explicit propose：创建一个 `runtime-fallback` action。
- explicit propose：不重复创建。
- abort：终止当前 bash execution，discard unpersisted candidate。
- fatal error：discard unpersisted candidate；已持久化 action 保留。
- finalizer failure：emit error，不继续成功 finish。
- pending action 必须先 merge state、逐个 emit，再 emit message finish。

所有路径最终 dispose，dispose 后工具调用必须失败。

## Runtime Messages And Audit

模型执行命令需要 transient raw input，但持久/可见状态只保留：

- tool call id/name
- escaped bounded `commandPreview`
- command SHA-256
- truncation/source/output counts
- bounded result/error summary

原始 bash command、heredoc 正文和可重放 args 不进入 Runtime state、event、message finish、SSE、UI log 或 session artifact。stdout/stderr 去 ANSI 与危险控制字符，renderer 使用纯文本节点。

PendingAction source 只记录 command log hash/count，不记录 preview。

## Context Builder

优先级：

```text
Novel Constitution
Workflow + Writing Profile + Skill
Current User Request
Explicitly Selected Files
Recent/Previous Chapter
Summaries
State + Timeline + Foreshadow
```

默认不加载整本小说。context/source trace 必须区分 canonical files、derived projections 与 external reference，并记录 freshness evidence。

## Public PendingAction Result

工具和 Runtime 只处理 public view：

```ts
interface PendingActionView {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  changes: Array<{
    operation: 'create' | 'update' | 'delete';
    path: string;
    oldHash?: string;
    newHash?: string;
  }>;
  diff: string;
  origin?: PublicPendingActionOrigin;
  git?: PublicPendingActionGitResult;
}
```

不得暴露 stored draft path、candidate full content、repository internal id 或 shell source。

## Error Handling

可恢复 tool error：

```json
{
  "ok": false,
  "error": {
    "code": "WORKSPACE_POLICY_VIOLATION",
    "message": "The requested path is not available in this edit session.",
    "recoverable": true
  }
}
```

错误信息不能泄露未投影路径、secret、host absolute path 或内部 artifact location。stale repository/origin/projection 与 unsupported internal schema 必须 fail closed，不自动重新解释。

## Frontend Transport

```text
@ai-sdk/vue
  -> localhost HTTP/SSE
  -> packages/agent UI stream adapter
  -> packages/runtime RuntimeEvent
```

内部 RuntimeEvent 是唯一 runtime boundary。Backend 不成为第二个 loop；Electron renderer 不新增 IPC-only stream。PendingAction list/read/decision 使用 strict HTTP DTO 与同一 public view。

## Minimal Vertical Slice

```text
Author requests a chapter/state/timeline update
  -> trusted workflow selects exact/multi-file capability
  -> model reads and edits fixed VFS
  -> finalizer creates CandidateChangeSet
  -> PendingAction shows create/update/delete diff
  -> author Accepts
  -> ChangeMaterializer writes transactionally
  -> Git auto-commit or explicit quick commit
```
