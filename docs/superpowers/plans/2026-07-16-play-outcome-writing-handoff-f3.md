# Play Outcome And Explicit Writing Handoff F3 Implementation Plan

> Date: 2026-07-16
> Task: [1150 Play Outcome And Explicit Writing Handoff](../../tasks/1150.md)

## Delivery Boundary

本切片只完成 Play F3。Outcome 来自 immutable turn graph 的当前 selected path；报告与附件都位于 `.workspace`，不建立 Scene Memory、知识 ledger、checkpoint / variant 目录或 canonical 副本。

## Frozen Component Map

```text
PlayWorkspace.vue
  -> PlayOutcomePanel.vue
       -> PlayOutcomeItem.vue
       -> Writing Reference actions
  -> usePlayOutcome.ts

CopilotPanel.vue
  -> request-local Writing Reference selector
  -> useAgentConversationSessions.ts
       -> one-shot attachment ids in /api/agent/chat body
```

- `PlayWorkspace.vue` 只接线选中 session、spoiler lens 与刷新事件。
- `PlayOutcomePanel.vue` 负责报告生成、分组浏览、选择与 attachment lifecycle。
- `PlayOutcomeItem.vue` 只展示单条 evidence footprint，不持有异步状态。
- `usePlayOutcome.ts` 负责 report / attachment / adoption API、stale 状态与 session 切换隔离。
- Copilot 的附件选择是单次请求状态；发送成功或切换对话后清空。

## Implementation Order

1. Core 冻结 Outcome schema、selected-branch evidence index、visibility dominance、Player / Director projection、稳定 item id 与 report fingerprint。
2. Core 冻结 Writing Reference schema、create-only / detach / stale validation，并让 session staged writer 显式保留 `reports/`。
3. Backend 增加 report create/read、attachment create/list/detach、outcome-to-adoption routes；全部在 active attempt、revision、branch 与 source drift 边界 fail closed。
4. Agent context assembler 接受严格有界的显式 attachment id，输出 `userSelectedContext` trace 与受限 Runtime context；未传 id 时不扫描 active attachments。
5. Client 增加公开类型、严格响应 guard 与 chat request body 支持。
6. Desktop 按冻结组件图接入 v4 / v5，提供 Player / Director lens、分组选择、attachment 审计与 request-local 写作附件选择。
7. 补齐 Core / Agent / Backend / Client / Desktop 回归、生产 build，并更新 task 状态和 Implementation Notes。

## Correctness Gates

- `committedTurnRefs` / item `turnRefs` 只表示 turn artifact id；candidate 的 `sourceTurnIds` 必须从 evidence owner 映射为 transcript message id。
- 所有 outcome item 至少引用一个 selected evidence；Core 重新计算 visibility 和 closure，不信任调用方声明。
- `outcome.yaml` 是结构化 derived artifact，`outcome.md` 只是同一报告的可读投影。
- Attachment 保存 report fingerprint、selected item identity 与 evidence closure；只要 report、selected path、revision 或 source hash 不一致就不可消费。
- report / attachment / candidate 生成期间若存在 active rehearsal attempt，返回冲突，不读取 provisional step 当 committed truth。
- pending-action route 在执行 write intent 前重新验证 candidate 当前仍属于 selected branch；Restore / Retry 后 sibling candidate fail closed。
- Player projection、附件预览和 adoption label 都不能从隐藏 item 生成 fallback 文本。
- detach 不删除审计文件；canonical mutation 仍仅由既有 PendingAction accept 完成。

## Verification

- Core：v4 / v5 evidence、sibling exclusion、visibility、stable identity、round trip、stale / detach、session rewrite 保留 reports。
- Agent：显式 attachment selected context / trace；无 id、detached、stale 与 hidden selection拒绝；不保存 raw model output / CoT。
- Backend：revision / active-attempt guard、attachment lifecycle、chat 422、Restore 后 candidate 失效、PendingAction accept 前 canonical unchanged。
- Client：URL、请求体、strict unknown-field / enum / ref guard。
- Desktop：v4 / v5 panel、lens 防泄漏、键盘选择、one-shot 写作附件与错误恢复。
- 运行各 workspace `test:run`、Desktop production build，并检查仅 task 范围文件进入 diff。
