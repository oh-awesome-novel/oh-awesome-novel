# Agent Operating Manual

本文件是给 Codex / Claude Code / Aider / Crush 等开发 Agent 的长期操作手册草案。

如果未来要创建项目级 `AGENTS.md`，可基于本文件。

## Project Identity

`oh-awesome-novel` is a filesystem-first AI novel IDE.

It is not:

- a general AI agent framework
- a coding assistant platform
- a multi-agent orchestration system
- a hidden autonomous writing system

Its purpose is to help authors write and maintain long-form novels.

## Core Philosophy

Markdown / YAML / Object File Tree is the database.

Git is the history engine.

AI is the copilot.

Human is always in control.

## Before Making Any Change

Always read:

1. `docs/ARCHITECTURE.md`
2. `docs/APPLY_ENGINE.md`
3. `docs/DEVELOPMENT_PLAN.md`

Treat them as the architecture source of truth.

## Architecture Principles

### Filesystem First

Persistent project data must be stored in Markdown or YAML files.

Do not introduce:

- IndexedDB
- SQLite
- PostgreSQL
- MySQL
- Redis
- Vector databases as source of truth

### Object File Tree

Prefer small domain files over giant documents.

One AI tool should usually modify one physical file.

### Tool Calling

Use Vercel AI SDK only for:

- `tool()`
- `generateText()`
- `streamText()`

Avoid additional AI frameworks.

### Runtime

Target flow:

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

Do not implement:

- Planner
- Multi-Agent Runtime
- Autonomous execution
- Hidden retry loops

### File Modification

Never rewrite entire files by default.

Always prefer:

```text
SemanticPatch
    ↓
Apply Engine
    ↓
Git-style diff
    ↓
Human Approval
```

Avoid raw `fs.readFile` / `fs.writeFile` scattered across the codebase.

Use dedicated Markdown / YAML engines.

### Human Approval

AI may:

- Read
- Analyze
- Suggest
- Generate patches

AI may not:

- Silently modify files
- Rewrite project automatically
- Bypass confirmation

Every write operation should become a visible diff.

## Current Domains

- Character
- World
- Chapter
- State
- Timeline
- Foreshadow
- Summary
- Constitution
- Workflow
- Skill
- Extension

Prefer extending existing domains before creating new ones.

## Tool Naming Convention

Use:

```text
domain.action
```

Completed / current examples:

```text
character.get
character.list
character.updatePersonality
world.search
chapter.get
state.set
timeline.add
summary.generateChapter
```

Post-M6 proposed examples:

```text
chapter.rewriteScene
foreshadow.resolve
constitution.proposeUpdate
```

## Skills

A Skill is:

```text
Prompt Pack
    +
Allowed Tool List
```

Skills should not contain business logic.

## Extensions

Extensions may register:

- Tools
- Prompt Packs
- Workflow Templates
- Constitution Templates

Extensions must remain loosely coupled.

## Coding Style

Prefer:

- Small files
- Simple TypeScript
- Explicit code
- Composition over abstraction
- Deterministic parsers
- Focused tests

Avoid:

- Deep inheritance
- Magic behavior
- Reflection-heavy code
- Hidden global state
- Framework-driven architecture

## Explicitly Avoid

Never introduce:

- LangChain
- CrewAI
- AutoGen
- Semantic Kernel
- Hidden planners
- Autonomous agents
- Database migrations
- Event sourcing
- CQRS

Keep the project understandable by one developer.

## Ultimate Goal

`oh-awesome-novel` should feel like:

```text
Obsidian
    +
Git
    +
Aider
    +
NovelBot
```

with AI acting as a transparent writing copilot.
