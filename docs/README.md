# oh-awesome-novel Docs

面向小说作者的使用文档位于根目录 [wiki/](../wiki/index.md)，涵盖启动、配置、写作、章节整理审批、正文搜索与导出、参考资料、剧情排演、上下文用量和 Git。运行 `npm run docs:dev` 可本地阅读。当前目录继续维护架构、设计和开发任务。

`oh-awesome-novel` 是 filesystem-first 的个人同人/综漫创作工作台（Play 推演 + Writing 写作双核心），定位见 [PROJECT_VISION.md](PROJECT_VISION.md)。Play 与 Writing 同级且 Play 保持高优先级；不以商业化、连载或多人协作为目标。稳定架构已经收敛为：

```text
oh-awesome-novel
    =
Filesystem-first Fanfiction Story Workbench
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

## 目录结构

```text
docs/
├── *.md          产品与工程的稳定合同（本页列出）
├── tasks/        可执行任务：范围、状态与验收入口
├── adr/          架构决策记录
├── plans/        专题升级计划（带日期，按 task 实施）
├── superpowers/plans/  task 对应的实施步骤
├── reviews/      带日期的设计与实现评估
├── research/     参考项目分析（只用于比较和追溯）
└── archive/      原始讨论记录等历史材料
```

`plans/`、`reviews/`、`research/` 与 `archive/` 不能覆盖稳定文档或 [ADR 0004](adr/0004-sandbox-change-engine.md) 的当前决策；`reference-only/` 与 `research/` 下的分析只用于比较和追溯，不是产品运行时合同。

## 产品文档

- [PROJECT_VISION.md](PROJECT_VISION.md)：定位、用户、双核心旅程与非目标（2026-10-15 重新定位）。
- [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md)：产品形态、两条主要旅程与当前功能。
- [REQUIREMENTS.md](REQUIREMENTS.md)：功能、安全与非功能需求。
- [PLAY_MODE_SPEC.md](PLAY_MODE_SPEC.md)：Play 模式规格（高优先级）。
- [NOVEL_AGENT_COPILOT_SPEC.md](NOVEL_AGENT_COPILOT_SPEC.md)：Writing Copilot 工作流。
- [NOVEL_CONSTITUTION.md](NOVEL_CONSTITUTION.md)：作品创作宪法。
- [IMPORT_TAVERN_COMPATIBLE_CHARACTER_CARD.md](IMPORT_TAVERN_COMPATIBLE_CHARACTER_CARD.md)：Tavern 角色卡导入。

## 工程文档

- [ARCHITECTURE.md](ARCHITECTURE.md)：组件边界与主数据流。
- [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md)：作品对象文件树与内部状态边界。
- [SANDBOX_CHANGE_ENGINE.md](SANDBOX_CHANGE_ENGINE.md)：ChangeSet authority、威胁模型、沙箱、生命周期、materializer 与 reset 边界。
- [AGENT_RUNTIME_AND_TOOLS.md](AGENT_RUNTIME_AND_TOOLS.md)：Runtime、ToolSet 与 turn-scoped edit session。
- [HUMAN_APPROVAL_AND_GIT.md](HUMAN_APPROVAL_AND_GIT.md)：PendingAction 决策、事务落盘与 Git side effect。
- [ELECTRON_RELEASE.md](ELECTRON_RELEASE.md)：桌面打包与发布。
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)：当前优先级与里程碑。
- [tasks/README.md](tasks/README.md)：可执行 task 状态入口。
- [AGENT_OPERATING_MANUAL.md](AGENT_OPERATING_MANUAL.md)：开发 Agent 操作手册。

## 专题计划

- [plans/PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md](plans/PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md)：Play 世界事件（M1–M5）。
- [plans/PLAY_MODE_GUIDED_ENTRY_AND_CHARACTER_REHEARSAL_UPGRADE_PLAN.md](plans/PLAY_MODE_GUIDED_ENTRY_AND_CHARACTER_REHEARSAL_UPGRADE_PLAN.md)：Play 引导入场与角色推演（F1–F4）。
- [plans/REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md](plans/REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md)：参考作品深度拆解（D0–D5）。
- [plans/WRITING_MODE_COMMERCIAL_AND_FANFICTION_UPGRADE_PLAN.md](plans/WRITING_MODE_COMMERCIAL_AND_FANFICTION_UPGRADE_PLAN.md)：Writing Profile 与拆书材料。
- [plans/AGENT_USAGE_AND_CONTEXT_STATS_PLAN.md](plans/AGENT_USAGE_AND_CONTEXT_STATS_PLAN.md)：上下文证据与用量治理。
- [plans/WORKSPACE_FRONTEND_LAYOUT_PLAN.md](plans/WORKSPACE_FRONTEND_LAYOUT_PLAN.md)：工作区前端布局。
- [plans/PLAY_MODE_AND_NOVEL_LINT_UPGRADE_PLAN.md](plans/PLAY_MODE_AND_NOVEL_LINT_UPGRADE_PLAN.md)：Play 模式升级与小说去 AI 味反套话质检计划（Prompt Cache 布局、五维剧情存档、视觉小说视窗、角色名册与 Novel LINT）。
- [plans/SETTING_WORKSHOP_GUIDED_FORGE_UPGRADE_PLAN.md](plans/SETTING_WORKSHOP_GUIDED_FORGE_UPGRADE_PLAN.md)：设定工坊引导式共创向导（Forge）计划（台词/试写样例引导、性格调色盘、三面性、反刻板解释与 ChangeSet 审批落盘）。
- [plans/OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md](plans/OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md) 与 [plans/OAN_AGENT_WRITING_GUIDE_RUNTIME_GAP_SPEC.md](plans/OAN_AGENT_WRITING_GUIDE_RUNTIME_GAP_SPEC.md)：写作指引 vNext。

## 设计与实现评估

- [2026-10-15 定位与产品设计评估](reviews/PRODUCT_DESIGN_REVIEW_2026-10-15.md)：重新定位为个人同人/综漫创作工作台后的取舍与已采纳建议。
- [2026-10-01 简短说明](reviews/DESIGN_IMPLEMENTATION_REVIEW_SUMMARY.md) 与 [详细说明](reviews/DESIGN_IMPLEMENTATION_REVIEW_DETAILED.md)：可靠性与实现差距评估。

评估文档是带日期的建议，不替代稳定合同；尚未实施的建议不能视为当前功能或已更新的 task 状态。

## 参考项目研究

- [research/AINT_REFERENCE_ANALYSIS.md](research/AINT_REFERENCE_ANALYSIS.md)：AINT (Agentic Interactive Narrative Theatre) 架构深度逆向分析与吸收设计（5 层前缀冻结、动态断点仲裁退让、阶段块长会话整理与 VFS、增量叙事标记 AST、舞台背景复合滤镜、伪工具拦截与 Gemini/Anthropic 协议自愈、显式审计与无锁死 SQLite 单连接写池）。
- [research/CICATAVERN_REFERENCE_ANALYSIS.md](research/CICATAVERN_REFERENCE_ANALYSIS.md)：CicaTavern 架构深度分析报告与推荐吸收设计（Prompt Cache 冻结前缀、视觉小说模式、五维剧情存档、名册一致性、Forge 引导共创与反套话 LINT）。
- [research/OPENTAVERN_PLAY_MODE_REFERENCE_ANALYSIS.md](research/OPENTAVERN_PLAY_MODE_REFERENCE_ANALYSIS.md)：OpenTavern 两套参考实现对 Play Mode 的优化分析。
- [research/MUSEAI_PLAY_MODE_REFERENCE_ANALYSIS.md](research/MUSEAI_PLAY_MODE_REFERENCE_ANALYSIS.md)：MuseAI 推演与多角色模式分析。
- [research/SILLYTAVERN_REFERENCE_OVERVIEW.md](research/SILLYTAVERN_REFERENCE_OVERVIEW.md) 与 [SILLYTAVERN_REFERENCE_LESSONS.md](research/SILLYTAVERN_REFERENCE_LESSONS.md)：SillyTavern 角色卡与生态研究。

## ADR

- [ADR 0001: Filesystem First](adr/0001-filesystem-first.md)
- [ADR 0002: No Heavy Agent Frameworks](adr/0002-no-heavy-agent-frameworks.md)
- [ADR 0003](adr/0003-semantic-patch-apply-engine.md)：Superseded 历史决策。
- [ADR 0004: Sandbox Change Engine](adr/0004-sandbox-change-engine.md)：当前写入决策。

## 推荐阅读顺序

1. [PROJECT_VISION.md](PROJECT_VISION.md)
2. [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md)
3. [ARCHITECTURE.md](ARCHITECTURE.md)
4. [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md)
5. [SANDBOX_CHANGE_ENGINE.md](SANDBOX_CHANGE_ENGINE.md)
6. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)
7. [AGENT_OPERATING_MANUAL.md](AGENT_OPERATING_MANUAL.md)

早期讨论（[archive/](archive/)）中的 `StoryForge` 只作为历史参考来源，不是当前产品名、组件名、目录名或兼容目标。

当前修正交付与暂缓范围见 [1230 Review-driven Reliability Corrections](tasks/1230.md)。2026-10-05 已交付 [1290 Long-novel Context And Memory Freshness](tasks/1290.md)、[1300 Author Manuscript Markdown Import](tasks/1300.md) 和 [1310 Delivery Quality Gates And Reviewed Git Commits](tasks/1310.md)。源提交`7f7e087`已通过[四平台质量、构建与真实打包写作/重启预检](https://github.com/oh-awesome-novel/oh-awesome-novel/actions/runs/37273973876)；[`v0.2.0`](https://github.com/oh-awesome-novel/oh-awesome-novel/releases/tag/v0.2.0)已公开，七项分发附件SHA-256校验全部通过，完整证据见[1280](tasks/1280.md)。对应作者说明见 [上下文与用量](../wiki/guide/usage.md) 和 [导入旧稿](../wiki/guide/manuscript-import.md)。

2026-10-15 第一梯队收尾：[0580](tasks/0580.md) 远端同步 preflight 与结构化失败、[1230](tasks/1230.md) 缺失 receipt 的可操作恢复与 terminal/receipt 一致性、[1110](tasks/1110.md) G7 Reference/Play 跨管线 usage 与 egress 记录、[1120](tasks/1120.md) 在线 Play 锁 tombstone 保留及延迟竞争者回归均已交付并有分层测试；三份 Needs Review task 的设备断电、商业 provider 与远端鉴权/多平台验收仍以各自 Remaining 为准。
