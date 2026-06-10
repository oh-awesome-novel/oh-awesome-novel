# ADR 0002: No Heavy Agent Frameworks

## Status

Accepted

## Context

项目目标是小说 Copilot，不是通用 Agent 平台。

LangChain、AutoGen、CrewAI、Semantic Kernel 等框架会引入大量抽象，并诱导项目变成通用 Agent Framework。

对话中最终偏好是 Aider-style 极简 runtime。

## Decision

Copilot Runtime 只实现：

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

Tool Calling 使用 Vercel AI SDK 的最小能力：

- `tool()`
- `generateText()`
- `streamText()`

不引入重型 Agent 框架。

## Consequences

优点：

- Runtime 容易理解。
- 易调试。
- 不容易被框架约束写作场景。
- 可控性强。

代价：

- 需要自己维护本地 AI SDK `ToolSet` 组装、Context Builder、Approval。
- 高级 agent 功能需要逐步手写。

## Explicitly Avoid

- Planner
- Multi-Agent Runtime
- Autonomous Loop
- Hidden Retry Engine
- LangChain
- AutoGen
- CrewAI
- Semantic Kernel
