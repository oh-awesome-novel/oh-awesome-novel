# Novel Constitution

## Purpose

Novel Constitution 是每个小说项目的最高优先级创作文档。

它回答：

> 这部小说应该永远遵守什么创作原则？

它不是：

- prompt template
- hidden system prompt
- policy engine
- memory database
- 模型审查规则

它是作者写给自己和 Copilot 的公开创作宪法。

## Location

最终推荐拆分为目录：

```text
.oan/constitution/
├── identity.md
├── philosophy.md
├── narrative.md
├── character.md
├── world.md
├── content.md
├── style.md
├── forbidden.md
└── direction.md
```

早期兼容：

```text
.oan/CONSTITUTION.md
```

但长期应迁移到目录形式，避免单文件过长。

## Priority

上下文优先级：

```text
Novel Constitution
    >
Workflow
    >
Skill Prompt
    >
Current User Request
```

如果用户请求与 Constitution 冲突，Copilot 应说明冲突并提供选择。

人类作者可以覆盖 Constitution，但覆盖应是显式行为。

## Human Control

AI 可以：

- 读取 Constitution。
- 引用 Constitution。
- 检查冲突。
- 提出修改建议。

AI 不可以：

- 自动修改 Constitution。
- 隐藏 Constitution。
- 把 Constitution 变成不可见 policy。

## Sections

### identity.md

```markdown
# Project Identity

Title:

Genre:

Target Audience:

Core Theme:

One Sentence Summary:
```

### philosophy.md

```markdown
# Writing Philosophy

- Character driven.
- Consequences matter.
- No plot armor.
- Emotional realism over spectacle.
- Show, don't tell.
```

### narrative.md

```markdown
# Narrative Rules

POV:
Third Person Limited

Narration:
Close and emotional.

Dialogue:
Natural and concise.

Internal Monologue:
Frequent.

Exposition:
Minimal.
```

### character.md

```markdown
# Character Rules

- Main characters never act out of personality.
- Growth must be gradual.
- Relationships require buildup.
- Redemption arcs require sacrifice.
- Major emotional change must be earned through scenes.
```

### world.md

```markdown
# World Rules

- Magic has a cost.
- Death is permanent.
- Technology level never exceeds medieval.
- No time travel.
- World rules cannot be changed to rescue a weak plot.
```

### content.md

```markdown
# Content Rules

Allowed:

- Violence
- Tragedy
- Psychological conflict
- Gray morality

Forbidden:

- Harem
- System mechanics
- Deus ex machina
- Forced comedy
```

### style.md

```markdown
# Style Guide

Prefer:

- Strong verbs
- Visual descriptions
- Emotional subtext
- Specific sensory details

Avoid:

- AI clichés
- Repeated metaphors
- Excessive adverbs
- Empty summaries at scene endings
```

### forbidden.md

```markdown
# Forbidden Patterns

Never write:

- "Time seemed to stop."
- "Little did he know..."
- "Everything changed forever."
- Generic anime overreaction dialogue.
- Repeated mechanical transition phrases.
```

### direction.md

```markdown
# Long Term Direction

- The heroine gradually becomes the antagonist.
- The protagonist ultimately fails to save everyone.
- The ending should feel bittersweet rather than purely happy.
```

## Tool Integration

Read tools may access Constitution freely:

- `constitution.get`

Future Constitution workflow tools may add:

- `constitution.search`
- `constitution.proposeUpdate`

Write tools must only create proposals. `constitution.proposeUpdate` is a proposed Constitution workflow tool, not part of the completed M6 write-intent scope.

Proposal example:

```text
Potential Constitution Update

Target:
.oan/constitution/forbidden.md

Suggestion:
Add rule: villains cannot be redeemed without irreversible cost.

[Accept]
[Reject]
```

## Workflow Integration

Workflow should start from Constitution:

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

## Conflict Handling

用户：

```text
把这本书改成后宫。
```

Copilot：

```text
Constitution conflict detected.

Current rule:
No harem.

Options:
1. Keep single heroine and add supporting female characters.
2. Propose a Constitution update.
3. Continue anyway for this task only.
```

Copilot 不应直接拒绝，也不应隐藏执行。它应透明说明冲突。
