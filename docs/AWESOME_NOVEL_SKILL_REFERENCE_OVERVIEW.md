# awesome-novel-skill 参考项目现状分析

> 范围：本文分析 `reference-only/awesome-novel-skill` 当前检出的最新主线，并与 OAN 的稳定架构事实进行对照。
>
> 当前基准：`main@e7d19936bac10e165ab42cb744f7d5c549c19f77`（2026-08-11），与 `origin/main` 一致；`VERSION` 为 `v4.12.3`，当前 HEAD 位于该 tag 之后 4 个提交。
>
> 对比基准：OAN 已完成 Play 升级计划曾使用 `1f24b2c`（2026-07-10，`v4.8.1`）。从该基准到当前共有 65 个提交、91 个文件变化，约 7,264 行新增、803 行删除。
>
> 验证范围：本轮尝试运行仓库检查，但 `tools/check-agents.py` 按最新 fail-fast 规则因本地缺少 PyYAML 立即退出；没有安装依赖，也不把上游发布说明中的检查数量当成本次独立结果。

## 结论概览

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

这是一套 filesystem-persisted 工作流，但 Git 不是统一历史引擎，也不存在 SemanticPatch / PendingAction。作者在各阶段可以确认方案，却仍可通过 SOLO 模式把确认权委托给 Agent；这种可绕过行为与 OAN 的真实目标文件审批硬边界不兼容。

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

OAN 可借鉴 partial artifact、source fingerprint 和 resumable phase；正式 materialization 仍必须由 Apply Engine 与 Git 管理，不能用 prompt 驱动的补偿写入替代。

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

本文只更新参考判断。OAN 的正式方案仍由自身稳定设计文档、task、Object File Tree、AI SDK ToolSet、SemanticPatch、PendingAction 和 Git diff approval 决定。
