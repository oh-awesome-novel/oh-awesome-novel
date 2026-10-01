# AI SDK 7 Migration Plan

Related task: [1240](../../tasks/1240.md)

1. 提交已有评审修正为 `17ab51b`，保留独立用户技能改动。
2. 核对 npm latest 与官方 migration guide，统一升级 ai/OpenAI/Vue workspace 声明及 lockfile；保留支持 SDK 7 的 pinned sandbox dependencies。
3. 标准 Agent/Reference/Play 的 SDK `system` → `instructions`，`fullStream` → `stream`；通过 `finalStep` 保留原末步工具调用语义。内部 Runtime role/system 合同不机械重命名。
4. 对照目标包工具执行类型修正调用上下文，保留单一 Runtime 执行权与 SDK 工具 execute 剥离。
5. 审计 Vue Chat/useChat、client transport、UI stream 和已有 persisted message shape；只迁移当前实际使用接口。
6. 更新 mock 和有意义的迁移回归；按依赖顺序构建，执行分层测试、桌面类型检查和打包入口 smoke。
7. 记录版本、验证结果、既有 typecheck 限制；不扩大到 Extension 或其它功能。

Status: Completed (2026-10-01). 实际版本、实现边界与验证记录见 [1240](../../tasks/1240.md)。
