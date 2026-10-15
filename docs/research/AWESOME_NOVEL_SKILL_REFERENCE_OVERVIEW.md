# awesome-novel-skill 参考项目现状分析

> **导航**：现状分析（本文）→ 后续：[可吸收点候选清单](AWESOME_NOVEL_SKILL_REFERENCE_LESSONS.md) ｜ 前置/历史：[多项目横向分析（v4.8.x）](NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md)、[OAN 写作参考笔记](OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md) ｜ 同类：[StoryForge 现状分析](STORYFORGE_REFERENCE_OVERVIEW.md)
>
> **本文内部**：[v4.28.0 现状增量与修正](#v4280-现状增量与修正)（最新）→ [历史快照 v4.12.3](#历史快照结论概览v4123)（旧）→ [对 OAN 的建议](#对-oan-的建议)

> 范围：本文分析 `reference-only/awesome-novel-skill` 当前检出的最新主线，并与 OAN 的稳定架构事实进行对照。
>
> 当前基准：`main@dcd1920`（2026-09-25，合并 PR #137），`VERSION` 为 `v4.28.0`；工作树与远端主线一致。
>
> 上一版基准：`main@e7d19936`（2026-08-11，`v4.12.3`）。此后约 70 个非合并提交、230 个文件变化，约 18,101 行新增、4,227 行删除，版本经历 v4.13 → v4.28。更早的对比基准仍是 `1f24b2c`（2026-07-10，`v4.8.1`）。
>
> **阅读方式**：“历史快照”之后的章节写于 v4.12.3。其中“固定 1 + 7 Agent”“style-distiller 尚未实现”“许可证为 GPL-3.0”等表述已过时，请先读下面的“v4.28.0 现状增量与修正”。
>
> 验证范围：本轮只做了 git 历史、release note、目录、`agents/` / `skills/` / `tools/` 与知识库结构的静态阅读；因本地 `python3` 在当前沙箱内无法执行，**没有运行** `tools/check-*.py` 或测试，也没有安装依赖。上游 release note 中的“全绿”只作为项目自述。

## v4.28.0 现状增量与修正

### 结论

`awesome-novel-skill`（仓库自称 awesome-novel-agent）仍是宿主编码 Agent 执行的 filesystem-persisted 小说写作 SOP，不是应用、也没有自建 runtime。v4.13 以后的重点不是新架构，而是三条线：

1. **写作质量工程**：确定性检查脚本与“生成 / 清创分离”的去 AI 味管线。
2. **文风蒸馏与长短分轨**：style-distiller 落地，新增完整的短篇流水线与独立工具。
3. **分发与合规**：平台从 4 个扩到 7 个，许可证切换到 AGPL-3.0。

```text
awesome-novel-skill (v4.28)
  =
State-driven Writing SOP
  +
Long-form: 1 Dispatcher + 7 Specialists
Short-form: 1 Dispatcher + 4 Specialists (复用 reader)
Style: style-distiller (LLM 蒸馏卡)
  +
Deterministic Prose Tools (check-prose / check-chapter / style-*)
  +
7 Host Adapters (claude / opencode / reasonix / codex / grok / zcode / dsh)
```

### 对旧结论的修正

| 旧结论（v4.12.3） | 当前状态（v4.28.0） |
|---|---|
| 当前 `agents/` 只有总调度者加 7 个子 Agent，没有 `style-distiller` | `agents/` 共 14 个文件：长篇调度者 + 7 子 Agent、`style-distiller`，以及短篇 `short-agent`、`short-planner`、`short-writer`、`short-editor`、`short-verifier` |
| style-distiller 是“已确认但未实现”的设计 | v4.14.0 起“双态重构”：放弃 jieba / 统计引擎，改为 LLM 蒸馏卡 + 提示词验收；`tools/style_*.py` 与测试进入仓库 |
| 平台为 Claude / OpenCode / Reasonix / Codex | `tools/platforms.py` 现含 7 个平台：新增 ZCode（v4.14）、`deepseek-harness`（dsh，v4.15.1）、Grok Build（v4.20，含 `spawn_subagent` 调度，随后又移除子 agent 派发授权） |
| SOLO 模式可委托确认权 | 当前文案为“你全权写 / 别等确认”（全自动模式）：展示摘要后视为确认，**单次有效**，下一关卡仍停；v4.16 新增设定阶段的作者确认门禁，v4.21 起卷纲 / 章纲规划后停等作者、不再自动开写正文。方向在收紧，但确认权仍可由作者口头委托给 Agent |
| 许可证为 GPL-3.0 | v4.28.0 起整体切换为 AGPL-3.0，并在 README 增加第三方 LLM API / Token 服务声明；仍保留“个人免费、商用需作者授权”的立场 |
| 文档漂移：`ARCHITECTURE.md` 页首版本落后 | v4.16 的架构评审 P1/P2/P3 修复后专门做了版本统一与调度契约单源；之后版本检查进入 CI（`check-version`） |
| 没有统一 typed 校验，AI 判断为主 | 新增 `check-prose.py`、`check-chapter.py`，并挂入 anti-ai 的 Phase 2 初筛与 Phase 4 复跑；脚本只报警、不自动改文 |

### 新增或显著增强的能力

1. **确定性正文检查工具链**
   - `check-prose.py`（v4.18，移植自 MIT 许可的 human-writing skill，并按本项目口径调整）：硬禁令词表、统计形态、破折号密度等；退出码区分“无失败 / 有失败 / 读取失败”。
   - `check-chapter.py`（v4.22）：章节结构热源的确定性检查，并支持回归库 / 白名单文件以 `#` 开头的注释行。
   - 两个脚本并列进入 anti-ai Phase 2，命中并入既有 Gate A/B 清单优先清零；工具缺失时按降级语义继续，不阻塞主流程。
   - 同步新增 `test_check_prose.py`、`test_check_chapter.py`、`test_style_*.py`，以及 `check-conflicts.py` 检查规则冲突。

2. **生成与清创分离**
   - v4.18：prompt 只注入正向要点 + T1 简表，Phase 3 先改结构再清句子；新增“活人感”正向方法论 `living-voice`，并把闲笔 / 情绪错位从“配方式验收”改为“有来路才合格”。
   - v4.22–v4.23：结构热源定律（问答乒乓链拍数上限、章首冷开场、同场单回执、章尾禁总结升华）、writer 每场动笔前的“五行反闭环卡”；提示词注入带裁决顺序声明：作者设定与章纲 > 题材知识 > 结构默认值 > 检测优化。
   - 防冲突纪律：细则只在知识文件、管线只引用不复制；新刻度不重复定义既有句数 / 标点 / 章尾口径。

3. **作者触发的外部检测闭环（`detect-loop`，v4.24）**
   - 默认离线、不进默认管线；作者说“送检”才触发。
   - 仓库不含检测平台脚本 / 密钥，只约定输入稿件与输出结果文件的格式契约。
   - 修复纪律：每轮只修最高分片段、首末句锁定、等长微调、两轮无改善即止损、作者设定永远优先；达标后以 SHA-256 锁版，经确认的翻车句进入项目回归库。
   - 每本书在 `sandbox/` 积累 `detect-battles.md`、`prose-regressions.txt`、`locked-lines.txt` 三个文件。

4. **短篇流水线（v4.25–v4.27）**
   - `init.py --length short` 生成 `stories/{slug}/` 篇目制骨架，与长篇的卷章体系互斥，`sync-project` 按项目长度同步并带篡改检测兜底。
   - 流程：定情绪 → 构思排纲 → 写作契约组装 → 契约独立审计 → 分批写作 → 去 AI 精修 → 兑现度核对 → 验收交付；复用 `reader`。
   - **篇级写作契约**（`stories/{slug}/prompt.md`）：六元素、扁平化“不可违反规则”、内联冲突裁定表；同时是验收基线，定稿后逐项核对兑现度，未兑现项附原文证据回退。
   - **机器可验的结构硬门槛**：反转揭穿位置 > 60% 才通过（< 50% 判无效）；伏笔回查；每节 ≥ 800 字、整篇 ≥ 8000 字，全部通过脚本实测，禁止模型估算。
   - 职责互斥：审计者不组装、核对者不写作不清创、组装者不自审。
   - v4.26 补齐 11 个写作深度参考、9 个题材风格包、跨篇作者偏好记忆；v4.27 新增 `short-scan`（扫榜，三级数据来源逐级降级且必须标注“未实时校验”）与 `short-analyze`（拆文，五阶段串行、崩溃安全写盘、三道验收闸门），作为独立 skill 部署到所有平台。

5. **对话与交付纪律**
   - v4.17：视角单一来源传递、对话密度验收对齐；提示词链路冲突修复（蒸馏态严格匹配、基线去重）。
   - v4.16：面向作者的沟通必须用大白话（`author-communication` 规范），并堵住三处内部词泄漏。
   - v4.14：蒸馏产出新增 `novel-samples/`、`settings/style-profiles/` 与 `.style-versions/`，文风版本留痕。
   - v4.15：章纲默认单章字数统一为 2500 字且可全局调整。

6. **平台层成熟度**
   - 修复 Windows 路径正斜杠导致孤儿检测全量误报、`install.ps1` UTF-8 BOM、`Join-Path` 等问题；init / sync 去重，部署集路径统一。
   - 仍由 canonical 源 + `tools/platforms.py` 生成各宿主产物，并有 `test_platforms.py` 防漂移。

### 仍然成立的局限

- 固定多 Agent 拓扑进一步扩大（长篇 8 + 短篇 5 + 蒸馏 1）；权限仍是 prompt 声明，不是 capability isolation。
- 没有 CandidateChangeSet / PendingAction / Git diff；归档和回滚仍由 updater 直接改正式文件。
- 确认权仍可口头委托（全自动模式，虽已改为单次有效）。
- 检测闭环的“达标”依赖外部平台分数，这对 OAN 的目标并不构成约束，也不应引入检测平台绑定。
- 多处自述“全绿”未经本轮复现。

### 许可证边界更新

当前为 AGPL-3.0（含网络提供服务的开源义务）。README 同时保留“个人免费、商用需作者授权”的表述，两者关系仍需专业判断。OAN 仍只学习公开机制，不复制源码、prompt、Agent 定义、知识库文本或 UI 文案；`check-prose.py` 还带有第三方 MIT 移植声明，更不能整体搬运。

## 历史快照：结论概览（v4.12.3）

`awesome-novel-skill` 是一套由宿主编码 Agent 执行的 filesystem-persisted 小说写作工作流，不是独立应用，也没有自建 LLM runtime。当前版本以一个总调度 Agent 和 7 个子 Agent 为中心，通过 `.agent/status.md`、order 文件、阶段产物、checkpoint 和归档文件推进长篇创作。

```text
awesome-novel-skill
  =
State-driven Writing SOP
  +
1 Dispatcher + 7 Specialist Agents
  +
Filesystem Orders / Checkpoints / Archives
  +
Generated Claude / OpenCode / Reasonix / Codex Adapters
  +
Host-provided Tool Execution
```

相对 v4.8.1，当前版本最重要的变化是：跨宿主适配、分阶段断点续跑、章节回滚、writer 分段草稿恢复、Codex Agent TOML 生成和更严格的 Python 依赖检查。

它对 OAN 的主要价值是工程反例和局部协议参考，而不是默认写作架构：OAN 已选择单一 Aider-style runtime、AI SDK ToolSet、Object File Tree 和 Git diff Human Approval，不应回退到固定多 Agent 写作流水线。

## 当前执行架构

### 状态驱动调度

`novel-agent` 是唯一调度者，读取 `.agent/status.md#phase` 后一次只派发一个任务。阶段包括：

```text
setup → outline → draft → anti-ai → review → archive → finished
```

子 Agent 共有 7 个：

- `volume-planner`
- `chapter-planner`
- `prompt-crafter`
- `writer`
- `anti-ai`
- `reader`
- `updater`

调度者将输入 / 输出路径写入 `.agent/task/*-order.md`；子 Agent 完成后把 `status: pending` 改成 `status: DONE`。调度者还会检查声明的输出是否存在且非空，再推进下一阶段。

这是一种文件化串行编排，不是并行自治 Agent 网络。它便于人工观察，但完成证明主要依赖 prompt 合约和文件约定，缺少 OAN RuntimeEvent / PendingAction / receipt 的统一类型边界。

### 文件 authority

主要项目文件包括：

```text
story.md
settings/
volumes/
chapters/
prompts/
sandbox/
archives/
.agent/status.md
.agent/task/
.agent/archiving/
.claude/ 或其他宿主目录
```

`status.md#phase` 是调度路由状态，`chapters/*.md#status` 是章节生命周期；order 文件是跨 Agent hand-off。正文经历 draft、anti-ai 和 final archive 多个文件，设定、时间线、角色状态和伏笔在归档阶段直接更新。

这是一套 filesystem-persisted 工作流，但 Git 不是统一历史引擎，也不存在 CandidateChangeSet / PendingAction。作者在各阶段可以确认方案，却仍可通过 SOLO 模式把确认权委托给 Agent；这种可绕过行为与 OAN 的真实目标文件审批硬边界不兼容。

## 断点续跑、归档与回滚

v4.10 以后新增的机制包括：

- `.draft.partial.md` 保存 writer 已完成的叙事段。
- order 文件记录 `partial_path`，恢复时从下一段继续。
- 完整草稿生成后才清理 partial。
- `.agent/archiving/{chapter}.done` 防止归档重放重复追加。
- 归档前保留 AI 原版快照，最终稿和中间稿并存。
- 章节重写时由 updater 回退时间线、伏笔、角色状态和章纲状态。
- 同步与更新路径保留备份 / rollback 入口。

这些协议证明“阶段内 checkpoint”和“领域补偿式回滚”可以仅靠文件实现。但它们不是数据库事务：多个对象由 Agent 按 SOP 顺序修改，失败恢复依赖幂等锚点、checkpoint 和后续补做，也没有 Git receipt 证明每一步的真实结果。

OAN 可借鉴 partial artifact、source fingerprint 和 resumable phase；正式 materialization 仍必须由 ChangeMaterializer 与 Git 管理，不能用 prompt 驱动的补偿写入替代。

## 跨宿主平台层

当前仓库以 canonical Agent 定义为源，通过 `tools/platforms.py` 和初始化 / 同步脚本生成：

- Claude Code Agent 定义。
- OpenCode Agent 定义。
- Reasonix 配置。
- Codex Agent TOML。

v4.12 新增 Codex 支持，共生成 8 个 TOML：总调度者加 7 个子 Agent。平台转换与同步测试用于检查派生文件是否漂移。

这套“单一源文件 → 确定性 adapter → drift test”值得在确有多宿主需求时参考。不过 Codex TOML 没有该项目所需的工具白名单字段，因此转换器将“不得派生 subagent、不得写其他 order、不得推进全局 phase”等规则注入 `developer_instructions`。

这只是文本级约束，不是 capability isolation。宿主若仍向子 Agent 暴露相关工具，prompt 禁止不能提供强安全保证。OAN 应继续以 ToolSet 交集、路径策略和审批 gate 实际收窄权限。

## 写作阶段与角色推演

工作流把卷纲、章纲、提示词、正文、去 AI 味、审稿和归档分为固定职责。优点是每阶段输入 / 输出清楚，章纲包含 memo、情绪设计、场景卡和 hooks，归档会将正文证据整理回角色、时间线和伏笔文件。

风险是方法论与文件状态大量编码在 prompt 中：

- Agent 是否遵守读写范围依赖宿主和指令执行。
- 固定 7 子 Agent 会放大上下文切换与 hand-off 成本。
- 自动归档直接改变正式文件。
- SOLO 模式可以跳过逐步作者确认。
- anti-ai 与 reader 的模型判断没有统一 typed finding / deterministic validator。

`roleplay-sandbox` 是一个 Markdown 推演 SOP，而不是模拟 runtime。它按角色串行发言、接收作者反馈，并将记录保存在 `sandbox/`。v4.8.2 / v4.8.3 后输出原则更强调只呈现可观察的言行、环境与状态变化，不暴露内部推理过程。

这一写作纪律与 OAN Play 的 actor step / visible consequence 同向，但 OAN 已有 world referee、branch-local knowledge、typed intervention、variant、checkpoint 和 adoption，不能退回到纯 prompt 沙盘。

## 文档与实现漂移

当前有几个必须分开的事实层：

- `VERSION` 为 `v4.12.3`，但 `ARCHITECTURE.md` 页首仍写 `v4.11.1`。
- `docs/superpowers/specs/2026-08-10-style-distiller-design.md` 标记“已确认（作者审批）”，设计新增第 9 个子 Agent；当前 `agents/` 仍只有总调度者加 7 个子 Agent，没有 `style-distiller` 实现。
- 角色沙盘现行规则要求不输出隐藏推理，但部分旧格式文档仍保留“认知层”式表达，存在规则语义漂移。

因此分析必须以实际目录、生成脚本和 tests 为准，不能把“设计已获批准”写成“功能已落地”。

## 许可证边界

仓库 `LICENSE` 与双语 license declaration 指向 GPL-3.0。README 另有“个人免费、商业使用联系作者”等表述，和 GPL 授权的关系需要专业法律判断。

OAN 本次只独立学习公开机制，不复制源码、prompt、Agent 定义、规则文本或 UI 文案。若未来考虑任何代码级复用，必须单独完成许可证兼容审查。

## 工程验证状态

当前检查工具已改为 PyYAML 缺失时 fail-fast，不再使用不完整 fallback parser。本轮运行 `tools/check-agents.py` 时即因本地没有 PyYAML 退出，因此：

- 没有修改参考项目依赖。
- 没有得到当前工作树的完整测试通过结论。
- 上游 release note 中的检查数量只作为项目自述，不作为本轮验证证据。

fail-fast 本身是合理改进：生成跨宿主权限与 Agent 配置时，解析器缺失不应静默降级。但参考仓库若希望易于复核，仍应提供锁定依赖的一键检查环境。

## 值得参考的局部

1. **阶段中间产物可恢复**
   大输出按叙事段持久化 partial，恢复时从已完成边界继续，并验证输入仍匹配。

2. **归档幂等与 checkpoint**
   每章有稳定完成标记，重复执行先查锚点，防止角色 / 时间线 / 伏笔重复追加。

3. **单一 canonical adapter source**
   宿主派生配置由脚本生成，并以测试防漂移。

4. **最终输出只展示可观察行为**
   角色推演不把 hidden reasoning 当故事内容，适合验证 OAN Play 的可见事件 / 私有认知边界。

5. **初始化与同步区分源模板和项目副本**
   适合作为 OAN built-in skill / workspace override provenance 的反例参考。

## 当前限制与风险

1. **固定多 Agent 拓扑与 OAN runtime 方向冲突**。
2. **prompt 读写白名单不等于强制权限边界**。
3. **确认可由 SOLO 模式代理，不能满足 OAN no-bypass Human Approval**。
4. **归档和回滚直接修改多份正式文件，没有统一 patch / receipt / Git commit**。
5. **大量方法论注入提高上下文成本，规则冲突主要靠人工和检查脚本发现**。
6. **状态、order、checkpoint、章节阶段和多份正文共同解释当前进度**。
7. **文档版本、角色沙盘规范和 style-distiller 设计存在实现漂移**。
8. **本轮因 PyYAML 缺失未完成独立测试验证**。

## 对 OAN 的建议

### P0：用于复核现有能力

1. **长生成使用 typed partial artifact**
   记录 source revision、已完成 segment、下一恢复点和清理状态；恢复后仍只生成候选，不写真实章节。

2. **章节 settlement / projection 保持幂等锚点**
   同一 Accepted PendingAction 或 commit 不得重复追加 timeline、state、foreshadow；以 receipt / commit identity 检查，而不是只靠 Markdown 搜索。

3. **Play 输出区分可观察事件与私有认知**
   将现行角色沙盘的“隐藏推理不外显”作为 OAN world referee 与 knowledge ledger 的交叉验证。

### P1：条件成立时吸收

4. **派生 adapter 采用 canonical source + generator + drift test**
   仅当 OAN 实际维护多个宿主格式时使用；权限仍由宿主 ToolSet 强制。

5. **回滚优先使用 Git 与 typed inverse / repair plan**
   可参考它列举的关联对象范围，但不要让 updater Agent 自由搜索和顺序覆盖正式文件。

6. **启动检查依赖 fail-fast**
   schema / adapter 生成依赖不可用时明确失败，避免半正确产物。

### 不建议吸收

- 1 + 7 固定 Agent 团队进入 `packages/runtime`。
- 依赖 prompt 声明实现工具白名单和状态所有权。
- SOLO / 全权模式绕过真实文件 diff approval。
- updater 直接归档正文、更新状态并补偿回滚。
- 把 `.agent/status.md` 或 order 文件变成 OAN 小说事实源。
- 未实现的 style-distiller 设计进入 OAN 当前能力比较。
- 复制 GPL 源码、prompt、知识库或 Agent 配置。

## 主要证据路径

- `reference-only/awesome-novel-skill/VERSION`
- `reference-only/awesome-novel-skill/ARCHITECTURE.md`
- `reference-only/awesome-novel-skill/SKILL.md`
- `reference-only/awesome-novel-skill/agents/novel-agent.md`
- `reference-only/awesome-novel-skill/agents/writer.md`
- `reference-only/awesome-novel-skill/agents/updater.md`
- `reference-only/awesome-novel-skill/skills/updater-rollback.md`
- `reference-only/awesome-novel-skill/skills/roleplay-sandbox.md`
- `reference-only/awesome-novel-skill/knowledge/format-specs/roleplay-sandbox-style.md`
- `reference-only/awesome-novel-skill/tools/platforms.py`
- `reference-only/awesome-novel-skill/tools/test_platforms.py`
- `reference-only/awesome-novel-skill/tools/check-agents.py`
- `reference-only/awesome-novel-skill/docs/releasenote-4.10.0.md`
- `reference-only/awesome-novel-skill/docs/releasenote-4.12.2.md`
- `reference-only/awesome-novel-skill/docs/superpowers/specs/2026-08-10-style-distiller-design.md`
- `reference-only/awesome-novel-skill/LICENSE`
- `reference-only/awesome-novel-skill/LICENSE-DECLARATION.md`

本文只更新参考判断。OAN 的正式方案仍由自身稳定设计文档、task、Object File Tree、AI SDK ToolSet、CandidateChangeSet、PendingAction 和 Git diff approval 决定。
