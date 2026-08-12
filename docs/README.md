# oh-awesome-novel Docs

本文档集根据 `ChatGPT对话.md` 中关于小说 Agent 的讨论整理而成。讨论中反复出现的 `StoryForge FS`，在本项目中统一命名为 `oh-awesome-novel`。

`oh-awesome-novel` 的定位不是通用 Agent 框架，而是一个 filesystem-first 的长篇小说 AI Copilot / Novel IDE。

核心原则：

- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 所有写入必须经过人类确认。
- Runtime 学 Aider 的极简循环，不做重型多 Agent 平台。
- 文件修改核心采用 `SemanticPatch + Apply Engine`，避免全文重写。

## 文档目录

- [PROJECT_VISION.md](PROJECT_VISION.md): 项目愿景、边界和非目标。
- [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md): 当前项目作为产品的完整形态和功能概览。
- [REQUIREMENTS.md](REQUIREMENTS.md): 产品需求、功能需求和约束。
- [ARCHITECTURE.md](ARCHITECTURE.md): 最终架构蓝图。
- [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md): 小说项目目录、对象文件树和文件格式。
- [AGENT_RUNTIME_AND_TOOLS.md](AGENT_RUNTIME_AND_TOOLS.md): Tool Registry、Vercel AI SDK 接入和极简 Agent Loop。
- [NOVEL_AGENT_COPILOT_SPEC.md](NOVEL_AGENT_COPILOT_SPEC.md): Novel Agent Copilot workflow、快捷指令、审批链路和桌面 UI 规格。
- [WORKSPACE_FRONTEND_LAYOUT_PLAN.md](WORKSPACE_FRONTEND_LAYOUT_PLAN.md): Codex-like 工作台前端布局计划，包含左右栏隐藏、右侧审阅区和消息流升级。
- [OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md](OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md): OAN agent 写作指引 vNext 的实现规格、任务拆分和验收矩阵。
- [AGENT_USAGE_AND_CONTEXT_STATS_PLAN.md](AGENT_USAGE_AND_CONTEXT_STATS_PLAN.md): ContextPackage 来源证据、protected budget、provider egress、estimated/actual usage、session artifact 与桌面 Inspector 的实施计划。
- [PLAY_MODE_SPEC.md](PLAY_MODE_SPEC.md): Play Mode / Roleplay Sandbox 的模式边界、session 文件布局和 adoption 边界。
- [PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md](PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md): 将 Play 提升为与 Writing 同层级的顶级工作区，并引入世界时间、外部事件、回合事务和 HUD 的升级计划。
- [MUSEAI_PLAY_MODE_REFERENCE_ANALYSIS.md](MUSEAI_PLAY_MODE_REFERENCE_ANALYSIS.md): MuseAI 的穿书装配、入场设计、场景推进、分层记忆与角色复盘对 Play Mode 的可吸收点分析。
- [PLAY_MODE_GUIDED_ENTRY_AND_CHARACTER_REHEARSAL_UPGRADE_PLAN.md](PLAY_MODE_GUIDED_ENTRY_AND_CHARACTER_REHEARSAL_UPGRADE_PLAN.md): 结合 MuseAI 世界入场闭环与 awesome-novel-skill 角色推演沙盘的 Play 引导开局、导演控制、原子推演和写作回流升级计划。
- [APPLY_ENGINE.md](APPLY_ENGINE.md): SemanticPatch 与 OAN Apply Engine 设计。
- [HUMAN_APPROVAL_AND_GIT.md](HUMAN_APPROVAL_AND_GIT.md): 写入确认、Git diff、commit 和回滚。
- [NOVEL_CONSTITUTION.md](NOVEL_CONSTITUTION.md): 小说创作宪法规格。
- [INKOS_REFERENCE_OVERVIEW.md](INKOS_REFERENCE_OVERVIEW.md): InkOS 参考项目的功能、特色和优点归纳。
- [INKOS_REFERENCE_LESSONS.md](INKOS_REFERENCE_LESSONS.md): InkOS 对 OAN 可借鉴和不宜照搬的设计点。
- [STORYFORGE_REFERENCE_OVERVIEW.md](STORYFORGE_REFERENCE_OVERVIEW.md): StoryForge 当前实现、产品边界和工程治理现状分析。
- [STORYFORGE_REFERENCE_LESSONS.md](STORYFORGE_REFERENCE_LESSONS.md): StoryForge 对 OAN 可吸收和不宜照搬的设计候选。
- [OH_STORY_CLAUDECODE_REFERENCE_OVERVIEW.md](OH_STORY_CLAUDECODE_REFERENCE_OVERVIEW.md): oh-story-claudecode 当前 Skill、追踪事务、宿主适配和参考拆解分析。
- [AWESOME_NOVEL_SKILL_REFERENCE_OVERVIEW.md](AWESOME_NOVEL_SKILL_REFERENCE_OVERVIEW.md): awesome-novel-skill 当前多 Agent 工作流、断点恢复、平台适配和边界分析。
- [NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md](NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md): 2026-08-01 四个写作 Skill 的历史横向快照；最新 awesome / oh-story 结论以前述专题分析为准。
- [OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md](OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md): OAN 当前 agent 写作指引状态，以及多个参考项目来源的可吸收升级点。
- [REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md](REFERENCE_WORK_DEEP_DECONSTRUCTION_UPGRADE_PLAN.md): 将现有 reference import / selector 骨架升级为可确认、可恢复、可追溯的 AI 深度拆解流水线。
- [WRITING_MODE_COMMERCIAL_AND_FANFICTION_UPGRADE_PLAN.md](WRITING_MODE_COMMERCIAL_AND_FANFICTION_UPGRADE_PLAN.md): 以 workspace Writing Profile 选择固定 Writing reminders 与参考作品拆解输出的分阶段升级计划。
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md): 分阶段开发计划。
- [tasks/README.md](tasks/README.md): 从开发计划拆出的可执行任务文档。
- [AGENT_OPERATING_MANUAL.md](AGENT_OPERATING_MANUAL.md): 给 Codex / Claude Code / Aider 等开发 Agent 的长期操作手册草案。

ADR：

- [adr/0001-filesystem-first.md](adr/0001-filesystem-first.md)
- [adr/0002-no-heavy-agent-frameworks.md](adr/0002-no-heavy-agent-frameworks.md)
- [adr/0003-semantic-patch-apply-engine.md](adr/0003-semantic-patch-apply-engine.md)

## 推荐阅读顺序

1. [PROJECT_VISION.md](PROJECT_VISION.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [FILESYSTEM_SPEC.md](FILESYSTEM_SPEC.md)
4. [APPLY_ENGINE.md](APPLY_ENGINE.md)
5. [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)

## 开发时的稳定事实

后续 Codex 或其它开发 Agent 进入项目时，应优先读取：

1. `docs/ARCHITECTURE.md`
2. `docs/DEVELOPMENT_PLAN.md`
3. `docs/APPLY_ENGINE.md`
4. `docs/AGENT_OPERATING_MANUAL.md`

不要再把早期对话里的旧方案当最终方案。StoryForge 只作为历史参考来源，不是当前产品名、组件名、运行时目录名或兼容目标。最终方案已经收敛为：

```text
oh-awesome-novel
    =
Filesystem First Novel IDE
    +
Aider-style Runtime
    +
Vercel AI SDK Tool Calling
    +
Object File Tree
    +
SemanticPatch Apply Engine
    +
Git Diff Human Approval
```
