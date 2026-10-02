# Review-driven Reliability Correction Plan

Related task: [1230](../../tasks/1230.md)

2026-10-01：以评审建议收敛后续开发，不覆盖稳定架构。Extension、更多 Director/Reference 扩展暂缓。

## 1. First use and approvals

- [x] 新建空目录使用真实 Git 初始化和首个基线；已有工程不隐式提交。
- [x] Git 不可用、缺 identity/HEAD 有具体恢复状态。
- [x] 文件 commit point 与 Git 对账分离；receipt 中断和作者后续编辑回归。
- [x] status/name-status NUL 解析；rename 双路径；真实用户提交范围的完整 diff。

## 2. Final tree and context

- [x] 类型化最终树引用 inventory；同候选新建、删除、未知引用、namespace 错配。
- [x] proposal 与 Accept 共用合同；窄模型投影不扩权。
- [x] 修正文档样例并用真实 validator 验证。
- [x] 目标附近/最新摘要、全局/卷锚点、完整 Constitution/state。
- [x] 逐文件 source/payload 证据和预算未知语义；每个 step 实施估算预算与输出上限。
- [x] 恢复会话按固定投影比较 hash，并显示作者提示。
- [x] `1110` 标准Agent G1–G6：compressible omission、protected overflow、actual usage、egress/inspector。
- [x] `1030` 最小结构化单章结算旅程。

## 3. Play reliability and scale

- [x] 在既有协作锁/CAS下补 stage/ready/rename/publish/cleanup 持久化顺序。
- [x] 在关键边界进程中断并重启验证原子恢复；不宣称覆盖全部断电行为。
- [x] 持久化最小运行身份与 artifact hash，重启优先从 session artifact 对账提交结果；未决结果明确 unknown。
- [x] provider/来源读取 deadline、慢 SSE reader 字节队列上界、shutdown 取消/等待 commit barrier；根目录 `play-turn-recovery.test.ts` 覆盖，不能强制终止不服从 abort 的底层计算。
- [x] 测真实底层 I/O；再实施可重建索引和窗口读取，保持历史校验与隐藏内容边界。

## 4. Author productivity, separately accepted

- [x] `0570` 中文正文/标题/路径搜索、snippet、刷新、右侧打开。
- [x] `0700` / `1270` 最小 Markdown/TXT 正文导出，明确目标与覆盖。
- [ ] 作者旧稿导入预览与同一 ChangeSet 审批。
- [ ] 卷/全局摘要来源覆盖、hash 和失效规则。

## Verification

先跑各模块目标回归和 build，再跑跨模块相关 suite。已有裸 tsc 的基线错误与本次新增错误分开记录；不把 build 冒充全仓 typecheck。保留评审文档的原基线结论，最新实现证据记在 task notes。
