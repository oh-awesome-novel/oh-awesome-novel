# Reference Work Deep Deconstruction D0 + D1 Implementation Plan

> Date: 2026-07-22
> Task: [0900 Project References And Deconstruction](../../tasks/0900.md)
> Related plan: [Reference Work Deep Deconstruction Upgrade Plan](../../REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md)
> Status: Completed

## Delivery Boundary

本切片只完成 D0 状态 / 存储契约与 D1 Quick Preview 纵向旅程。它不执行分章全量拆解、聚合、style、distill、quality publish 或 entry-level selector；这些仍属于 D2–D5。

- 导入只写用户显式提供的 source、确定性 metadata / source manifest，以及 `notAnalyzed` 的 deconstruction manifest / diagnostics / progress projection。
- 不再生成看似已经完成 AI 分析的 aggregate、chapter summary 或 distilled placeholder。
- `enabled` 只是用户偏好；`contextEligible` 由 current source、accepted published run、quality pass 与合法 bundle path 共同决定。
- Quick Preview 只写 `.workspace/sessions/<runId>/reference-deconstruction/`，不会写 published reference bundle，也不会修改小说 truth files。
- Preview 后的 Continue 只记录 full deconstruction 的显式计算授权；D2 未落地前不会自动调用 provider 或伪报 full running。
- 当前产品未发布：未知 / 旧 bundle 不做 migration，统一 fail closed 并提示重新导入或重建。

## Frozen Core Contracts

### Published baseline

- Pipeline stages 固定为 `detectStructure | quickPreview | chapterAnalysis | aggregateAnalysis | styleProfile | distillForOan | qualityGate`。
- Import baseline status 为 `notAnalyzed`，revision 为 `0`，所有 AI stage 为 `notStarted`。
- `deconstruction-manifest.yaml` schema v1 记录 reference/source/structure/pipeline/capability identity、status、qualityStatus、stages 与 outputs；D0 baseline 没有 `publishedRunId`。
- `diagnostics.yaml` schema v1 使用 typed severity/code/message/blocking，并且不得存 prompt、原文或长 stack。
- `progress.yaml` 只是 manifest 的人类可读 projection。
- 缺失 manifest、未知 version、metadata/index shape 非法、checksum 漂移、越界 summary path、incomplete/stale/qualityFailed 都不得进入 context selector。
- Selector token budget 是硬上限，包括第一项；普通写作路径 `originalSourceRead` 永远为 `false`。

### Source window and preview

- Quick Preview 默认选择前 1–3 个已识别章节，同时受总字符硬上限约束；超长章按段落边界生成确定性 chunk。
- Source pointer 固定包含 `referenceId/sourceChecksumSha256/chapterId/chunkId/lineStart/lineEnd`；模型只看到宿主提供的 opaque evidence id。
- Preview typed output 固定包含 source overview、chapter previews、findings、borrowable patterns、do-not-copy、differentiation requirements/prompts、canon contamination warnings、coverage/confidence/uncertainties。
- schema 不提供 quotation、excerpt、rewrite 或 reasoning 字段。宿主在保存 candidate 前重新验证 evidence closure、pointer membership、数量与字符串上限。

### Run lifecycle

- D1 run status 为 `created -> previewRunning -> awaitingFullApproval -> fullApproved`，另有 `cancelled | failed | interrupted | stale`。
- create / approve-full / cancel 都要求 `baseRunRevision`（create 为 0）与 `idempotencyKey`；同 key + 同 payload replay，同 key + 异 payload fail closed。
- 每个 reference 同时只允许一个 active preview chain。
- Provider 执行期间只存在一个 abort controller；cancel 后 published bundle 零改变。
- 低置信结构的默认 detected range 必须有显式 confirmation；确认字段保存在 request artifact 并参与 create fingerprint，不能只存在于 UI 临时状态。
- Provider 执行使用 owner lease 协调多个 Backend 实例；存活 lease 阻止错误 restart reconcile，dead / orphan lease 可恢复。
- `.workspace` run、lock 与 provider lease 的每级目录和 artifact 都执行 no-symlink / realpath containment，越界目录保持零写入。
- 应用重开读取到 `previewRunning` 时规范化为 `interrupted`，绝不自动续调 provider。
- `fullApproved` 只是 D2 的显式授权 receipt，不执行 D2 工作。

## Component Map

```text
ReferenceImportTab.vue
  -> composition/orchestration only
  -> ReferenceImportForm.vue
  -> ReferenceList.vue
  -> reference/ReferenceDeconstructionPanel.vue
       -> reference/ReferenceQuickPreview.vue
       -> reference/ReferenceDiagnostics.vue

useReferenceDeconstruction.ts
  -> owns selected reference/run, loading/action/error state
  -> calls strict client methods
  -> exposes start/reconcile/approve/cancel actions
```

- 数据自上而下传入；Panel / Preview / Diagnostics 只通过 typed emits 请求动作。
- UI source state 使用 `shallowRef`；显示文案、按钮可用性与状态标签使用 `computed`，不复制派生状态。
- 不新增第二个全局 store，也不让 Vue 直接读取 filesystem。

## Implementation Order

1. Core 新增 deconstruction schema、strict parsers、fingerprint/source pointer、bounded preview window、run artifacts 与 deterministic formatters。
2. 修正 reference import/list/enable/selector：只导入、严格 index/metadata/manifest reader、bundle containment、checksum/current/readiness 与硬预算。
3. Agent 新增单模型、无 tools 的 `generateText + Output.object` typed Preview runner，并执行 host-side strict validation。
4. Backend 新增 create/get/approve-full/cancel routes；请求内完成 bounded Preview，保存 `.workspace` run artifact，提供 idempotency/revision/cancel/restart reconcile。
5. Client 为现有 Reference envelope 与新增 run/preview/diagnostics 增加 strict runtime guards；context request 接通 capability/goal/explicit ids。
6. Desktop 按组件图补入 Not analyzed -> Preview -> Awaiting approval -> Full approved / Cancelled journey。
7. 在根目录 Core / Agent / Backend / Client / Desktop test workspaces 增加纵向测试，完成 build、相关测试、完整回归与文档同步。

## Correctness Gates

- 新导入 reference 即使 `enabled: true` 也被 selector 以 `not analyzed` omitted。
- 手改 source、旧/未知 manifest、越界 summary path、超预算第一项都 fail closed。
- Preview 模型输入最多 3 章且不超过字符预算；未选中的正文不会进入 prompt。
- Reference 中的“忽略规则/调用工具”只作为 source data；runner 没有 tools。
- 非 general inference finding 必须引用本次 opaque evidence id；未知/cross-reference id 拒绝。
- Provider、parse、validation、cancel、restart interruption 不写 published bundle。
- 重复命令遵循 revision/idempotency；并发 preview 不产生两个 active run。
- Continue gate 留下显式 receipt，但不会越界执行 D2。

## Verification

- Core：notAnalyzed import、manifest/diagnostics/progress strict round-trip、bounded chunk identity、source pointer closure、readiness/path/checksum/budget omissions。
- Agent：bounded prompt、structured output、无 tools、prompt-injection fixture、evidence validation、abort/provider/schema failure。
- Backend：create/get/approve/cancel、one-active-run、CAS/idempotency、restart reconcile、published bundle immutability。
- Client：所有 reference/run/preview/diagnostic envelope strict guard，未知版本/status/revision/oversized payload fail closed。
- Desktop：使用真实 References 组件验证导入状态、Preview 展示、Continue confirmation、Cancel/error/reconcile；不显示 source 原文或 reasoning。
- 回归：Core/Agent/Backend/Client/Desktop builds，相关 Vitest workspaces，全仓测试与 `git diff --check`。

### Verification Results（2026-07-22）

- Core：`34 files / 275 tests passed`。
- Agent：`6 files / 39 tests passed`。
- Backend：`5 files / 88 tests passed`，包含低置信 typed 422、source drift、损坏 request、跨实例 live/dead/crash-window lease 与 symlink 外部零写入。
- Client：`7 files / 103 tests passed`。
- Desktop：`42 files / 183 tests passed`；`vue-tsc -b && vite build` 通过。
- Core / Runtime / Tools / Agent / Backend 依赖构建由 Backend pretest 顺序执行并通过；`git diff --check` 通过。
- 全仓 `npm run test:run --workspaces --if-present`：`102 files / 756 tests passed`，包含 Runtime 与 Tools 回归。
