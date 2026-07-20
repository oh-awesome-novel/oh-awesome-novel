# Development Tasks

本目录把 `docs/DEVELOPMENT_PLAN.md` 拆成可执行开发任务。

架构事实仍以这些文档为准：

- `docs/ARCHITECTURE.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/APPLY_ENGINE.md`
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
- [0400 Restricted File Write Tool](0400.md)
- [0450 Agent Session Persistence](0450.md)
- [0500 Minimal Copilot Interface](0500.md)
- [0520 HTTP Backend SSE And AI SDK Vue Interface](0520.md)
- [0530 Global Workspace Launcher](0530.md)
- [0540 Workspace Entry LLM Provider Gate](0540.md)
- [0550 NoteGen Inspired Workspace Shell](0550.md)
- [0555 Chapter Navigation View](0555.md)
- [0560 Workspace Home Quick Actions And Copilot Visibility](0560.md)
- [0600 Write Intent And Human Approval](0600.md)
- [1000 Agent Writing Guide vNext Spec And Skill Contracts](1000.md)
- [1010 Context Package And Source Discipline](1010.md)
- [1020 Planning Commands And Prewrite Calibration](1020.md)
- [1030 Review And Settlement Workflow](1030.md)
- [1040 Session Artifacts And Author Reports](1040.md)
- [1050 Projections And Project Health](1050.md)
- [1060 Play Mode And Tavern Character Import](1060.md)
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

## Needs Review Tasks

- [0700 Summary Workflow Extensions Polish](0700.md)
- [0900 Project References](0900.md)
- [1120 Play World Events And Turn Settlement](1120.md)

## Planned Tasks

- [0570 Workspace Global Search](0570.md)
- [0580 Git History And Sync Page](0580.md)
- [0800 SemanticPatch Apply Engine](0800.md)
- [1110 Agent Usage And Context Stats](1110.md)

## Package Call Route

```text
packages/core
  -> workspace initialization, workspace config, LLM provider config pure functions
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
- Production write tools must produce visible `PendingAction` / diff output before any file write.
- The early restricted file write tool is only for validating the full agent loop and must hard reject every path outside the active workspace.
- File write tools must not accept hidden file or hidden directory targets inside the workspace.
- Internal crash-recovery shadow writes may use `workspace/.workspace`, but callers must not be able to target that path directly.
- Prefer SemanticPatch and Apply Engine over full-file rewrites.
- Project references under `examples/` are implemented last and are not the primary novel workspace.
