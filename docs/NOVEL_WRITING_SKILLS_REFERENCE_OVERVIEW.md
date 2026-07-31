# Novel Writing Skills 参考项目现状分析

> 范围：本文合并分析 `reference-only/awesome-novel-skill`、`reference-only/novel-writer-skills`、`reference-only/oh-awesome-novel-skill`、`reference-only/oh-story-claudecode` 当前本地内容。
>
> 目的：这些参考项目更接近“写作 Skill、Agent 指引或写作工作台”，不是 OAN 的目标架构。本文关注它们如何组织写前读取、规划产物、正文上下文、写后结算、审稿与去 AI 味，以及当前版本相对上一轮发生了什么变化。
>
> 分析日期：2026-08-01。三个独立 Git 仓库的当前分支均已与各自 upstream 对齐；单文件 `oh-awesome-novel-skill` 没有独立 Git 历史，本文记录文件指纹以供后续比较。

## 基准信息

| 项目 | 当前基准 | 上一版文档基准 | 许可证观察 |
| --- | --- | --- | --- |
| `awesome-novel-skill` | `main@b9af6835`，与 upstream 一致；发行版本 `v4.8.4`，`git describe` 为 `v4.8.4-1-gb9af683` | `d4891c6`，2026-06-17 | 仓库 `LICENSE` 与集中声明为 GPL-3.0；README 另有商业使用联系说明，代码级复用需单独审查 |
| `novel-writer-skills` | `main@5bc9b373`，与 upstream 一致；npm 版本 `1.1.1` | `5bc9b37` | MIT |
| `oh-awesome-novel-skill` | 单文件 `SKILL.md`，147 行；SHA-256 `26d04c20164231c5ca5852959670da3eb557eb9b29e2c9efc09cb0582694c4d2` | 未记录文件指纹 | 未发现独立 Git 或许可证文件 |
| `oh-story-claudecode` | `main@8aaa701a`，与 upstream 一致；发行版本 `v0.7.2`，`git describe` 为 `v0.7.2-1-g8aaa701` | `ef8ae1e`，2026-06-14，v0.6.16 | MIT |

版本号需要区分不同层次：

- `awesome-novel-skill` 的发行版本是 v4.8.4，但其小说工程 schema 仍以 `skill_version = 4.0` 判断迁移。
- `oh-story-claudecode` bundle 是 v0.7.2，各 `SKILL.md` 自身仍可声明 `version: 1.0.0`，已部署 Agent 模板的新鲜度则由 `agents_version = 21` 判断。
- `novel-writer-skills` 的最近 Git tag 落后于 `package.json`；应用版本应以当前 package 的 `1.1.1` 为准。

## 相对上一版的变化规模

### awesome-novel-skill

从 `d4891c6` 到 `b9af6835`：

- 47 个提交。
- 34 个文件变化。
- 约 1,456 行新增、253 行删除。
- 版本从 v4.5.4 推进到 v4.6.0、v4.7.0、v4.8.0、v4.8.1、v4.8.2、v4.8.3 和 v4.8.4。

主要变化：

- 完善 scene-craft 方法论与 prompt 规则冲突优先级。
- 将早期偏“冷、硬、碎、极简”的文风规则修正为更流畅、有叙事温度的网文基线。
- 新增独立的角色推演沙盘。
- 新增 OpenCode 安装、Agent 部署和 `AGENTS.md` 支持。
- 修正 prompt-crafter 审计重复读取大知识库导致的上下文浪费。

### novel-writer-skills

当前仍是上一版记录的 `5bc9b373`，没有新增提交。原有结论仍成立，但本轮补充了一个重要限定：README 中的“自动激活、后台监控”主要是 Skill 指令语义，不是一个独立运行时守护程序；实际权限来自生成到项目中的 command / Skill frontmatter，并且 `/write` 仍拥有直接 `Write` 和宽泛 `Bash(*)` 权限。

### oh-awesome-novel-skill

该目录仍只有一个轻量 `SKILL.md`，没有版本历史可用于可靠增量比较。本轮以文件指纹固定当前快照。其单 Agent、低摩擦、作者接受后再更新记忆的设计仍成立，但它仍是直接写文件的通用 Agent 指引，没有 OAN 的 SemanticPatch、PendingAction 或 Git approval。

### oh-story-claudecode

从 `ef8ae1e` 到 `8aaa701a`：

- 72 个提交。
- 534 个文件变化。
- 约 47,685 行新增、8,659 行删除；其中大量变化来自真实 demo、跨平台模板和重复部署资产，不能简单理解为核心 Skill 增加了同等规模的逻辑。
- 版本经过 v0.6.17–v0.6.22、v0.7.0、v0.7.1 到 v0.7.2。

主要变化：

- 从 Claude Code / OpenClaw Skill 集扩展为 Claude Code、OpenCode、Codex、ZCode、OpenClaw、Reasonix 和 generic Agent 的多端分发系统。
- 13 个 Skill 之外，增加 7 个可部署专业 Agent、跨端 Hook、adapter、contract / parity 检查和版本迁移规则。
- 长篇拆文的“剧情条、循环卡、剧情段”等概念统一为“剧情单元”，并接入卷纲与细纲。
- 新增 32 个长篇题材 prose card、更多短篇题材包和投稿层。
- 去 AI 味从纯 prompt 检查扩展为确定性毒句式 lint、写后扫描和下一章前欠账门。
- 连续修正“碎句、电报体、解释腔、章尾总结体”等由旧规则自身诱发的问题。
- 新增本地 Story Dashboard，支持浏览、搜索、预览、轻量编辑和删除。
- 增加真实 demo 驱动的 Dashboard API 与 Playwright E2E。

## 总体结论

四个项目当前形成的谱系比上一版更清楚：

```text
awesome-novel-skill
  文件状态驱动的 1 个总指挥 + 7 个专职 Agent
  + 强制阶段交接 + prompt 工程 + 新增角色推演沙盘

novel-writer-skills
  Claude Code slash commands
  + spec-kit 式七步流程 + JSON tracking + 静态 Skill 指引

oh-awesome-novel-skill
  单文件、单 Agent、低摩擦的读前写后纪律

oh-story-claudecode
  13 个 Skill + 7 个专业 Agent + Hooks + Scripts + Dashboard
  组成的跨平台商业网文生产工作台
```

它们共同验证了几条稳定规律：

- 正文生成之前需要明确的本章目标和可检查的上下文边界。
- 长篇续写不能依赖聊天记忆，必须从文件恢复角色、事件、伏笔和近期进度。
- 写后状态只能来自已接受正文中的证据，不能把大纲计划提前写成事实。
- 规划需要给正文足够方向，但不能让细纲的句子形状直接决定正文形状。
- 审稿、去 AI 味、拆文和对标适合成为显式能力，不适合成为无条件后台自动链路。

它们也共同暴露了 OAN 不应继承的问题：

- Skill 直接拥有 Write、Bash、Hook 安装和项目迁移权限。
- “作者确认流程”常常等于 Agent 继续直接落盘，而不是批准具体 diff。
- 为跨平台复制 Agent、Hook、reference 和 adapter，产生庞大的同步与版本漂移面。
- 固定语言比例、禁词和检测器目标容易反过来制造新的机械文风。
- 多 Agent 和自动检查的产品叙述，不一定等于运行时有严格、可验证的隔离与事务。

## awesome-novel-skill 当前现状

### 当前定位

`awesome-novel-skill` 仍是四者中阶段与职责最刚性的写作工程。当前目录有 8 个具名角色 Agent 加一个共享 `novel-base`：

- `novel-agent`：唯一总指挥。
- `volume-planner`、`chapter-planner`、`prompt-crafter`、`writer`、`anti-ai`、`reader`、`updater`：7 个专职子 Agent。
- `novel-base`：共享基础定义，不是独立工作角色。

它通过 `.agent/task/*-order.md` 交接：总指挥写 order，调用专职 Agent，专职 Agent 读取 order、直接修改对应文件、清理 order，总指挥再推进状态。

### 当前写作链路

```text
状态检测 / 初始化 / 迁移
  → novel-agent 讨论设定
  → updater 写设定
  → volume-planner
  → chapter-planner
  → prompt-crafter
  → writer 写 draft
  → anti-ai
  → reader（可选）
  → 作者确认
  → updater 归档与 lore-keeping
```

当前项目仍以这些文件恢复流程：

- `story.md`：项目索引与主线。
- `settings/`：世界、题材、角色、文风、时间线与伏笔。
- `volumes/`、`chapters/`、`prompts/`、`archives/`：卷纲、章纲、Writer prompt 与正文。
- `.agent/status.md` 与 order 文件：工作流状态。
- `.claude/knowledge`、`.claude/memory`：方法论、永久记忆和动态偏好。
- `sandbox/`：可选剧情推演记录。

### v4.7 / v4.8 新增价值

#### 1. Prompt 冲突优先级显式化

新版 prompt-crafting 不再把所有规则平铺给 Writer 决策，而是定义大致优先级：情节与角色红线、字数与压缩、词句约束、感官规则、叙事规则、普通写作建议。Prompt Audit 新增冲突裁定检查，并避免审计阶段再次读取完整 scene-craft 知识库。

可学习的是“Prompt 必须说明冲突时谁让步”，而不是具体优先级文本。OAN 应把 constitution、用户本轮意图、Canon、Writing Profile reminder 和普通 style hint 的来源及优先级放进 trace；不能复制 GPL prompt。

#### 2. 修正过度极简导致的文风副作用

新版把“禁止认知动词”“不解释因果”“冷白描”等绝对规则放宽为密度控制和情境选择，允许必要心理概括、因果承接与叙事温度。这个演化本身比某条新规则更有价值：静态反 AI 处方会过拟合，必须用实际正文回归检查副作用。

#### 3. 角色推演沙盘

新增 `skills/roleplay-sandbox.md`，其运行方式是：

1. 读取卷纲、角色认知层、最近状态、前章结尾和活跃钩子。
2. 由作者确认场景、出场顺序和推演目标。
3. 角色串行行动，每个角色输出后作者可接受、修改、重来、插队、补信息或终止。
4. 每步更新临时场景状态，并保持角色信息边界。
5. 最终只在作者确认后写入 `sandbox/vol-N-ch-M/推演NN.md`。

它明确不修改 `.agent/status.md`、角色设定或伏笔，也不自动注入后续写作。这是一个边界较清楚的 non-Canon rehearsal，但仍由通用 Agent 直接写 sandbox 文件，没有 typed event、source fingerprint、crash recovery 或 adoption diff。

OAN 当前 Play Rehearsal 已经覆盖并强化了这条方向：独立 Play session、角色队列、Director intervention、evidence、recovery、settlement contribution 和 adoption PendingAction。因此该沙盘现在主要是交互设计参考，不再是 OAN 的未实现功能缺口。

#### 4. OpenCode 支持

v4.8.4 会根据 Skill 安装位置判断 Claude Code / OpenCode，把 Agent 部署到 `.claude/agents/` 或 `.opencode/agents/`，并生成 `CLAUDE.md` 或 `AGENTS.md`。

这证明 Markdown Agent 定义可以跨宿主迁移，但也放大了安装型 Skill 的风险：Skill 同时负责全局安装、项目初始化、Agent 部署、迁移、同步和写作业务。OAN 的 Skill 不应演化成这种 installer；Extension 即使支持注册，也应保持轻量、显式和权限受宿主管理。

### 历史 v3 单 Agent harness 仍有参考价值

上一版对历史版本的判断仍成立：

- v1 是单 `SKILL.md` monolith。
- v2 拆为 composable skills。
- v3 引入状态驱动 5-phase harness 与 SOLO Mode。
- v3.5 增加 PreFlight subagents。
- v4 才正式进入当前顶层多 Agent 架构。

值得参考的是 v3 的“每轮从文件恢复状态、阶段产物不可跳、章节后重置对话”，不是 SOLO Mode 的自动代确认，也不是 v4 的固定 Agent 图。

### 当前限制

- 正式正文、设定、记忆和归档由 Agent 直接写入，没有 SemanticPatch / PendingAction。
- README 的“全部授权”允许 Agent 代按流程确认，与 OAN Human Approval 根本冲突。
- 初始化和迁移脚本会创建、移动和清理大量文件；其确认不是逐文件 diff approval。
- prompt / scene-craft 规则非常细，容易把 Writer 变成规则执行器并提高上下文成本。
- OpenCode 适配仍共享 `.claude/knowledge` 与 `.claude/memory`，平台抽象没有完全解耦。
- GPL-3.0 约束明确，不复制源码、prompt、模板、Agent 或知识库内容。

## novel-writer-skills 当前现状

### 当前定位

该项目没有新提交，仍是把软件规格工程迁移到小说创作的 Claude Code command / Skill 包：

```text
/constitution
  → /specify
  → /clarify
  → /plan
  → /tasks
  → /write
  → /analyze
```

并提供 `/track-init`、`/track`、`/plot-check`、`/timeline`、`/relations`、`/world-check` 等追踪命令。

### 仍然值得学习的内容

最稳定的价值仍是 `/write` 的显式读取清单：

- 先读取 constitution 和 style reference。
- 再读取 specification、creative plan、tasks。
- 按 frontmatter 加载 writing style / requirements。
- 再读取 character state、relationships、plot tracker 和 validation rules。
- 最后读取知识、历史正文与开篇规则。
- 正文开始前向作者列出已经读到、缺失或加载失败的核心文件。

这是一种早期 `PreWriteCheck`。OAN 已经将其升级成 typed `PreWriteCheck + ContextPackage.trace`，无需再照搬 Markdown checklist。

### 需要修正的理解

1. **“后台 Skill”不是独立运行时**
   README 中“一致性检查自动后台运行”主要依靠模型遵循 Skill；项目没有一个持续监控所有写作动作的可靠 daemon。

2. **权限仍然很宽**
   `/write` frontmatter 允许直接写 `stories/**/content/**`，并包含 `Bash(*)`。这不是 OAN 意义上的 least-privilege ToolSet。

3. **固定反 AI 比例已经显示出过时风险**
   `/write` 包含单句成段比例、固定段落长度、短句长度等硬建议；而 `oh-story-claudecode` 后续恰恰花多个版本修复同类规则制造的电报体。OAN 不应采用跨题材固定语言比例。

4. **JSON tracking 不等于事实闭环**
   `plot-tracker.json`、`timeline.json`、`relationships.json` 和 `character-state.json` 有明确用途，但由命令直接维护，缺少 evidence closure、source revision 和最终 diff approval。

### 当前结论

该项目适合继续作为“命令边界、写前清单、spec / plan / task 分层”的历史参考；不适合成为现代 Skill 安全模型、写入权限或去 AI 味规则的依据。

## oh-awesome-novel-skill 当前现状

### 当前定位

这个 147 行单文件 Skill 仍然是四者中最接近 OAN 单 Agent 产品哲学的参考：

- 默认一个 Agent，不固定拆角色。
- 先读项目状态再决定动作。
- 只规划足以推进的范围。
- 每章经过 outline、draft、quality gate、作者选择和 archive。
- 只有作者接受后的章节才更新 continuity、characters、hooks、preferences 和 session。
- 不强制迁移已经存在的项目结构。

### 有效原则

- “规划服务写作，而不是为了流程完整制造摩擦”。
- 远期不确定时只规划接下来 3–8 章。
- 最近 1–3 章、相关设定和未兑现伏笔组成近端上下文。
- 记忆条目应能执行并标明章节，不写空泛总结。
- 只有影响正史、主角动机、目标读者和作者珍视文件的选择才需要阻塞提问。

### 当前限制

- frontmatter 没有 allowed-tools，权限完全取决于宿主。
- 工作流明确要求直接写 `drafts/`、`archive/` 和 `memory/`。
- quality gate 允许 Agent 直接修订“明显问题”，没有先形成 findings 和 patch。
- 文件模型只有少量大 Markdown，无法替代 Object File Tree。
- 没有提交基准和许可证，不能安全复制正文。

OAN 当前 `novel-copilot` 已经将这一轻量骨架转换为 capability、typed artifact、PendingAction 和 Git-visible state，因此它主要保留为产品哲学参考。

## oh-story-claudecode 当前现状

### 已经不是单纯 Skill 集

当前仓库包含 13 个 Skill：

- `story`、`story-setup`。
- 长篇 scan / analyze / write。
- 短篇 scan / analyze / write。
- `story-import`、`story-review`、`story-deslop`、`story-cover`、`browser-cdp`。

`story-setup` 还会按宿主部署：

- 7 个专业 Agent。
- Claude / OpenCode / Codex / ZCode 的配置、Hook 与 adapter。
- OpenClaw / Reasonix / generic 的 skills-only fallback。
- `AGENTS.md` / `CLAUDE.md`、rules、references 和 session state 模板。

因此它更准确的定位是“由 Skill 启动和分发的跨平台网文生产环境”，不是只提供 prompt guidance 的 AgentSkill。

### 当前长篇写作纪律

#### 显式停靠与批量上限

`story-long-write` 已增加防失控规则：

- 裸调用只诊断项目状态，不自动写正文。
- “开书”默认产出设定、卷纲和首批 10 章细纲后停止。
- 未指定数量时写一章；日更默认 2–3 章；单轮最多 3 章。
- 修改、指定章节、补纲、日更和开书有明确路由优先级。
- 批量写仍然串行推进，不能并发生成相互依赖章节。

这比上一版更可靠，但停止点控制的是“是否继续直接生产”，仍没有 OAN 的最终 diff approval。

#### 最小必要记忆包

当前仍坚持只加载“不知道就会写错”的状态，并在写作项目中区分：

- `拆文库/`：参考作品分析的数据源。
- `对标/`：当前写作项目选择使用的引用视图。
- `设定/`、`大纲/`、`正文/`、`追踪/`：写作工程文件。

对标书的节奏、情绪模块、文风和相关剧情单元按需进入当前任务。与上一版相比，它不只召回文风，还将 `剧情/节奏.md` 与 `剧情/情绪模块.md` 定义为比汇总报告更权威的下游输入。

#### 细纲是内容规格，不是 prose shape

v0.7.2 的重要修正是明确：细纲规定“必须发生什么”，不规定正文必须按相同字段、句序和段落逐项展开。Writer 可以合并、穿插和重排情节点，把摘要原语演成场景；章尾应落在具体动作、画面或台词，而不是总结状态。

这是当前四个项目中最值得 OAN 新增到写作指导的一条：`ChapterContract` 约束事件、证据和边界，但不能成为正文表面结构模板。

#### 读者契约与终局储备

当前长篇用“读者契约 + 终局储备”替代简单成长预算：单章可以有足够满足感，但不能过早消耗终局底牌、升级台阶或核心关系终点。它适合作为商业 Writing Profile 的可选 reminder，不应成为所有题材的 Canon schema 或硬 gate。

### 拆文与对标升级

长篇拆文仍是 Stage 0–6：

```text
概要与章节边界
  → 黄金三章快速预览与停靠
  → 逐章摘要
  → 剧情聚合 / 剧情单元 / 节奏 / 情绪模块
  → 设定、角色、关系
  → 汇总报告
  → 文风
```

当前增强包括：

- `_progress.md` schema 与唯一章节边界表，支持断点续跑。
- Stage 1 自动停靠，作者可只拿快速预览或继续全量拆解。
- `剧情/README.md` 声明各产物 authority。
- `剧情/节奏.md` 与 `剧情/情绪模块.md` 成为下游主产物。
- 逐章摘要包含关键信息推进、扩写技法和逐章写法公式。
- chapter-extractor 有机械质量检查、失败重试和更高模型升级路径。
- 硬事实必须能回溯原文；未知项写“原文未明确”。

这些改进提升了产物可恢复性，但仍有两个风险：

- 大量聚合结论经过多次模型变换，grep 回原文不等于语义推断一定正确。
- 对标资料会从 `拆文库/` 复制到项目 `对标/`，需要明确用户来源权利、引用范围和删除策略。

OAN 的 reference deconstruction 已经使用 source window、typed evidence、quality warning、track manifest、source drift 和 PendingAction publication，因此应继续保持自己的证据协议，不迁移这些目录与 prompt。

### 去 AI 味已经变成 prompt + lint + Hook

当前 `story-deslop` 有检测、分级、删除优先、Gate A–G、确定性收尾和报告。写作侧还增加：

- `check-ai-patterns.js`：检测若干确定性毒句式。
- 写后 prose net：正文落盘后扫描。
- 欠账门：上一章仍有 blocking 命中时，在写下一章前阻止继续。
- `<!-- 去味:跳过 -->`：显式豁免。
- 跨端 JS / Python parity 检查。

同时，v0.7.1–v0.7.2 又修正了旧规则诱发的碎句、电报体、短句崇拜和章尾总结体。这给 OAN 的结论应是：

```text
结构性错误
  可以 deterministic blocking

语言审美与“AI 味”
  默认是 evidence-backed warning / finding
  由作者和 Writing Profile 决定是否修订
```

OAN 不应把第三方检测器、固定句长、固定段落比例或一个项目的语料统计升级为跨题材硬门禁。

### 多端部署与 Hook

当前项目为不同宿主复制或生成 Agent、command、Hook 和配置，并通过版本、contract、parity 与 CI 防止漂移。工程上值得肯定：

- 明确区分原生 Agent、skills-only 和 solo/direct fallback。
- 不伪造平台不存在的能力。
- Hook 核尽量收敛到共享 Node 实现。
- `agents_version` 作为部署新鲜度锚点。
- 质量门禁修正了 fail-open 掩盖破坏性失败的问题。

但从 OAN 视角，这是不应进入核心 Skill 的复杂度。OAN Skill 仍应是 prompt pack + allowed tools；Hook、脚本、Agent 注册和项目文件迁移必须由独立、显式、可审计的 Extension / application workflow 管理。

### Story Dashboard

v0.7.2 新增本地 Dashboard：

- 默认只绑定 `127.0.0.1`，非回环地址要求显式 `--allow-network`。
- 只展示允许的写作 / 拆文文件，忽略基础设施目录。
- 通过 realpath 检查拒绝路径穿越和 symlink。
- 单文件限制 2 MiB。
- 保存与删除要求 expected version，外部变化返回 409。
- 同一文件的并发 save / delete 进入串行队列，只允许一个旧版本请求成功。
- 工作区节点预算对项目和拆文库分别计算，避免一侧耗尽另一侧。

本轮运行 `npm run test:dashboard`：22 个 Node 测试全部通过。未运行 Playwright E2E。

Dashboard 的并发控制适合参考“人类直接编辑器”的文件安全，但它仍直接写入和删除真实文件，不经过 PendingAction 或 Git diff。OAN 应继续区分：用户在编辑器中直接编辑是用户动作；AI 提议的任何修改仍必须进入审批链。

### 当前限制与风险

- 13 Skill、7 Agent、8 Hook、多套 adapter 和数百 reference 文件已经形成大型平台维护面。
- `story-setup` 会修改项目级 `.claude`、`.codex`、`.opencode`、`.zcode`、rules 和 `AGENTS.md`，权限远超指导型 Skill。
- 正文、设定、追踪、拆文和 Dashboard 编辑均直接写真实文件。
- Hook 缺失或运行时不支持时部分检查按 fail-open 设计，不能被视为安全边界。
- 商业网文方法论、平台语料和高频爽点并非题材中立。
- 对标、原文锚点与模仿工作流存在版权、来源权利和过度近似风险。
- 每次 `agents_version` 变化需要重新 setup 并新开会话，说明安装副本与仓库源之间有显著漂移成本。

## 横向对比

| 维度 | awesome-novel-skill | novel-writer-skills | oh-awesome-novel-skill | oh-story-claudecode | OAN 当前方向 |
| --- | --- | --- | --- | --- | --- |
| 默认形态 | 总指挥 + 7 专职 Agent | slash command + 静态 Skill | 单 Agent 单文件 | 13 Skill + 7 Agent + Hooks + Dashboard | 单 Aider-style Runtime + capability / Skill |
| 状态恢复 | `.agent/status` + order + memory | spec / plan / tasks + JSON tracking | session / continuity Markdown | 项目文件 + tracking + hooks + deployed version | Object File Tree + session artifact + Git |
| 写前产物 | 卷纲 → 章纲 → prompt | constitution → spec → plan → task + checklist | 轻量 outline | 细纲 + minimal memory + benchmark + stop gate | ChapterContract + PreWriteCheck + ContextPackage |
| 正文输入 | Writer 主要读 prompt 和少量 setting | `/write` 按固定优先级广泛读取 | 最近章节和相关状态 | 细纲内容规格 + selective recall + profile rules | typed context selection；记录 included / omitted |
| 写后结算 | updater 直接更新 lore / memory | track command 更新 JSON | archive 后更新记忆 | 每章更新追踪并由 Hook 扫描 | ObservationLog → SettlementBundle → PendingAction |
| 审稿 / 去味 | anti-ai + reader | `/analyze` + 静态一致性 Skill | 通用 quality gate | 多 Agent review + deterministic lint + debt gate | typed ReviewFinding；表达修订不改事实 |
| 非 Canon rehearsal | `sandbox/` 推演记录 | 无独立产品域 | 无 | 无独立 Play；主要在写作 pipeline 内 | 独立 Play / Rehearsal / evidence / adoption |
| 参考拆解 | 非核心 | 内化 / rhythm 配置 | 无 | 完整拆文库、剧情单元、对标视图 | typed reference tracks + source evidence + publish review |
| 写入边界 | Agent 直接写 | command 直接写 | Agent 直接写 | Skill / Hook / Dashboard 直接写 | AI 写入必须 PendingAction / diff / Accept |
| 主要风险 | GPL、多 Agent、迁移脚本 | 过度规格化、宽权限、旧式硬比例 | schema 粗、无权限声明 | 平台过重、直接写、网文美学和来源风险 | 防止参考能力绕过统一架构 |

## 参考项目之间的关键矛盾

把四个项目放在一起，比单独摘取最佳实践更有价值。

### 1. 全量读取与最小上下文冲突

`novel-writer-skills` 倾向固定清单全量读取；`awesome-novel-skill` 倾向把正文隔离到 prompt；`oh-story-claudecode` 倾向只加载“不知道就会写错”的材料。

OAN 当前选择更合理：由 ContextPackage 记录 protected / compressible / excluded、included / omitted 和 source trace；既不盲目塞满，也不只相信另一个 Agent 生成的 prompt。

### 2. 细纲严格与正文自然冲突

细纲越细，弱模型越容易逐项照抄成电报体。当前最稳的结论是：

- ChapterContract 对事实、目标、边界和章尾变化负责。
- Composer / Writer 对场景化、段落节奏和 prose shape 负责。
- 验收检查契约是否兑现，不检查正文是否复刻细纲句式。

### 3. 反 AI 规则会互相推翻

早期项目推崇短句、单句成段、冷白描和强制外化；新版又花多个提交消除这些规则造成的机械感。说明“AI 味”不是稳定语法黑名单。

OAN 应保持：确定性格式错误可以自动检测；审美判断输出 findings；实际修订按 Writing Profile、作者样章和作品上下文决定。

### 4. 作者确认的语义不同

四个参考 Skill 的确认通常是“是否继续下一步”或“是否接受当前章节”，确认后 Agent 直接落盘。OAN 的确认是对具体 PendingAction diff 的应用决定。两者不能在文档中混称 Human Approval。

### 5. Skill 的含义已经分裂

- `oh-awesome-novel-skill`：纯指导文本。
- `novel-writer-skills`：prompt + command 权限。
- `awesome-novel-skill`：installer + Agent graph + scripts + knowledge。
- `oh-story-claudecode`：跨平台应用分发包。

OAN 必须继续使用自己的窄定义：Skill 是 Prompt Pack + Allowed Tool List；业务逻辑、Hook、脚本和持久化协议不属于 Skill。

## OAN 当前已经覆盖的内容

上一版文档把很多条目写成“后续可吸收”，但它们现在已经实现。应以当前 task 状态和代码为准：

| 参考理念 | OAN 当前落点 | 状态 |
| --- | --- | --- |
| 单 Agent 默认、Skill contracts、allowed tool filter | `0700`、`1000` | 已实现 |
| ChapterContract、卷 / 大纲 / 单章规划、PreWriteCheck | `1020` | 已实现 |
| ContextPackage、source discipline、trace 与自动接线 | `1010`、`1070`、`1080` | 已实现 |
| ReviewFinding、去 AI 味保护规则、ObservationLog、SettlementBundle | `1030` | 已实现 |
| session artifact、resume boundary、author report | `1040` | 已实现 |
| projection 与 project health guardrails | `1050`、`1100` | 已实现 |
| reference import / deconstruction / selector / publish review | `0900`、`1080` | 已实现 |
| Reference quality warning 与 Story Material typed track | `1205`、`1210` | 已实现 |
| Writing Profile 和固定 capability reminder | `1200` | 已实现 |
| 独立 Play、Roleplay Rehearsal、typed evidence 和 adoption PendingAction | `1060`、`1090` 及后续 Play tasks | 已实现 |

因此以下旧表述已经过时：

- “OAN 还缺 context-package / rule-stack / trace”。
- “OAN 还缺稳定 chapter-contract / pre-write-check”。
- “OAN 还缺 observation log 和 evidence-only settlement”。
- “参考作品拆解还只在计划中”。
- “OAN 还缺独立 Roleplay Sandbox 产品面”。
- “去 AI 味保护规则尚未实现”。

`OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md` 中若仍保留这些历史 gap，应把它视为来源汇编而不是当前实现状态；当前状态以 task、spec 和代码为准。

## 当前仍值得评估的增量

以下只是参考候选，不自动创建任务。

### 1. 在 ChapterContract 规范中强调“不规定 prose shape”

可增加一条明确约束：本章契约描述事件、目标、evidence obligations、POV、禁区和结束状态，但不要求正文逐字段、逐句或逐段复刻契约；Writer 可以在不破坏约束的前提下合并、穿插和重排场景原语。

来源：`oh-story-claudecode` v0.7.2 对电报体和章尾总结体的修复。

### 2. 建立写作规则冲突的 provenance 与优先级测试

OAN 已有 constitution、workflow、Skill、Writing Profile reminder、reference context 和用户本轮要求。可以继续确保：

- 每条规则知道来源。
- 硬 Canon / 用户明确要求与普通 style hint 不混层。
- 同义 reminder 去重。
- prompt golden test 能发现优先级漂移。
- 冲突时报告取舍，不由模型静默自由裁量。

来源：`awesome-novel-skill` prompt conflict table，以及 `oh-story-claudecode` 多版本规则回归。

### 3. 将 prose lint 严格分成 blocking 与 advisory

适合 blocking 的是可机械证明且与格式合同直接相关的问题，例如非法 frontmatter、路径、缺少必要章节产物或截断文件。句长、禁词密度、章尾形式、比喻和“AI 味”默认只能是 advisory finding。

如果未来加入本地 lint：

- 必须由作者显式启用或由 Writing Profile 选择。
- 命中要给位置、证据、规则来源和豁免方式。
- 不能自动改正文。
- 不以通过外部 AI 检测器为产品目标。
- lint 失败不能绕过或替代 ReviewFinding / PendingAction。

### 4. 为高成本动作保留执行停靠点和批次上限

开书、批量写章、完整拆文和大型导入应展示范围、预计产物、provider 和成本，并限制单轮批次。这个 execution consent 只决定是否开始生成，最终文件变化仍逐项进入 PendingAction。

来源：`oh-story-claudecode` 的裸调用诊断、Stage 1 停靠、单轮最多三章，以及 InkOS 的 ActionEnvelope。

### 5. 人类编辑器继续使用 optimistic concurrency

Dashboard 的 expected version、409 conflict、realpath、symlink 拒绝和同文件串行 mutation 对 OAN 的人类直接编辑器有参考意义。但 AI 写入不应改走这条直接保存 API；它必须继续经过 Apply Engine。

### 6. 安装资产必须有版本与漂移诊断

如果未来 OAN Extension 会向项目部署模板或命令，应记录来源版本、目标文件 hash、用户修改和升级 diff。不要采用“发现旧版本就静默覆盖”或要求用户反复重跑 setup 的黑箱同步。

这只是 Extension 层候选，不改变“Skill 不执行脚本、不注册越权工具”的规则。

### 7. Roleplay 的作者干预继续保持 typed event

`awesome-novel-skill` 的接受、修改、重来、插队、补信息、终止是好用的交互词汇。OAN 已有更强的 Play Rehearsal；可继续保证每次干预都形成 typed event、branch / attempt identity、evidence 和 recovery state，而不是把修改后的自然语言覆盖到 transcript。

## 不建议吸收

- 固定总指挥 + Writer + Reviewer + Updater Agent 图进入 `packages/runtime`。
- SOLO / 全部授权模式代替作者确认。
- Skill 直接安装 Hook、修改 `AGENTS.md`、运行迁移或执行附带脚本。
- Skill 的 allowed tools 扩大宿主 ToolSet。
- `/write` 获得 `Bash(*)` 或整目录直接写权限。
- 直接写正文、truth、追踪或记忆文件。
- 把确认“继续流程”当作批准最终文件变化。
- 每章默认强制拆文、对标、文风召回或多 Agent review。
- 固定单句成段比例、固定句长、固定禁词密度和统一网文美学。
- 把 lint / Hook 当作安全边界或 Canon validator。
- 自动从外部站点抓取受版权保护的完整作品并进入对标库。
- 用 snapshot、tracking JSON、dashboard cache 或 Agent memory 替代 Object File Tree 与 Git。
- 复制 GPL 项目的 prompt、Agent、knowledge、模板或实现代码。

## 证据来源

### awesome-novel-skill

- `reference-only/awesome-novel-skill/VERSION`
- `reference-only/awesome-novel-skill/SKILL.md`
- `reference-only/awesome-novel-skill/README.md`
- `reference-only/awesome-novel-skill/LICENSE-DECLARATION.md`
- `reference-only/awesome-novel-skill/agents/novel-agent.md`
- `reference-only/awesome-novel-skill/agents/prompt-crafter.md`
- `reference-only/awesome-novel-skill/agents/writer.md`
- `reference-only/awesome-novel-skill/agents/updater.md`
- `reference-only/awesome-novel-skill/skills/prompt-crafting.md`
- `reference-only/awesome-novel-skill/skills/prompt-audit.md`
- `reference-only/awesome-novel-skill/skills/writing-execution.md`
- `reference-only/awesome-novel-skill/skills/roleplay-sandbox.md`
- 历史版本通过 `git show v1.0.0:SKILL.md`、`v2.0.0`、`v3.0.0` 和 `v3.5.0` 复核。

### novel-writer-skills

- `reference-only/novel-writer-skills/README.md`
- `reference-only/novel-writer-skills/package.json`
- `reference-only/novel-writer-skills/LICENSE`
- `reference-only/novel-writer-skills/templates/commands/write.md`
- `reference-only/novel-writer-skills/templates/commands/analyze.md`
- `reference-only/novel-writer-skills/templates/commands/track.md`
- `reference-only/novel-writer-skills/templates/commands/track-init.md`
- `reference-only/novel-writer-skills/templates/commands/plan.md`
- `reference-only/novel-writer-skills/docs/skills-guide.md`

### oh-awesome-novel-skill

- `reference-only/oh-awesome-novel-skill/SKILL.md`

### oh-story-claudecode

- `reference-only/oh-story-claudecode/README.md`
- `reference-only/oh-story-claudecode/CHANGELOG.md`
- `reference-only/oh-story-claudecode/LICENSE`
- `reference-only/oh-story-claudecode/skills/story/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-setup/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/workflow-daily.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/state-tracking.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/artifact-protocols.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/writing-craft.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/reader-contract-and-progression.md`
- `reference-only/oh-story-claudecode/skills/story-long-analyze/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-import/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-review/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-deslop/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-deslop/scripts/check-ai-patterns.js`
- `reference-only/oh-story-claudecode/skills/story/scripts/dashboard-server.mjs`
- `reference-only/oh-story-claudecode/tests/dashboard-server.test.mjs`

### OAN 当前边界

- `docs/ARCHITECTURE.md`
- `docs/AGENT_OPERATING_MANUAL.md`
- `docs/OAN_AGENT_WRITING_GUIDE_IMPLEMENTATION_SPEC.md`
- `docs/OAN_AGENT_WRITING_GUIDE_RUNTIME_GAP_SPEC.md`
- `docs/tasks/0900.md`
- `docs/tasks/1000.md`–`docs/tasks/1100.md`
- `docs/tasks/1200.md`
- `docs/tasks/1205.md`
- `docs/tasks/1210.md`
- `packages/core/src/novel-copilot-skill.ts`

## 验证说明

- 三个独立参考仓库的工作树在分析前后保持干净，HEAD 与 upstream 一致。
- `oh-story-claudecode` 的 `npm run test:dashboard` 在允许绑定本机临时端口的环境中通过：22 tests / 22 pass。
- 未运行 `oh-story-claudecode` Playwright E2E，也没有执行四个参考项目的安装、初始化、迁移、Hook 部署或正文生产流程。
- `novel-writer-skills` 没有相对上一版的新提交，因此未重新构建 npm 包。
- 本文只更新参考判断，不改变 OAN task 状态、产品范围或写入架构。
