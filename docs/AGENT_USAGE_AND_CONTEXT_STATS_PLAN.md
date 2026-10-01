# ContextPackage Evidence And Agent Usage Governance Plan

> Status: Partially implemented; remaining scope tracked in [1110](tasks/1110.md).
>
> Related Task: [1110 ContextPackage Evidence And Agent Usage Governance](tasks/1110.md)
>
> Related Completed Tasks: [1010 Context Package And Source Discipline](tasks/1010.md), [1070 Agent Context Trace And Session Artifact Autowiring](tasks/1070.md), [1080 Reference Context Selector And Loading Map](tasks/1080.md)
>
> 本计划扩展原有 “Agent Usage And Context Stats” 范围：除了 estimated / actual token usage，还要让每次 agent run 能说明实际发送了哪些上下文、来源版本是什么、哪些内容被省略或压缩、是否发生 protected overflow，以及内容被发送到哪个 provider。计划仍由 `1110` 承接，不新建重型 observability 子系统。

## 1. 结论摘要

OAN 下一阶段的 ContextPackage 不应只是一份“理论上允许读取哪些 source”的清单，而应成为一次 agent run 的可审计输入证据。

目标闭环：

```text
Object File Tree / session artifact
  -> source identity + hash
  -> ContextPackage selection
  -> protected / compressible budget decision
  -> exact model-visible message estimate
  -> provider egress summary
  -> AI SDK actual usage
  -> runtime step / turn aggregation
  -> .workspace session artifact
  -> SSE / client / UI inspector
```

V1 必须明确区分四层事实：

1. **Declared context**：ContextPackage 声明选择、遗漏或压缩了哪些来源。
2. **Model-visible context**：Runtime 实际组装并交给 adapter 的消息内容统计。
3. **Provider egress**：本轮使用的 provider、model、endpoint origin，以及哪些 source 的派生内容将被发送。
4. **Actual usage**：AI SDK / provider 返回的 input、output、total 与 cache usage；缺失时必须保持 unavailable。

这四层不能互相冒充。estimated token 不是计费数据，ContextPackage 中的 selected 也不能自动证明其全部原文已经进入最终请求。

## 2. 规划依据

### 2.1 OAN 当前稳定边界

- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- ContextPackage、usage stats、session artifact 和 UI inspector 都是派生审计数据，不是小说事实源。
- Runtime 保持 Aider-style 极简 tool loop，不加入 planner、后台自治或隐藏压缩循环。
- 真实目标文件写入继续经过 `CandidateChangeSet`、PendingAction、diff 和 Human Approval。

### 2.2 `*_LESSONS.md` 共同结论

本计划吸收四份 Lessons 的共同约束，但不复制参考项目实现：

- [INKOS_REFERENCE_LESSONS.md](INKOS_REFERENCE_LESSONS.md)：protected context 不得静默截断；source、revision/hash、选择原因和压缩映射必须可见；派生层必须可重建和可解释。
- [STORYFORGE_REFERENCE_LESSONS.md](STORYFORGE_REFERENCE_LESSONS.md)：候选卡和 run log 应展示实际 included / omitted / compressed 来源、预算，以及产生 patch 的 ContextPackage 依据。
- [WEBNOVEL_WRITER_REFERENCE_LESSONS.md](WEBNOVEL_WRITER_REFERENCE_LESSONS.md)：不同写作阶段应使用明确的 reference loading map；长任务需要可信输入签名和作者友好报告。
- [SILLYTAVERN_REFERENCE_LESSONS.md](SILLYTAVERN_REFERENCE_LESSONS.md)：动态 context activation 必须记录 source id、文件路径、触发原因和预算，不能做无 source log 的隐式 lore 注入。

### 2.3 AI SDK usage 事实

当前本地 `ai@7` package 已提供（2026-10-01 随 [1240](tasks/1240.md) 更新）：

- `streamText().usage`：该次 `streamText` 调用所有 SDK steps 的聚合 usage。
- `(await streamText().finalStep).usage`：最后一个 SDK step 的 usage。
- `finishReason`。
- `LanguageModelUsage` 中的 input、output、total、cache read/write、reasoning 等字段。

`totalUsage` 仍是 deprecated alias；新接线使用 `usage`，不能重复累加两者。OAN 应读取并规范化这些数据，不自造 provider-specific usage 采集协议，也不保存 AI SDK 的任意 raw payload。

## 3. 当前代码状态与缺口

### 3.1 已有基础

- `packages/core/src/agent-context-package.ts`
  - 已有 `selected`、`omitted`、`reason`、`budgetLayer`、`semanticBoundary` 和 `trace`。
  - 已支持 `.workspace/sessions/<session-id>/context-package.yaml`。
- `packages/core/src/session-artifacts.ts`
  - 已有 run metadata、input source hash、outputs、proposed patches、resume boundary 和 author report。
- `packages/core/src/llm-provider.ts`
  - model 配置已允许声明 `contextWindow` 和 `maxOutputTokens`。
- `packages/runtime`
  - 每个 tool loop 都会构造一次 `RuntimeModelRequest`，天然可以作为 model step 统计边界。
- `packages/agent/src/index.ts`
  - 已有 `streamText` adapter、baseline ContextPackage 和 session artifact autowiring。
- reference selector
  - 已有 token budget、estimated tokens、included / omitted 与 reason，可复用其确定性预算经验。

### 3.2 当前缺口

- Context source 没有稳定的 source hash / revision 与 exact model-visible payload hash。
- selected source 没有 original chars、model-visible chars、estimated tokens 等证据。
- protected / compressible 目前是标签，尚未形成统一 overflow 语义。
- Runtime 不记录每次实际 model request 的 message stats。
- `RuntimeModelResponse`、`RunTurnResult` 和 `RuntimeEvent` 不包含 usage。
- AI SDK adapter 没有读取 `usage` 和 `finishReason`。
- session artifact 没有 step / turn usage 记录。
- UI stream 没有 context evidence / usage data chunk。
- UI 无法回答“本轮为什么这么贵”“哪类 source 占了最多上下文”“actual usage 是否可用”。
- provider egress 没有用户可见的 provider/model/endpoint/source 范围摘要。

## 4. 产品目标

### 4.1 用户可回答的问题

完成后，作者应能在一次 agent turn 中看到：

- 本轮实际选择了哪些 source，为什么选择。
- 哪些 source 被省略或压缩，为什么。
- 哪些 source 是 protected，是否触发 overflow。
- 每个 source 的 workspace-relative path、source hash / revision 和 model-visible payload hash。
- message content 和各类 context source 的 estimated tokens。
- provider 返回的 actual input / output / total tokens。
- actual usage 不可用时，为什么只能显示 estimate。
- 使用了哪个 provider、model 和 endpoint origin。
- 哪些 source 的派生内容可能离开本机发送给 provider。
- 多个 tool loop / model step 的单步和 turn 聚合 usage。
- 重开 session 后仍能查看这些记录。

### 4.2 工程目标

- 统计函数确定性、轻量、无 provider-specific tokenizer。
- Runtime 只处理通用 message/request/usage 类型，不理解 Character、Chapter 等领域。
- Agent 负责把 ContextPackage provenance 映射到 Runtime 通用元数据。
- AI SDK usage 在 Agent adapter 归一化后传入 Runtime。
- Backend 只提供 workspace-bound、只读、bounded API 和 SSE transport。
- UI 明确标记 `estimated`、`actual`、`partial` 和 `unavailable`。
- telemetry 写入失败不得改变小说事实，也不得谎报模型调用失败。

## 5. 非目标

V1 不实现：

- 精确 tokenizer、provider-specific tokenizer 或 tiktoken 类重依赖。
- 真实费用计算、价格表维护或账单对账。
- LangSmith、OpenTelemetry collector、Prometheus、外部分析平台。
- 保存完整 raw prompt、完整 provider response、API key、请求 headers 或隐藏 reasoning。
- 自动语义压缩 Agent、隐藏摘要调用或隐藏重试。
- 每次普通聊天都弹出阻塞式 execution consent。
- 向量数据库、RAG reranker 或新的 Context Source Registry runtime。
- 让 usage stats、context snapshot 或 search index 成为事实源。
- 以本计划为由重构 Play / reference 的全部专用 pipeline。

## 6. 核心术语与证据层

| 术语 | 含义 |
| --- | --- |
| Source identity | source id、workspace-relative path、source hash / revision 等来源身份 |
| Source payload | 由 source 派生、最终可能进入 prompt 的文本 |
| Model-visible payload | Context builder 格式化后实际进入 RuntimeModelRequest 的内容 |
| Estimated usage | OAN 本地确定性估算，只用于预算、比较和诊断 |
| Actual usage | AI SDK / provider 返回的 usage；缺失时不可伪造 |
| Protected source | 不允许为了预算静默省略或截断的来源 |
| Compressible source | 可以使用已有摘要、确定性 excerpt 或显式 omission 的来源 |
| Excluded source | 本轮明确不得发送给模型的来源 |
| Egress summary | provider、model、endpoint origin 和被发送 source refs 的无内容摘要 |

## 7. 目标数据契约

以下接口是实施目标，用于固定语义；具体文件拆分可在实现时按包边界微调。

### 7.1 Context source evidence

`ContextSourceRef` 继续保留 selection intent，并增加可选证据：

```ts
interface ContextSourceEvidence {
  sourceId: string;
  path?: string;                 // workspace-relative only
  title?: string;
  reason: string;
  budgetLayer: 'L0' | 'L1' | 'L2' | 'L3';
  semanticBoundary: 'protected' | 'compressible' | 'excluded';
  outcome: 'selected' | 'compressed' | 'omitted' | 'excluded';

  sourceRevision?: string;       // domain revision / Git identity when available
  sourceHash?: string;           // hash of authoritative source bytes
  payloadHash?: string;          // hash of exact model-visible derived payload

  originalChars?: number;
  modelVisibleChars: number;
  estimatedTokens: number;
  estimator: 'chars-div-4-v1';
}
```

约束：

- `path` 必须是 workspace-relative；不把绝对路径发送到 UI 或 provider。
- file-backed source 应尽量提供 `sourceHash`；非文件 source 使用稳定 revision 或省略，不伪造 hash。
- `payloadHash` 对 exact model-visible source payload 计算，而不是对整条 provider request 计算。
- `omitted` / `excluded` 的 `modelVisibleChars` 和 `estimatedTokens` 必须为 `0`。
- artifact 默认不保存 source 正文或 prompt 片段，只保存身份、hash、数量和 reason。
- ContextPackage 仍分别保留 selected / omitted，`outcome` 用于区分 selected 原文、selected compressed、预算省略和策略排除。

### 7.2 Token estimator

2026-10-01 实施调整：标准 Agent 当前使用 `utf8-bytes-div-3-v1`，并在请求估算上预留 20% 余量，以避免旧 chars/4 对中文明显偏低。它仍是启发式，尚未完成跨模型 tokenizer 校准，不能保证精确容量或计费。既有 Reference artifact 的 estimator 不变。下面的 chars/4 记录原计划，新增统计/inspector 应按实际 estimator id 展示。

V1 统一复用项目已有的轻量基线：

```text
estimatedTokens = ceil(text.length / 4)
```

并记录 estimator id `chars-div-4-v1`。

原因：

- 当前 reference distillation / selection 已使用相同数量级的估算。
- 算法确定、快速、容易测试。
- 它不声称对中文、英文或任意 provider 精确。
- 后续更换 estimator 时可以通过版本字段解释历史数据。

公共 helper 应收敛到 `packages/core`，避免不同领域各自复制 `/ 4` 逻辑。历史 reference artifact 的既有语义不得在同一变更中无迁移地改变。

### 7.3 Runtime message stats

```ts
interface RuntimeMessageStats {
  index: number;
  role: RuntimeRole;
  name?: string;
  chars: number;
  estimatedTokens: number;
  estimator: 'chars-div-4-v1';
  contextSourceRefs?: string[];
}

interface ModelRequestStats {
  stepIndex: number;
  messageCount: number;
  messages: RuntimeMessageStats[];
  estimatedMessageTokens: number;
  estimationScope: 'message-content-only';
  toolCount: number;
  contextPackageId?: string;
}
```

`estimationScope` 必须明确说明本地 estimate 不包含 provider 序列化开销、隐藏 framing、图像 token 或无法稳定序列化的 tool schema token。actual input usage 与 estimate 不要求完全相等。

### 7.4 Actual provider usage

```ts
interface NormalizedModelUsage {
  availability: 'actual' | 'partial' | 'unavailable';
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
```

约束：

- provider 没有返回某字段时保留 `undefined`，不得补 `0`。
- provider 明确返回 `0` 时可以保留 `0`。
- 不保存 `LanguageModelUsage.raw`。
- aggregate 只能累加实际存在的数字，并同时记录 coverage；不能用部分 usage 伪装完整 turn total。

### 7.5 Step / turn stats

```ts
interface ModelStepUsageStats {
  schemaVersion: 1;
  recordType: 'step';
  sessionId?: string;
  turnId: string;
  stepIndex: number;
  createdAt: string;
  providerId: string;
  providerKind: string;
  modelId: string;
  request: ModelRequestStats;
  context: ContextUsageSummary;
  actualUsage: NormalizedModelUsage;
  finishReason?: string;
  outcome: 'completed' | 'failed' | 'aborted';
}

interface TurnUsageSummary {
  schemaVersion: 1;
  recordType: 'turn';
  sessionId?: string;
  turnId: string;
  stepCount: number;
  estimatedMessageTokens: number;
  contextEstimatedTokens: number;
  actualUsage: NormalizedModelUsage;
  actualCoverage: 'complete' | 'partial' | 'unavailable';
}
```

每次 Runtime tool loop 中的 model call 是一个 OAN step。不得把 Runtime step 与 AI SDK 内部实现细节混成两个重复计数来源。

### 7.6 Provider egress summary

```ts
interface ProviderEgressSummary {
  providerId: string;
  providerKind: string;
  modelId: string;
  endpointOrigin?: string;        // scheme + host + port only
  contextPackageId?: string;
  sourceRefs: Array<{
    sourceId: string;
    path?: string;
    sourceHash?: string;
    payloadHash?: string;
    estimatedTokens: number;
  }>;
  preparedAt: string;
}
```

安全要求：

- 不返回 API key、authorization header、custom header value、URL query 或 path。
- 自定义 endpoint 只展示经 URL parser 规范化的 origin；非法 URL 显示 unavailable。
- 不把 `ollama` 一律标记为本地，因为它也可能指向远程地址。
- casual chat 只展示摘要，不增加阻塞式确认；长时间参考分析等已有 execution consent 的流程可复用该摘要。

## 8. Context budget 与 protected overflow

### 8.1 有效预算来源

有效输入预算按以下顺序求最小可用值：

1. 调用方显式提供的 `maxEstimatedInputTokens`。
2. 当前 model config 的 `contextWindow - maxOutputTokens`。
3. 如果只配置 `contextWindow`，减去显式的 output reserve。

如果以上数据都不可用：

- budget 状态为 `unknown`。
- 仍记录 estimate 和 source evidence。
- 不用一个臆造的全局阈值阻止模型调用。
- UI 明确显示“模型上下文预算未知”。

### 8.2 确定性选择顺序

在预算已知时，Agent 组装层按确定性顺序处理：

1. `excluded` 永不进入 model-visible context。
2. `protected` 原样保留，不静默截断。
3. `compressible` 优先使用调用方已经提供的摘要或 bounded excerpt，并保留 source mapping。
4. 仍超预算时，按 `L3 -> L2 -> L1 -> L0` 和稳定 source order 省略 compressible source。
5. 用户请求、系统安全规则和 protected source 仍超预算时，在调用 provider 前失败。

失败结构至少包含：

```ts
{
  code: 'CONTEXT_PROTECTED_OVERFLOW';
  estimatedTokens: number;
  budgetTokens: number;
  protectedSources: Array<{ sourceId: string; path?: string; estimatedTokens: number }>;
}
```

V1 不新增 LLM 压缩调用。所谓 compressed 必须来自已有摘要、已有 reference distilled entry 或确定性 bounded excerpt；不能隐藏调用另一个模型后声称这是同一次请求。

### 8.3 失败语义

- overflow 发生在 provider 调用前，不产生 actual usage。
- UI 显示需要缩小范围、降低选中资料或调整 model context 配置。
- overflow 不写小说事实文件，也不产生 PendingAction。
- session artifact 可以记录这次失败的 request estimate 和 source evidence。

## 9. Package 边界与职责

### 9.1 `packages/core`

新增或扩展：

- `agent-usage.ts`
  - `estimateTextTokens()`。
  - message/context aggregation 纯函数。
  - normalized usage 类型和聚合 helper。
  - budget resolution / deterministic selection helper。
- `agent-context-package.ts`
  - source evidence、hash/revision、selection outcome。
  - ContextPackage usage summary。
  - schema validation 与 formatter。
- `session-artifacts.ts`
  - `usage-stats.jsonl` 安全路径和读写 helper。
  - bounded read、schema validation、损坏尾行诊断。
- `llm-provider.ts`
  - 只复用现有 contextWindow / maxOutputTokens，不在本任务增加价格表。

Core 不调用 provider，不依赖 AI SDK usage 类型，不读取隐藏 reasoning。

### 9.2 `packages/runtime`

扩展通用类型：

- `RuntimeContextItem` 可携带可选、通用 provenance ref；不引入小说领域类型。
- `RuntimeModelResponse.usage` 和 `finishReason`。
- `RunTurnResult.usage`。
- `RuntimeEvent`：
  - `model_request_stats`：provider 调用前的 request estimate。
  - `usage_stats`：provider 返回后的 step stats。

Runtime 在 context builder 输出后、adapter 调用前计算 request stats，保证统计的是实际 request messages，而不是调用前的 `curMessages`。

Runtime 按 step index 聚合 turn usage。它不解析 provider raw usage，也不决定 Character / Timeline 等 source 分类。

### 9.3 `packages/agent`

负责：

- 给 baseline ContextPackage source 补 workspace-relative path、source hash、payload hash 和 stats。
- 将 Core ContextPackage provenance 映射到 `RuntimeContextItem` 通用 provenance。
- 从 provider config 解析 provider id、kind、model、context budget 和安全 endpoint origin。
- 在 `streamText` 完成后读取 `usage` / `finishReason` 并规范化。
- 生成 ProviderEgressSummary。
- 把 step / turn usage 写入 session artifact。
- 保持 standard run 和 stream run 的统计语义一致。

专用 reference / Play model call 可以复用 normalized usage helper，但不作为第一个纵向切片的开工 Gate。

### 9.4 `packages/backend`

负责：

- 将新增 RuntimeEvent 转为现有 UI stream data chunk。
- 提供 workspace-bound 历史读取：

```text
GET /api/workspace/agent-sessions/:id/governance?limit=<bounded>
```

响应包含：

- 当前或最近 ContextPackage evidence。
- bounded step usage records。
- turn summaries。
- artifact parse diagnostics。

安全要求：

- session id 严格校验。
- limit 有小而明确的上限。
- 不接受任意 artifact path。
- 不返回 raw prompts、source content 或 secrets。

### 9.5 `packages/client`

- 增加 governance response 与 UI stream data 的稳定公共类型。
- 对历史 API 做 strict runtime parsing。
- unknown schema version fail closed。
- actual usage 缺失时保持 unavailable。

### 9.6 `apps/desktop-ui`

第一版使用轻量 Inspector，不新增大型 observability 页面：

- assistant turn / Agent Timeline 中显示 compact summary：
  - `Context ~8.2k estimated`
  - `Actual 8.9k in / 1.1k out` 或 `Actual unavailable`
  - `3 model steps`
- 展开后显示：
  - selected / compressed / omitted source。
  - budget layer、semantic boundary、reason。
  - source path、短 hash、estimated tokens。
  - provider、model、endpoint origin。
  - actual usage 与 cache usage。
  - budget known / unknown / overflow 状态。
- 点击 source path 复用现有文件查看器打开 source；不在 usage artifact 中复制 source 正文。
- estimated 与 actual 使用不同标签，不只靠颜色区分。

## 10. Runtime 与 artifact 事件流

标准成功流程：

```text
Agent builds ContextPackage evidence
  -> resolves budget and egress summary
  -> Runtime context builder creates actual messages
  -> emit model_request_stats
  -> AI SDK streamText
  -> normalize usage + finishReason
  -> emit usage_stats
  -> tool call may start next model step
  -> aggregate TurnUsageSummary
  -> message_finish includes turn usage
  -> append usage-stats.jsonl
  -> SSE data chunks update UI
```

失败 / 取消流程：

- provider 调用前 overflow：有 request/context stats，无 actual usage。
- provider 抛错且没有 usage：step outcome failed，actual unavailable。
- abort：step outcome aborted；只有 provider 已明确返回的数据才记录 actual。
- artifact 写入失败：模型 turn 结果保持有效，但 UI / author report显示 telemetry persistence warning。
- UI 断线：重连后通过历史 API读取 session artifact；不根据最后一条 assistant 文本猜 usage。

## 11. Session artifact 设计

### 11.1 文件布局

```text
.workspace/sessions/<session-id>/
├── run.yaml
├── context-package.yaml
├── outputs.yaml
├── proposed-changes.yaml
├── unresolved.md
└── usage-stats.jsonl
```

### 11.2 JSONL 记录

- 每个 model step 一条 `recordType: step`。
- turn 结束追加一条 `recordType: turn`。
- 每条有 `schemaVersion`、`turnId`、时间和独立可解析 JSON。
- 不保存 prompt content、completion content、tool args、tool results 或 provider raw usage。
- 写入在同 session 内串行化。
- 读取使用 bounded tail；最后一行不完整时忽略该行并返回 diagnostic，不影响小说工程打开。
- artifact 是观测数据；缺失或损坏不能反向改变 canonical files。

### 11.3 ContextPackage artifact

`context-package.yaml` 增加 evidence 和 aggregate，但继续保持作者可读：

- selection reason。
- source path / hash / revision。
- original / model-visible char counts。
- estimated tokens。
- protected / compressible / excluded。
- compression / omission trace。
- provider egress summary 不包含 secret。

如果同一 session 有多 turn，V1 可以让 `context-package.yaml` 保存最近一次完整 package，并由 `usage-stats.jsonl` 的 `contextPackageId` 关联历史；后续只有真实需求出现时再拆成 per-turn context package 文件。

## 12. UI 交互规格

### 12.1 Compact summary

默认不打断写作，只在 agent 消息或 timeline 上显示一行：

```text
Context 8.2k est · Actual 8.9k in / 1.1k out · 3 steps
```

actual 缺失时：

```text
Context 8.2k estimated · Actual unavailable · 3 steps
```

### 12.2 Expanded evidence

按以下分组展示：

1. Request summary。
2. Included / compressed sources。
3. Omitted / excluded sources。
4. Provider egress。
5. Step usage。
6. Warnings：budget unknown、protected overflow、actual partial、artifact persistence failure。

### 12.3 明确文案边界

- 使用 “estimated”，不写“used”或“billed”。
- 使用 “actual reported by provider”，不写“exact cost”。
- actual unavailable 显示 unavailable，不显示 `0`。
- hash 只作为来源身份，不暗示内容已通过事实验证。
- selected 只表示进入选择结果；expanded view 还要显示 exact model-visible chars/tokens。

## 13. 分阶段实施计划

### G0. Contract Alignment

目标：在写代码前固定 schema、边界与 task 范围。

工作项：

- 将 `1110` 从单纯 token stats 扩展为 ContextPackage evidence + usage governance。
- 固定 schema version、event names、artifact path 和 API response。
- 明确 standard Novel Agent 是首个纵向切片。
- 明确 reference / Play 专用 pipeline 只复用 helper，不阻塞 V1。
- 用架构测试保证 Runtime 不引入 provider resolver 或领域文件读取。

完成标准：

- task、plan、public types 和 package ownership 无冲突。
- estimated / actual / selected / model-visible 四种语义有独立字段。

### G1. Core Evidence And Estimation

目标：建立纯函数、可测试的数据底座。

工作项：

- 新增 `packages/core/src/agent-usage.ts`。
- 收敛 `estimateTextTokens()` 和 estimator version。
- 扩展 ContextPackage source evidence。
- 增加 source/payload hash helper。
- 增加 context aggregation、actual usage normalization 与 coverage aggregation。
- 增加 budget resolution 与 deterministic omission helper。
- 扩展 context-package formatter 和 validation。

测试：

- 英文、中文、混合文本、空文本的稳定估算。
- selected / compressed / omitted / excluded invariant。
- workspace-relative path 与 hash。
- provider usage missing / zero / partial / complete。
- budget unknown、compressible omission 和 protected overflow。

完成标准：

- Core helper 不依赖 Runtime 或 AI SDK。
- 相同输入始终产生相同 evidence 与 aggregate。

### G2. Agent Context Assembly And Budget Governance

目标：让 ContextPackage 描述实际组装，而不只是理论范围。

工作项：

- baseline source assembly 记录 file-backed source hash。
- 每个 RuntimeContextItem 携带通用 provenance ref。
- 计算 exact payload hash 和 model-visible stats。
- 从 provider model config 解析预算。
- 实现 deterministic compressible omission。
- 实现 pre-provider protected overflow。
- 生成安全 ProviderEgressSummary。
- session artifact 写入 enriched ContextPackage。

测试：

- source 原文变化导致 sourceHash / payloadHash 改变。
- compressed source 保留原 source identity。
- protected source 不被静默省略。
- endpoint origin 无 path/query/credential/header。
- workspace path 不泄露为绝对路径。

完成标准：

- 每次 standard writing-related run 有实际 source evidence。
- overflow 在 provider resolver / streamText 调用前结束。

### G3. Runtime Step And Turn Usage

目标：把每次 model call 变成可审计 step。

工作项：

- 扩展 RuntimeModelResponse / RunTurnResult / RuntimeEvent。
- context builder 输出后计算 request stats。
- provider 调用前发 `model_request_stats`。
- response 后发 `usage_stats`。
- 多 tool loop 聚合 turn usage。
- 覆盖 generate / stream 两条入口。
- failed / aborted actual unavailable 语义一致。

测试：

- 单 step 文本生成。
- 多 step tool loop。
- provider actual complete / partial / missing。
- max loop / abort / model error。
- message_finish aggregate 与 step sum/coverage 一致。

完成标准：

- Runtime 保持 provider-agnostic。
- 不改变现有 tool call、PendingAction 和 stream 顺序语义。

### G4. AI SDK Adapter And Session Persistence

目标：接入 actual usage 并支持恢复查看。

工作项：

- 读取 `streamText.usage` 和 `finishReason`。
- 归一化 AI SDK usage，不保留 raw。
- standard generate / stream 结果一致。
- 追加 `.workspace/sessions/<id>/usage-stats.jsonl`。
- run.yaml 记录 provider/model/contextPackageId 和 telemetry warning。
- bounded reader 与损坏尾行 diagnostic。

测试：

- mock AI SDK usage 进入 RuntimeModelResponse。
- actual zero 与 unavailable 区分。
- JSONL step / turn 顺序和 schema。
- artifact 写失败不回滚已完成模型 turn。
- session 重开读取历史 usage。

完成标准：

- provider 有 usage 时可恢复 actual 数据。
- provider 无 usage 时 estimate 仍完整可用。

### G5. Backend, UI Stream And Client

目标：把治理信息安全地传到前端。

工作项：

- UI stream 增加：
  - `data-context-evidence`
  - `data-model-request-stats`
  - `data-usage-stats`
- 新增 bounded governance history endpoint。
- Client 增加严格 parser。
- 不在 transport 中发送 source content 或 raw prompt。
- SSE 重连后可从 artifact 恢复。

测试：

- data chunk 顺序与 schema。
- unknown version / unknown field / invalid token count fail closed。
- unsafe session id、过大 limit、任意 path 被拒绝。
- raw content、secret、absolute path 不出现在 response fixture。

完成标准：

- live stream 和 history API 使用同一公共 schema。
- UI 不需要解析文件系统 artifact 原文。

### G6. Desktop Context And Usage Inspector

目标：交付作者可理解的轻量 UI。

工作项：

- Agent Timeline / assistant turn 增加 compact summary。
- 增加 expandable Context & Usage inspector。
- 来源按 selected / compressed / omitted / excluded 分类。
- 展示 provider egress 和 budget 状态。
- 展示 step usage 与 turn aggregate。
- 支持 source path 打开现有 FileViewer。
- actual unavailable、partial、overflow 和 artifact warning 有明确文本。

测试：

- estimated / actual 标签不会混淆。
- unavailable 不渲染为 0。
- source 分类、reason、hash、provider/model 可见。
- inspector 收起时不干扰普通聊天。
- 键盘可展开，保留合理原生控件语义。

完成标准：

- 作者无需阅读 JSON 即可回答本计划 4.1 的问题。
- 不增加独立大型 dashboard 或新的 workspace 顶级模式。

### G7. Cross-Pipeline Adoption And Hardening

目标：在标准 Agent 纵向闭环稳定后复用统一 schema。

候选工作：

- reference quick preview / full deconstruction 按 stage 写相同 normalized usage。
- Play referee / rehearsal actor 复用 provider usage helper，但保持 Play 自己的 context trace 和隐私投影。
- 长任务 execution consent 展示 egress summary 和 estimated budget。
- Project Health 可只读提示 usage artifact 损坏，不将其视为 Canon 健康失败。

这些工作不属于 G1-G6 的完成 Gate，应按具体 pipeline 建独立 follow-up 或补充 task。

## 14. 测试矩阵

| 层 | 测试 workspace | 重点 |
| --- | --- | --- |
| Core | `__test__/core` | estimator、evidence、hash、budget、usage normalization、artifact parser |
| Runtime | `__test__/runtime` | pre-call stats、step event、multi-loop aggregate、abort/error/missing usage |
| Agent | `__test__/agent` | ContextPackage actual assembly、AI SDK usage、egress redaction、session artifact |
| Backend | `__test__/backend` | SSE chunks、bounded history API、workspace/session boundary、no secret/raw content |
| Client | `__test__/client` | strict parser、unknown schema、partial/unavailable usage |
| Desktop UI | `__test__/desktop-ui` | compact summary、expanded inspector、labels、source routing、warning states |

必须保留的回归范围：

- runtime tool loop 和 max loop guard。
- PendingAction stream 和 approval UI。
- agent session persistence。
- reference selector 的既有 estimatedTokens 语义。
- Play / reference 专用 SSE 不因新增通用 event 而破坏。
- package build、strict TypeScript 和根目录 workspace test placement。

## 15. Done Criteria

### Context evidence

- 每个 writing-related standard agent run 有 ContextPackage id。
- file-backed selected source 尽可能包含 workspace-relative path 和 sourceHash。
- exact model-visible source payload 有 payloadHash、chars 和 estimatedTokens。
- selected / compressed / omitted / excluded 可区分并有 reason。
- protected source 在已知预算下绝不被静默省略或截断。
- protected overflow 在 provider 调用前产生结构化错误。
- budget 未知时明确显示 unknown，不使用臆造阈值阻断请求。

### Usage

- 每个 model step 有 message-content estimate。
- provider 返回 usage 时保存 normalized actual usage。
- provider 未返回 usage 时 actual 为 unavailable，不是 0。
- 多 tool loop 有 turn-level aggregation 和 coverage。
- estimate 明确标注不包含 provider framing / tool schema 等不可稳定估算部分。

### Egress and privacy

- UI 可见 provider id/kind、model、endpoint origin 和 source refs。
- API key、headers、URL query/path、raw prompt、source content 和 hidden reasoning 不进入 artifact/API/UI。
- workspace 绝对路径不进入 provider egress 或 client response。

### Persistence and UI

- `.workspace/sessions/<id>/usage-stats.jsonl` 可恢复读取。
- artifact 缺失或尾行损坏不会阻止 workspace 打开。
- live stream 和 history API 使用相同 schema。
- UI 明确区分 estimated / actual / partial / unavailable。
- source path 可路由到现有文件查看器。

### Architecture

- 不引入重型 observability、tokenizer、数据库或多 Agent runtime。
- 不改变 prompt assembly 顺序，只在选择、组装和发送边界记录证据。
- 不将 ContextPackage 或 usage artifact 视为小说 truth。
- 不因 telemetry 写入失败撤销已完成的 agent turn 或已接受的 PendingAction。

## 16. 失败场景清单

实现和测试至少覆盖：

- model contextWindow 未配置。
- contextWindow 小于 maxOutputTokens。
- protected source 单独超过有效预算。
- compressible source 全部省略后仍超预算。
- source 在 ContextPackage 创建后、provider 调用前发生变化。
- provider 返回部分 usage。
- provider 返回显式 0 usage。
- provider 完全不返回 usage。
- provider stream 中断或 abort。
- tool loop 多 step 中只有部分 step 有 actual usage。
- usage artifact 写入失败。
- JSONL 最后一行截断。
- session history 请求使用危险 id 或超大 limit。
- custom base URL 含 credential、path、query 或非法 URL。
- source path 是绝对路径或 workspace 外路径。
- UI 收到未来 schema version。

## 17. 风险与控制

### 风险 1：estimate 被误认为账单数据

控制：字段、UI 和文案始终使用 estimated；actual 单独展示；不在 V1 计算价格。

### 风险 2：ContextPackage selected 与实际 request 不一致

控制：source evidence 与 context builder 后的 ModelRequestStats 分层记录；不只统计 intake 数据。

### 风险 3：为了统计保存过多正文或 prompt

控制：artifact 只保存 source identity、hash、count、reason 和 usage；正文仍从原文件读取。

### 风险 4：protected overflow 让普通写作过重

控制：只有预算已知时才执行硬 overflow；不增加每轮确认；UI 给出可恢复的缩小范围建议。

### 风险 5：通用 Runtime 被领域逻辑污染

控制：Runtime 只接收通用 provenance ref 和 usage 类型；source selection 与 provider config 保留在 Agent/Core。

### 风险 6：一次性接入所有长任务导致 scope 失控

控制：G1-G6 只要求 standard Novel Agent 纵向闭环；reference / Play 在 G7 按需采用。

## 18. 文档与任务同步要求

本次计划编写已同步 `1110` 的目标和索引。实施前或同一变更中仍需要保持：

- `docs/tasks/1110.md`：保持 goal、deliverables、done criteria 与实际实施范围一致。
- `docs/AGENT_USAGE_AND_CONTEXT_STATS_PLAN.md`：本计划状态与实施进度。
- `docs/README.md`：保持计划入口可发现。
- 如 public RuntimeEvent / artifact schema 最终与本文不同，必须先更新本计划和 task，再实现代码。

完成 G1-G6 后：

- `1110` 才能从 Planned 改为 Completed。
- Implementation Notes 必须列出实际文件、测试命令和任何 scope deviation。
- G7 未实施不阻止 `1110` 完成，但必须记录为后续 pipeline adoption 范围。

## 19. 推荐实施顺序

```text
G0 Contract Alignment
  -> G1 Core Evidence And Estimation
  -> G2 Agent Context Assembly And Budget Governance
  -> G3 Runtime Step And Turn Usage
  -> G4 AI SDK Adapter And Session Persistence
  -> G5 Backend / Client / UI Stream
  -> G6 Desktop Inspector
  -> G7 Optional Cross-Pipeline Adoption
```

不要先做 UI mock 再补 schema，也不要先把 usage 写进多个专用 pipeline。首个验收纵切应是：

```text
/写下一章
  -> actual ContextPackage evidence
  -> model_request_stats
  -> provider usage or unavailable
  -> usage-stats.jsonl
  -> live UI compact summary
  -> reopened session inspector
```
