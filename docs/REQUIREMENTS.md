# Requirements

## User Problems

从对话中整理出的核心痛点：

1. Open WebUI / SillyTavern 适合聊天和角色扮演，但不适合直接生成文件、修改文件、维护几十万字小说工程。
2. OpenCode 等 coding agent 可能有较重 system prompt 或框架侧审查，不适合自由小说创作工作流。
3. 长篇小说需要跨文件维护角色、人设、世界观、时间线、伏笔、状态、摘要，而不是把几万字粘贴到聊天框。
4. 传统 RAG / Memory 如果无节制塞上下文，会导致慢、乱、上下文爆炸。
5. AI 直接全文重写 Markdown 很容易破坏格式、删掉无关内容、造成不可审阅修改。
6. 作者需要 Git diff、Accept / Reject、回滚和可控修改，而不是 AI 静默写入。

## Primary Users

### Independent Novel Author

需要：

- 长篇小说项目管理。
- 多章节、多角色、多世界观文件维护。
- 能局部润色、续写、反提取状态。
- 能自由选择模型。
- 能用 Git 管理版本。

### Power User With Agent Tools

需要：

- 与 Codex、Aider、Crush、Claude Code、VSCode、Obsidian 兼容。
- 文件系统是第一公民。
- 可导入导出、可用外部工具直接编辑。

## Functional Requirements

### F1. Novel Project Initialization

系统应能创建一个标准小说项目目录：

```text
my-novel/
├── .storyforge/
├── characters/
├── world/
├── chapters/
├── state/
├── timeline/
├── foreshadow/
├── summaries/
└── .git/
```

命名保留 `.storyforge/` 是为了兼容讨论中的概念；应用项目名仍是 `oh-awesome-novel`。

### F2. Object File Tree

Character、World、Constitution 等对象不能长期维护成单个巨大 Markdown 文件。

应拆成细粒度文件：

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
- 文件粒度越小，diff 越清晰，Apply Engine 越稳定。

### F3. Domain Support

必须支持七个一级领域：

- Character
- World
- Chapter
- State
- Timeline
- Foreshadow
- Summary

另有项目控制领域：

- Constitution
- Workflow
- Skill
- Extension

### F4. Novel Constitution

每个小说项目必须有创作宪法。

它定义：

- 项目身份
- 写作哲学
- 叙事规则
- 人物规则
- 世界规则
- 内容规则
- 风格指南
- 禁用模式
- 长期方向

AI 只能建议修改，不能自动修改。

### F5. Workflow

作者可以用 `.storyforge/workflow.yaml` 定义创作流程。

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

Workflow 属于作者，不属于 AI。

### F6. Tool Registry

系统应提供 Tool Registry，暴露领域操作。

初始工具：

- `character.get`
- `character.list`
- `character.updatePersonality`
- `world.search`
- `chapter.get`
- `chapter.rewriteScene`
- `state.get`
- `state.set`
- `timeline.add`
- `foreshadow.create`
- `foreshadow.resolve`
- `summary.generateChapter`
- `constitution.get`
- `constitution.proposeUpdate`

### F7. Aider-style Copilot Runtime

Runtime 必须保持极简：

- OpenAI compatible API
- 支持 Vercel AI SDK `tool()` / `generateText()` / `streamText()`
- 支持多 tool call
- 支持最大循环次数
- Tool error 作为 tool result 返回

明确不做：

- Planner
- Multi-Agent
- Autonomous execution
- Hidden retry engine

### F8. SemanticPatch

写入工具不应直接输出完整文件，也不应输出脆弱的 search/replace。

AI 应输出意图：

```json
{
  "target": "character",
  "entityId": "heroine",
  "operation": "replaceBlock",
  "file": "personality.md",
  "block": "内在人格",
  "instruction": "增加外冷内热的表现，但保留善良本性。"
}
```

Apply Engine 将意图转成 diff。

### F9. Human Approval

所有写操作必须生成 Patch Preview。

用户确认前不得写盘。

### F10. Summary And Memory

Memory 不是向量数据库，而是由文件组成：

- 最近章节
- 章节摘要
- 卷摘要
- 全局摘要
- 当前角色状态
- 时间线
- 伏笔

生成上下文时优先使用：

```text
Constitution
Workflow
Current Task
Current Chapter
Previous Chapter
Recent Summaries
Volume Summary
Global Summary
State
Timeline
Foreshadow
```

不要加载整本小说。

### F11. Chapter Completion Assistant

用户标记一章完成后，Copilot 应分析：

- 人物状态变化
- 关系变化
- 物品变化
- 时间线事件
- 伏笔新增或回收
- 需要生成的摘要

输出待确认提案。

### F12. Skills

Skill = Prompt Pack + Allowed Tool List。

示例：

```yaml
name: rewrite
allowed_tools:
  - chapter.get
  - chapter.rewriteScene
  - summary.get
system: |
  Rewrite locally.
  Preserve character voice.
  Avoid AI clichés.
```

Skill 不包含业务逻辑。

### F13. Extensions

Extension 可以贡献：

- Tools
- Prompt Packs
- Workflow Templates
- Constitution Templates

参考 Goose 的扩展思想，不参考复杂 runtime。

## Non-Functional Requirements

### Simplicity

一个开发者应能在短时间内读懂核心 runtime。

### Observability

Tool calls、参数、结果预览、SemanticPatch、diff 都必须可见。

### Git Friendliness

所有项目数据都应 Git friendly。

### Model Flexibility

应支持 OpenAI compatible provider：

- DeepSeek
- Qwen
- Ollama
- OpenRouter
- Gemini compatible gateway
- 其它兼容 API

### Local First

项目应能在本地运行，默认不依赖云端数据库。

## Explicitly Avoid

不要引入：

- LangChain
- AutoGen
- CrewAI
- Semantic Kernel
- Hidden planners
- Heavy multi-agent runtime
- Autonomous background writes
- Database migrations
- Event sourcing
- CQRS
- 向量数据库作为事实源

