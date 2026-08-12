# oh-story-claudecode 参考项目现状分析

> 范围：本文分析 `reference-only/oh-story-claudecode` 当前检出的最新主线，并与 OAN 的稳定架构事实进行对照。
>
> 当前基准：`main@1eae178058ce41962de0d465147965af891479dc`（2026-08-11），与 `origin/main` 一致；`skills/story/VERSION` 为 `0.7.5`，当前 HEAD 位于 `v0.7.5` 之后 4 个提交，`scripts/current-contract.json` 的 `agents_version` 已推进到 25。
>
> 验证范围：本轮通过 13 个 Skill 静态检查、current skill contracts、文档预算、61 组共享文件一致性、14 个 tracking workflow 测试、26 个 tracking transaction 测试和 Codex adapter 检查。

## 结论概览

`oh-story-claudecode` 不是独立 Novel IDE，也没有自己的模型运行时。它是一套面向 Claude Code、OpenCode、Codex、ZCode、OpenClaw、Reasonix 和通用文件模式的小说写作 Skill / 脚本集合，由宿主 CLI 提供模型、工具调用和权限。

当前形态可概括为：

```text
oh-story-claudecode
  =
Cross-host Novel Writing Skills
  +
Markdown Project Conventions
  +
Deterministic Tracking Transaction
  +
Generated Host Adapters And Contract Checks
  +
Local File Dashboard
```

对 OAN 最有价值的新增证据不是 prompt 文案，而是三条工程纪律：

- 模型只提出紧凑、闭集的语义变化，Python 事务脚本负责校验、合并和投影。
- 单一结构化追踪状态带 revision CAS；派生 Markdown 先写，权威状态最后写为 commit point。
- 热上下文、Skill 文档体积和多宿主派生文件都有自动预算 / 一致性检查。

这些机制可以强化 OAN 的 `SettlementBundle`、projection、ContextPackage 和 adapter governance，但不能替代 `SemanticPatch → PendingAction → Git diff → Accept`。

## 当前产品与仓库形态

仓库顶层提供 13 个 Skill，覆盖：

- 项目入口与本地 dashboard。
- 长篇写作、审稿、去 AI 味、导入、扫描与拆解。
- 短篇写作与分析。
- 封面、浏览器自动化和项目初始化。

长篇项目采用中文目录约定，常见对象包括：

```text
正文/
大纲/
设定/
追踪/
对标/
拆文库/
.active-book
```

这是可读、可迁移的文件协议，但并非 OAN 的 Object File Tree 规范。其脚本会直接更新章节和追踪文件，也没有 Git 作为统一历史引擎。

## 长篇追踪事务

### 单一结构化 authority

`追踪/_tracking-state.json` 当前 schema 为 v4，是动态连续性追踪的结构化 authority。它覆盖章节推进所需的角色状态、伏笔、时间线、读者认知和近期记录；人类可读文件由它确定性渲染，包括：

- `追踪/上下文.md`
- `追踪/伏笔.md`
- 作者时间线与读者已知时间线
- 角色快照
- 分章追踪记录

该设计不代表“整部小说以一个 JSON 为数据库”。正文、大纲和设定仍是独立 Markdown；`_tracking-state.json` 只统一动态追踪域。

### semantic delta 与严格校验

模型不直接重写整个追踪状态，而是提交紧凑 JSON delta。`tracking_commit.py` 会检查：

- 顶层键和闭集枚举。
- 字段长度与结构。
- 章节号、角色、伏笔和时间线操作。
- append / revision 模式差异。
- `expected_state_revision` 是否仍匹配当前状态。

revision 不匹配时失败关闭，避免旧生成结果覆盖新状态。这是一个轻量 compare-and-swap，而不是文件锁或通用并发事务；上游文档也明确不支持同时提交多个 tracking transaction。

### authority-last commit point

事务的写入顺序是：

1. 读取并校验当前 `_tracking-state.json` 与 expected revision。
2. 纯内存合并 delta，生成新的 authority 和全部派生视图。
3. 先以临时文件 + rename 写各个派生 Markdown 与本章 delta。
4. 最后原子替换 `_tracking-state.json`，将它作为 commit point。

如果派生写入中途失败，旧 authority 仍然有效，同一个 transaction 可以重试。这比任意顺序覆盖多个文件安全，但仍不是跨文件原子回滚：commit point 之前可能留下与旧 authority 不一致的新派生文件，读取方必须以 authority revision 为准并允许重建。

OAN 可吸收的是“每个领域的 typed delta、source revision、确定性 projection 和明确 commit point”，不应把所有小说事实收进单个 JSON。

## 热上下文与知识边界

长篇写作将动态热上下文固定为 7 个区段，并设置硬预算：

- 总大小不超过 12,288 bytes。
- 活跃角色最多 6 个。
- 活跃伏笔最多 8 个。
- 近期章节保留 3 章。

作者真相与读者已知信息分开投影，可以表达“世界中已发生，但读者或角色尚不知道”的状态。角色条目也区分退出、退休和当前活跃，避免历史角色永远占用热上下文。

这与 OAN 已有的 branch-local knowledge、角色认知和 Play Mode 状态是同向验证。适合补充的是预算回归和 deterministic projection 测试，不是再建设一套平行记忆系统。

## 参考拆解工作流

`story-long-analyze` 和 `story-short-analyze` 把参考拆解作为正式文件产物，而不是一次聊天摘要。当前主线进一步明确：

- 语义分块与模型处理批次是两个概念，不能用固定字符批次冒充作品结构。
- 在调用模型前先固定输出目录、文件名、章节结构和 schema。
- 原始材料、分块结果、分项分析和汇总报告分别保存。
- 对标资料进入 `拆文库`，不直接成为当前小说正文或设定。

这可以作为 OAN reference deconstruction pipeline 的对照实现，尤其适合复核输出 contract、source drift、分块 / batch 分离和 publication 完整性。OAN 仍应保留 no-copy guardrail、accepted bundle 和 PendingAction 边界。

## 多宿主适配与 Agent 边界

仓库从一套模板生成不同宿主的命令和 Agent 定义，并用 byte-copy / contract 检查防止漂移。当前可部署的写作角色有 7 个：chapter extractor、character designer、consistency checker、narrative writer、story architect、story explorer 和 story researcher。

这些角色是否真正作为 subagent 运行取决于宿主能力；不支持时会回退为单 Agent / 直接 Skill 执行。因此这里的“多 Agent”主要是宿主适配和 prompt 分工，不是仓库自身实现的自治 runtime。

OAN 不应复制固定角色团队。可参考的是：

- canonical source 生成宿主 adapter。
- 共享 hook / guard 的语义一致性测试。
- adapter 只能收窄宿主能力，不能以 prompt 声明扩大权限。

## 本地 Dashboard 的安全边界

dashboard 是一个 loopback Node 文件浏览 / 编辑服务，不是 AI runtime。值得参考的文件 API 防护包括：

- root realpath containment。
- 拒绝 symlink 穿越。
- 只允许有限可编辑扩展名。
- 单文件最大 2 MiB。
- 基于文件 hash 的 `expectedVersion` 乐观并发控制。
- mutation queue 串行化写操作。
- 临时文件 + rename 原子替换。
- 删除需要确认和版本匹配。
- 网络监听必须显式开启。

这组措施适合 OAN 本地文件编辑 API 的安全复核，但不能替代 PendingAction、Git diff 或 workspace path policy。

## 最新提交变化

相对 `v0.7.5`，当前 4 个提交主要完成：

- Bash 宿主下的正文 guard、目录发现、字段与跨批 review 修复。
- 参考拆解输出 contract 前置，以及 semantic chunk 与 processing batch 分离。
- 长篇写作主 Skill 和热路径文档精简。
- 新增文档预算检查，避免核心 Skill 随功能增长持续膨胀。

`skills/story/VERSION` 仍为 `0.7.5`，但 `agents_version` 已从该版本发布说明中的 24 前进到 25。分析当前行为时应以代码 contract 为准，不把 release tag 当成完全相同的运行快照。

## 工程验证状态

本轮在当前工作树独立验证：

- 13 个顶层 Skill 全部通过 static check。
- current skill contracts 通过。
- doc budget 通过。
- 61 组共享参考文件无差异。
- tracking workflow 14 个测试通过。
- tracking transaction 26 个测试通过。
- Codex adapter 检查通过。

共享文件检查出现一条 Git fsmonitor IPC warning，但检查结果仍为 0 mismatch；它不是业务断言失败。

## 当前限制与风险

1. **不是完整应用或独立 runtime**
   可靠性、权限和 subagent 行为很大程度取决于宿主 CLI。

2. **正式文件仍由脚本直接写入**
   tracking transaction 改善了一致性，但章节与状态没有统一的 PendingAction / diff acceptance。

3. **prompt / hook 不是权限隔离**
   检查可以发现规则漂移，却不能替代宿主的工具白名单、路径限制和 OS sandbox。

4. **单 tracking authority 只适合动态追踪域**
   若把同一模式扩大到所有设定、正文和对象，会形成 OAN 明确不需要的中心数据库。

5. **authority-last 不是完整多文件事务**
   commit point 前的派生文件可能部分更新，必须依靠 revision 和可重建性处理。

6. **本地 Dashboard 不是 Human Approval 引擎**
   hash 并发控制防止覆盖旧版本，但不负责 AI 候选、SemanticPatch 或 Git 历史。

## 对 OAN 的建议

### P0：优先复核

1. **Settlement 使用 expected revision / source hash**
   每个 typed delta 与目标对象 revision 绑定，Accept 前重验，旧候选失败关闭。

2. **每个动态领域明确 authority、projection 和 commit point**
   timeline、角色状态、knowledge ledger 等从 Object File Tree truth 确定性投影；projection 可重建且不得反向覆盖 truth。

3. **Context 与 Skill 文档设置自动预算**
   对 hot context、固定 guide 和生成 adapter 设置 byte / token 回归阈值，避免规则增长静默吞噬写作上下文。

4. **作者真相、角色认知和读者已知继续分离**
   将 oh-story 的 author / reader projection 当作现有 Play knowledge 模型的交叉验证。

### P1：按需吸收

5. **若存在多宿主派生文件，使用单一 source + 生成 + drift test**
   只有 OAN 真正需要维护重复 adapter 时才引入，不为未来可能性先造平台层。

6. **本地文件 API 加 expectedVersion、realpath 与 symlink 防护**
   与现有 workspace boundary、PendingAction 和 Git dirty check 组合使用。

7. **参考拆解区分 semantic chunk 与 processing batch**
   对照现有 reference task 的 run、artifact、publication 和 source drift 测试，避免按字符批次直接形成最终作品结构判断。

### 不建议吸收

- 直接写真实章节和 tracking 文件作为默认 Agent 权限。
- 用 prompt hook 代替工具权限、路径边界或 Human Approval。
- 将 7 个写作角色固化为 OAN runtime 的多 Agent 拓扑。
- 把中文目录约定替换为 OAN Object File Tree。
- 把全部小说状态集中进单个 JSON authority。
- 直接复制 MIT 源码、prompt、规则文本或 UI 表达；OAN 继续遵守 reference no-copy。

## 主要证据路径

- `reference-only/oh-story-claudecode/skills/story-long-write/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/scripts/tracking_commit.py`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/tracking-transaction.md`
- `reference-only/oh-story-claudecode/skills/story-long-write/references/state-tracking.md`
- `reference-only/oh-story-claudecode/skills/story-long-analyze/SKILL.md`
- `reference-only/oh-story-claudecode/skills/story-long-analyze/references/pipeline-ops.md`
- `reference-only/oh-story-claudecode/skills/story-long-analyze/references/output-templates.md`
- `reference-only/oh-story-claudecode/skills/story/scripts/dashboard-server.mjs`
- `reference-only/oh-story-claudecode/scripts/current-contract.json`
- `reference-only/oh-story-claudecode/scripts/static-check.py`
- `reference-only/oh-story-claudecode/scripts/check-doc-budget.sh`
- `reference-only/oh-story-claudecode/scripts/check-shared-files.sh`
- `reference-only/oh-story-claudecode/scripts/test-tracking-workflow-contracts.py`
- `reference-only/oh-story-claudecode/scripts/test-tracking-commit.py`
- `reference-only/oh-story-claudecode/scripts/check-codex-adapter.sh`

本文只更新参考判断，不修改 OAN 的正式架构与实施状态。
