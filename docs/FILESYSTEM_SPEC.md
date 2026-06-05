# Filesystem Specification

## Purpose

本文件定义被 `oh-awesome-novel` 管理的小说项目目录结构。

注意：这里描述的是“小说项目目录”，不是 `oh-awesome-novel` 应用源码目录。

## Design Principle

最终原则：

> Filesystem = Object File Tree

不要把所有信息塞进几个巨大 Markdown 文件。

目标是让 AI、作者和 Git 都能精确理解每一次修改。

## Canonical Layout

```text
my-novel/
├── .storyforge/
│   ├── AGENTS.md
│   ├── CODEX.md
│   ├── workflow.yaml
│   ├── constitution/
│   │   ├── identity.md
│   │   ├── philosophy.md
│   │   ├── narrative.md
│   │   ├── character.md
│   │   ├── world.md
│   │   ├── content.md
│   │   ├── style.md
│   │   ├── forbidden.md
│   │   └── direction.md
│   ├── prompts/
│   ├── skills/
│   └── extensions/
│
├── characters/
│   ├── hero/
│   │   ├── meta.yaml
│   │   ├── summary.md
│   │   ├── personality.md
│   │   ├── appearance.md
│   │   ├── growth.md
│   │   └── relationships.yaml
│   └── heroine/
│       ├── meta.yaml
│       ├── summary.md
│       ├── personality.md
│       ├── appearance.md
│       ├── growth.md
│       └── relationships.yaml
│
├── world/
│   ├── magic/
│   │   ├── overview.md
│   │   ├── rules.md
│   │   └── forbidden.md
│   ├── geography/
│   │   ├── overview.md
│   │   ├── north.md
│   │   └── south.md
│   ├── factions/
│   │   ├── empire.md
│   │   └── church.md
│   └── history/
│       ├── ancient.md
│       └── modern.md
│
├── chapters/
│   └── volume-01/
│       ├── 001.md
│       ├── 002.md
│       └── 003.md
│
├── state/
│   ├── characters.yaml
│   ├── inventory.yaml
│   └── locations.yaml
│
├── timeline/
│   ├── events.yaml
│   └── arcs.yaml
│
├── foreshadow/
│   ├── active.yaml
│   └── resolved.yaml
│
├── summaries/
│   ├── chapter/
│   │   └── volume-01/
│   │       ├── 001.md
│   │       └── 002.md
│   ├── volume/
│   │   └── volume-01.md
│   └── global.md
│
├── schemas/
└── .git/
```

## Domain Categories

### Object Domain

对象型领域可以拆成目录。

包含：

- Character
- World
- Constitution

特点：

- 长期增长。
- 人类经常手改。
- 适合 Markdown 小文件。
- AI 修改时应尽量只碰一个物理文件。

### Collection Domain

集合型领域适合 YAML。

包含：

- State
- Timeline
- Foreshadow

特点：

- 结构化。
- 节点增删改多。
- 不适合长篇自然语言。
- AI 修改时应使用 YAML path 操作。

### Narrative Domain

叙事型领域是连续文本。

包含：

- Chapter
- Summary

特点：

- 文本连续。
- 有场景、段落、chunk。
- 修改时不能全文重写。

## Character Format

### `characters/<id>/meta.yaml`

```yaml
id: heroine
displayName: 女主
aliases:
  - Alice
tags:
  - main-character
firstAppearance: volume-01/001
importance: main
```

### `characters/<id>/personality.md`

```markdown
# 外在人格

她在人前冷淡克制，不轻易表达情绪。

# 内在人格

她仍然保留温柔，但把它藏得很深。

# 创伤经历

...

# 成长变化

...
```

### `characters/<id>/relationships.yaml`

```yaml
relationships:
  hero:
    type: romantic_tension
    status: unresolved
    notes: 女主不愿承认依赖主角。
  villain:
    type: hatred
    status: active
```

## World Format

World 不使用 `world.md` 这种大文件。

示例：

```text
world/magic/overview.md
world/magic/rules.md
world/magic/forbidden.md
world/factions/empire.md
world/history/ancient.md
```

每个文件应聚焦一个主题。

AI 修改世界设定时，应尽量调用：

```text
world.updateTopic(topic="magic/rules")
```

而不是重写整个 `world/`。

## Chapter Format

章节是 Narrative Domain。

建议使用场景标题：

```markdown
---
id: volume-01/003
title: 黑色纹路
status: draft
---

# Scene 1

...

# Scene 2

...

# Scene 3

...
```

如果用户没有写场景标题，系统可以临时按 chunk 切分：

```text
chunk size: 800-1200 Chinese chars
```

但长期建议 UI 支持场景化章节。

## State Format

### `state/characters.yaml`

```yaml
characters:
  heroine:
    hp: injured
    emotion: hatred
    location: academy
    flags:
      - black_mark_visible
  hero:
    hp: normal
    emotion: guilt
    location: academy
```

Character 与 State 必须分离。

Character 是相对稳定的人设。

State 是随章节变化的动态变量。

## Timeline Format

### `timeline/events.yaml`

```yaml
events:
  - id: event_001
    chapter: volume-01/003
    title: 女主重伤
    description: 女主在战斗中被黑色纹路侵蚀。
    tags:
      - injury
      - black_mark
```

## Foreshadow Format

### `foreshadow/active.yaml`

```yaml
active:
  - id: black_mark
    firstChapter: volume-01/003
    description: 女主手臂出现黑色纹路。
    expectedResolution: volume-02
    relatedCharacters:
      - heroine
```

### `foreshadow/resolved.yaml`

```yaml
resolved:
  - id: dragon_eye
    firstChapter: volume-01/001
    resolvedChapter: volume-01/010
    description: 龙眼伏笔已揭示为古代契约。
```

## Summary Format

```text
summaries/chapter/volume-01/001.md
summaries/volume/volume-01.md
summaries/global.md
```

上下文组装时优先使用摘要，不加载全部章节全文。

## Constitution Format

Constitution 拆成目录：

```text
.storyforge/constitution/
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

AI 修改 Constitution 时只能生成 proposal，不能直接写。

## File Granularity Rule

一个 AI Tool 一次最好只修改一个物理文件。

允许例外：

- Chapter Completion Assistant 可生成多个 PendingAction。
- 每个 PendingAction 仍对应独立文件 patch。
- 用户可以逐个 Accept / Reject。

## Migration Note

早期可以支持简化布局：

```text
characters/heroine.md
world.md
constitution.md
```

但这只应作为导入兼容层，不应作为长期目标。

