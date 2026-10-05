# oh-awesome-novel Docs

面向小说作者的使用文档位于根目录 [wiki/](../wiki/index.md)，涵盖启动、配置、写作、章节整理审批、正文搜索与导出、参考资料、剧情排演、上下文用量和 Git。运行 `npm run docs:dev` 可本地阅读。当前目录继续维护架构、设计和开发任务。

`oh-awesome-novel` 是 filesystem-first 的长篇小说 AI Copilot / Novel IDE。稳定架构已经收敛为：

```text
oh-awesome-novel
    =
Filesystem First Novel IDE
    +
Aider-style Runtime
    +
Vercel AI SDK Tool Calling
    +
In-memory bash-tool / just-bash Editing
    +
Object File Tree
    +
CandidateChangeSet + PendingAction
    +
Git Diff Human Approval
```

核心原则：

- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 所有 canonical 写入必须经过作者确认。
- 模型只操作固定的内存投影，任意 host shell 与 host filesystem 均不可见。
- `CandidateChangeSet.changes` 是候选修改的唯一权威；diff 与 command log 只用于展示和审计。

## 稳定设计文档

- [PROJECT_VISION.md](PROJECT_VISION.md)：愿景、边界和非目标。
- [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md)：产品形态与主要旅程。
- [REQUIREMENTS.md](REQUIREMENTS.md)：功能、安全与非功能需求。
- [ARCHITECTURE.md](ARCHITECTURE.md)：组件边界与主数据流。
- [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md)：小说对象文件树与内部状态边界。
- [SANDBOX_CHANGE_ENGINE.md](SANDBOX_CHANGE_ENGINE.md)：ChangeSet authority、威胁模型、沙箱、生命周期、materializer 与 reset 边界。
- [AGENT_RUNTIME_AND_TOOLS.md](AGENT_RUNTIME_AND_TOOLS.md)：Runtime、ToolSet 与 turn-scoped edit session。
- [HUMAN_APPROVAL_AND_GIT.md](HUMAN_APPROVAL_AND_GIT.md)：PendingAction 决策、事务落盘与 Git side effect。
- [NOVEL_CONSTITUTION.md](NOVEL_CONSTITUTION.md)：项目创作宪法。
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)：当前里程碑与开发顺序。
- [tasks/README.md](tasks/README.md)：可执行 task 状态入口。
- [AGENT_OPERATING_MANUAL.md](AGENT_OPERATING_MANUAL.md)：开发 Agent 操作手册。

专题规格与研究材料仍保留在 `docs/`，但不能覆盖上述稳定文档或 [ADR 0004](adr/0004-sandbox-change-engine.md) 的当前决策。`reference-only/` 与文件名包含 `REFERENCE` 的分析文档只用于比较和追溯，不是产品运行时合同。

## 设计与实现评估

- [简短说明](DESIGN_IMPLEMENTATION_REVIEW_SUMMARY.md)：2026-10-01 的取舍、优先级与建议开发顺序。
- [详细说明](DESIGN_IMPLEMENTATION_REVIEW_DETAILED.md)：对应文档与源码证据、真实缺口、修正建议和验收条件。

评估文档是带日期的建议，不替代稳定合同；尚未实施的建议不能视为当前功能或已更新的 task 状态。

## ADR

- [ADR 0001: Filesystem First](adr/0001-filesystem-first.md)
- [ADR 0002: No Heavy Agent Frameworks](adr/0002-no-heavy-agent-frameworks.md)
- [ADR 0003](adr/0003-semantic-patch-apply-engine.md)：Superseded 历史决策。
- [ADR 0004: Sandbox Change Engine](adr/0004-sandbox-change-engine.md)：当前写入决策。

## 推荐阅读顺序

1. [PROJECT_VISION.md](PROJECT_VISION.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md)
4. [SANDBOX_CHANGE_ENGINE.md](SANDBOX_CHANGE_ENGINE.md)
5. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)
6. [AGENT_OPERATING_MANUAL.md](AGENT_OPERATING_MANUAL.md)

早期讨论中的 `StoryForge` 只作为历史参考来源，不是当前产品名、组件名、目录名或兼容目标。

当前修正交付与暂缓范围见 [1230 Review-driven Reliability Corrections](tasks/1230.md)。2026-10-05 已交付 [1290 Long-novel Context And Memory Freshness](tasks/1290.md)、[1300 Author Manuscript Markdown Import](tasks/1300.md) 和 [1310 Delivery Quality Gates And Reviewed Git Commits](tasks/1310.md)。1310已通过本机完整质量与打包旅程，跨平台CI尚未远程执行；对应作者说明见 [上下文与用量](../wiki/guide/usage.md) 和 [导入旧稿](../wiki/guide/manuscript-import.md)。
