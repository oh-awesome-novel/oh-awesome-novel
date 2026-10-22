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

作者 Markdown 旧稿导入同样是 deterministic producer，使用 `chapter.edit` 和 exact create-only targets；输入/映射经 immutable prepared preview 绑定，用户创建候选后沿同一审批链落盘，不增加模型工具或绕过审批的 API。见 [1300](tasks/1300.md)。

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

### Model Reasoning

- `RuntimeModelStreamEvent` / `RuntimeEvent` 的 `reasoning_delta` 携带模型思考文本；assistant `RuntimeMessage.reasoning` 保存同一步的完整思考。
- 思考只在产生它的 turn 内回传：工具调用步骤的 assistant message 带 `reasoning`，AI SDK adapter 把它转成 `reasoning` part（DeepSeek 等要求在工具循环里回传 `reasoning_content`）。turn 开始时 Runtime 去掉输入历史中的 `reasoning`，turn 结束进入 `doneMessages` 前也会去掉，因此跨轮请求永不包含历史思考。
- `RunTurnResult.messages` 保留本轮思考，session store 原样写入 `messages.jsonl` 供调试；它不进入 PendingAction、context trace 或 Git。
- 模型配置 `LlmProviderModel.reasoningEffort`（`none` 到 `max`）存在时作为 AI SDK `reasoning` 选项传给 `streamText`；未配置时请求不带该选项。非 OpenAI 官方且配置了 `baseUrl` 的 provider 通过 `@ai-sdk/openai-compatible` 解析，以便读取并回传 `reasoning_content`。
- UI stream adapter 把 `reasoning_delta` 转成 `reasoning-start/delta/end` chunk；Copilot 在回答前以默认折叠的“思考过程”展示，复制按钮只复制正文。

### Steer And Follow-up

- `RunTurnInput.steering` 是宿主拥有的 `RuntimeSteeringSource`（`drain()` / `close()`）。Runtime 在两处轮询：每个工具批次执行完、下一次模型请求之前；以及模型给出无工具回答之后——此时若有插话，回答与插话都进入 `curMessages`，循环继续。工具执行中到达的插话等工具结束后生效；`maxToolLoops`、顺序执行、active tools、capability、`exactWritablePaths` 与预算检查都不因插话改变。
- 每条插话以 `role: 'user'`、host-only `delivery: 'steer'` 进入本轮消息（provider 请求不含该标记，`messages.jsonl` 保留），并发出 `steering_applied`。
- 进入 `finish()` 或失败路径时先 `close()`，再把关闭前已被接受却未送达模型的插话以 `steering_rejected` 交还；finalizer 只在关闭之后运行，一轮仍只有一个 finalizer 批次。
- Backend：`/api/agent/chat` 的请求可带 renderer 生成的 `turnId`（必须同时有 `sessionId`），宿主为该 turn 打开插话队列；流结束（含异常与 abort）即注销。`POST /api/agent/chat/:sessionId/steer` 只接受 `{ turnId, content }`（1–20000 字符），未知字段 400；turn 不存在或已收尾返回 409 `STEER_TOO_LATE`。没有 runtime loop 的路径结束时同样把未消费的插话以 `steering_rejected` 交还。
- UI stream 用 `data-steering`（`status: applied | rejected`）在助手消息中按时间位置标出插话。
- Follow-up 完全在 renderer：每个对话一个内存队列，运行中按发送快捷键入队；本轮 `stoppedReason === 'completed'` 且没有新的 PendingAction 时依次发出（每条都是新 turn、自己的 finalizer 批次）；失败、停止、未正常完成或产生待审批修改时暂停，作者点“继续发送”后恢复；被交还的插话放回队首。队列不跨应用重启保留。

## Context Builder

`1290` 将当前全局状态与章级结算历史分层。host health 与 Agent 对同类冻结输入采用共同的 source-hash freshness evaluator，模型上下文中的健康提示/覆盖说明有界。选中章的当前证据可派生为明确标注的 payload，其余历史仍由固定投影 read tools 提供；完整显式选择保持保护。摘要的当前证据、过期来源和作者未验证参考必须明确区分，不把旧快照当作当前事实。详见 [1290](tasks/1290.md)。

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
