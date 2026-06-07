# Architecture

## Summary

`oh-awesome-novel` 是一个 filesystem-first 的 Novel IDE / AI Copilot。

最终架构从早期的 Repository Layer 方案收敛为：

```text
                    oh-awesome-novel

                           │

                   Novel Constitution

                           │

                       Workflow

                           │

                  Copilot Runtime
                    (Aider Style)

                           │

                   Vercel AI SDK
                    (Tool Calling)

                           │

                     Tool Registry

 ┌─────────┬─────────┬──────────┬─────────┬──────────┬──────────┬──────────┐
 │         │         │          │         │          │          │
Character  World   Chapter    State   Timeline  Foreshadow  Summary
 └─────────┴─────────┴──────────┼─────────┴──────────┴──────────┘

                           │

                  Markdown / YAML Engine

                           │

                     Apply Engine
                   (SemanticPatch)

                           │

                    Object File Tree
                   (Markdown / YAML)

                           │

                           Git


══════════════════════════════════════════════════════

            Human Approval (Git Diff)

══════════════════════════════════════════════════════
```

## Layer Responsibilities

## Package Boundaries

当前代码包边界如下：

- `packages/core`：workspace 初始化、全局 OAN 配置、LLM provider config 纯函数。不调用 LLM，不执行 Agent loop。
- `packages/tools`：Markdown / YAML Engine，以及基于 Vercel AI SDK `tool()` / `jsonSchema()` 的领域 read tools。对外产出 AI SDK `ToolSet`，不依赖 runtime。
- `packages/agent`：组装小说 workspace snapshot、system prompt、Runtime messages/context；根据 core provider config 和外部 provider resolver 创建 AI SDK based `RuntimeModelAdapter`；创建 runtime 并注入 `ToolSet`。UI 优先使用流式入口，并提供 Vercel AI frontend compatibility adapter。
- `packages/runtime`：只实现 Aider-style loop，接收 `RuntimeModelAdapter` 和 AI SDK `ToolSet`，执行 tool calls，记录 tool log / pending actions，输出 `RuntimeEvent` stream。不依赖 agent/tools，不引入具体 LLM provider。
- HTTP backend：本地 transport / composition layer，提供 SSE agent chat endpoint，复用 `packages/agent` 的 Vercel AI UI stream 兼容层。
- Vue frontend：通过 `@ai-sdk/vue` 连接 HTTP backend，不直接执行 tools 或访问 filesystem。
- Electron main：启动和关闭本地 HTTP backend，并把 backend base URL 交给 Vue renderer。

明确禁止：

- 不在 `packages/runtime` 注册领域工具。
- 不在 `packages/runtime` 接入 OpenAI / DeepSeek / provider resolver。
- 不在 `packages/agent` 重写 tool loop。
- 不在 `packages/tools` 定义第二套 Tool 抽象来替代 AI SDK `ToolSet`。
- 不用 AI SDK `ToolLoopAgent` 替代项目自己的 Aider-style runtime。
- 不在 `packages/runtime` 引入 HTTP server、Electron、Vue 或 `@ai-sdk/vue`。
- 不让 frontend 绕过 backend / agent 直接访问 tools、Apply Engine 或 filesystem。

## Frontend And Desktop Composition

最小 UI 接入采用 HTTP backend + SSE。

```text
Electron main process
    ↓ starts
Local HTTP backend on 127.0.0.1
    ↓ exposes SSE
Vue renderer / Web panel
    ↓ uses
@ai-sdk/vue
```

SSE 输出由 `packages/agent` 的 Vercel AI frontend compatibility adapter 从 `RuntimeEvent` stream 转换而来。

这条链路的目的只是复用前端生态和调试入口，不改变核心 runtime：

- Runtime 继续保持 Aider-style loop。
- Agent 负责 prompt/message assembly、provider adapter、toolset injection 和 stream compatibility。
- Backend 只做 HTTP/SSE transport。
- Electron 只做本地进程组合和窗口承载。

### Novel Constitution

回答：

> 这个项目应该写成什么样的小说？

它是最高优先级创作约束。

示例规则：

- 单女主。
- 不后宫。
- 不机械降神。
- 成长必须付出代价。
- 人物不能 OOC。
- 禁止 AI 腔套话。

AI 可以提出 Constitution 修改建议，但不能自动修改。

### Workflow

回答：

> 作者通常怎么创作？

示例：

```yaml
name: lightnovel
steps:
  - constitution
  - world
  - character
  - outline
  - chapter
  - summary
  - review
```

Workflow 是作者定义的流程，不是 AI 自主 planner。

### Copilot Runtime

负责：

```text
LLM
    ↓
Tool Call
    ↓
Execute
    ↓
Append Result
    ↓
LLM
```

Runtime 保持极简。

禁止：

- Planner
- Multi-Agent Runtime
- Autonomous Loop
- Hidden Retry Engine

### Vercel AI SDK

只作为 Tool Calling 实现层。

使用：

- `tool()`
- `generateText()`
- `streamText()`

不把 AI SDK 当项目架构中心。

### Tool Registry

Tool Registry 统一暴露 AI 可调用能力。

命名规则：

```text
domain.action
```

示例：

- `character.get`
- `character.updatePersonality`
- `world.search`
- `chapter.rewriteScene`
- `state.set`
- `timeline.add`
- `foreshadow.create`
- `summary.generateChapter`
- `constitution.proposeUpdate`

### Domain Tools

领域分为三类。

#### Object Domain

适合拆成对象文件树：

- Character
- World
- Constitution

典型操作：

- replace file
- append block
- replace block
- update frontmatter

#### Collection Domain

适合 YAML 节点操作：

- State
- Timeline
- Foreshadow

典型操作：

- yamlSet
- yamlAppend
- yamlMove
- yamlDelete

#### Narrative Domain

连续叙事文本：

- Chapter
- Summary

典型操作：

- replace scene
- insert scene
- replace chunk
- append section

### Markdown / YAML Engine

负责读取、解析和序列化文件。

Markdown Engine 支持：

- load
- save
- parse frontmatter
- parse section
- replace section
- append section
- replace block
- split scene
- split chunk

YAML Engine 支持：

- get path
- set path
- delete path
- append node
- move node
- validate schema

### Apply Engine

Apply Engine 是核心创新层。

AI 不直接重写文件。AI 输出 `SemanticPatch[]`。

Apply Engine 负责：

```text
SemanticPatch
    ↓
Load File
    ↓
Find Semantic Node
    ↓
Apply
    ↓
Generate Diff
    ↓
Validate
    ↓
Return PendingAction
```

用户 Accept 后才写入。

### Object File Tree

Filesystem First 的终极形态不是几个巨大 Markdown 文件，而是一棵细粒度对象文件树。

示例：

```text
characters/heroine/
├── meta.yaml
├── summary.md
├── personality.md
├── appearance.md
├── growth.md
└── relationships.yaml
```

原则：

- 一个 AI Tool 一次最好只修改一个物理文件。
- 文件越小，diff 越清晰。
- Codex / Aider / Crush / Obsidian 越容易理解。

### Git

Git 是历史引擎。

负责：

- diff
- approval
- commit
- branch
- merge
- undo
- rollback

## Cross-Cutting Concern: Human Approval

Human Approval 贯穿所有写入操作。

任何写 Tool：

```text
Tool Call
    ↓
SemanticPatch
    ↓
Apply Engine
    ↓
Diff Preview
    ↓
Accept / Reject
```

永远不允许 silent write。

## Context Priority

生成 prompt / context 时的优先级：

```text
Novel Constitution
    >
Workflow
    >
Skill Prompt
    >
Current User Request
    >
Selected Context
    >
Recent Summaries
```

Constitution 不是隐藏审查规则，而是作者可见、可编辑、Git tracked 的创作宪法。

## Architecture Decisions

已确定：

- 使用 filesystem first。
- 使用 Markdown / YAML。
- 使用 Git 作为历史引擎。
- 使用 Aider-style minimal runtime。
- 使用 Vercel AI SDK 做 Tool Calling。
- 使用 SemanticPatch + Apply Engine 做文件修改。
- 不引入重型 Agent 框架。
- 不做早期多 Agent。

## Open Questions

后续需要在实现中验证：

- Markdown Engine 选择 remark / mdast 还是自写轻量 parser。
- YAML Engine 使用 `yaml` 包还是其它解析器。
- Diff 生成使用系统 git、jsdiff，还是两者结合。
- UI 第一版是 CLI、TUI，还是 Web Copilot Panel。
- 是否需要真实接入 Morph 类模型，还是本地 Apply Engine 足够。
