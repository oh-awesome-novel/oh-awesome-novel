# Advanced Director Controls F4 Implementation Plan

> Date: 2026-07-20
> Task: [1190 Advanced Director Controls And Long-session Rehearsal](../../tasks/1190.md)
> Status: Completed (2026-07-20)

## Delivery Boundary

本切片只扩展现有 Scene Rehearsal attempt。intervention、overlay、participant knowledge 与 memory 均复用 F1 attempt / settlement、M3 knowledge、M2 turn graph 和 M5 window / trace；不增加第二套 committed turn、event、schedule 或 checkpoint truth。

## Frozen Contracts

- `PlayDirectorIntervention` schema v1 是 append-only attempt artifact；每次 mutation 都有 intervention id、attempt revision、idempotency receipt、user provenance 与 createdAt。
- `reviseProjection` 携带 replacement blocks 与 expected effect fingerprint；只能改变可见叙事。
- `redirectStep` 携带 target step、director intent 与 typed constraint refs；生成新 step variant并失效目标后的 selected suffix。
- `insertActor` 只能引用 scene participant，并明确 before/after insertion point。
- `grantKnowledge` 只能引用 selected participant、stable existing fact refs，或显式 author-provided Play-local fact；从 effective step 生效。
- Scene Memory schema v1 绑定 session revision、selected turn refs、source hashes 与 projection lens，可随事实重建。

## Implementation Order

1. Core 新增 intervention normalization、effect fingerprint、append-only receipt 与 attempt revision transition。
2. 实现 earlier-step fork / suffix invalidation、insert order 和 pure provisional overlay adapter。
3. 扩展 M3 knowledge 为 participant-scoped grant evidence，并接入 perception package / Finish evidence。
4. 增加 dynamic / hybrid scheduler、typed `noMaterialEffect` 与 stagnation projection。
5. 增加 Scene Memory rebuild / stale projection，不改变 committed truth。
6. Backend / Client 增加 strict intervention、memory read/rebuild routes；复用 attempt conflict / recovery transaction。
7. Desktop 增加七控制、typed form、inspector、Lens 与 memory；系统化无障碍旅程留待后续产品阶段。
8. 分层回归并更新 task / plan。

## Correctness Gates

- 所有 intervention 追加保存；旧 step / variant 不被原地覆盖。
- revision、idempotency fingerprint、target step、participant、visibility 与 provenance 任一不一致均 fail closed。
- projection revise 的 settlement contribution fingerprint 必须 byte-stable。
- redirect / insert / grant 后旧 selected suffix 明确 superseded；Finish 只能提交新的有效 selected prefix。
- overlay evaluator 调用现有 due evaluator并保持排序 / trigger 语义；不得复制 evaluator。
- participant knowledge 不提升 event 全局 visibility，也不进入不相关 participant perception。
- memory、inspector 和 Player Lens 逐项执行 visibility projection，不保存 chain-of-thought。

## Verification

- Core：四类 intervention、revision/idempotency、fingerprint、fork/suffix、overlay parity、participant grant、scheduler、stagnation、memory stale/rebuild。
- Agent：perception grant、behavior anchor、omitted trace、防 hidden ref、`noMaterialEffect`。
- Backend/Client：strict wire contract、active attempt conflict、receipt replay、cancel/finalize interaction、memory routes。
- Desktop：七控制、修改双分支、插队、补充知识、suffix warning、Lens/inspector/memory 功能旅程。
- 回归 Quick Start、Immersive Journey、M2–M5、F1–F3、Restore / Retry / adoption；运行完整测试、Desktop build 与 `git diff --check`。
