# Reference Work Deep Deconstruction D2 + D3 Implementation Plan

> Date: 2026-07-23
> Task: [0900 Project References And Deconstruction](../../tasks/0900.md)
> Related plan: [Reference Work Deep Deconstruction Upgrade Plan](../../REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md)
> Status: Completed

## Delivery Boundary

本切片从同一 D1 run 的 `fullApproved` 授权点继续，完成可恢复分章拆解、层级聚合、Style Profile 与 analysis-level quality gate。它不会执行 D4 的 distill、PendingAction、publish 或真实 reference bundle 写入。

- 每次 `advance` 最多 reservation 并处理一个确定工作单元；请求结束后没有后台任务。
- source window、attempt、finding 与候选分析只写 `.workspace/sessions/<runId>/reference-deconstruction/`。
- 完成 attempt 以 `receipt.yaml` 为提交标记；run-state 只选择完整且 hash 一致的 attempt。
- retry 追加新 attempt，保留旧 attempt；重跑已完成单元时确定性失效全部下游选择。
- D3 的 `reviewReady` 表示 D0–D3 分析通过 analysis quality gate、可以进入后续 D4；published manifest 的正式 `distillForOan -> qualityGate` 仍留给 D4。
- 当前产品未发布：不实现旧 shadow run / endpoint / bundle migration，也不扩展系统化无障碍矩阵。

## Frozen Contracts

### Run lifecycle

```text
fullApproved
  -> fullRunning
      -> paused -> fullRunning
      -> interrupted -> fullRunning
      -> failed -> fullRunning (explicit retry)
      -> reviewReady
      -> cancelled
```

- `fullApproved` 仍是显式计算授权 checkpoint；第一次 full `advance` 才进入 `fullRunning`。
- `pause / resume / cancel / retry / advance` 都要求 `baseRunRevision + idempotencyKey`。
- `failed`、`paused`、`interrupted` 和 `reviewReady` 在 D4 publish 前都继续占用 reference 的 active-run identity，不能静默新建第二条链。
- 运行中的 provider reservation 不持 filesystem lock；settlement 必须重新校验 revision、source checksum、structure fingerprint、unit identity、input fingerprint 与 attempt receipt。

### Work plan

- `chapterAnalysis` 为每个检测章节创建一个或多个 deterministic semantic chunks；不得使用旧 12 章 stub 上限。
- chapter unit 按源顺序串行，输入只包含当前 source window、host pointer map、protected no-copy rules 和有上限 rolling context。
- aggregate 使用有上限 fan-in 的确定性 reduction tree；叶节点只读取 selected chapter attempt，父节点只读取 verified aggregate attempt，绝不一次性读取全文。
- style 只读取 final verified aggregate output；analysis quality 为 deterministic host unit，不调用 provider。
- unit metadata 只保存 id、ordinal、stage/kind、pointer、依赖、状态、attempt ids 与 selected attempt；正文不进入 run-state 或 transport。

### Attempts and fingerprints

```text
stages/<stage-id>/attempts/<attempt-id>/
  input-manifest.yaml
  findings.yaml
  receipt.yaml
```

- attempt status：`running | completed | failed | interrupted | cancelled | stale`。
- input fingerprint 包含 source/structure/pipeline/capability、stage/unit/options、predecessor output hashes 与 rolling-context hash。
- `findings.yaml` 先写，`receipt.yaml` 最后写；只有 completed receipt、合法 schema 与 output hash 同时成立才可 selected。
- restart 可收养完整但尚未写回 run-state 的 completed attempt；半成品 attempt 进入 interrupted，已 selected 的旧单元保持不变。
- stored receipt ledger 可覆盖最大合法 source 的全部 unit；transport 只返回 bounded recent receipts + receipt count，不能继续依赖 `revision === receipts.length - 1`。

### Typed outputs

- Chapter：bounded chunk summary、summary evidence、bounded rolling summary/evidence、最后 chunk 的 chapter summary、typed findings、uncertainties。
- Aggregate：transformed summary、typed findings、uncertainties；coverage 由 host 根据 predecessor closure 派生，不信任模型自报。
- Style：抽象 style profile、typed style/scene/pacing findings、uncertainties；不提供 imitation、quotation、excerpt 或 rewrite 字段。
- 非 general inference finding 必须闭合到本次 host allowlist；general inference 必须有 uncertainty boundary 且不能是 high confidence。
- 所有 runner 使用仓库当前 `ai@6` 的 `generateText + Output.object`，不注册 tools、`maxRetries: 0`，仅 `finishReason === stop` 可接受；structured no-output/parse/schema 错误归为 non-retryable invalid output。

### Analysis quality report

进入 `reviewReady` 前必须验证：

- source / structure identity current。
- 所有 planned chapter、aggregate 与 style unit 完成且 selected attempt 完整。
- attempt input/output hash、predecessor closure 与 artifact path 合法。
- 全部章节/chunk coverage 完整，final aggregate/style coverage 与 predecessor closure 一致。
- finding evidence pointer、chapter/range/checksum closure 合法。
- uncertainty 被汇总为可见 diagnostics。
- candidate-facing strings 通过 bounded exact-overlap / copy-risk 检查。
- 任意 blocking diagnostic 或 diagnostics overflow sentinel 都阻止 `reviewReady`。

## Vue Component Map

```text
ReferenceImportTab.vue
  -> composition surface only
  -> ReferenceDeconstructionPanel.vue
       -> ReferenceQuickPreview.vue
       -> ReferenceFullDeconstructionProgress.vue
       -> ReferenceDiagnostics.vue

useReferenceDeconstruction.ts
  -> authoritative selected run + request-local action state
  -> one bounded advance per action
  -> pause/resume/cancel/retry/reconcile actions
```

- `ReferenceFullDeconstructionProgress.vue` 只呈现 stage/unit/coverage/attempt history，并 emit next/pause/resume/retry。
- `ReferenceDiagnostics.vue` 只负责 severity/stage/chapter filter 与 blocking explanation；不修改 run。
- props down / typed emits up；composable 只暴露 readonly state 与显式 actions；不增加第二个全局 store，不让 Vue 读取 filesystem。

## Implementation Order

1. Core 新增 full work-plan、reduction tree、typed output normalizer、fingerprint 与 analysis quality module。
2. Core store 扩展 full lifecycle、通用 reservation、append-only attempt artifacts、pause/resume/retry/cancel/reconcile 与 bounded transport projection。
3. Agent 新增 chapter/aggregate/style typed runners，并统一 Quick Preview 的 AI SDK 6 finish/error 分类。
4. Backend 将现有 `advance` 扩展为 preview/full unit controller，增加 pause/resume/retry routes，复用跨实例 provider lease。
5. Client 增加 full progress/attempt/quality strict guards 与 pause/resume/retry methods。
6. Desktop 增加进度面板、显式单 unit advance、pause/resume/retry 和 diagnostics inspector。
7. 增加 Core/Agent/Backend/Client/Desktop 分层测试，运行 builds、全仓回归与文档同步。

## Correctness Gates

- 大于 12 章仍为每章生成工作单元；单次 provider prompt 只有当前 chapter chunk 或 bounded verified reductions。
- 无 `advance` 请求时 provider 调用数不变；两个并发 `advance` 只有一个 reservation 成功。
- completed selected attempt 在 provider failure、pause、应用重开和局部 retry 后不丢失。
- retry 新 attempt 不覆盖旧 artifact；retry 上游单元会失效全部依赖它的 aggregate/style/quality selection。
- pause/cancel/provider abort 不产生 completed selected output；cancel 前后 published bundle 和小说 truth files 均不变。
- aggregate/style prompt 不含 source 原文、workspace path、provider config 或工具定义。
- blocking coverage/closure/hash/path/copy-risk diagnostic 阻止 `reviewReady`。
- source drift 后 resume/retry/advance fail closed 为 stale。
- strict Client 拒绝 future version、unknown status/unit/attempt、非法 revision/count/hash/path 和自相矛盾 progress。

## Verification

- Core：全书 planner、semantic chunks、reduction tree、fingerprints、normalizers、quality report、attempt store、CAS/idempotency/restart/source drift/symlink。
- Agent：bounded prompt、no tools、rolling context、aggregate verified-only、style verified-only、evidence closure、prompt injection、finish reason 与 failure taxonomy。
- Backend：Preview -> Full units -> reviewReady、每请求一个 unit、pause/resume/cancel/retry、并发、跨实例 lease、restart adoption/interrupt、published bundle immutability。
- Client：full run/units/attempts/quality/receipt window 与新增命令 strict guards。
- Desktop：真实 References 组件的 Full progress、单 unit advance、pause/resume、failed-unit retry、diagnostics filtering、review-ready 状态。
- 回归：Core/Agent/Backend/Client/Desktop builds、相关 Vitest workspaces、全仓 `test:run` 与 `git diff --check`。

## Implementation Results

- Core 已落地 deterministic full work plan、长单行 source offset chunks、bounded reduction tree、typed normalizers、fingerprints、append-only attempt store、restart reconcile、downstream invalidation 与 deterministic analysis quality evaluator。
- Agent 已落地 chapter / aggregate / style typed runners；所有非 `stop` finish reason、structured no-output / parse / schema failure 都 fail closed 为 invalid output。
- Backend 已将 `advance` 扩展为 Preview / Full 单 unit controller，并补齐 pause / resume / retry routes、provider lease 与 workspace switch guard；provider 调用始终发生在 filesystem lock 外。
- Client 已增加 full stage / unit / attempt / quality strict transport guards 与命令方法；Desktop 已增加 progress、coverage、attempt history、diagnostics 和显式运行控制。
- `reviewReady` 是 D0–D3 analysis-level completion，不发布 reference bundle，也不改变小说 truth files；D4 / D5 保持独立后续切片。
- 独立审查后进一步加固：chapter / aggregate 输出在 selected 前执行同一 80 字 exact-overlap gate；所有 stored output 在 settlement、restart adoption 与 predecessor read 时经 canonical strict parser 重验；attempt artifact 使用 hard-link exclusive publish，并可严格收养 orphan input manifest 与 completed / failed receipt。
- Backend 使用本地 preparation guard 与独立 preparing lease 覆盖 reservation -> final lease 交接窗口；跨实例读取不会误中断合法 provider，dead / malformed owner 仍可安全恢复。Desktop 对结果不明的 pause / resume / retry 保留原 idempotency key，并在 receipt / revision 对账前锁定新操作。
- 全仓 `npm run test:run --workspaces --if-present` 通过：107 个测试文件、803 项测试；Core、Agent、Backend、Client 与 Desktop 相关 builds 通过，`git diff --check` 无 whitespace error。
