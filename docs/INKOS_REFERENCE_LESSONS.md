# InkOS 参考项目可借鉴经验

> 参考基准：`reference-only/inkos@b0cc9a54`（`master`，2026-07-28，与 `origin/master` 一致）。
>
> InkOS 应用版本：`1.7.2`；当前 HEAD 是 `v1.7.2` 之后 3 个文档提交，最新代码提交为 `6e4ce005`。
>
> 现状证据与完整对比见 [INKOS_REFERENCE_OVERVIEW.md](INKOS_REFERENCE_OVERVIEW.md)。本文只记录可迁移的设计经验、边界和优先级，不自动创建实现任务，也不改变 OAN 既有架构决策。

## 总结判断

InkOS 最值得 OAN 学习的不是功能数量，也不是多阶段 Agent 流水线，而是几个局部工程纪律：动作参数自包含、上下文来源可追溯、结构化变化由确定性代码应用、非 Canon 候选明确失效、长任务状态可恢复，以及 Skill 不得扩大运行时权限。

这些经验必须先翻译成 OAN 语义：

```text
InkOS 的局部机制
  → 提取不依赖其产品架构的约束
  → 映射到 Object File Tree / AI SDK ToolSet
  → 生成 SemanticPatch / PendingAction
  → Git diff Human Approval
```

不能从“InkOS 已验证某个工作流”推出“OAN 应采用同样的直接写入、自动修订或多 Agent Runtime”。两者的产品权力边界不同。

## 本轮分析修正了什么

上一版 Lessons 的方向大体正确，但对当前 InkOS 和 OAN 的描述已经不够精确。本轮作出以下修正：

1. **记录可复查的提交基准**
   旧文档没有记录 InkOS SHA。本轮以 `b0cc9a54` 为当前基准，以旧文档进入 OAN 前可达的 `3f9b4e80` 作为推定对比基准；版本差异结论不再只来自 README。

2. **Skill 已经更换协议**
   InkOS v1.7.2 已删除旧的私有 capability / skill 体系，改为标准 AgentSkills / OpenClaw `SKILL.md` 发现和按需加载。OAN 也已经有 built-in `novel-copilot`、workspace override 和 `allowedTools` 过滤，因此建议是复核兼容边界，不是从零建设 Skill loader。

3. **确认卡不是最终写入审批**
   InkOS 的确认卡确认“开始执行重动作”；确认后 pipeline / tool 可以直接写正式文件。OAN 的 PendingAction 确认“是否应用已经可见的具体 diff”。这两个 gate 可以同时存在，但不能合并成一个。

4. **InkOS 不是 Markdown 单一事实源**
   长篇运行状态以 `story/state/*.json` 为权威结构化层，Markdown 是投影，`memory.db` 是可重建索引；基础设定和控制文件仍是 Markdown。不同产品域还有独立 manifest、JSONL、snapshot 和 store。

5. **Play 的落盘不是完整跨文件事务**
   InkOS 会先 render，再执行图状态事务；但图状态提交后的 event、current state、projection 和 transcript 仍是顺序写入。它降低了半状态概率，却不能保证所有文件原子提交。OAN 不应把这一实现当作多文件 Apply Engine 的事务证明。

6. **新增长任务和候选域**
   当前 InkOS 已有剧情推演、材料库、联网研究、翻译、互动影游、后台任务、Prompt Pack、备份恢复和标准 Skill。这些能力提供了新的局部参考，但不自动成为 Novel IDE 的范围。

7. **测试数量不能替代可复现性**
   当前源码中有 292 个测试源文件。核心 Skill、Context、Forecast、State、Research 等 11 个定向 suite、108 个 assertion 可通过；完整测试受本地依赖缺失和 workspace 构建产物不同步影响。Lesson 是保持单命令可复现验证，而不是把测试文件数量当作质量结论。

## 吸纳原则

### 学机制，不扩产品边界

每项借鉴都要回答三个问题：

- 它解决的是 OAN 已有问题，还是只服务于 InkOS 的额外产品域？
- 它能否由现有单一 Runtime、ToolSet 和文件协议表达？
- 它是否保持 AI 提议、作者审阅、Git 记录的权力顺序？

如果答案要求新增隐藏 planner、常驻 daemon、自主修稿循环或另一套事实源，就不应进入 OAN 核心。

### 先区分执行同意与内容批准

高成本动作可以有两个不同的确认点：

```text
Execution Consent
  确认模型、预算、输入范围、预计产物和是否启动

Apply Approval
  确认 SemanticPatch 产生的具体文件 diff 是否成为真实项目状态
```

第一层适合建书、长时间参考分析、批量规划和大材料导入；第二层是所有 AI 写入的硬边界。取消第一层不应产生正式写入，确认第一层也不能绕过第二层。

### 所有派生层都必须可解释

OAN 可以有 summary、projection、search index、session artifact 和缓存，但必须明确：

- 来源文件是什么。
- 生成版本和 fingerprint 是什么。
- Canon 变化后如何标记 stale。
- 删除后如何重建。
- 哪一层可以被用户直接编辑。

这比简单规定“都存成文件”更重要。

### Skill 约束模型，不授权模型

Skill 可以提供 prompt guidance、允许工具集合、静态参考和 quick command；它不能：

- 向当前 ToolSet 增加原本不可用的能力。
- 绕过路径、session kind、PendingAction 或 provider gate。
- 自动执行附带脚本。
- 把业务状态藏进 Skill 文件或运行时记忆。

运行时实际权限应该是宿主能力、session policy 和 Skill allowlist 的交集，而不是并集。

## P0：应在现有任务中优先复核

P0 表示值得对照现有实现和关联 task 查缺，不表示立即新增功能或扩大 scope。

### 1. 保持两阶段确认语义

InkOS 的 `ActionEnvelope` / `RequestedIntent` 强制重动作 payload 自包含，并验证确认来源与 intent 匹配。这可以改善 OAN 高成本任务启动前的可理解性。

OAN 可吸收：

- 用 typed `ActionIntent` 描述动作类型、输入来源、目标范围、预计产物、成本和外部数据流向。
- 让后续执行只依赖确认过的 payload，不从聊天历史猜参数。
- 用 execution id / fingerprint 防止按钮重放、重复任务或把旧确认用于新输入。
- 把执行结果绑定到 session artifact、Tool Log 和 PendingAction，而不是模型口头“已完成”。

硬边界：正式文件变化仍必须进入 `SemanticPatch → PendingAction → diff → Accept`。不应增加 InkOS 式 `write_truth_file` 直写入口。

### 2. 复核 ContextPackage 的 protected / compressible 语义

InkOS Composer 会区分不可静默压缩的作者意图、当前焦点和硬状态，以及可压缩的历史摘要和低相关背景；protected 自身超预算时明确失败，并记录选择、压缩和预算 trace。

OAN 已有 `ContextPackage` 和 trace 基础，后续应在 `1010`、`1070`、`1080` 的边界内复核：

- source 是否带路径、revision / hash、选择原因和层级。
- 作者明确约束、constitution、workflow、当前章节目标和关键 continuity 是否可声明 protected。
- protected overflow 是否可见失败，而不是静默截断。
- 压缩结果是否保留原来源映射。
- 未确认候选和旧草稿是否默认排除，避免把非 Canon 当事实。

这应继续是 agent 组装层能力，不应把 planner、composer 或语义压缩循环塞进 `packages/runtime`。

### 3. 固化 Skill 的权限不扩张规则

InkOS 最新 Skill 实现验证了一个适合 OAN 的安全不变量：模型先看到 name / description，需要时加载 guidance，但 Skill 本身不获得新工具或脚本执行权。

OAN 当前已经实现 `novel-copilot` loader、workspace override 和 `allowedTools` filter。对 `0700` 的合理复核项是：

- active tools 始终等于宿主 ToolSet 与 `skill.allowedTools` 的交集。
- workspace Skill 不能覆盖写入审批、绝对路径读取和 provider gate。
- Skill 内容进入 prompt provenance，并能在 session 中看见来源。
- Skill activation 有明确生命周期，旧 guidance 不永久污染后续请求。
- 若未来兼容标准 `SKILL.md`，只实现项目需要的最小静态子集，并验证路径、symlink、大小和文件数量。

不应把 InkOS 的用户全局目录扫描、OpenClaw 兼容或 `@skill-id` UI 直接视为 OAN 必需功能。

### 4. 把 Skill、Prompt Pack 和 Workflow Template 分开

InkOS v1.7.2 把 Prompt Pack 从 Skill 协议剥离，这个方向与 OAN `0700` 剩余 scope 一致。

建议保持三个概念：

| 资产 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Skill | 工作纪律、prompt guidance、allowed tools | 业务实现、权限扩张 |
| Prompt Pack | 可见、可覆盖、可版本化的模型指令 | 工具注册、项目状态 |
| Workflow Template | 推荐步骤与产物协议 | 隐藏 planner、自动执行 |

三者都应记录来源、优先级和 fingerprint；workspace 覆盖必须在 trace 中可见。

### 5. 结构化变化使用 typed delta + deterministic reducer

InkOS 章节结算不是让模型重写整份 current state，而是产生 typed delta，再由 immutable reducer 和 validator 应用。这与 OAN 的 SettlementBundle、SemanticPatch 和 Object File Tree 很相容。

可迁移约束：

- 模型只能提出闭集操作和带 evidence 的变化。
- 代码验证 ID、枚举、引用、状态迁移和旧值前提。
- reducer 负责确定性计算新状态，模型不能同时定义规则并裁决自己合格。
- 多个对象变化先形成完整候选，再生成逐文件 diff。
- projection 在 Accept 后由真实对象文件重建，不成为反向事实源。

这应补强现有 `1030` settlement 与 `1100` projection 工作，不应复制 InkOS Settler Agent 或 JSON state 目录。

### 6. 把部分落盘当作一等失败场景

InkOS Play 的边界提醒 OAN：先 render、单 store transaction 和多文件原子提交是三件不同的事。

对 PendingAction / Apply Engine 应持续验证：

- preview 阶段不修改真实目标。
- Accept 前重新检查 source hash、Git dirty 状态和所有路径。
- materialize 过程中任一文件失败时，有明确 receipt、已写文件列表和恢复策略。
- projection / index 刷新失败不伪装成 Canon 写入失败，也不能静默丢失。
- 自动 Git commit 失败时保留已接受变化和可操作错误，不重复应用 patch。
- crash recovery 能区分 prepared、accepted、partially materialized、committed。

InkOS 的 backup、task snapshot 和 lock 可作为失败案例来源，但 OAN 的恢复事实应由 PendingAction receipt、shadow state、Object File Tree 和 Git 共同解释。

## P1：适合做局部产品与协议参考

### 7. 非 Canon 剧情推演采用 fingerprint / stale / adoption

InkOS Narrative Forecast 将 2–5 条未来分支保存在 `story/runtime/narrative-forecasts`，绑定输入 content fingerprint；Canon 变化后标记 stale，选择分支只生成 `selected-branch-plan.md`，不会直接修改正文、大纲或状态。

如果 OAN 增加多线推演，可直接采用更严格的三段式：

```text
Forecast Artifact（non-Canon）
  → 用户选择分支
  → Adoption Preview / SemanticPatch
  → PendingAction Accept
```

候选必须记录源 revision、假设、风险、影响对象和失效原因。选中只代表“进入采纳预览”，不代表成为 Canon。OAN 现有 Play adoption / reference publish 边界应继续作为实现模板。

### 8. 长任务要有可恢复 task card，同时收窄写工具

InkOS 后台生产任务为每个 session 保存 task snapshot、execution id、进度和恢复信息；任务运行时 host 会抑制冲突写工具，并提供 abort、删除、僵尸清理和 book lock。

OAN 可以将其用于长时间参考分析、导入、健康检查或大规模只读审阅：

- 每个 workspace / mutation domain 保持明确单槽或冲突矩阵。
- task card 展示输入 fingerprint、阶段、provider、外部数据流、产物和错误。
- 用户可以继续对话，但冲突写工具临时不可用。
- abort 只终止运行，不自动撤销已经接受的正式变化。
- restart 后从持久化 checkpoint 证明状态，而不是仅靠内存 promise。

这不授权 daemon 自动写章，也不要求增加多 Agent scheduler。

### 9. 材料召回先建立透明的词项基线

InkOS 材料库保留 source、MIME、purpose、字符范围、excerpt 和匹配分数，用词项召回而不是先引入向量数据库。

这适合 OAN filesystem-first 路线：

- 原始材料、清洗文本和 manifest 分层保存。
- 每个 context excerpt 都能回到具体文件和字符范围。
- 检索分数与用途可见，用户可以判断为何被选中。
- 派生索引可删除重建，不能成为小说 truth。
- embedding 只有在透明基线不足且有明确评测后再考虑。

同时应比 InkOS 更早补齐 URL 安全：DNS / 私网地址、重定向链、下载大小、MIME、超时、credential forwarding 和审计日志。

### 10. 研究报告必须与 Canon 隔离

InkOS 会保存来源、query log、失败、unknowns 和 confidence，并明确 Research 不是 Canon。这个产品边界值得保留。

OAN 的研究产物应：

- 记录可访问来源、查询时间、摘录位置和未验证项。
- 区分“来源声称”“模型推断”“作者决定”。
- 不把搜索摘要第一句当作已验证 claim。
- 只有经作者选择并进入 SemanticPatch 的内容才可修改世界设定或章节。
- 外部服务接收了哪些正文或设定要在 provider / egress UI 中可见。

### 11. 导入已有小说应支持重放和 source drift

InkOS 能从已有章节反推 summary、state、style 和 truth files，并维护导入恢复路径。OAN 可以吸收其工作流拆分，但要保留候选语义：

- 先登记原稿来源、文件顺序、encoding 和 fingerprint。
- 解析章节与生成事实候选分开。
- summary、timeline、foreshadow、state 和 style profile 都先进入 shadow / session artifact。
- 用户按文件或批次审阅 PendingAction 后才写 Object File Tree。
- 原稿变化时标记 source drift，并支持从最近已确认 checkpoint 重放。

这应与外部参考作品 deconstruction 分离：自有原稿可以成为本项目事实候选，外部参考只能进入 reference layer。

### 12. Provider 配置要显示来源、凭据和数据外发

InkOS 将 provider preset、模型测试、doctor、secret 和配置层级做成完整产品面。OAN 可继续吸收：

- 显示配置来自全局、workspace、env 还是本轮覆盖。
- API key 与可提交配置分开，日志和错误不得泄露凭据。
- 对模型、base URL 和 provider compatibility 做显式验证。
- 在执行前说明哪些文件片段会发送给哪个服务。
- 将配置错误、上游错误、限流、内容策略和本地执行错误分类展示。

Provider 诊断只提升可解释性，不能成为绝对路径读取或隐式大范围上传的理由。

### 13. 事件与运行产物要以真实完成态为准

InkOS 的 transcript / SSE 会区分 request started、tool event、committed 和 failed。OAN 可继续统一 RuntimeEvent taxonomy：

- 事件带 execution id、session id、阶段和目标 artifact。
- Tool Log 显示读了什么、为何读取、是否产生 PendingAction。
- `completed` 必须由 durable artifact、receipt 或 commit 证明。
- provider 慢、tool 慢、等待用户审批和后台排队应是不同状态。
- 重连后从持久化事件或任务快照恢复，不根据最后一条自然语言猜状态。

## P2：仅在产品范围明确后参考

### 14. Translation 应是隔离的派生产品域

InkOS 的翻译流水线有 source、segment、glossary、batch state、review 和 export，适合参考长文批处理与断点恢复。但 OAN 当前定位不是通用翻译平台。

只有明确进入产品计划时才应考虑，并保持：

- `translations/` 与小说 Canon 隔离。
- glossary 和译文是目标语言派生资产，不反向修改原稿。
- manifest 使用严格 schema，不依赖宽松 TypeScript cast。
- 每批结果可恢复、可复审、可重新导出。

### 15. 互动影游只参考图协议和 validator

InkOS 的互动影游包含 story graph、condition / effect evaluator、typed delta、immutable apply、snapshot、路径枚举和导出。这些可为 OAN Play 或未来互动叙事提供局部参考：

- 节点和边使用稳定 ID。
- condition / effect 使用闭集表达式，禁止运行任意代码。
- 图变更先验证 dangling edge、不可达节点、终局和路径上限。
- 大图枚举必须有 max paths / depth，不能无界搜索。
- export 是派生物，不成为编辑事实源。

不应因此把互动影游、分镜、视频或资产生成纳入 Novel IDE 核心。

### 16. Play 只吸收 OAN 尚缺的局部，不回退现有边界

InkOS Play 值得参考的局部包括 render-before-commit、确定性 condition / effect、checkpoint、variant、run lock 和图验证。

OAN 已有更适合自身架构的 world referee、branch-local knowledge、typed settlement 和 adoption flow，因此：

- 不以 InkOS 的 `play.db` / JSON fallback 替代 Object File Tree。
- 不让一回合直接成为小说 Canon。
- 不把顺序多文件写误称为原子事务。
- Play 结果进入小说仍走 adoption preview 和 PendingAction。

## 不建议吸收

### Runtime 与自动化

- Architect / Writer / Auditor / Reviser 多 Agent 编排进入 `packages/runtime`。
- 默认自动审稿、自动修订或多轮 repair loop。
- daemon 定时写章、无人值守批量生产或隐藏重试。
- 让后台任务扩大原 session 的可写工具集合。

### 写入与事实源

- `write_truth_file` 式整文件直接覆盖。
- 确认“开始执行”后跳过最终 diff approval。
- SQLite、transcript、task snapshot、projection 或 search index 成为小说事实源。
- 每个新增产品域建立一套互不兼容的 truth / history 协议。
- 用 snapshot / backup 取代 Git 历史。

### Skill 与扩展

- Skill 自动执行脚本、安装依赖或注册任意工具。
- Skill 的 allowed tools 与宿主权限取并集。
- 默认扫描所有用户全局 Skill 并让项目无感继承。
- 引入 extension marketplace 或复杂依赖解析器。
- 把业务逻辑和持久状态塞进 prompt / Skill。

### 产品范围与外部边界

- 为追平 InkOS 功能表而加入翻译、互动影游、封面或视频生产。
- 未做 SSRF 防护的任意 URL 摄取。
- 把搜索 snippet 或模型整理的“claim”直接写入 Canon。
- 隐式将整本小说发送给外部 provider。

### 许可证

InkOS 为 `AGPL-3.0-only`。可以独立学习公开行为、约束和抽象思路，不应复制其源码、prompt、Skill 正文、测试或 UI 文案。若未来需要代码级复用，必须单独完成许可证兼容评估。

## 可作为 OAN 规范候选的约束语句

以下文本可以在关联 task 复核时作为候选，不代表本次分析已修改正式规范：

1. Skill may narrow the active ToolSet, but must never expand host permissions.
2. Confirming execution does not approve any resulting file change.
3. Every AI-authored real-file mutation must end in a reviewable PendingAction diff.
4. Non-Canon artifacts must carry source revisions and become stale when their inputs change.
5. Protected context must fail visibly when it cannot fit; it must not be silently truncated.
6. Model output proposes typed deltas; deterministic code validates and applies them.
7. Derived indexes and projections must be rebuildable from the Object File Tree.
8. Durable receipts, not assistant prose, determine whether an action completed.
9. Background execution may suppress conflicting tools, but may not gain new authority.
10. External research remains evidence until the author explicitly adopts it into Canon.

## 与现有 OAN 任务的建议映射

| 经验 | 优先对照位置 | 处理方式 |
| --- | --- | --- |
| Skill 权限不扩张、Prompt Pack 分离 | `0700`、`1000` | 复核现有 loader / filter；只保留轻量 registration |
| protected / compressible、source trace | `1010`、`1070`、`1080` | 补 trace 与失败语义，不新增 planner |
| typed delta、evidence、projection | `1030`、`1050`、`1100` | 加强 validator、Accept 后刷新和失败测试 |
| 非 Canon fingerprint / adoption | Play adoption、reference publish 现有链路 | 复用统一 preview / PendingAction 语义 |
| 导入已有小说 | `0700` 与 `0900` 边界 | 自有原稿导入和外部 reference 严格分离 |
| 多文件部分落盘与 Git receipt | `0800` 及 PendingAction / Git task | 补 source drift、partial materialization、commit failure 测试 |
| 后台任务、task card、恢复 | 仅在具体长任务需要时 | 先做单 domain、单槽和只读任务，不建通用 scheduler |
| 材料 / 研究 provenance | reference 与 context selection 相关 task | 先透明词项检索，再用评测决定是否需要 embedding |

任何条目正式进入实现前，仍应以对应 `docs/tasks/*.md` 的 scope、constraints、Related Plans 和 Done Criteria 为准。

## 主要证据路径

- 版本与产品范围：
  - `reference-only/inkos/README.md`
  - `reference-only/inkos/CHANGELOG.md`
  - `reference-only/inkos/package.json`
- Agent 与动作确认：
  - `reference-only/inkos/packages/core/src/agent/agent-session.ts`
  - `reference-only/inkos/packages/core/src/agent/agent-tools.ts`
  - `reference-only/inkos/packages/core/src/interaction/action-envelope.ts`
  - `reference-only/inkos/packages/core/src/interaction/edit-controller.ts`
- Skill 与 Prompt：
  - `reference-only/inkos/packages/core/src/skills/external-loader.ts`
  - `reference-only/inkos/packages/core/src/agent/skill-tool.ts`
  - `reference-only/inkos/packages/core/src/prompts/prompt-pack.ts`
- 长篇 Context 与 State：
  - `reference-only/inkos/packages/core/src/agents/composer.ts`
  - `reference-only/inkos/packages/core/src/pipeline/chapter-review-cycle.ts`
  - `reference-only/inkos/packages/core/src/state/runtime-state-store.ts`
  - `reference-only/inkos/packages/core/src/state/memory-db.ts`
- 材料、研究与推演：
  - `reference-only/inkos/packages/core/src/materials/ingest.ts`
  - `reference-only/inkos/packages/core/src/materials/retrieve.ts`
  - `reference-only/inkos/packages/core/src/agents/researcher.ts`
  - `reference-only/inkos/packages/core/src/forecast/runner.ts`
- 独立产品域与后台任务：
  - `reference-only/inkos/packages/core/src/translation/runner.ts`
  - `reference-only/inkos/packages/core/src/interactive-film/validation.ts`
  - `reference-only/inkos/packages/core/src/play/play-runner.ts`
  - `reference-only/inkos/packages/studio/src/api/task-store.ts`
- OAN 当前边界：
  - `docs/ARCHITECTURE.md`
  - `docs/APPLY_ENGINE.md`
  - `docs/AGENT_OPERATING_MANUAL.md`
  - `docs/tasks/0700.md`

本文只更新参考判断。OAN 的正式方案仍由自身稳定设计文档、task、Object File Tree、AI SDK ToolSet、SemanticPatch、PendingAction 和 Git diff approval 决定。
