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
generateText() / streamText()
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
- `generateText()`
- `streamText()`
- Zod schema

示意：

```ts
export const getCharacterTool = tool({
  description: "Read a character object file tree.",
  parameters: z.object({
    id: z.string(),
  }),
  execute: async ({ id }) => {
    return characterService.get(id);
  },
});
```

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

每个 Tool 应声明：

```ts
interface StoryToolMeta {
  id: string;
  domain: string;
  readOnly: boolean;
  allowedInSkills?: string[];
  risk: "low" | "medium" | "high";
  description: string;
}
```

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

