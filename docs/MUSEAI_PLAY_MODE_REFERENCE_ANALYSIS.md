# MuseAI 参考项目对 OAN Play Mode 的可吸收点分析

> 分析范围：`reference-only/MuseAI`，以及 OAN 当前 Play Mode 的规格、任务、core、backend、client 与桌面端实现。
>
> 参考快照：`61ddf8f35710cff3ae850c44d064dc27ed824a40`（`release: v0.9.2`，2026-07-13 15:57:01 +08:00），阅读时参考仓库 working tree clean。
>
> 分析方式：本地静态阅读，并阅读现有测试作为行为证据；未运行 MuseAI、未调用其模型接口、未访问远程服务。
>
> 许可证边界：本地快照没有 `LICENSE`、`COPYING`、`NOTICE`，`package.json` 与 `Cargo.toml` 也没有许可证声明。本文只提炼产品模式、领域概念与测试场景；OAN 不复制 MuseAI 的代码、prompt、文案、角色数据或视觉资产。
>
> 文档性质：reference-only analysis。本文不修改 Play 实现、稳定规格或 task 状态。
>
> 分析日期：2026-07-14。

## 1. 结论摘要

MuseAI 对 OAN Play Mode 最有价值的地方，不是 React、Tauri、Zustand、Ant Design 或 provider 接入，而是它已经形成了一条较完整的互动小说产品闭环：

```text
大纲 / 世界书 / 角色卡
  -> 装配为可游玩的世界模型
  -> 生成多个入场点与可扮演身份
  -> 区分局部节拍与场景切换
  -> 场景切换时先规划世界和场景，再生成叙事正文
  -> 保存进度、维护摘要记忆
  -> 生成世界线结局与角色关系复盘
  -> 按角色回看聊天和冒险足迹
```

这条链路把“开始一局 Play”“持续游玩”“结束后把价值带回创作”连在了一起。OAN 当前已经拥有比 MuseAI 更稳健的底座：

- Play 已经是与 Writing 同层级的顶级工作区。
- session schema v2 已有 world clock、event policy、typed world events、visibility、observation 与 adoption provenance。
- world referee 已加载 transcript、Play-local state、事件，以及带合法 path 的 activated source 内容；当前每回合最多读取 8 个 source、每个截取 8,000 字符，读取失败的 source 会被略过。
- `oan-play-settlement` 在验证后通过 staged directory snapshot 与 directory swap 单次提交，已避免普通失败产生混合 revision；fsync、跨进程锁和完整故障注入仍属 `1120` 剩余范围。
- Play 结果只能经过 observation → adoption candidate → PendingAction → Human Approval 进入 canonical truth。

因此，MuseAI 不应替换 OAN 已有世界事件与事务设计。最值得吸收的是以下增量：

1. **Play Launch Package**：把 canonical source 先装配成可复核、可重用、带 source hash 的 Play 开局包。
2. **入场点与身份向导**：从“手填标题和开场文本”升级为“选择场景入口、玩家身份、目标、风险和活跃角色”。
3. **场景 / 节拍边界**：把玩家输入意图与“继续当前场景还是进入新场景”分开，减少剧情节奏漂移。
4. **裁决 / 叙事分权**：world referee 先产出事件、状态和 scene plan，narrative projection 只负责把已裁决结果写成可读正文。
5. **剧情专用长记忆**：在 session 保留期内不因压缩删除原始 turn；摘要保留剧情进度、NPC 状态、关系、伏笔、期限、知识边界与来源回合。
6. **可见的阶段状态与局部重试**：用户能看见 resolving / planning / narrating；叙事失败时可以复用已验证 plan，但最终仍一次提交。
7. **世界线结束报告与角色复盘**：Play 结束后生成带证据的关键选择、偏离、角色结果和 adoption candidates。

优先级上，MuseAI 的新启发不能挤掉 `docs/tasks/1120.md` 已冻结的 Remaining Review Scope。应先按第 8.1 节收口既定范围，再把入场向导、scene plan、记忆和结局复盘建立在这些底座上。

## 2. 分析基准

### 2.1 MuseAI 当前定位

MuseAI README 把产品定位为“本地 AI 伴侣、文字冒险与穿书互动应用”，强调持续保存世界、角色、记忆和关系，而不是单次聊天；代码也已经实现聊天、冒险、穿书、羁绊、素材装配与本地会话。

证据：

- 产品定位：`reference-only/MuseAI/README.md:1-10`。
- AI 伴侣与长期关系：`reference-only/MuseAI/README.md:41-63`。
- 多角色文字冒险：`reference-only/MuseAI/README.md:65-74`。
- 穿书素材、入场点、身份、场景与记忆：`reference-only/MuseAI/README.md:76-85`。
- 世界书与角色卡跨模块复用：`reference-only/MuseAI/README.md:87-93`。
- 当前产品更偏互动应用而非写作工具：`reference-only/MuseAI/README.md:225-231`。

`PRODUCT.md` 仍把它描述为“面向网文作者的桌面写作 Agent”，与 README 和当前代码的互动世界定位存在明显时差，见 `reference-only/MuseAI/PRODUCT.md:3-6`。本分析以 README、v0.9.2 代码和测试为当前事实，不把旧产品简述当作稳定架构。

技术形态是 React 19 + Zustand + Ant Design + Tauri 2 + Rust；它帮助理解实现边界，但不是 OAN 应吸收的部分，见 `reference-only/MuseAI/package.json:1-46` 与 `reference-only/MuseAI/src-tauri/Cargo.toml`。

### 2.2 重点阅读范围

| 领域 | 重点文件 | 用途 |
|---|---|---|
| 产品意图 | `reference-only/MuseAI/README.md`、`PRODUCT.md` | 确认当前定位和产品闭环 |
| 穿书素材 | `src/pages/BookTravelMaterials.tsx` | 素材装配、入场设计、人工编辑、阶段进度 |
| 穿书运行 | `src/pages/Story.tsx` | 开局、分类、规划、写作、重试、保存、结束 |
| 冒险运行 | `src/pages/Adventure.tsx` | 多角色、输入模式、流式反馈、归档 |
| 角色复盘 | `src/pages/Chat.tsx`、`src/pages/Bond.tsx` | 关系分析、确认、时间线、会话与冒险足迹 |
| 前端状态 | `src/stores/useBookTravelStore.ts` | scene、beat、turn、memory、save snapshot |
| 角色调度 | `src/pages/storyAgent.ts` | world/character prompt、`role_play` 历史表示 |
| 穿书后端 | `src-tauri/src/book_travel.rs` | 结构化模型、角色职责、流式任务、修复逻辑 |
| 长上下文 | `src-tauri/src/llm/mod.rs`、`src/utils/contextCompaction.ts` | compaction 触发、边界、摘要与 UI 投影 |
| 会话持久化 | `src-tauri/src/agent/sessions.rs`、`src-tauri/src/models.rs` | session record、archive、history |
| 角色工具 | `src-tauri/src/tools/registry.rs`、`src-tauri/src/agent/mod.rs` | 定向角色调用与工具事件 |
| 行为证据 | `src/__tests__/*book-travel*`、`context-compaction.test.ts`、`bond-character-tree.test.tsx` | 复核产品行为和边界 |

### 2.3 OAN 当前 Play 基线

本报告不能沿用旧参考报告中已经过时的缺口描述。当前事实是：

- 顶级 `Writing | Play` 已落地，Play 不再是 Writing 右侧 tab，见 `docs/PLAY_MODE_SPEC.md:9-30`。
- session v2 的七个文件、world clock、event policy、typed event、visibility、observation 与 adoption candidate 已落地，见 `packages/core/src/play-session.ts:9-200`。
- session 写入采用 sibling stage、ready marker 与 directory swap，见 `packages/core/src/play-session.ts:286-356`。
- world referee 必须返回最终 `oan-play-settlement`；正文与结构化 settlement 经协议解析后形成同一 next snapshot，当前会校验 settlement 结构、事件预算与 cause refs，但 state delta 仍是自由对象浅合并，见 `packages/core/src/play-session.ts:470-664`。
- backend 只给 referee read tools；带合法 path 的 activated source 会加载实际内容，最多 8 个、每个 8,000 字符；client 与顶级 Play UI 已接通真实 world-referee turn，见 `packages/backend/src/index.ts:1473-1518` 与 `docs/tasks/1120.md:14-28`。
- UI 已有 session rail、transcript、`say/look/move/do/wait` composer、World HUD、event feed、spoiler gate 和 adoption workflow。

当前权威缺口是 `docs/tasks/1120.md:30-40`：

- 还没有 provisional narrative stream、stop/cancel。
- 还没有 `turns/*.yaml` 结构化事实与 `transcript.md` 单向 projection。
- transaction 还缺 fsync、跨进程锁、逐故障点注入和长期残留 stage 清理。
- v1 首次升级还没有原始 snapshot 备份 / migration preview 与未知字段保留。
- 还没有 scheduled event、pressure、agenda、hard-due evaluator。
- checkpoint / variant / retry 还不能一起恢复 state、events、schedule、knowledge 与 selected transcript path。
- 还没有 context trace、omitted source、canonical drift / rebase / fork。
- session list 还没有拆成 summary + selected detail。
- 长 transcript / event feed 还没有窗口化。
- desktop UI 还没有独立测试 workspace。

MuseAI 的候选点必须在这些已实现事实和明确缺口之上增量设计。

## 3. MuseAI 的核心产品闭环

MuseAI 同时提供三个互动层级：

| 模式 | 作用 | 对 OAN 的意义 |
|---|---|---|
| 伴侣聊天 | 一个角色、世界书、长期关系与归档 | 角色连续性与关系复盘 |
| 文字冒险 | 一个世界、多个角色、说话/行为/剧情指令 | 多角色场景与即时 Play |
| 穿书互动 | 先装配小说素材，再选择入场点和身份 | 从已有小说进入可玩的世界 |

对 OAN 最有启发的是第三种，因为 OAN 本来就是 Novel IDE。MuseAI 证明了 Play 不必从空白 prompt 开始；小说的大纲、世界、角色和时间线可以先被整理成一个“可玩的入口”，而 Play 的结果又能回到角色关系、世界线总结和创作候选。

```text
Writing assets
  -> playable setup
  -> Play session
  -> scenes / beats / world changes
  -> memory / checkpoint
  -> outcome / relationship review
  -> adoption candidates
  -> Writing approval workflow
```

OAN 应吸收这条循环，但必须把 MuseAI 的“直接更新角色 store”改造成现有的 evidence-first adoption 链路。

## 4. 可吸收点候选清单

本节的 P0 / P1 / P2 只表示 MuseAI 候选之间的相对优先级，不高于 `docs/tasks/1120.md` 已冻结的 Remaining Review Scope。

### A1. Play Launch Package：先装配，再开局

优先级：High / P0

MuseAI 的素材页要求选择大纲、世界书和至少一个角色卡，先运行 material assembler，再运行 entry director，最后保存可复用的 assembled material：

- 两阶段装配流程：`reference-only/MuseAI/src/pages/BookTravelMaterials.tsx:661-760`。
- 装配世界模型包含原始时间线、核心冲突、可能结局、世界规则、地点、阵营、角色画像、关系提示和隐藏信息边界：`reference-only/MuseAI/src-tauri/src/book_travel.rs:35-45`。
- 前端 assembled material 保存 source materials、world model、stable/volatile memory、entry points 与推荐身份：`reference-only/MuseAI/src/stores/useBookTravelStore.ts:82-99`。

用户价值：

- 开局不再依赖用户手工把小说设定复制进一个大文本框。
- 同一组小说素材可以生成多个不同入口，而不必重复准备。
- “谁知道什么”“原始冲突是什么”“哪些地点和阵营活跃”在开局前就能检查。

OAN 当前创建表单只有标题、scene start、persona、角色文本、世界模式和事件密度，见 `apps/desktop-ui/src/components/play/PlaySessionCreateForm.vue:19-43`、`:54-89`。普通 UI 创建链也没有 source picker 与 activation preview。

OAN 化吸收方式：

- 新增可选的 `PlayLaunchPackage`，来源是当前章节、timeline anchor、world objects、character objects、state 和 active hooks。
- 产物必须保存 source id、path、hash、Git HEAD、选择理由和 omitted reason。
- 只保存可重建的派生摘要与 source refs，不复制大纲、角色卡、世界书全文形成第二事实源。
- 生成后先进入 preview，允许作者调整 entry、cast、目标、风险和 hidden knowledge boundary。
- Launch Package 属于 `.workspace` Play-local artifact，`canonical: false`。

第一版不必实现一个自由编排的“素材 Agent”。可以复用现有 context/source 选择器，以确定性 source collection 为主，再让模型补充可读的 setup projection。

### A2. 入场点与玩家身份向导

优先级：High / P0

MuseAI 的 entry setup 不是单一开场文本：

- entry point 包含时间地点、局势、初始目标和风险：`reference-only/MuseAI/src-tauri/src/book_travel.rs:56-63`。
- 推荐身份包含姓名、身份、背景、性格和目标：`reference-only/MuseAI/src-tauri/src/book_travel.rs:67-80`。
- 生成结果允许人工编辑，而不是直接启动：`reference-only/MuseAI/src/pages/BookTravelMaterials.tsx:918-1107`。
- 开局必须选择 entry point 与身份，再由 planner 生成第一场景：`reference-only/MuseAI/src/pages/Story.tsx:1211-1308`。

OAN 化吸收方式：

```text
Create Play
├── Quick Start
│   └── 保留现有自由输入
└── Guided Start
    ├── 选择 canonical 起点
    ├── 选择 / 生成 entry point
    ├── 选择既有角色、自定义临时身份或旁观者
    ├── 检查目标、风险、知识边界和 active cast
    └── 预览 activated / omitted sources 后创建 session
```

entry point 建议至少包含：

- `timeAnchor`
- `locationRef`
- `situation`
- `playerGoal`
- `initialRisk`
- `activeCharacterRefs`
- `knownFacts`
- `hiddenKnowledgePolicy`
- `sourceRefs`

这些字段是 Play-local launch contract，不自动反向修改小说对象。

### A3. 把输入意图与场景边界分开

优先级：High / P0-P1

MuseAI 先接收说话、行为、剧情推进三种输入，再将结果分成：

- `insert-beat`：继续当前场景，只生成一个新节拍。
- `change-scene`：规划新时间、地点、局势、角色和状态，再生成入口节拍。

证据：

- 输入分类模型：`reference-only/MuseAI/src-tauri/src/book_travel.rs:82-112`。
- 前端分类与分流：`reference-only/MuseAI/src/pages/Story.tsx:1360-1406`。
- scene writer 对两个 flow 的职责限制：`reference-only/MuseAI/src-tauri/src/book_travel.rs:273-303`。

这能解决一个常见 Play 问题：模型在一句普通对白后突然换地点、跳时间、开启新事件，或者玩家明确旅行后仍滞留在原场景。

OAN 已有 `say | look | move | do | wait`，它描述玩家意图；MuseAI 的分类描述叙事结构结果。两者不应合并。建议增加独立的 host-side scene boundary decision：

```text
player action kind
  + current scene
  + time / movement result
  + committed events
  -> continueScene | transitionScene
```

约束：

- 不把二分类器当成世界事件系统。
- 同一场景内仍可以发生天气变化、NPC 离场、证据转移或场外 faction event。
- `wait`、`move` 或 hard-due event 可以通过确定性规则直接要求 scene transition；只有模糊输入才需要模型判断。
- 分类结果应进入 turn trace，不能只存在组件状态。

### A4. 世界裁决、场景规划与叙事投影分权

优先级：High / P0

在 `change-scene` 路径中，MuseAI 的 ScenePlanner 拥有时间、地点、活跃角色、state changes、divergence、story progress、ending status、scene goals 和 writer instructions；SceneWriter 只产出一个 beat 与临时记忆 patch。`insert-beat` 则绕过 planner、直接调用 writer，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:95-142` 与 `reference-only/MuseAI/src/pages/Story.tsx:960-1127`。

其非流式 `write_book_travel_*` 路径会在 Rust repair 层剥离 writer 的 stable memory patch，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:1099-1145`。但当前 Story UI 实际使用流式命令：后端只抽取 JSON 文本，前端只读取 volatile patch，并未由 Rust 对该流式结果执行同一 repair，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:923-1045` 与 `reference-only/MuseAI/src/pages/Story.tsx:239-256`。所以这里体现的是一个值得强化的权限契约，而不是当前所有路径都已强制保证的边界：

```text
Planner / Referee owns what happened.
Narrator owns how it is expressed.
```

OAN 已有 narrative + structured settlement，但当前仍由同一个最终响应同时给出两者。可以渐进增强为：

```text
Player action
  -> host evaluates due events / rules
  -> world referee prepares structured resolution
  -> validate event causes, visibility, clock and state deltas
  -> narrator streams prose from the validated resolution
  -> validate final artifact
  -> atomic Play-local commit
```

这里的 planner、referee、narrator 是可观察 phase 或受限 prompt contract，不是三个常驻 Agent。仍复用现有单一 Aider-style runtime，并由 backend/core 的 Play 领域函数编排；不新建多 Agent coordinator。

### A5. Canon、Run-local state、角色知识与摘要记忆分层

优先级：High / P0-P1

MuseAI 明确区分 stable memory 与 volatile memory，并在素材准备时剥离角色卡中的用户关系、相处模式、底线和关键事件，避免某条聊天世界线污染新的穿书运行：

- stable / volatile 模型：`reference-only/MuseAI/src/stores/useBookTravelStore.ts:88-99`、`:122-146`。
- 穿书素材去除关系记忆：`reference-only/MuseAI/src/utils/bookTravelMaterials.ts:20-48`。
- 非流式 writer repair 会剥离 stable patch；当前流式 UI 只消费 volatile patch，不能把它误写成所有路径的强制校验：`reference-only/MuseAI/src-tauri/src/book_travel.rs:1099-1145`、`reference-only/MuseAI/src/pages/Story.tsx:239-256`。

OAN 已有 canonical / Play-local 大边界，但 Play-local 内部仍主要是自由形态 `Record<string, unknown>`。建议逐步明确四层：

```text
CanonicalBase
  - source refs / hashes / world contract
  - Play runtime read-only

PlayPremise
  - selected entry, player identity, initial risk, session steering
  - branch 内稳定，显式 rebase/fork 才改变

PlayMutableState
  - world clock, location, relationships, resources, knowledge, events
  - 只能由 validated settlement / reducer 修改

PlayMemoryProjection
  - summaries, unresolved hooks, relationship recap
  - 可重建缓存，不是新的事实源
```

角色 knowledge 必须独立于模型看见的完整 context。尤其 `playerUnknown` event、NPC 私有知识与作者 spoiler view 不能被一份统一 summary 泄漏。

### A6. 剧情专用上下文压缩与 Book Travel 摘要记忆

优先级：High / P1

MuseAI 这里有两套不同机制，不能混为一谈。

第一套是通用 Partner / Story Agent loop 的 compaction：

- token 接近上限可以触发通用压缩；用户回合数阈值只对 `partnerChat`、`storyAgent` 和 `storyDynamicAgent` 的专用 summary style 生效，见 `reference-only/MuseAI/src-tauri/src/llm/mod.rs:136-183`。
- 已有摘要会参与下一次增量压缩，并保存 compacted-through message id/index：`reference-only/MuseAI/src-tauri/src/llm/mod.rs:185-203`。
- 有效 prompt 使用“摘要 + 边界后原文”，原 session history 本身不因压缩被删除：`reference-only/MuseAI/src-tauri/src/llm/mod.rs:116-133`。
- Story Agent 摘要专门保留剧情进度、世界与 NPC 状态、关系变化、伏笔与悬念，并有对应 fallback：`reference-only/MuseAI/src-tauri/src/llm/mod.rs:289-310`、`:365-413`。

第二套是 Book Travel 自己的 `summaryMemory + recentScenes + recentTurns`：它不经过上述 Agent compaction loop，而是在结构化 request 中手工传入这些字段。Memory Keeper 只在 `change-scene` 完成后异步触发；`insert-beat` 路径不会更新 summary，见 `reference-only/MuseAI/src/pages/Story.tsx:936-1025`。因此值得吸收的是“剧情专用摘要结构与增量边界”，不是照搬其当前 Book Travel 更新时机。

OAN 化吸收方式：

- 在 session 保留期内，原始 `turns/*.yaml` 不因 compaction 删除；summary 只影响 context selection。
- summary 必须记录 `sourceTurnIds`、`compactedThroughTurnId`、session revision、生成配置和 stale 状态。
- 至少拆成 player-visible 与 referee-only 两个 projection，避免 hidden knowledge 泄漏。
- 结构化保留：当前场景、关键选择、world events、NPC/角色目标、关系变化、未解决冲突、active pressure/deadline、物品/证据位置、知识边界。
- summary 失败不影响已提交世界状态；它是可重新生成的 context artifact。

### A7. 显式 phase、provisional UI 与失败阶段重试

优先级：High / P0-P1

MuseAI 的 Book Travel 记录 `planner | writer | done | error | cancelled`、run id、planner output、writer output、error、startedAt 和 submitting 状态，见 `reference-only/MuseAI/src/stores/useBookTravelStore.ts:69-80`、`:430-466`。

用户提交后，行动立即进入 turn timeline，并有 `classifying | writing | done | error` 与 `failedStage`。如果 scene plan 已完成但 writer 失败，可以只重试 writer：

- turn snapshot：`reference-only/MuseAI/src/stores/useBookTravelStore.ts:46-58`。
- scene planning / writing phases：`reference-only/MuseAI/src/pages/Story.tsx:1029-1127`。
- writer-only retry：`reference-only/MuseAI/src/pages/Story.tsx:1130-1208`。
- 对应测试：`reference-only/MuseAI/src/__tests__/story-book-travel-mode.test.tsx:575-731`。

这个体验值得吸收，但实现不能照搬。MuseAI 会在 writer 成功前调用 `setCurrentState()` 和 `addScene()`，见 `reference-only/MuseAI/src/pages/Story.tsx:1050-1078`，因此 writer 失败可能留下“已换场但没有正文”的半回合。

OAN 应采用：

```text
received
  -> classified
  -> resolving
  -> planned (provisional, visible but not committed)
  -> narrating
  -> prepared
  -> committed

any running phase
  -> failed | cancelled
  -> no committed transcript/state/event mutation
```

- UI 可以先展示 provisional scene card，但必须明确标记未提交。
- narrator 失败只有在 turn 尚未提交、validated resolution 仍匹配同一 base revision 时，才可在该 resolution 上重试；已提交 turn 的 retry 必须从 before-turn checkpoint 生成 variant。
- 修改玩家输入后必须从 before-turn checkpoint fork 并重新裁决，不能复用旧 plan。
- retry 生成 variant，不物理删除旧 beat。
- runtime phase 与 recovery metadata 应落入 `.workspace`，不能只放在组件内存。

### A8. 命名保存、checkpoint 与 branch UX

优先级：Medium-High / P1

MuseAI 的保存进度包含完整 snapshot，并允许创建新记录或覆盖目标记录：

- snapshot 包含 source materials、world model、memory、entry、identity、state、scenes、turns、summary、ending、input mode 与初始 prompt snapshot：`reference-only/MuseAI/src/stores/useBookTravelStore.ts:107-146`。
- create / overwrite / load：`reference-only/MuseAI/src/stores/useBookTravelStore.ts:373-421`。
- Save Choice UX：`reference-only/MuseAI/src/components/SaveChoiceModal.tsx:134-210`。

OAN 不应复制“覆盖 JSON snapshot”，但可以吸收显式的用户心智：

- `Save checkpoint`：给当前已提交世界命名。
- `Fork from here`：从当前 turn 创建有 parent reference 的分支。
- `Retry as variant`：从同一个 before-turn checkpoint 生成并保留多个候选。
- SessionRail 可按 source world、角色、entry、状态和更新时间筛选。
- checkpoint 必须覆盖 transcript path、state、events、schedule、pressure、agenda、knowledge、summary 与 source refs。

默认行为应是创建 checkpoint / branch；覆盖和删除必须显式确认并可恢复。

### A9. 世界线结束报告与创作回流

优先级：Medium / P1-P2

MuseAI 的 Ending Judge 返回：

- final ending
- user key choices
- original outline comparison
- character outcomes
- worldline name
- divergence score

数据模型见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:153-162`，调用条件与流程见 `reference-only/MuseAI/src/pages/Story.tsx:936-955`。

这是 Novel IDE 特别有价值的闭环，但 MuseAI 当前 UI 主要只在结束后隐藏 composer，并没有完整展示这些字段。OAN 可以把它做成真正的 `PlayOutcomeReport`：

```text
PlayOutcomeReport
  - session / branch / canonical base refs
  - final worldline summary
  - key player choices
  - major world events
  - character outcomes and relationship changes
  - divergence from canonical base
  - unresolved hooks
  - suggested adoption candidate ids
```

`divergence` 默认使用可解释的定性说明，不强制所有类型使用数值分数。报告本身是 Play-local projection，只有用户选择的条目进入 PendingAction。

### A10. 按角色聚合的关系复盘与 Play 足迹

优先级：Medium-High / P1

MuseAI 在会话结束时分析关系类型、相处模式、关系底线和关键事件，先让用户编辑，再确认归档：

- 单角色 Chat archive：`reference-only/MuseAI/src/pages/Chat.tsx:875-958`。
- 多角色 Adventure 并行分析与逐角色编辑：`reference-only/MuseAI/src/pages/Adventure.tsx:1018-1152`。
- Bond 页面展示关系概览、羁绊时间线、会话足迹和冒险足迹：`reference-only/MuseAI/src/pages/Bond.tsx:80-173`、`:263-345`、`:418-505`。

OAN 化吸收方式：

- 每个 scene/session 结束时可生成按角色分组的 observation candidates。
- 字段包括关系变化、角色目标变化、关键共同事件、承诺/冲突、角色已知信息、未解决问题。
- 每一条都必须携带 source turn/event refs、visibility、confidence/uncertainty 和 canonical base hash。
- 角色详情可以增加“Play 足迹”投影，从角色反查参与过的 session、scene 和 event。
- 不新增一份无来源的字符串 timeline；直接从结构化 observation/world event 投影。
- 不直接更新 canonical character file，仍走 adoption → PendingAction → diff → approval。

### A11. 角色发言成为一等 transcript block

优先级：Medium / P1

MuseAI 的 dynamic role 模式允许主叙事调用 `role_play(characterName)`，再把结果显示成角色内容，而不是普通工具日志：

- 可用角色与 tool contract：`reference-only/MuseAI/src/pages/storyAgent.ts:91-105`、`:124-136`。
- backend 精确解析目标角色并构造目标角色 prompt：`reference-only/MuseAI/src-tauri/src/agent/mod.rs:959-1043`。
- 内部 thinking/tool marker 会从角色历史中清理：`reference-only/MuseAI/src-tauri/src/agent/mod.rs:1044-1082`。

OAN 当前最终 narrative 落盘 speaker 仍是统一的 `world-referee`。可以吸收为结构化 narrative blocks：

```text
NarrativeBlock
  - kind: narrator | characterSpeech | characterAction | systemNotice
  - speakerRef?: character id
  - content
  - sourceEventIds
  - visibility
```

要求：

- speaker 使用稳定 character ref，不按显示名唯一匹配。
- 只向角色 voice module 提供该角色允许知道的 state / events。
- narrator、角色气泡、world event 和诊断信息有不同展示层。
- 内部 tool 名、prompt 和 provider reasoning 不进入小说式 transcript。

不应照搬 MuseAI 的第二次非流式角色 LLM 调用或强制“任何可能都必须调用 role_play”。第一版仍可由单 world referee 在一个受控结果中生成带 speaker id 的 blocks。

### A12. 建议行动只填草稿，不替玩家决定

优先级：Confirmed Direction

MuseAI 的 suggested choices 点击后只填入 composer，不自动提交。OAN 当前 `PlayComposer.vue` 也只把 suggestion 的 action kind 和 text 写入输入状态，见 `apps/desktop-ui/src/components/play/PlayComposer.vue:42-49`。

这不是新缺口，而是应继续保持的玩家主权原则：

- suggestion 明确标注为建议。
- 点击后允许修改。
- 不自动推进世界或生成事实。
- suggestion 的 visibility 与 source event 必须可解释。

## 5. MuseAI 对“外部世界变化”的真实贡献与边界

MuseAI 已有 scene state、time、location、active characters、state changes、volatile memory 和 ending status，但它没有一等公民的 world event model：

- `stateChanges`、`volatileMemoryPatch` 和 `currentState` 仍是自由 JSON / `unknown`，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:95-142` 与 `reference-only/MuseAI/src/stores/useBookTravelStore.ts:122-146`。
- 世界变化主要由玩家提交动作触发。
- `insert-beat | change-scene` 与自由 JSON patch 没有为 scheduled event、pressure、agenda、offscreen event、reveal、rumor、cause chain 或 event visibility 提供一等、可验证、可调度和可追踪的结构化表达；模型即使临时写入同类语义，宿主也无法可靠执行。
- state patch 主要做浅合并，没有 event reducer、inverse、source event id 或 deterministic evaluator。

所以 MuseAI 不能替代 `docs/PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md`。它真正补充的是：

| OAN 世界事件底座 | MuseAI 可补充的体验 |
|---|---|
| typed event / cause / visibility | scene card、scene goals、active cast 的可读呈现 |
| world clock / event policy | entry point 中的时间、地点、目标和风险 |
| structured settlement | resolution 与 narrative 的阶段可见性 |
| staged snapshot commit | planner 成功、narrator 失败时的局部 retry UX |
| observation / adoption | 按角色复盘、worldline report、Play 足迹 |
| planned schedule / pressure / agenda | scene boundary 与 unresolved hooks 的上下文输入 |

推荐组合是：

```text
OAN event evaluator decides what is due or eligible
  + world referee prepares a valid resolution
  + scene planner projects the next playable situation
  + narrator renders the validated resolution into prose
```

不是：

```text
LLM returns arbitrary stateChanges
  -> shallow merge
  -> infer afterwards what happened
```

## 6. 推荐的 OAN 化领域形态

以下是分析候选，不是已经冻结的 stable spec。

### 6.1 可重用 Play Setup Artifact

```text
.workspace/play-setups/<setup-id>/
  setup.yaml
  source-map.yaml
  entry-points.yaml
  player-roles.yaml
  diagnostics.yaml
```

建议规则：

- `setup.yaml` 只保存 assembled projection、source refs 和配置快照。
- `source-map.yaml` 记录 path、hash、Git HEAD、trust、included/omitted reason。
- `entry-points.yaml` 和 `player-roles.yaml` 可人工编辑，但仍是 Play-local。
- canonical source 变化时标记 stale，允许 rebuild / fork，不静默混入。
- 不复制完整章节、世界对象或角色对象作为 setup truth。

### 6.2 对现有 session 的候选扩展

在现有七文件 session 布局上保留全部既有 artifact，并在 `docs/tasks/1120.md` 已规划的 turn/checkpoint 基础上追加候选。完整示意如下：

```text
.workspace/play-sessions/<session-id>/
  session.yaml
  transcript.md
  play-local-state.yaml
  activated-sources.yaml
  events.yaml
  observations.yaml
  adoption-candidates.yaml
  turns/<turn-id>.yaml
  scenes/<scene-id>.yaml
  memories/<revision>.yaml
  checkpoints/<checkpoint-id>.yaml
  traces/<turn-id>.context.yaml
  outcome-report.md
```

事实边界：

- `turns/*.yaml` 是结构化回合事实。
- `scenes/*.yaml` 是从已提交 turn/event 形成的 Play scene artifact，不是 canonical scene。
- `memories/*.yaml` 是带 source refs 的可重建摘要。
- `transcript.md` 和 `outcome-report.md` 是 projection。
- `events.yaml` 与 `play-local-state.yaml` 继续承担事件证据与当前 snapshot，不演变成重型 event sourcing。

### 6.3 推荐 turn state machine

```text
received
  -> classified
  -> resolution_preparing
  -> resolution_validated
  -> narration_streaming
  -> prepared
  -> committed

received .. prepared
  -> failed | cancelled
  -> session revision unchanged

committed
  -> retry from before-turn checkpoint
  -> new variant, old artifact retained
```

阶段事件可映射到已有规划：

- `play.turn.started`
- `play.context.ready`
- `play.turn.resolution.prepared`
- `play.scene.provisional`
- `play.narrative.delta`
- `play.turn.prepared`
- `play.turn.committed`
- `play.turn.failed`
- `play.turn.cancelled`

任何 provisional event 或 scene 都必须显式标记，不能冒充已经发生的 Play-local truth。

### 6.4 推荐 Play memory schema

```yaml
revision: 12
compactedThroughTurnId: turn-008
sourceTurnIds:
  - turn-001
  - turn-008
playerVisible:
  currentScene: "..."
  keyChoices: []
  relationshipChanges: []
  unresolvedHooks: []
  activeDeadlines: []
refereeOnly:
  hiddenEvents: []
  npcKnowledge: {}
  unrevealedConsequences: []
generatedFrom:
  modelProfile: "play-memory"
  sourceRevision: 12
stale: false
```

这里的 `refereeOnly` 不能进入玩家 transcript、suggested action 或默认 HUD。

## 7. 吸收矩阵

| MuseAI 能力 | OAN 当前状态 | OAN 化候选 | 优先级 | 不吸收部分 |
|---|---|---|---|---|
| 素材装配 | UI 创建仍偏手填 | Play Launch Package + source map | P0 | 复制全文到隐藏 JSON store |
| 入场点 / 推荐身份 | 只有自由 scene/persona | Guided Start + Quick Start | P0 | AI 结果直接启动，不经预览 |
| insert-beat / change-scene | 有 action kind，无 scene boundary | 独立 scene boundary trace | P0-P1 | 用二分类替代事件系统 |
| Planner / Writer 分权 | narrative + settlement 同响应 | validated resolution → narrative projection | P0 | 多常驻 Agent coordinator |
| stable / volatile memory | canonical / Play-local 已分离，local 内部仍松散 | premise / mutable state / knowledge / summary | P0-P1 | 任意 `unknown` patch |
| planner/writer stream phases | 当前 world turn 一次性响应 | provisional stream + stop/cancel + phase UI | P0 | 前端内存作为 recovery truth |
| stage retry | 尚无 variant/checkpoint | before-turn checkpoint + narrator-only retry | P1 | 删除旧 beat 后覆盖 |
| context compaction | 计划中，尚无 manager | source-aware、visibility-aware memory artifact | P1 | 只靠散文 summary |
| save create/overwrite | checkpoint/variant 尚未完成 | named checkpoint / fork / variant | P1 | 默认覆盖、不可恢复删除 |
| Bond / archive | 已有 observation/adoption，无角色聚合 | character Play footprint + review projection | P1 | 直接更新角色文件 |
| role_play | speaker 仍统一为 referee | structured narrative blocks + stable speaker refs | P1 | 二次非流式角色调用成为默认 |
| ending judge | 无 session closure report | PlayOutcomeReport + adoption suggestions | P1-P2 | 强制数值化 divergence |
| LAN mobile UI | 当前桌面优先 | 后续响应式/远程入口评估 | P2 | 为此改变核心存储和安全边界 |

## 8. 建议实施顺序

实施顺序分为两层：先收口既有 `1120`，再排 MuseAI 净新增能力。前文候选的 P0 不会越过这一前置关系。

### 8.1 `1120` 前置收口

1. 把请求/响应式 turn 升级为 provisional narrative stream，并支持 stop / cancel。
2. 建立 `turns/*.yaml` 结构化事实与 `transcript.md` 单向 projection，消除 transcript 双表示。
3. 为 staged directory swap 补齐 fsync、跨进程锁、逐故障点注入和长期残留 stage 清理。
4. 为 v1 首次升级增加原始 snapshot 备份 / migration preview，并保留未知字段。
5. 实现 scheduled event、pressure、agenda、hard-due evaluator 与更严格的 event/state delta 引用。
6. 实现 checkpoint / variant / retry，对 state、events、schedule、knowledge 和 selected transcript path 一起恢复。
7. 增加 context trace、omitted source 与 canonical source drift / rebase / fork。
8. 将 session list 拆成 summary + selected detail，并为长 transcript / event feed 增加窗口化。
9. 建立根目录 `__test__/desktop-ui` 测试 workspace。

### 8.2 MuseAI P0：改善开局与场景边界

1. 新增 Play Launch Package 与 Guided Start：canonical source picker、entry point、player identity、goal/risk、activation preview。
2. 把 structured resolution 与 narrative projection 分权，但仍保持单 world referee runtime。
3. 为当前场景增加 scene id、目标、active cast 与 boundary trace。
4. Play-local state 增加受控模块或 typed paths，避免任意浅合并继续扩大。

### 8.3 MuseAI P1：长线记忆与复盘

1. 在 `1120` checkpoint / variant 基础上提供 named checkpoint、fork 与 retry-as-variant UX。
2. 增加 visibility-aware context compaction 和 memory artifacts。
3. SessionRail 增加 source/character/entry/status 过滤。
4. transcript 支持 narrator / character / event / system block，speaker 使用稳定 ref。
5. session close 生成 PlayOutcomeReport。
6. 增加按角色分组的 observation review 与 Play footprint。

### 8.4 MuseAI P2：沉浸与跨设备增强

1. 响应式 Play layout 与可选局域网/移动端入口评估。
2. 可选视觉、头像、TTS attachment；它们不进入 canonical truth。
3. Play Setup 的版本升级、stale 检测和 rebuild UX。
4. 不同阶段的 model profile 只在确有质量/成本收益时暴露；不要复制七套 Agent 设置面板。

## 9. 明确不建议照搬

### 9.1 Zustand JSON 作为主要事实源

MuseAI 用 `createDiskStorage()` 把 Zustand state 保存到 app state JSON，并从 localStorage 迁移，见 `reference-only/MuseAI/src/stores/diskStorage.ts:4-35`。Book Travel 只 partialize assembled materials 与 saved progresses，见 `reference-only/MuseAI/src/stores/useBookTravelStore.ts:468-475`。

OAN 应继续使用 Markdown/YAML/Object File Tree 与 Git 可解释的 artifacts。组件 store 只能是 UI projection。

### 9.2 直接把归档结果写回角色卡

MuseAI 确认归档后直接 `updateItemFields()`，见 `reference-only/MuseAI/src/pages/Chat.tsx:930-958` 与 `reference-only/MuseAI/src/pages/Adventure.tsx:1121-1152`。

可以吸收“先分析、允许编辑、再确认”的 UX，但 OAN 必须生成 adoption candidate 和 PendingAction，不能直接写 canonical character objects。

### 9.3 七种角色等同于七个 Agent

MuseAI 定义 MaterialAssembler、EntryDirector、InputClassifier、ScenePlanner、SceneWriter、MemoryKeeper、EndingJudge，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:164-174`。

这是职责分离，不是 OAN 引入重型多 Agent runtime 的理由。OAN 应把它们折叠成少量 phase、纯函数 validator、domain reducer 和可选 model profile。

### 9.4 规划结果先写状态、正文以后补

MuseAI 在 writer 完成前已更新 current state 并加入 scene，见 `reference-only/MuseAI/src/pages/Story.tsx:1050-1078`。这对即时反馈有好处，但不满足 OAN “无半回合”的 done criteria。

OAN 只能把 plan 作为 provisional artifact 展示，最终仍一次提交 transcript、state、events、observation 与 scene projection。

### 9.5 破坏式 retry 与默认覆盖

MuseAI 重试已完成 turn 时会先移除当前 scene 的最后 beat，见 `reference-only/MuseAI/src/pages/Story.tsx:1130-1147`。保存 UX 也支持覆盖旧进度。

OAN 应以 variant/fork 为默认；编辑玩家输入后从原 before-turn checkpoint 重新裁决，而不是复用旧 planner output 或删除旧证据。

### 9.6 任意 JSON patch 代替世界事件

MuseAI 的 `currentState`、`stateChanges` 和 memory patch 大量使用 `Value/unknown`，前后端模型也存在 `beat` 与 `beats[]` 等漂移。

OAN 继续保持 `WorldEvent` 的 kind、origin、cause、visibility、world clock、turn id 和 sequence，并让 state reducer 只接受可验证 delta。

### 9.7 名为 previous state、实际不恢复

`parse_book_travel_json()` 接收 previous state，但参数名是 `_previous` 且没有使用，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:205-211`。不能把这个接口误读为真正 rollback 或 repair。

### 9.8 从字符串头部粗暴截断 prompt

MuseAI 的 prompt 顺序是 materials → state → current task，但超限时直接保留字符串前 N 个字符，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:306-380`。这可能恰好丢掉当前状态和用户输入。

OAN 必须用 budget layer：永远保护当前 action、world clock、due events、current state 和 recent turns，再按 relevance 选择/压缩 canonical source，并记录 omitted reason。

### 9.9 后台 summary 竞态

MuseAI 在场景完成后异步触发 Memory Keeper，但主流程不等待，失败只记 console，见 `reference-only/MuseAI/src/pages/Story.tsx:948-954`。下一回合可能读取旧 summary。

OAN 的 reducer/state commit 必须同步完成；summary 是带 source revision 的异步 projection，stale 时可识别和重建。

### 9.10 流式 run 注册竞态

MuseAI 的全局 listener 在既没有 active run id、也没有 resolver 时直接丢弃事件；而 `runId` 与 resolver 只有在 Tauri `invoke` 返回后才注册，见 `reference-only/MuseAI/src/pages/Story.tsx:285-335`。后端启动异步任务后即可发送 delta / done，见 `reference-only/MuseAI/src-tauri/src/book_travel.rs:923-1045`，因此快速完成时存在丢失 done、Promise 悬挂的竞态窗口。

OAN 的 provisional stream 应先建立订阅与 pending turn，或采用“注册完成 → 后端开始”的握手协议；stop / cancel、断线恢复与 terminal event 还应具有幂等状态转换。

### 9.11 巨型页面、重复类型与内部 reasoning 展示

`Adventure.tsx`、`Story.tsx` 和 `agent/sessions.rs` 集中了过多运行时、持久化、UI 与业务职责。MuseAI 也把 thinking/tool 事件作为通用 UI 数据。

OAN 不应复制巨型组件或 Rust/TypeScript 双份漂移 schema，也不保存或展示 provider 私有 reasoning。Play UI 只展示可解释的结构化 reason、event cause、source trace 和 validation result。

## 10. 风险与控制

| 风险 | MuseAI 暴露的问题 | OAN 控制方式 |
|---|---|---|
| 开局包成为第二事实源 | assembled material 复制 source 内容 | refs + hashes + stale/rebuild，不复制 canonical 全文 |
| 多阶段增加延迟与成本 | classifier/planner/writer/keeper 多次调用 | host rule 优先、phase 合并、按需 profile |
| 规划与叙事不一致 | plan 先写状态，writer 后失败 | validated draft + 单一 snapshot commit；继续补齐 durability |
| 流式 terminal event 丢失 | run/resolver 晚于后端任务启动注册 | 先订阅/注册或握手后启动，terminal event 幂等 |
| hidden knowledge 泄漏 | 单一 summary / 完整世界模型进入 prompt | player/referee projection 与 knowledge boundary |
| 角色串台 | 名称匹配、所有卡仍进主 prompt | stable character refs + selective activated source |
| 长线摘要漂移 | summary 异步更新 | source revision、stale flag、可重建 projection |
| retry 改写历史 | 删除最后 beat 再生成 | before-turn checkpoint + immutable variants |
| 关系结果污染 canon | archive 直接更新角色卡 | observation → candidate → PendingAction |
| 参考许可证不明 | 本地无许可证证据 | 只学模式、独立实现、独立 prompt |

## 11. 建议后续任务候选

本文只提出候选，不直接创建或更改 task 状态。

### 候选 1：Play Guided Start And Launch Package

范围：

- canonical source picker
- reusable Play-local setup artifact
- entry points / player roles
- activation preview / omitted diagnostics
- source hash 与 stale detection

### 候选 2：Play Scene Artifact And Narrative Phases

范围：

- scene boundary decision
- scene goals / active cast / current situation
- structured resolution 与 narrative projection 分权
- provisional scene UI
- narrator-only retry on an uncommitted validated resolution at the same base revision

### 候选 3：Play Memory, Checkpoint And Outcome Report

范围：

- visibility-aware compaction
- named checkpoint / branch / variant
- source revision / runtime profile snapshot
- PlayOutcomeReport
- character Play footprint / grouped adoption review

这些候选应先与 `docs/tasks/1120.md` 剩余范围去重：已经位于其 Remaining Review Scope 内的能力继续由 `1120` 收口；Launch Package、Guided Start、scene artifact、Outcome Report 等净新增能力在用户确认后建立独立 Planned task，不静默扩展 `1120`。

## 12. 最终判断

MuseAI 证明了一件对 OAN 很重要的产品事实：Play 的价值不只来自“模型会扮演角色”，而来自作者能把已有小说资产装配成一个可进入的世界，选择自己从哪里、以谁的身份进入，然后持续经历场景、关系与世界线变化，并在结束时把真正有价值的部分带回写作。

OAN 已经比 MuseAI 更接近一个可信的世界事件内核。下一步不应把 MuseAI 的 JSON store、七角色调用链或直接角色卡更新搬进来，而应把它的产品闭环嫁接到现有底座：

```text
filesystem-first Play setup
  + guided entry
  + typed world events
  + scene-aware turn phases
  + validated single-snapshot Play-local commit
  + source-aware memory
  + checkpoint / variant
  + character / worldline review
  + PendingAction adoption
```

最优先的 MuseAI 增量是“Play Launch Package + 入场向导 + scene artifact”。最重要的实现约束是：所有快速反馈都可以 provisional，只有通过验证并完成单一 snapshot 提交的 turn 才算 Play-local truth；所有回流写作的结果都必须继续经过 Human Approval。

## 13. 参考文件

### OAN

- `docs/PLAY_MODE_SPEC.md`
- `docs/PLAY_MODE_WORLD_EVENTS_UPGRADE_PLAN.md`
- `docs/tasks/1090.md`
- `docs/tasks/1120.md`
- `docs/OPENTAVERN_PLAY_MODE_REFERENCE_ANALYSIS.md`
- `docs/SILLYTAVERN_REFERENCE_LESSONS.md`
- `docs/INKOS_REFERENCE_LESSONS.md`
- `packages/core/src/play-session.ts`
- `packages/backend/src/index.ts`
- `packages/client/src/index.ts`
- `apps/desktop-ui/src/components/play/PlaySessionCreateForm.vue`
- `apps/desktop-ui/src/components/play/PlayComposer.vue`
- `apps/desktop-ui/src/components/play/PlayWorkspace.vue`
- `apps/desktop-ui/src/composables/usePlayWorkspace.ts`

### MuseAI

- `reference-only/MuseAI/README.md`
- `reference-only/MuseAI/PRODUCT.md`
- `reference-only/MuseAI/package.json`
- `reference-only/MuseAI/src/pages/BookTravelMaterials.tsx`
- `reference-only/MuseAI/src/pages/Story.tsx`
- `reference-only/MuseAI/src/pages/Adventure.tsx`
- `reference-only/MuseAI/src/pages/Chat.tsx`
- `reference-only/MuseAI/src/pages/Bond.tsx`
- `reference-only/MuseAI/src/pages/storyAgent.ts`
- `reference-only/MuseAI/src/components/SaveChoiceModal.tsx`
- `reference-only/MuseAI/src/stores/useBookTravelStore.ts`
- `reference-only/MuseAI/src/stores/diskStorage.ts`
- `reference-only/MuseAI/src/utils/bookTravelMaterials.ts`
- `reference-only/MuseAI/src/utils/contextCompaction.ts`
- `reference-only/MuseAI/src-tauri/src/book_travel.rs`
- `reference-only/MuseAI/src-tauri/src/models.rs`
- `reference-only/MuseAI/src-tauri/src/llm/mod.rs`
- `reference-only/MuseAI/src-tauri/src/agent/mod.rs`
- `reference-only/MuseAI/src-tauri/src/agent/sessions.rs`
- `reference-only/MuseAI/src-tauri/src/tools/registry.rs`
- `reference-only/MuseAI/src/__tests__/book-travel-store.test.ts`
- `reference-only/MuseAI/src/__tests__/book-travel-materials.test.ts`
- `reference-only/MuseAI/src/__tests__/book-travel-materials-page.test.tsx`
- `reference-only/MuseAI/src/__tests__/story-book-travel-mode.test.tsx`
- `reference-only/MuseAI/src/__tests__/context-compaction.test.ts`
- `reference-only/MuseAI/src/__tests__/bond-character-tree.test.tsx`
