# Reference Work Deep Deconstruction D4 Implementation Plan

> **Status: Historical implementation record (dated 2026-07-26). Current write architecture is governed by ADR 0004; do not reuse legacy write APIs from this plan.**

> Date: 2026-07-26
> Task: [0900 Project References And Deconstruction](../../tasks/0900.md)
> Related plan: [Reference Work Deep Deconstruction Upgrade Plan](../../REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md)
> Status: Completed

## Delivery Boundary

本切片从 D3 的 typed aggregate / style output 继续，完成 `distillForOan`、最终发布质量门、deterministic candidate formatter 与多文件 PendingAction 发布闭环。

- Distill 是现有 full work plan 的 request-bounded 单元，位于 style 与最终 quality gate 之间；不建立后台 job 或第二套 post-review run。
- Distill 模型只能读取 verified aggregate / style typed output，不能读取 reference 原文、任意 filesystem path、provider secret 或工具定义。
- typed output、candidate 与 PendingAction shadow write 只进入 `.workspace`；Accept 前真实 reference bundle 零改变。
- Publish 只 materialize 当前 run 的完整同版本文件集；Accept 沿用 `git.autoCommitOnAccept`。
- Reject 回到 `reviewReady`，允许用户重新生成发布候选；Cancel 仍只适用于 publish barrier 前的分析 run。
- 当前产品未发布：不实现旧 work-plan / bundle / endpoint migration，也不扩展系统化无障碍矩阵。

## Frozen Contracts

### Work-plan terminal shape

```text
chapterChunk*
  -> aggregate reduction tree
  -> style
  -> distill
  -> quality
  -> reviewReady
```

- `distill` 的 `stageId` 是 `distillForOan`，依赖 final aggregate 与 style selected attempts。
- 最终 deterministic quality unit 校验全部 analysis output、distilled entry closure、required category、token estimate、candidate path 与 no-copy 风险。
- retry 任意 predecessor 会确定性失效 distill / quality selected attempt。
- 每次 `advance` 仍只执行一个单元；distill provider call 与 quality host unit 不在请求结束后继续。

### Typed distilled entry

```ts
interface ReferenceDistilledEntry {
  id: string;
  category: 'writingStyle' | 'pacing' | 'hooks' | 'scene' | 'character';
  title: string;
  technique: string;
  whenUseful: string[];
  constraints: string[];
  differentiationPrompts: string[];
  sourceFindingRefs: string[];
  confidence: 'low' | 'medium' | 'high';
  tags: string[];
  capabilityIds: NovelCopilotCapabilityId[];
  estimatedTokens: number;
}
```

- `id` 由 run / category / finding closure / normalized content fingerprint 确定性派生；模型不控制最终 id。
- `sourceFindingRefs` 必须闭合到 distill 请求中的 verified finding allowlist。
- 不提供 quotation / excerpt / imitation / rewrite / source-name 字段。
- technique、constraint、prompt 与 tag 不得包含原作专有名词密集片段、直接引语或 80 字以上 source exact overlap。
- 至少覆盖五个 category；每类 entry 数、总 entry 数、字符串长度与 token estimate 都有硬上限。

### Candidate files

Candidate 固定写入：

```text
.workspace/sessions/<runId>/reference-deconstruction/candidate/
  examples/references.yaml
  examples/references/<referenceId>/
    deconstruction-manifest.yaml
    diagnostics.yaml
    progress.yaml
    deconstruction/quick-preview.md
    deconstruction/chapters/*.md
    deconstruction/{plotlines,characters,relationships,worldbuilding,timeline,tropes}.md
    deconstruction/style-profile.md
    distilled/{writing-style,pacing,hooks,scene-techniques,character-techniques,do-not-copy}.md
    context/index.yaml
    context/reference-summary.md
```

- 所有文件由 typed records 经 deterministic formatter 生成。
- `context/index.yaml` 保存 strict typed entries、category/tags/capability/token estimate、content path 与 finding closure。
- manifest outputs 记录每个 published output 的 kind / relative path / checksum。
- candidate fingerprint 覆盖 run identity、source/structure、pipeline/capability、selected attempt closure 与所有 target file hash。
- metadata 和 source 不重写；项目 `references.yaml` 只更新当前 reference 的 published readiness projection。

### Publish PendingAction

```text
reviewReady
  -> publishing(pendingActionId, candidateFingerprint)
      -> completed     # PendingAction accepted and materialized
      -> reviewReady   # PendingAction rejected
```

- `publish` 命令要求 `baseRunRevision + idempotencyKey`；同 key / 同 payload 返回同一 PendingAction。
- PendingAction 使用 reference-scoped raw create/replace file patch，只允许
  `examples/references.yaml` 与当前 `examples/references/<referenceId>/` candidate targets。
- PendingAction preview 记录每个 target baseline hash，Accept 前重新校验 source、run revision、candidate fingerprint 与 target drift。
- 多文件 materialization 使用现有 stage / backup / rollback 事务；任一写入失败则回滚全部 target。
- Accept 后才把 shadow run 标记 `completed`；若接受成功后的 run-state write 中断，GET reconcile 以 current published manifest + PendingAction archive 恢复 terminal truth。
- Reject 不 materialize 文件，不改变 published manifest / progress / index。

## Vue Component Map

```text
ReferenceImportTab.vue
  -> ReferenceDeconstructionPanel.vue
       -> ReferenceFullDeconstructionProgress.vue
       -> ReferencePublishReview.vue
            -> candidate file list / diff summary / warnings
            -> create-or-open PendingAction

useReferenceDeconstruction.ts
  -> request-local publish mutation
  -> readonly publish receipt / reconciliation state
```

- `ReferencePublishReview.vue` 只呈现 candidate / PendingAction receipt 并 emit publish / review。
- 全局 PendingAction 审批面板继续负责 Accept / Reject，不复制第二套 diff viewer。
- props down / typed emits up；composable 不读取 filesystem，不直接 materialize candidate。

## Implementation Order

1. Core 新增 distill work unit、typed entry / output strict schema、normalizer、formatter、index schema与最终质量检查。
2. Agent 新增 `generateReferenceDistillation`，使用 `generateText + Output.object`、verified-only prompt、无 tools。
3. Core store 让 distill 复用 attempt / retry / reconcile，并新增 candidate build、publish reservation / completion / rejection。
4. Tools 增加 reference-scoped 多文件 create/replace PendingAction slice，复用现有 atomic materialization。
5. Backend / Client 增加 publish route、strict PendingAction receipt、Accept / Reject lifecycle reconciliation。
6. Desktop 增加 review-ready candidate / publish entry point，并复用全局 PendingAction diff/decision surface。
7. 增加 Core / Agent / Tools / Backend / Client / Desktop tests，运行 builds、全仓 regression 与文档同步。

## Correctness Gates

- Distill prompt 中不出现 source 原文、source path、workspace 其它文件或工具定义。
- 非 allowlist finding closure、未知 capability/category、非法 token estimate、缺少 category 或 copy-risk 输出阻止 `reviewReady`。
- Candidate formatter 对相同 typed input 逐字节稳定；任意 candidate path 越界 fail closed。
- Publish 前后 source / structure / selected attempt / candidate / target 任一漂移都阻止 Accept。
- Publish PendingAction Accept 是一次多文件事务；Reject、失败或进程中断不产生部分 bundle。
- 只有 current、accepted、quality-passed、manifest/output hashes 完整的 bundle 才变为 `contextEligible`。
- Accept 自动 Git 行为只读取现有 workspace 配置；禁用 auto-commit 时保留可见 diff。

## Verification

- Core：distill plan/normalizer/schema/closure/formatter/candidate hash/quality/publish lifecycle/reconcile。
- Agent：verified-only bounded prompt、no tools、prompt injection、schema failure、non-stop finish、no-copy。
- Tools：多文件 create/update preview、baseline drift、atomic rollback、Accept/Reject、auto-commit on/off。
- Backend：full -> distill -> quality -> reviewReady -> PendingAction -> completed/rejected、双 publish/CAS/source drift。
- Client：distilled output / publish response / run publish state strict guards。

## Implementation Result

- Core / Agent 已完成 distill work unit、五类 typed entries、verified-only structured generation、deterministic formatter、最终质量门与发布候选。
- Tools / Backend 已完成 candidate-bound 多文件 PendingAction、跨进程互斥、全局 terminal identity、持久 materialization journal、原子 archive、Accept / Reject / crash reconciliation 与现有 Git 配置继承。
- Client / Desktop 已完成 strict publish transport、`reviewReady -> PendingAction -> global approval` handoff、candidate inventory / diff summary 与 accepted / rejected terminal reconcile。
- Accept 前真实 reference bundle 保持不变；Reject、失败与可恢复进程中断不产生部分 published artifact。
- Desktop：真实 References 组件的 review/publish/PendingAction handoff 与 reopen reconcile。
- 回归：Core/Agent/Tools/Backend/Client/Desktop builds、相关 Vitest workspaces、全仓 `test:run`、`git diff --check`。
