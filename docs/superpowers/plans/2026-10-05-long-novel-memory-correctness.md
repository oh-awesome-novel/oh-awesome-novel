# Long-novel Memory Correctness Plan

Related task: [1290](../../tasks/1290.md).

## Design

当前全局状态与历史证据是不同的上下文用途。保留完整 filesystem-first 数据和固定沙箱，仅在消息组装前显式选择任务所需内容。预算拒绝机制继续保护必要输入，不用静默截断掩盖来源错误。

## Steps

- [x] Core：从冻结 path/content 快照评价结算来源，复用正文原字节 SHA-256；严格区分 current / stale / missing / unverified。
- [x] Core / Agent：健康报告复用同一 evaluator，消除 mtime 与重复规则；新鲜度仅作 soft warning。
- [x] Agent：全局当前状态、显式选章证据与其它章级历史分层；提供有界覆盖提示和明确省略原因。
- [x] Agent：摘要只把当前证据视为当前事实，作者无来源摘要显式标记；保留 canonical/source hash 与模型 payload hash 的区别。
- [x] Tests：正文变化、touch、缺失/损坏/矛盾来源、手写摘要、固定投影一致性，以及 100/500 章、多轮修订的上下文规模。
- [x] 验证相关 Core / Agent / Backend / Client / UI 回归和构建；记录既有 typecheck 边界，更新稳定文档、task 与 wiki。
