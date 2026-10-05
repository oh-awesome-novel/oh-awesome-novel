# Development Tasks

本目录把 `docs/DEVELOPMENT_PLAN.md` 拆成可执行开发任务。

架构事实仍以这些文档为准：

- `docs/ARCHITECTURE.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/SANDBOX_CHANGE_ENGINE.md`
- `docs/AGENT_RUNTIME_AND_TOOLS.md`
- `docs/HUMAN_APPROVAL_AND_GIT.md`

任务文档只回答：

- 当前要交付什么。
- 不能做什么。
- 完成标准是什么。
- 是否已经完成。

## Status Legend

- `Completed`: 已完成并已有代码或文档落地。
- `Needs Review`: 已有实现或文档落地，但新增 plan 暴露出需要对照代码复核、补测或补实现的差异。
- `Planned`: 尚未完成，后续开发任务。
- `Blocked`: 需要新的设计决策或外部条件。

## Completed Tasks

- [0001 Documentation Foundation](0001.md)
- [0002 Desktop Build Foundation](0002.md)
- [0003 Lightweight Runtime](0003.md)
- [0004 Runtime Test Workspace](0004.md)
- [0005 Strict TypeScript Configs](0005.md)
- [0100 Workspace Initialization And Novel Body Layout](0100.md)
- [0200 Markdown YAML Engine](0200.md)
- [0300 AI SDK ToolSet And Read Tools](0300.md)
- [0350 Agent LLM Bridge And Message Assembly](0350.md)
- [0400 Early Write-loop Validation](0400.md)
- [0450 Agent Session Persistence](0450.md)
- [0500 Minimal Copilot Interface](0500.md)
- [0520 HTTP Backend SSE And AI SDK Vue Interface](0520.md)
- [0530 Global Workspace Launcher](0530.md)
- [0540 Workspace Entry LLM Provider Gate](0540.md)
- [0550 NoteGen Inspired Workspace Shell](0550.md)
- [0555 Chapter Navigation View](0555.md)
- [0560 Workspace Home Quick Actions And Copilot Visibility](0560.md)
- [0600 Human Approval Vertical Slice](0600.md)
- [0800 Sandbox Change Engine Migration](0800.md)
- [0900 Project References](0900.md)
- [1000 Agent Writing Guide vNext Spec And Skill Contracts](1000.md)
- [1010 Context Package And Source Discipline](1010.md)
- [1020 Planning Commands And Prewrite Calibration](1020.md)
- [1030 Review And Settlement Workflow](1030.md)
- [1040 Session Artifacts And Author Reports](1040.md)
- [1050 Projections And Project Health](1050.md)
- [1070 Agent Context Trace And Session Artifact Autowiring](1070.md)
- [1080 Reference Context Selector And Loading Map](1080.md)
- [1090 Play Mode UI And Adoption Workflow](1090.md)
- [1100 Project Health Guardrails And Projection Refresh](1100.md)
- [1130 First Playable Scene Rehearsal](1130.md)
- [1140 Source-backed Guided Start](1140.md)
- [1150 Play Outcome And Explicit Writing Handoff](1150.md)
- [1160 Branch-local Knowledge And Causal Reveal](1160.md)
- [1170 Evidence-backed Play Adoption Path](1170.md)
- [1180 Play Long-session Context And Experience Closure](1180.md)
- [1190 Advanced Director Controls And Long-session Rehearsal](1190.md)
- [1200 Writing Profile Configuration And Prompt Reminders](1200.md)
- [1205 Reference Quality Gate Warning Degradation](1205.md)
- [1210 Reference Story Material Analysis Track](1210.md)
- [1220 Reference Material Adoption And Desktop Closure](1220.md)

- [0570 Workspace Global Search](0570.md)
- [1110 ContextPackage Evidence And Agent Usage Governance](1110.md)
- [1240 AI SDK 7 Migration](1240.md)
- [1250 Illustrated User Documentation](1250.md)
- [1260 Play Storage Read Model And Snapshot I/O](1260.md)
- [1270 Readable Manuscript Export](1270.md)
- [1280 Electron Release Workflow](1280.md)
- [1290 Long-novel Context And Memory Freshness](1290.md)
- [1300 Author Manuscript Markdown Import](1300.md)
- [1310 Delivery Quality Gates And Reviewed Git Commits](1310.md)
- [1320 Application Icon And Desktop Branding](1320.md)

## Needs Review Tasks

- [0580 Git History And Sync Page](0580.md)
- [0700 Summary Workflow Extensions Polish](0700.md)
- [1060 Play Mode And Tavern Character Import](1060.md)
- [1120 Play World Events And Turn Settlement](1120.md)
- [1230 Review-driven Reliability Corrections](1230.md)

## Planned Tasks

当前剩余工作按 Needs Review tasks 内的未完成 scope 推进；历史计划中的未勾选项需先与这些任务核对。


## Deferred Development (2026-10-01)

Extension manifest、动态 Tool/prompt/workflow registration 与更多 Director/Reference 扩展暂缓。已交付0570搜索、1270正文导出、1290来源新鲜度/长篇上下文、1300作者旧稿导入及1310类型/发行门禁、预览绑定Git提交与打包旅程；后续按作者反馈推进0700卷/全局摘要，0580远端同步/环境验收和1120剩余可靠性范围。合同/helper 完成不等于生产接线或真实旅程完成。

## Package Call Route

```text
packages/core
  -> domain/config contracts plus isolated workspace, Play and Reference file storage
packages/tools
  -> Markdown / YAML Engine, concrete domain tools, AI SDK ToolSet
packages/agent
  -> novel prompt assembly, LLM bridge, ToolSet injection, Runtime session assembly,
     RuntimeEvent stream to Vercel AI UI stream compatibility
packages/runtime
  -> Aider-style tool loop, tool log, pending actions, RuntimeEvent stream,
     no provider-specific logic
HTTP backend
  -> local transport layer, SSE endpoints, uses packages/agent compatibility helpers
Vue frontend
  -> uses @ai-sdk/vue against the HTTP backend, no direct filesystem/tool execution
Electron main
  -> starts/stops local HTTP backend and provides backend base URL to Vue renderer
```

## Global Rules

Every task must preserve these constraints:

- Do not introduce LangChain, AutoGen, CrewAI, Semantic Kernel, or a heavy agent framework.
- Keep Runtime as an Aider-style loop, not a planner or multi-agent platform.
- Keep project data filesystem-first: Markdown, YAML, Object File Tree, and Git.
- Production edits must generate a normalized create/update/delete `CandidateChangeSet` and visible `PendingAction` / diff before any canonical write.
- Model editing uses only the fixed in-memory `bash-tool` / `just-bash` sandbox; arbitrary host shell and host filesystem access are forbidden.
- Hidden/internal paths, symlinks and non-regular files must be rejected for reads, enumeration and writes.
- Immutable candidate/recovery data may use `workspace/.workspace/change-engine/v1`, but callers cannot target or inspect that namespace.
- Accept materializes immutable drafts through `ChangeMaterializer`; it never parses diff or replays model commands.
- Capability comes from trusted host workflows; unknown workflows are `read-only`, and deterministic producers receive exact targets.
- Project references under `examples/` are implemented last and are not the primary novel workspace.
