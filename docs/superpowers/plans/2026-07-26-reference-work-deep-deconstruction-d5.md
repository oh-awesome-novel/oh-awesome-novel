# Reference Work Deep Deconstruction D5 Implementation Plan

> Date: 2026-07-26
> Task: [0900 Project References And Deconstruction](../../tasks/0900.md)
> Related plan: [Reference Work Deep Deconstruction Upgrade Plan](../../REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md)
> Prerequisite: [D4 Implementation Plan](./2026-07-26-reference-work-deep-deconstruction-d4.md)
> Status: Completed

## Delivery Boundary

本切片把现有 reference-level summary selector 升级为 published typed-entry selector，并完成从真实 References product component 到普通 Writing context selection 的可解释旅程。

- Selector 只读取 current / accepted / quality-passed bundle 的 `context/index.yaml` 和 manifest-listed distilled outputs。
- 普通规划、写作、审稿请求不读取 `sources/`、deconstruction evidence 或 provisional run artifact。
- capability、goal、scene / pacing / hook hints 与 explicit reference ids 只用于 deterministic matching；不引入 vector DB 或隐藏 provider call。
- token budget、entry count、reference count都是硬上限。
- 当前产品未发布：直接升级现有 context endpoint / client envelope，不保留旧 reference-summary response migration。

## Frozen Contracts

### Entry-level selection

```ts
interface IncludedReferenceContextEntry {
  id: string;               // distilledEntryId
  referenceId: string;
  referenceTitle: string;
  entryTitle: string;
  category: ReferenceDistilledCategory;
  path: string;
  tags: string[];
  capabilityIds: NovelCopilotCapabilityId[];
  reason: string;
  reasonCode: 'explicitReference' | 'capabilityMatch' | 'taskMatch' | 'fallback';
  estimatedTokens: number;
  content: string;
  budgetLayer: ContextBudgetLayer;
  semanticBoundary: 'compressible';
}
```

Omitted trace 同时覆盖 reference-level 和 entry-level：

- reference：disabled / notExplicitlyRequested / notAnalyzed / stale / qualityFailed / needsRebuild / invalid index。
- entry：capabilityMismatch / taskMismatch / maxEntryCountReached / maxReferenceCountReached / tokenBudgetExceeded。
- 每项包含 `scope`、reference identity、可选 entry identity、reason / reasonCode / estimatedTokens。

### Deterministic matching

选择顺序：

1. explicit reference filter；
2. published readiness / manifest / index / checksum closure；
3. capability id 精确匹配；
4. scene / pacing / hook / character / style category hint；
5. normalized goal token 与 tags / whenUseful 的 bounded match；
6. stable score、reference order、category order、entry id tie-break；
7. hard maxReferences / maxEntries / tokenBudget packing。

- explicit reference 只提高 reference scope 优先级，不绕过 readiness、entry mismatch 或 token budget。
- 没有正向匹配时可选择每个 eligible reference 的 bounded fallback entry，并明确 `reasonCode: fallback`。
- no-copy / differentiation warnings 作为 protected context 单独携带，不消耗为 source prose，也不声明绝对法律安全。

### Context trace

- `originalSourceRead` 永远为 `false`，否则 response validation fail closed。
- formatted Markdown 显示每个 included entry 的 reference、entry、category、path、reason、tokens。
- `referenceSelectionToContextSources` 以 entry 为单位输出 selected / omitted source trace。
- normal Writing context package 保存 selector included / omitted trace；不保存隐藏 reasoning。

## Vue Component Map

```text
ReferenceImportTab.vue
  -> ReferenceContextSelectionPanel.vue
       -> included entry rows
       -> omitted reference / entry rows
       -> budget summary and source-read status
  -> ReferenceDeconstructionPanel.vue
       -> published entry inventory summary

Workspace writing request
  -> existing Backend context assembly
       -> selectReferenceContext()
       -> formatted selected entry content
       -> ContextSourceRef trace
```

- `ReferenceContextSelectionPanel.vue` 只负责 selection explanation；不重新实现 scoring。
- 同一 selection payload 是 UI 与 normal Writing context assembly 的共同真相。
- 使用已有 native controls / text status；系统化无障碍矩阵继续暂缓。

## Implementation Order

1. Core 增加 strict context index reader、entry checksum/path/finding closure 校验与 deterministic matcher。
2. 更新 `ReferenceContextSelection`、Markdown formatter 与 ContextSourceRef entry-level trace。
3. Backend context endpoint 和普通 writing context assembly 使用同一 selector contract。
4. Client 增加 entry-level request/response strict guard，拒绝未知 category/reason/path/capability/token shape。
5. Desktop 展示 entry inventory、included / omitted / reason / budget/source-read explanation。
6. 增加真实组件旅程：Import -> Preview -> Full -> Distill -> Review -> Publish -> Writing selection。
7. 运行分层、全仓测试与 builds，更新 0900 和升级计划状态。

## Correctness Gates

- disabled / stale / incomplete / unaccepted reference 的任何 entry 都不能 included。
- manifest 未列出的 index、distilled path 或 checksum mismatch fail closed。
- included token 总和不超过 budget；不能以“至少一项”为由塞入超预算 entry。
- capability / task mismatch 有明确 omitted trace；stable input 得到 stable order。
- normal writing prompt 只包含 selected typed entry formatter 和 protected warning，不包含 source / provisional findings。
- UI 显示 entry id/title/category/reference/reason/omission/budget，并明确 `distilled only`。

## Verification

- Core：strict index、readiness、matching/score/tie-break、explicit refs、hard budgets、omission trace、source-read invariant。
- Backend：context endpoint 与 normal writing assembly 共享 selector；published-only / no-source。
- Client：future schema、unknown category/reason/capability、invalid paths/counts/tokens fail closed。
- Desktop：entry-level included/omitted explanation、published entry inventory、完整真实组件旅程。
- 回归：Core/Backend/Client/Desktop builds、相关 Vitest workspaces、全仓 `test:run`、`git diff --check`。

## Implementation Result

- Core 已完成 strict published context index、manifest-listed distilled checksum closure、deterministic scoring / tie-break、explicit reference filter、bounded fallback 与 hard reference / entry / token budgets。
- 普通 selector 只读顶层发布投影、context index / summary 和 index 指向的 distilled outputs；`sources/`、deconstruction evidence 与 provisional run artifacts 在 normal Writing 路径物理不可用时仍可完成选择。
- Backend context endpoint 与 normal Writing assembly 共用 selector；normal Writing 只有 request-local reference intent 明确时才激活 recall。Agent context package保存 entry-level trace 与 protected no-copy / differentiation boundary。
- Client 对 category、reason、capability、path、count、token 和 `originalSourceRead` 执行 strict validation；Desktop 展示 entry inventory、included / omitted 原因、预算与 distilled-only 状态。
