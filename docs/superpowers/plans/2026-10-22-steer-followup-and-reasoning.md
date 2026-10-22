# Steer / Follow-up 与推理过程执行计划

Related task: [1350](../../tasks/1350.md)

> Status: Planned（2026-10-22）。依赖升级适配（`chore/deps-upgrade-adapt`）合入 `main` 之前不开始改代码。

## 背景

2026-10-22 评估了把底层切换为 pi agent 的方案，结论是不切换（见 1350 Background）。pi-agent-core 的 `steer()` / `followUp()` 和 pi-ai 的统一 thinking 是两项值得吸收的能力，本计划在现有 AI SDK + Aider-style Runtime 内实现它们。

顺序原则：先做风险最小、只增不改的推理展示（Phase 1），再做 Copilot 的 steer / follow-up（Phase 2），最后做 Play（Phase 3）。每个 Phase 独立可合入、可回退。

## 已核实的事实

- `@ai-sdk/openai@4.0.99` 的 chat 模型不解析 `reasoning_content`；`@ai-sdk/openai-compatible@3.0.75` 会解析 `delta.reasoning_content ?? delta.reasoning`，并在后续请求中把 assistant reasoning part 回传为 `reasoning_content`。当前 `createAiSdkProviderResolver` 对所有 provider 都用 `createOpenAI(...).chat()`，所以 DeepSeek / MiMo / opencode-go / Ollama 的思考内容现在被丢弃。
- `ai@7` 完整流（`result.stream`）里有 `reasoning-start` / `reasoning-delta` / `reasoning-end` part；UI message 协议有对应 chunk，`@ai-sdk/vue` 会生成 `type: 'reasoning'` 的 message part。
- 当前 adapter（`packages/agent/src/index.ts` `streamAiSdkModelResponse`）、Play actor / referee（`packages/agent/src/play-rehearsal.ts`）都只消费 `text-delta`；`ChatTranscript.vue` 只渲染 `text` part。
- Runtime 每轮在 `for (loop …)` 中顺序执行"模型请求 → 工具批次"，`curMessages` 在 `finish()` 时并入 `doneMessages`；没有活跃 turn 注册表，Copilot 取消依赖 HTTP request `abortSignal`。
- Play world-referee turn 用 `state.activePlayTurns` 加锁，运行中再次提交返回 409；`PlayComposer` 在 busy 时禁用输入。已有 `/turns/:turnId/cancel` 与 `baseRevision` 校验。
- Play rehearsal 已有 Director `redirectStep`（1190），带约束闭包校验。
- `packages/core/src/play-rehearsal-turn.ts` 明确"private model reasoning is forbidden"进入 context trace；Play prompt 要求输出不含私有推理。
- usage 已归一化 `reasoningTokens`（`normalizeSdkUsage`）。

## Phase 0：开工前

1. 确认 `chore/deps-upgrade-adapt` 已合入，`main` 上 `npm run quality` 基线通过；记录 ai / @ai-sdk/* 实际版本，重新核对上面的 SDK 事实。
2. 从最新 `main` 开分支；实现过程中 1350 保持 `Planned`，代码落地后再按实际情况改为 `Completed` 或 `Needs Review`。

## Phase 1：推理过程展示与配置

### 1.1 Provider 层

- `packages/core/src/llm-provider.ts`：`LlmProviderModel` 增加可选 `reasoning?: { supported?: boolean; effort?: 'off' | 'low' | 'medium' | 'high' }`。旧配置无此字段时行为不变。
- `packages/agent/src/index.ts` `createAiSdkProviderResolver`：`openai` 继续用 `@ai-sdk/openai`；`openai-compatible` / `deepseek` / `opencode-go` / `xiaomi-mimo` / `ollama` / `custom` 改用 `@ai-sdk/openai-compatible` 的 `createOpenAICompatible(...).chatModel()`。先在 mock fetch 上对比两者请求体，确认只在 reasoning 相关字段上有差异，避免改变其它请求行为。
- 推理强度：按 provider 映射到 `providerOptions`（OpenAI `reasoningEffort`；compatible 的 `reasoningEffort`）。`effort: 'off'` 或未配置时不发送。
- `packages/agent/src/context-budget.ts`：推理模型的输出预留包含思考 token；只在配置了 `reasoning.supported` 时调整，避免改变现有预算。

### 1.2 Runtime 事件

- `packages/runtime/src/types.ts`：
  - `RuntimeModelStreamEvent` 增加 `{ type: 'reasoning_delta'; text: string }`。
  - `RuntimeEvent` 增加 `{ type: 'reasoning_delta'; text: string }`。
  - `RuntimeMessage` 增加 host-only 字段 `reasoning?: string`（与 `provenance` 同样处理：不进入持久化，不计入 provenance）。
  - `RuntimeModelResponse.message` 可带 `reasoning`。
- `packages/runtime/src/runtime.ts` `generateModelResponse`：转发 `reasoning_delta`；带工具调用的 assistant 消息保留 `reasoning`，供本轮后续请求回传；`finish()` 并入 `doneMessages` 前剥离 `reasoning`，跨轮不回传。
- `packages/agent/src/index.ts` adapter：消费 `reasoning-delta`；`toModelMessage` 在 assistant 消息有 `reasoning` 时生成 reasoning part（交给 SDK 决定是否回传）。

### 1.3 UI 流与 Copilot 展示

- `packages/agent/src/ui-stream.ts`：`reasoning_delta` 映射为 `reasoning-start` / `reasoning-delta` / `reasoning-end` chunk；出现正文或工具调用时关闭 reasoning part。
- `apps/desktop-ui/src/components/agent-checkpoint/ChatTranscript.vue`：渲染 `reasoning` part 为"思考过程"折叠块，流式时显示"思考中…"；复制回复、引用到写作等操作只取 `text` part。
- `packages/agent/src/session-store.ts`：持久化 UIMessage 前过滤 `reasoning` part。重新打开会话后不显示历史思考过程（在 UI 上说明）。
- `AgentUsageInspector.vue`：展示 `reasoningTokens`。
- 设置页：模型条目增加"推理强度"选项，仅当 `reasoning.supported` 时显示。

### 1.4 Play 展示

- `play-rehearsal.ts` actor / referee：消费 `reasoning-delta`，以单独事件类型（如 `reasoning_delta`）产出；`partialText`、输出长度上限、settlement 解析只看正文。
- Backend Play SSE：增加 `reasoning_delta` 事件类型，只转发不落盘；`play-turn-run-receipt`、artifact、evidence、context trace 不接收它。
- Desktop：`PlayTranscript` / rehearsal step 生成中显示可折叠的思考过程，settle 后清除。

### 1.5 测试

- `__test__/agent`：mock compatible provider 返回 `reasoning_content` 流 → adapter 产出 `reasoning_delta`；带工具调用的多步请求体中回传 `reasoning_content`，跨轮不回传；未配置推理时请求体与现在一致。
- `__test__/runtime`：`reasoning_delta` 透传；`doneMessages` 不含 `reasoning`。
- `__test__/backend`：session 文件、Play 会话文件、receipt、context trace 中不出现思考文本（用唯一标记字符串断言）。
- `__test__/desktop-ui`：折叠块渲染、复制只取正文、无 reasoning 时 DOM 不变。

## Phase 2：Copilot steer / follow-up

### 2.1 Runtime steering 接口

- `RunTurnInput` 增加 `steering?: { drain(): RuntimeSteeringMessage[] }`，`RuntimeSteeringMessage = { id: string; content: string }`。
- 轮询点：
  1. 每次工具批次执行完、下一次模型请求之前；
  2. 模型给出无工具最终回答后：若有排队 steer，把回答和 steer 一起追加到 `curMessages`，继续循环而不是 `finish()`。
- 每条 steer 以 `role: 'user'` 进入 `curMessages`，并发出 `{ type: 'steering_applied'; message }` 事件。
- 不变：`maxToolLoops` 计数、顺序工具执行、`listActiveTools` 依据 turn 开始时的 skill、预算 overflow 检查同样覆盖 steer 文本、abort 语义。
- 进入 `finish()` / `failTurn()` 后不再 drain；之后到达的 steer 由宿主拒绝。

### 2.2 Backend

- `handleAgentChat`：为每个运行中的 turn 注册 `{ sessionId, turnId, queue, state: 'running' | 'finalizing' }`，turn 结束（含异常、abort）时注销。
- 新端点 `POST /api/agent/chat/:sessionId/steer`，body `{ turnId, content }`：
  - 无活跃 turn、`turnId` 不匹配或已 `finalizing` → 409，带 `code: 'STEER_TOO_LATE'`，前端改为 follow-up；
  - 内容长度上限与普通消息一致；经过同样的 request guard。
- steer 不得携带 capability、目标路径、附件、Play 引用等字段；schema 严格拒绝未知字段。

### 2.3 Client / UI

- `packages/client`：`steerAgentTurn(sessionId, turnId, content)`。
- `useAgentCheckpointChat.ts`：
  - 运行中输入框保持可用；两种发送："插话"（steer）与"排队"（follow-up）。
  - follow-up 队列保存在会话 composable 内存中，可编辑、删除、调整顺序；`message_finish` 且 `stoppedReason === 'completed'` 时发送队首。
  - 本轮 `error` / `aborted` / `max_tool_loops`，或本轮产生了待审批 PendingAction 时，队列暂停，显示"继续发送"。
  - steer 被 409 拒绝时自动转入 follow-up 队列队首并提示。
- `ChatTranscript.vue`：steer 消息显示"插话"标记；队列显示在输入框上方。

### 2.4 测试

- Runtime：工具批次间注入；最终回答后注入并继续；工具执行中到达的 steer 在工具结束后生效；`finish()` 后 drain 不再调用；steer 不改变 active tools。
- Backend：steer 端点 200 / 409 / 400；turn 异常和 abort 后注册表清空；steer 携带额外字段被拒绝。
- Desktop UI：队列在完成后发出、在 PendingAction 待审批时暂停、409 回落为排队。

## Phase 3：Play steer / follow-up

### 3.1 World-referee turn

- Steer：前端在 turn 运行中提交补充文本 → 调用已有 cancel → 等待 cancel 确认（锁释放）→ 以"原行动 + 补充"重发同一 `baseRevision` 的 turn。无需新 Backend 端点和 schema 字段；必须保证 cancel 后不残留 artifact 或 receipt（补回归）。
- Follow-up：前端队列；settle 成功后用新 `session.revision` 作为 `baseRevision` 提交队首。revision 冲突、settle 失败、source drift 待决策时暂停队列。
- `PlayComposer.vue`：busy 时输入框可用，提交按钮变为"插话"/"排队"两种，保留停止按钮。

### 3.2 Rehearsal

- actor 生成中 steer：取消当前 step 流，作为该 step 的 `redirectStep` intent 提交（复用 1190 的约束闭包校验）。不新增 Director mutation。
- follow-up：rehearsal 中只允许排队下一条 Director 干预或行动，在当前 step 完成后按序提交。

### 3.3 测试

- Backend：cancel 后重发不产生孤立 artifact；follow-up revision 冲突返回 409 且不改会话。
- Desktop UI：PlayComposer 运行中两种发送；队列暂停条件；rehearsal steer 走 `redirectStep`。

## 文档同步

- `docs/AGENT_RUNTIME_AND_TOOLS.md`：Runtime 轮询点、reasoning 事件与剥离规则。
- `docs/PLAY_MODE_SPEC.md`：Play steer = cancel + 重发；思考内容不落盘。
- `wiki/` 用户文档：插话与排队的用法、推理强度设置。
- 完成后更新 1350 Implementation Notes / Verification，并在 `docs/tasks/README.md` 调整状态。

## 风险

- 换用 `@ai-sdk/openai-compatible` 可能改变个别 provider 的请求细节（如 `stream_options`、错误格式）。缓解：先做请求体对比测试，必要时只对确认支持推理的 kind 切换。
- 部分 provider 在工具调用多步中强制要求回传 `reasoning_content`，漏传会 400。缓解：Phase 1.2 的本轮回传与 mock 回归。
- Steer 让单轮更长，可能更容易触发预算 overflow。缓解：overflow 时提示作者把 steer 改为 follow-up。
- Play cancel 与重发之间的竞态。缓解：前端等锁释放（cancel 响应）后再重发，Backend 锁语义不变。

## 待作者确认

1. 运行中按 Enter 默认是"排队"还是"插话"？建议默认排队，`Cmd/Ctrl+Enter` 插话。
2. 思考过程默认折叠还是展开？建议折叠。
3. Play 中是否默认显示思考过程？建议默认关闭，可在 Play 设置中打开，以免影响沉浸感。
4. 是否需要在会话重新打开后仍能看到历史思考过程？建议不保留（只在内存中），与"不落盘"约束一致。
