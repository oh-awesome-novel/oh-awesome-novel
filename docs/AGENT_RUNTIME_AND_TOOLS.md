# Agent Runtime And Tools

## Goal

实现一个极简、可观察、可控的小说 Copilot Runtime。

它只做一件事：

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

## Non-Goals

不实现：

- Planner
- Multi-Agent
- Subagent orchestration
- Autonomous loop
- Hidden retry engine
- General agent framework

## Runtime Flow

```text
User Message
    ↓
Build Context
    ↓
RuntimeModelAdapter.stream() / RuntimeModelAdapter.generate()
    ↓
Tool Calls?
    ↓
Execute Read Tools or Generate PendingAction
    ↓
Append Tool Results
    ↓
Loop until no tool calls or max iterations
    ↓
Return Assistant Message + Pending Actions
```

建议最大循环：

```text
maxToolLoops = 8
```

## Vercel AI SDK Usage

只使用：

- `tool()`
- `streamText()`
- `jsonSchema()`

示意：

```ts
export const getCharacterTool = tool({
  description: "Read a character object file tree.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      id: { type: "string" },
    },
    required: ["id"],
  }),
  execute: async ({ id }) => {
    return characterService.get(id);
  },
});
```

## Package Boundaries

当前包边界必须保持清晰。

```text
packages/core
  - 管理 workspace 初始化和全局 OAN 配置。
  - 维护 LLM provider config 的纯函数。
  - 不调用 LLM。
  - 不执行 Agent loop。

packages/tools
  - 实现 Markdown / YAML Engine。
  - 使用 Vercel AI SDK `tool()` / `jsonSchema()` 定义 read tools。
  - 对外产出 AI SDK `ToolSet`。
  - 不依赖 packages/runtime。
  - 不实现 Agent loop。

packages/agent
  - 根据 core 提供的 workspace snapshot 和 provider config 组装 prompt/messages。
  - 根据 provider resolver 创建 AI SDK based RuntimeModelAdapter。
  - 创建并注入 packages/tools 提供的 ToolSet。
  - 创建 packages/runtime 的 RuntimeSession。
  - 对 UI 优先暴露 streamNovelAgentTurn()。
  - 提供 RuntimeEvent stream 到 Vercel AI UI stream / SSE protocol 的兼容适配器。
  - 不直接读取文件系统；文件读取能力只存在于注入的 tools execute() 中。

packages/runtime
  - 只实现 Aider-style tool loop。
  - 接收 RuntimeModelAdapter 和 AI SDK ToolSet。
  - 执行 tool calls，append tool result，维护 tool log / pending actions。
  - 输出 RuntimeEvent stream，包含 message_delta / tool_call_start / tool_call_finish / pending_action。
  - 不依赖 packages/agent。
  - 不依赖 packages/tools。
  - 不引入具体 LLM provider。
```

不要把这些边界重新混在一起：

- 不要在 `packages/runtime` 中注册领域工具。
- 不要在 `packages/runtime` 中引入 OpenAI / DeepSeek / provider resolver。
- 不要在 `packages/agent` 中重写 tool loop。
- 不要在 `packages/tools` 中定义第二套 Tool 抽象；默认使用 AI SDK `ToolSet`，除非后续确实需要扩展 metadata。
- 不要用 AI SDK `ToolLoopAgent` 替代 `packages/runtime` 的 Aider-style loop。

## Frontend Transport Boundary

前端接入优先走 HTTP backend + SSE。

```text
@ai-sdk/vue
    ↓
HTTP backend SSE endpoint
    ↓
packages/agent Vercel AI frontend compatibility adapter
    ↓
packages/agent streamNovelAgentTurn()
    ↓
packages/runtime RuntimeEvent stream
```

边界规则：

- `packages/runtime` 只认识 `RuntimeEvent`，不认识 HTTP、SSE、Vue、Electron 或 `@ai-sdk/vue`。
- `packages/agent` 可以提供 Vercel AI UI stream 兼容层，但不能重写 tool loop。
- HTTP backend 是 transport layer，只包装 request / response / SSE，不成为新的 runtime。
- Vue frontend 使用 `@ai-sdk/vue` 连接 backend，不直接执行 tools，也不直接访问 filesystem。
- Electron main process 负责启动和关闭本地 backend，并把 backend base URL 提供给 renderer。
- Electron renderer 复用 Vue frontend 和 HTTP backend 协议，不实现第二套 Electron-only agent stream。

## Tool Types

### Read Tool

直接返回数据。

示例：

- `character.get`
- `world.search`
- `chapter.get`
- `state.get`
- `timeline.list`
- `foreshadow.list`
- `summary.get`
- `constitution.get`

### Write Intent Tool

不直接写文件。

返回：

- SemanticPatch
- PendingAction
- Diff preview

示例：

- `character.updatePersonality`
- `chapter.rewriteScene`
- `state.set`
- `timeline.add`
- `foreshadow.create`
- `summary.generateChapter`
- `constitution.proposeUpdate`

## Tool Naming

使用：

```text
domain.action
```

推荐：

```text
character.get
character.list
character.updatePersonality
world.getTopic
world.search
chapter.get
chapter.rewriteScene
state.get
state.set
timeline.add
foreshadow.create
foreshadow.resolve
summary.generateChapter
constitution.get
constitution.proposeUpdate
```

避免：

```text
get_character
updateCharacterFileDirectly
doNovelStuff
magicWrite
```

## Tool Metadata

当前默认不定义独立 `RuntimeTool` 或 `StoryTool`。

Tool 使用 AI SDK `ToolSet` 表达：

```ts
type StoryReadTools = ToolSet;
```

如果后续 UI 确实需要 `readOnly`、`risk`、`allowedInSkills` 等额外 metadata，应在 AI SDK `ToolSet` 外围增加薄 metadata map，而不是替换 `ToolSet` 本身。

因此旧文档中的 `defineStoryTool()`、独立 `ToolRegistry`、`RuntimeToolRegistry` 都不是当前实现目标。

## Tool Result

Read Tool 返回结构化结果。

Write Intent Tool 返回：

```ts
interface PendingAction {
  id: string;
  title: string;
  description: string;
  patches: SemanticPatch[];
  diff: string;
  touchedFiles: string[];
  status: "pending";
}
```

## Context Builder

上下文构建遵循优先级：

```text
Novel Constitution
Workflow
Skill Prompt
Current User Request
Explicitly Selected Files
Recent Chapter
Previous Chapter
Summaries
State
Timeline
Foreshadow
```

不要默认加载整个小说。

## Tool Visibility

UI 必须展示：

- Tool name
- Arguments
- Result preview
- 是否 read-only
- 是否产生 PendingAction
- touched files
- diff

## Error Handling

Tool error 不应中断整个 session。

返回给模型：

```json
{
  "ok": false,
  "error": {
    "code": "CHARACTER_NOT_FOUND",
    "message": "Character heroine not found.",
    "recoverable": true
  }
}
```

## Skill Integration

Skill 限制可用工具。

示例：

```yaml
name: rewrite
allowed_tools:
  - chapter.get
  - chapter.rewriteScene
  - summary.get
system: |
  Rewrite locally.
  Preserve voice.
```

Runtime 在创建 tool set 时按 Skill 过滤。

## Constitution Guard

Constitution 不作为隐藏 policy。

它应作为可见上下文进入 prompt。

如果用户请求与 Constitution 冲突，Copilot 应提示冲突并提供可选方案，但人类可覆盖。

## Minimal Implementation Modules

建议源码结构：

```text
src/
└── copilot/
    ├── runtime/
    │   ├── runCopilot.ts
    │   ├── buildContext.ts
    │   └── modelClient.ts
    ├── tools/
    │   ├── registry.ts
    │   ├── character.ts
    │   ├── world.ts
    │   ├── chapter.ts
    │   ├── state.ts
    │   ├── timeline.ts
    │   ├── foreshadow.ts
    │   ├── summary.ts
    │   └── constitution.ts
    └── types/
        ├── tool.ts
        ├── pendingAction.ts
        └── semanticPatch.ts
```

## First Vertical Slice

第一条完整链路建议：

```text
User:
把女主状态改成 injured，并添加时间线事件。

Runtime:
state.set
timeline.add

Apply Engine:
生成两个 SemanticPatch

Approval:
展示两个 diff

User:
Accept

Result:
写入 state/characters.yaml 和 timeline/events.yaml
```
