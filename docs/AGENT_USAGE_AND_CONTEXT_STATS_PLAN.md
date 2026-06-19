# Agent Usage And Context Stats Plan

> Status: Planning
> Related Task: [1110 Agent Usage And Context Stats](tasks/1110.md)

## Goal

为 OAN agent copilot 增加可审计的 message token、context token 和 provider usage 统计。

本计划只定义后续实现方向，不代表当前代码已经完成该能力。

## Current State

OAN 当前已经具备一部分上下文治理基础：

- `ContextPackage` 已记录 selected / omitted source、reason、budgetLayer 和 semanticBoundary。
- runtime context builder 会把 context items 组装成 model-visible system messages。
- reference selector 已有 tokenBudget 和 estimated token 概念。

但当前还缺少完整统计闭环：

- agent model call 没有记录每条 message 的 estimated token。
- context item 没有按 kind / title / source 汇总 estimated token。
- AI SDK 返回的 provider usage 没有接入 runtime / session / UI。
- session artifact 中没有可恢复查看的 usage stats。
- UI 没有展示本轮 estimated / actual token usage。

## AI SDK Usage Facts

本计划基于本地 `ai` package 源码确认，而不是依赖记忆。

相关本地依据：

- `node_modules/ai/src/generate-text/stream-text-result.ts`
- `node_modules/ai/src/generate-text/stream-text.ts`
- `node_modules/ai/src/generate-text/callback-events.ts`
- `node_modules/ai/src/types/usage.ts`

确认结果：

- `streamText` result 暴露 `usage`：最后一个 step 的 token usage。
- `streamText` result 暴露 `totalUsage`：多 step / tool loop 聚合后的 token usage。
- `streamText` 支持 `onFinish`，其中 `totalUsage` 是所有 step 聚合 usage。
- `streamText` 支持 `onStepFinish`，可拿到每个 LLM step 的 usage。
- `LanguageModelUsage` 包含：
  - `inputTokens`
  - `inputTokenDetails.noCacheTokens`
  - `inputTokenDetails.cacheReadTokens`
  - `inputTokenDetails.cacheWriteTokens`
  - `outputTokens`
  - `outputTokenDetails.textTokens`
  - `outputTokenDetails.reasoningTokens`
  - `totalTokens`
  - `raw`

因此 OAN 后续实现应优先接入 AI SDK 的 `totalUsage`，不需要自造 provider usage 采集机制。

## OAN V1 Design

### 1. Keep Estimated And Actual Separate

OAN 需要同时保留两类统计：

- `estimatedTokens`：OAN 本地估算，用于 context budget、UI 提示和 debug。
- `actualUsage`：provider / AI SDK 返回的真实 usage，用于真实调用记录和成本观察。

两者不能混用：

- estimated 不能当作账单依据。
- actual 缺失时不能伪造。
- UI 必须明确标注 estimated / actual。

### 2. Core Stats Helpers

建议在 `packages/core` 新增轻量统计 helper：

- `estimateTextTokens(text)`：固定、可测试的本地估算。
- `buildRuntimeMessageStats(messages)`：按 message role / index 统计 chars 与 estimatedTokens。
- `buildRuntimeContextStats(contextItems)`：按 context kind / title 统计 chars 与 estimatedTokens。
- `normalizeModelUsage(usage)`：把 AI SDK `LanguageModelUsage` 转成 OAN 稳定结构。

V1 不引入 provider-specific tokenizer，也不新增重型 tokenization dependency。

### 3. Runtime Usage Event

建议在 `packages/runtime` 扩展类型：

- `RuntimeModelResponse.usage`
- `RunTurnResult.usage`
- 新增 `RuntimeEvent`：`usage_stats`

每次 model step 应记录：

- step index。
- request message stats。
- context stats。
- estimated input tokens。
- actual usage when available。
- finish reason when available。

turn finish 时应有 aggregated usage summary。

### 4. AI SDK Adapter Integration

`packages/agent/src/index.ts` 当前已调用 `streamText`，但只消费 text stream 和 tool calls。

后续应在 AI SDK adapter 中读取：

- `await result.totalUsage`
- `await result.usage` if step-level usage is useful
- `await result.finishReason`

并写入 runtime model response。

如果 provider 未返回 usage，runtime 仍应保留 estimated stats，并将 actual usage 字段留空。

### 5. Session Artifact

usage stats 属于 runtime/session 观测数据，不是小说 truth files。

建议写入：

```text
.workspace/sessions/<session-id>/usage-stats.jsonl
```

每行记录一次 model step 或 turn summary，便于恢复和后续 UI 查看。

### 6. UI Surface

UI 可以先做轻量展示：

- 本轮 estimated input tokens。
- actual input / output / total tokens when available。
- context estimated tokens by kind。
- model step count。
- provider usage missing 时显示为 unavailable，而不是 0。

展示位置可以跟随现有 agent timeline / right panel，不需要新增大型页面。

## Boundaries

- 不引入 LangChain、AutoGen、CrewAI、Semantic Kernel 或重型 observability 平台。
- 不把 usage stats 写入小说事实域。
- 不让 estimated token 成为真实计费数据。
- 不改变当前 prompt assembly 顺序，只在组装后统计。
- 不阻塞 provider 不返回 usage 的模型调用。
- 不把 context package 变成隐藏事实源。

## Later Test Plan

- `__test__/core`：
  - token estimator 覆盖英文、中文、混合文本。
  - message stats 按 role / index 汇总。
  - context stats 按 kind / title 汇总。
  - usage normalization 保留 undefined 字段。
- `__test__/runtime`：
  - mock model usage 透传到 `usage_stats` event。
  - 多 step / tool loop 能聚合 usage。
  - provider missing usage 时仍输出 estimated stats。
- `__test__/agent`：
  - AI SDK `streamText.totalUsage` 被读入 runtime response。
  - message assembly stats 覆盖 context package summary。
- `__test__/backend` / UI stream：
  - SSE 包含 `data-usage-stats`。
  - 不破坏现有 chat / pending action flow。
