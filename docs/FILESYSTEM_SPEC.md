# Filesystem Specification

## Purpose

本文件定义被 `oh-awesome-novel` 管理的小说项目目录结构。

注意：这里描述的是“小说项目目录”，不是 `oh-awesome-novel` 应用源码目录。

## Design Principle

最终原则：

> Filesystem = Object File Tree

不要把所有信息塞进几个巨大 Markdown 文件。

目标是让 AI、作者和 Git 都能精确理解每一次修改。

本规格只定义 canonical novel workspace。候选、审批、恢复、chat/tool log 等内部状态不属于小说事实，固定使用 `.workspace/change-engine/v1/` 或 `.oan/sessions/`，且不得被模型当作可读写目标。

## Canonical Layout

项目内部运行目录统一使用 `.oan/`。早期讨论中的 `.storyforge/` 不是有效 workspace 目录，不需要兼容层。

```text
my-novel/
├── .oan/
│   ├── AGENTS.md
│   ├── CODEX.md
│   ├── config.yaml
│   ├── workflow.yaml
│   ├── writing-profiles/
│   │   └── <safe-id>.yaml
│   ├── indexes/
│   │   └── chapters.yaml
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
│   └── 0001/
│       ├── 0000.md
│       ├── 0001.md
│       ├── 0002.md
│       └── 0003.md
├── outline/
│   ├── main.md
│   └── volumes/
│       └── 0001.md
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
│   │   └── 0001/
│   │       ├── 0001.md
│   │       └── 0002.md
│   ├── volume/
│   │   └── 0001.md
│   └── global.md
│
├── schemas/
└── .git/
```

### Workspace Configuration And Writing Profiles

`.oan/config.yaml` 是 workspace 级配置文件。Writing Profile 只占用其中的
`writingProfile` 子树：

```yaml
version: 1
writingProfile:
  activeProfileId: commercialWriting
```

缺少 `writingProfile` 时，Host 以只读内置 Profile `commercialWriting`
作为非持久化 fallback。`writingProfile` 子树使用 strict 校验；未知字段、
非法 id 或指向不存在 / 无效 Profile 时必须产生可定位的 Profile 配置错误，
但不能使 `git`、`onboarding` 等其它宽松配置 section 失效，也不能阻止
workspace 打开。

用户自定义 Profile 存放在 `.oan/writing-profiles/<safe-id>.yaml`。文件名
必须与 Profile 内的 `id` 一致；文件使用固定字段和 strict schema，不能包含
任意 prompt、脚本、工具、路径或 source binding。内置 Profile 由 Host
提供，不写入该目录且不可编辑；创建、克隆、更新、删除与激活均为用户显式、
Git-visible 的原子配置操作。

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
- Outline

特点：

- 文本连续。
- 有场景、段落、chunk。
- 修改时不能全文重写。

Outline 也是当前小说的 Project Truth。材料 adoption 第一版只允许对
`outline/**/*.md` 生成整文件候选，仍必须经过 CandidateChangeSet、diff、
PendingAction 与 Accept；后续局部 scene / beat 编辑也必须保持相同审批边界。

## Character Format

### `characters/<id>/meta.yaml`

```yaml
id: heroine
displayName: 女主
aliases:
  - Alice
tags:
  - main-character
firstAppearance: 0001/0001
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

正文路径使用稳定编号：

```text
chapters/<volume-number>/<chapter-number>.md
```

规则：

- 卷目录只使用 4 位编号，例如 `0001/`。
- 每卷的 `0000.md` 存放卷信息 / 卷元数据，不是小说正文章节内容。
- 正文章节从 `0001.md` 开始。
- Chapter id 使用 `<volume-number>/<chapter-number>`，例如 `0001/0003`。
- 修改卷名或章节名不得导致路径变化。

## Derived Chapter Index

章节目录索引是从 `chapters/` 扫描生成的派生文件，不是小说事实源。

默认路径：

```text
.oan/indexes/chapters.yaml
```

索引文件至少记录：

- 生成时的 Git commit hash。
- 生成时间。
- 扫描范围。
- 卷 / 章节 id。
- 卷 / 章节标题。
- workspace-relative 文件路径。

示例：

```yaml
kind: chapter-index
version: 1
generatedAt: 2026-06-10T00:00:00.000Z
git:
  head: 2f4c8a1b7c9d0e1f234567890abcdef123456789
  dirty: false
source:
  root: chapters
volumes:
  - id: "0001"
    title: 第一卷
    metadataPath: chapters/0001/0000.md
    chapters:
      - id: "0001/0001"
        title: 第一章
        path: chapters/0001/0001.md
```

读取索引时必须比较当前 Git HEAD 和索引中的 `git.head`。如果 hash 不一致，UI 应提示章节索引可能过期，需要重新扫描。

如果当前 workspace 没有 Git 仓库、无法读取 HEAD，或工作区 dirty，UI 必须明确展示索引状态，不能把索引伪装成已验证的最新结果。

建议使用场景标题：

```markdown
---
id: 0001/0003
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
    order: 1
    chapter: "0001/0003"
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
    status: active
    firstChapter: "0001/0003"
    description: 女主手臂出现黑色纹路。
    expectedResolution: 0002
    relatedCharacters:
      - heroine
```

### `foreshadow/resolved.yaml`

```yaml
resolved:
  - id: dragon_eye
    status: resolved
    firstChapter: "0001/0001"
    resolvedChapter: "0001/0010"
    description: 龙眼伏笔已揭示为古代契约。
```

## Final Object Tree Reference Rules

提案和 Accept 都用同一类型化引用校验：host 从 `chapters/`、`characters/`、`world/`、`state/`、`timeline/`、`foreshadow/` 的安全、有界快照出发，叠加本 action 的 create/update/delete 后检查最终树。Sandbox 的引用快照在 turn 开始时冻结；窄读取权限使用独立 host-only 快照，不增加模型可见范围。正式提案持久化前和 Accept 写入前再检查当前 host 最终树。

| Namespace | Stable identity |
| --- | --- |
| character | `characters/<id>/` 下至少一个受支持 `.md` / `.yaml` 文件；目录中的多个组件共同属于一个角色。 |
| chapter | `chapters/<volume>/<chapter>.md` 的 `<volume>/<chapter>`；`0000.md` 为卷元信息，不是章节。 |
| world | `world/` 下文件的完整相对路径，去掉 `.md` / `.yaml`，例如 `locations/library`；同 stem 的两种扩展名不可并存。 |
| event / arc | `timeline/*.yaml` 的 `events` / `timeline` 或 `arcs` 集合条目 `id`；同 namespace 跨文件唯一。 |
| foreshadow | `foreshadow/*.yaml` 的 `foreshadow` / `active` / `resolved` / `entries` 集合条目 `id`；active/resolved 之间仍需唯一。 |

明确的 `characterRef(s)`、`chapterRef(s)`、`worldRef(s)`、`locationRef(s)`、`eventRef(s)`、`arcRef(s)`、`foreshadowRef(s)` 按对应 namespace 校验，`location` 引用属于 world。复数字段必须为字符串数组，单数字段必须为字符串。相同字符串在其它 namespace 中存在不能满足引用。

State/Timeline/Foreshadow YAML 还检查 `characterId`、`characterIds`、`relatedCharacters`、`chapter`、`chapterId`、`firstChapter`、`resolvedChapter`、`worldId`、`locationId`、`eventId`、`arcId`、`foreshadowId`。`state` 根 `characters` 字典的 key 是角色引用；chapter frontmatter 的 `characters` / `locations` 是角色/world 引用数组；character metadata 的 `firstAppearance` 是章节引用；world metadata 的 `parentId` 是 world 引用。章节引用始终使用完整且加引号的 `"0001/0003"` ID，不使用含糊的单一章节号。

`location`、`expectedResolution`、描述文字、普通 Markdown 正文和未列出的字段不自动解释为外键。前者可保存自然语言或未来规划；不能据此声称文学语义完整。

同 action 新建对象并引用它合法；删除对象必须同时删除或改写全部引用它的结构化文件。未改动的引用文件也参与检查。已有悬空引用的工程，对上述六个根内的写入会 fail closed，需在同一候选中修复；纯 summary/outline/Reference publication 的候选不触发这项 gate。语法与单文件领域校验继续独立执行，不因引用存在而跳过。

## Summary Format

```text
summaries/chapter/0001/0001.md
summaries/volume/0001.md
summaries/global.md
```

上下文组装时优先使用摘要，不加载全部章节全文。

## Constitution Format

Constitution 拆成目录：

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

AI 修改 Constitution 时只能生成 proposal，不能直接写。

## File Granularity Rule

普通单领域 workflow 应优先修改一个小型物理文件；作者明确发起的结算、Reference /
Play adoption 或 multi-file edit 可以在一个固定 sandbox session 中形成多个变更。

允许例外：

- Chapter Completion Assistant 可生成多个 PendingAction，或在边界清晰时生成一个
  bounded multi-file CandidateChangeSet。
- 每个 PendingAction 的 `changes` 都必须按 path 稳定排序，并逐项展示
  `create | update | delete`。
- 需要逐项决策时，producer 应在 proposal 前拆成多个 immutable action。

## Canonical And Internal State Boundary

Canonical、Git-visible 数据包括：

- `.oan/config.yaml`、Workflow、Constitution、Skills 与 Writing Profiles；
- chapters、characters、world、outline、state、timeline、foreshadow、summaries；
- accepted reference bundles 与其它明确登记的小说对象文件。

Disposable internal state：

```text
.workspace/change-engine/v1/
.oan/sessions/
```

`.workspace/change-engine/v1/` 保存 immutable draft、PendingAction、terminal、receipt、
transaction、lock 与 prepared preview。`.oan/sessions/` 保存可丢弃的 agent session
artifact。二者都不能作为 ContextPackage source、sandbox projection target 或 Git history
替代品。

开发迁移 reset 只能在验证 realpath、Git tracked files、Git status 和 canonical SHA-256
manifest 后删除上述两个精确目录；不得删除整个 `.oan/`、`.git/` 或任何 canonical
object tree。

## Migration Note

早期可以支持简化布局：

```text
characters/heroine.md
world.md
constitution.md
```

但这只应作为导入兼容层，不应作为长期目标。
