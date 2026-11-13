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
├── works.yaml               （可选：原作清单）
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
│   ├── inventory.yaml        （未实现：没有读写与校验；Play 道具见 tasks/1660）
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
├── assets/                  （图片资源目录：Git 忽略，不是小说内容，见下文）
│   └── portraits/
│       └── <character-id>/
│           └── normal.png
└── .git/
```

### Workspace Configuration And Writing Profiles

`.oan/config.yaml` 是 workspace 级配置文件。Writing Profile 只占用其中的
`writingProfile` 子树：

```yaml
version: 1
writingProfile:
  activeProfileId: fanfictionWriting
```

缺少 `writingProfile` 时，Host 以只读内置 Profile `fanfictionWriting`（同人二创，2026-10-15 起为默认）
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

## Work Registry And Attribution (1530 / 1540)

可选的 `works.yaml` 是正式小说文件，格式为 `version: 1` 与 `works` 数组；最多 200 部作品。每项有唯一安全 `id`、非空 `title`（最多 120 字）、可选 `aliases`（最多 32 项）与 `referenceIds`（最多 32 项）。同一个 reference 只能绑定一部作品；引用 id 是 reference 的稳定身份，可保留已删除的 reference 来源。`original` 是保留的原创 id，不得登记为原作。没有清单时不创建空文件。

角色 `meta.yaml` 可选 `originWorkId` 为清单内的作品 id，或 `original`；省略也是有效原创/未标注状态。世界 Markdown 的 frontmatter 或 YAML 根对象也可选 `originWorkId`，不设集中路径索引。归属引用必须在完整最终树里存在；删除清单/作品不能留下悬空归属。清单编辑与归属修改均经 PendingAction，Accept 前保持原文。

角色 `meta.yaml` 可选 `referenceCharacters` 数组（最多 200 项），每项严格为 `{ referenceId, name, materialHash }`：人物名按 NFKC、小写、首尾/连续空白归一比较，`materialHash` 是对应人物条目的 title/content/details/assertionType/confidence/uncertainty 的 SHA-256。条目 id 包含 run/unit，不作持久身份。同一 reference/规范化姓名只能对应一个角色；重新拆解后内容 hash 变化需要重新裁定。人物对应不改变角色本源归属。

关系材料暂只有自由文本，没有可信的结构化对方字段，不能从文字猜测人物。启用作品清单的采用流程要求作者逐条确认对方人物名与角色 id（或移出条目）；宿主先用已接受/本批已确认的人物对应给出可选目标，生成的 relationships.yaml key 必须是所确认的角色 id。无作品清单且未使用人物裁定的旧采用请求保持原行为。

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

### `characters/<id>/roster-profile.yaml`

Play 名册：角色在舞台上的名字、别名与外观。`looks.nameColor` 与 `portraits` 是可选的；没有它们的文件含义不变。

```yaml
id: nian
name: 念念
aliases: [小念]
genderKind: girl            # girl | boy | other
isPlayer: false
looks:
  fixedBooruTags: 1girl
  outfitDescription: ""
  outfitTags: ""
  refImagePath: characters/nian/normal.png   # 可选，旧的单张图片
  nameColor: "#E9C983"                        # 可选，舞台名字牌颜色，#RRGGBB
portraits:                                    # 可选，预设立绘集
  default: casual
  items:
    - id: casual
      label: 常服
      description: 米色开衫，袖口挽起。
      usage: 日常
      image: assets/portraits/nian/casual.png
    - id: night
      label: 夜行
      description: 黑色斗篷遮住半张脸。
      prompt:
        positive: black cloak, night
        negative: lowres
```

- `portraits.items` 1 至 24 项。`id` 为 1–32 位 ASCII 字母、数字、`_`、`-`，在角色内唯一；`default` 必须是其中一项的 `id`。
- `label` 必填，不超过 16 字；`description` 必填，不超过 500 字；`usage` 可选，不超过 200 字。
- `image` 可选，只写路径，形状见下文 [Image Asset Directory](#image-asset-directory)；校验不要求文件存在。没有 `image` 的立绘在舞台上显示剪影与描述。
- `prompt` 可选：`positive` 必填，`negative`、`useCharacterTags` 可选，均为纯文本，单项不超过 2000 字。
- `generation` 可选，记录一张生成图的来源（`provider`、`model`、`seed`、`size`、`workflowHash`、`promptHash`、`generatedAt`），不含密钥与地址。
- 条目里出现以上之外的字段会被拒绝。
- `portraits` 与 `looks.refImagePath` 并存时以 `portraits` 为准：新会话不再把 `refImagePath` 的图片存进会话。只有 `refImagePath` 的名册行为不变。
- `portraits` 与 `looks.nameColor` 只用于舞台显示，不进入 Play 的冻结前缀与回合请求；作者把名册选作写作设定来源时，这两项也会先被去掉再交给模型。

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

`state/chapters/<卷号>/<章号>.yaml` 保存已接受的本章结算证据，包括正文 `sourceHash`、观察和可能存在的 `settlementRecords` 历史；作者既有字段继续保留。它与 `state/characters.yaml` 等当前全局状态用途不同。默认上下文只加载当前全局状态及目标章的当前证据，其他章级记录在固定投影中按需读取，不因位于 state 根而全部发送。

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

章节结算生成的摘要带当前来源指针和历史证据块；来源 hash 对应正文原始内容。默认上下文使用通过证据检查的当前块，历史块不作为当前事实自动加载。作者手写摘要缺少来源记录时标为 unverified 参考；过期、损坏或缺失的证据由共享 evaluator 明确区分。`sourceHash` 不证明模型对文学事实的解释正确，作者仍审阅提案。

```text
summaries/chapter/0001/0001.md
summaries/volume/0001.md
summaries/global.md
```

上下文组装时优先使用摘要，不加载全部章节全文。

卷/全书摘要的受管格式是单个 `oan:summary:v1` Markdown 注释区块：严格 JSON 元数据包含 `schemaVersion: 1`、`targetPath`、排序去重的 `chapterIds`、直接 `sources`（`path/sourceHash/payloadHash`）、传递来源 `sourceFingerprint` 和带 `sourcePaths` 的段落；其后是由同一段落确定性渲染的可读正文。元数据与可读正文必须一致，未知版本、错位身份或损坏区块为 unverified。解析允许块内 LF / CRLF 差异，但来源 hash 仍按整文件原始字节计算。普通文字中的标记名称不算受管注释。区块之外的作者文字按原样保留，不进入上层生成的已验证输入；更新替换合法受管区块，缺少一级标题时在同一候选中补齐标题，旧版本由 Git 保存。

上层生成使用已验证观察/段落的原始文本；Markdown 显示转义不重复传递到下一层。`payloadHash` 绑定此派生输入，Accept 同时核对其来源引用与传递 fingerprint。来源包含特殊字符的旧摘要可能需要重新生成，不提供兼容 reader 或自动迁移。整文件依赖包括正文、章摘要全文、章状态 `.yaml` / `.yml` 及缺失槽位；全书还绑定直接卷摘要全文。

卷摘要完整覆盖当前卷的正文章节；全书摘要完整覆盖当前所有有正文的卷。`0000.md` 卷元信息不计入正文覆盖。来源链为正文 → 已接受章级证据/摘要 → 卷摘要 → 全书摘要；即便中间摘要未重新生成，正文变化、增删章或跨卷移动也会使上层摘要失效。只 touch 不影响内容 hash。缺失、过期或未验证来源不生成部分覆盖的候选。

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

`.oan/sessions/<session-id>/messages.jsonl` 会保留 assistant 的思考内容（`reasoning`）作为调试
记录；`.oan/sessions/.play-logs/<play-session-id>/messages.jsonl` 是 Play 只追加的调试消息日志
（作者行动、模型请求、思考、输出与回合结果）。两者都不是事实源：恢复会话、Play 状态与
projection 都不从中读取思考内容，删除它们不影响任何功能。同级的 `.oan/sessions/.play-checks/<play-session-id>/character-checks.json` 保存角色贴合度检查报告（见 PLAY_MODE_SPEC），同样只是可丢弃的意见，不进入 Play 状态、采纳或导出。`.play-logs` 与 `.play-checks` 以 `.` 开头，不会被
当作 Copilot session id。

开发迁移 reset 只能在验证 realpath、Git tracked files、Git status 和 canonical SHA-256
manifest 后删除上述两个精确目录；不得删除整个 `.oan/`、`.git/` 或任何 canonical
object tree。

## Image Asset Directory

图片不是小说事实，也不进入 Git。它们放在工作区根下的 `assets/` 文件夹里；正式文件里只记录图片的路径。

```text
assets/
└── portraits/
    └── <character-id>/
        ├── normal.png
        └── angry.webp
```

- `assets/` 是作者可见的普通文件夹：作者可以直接往里放文件，也可以在界面上用“导入图片”把本机图片复制进去。宿主只在作者显式触发时写入，不在后台写图片。
- **Git 忽略**：新工作区的 `.gitignore` 含 `/assets/`。已有工作区的 `.gitignore` 不会被改写；作者第一次导入图片时，如果 Git 还没有忽略该目录，宿主把 `/assets/` 追加到本机的 `.git/info/exclude`（不进提交）。图片不随 Git 走：换一台机器克隆工作区后图片不在，引用处显示占位并说明原因，这不是错误。
- **不属于变更引擎**：`assets/` 不在 sandbox projection 的可读、可写范围内，不进入 CandidateChangeSet、PendingAction 与 ChangeMaterializer，不进入 ContextPackage、全局搜索，也不发给任何模型。
- **路径是唯一的正式记录**：正式文件引用图片时写工作区相对路径，例如 `assets/portraits/nian/normal.png`。路径形状为 `assets/<…>/<文件名>.(png|jpg|jpeg|webp)`，每段只含 ASCII 字母、数字、`_`、`-`、`.`，不以 `.` 开头，不含 `..`。路径的修改是普通的 YAML 文本变更，照常经 PendingAction 与 Git diff 审批；校验只看路径形状，不要求文件存在。
- **只新增不覆盖**：宿主写入时文件名冲突会自动加 `-2`、`-3`…；同一目录里已有内容相同的文件时复用它。因此路径变更被拒绝时，原来引用的图片不受影响，被拒绝的新图片留在目录里成为未引用文件。
- **读取**：只读 PNG、JPEG、WebP，文件签名必须与扩展名一致，单文件不超过 16 MiB；拒绝符号链接、硬链接、隐藏路径与越出 `assets/` 的路径。界面显示原图，不缩放、不转码。
- **清理**：没有被任何正式文本文件（chapters、characters、world、state、timeline、foreshadow、summaries、outline 下的 Markdown / YAML）提到路径的图片可以列出，由作者逐张确认删除；系统不自动删除，仍被引用的图片不能通过界面删除。

既有的 `looks.refImagePath` 与 `world/places/<scene-id>` 场景图不受本节约束，读取方式、位置与 256 KiB 上限见 [PLAY_LOCAL_SCENERY](PLAY_LOCAL_SCENERY.md)。

## Migration Note

早期可以支持简化布局：

```text
characters/heroine.md
world.md
constitution.md
```

但这只应作为导入兼容层，不应作为长期目标。
