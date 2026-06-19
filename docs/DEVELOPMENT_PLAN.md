# Development Plan

## Planning Principle

先打稳文件系统、AI SDK ToolSet、Aider-style Runtime、write-intent、Human Approval 和 `.workspace` shadow write，再用 `0800 SemanticPatch Apply Engine` 收敛正式写入核心。

Apply Engine 是最终写入架构，但完整实现不属于早期已完成 milestone。当前任务索引以 `0400 -> 0600 -> 0800` 为准：

- `0400 Restricted File Write Tool`：只用于快速验证 agent loop。
- `0600 Write Intent And Human Approval`：已完成 PendingAction / shadow write / Accept-Reject 过渡链路。
- `0800 SemanticPatch Apply Engine`：后续正式实现，用 SemanticPatch executor 替换早期候选全文 / 简化写入路径。

不要一开始做：

- Multi-Agent
- Background autonomous agent
- Extension marketplace
- Vector database memory
- Rich text editor

## Milestone Overview

```text
M0  Documentation Foundation
M1  Project Scaffolding
M2  Filesystem Spec And Example Novel
M3  Markdown / YAML Engine
M4  SemanticPatch Apply Engine Design Target
M5  AI SDK ToolSet And Read Tools
M6  Write Intent Tools And Human Approval
M7  Aider-style Copilot Runtime
M8  Minimal Copilot Interface
M9  Summary And Memory Layer
M10 Workflow And Skills
M11 Extension System
M12 Polish, Tests, Import / Export
```

## M0. Documentation Foundation

Goal:

建立项目稳定蓝图，让后续 Codex 不漂移。

Deliverables:

- `docs/README.md`
- `docs/PROJECT_VISION.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/APPLY_ENGINE.md`
- `docs/DEVELOPMENT_PLAN.md`
- ADRs

Done Criteria:

- 所有核心设计都围绕 filesystem first。
- 不再保留 Repository Layer 作为最终架构。
- Apply Engine 被明确为核心模块。

## M1. Project Scaffolding

Goal:

建立 `oh-awesome-novel` 应用源码骨架。

Deliverables:

- TypeScript 项目。
- 基础测试框架。
- 项目配置。
- npm workspace / monorepo 包结构。
- Electron desktop app skeleton。
- Vue renderer app skeleton。
- 根目录 `__test__/*` 测试 workspace。

Canonical Layout:

```text
packages/
├── core/
├── tools/
├── runtime/
├── agent/
├── backend/
└── ui-vue/

apps/
├── desktop/
└── desktop-ui/

__test__/
├── core/
├── tools/
├── runtime/
├── agent/
└── backend/
```

Done Criteria:

- 可以运行测试。
- 可以读取一个小说项目目录。
- 新增核心模块优先落在 `packages/*`，不要回到旧的单体 `src/` 布局。
- App shell 和 renderer 落在 `apps/*`。
- 测试按模块放在根目录 `__test__/*` workspace。

## M2. Filesystem Spec And Example Novel

Goal:

把文档中的目录结构变成可验证样例。

Deliverables:

- `examples/sample-novel/`
- Object Domain 样例。
- Collection Domain 样例。
- Narrative Domain 样例。
- JSON Schema 或 Zod schema。

Done Criteria:

- 样例包含 Character、World、Chapter、State、Timeline、Foreshadow、Summary、Constitution。
- 测试能验证基础文件存在和 YAML 有效。

## M3. Markdown / YAML Engine

Goal:

实现文件读写基础能力。

Deliverables:

- Markdown Engine
- YAML Engine
- Frontmatter parser
- Heading section parser
- Basic serializer

Initial API:

```ts
loadMarkdown(file)
parseSections(markdown)
replaceSection(file, section, content)
appendSection(file, section, content)
loadYaml(file)
yamlGet(file, path)
yamlSetDraft(file, path, value)
```

Done Criteria:

- 能解析 `characters/heroine/personality.md`。
- 能更新 `state/characters.yaml` 的某个 path。
- 更新前不直接写盘，只返回 draft。

## M4. SemanticPatch Apply Engine Design Target

Goal:

明确正式写入核心的目标形态：`SemanticPatch -> diff -> PendingAction`。

注意：这一阶段描述的是架构目标，不表示完整 Apply Engine 已实现。完整代码实现由后续 `0800 SemanticPatch Apply Engine` 任务承接。

Deliverables:

- SemanticPatch 类型设计。
- ObjectPatch executor 设计。
- CollectionPatch executor 设计。
- NarrativePatch 初版设计。
- Diff generator 设计。
- Patch validator 设计。
- PendingAction store 设计。
- 与 `0600 Write Intent And Human Approval` 的迁移边界。

Done Criteria:

- Apply Engine 被确认为正式写入方向。
- 早期 write-intent 工具可以先生成 PendingAction 和 shadow write。
- `0800` 明确负责把现有正式写入工具迁移到 SemanticPatch executor。
- 用户确认前不写真实目标文件。

## M5. AI SDK ToolSet And Read Tools

Goal:

暴露只读领域工具。

Deliverables:

- AI SDK `ToolSet`
- 基于 AI SDK `tool()` / `jsonSchema()` 的 read tools
- `createReadTools()`
- 如 UI 后续需要，增加 `ToolSet` 外围薄 metadata map
- Read tools

Initial Tools:

```text
character.get
character.list
world.search
chapter.get
state.get
timeline.list
foreshadow.list
summary.get
constitution.get
workflow.get
```

Done Criteria:

- CLI 可以调用 read tools。
- Tool result 结构化。
- Tool call log 可记录。
- 不实现 `defineStoryTool()`、`StoryTool` 或独立 `RuntimeToolRegistry`。

## M6. Write Intent Tools And Human Approval

Goal:

把写操作转成 PendingAction。

Deliverables:

- `character.updatePersonality`
- `state.set`
- `timeline.add`
- `foreshadow.create`
- `summary.generateChapter` 初版
- Approval CLI

Done Criteria:

- 所有写工具只返回 PendingAction。
- Accept 后写文件。
- Reject 不写文件。
- 写入后 `git diff` 可见。

## M7. Aider-style Copilot Runtime

Goal:

接入模型，实现 Tool Calling Loop。

Deliverables:

- OpenAI compatible model client。
- Vercel AI SDK integration。
- Tool loop。
- Context builder。
- Max loop guard。

Done Criteria:

- 用户可以自然语言请求。
- Runtime 能调用 read tool。
- Runtime 能调用 write intent tool。
- Tool calls 可见。

## M8. Minimal Copilot Interface

Goal:

先做最小可用交互，不追求完整 IDE。

Preferred Shape:

```text
HTTP backend
  -> SSE agent chat endpoint
  -> Vercel AI UI stream compatibility
  -> Vue frontend using @ai-sdk/vue
  -> Electron main process composition
```

MVP 优先使用本地 HTTP backend，而不是单独实现 Electron-only UI stream。

Electron main process 启动 backend，Vue renderer 通过 `@ai-sdk/vue` 连接 backend。这样 Web panel、Electron renderer、后续调试页面可以复用同一套 agent 接入协议。

Deliverables:

- Chat input。
- Streaming assistant message。
- HTTP SSE transport。
- Vercel AI frontend compatibility layer。
- Vue `@ai-sdk/vue` agent 对话闯卡。
- Electron main process + Vue frontend + HTTP backend 组合。
- Tool log。
- Pending action list。
- Diff preview。
- Accept / Reject。

Post-MVP UI Tasks:

- Global workspace launcher, similar to a JetBrains / WebStorm project list.
- Workspace entry LLM provider configuration gate.
- NoteGen-inspired workspace shell: left file tree, center plain-text file viewer, right Copilot.
- Chapter navigation view: derive readable volume/chapter list from stable numbered chapter files.
- Workspace home state: no file selected, Copilot hidden, quick actions visible.
- Workspace global search using MiniSearch over current workspace text files.
- Git history and sync page, preferably by reusing a lightweight open-source Git UI.

Done Criteria:

- 能跑完整 vertical slice。
- 前端通过 HTTP SSE 获取 agent 流式消息。
- Vue frontend 可以直接使用 `@ai-sdk/vue`。
- Electron 启动后能组合 Vue frontend 和本地 HTTP backend。
- 后续 UI 任务仍不得让 frontend 绕过 backend / agent 直接写 filesystem。

## M9. Summary And Memory Layer

Goal:

建立文件型 Memory。

Deliverables:

- Chapter summary generator。
- Volume summary generator。
- Global summary generator。
- Context assembler。

Done Criteria:

- 生成新章节时不加载整本小说。
- Context 来自摘要、状态、时间线、伏笔。

## M10. Workflow And Skills

Goal:

实现作者可控的创作流程和 Skill。

Deliverables:

- `.oan/workflow.yaml` loader。
- Skill loader。
- Allowed tool filter。
- Prompt pack support。

Done Criteria:

- 不同 Skill 可限制工具。
- Workflow 不变成隐藏 planner。

Detailed vNext split:

`docs/OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md` 把参考项目吸收后的 agent 写作指引拆成后续可执行任务：

- `1000` Agent Writing Guide vNext Spec And Skill Contracts。（Completed）
- `1010` Context Package And Source Discipline。（Completed）
- `1020` Planning Commands And Prewrite Calibration。（Completed）
- `1030` Review And Settlement Workflow。
- `1040` Session Artifacts And Author Reports。
- `1050` Projections And Project Health。
- `1060` Play Mode And Tavern Character Import。

这些任务必须继续遵守：单 agent Aider-style runtime、filesystem-first、PendingAction / Human Approval、reference 只作为可追溯写作参考。

## M11. Extension System

Goal:

参考 Goose 的扩展思想。

Deliverables:

- Extension manifest。
- Tool registration。
- Prompt pack registration。
- Workflow template registration。
- Constitution template registration。

Done Criteria:

- Extension 可插拔。
- 不引入复杂 runtime。

## M12. Polish, Tests, Import / Export

Goal:

提高真实可用性。

Deliverables:

- Import old flat Markdown。
- Export readable manuscript。
- Git helper。
- Better validation。
- UI polish。

Done Criteria:

- 可以管理一个小型真实小说项目。
- 可被 Codex / Aider / Crush 外部工具编辑。

## MVP Vertical Slice

最小可验证场景：

```text
1. 初始化 sample novel。
2. 用户输入：女主在第 3 章重伤。
3. Runtime 读取 character、chapter、state。
4. Runtime 调用 state.set、timeline.add、foreshadow.create。
5. write-intent / PendingAction 预览链路生成 diff。
6. 用户 Accept。
7. 文件写入。
8. git diff 显示修改。
```

后续 `0800 SemanticPatch Apply Engine` 完成后，第 5 步应收敛为 Apply Engine 生成 diff。

## Risks

### R1. 文件粒度过粗

风险：

AI 修改会变成大文件 rewrite。

缓解：

采用 Object File Tree。

### R2. Apply Engine 过度泛化

风险：

变成通用 patch 引擎，复杂但不好用。

缓解：

只做小说七个固定领域。

### R3. Runtime 漂移成 Agent Framework

风险：

加入 Planner、多 Agent、复杂 retry。

缓解：

保留 Aider-style loop。

### R4. UI 过早扩大

风险：

核心写入链路没稳就做复杂界面。

缓解：

先 CLI vertical slice。

### R5. Memory 变成上下文垃圾桶

风险：

把所有文件塞 prompt。

缓解：

Summary + Context Assembler，不用 vector DB 当事实源。

## Development Rules For Codex

每个实现任务都应带上：

```text
Do NOT introduce LangChain, AutoGen, CrewAI, Semantic Kernel or heavy agent frameworks.
Prefer simple TypeScript.
Keep runtime understandable.
Never bypass Human Approval.
Never rewrite entire files when SemanticPatch can express the change.
```
