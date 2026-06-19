# Webnovel Writer 可吸收点候选清单

> 状态：已合并到 `docs/OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`。  
> 用途：本文保留 Webnovel Writer 的详细候选分析与证据来源；主参考笔记只吸收已按 OAN 边界改写后的方向。  
> 基准：`reference-only/webnovel-writer` 本地当前 HEAD `a7a102a`，插件版本 `6.2.0`。  
> 许可证提醒：Webnovel Writer 使用 GPL-3.0。OAN 只能吸收产品模式、抽象流程、工程纪律和 schema 思路，不应复制实现代码、prompt 文本、模板或默认资料。

## 建议新增来源标记

如果后续把本文内容合并进 `OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`，建议增加：

- `[WebnovelWriter-reference]`：来自 `reference-only/webnovel-writer` 的参考项目观察。

## 吸收原则

Webnovel Writer 对 OAN 的价值集中在 **长篇网文写作链路的阶段化、闸门化和可恢复性**。它不是 OAN 的架构模板。

OAN 的稳定边界仍然是：

- filesystem-first。
- Markdown / YAML / Object File Tree 是数据库。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- 真实目标文件写入必须经过 PendingAction / diff / Human Approval。
- Runtime 保持 Aider-style 极简 tool loop，不引入重型多 Agent 平台。
- 文件修改核心采用 SemanticPatch + Apply Engine。

因此，Webnovel Writer 中可以吸收的是 **写作流程中每一步该读什么、产出什么、如何校验、如何失败恢复**。不能吸收的是完整 `.story-system + .webnovel + projection` 平台、直接写文件行为、固定多 agent 调度、SQLite / vector read-model 作为核心事实层，或 GPL prompt / 模板原文。

## 候选吸收点

### 1. Gate 思路应按规划粒度分层，而不是压到每章

来源：`/webnovel-write`、`write-gate`、`prewrite_validator.py`、`chapter_commit_service.py`。`[WebnovelWriter-reference]`

Webnovel Writer 在写章前、提交前、提交后各有 gate：

- prewrite：合同、占位符、消歧、禁区等是否允许开写。
- precommit：审查结果、节点完成、消歧、artifacts 是否允许提交。
- postcommit：state / index / summary / memory / vector 投影是否完成或跳过。

用户反馈：这套三段式 gate 如果直接套到单章写作，会让日常写作过重。OAN 更适合按规划粒度分层吸收。`[OAN-adaptation]`

建议口径：

- **大纲 / 卷级规划**：可以使用较完整的 gate，例如结构充分性、时间线、伏笔债、关键节点、读者承诺和禁区检查。
- **关键章 / 卷首 / 卷末 / 大转折章**：可以启用增强 gate，确保不写崩设定、时间线、伏笔和核心冲突。
- **普通单章写作**：默认只保留轻量校准，不做完整 prewrite / precommit / postcommit 三段关卡。

OAN 单章轻量版可保留：

- 写前校准：上一章结尾、相关角色、最新状态、active hooks 是否足够支撑本章。
- 应用前检查：正文草稿和 settlement bundle 是否有证据、是否需要用户裁决。
- 接受后检查：用户接受 PendingAction 后确认相关对象文件已更新，并建议 quick commit。

OAN 不需要实现 Webnovel Writer 的投影状态五件套。第一版应把 gate 思路变成按场景启用的 checklist：卷级更完整，单章更轻。

### 2. “写作任务书”应分成卷级任务书与单章轻量契约

来源：`context-agent` 五段写作任务书。`[WebnovelWriter-reference]`

Webnovel Writer 写正文前不直接生成正文，而是先让 context-agent 输出：

- 开篇委托。
- 这章的故事。
- 这章的人物。
- 怎么写更顺。
- 收在哪里。

这与 OAN 已有的 `context-package`、`本章契约`、`PRE_WRITE_CHECK` 候选方向一致。

但 OAN 不宜把完整“写作任务书”变成每章必填文档。更合适的吸收方式是：

- `/规划大纲`：使用完整故事级 / 卷级任务书，明确主线承诺、卷级冲突、关键回收、节奏结构、角色成长段落。
- `/规划下一卷`：使用较完整的卷级 context package 和卷级契约，适合引入 Webnovel Writer 的复杂规范。
- `/规划下一章`：默认生成轻量本章契约，只保留本章目标、场景方向、出场角色、关键状态、涉及 hook、章尾变化。
- `/写下一章`：默认只输出短写前校准表，不重复生成完整任务书；复杂章可由用户显式要求“详细规划”。

注意：OAN 不需要把 context-agent 做成固定 subagent。默认仍可以由单 agent 按指引生成中间产物；复杂任务书应主要服务卷级 / 大纲级规划。

### 3. CBN / CPNs / CEN 更适合卷级拆章和关键章，不宜成为普通单章默认

来源：`/webnovel-plan` 的章节节点规范。`[WebnovelWriter-reference]`

Webnovel Writer 将每章拆成：

- `CBN`：本章开局核心节点。
- `CPNs`：2-4 个过程节点。
- `CEN`：本章结尾核心节点。
- `必须覆盖节点`：写章必须完成的关键点。
- `本章禁区`：绝对不能发生的剧情或设定越界。

用户反馈：这套结构对单章日常写作偏重，但对“卷”级别可能很有用。OAN 可改成：

- `/规划大纲`：用于定义全书或大阶段的关键承诺、高潮、反转和回收节点。
- `/规划下一卷`：用于把卷级冲突拆成章节节点，给每章一个轻量 `CBN / CEN` 或关键 beat。
- 关键章：可使用完整 `CBN / CPNs / CEN`，例如卷首、卷末、转折、战斗、伏笔回收。
- 普通单章：只使用轻量 `opening / middle / ending` 或一句话场景序列，不强制 CPNs。

这一点主要补强 OAN 的 `/规划大纲` 和 `/规划下一卷`，让卷级规划从“这一卷大概发生什么”变成“每章承担什么推进责任”。单章写作仍应保持低摩擦。

### 4. 参考作品拆解必须防 canon 污染

来源：`deconstruction-agent` 与 `/webnovel-init` Step 1.5。`[WebnovelWriter-reference]`

Webnovel Writer 的参考作品拆解有非常清楚的边界：

- 只提炼读者承诺、开篇钩子、爽点循环、压力模型、节奏结构、题材兑现方式。
- 不把原作角色、地名、组织、金手指、剧情事实直接写入新项目 canon。
- 输出 `do_not_copy`、`differentiation_requirements`、`canon_contamination_warnings`。
- 只有用户确认且已变形的模式，才可进入创意约束。

这对 OAN 的 `docs/tasks/0900.md` 很直接。

OAN 可吸收方式：

- `reference deconstruction` 结果只进入 `reference_notes` 或 `reference pattern bundle`。
- 必须区分 `borrowable_patterns`、`do_not_copy`、`differentiation_requirements`、`canon_contamination_warnings`。
- 参考资料只能成为写作上下文或创意候选，不能自动写入世界观、角色卡、时间线、伏笔事实。
- 任何转入 canon 的内容都必须通过 PendingAction 和用户确认。

### 5. 审稿使用 issue schema，不以分数驱动修改

来源：`reviewer` 与 `references/review-schema.md`。`[WebnovelWriter-reference]`

Webnovel Writer 当前 reviewer 不输出总分，不做口头评价，只给结构化问题：

- severity
- category
- location
- description
- evidence
- fix_hint
- blocking

OAN 已经计划吸收 findings schema。Webnovel Writer 可以补强两点：

- 每个审稿维度即使无问题也要显式 pass，避免“漏审”。
- blocking issue 决定是否进入修订或结算，而不是分数决定。

OAN 可吸收方式：

- `/审稿` 输出 findings list + dimension_results。
- 默认只产出报告，不自动改正文。
- 用户选择要修的问题后，才生成 `chapter.createDraft` 或局部 SemanticPatch。

### 6. 写后结算使用三类 artifacts 思路

来源：`data-agent` 的 fulfillment / disambiguation / extraction artifacts。`[WebnovelWriter-reference]`

Webnovel Writer 把写后结算拆成三类：

- 节点履约：计划节点是否覆盖、遗漏、额外生成。
- 消歧：低置信实体或别名是否需要人工确认。
- 事实提取：事件、状态变化、实体变化、出场、场景、摘要。

OAN 可吸收为 settlement bundle：

- `fulfillment`：本章契约中哪些项已实现，哪些遗漏。
- `ambiguities`：新增名词、别名、角色身份、地点归属、信息边界的待确认项。
- `observations`：正文证据支持的状态、关系、时间、伏笔和世界事实。
- `patches`：由 observations 转成的 PendingAction / SemanticPatch。

关键边界：OAN 的 bundle 只提出候选 patch，不直接写真实目标文件。

### 7. 断点续跑与可信产物签名

来源：`run-ledger`。`[WebnovelWriter-reference]`

Webnovel Writer 会记录写章步骤的输入 / 输出文件签名，并据此判断重跑时从哪里继续。例如正文被手改、章纲晚于正文、commit 已 accepted，都会要求用户确认。

OAN 可吸收为轻量 session resume：

- 每个 PendingAction / agent run 记录关键输入 source、输出 artifact、hash、时间。
- 若用户手改了章节或对象文件，下一轮先提示“沿用手改 / 基于手改继续 / 放弃本次草稿”。
- 不自动覆盖作者手改。
- 不需要复杂 run ledger 数据库，可以先落在 `.workspace` shadow metadata。

这与 OAN 的 Human Approval 和 Git diff 工作流天然兼容。

### 8. 作者友好最终报告

来源：`user-report` 与多个 skill 的最终报告契约。`[WebnovelWriter-reference]`

Webnovel Writer 强制最终报告用作者语言，而不是原始 JSON、traceback 或长命令日志。格式包括：

- 总状态：已完成 / 部分完成 / 需要你处理 / 未完成。
- 产生的文件与完成情况。
- 过程中遇到的问题与异常耗时。
- 下一步建议。

OAN 可吸收方式：

- Agent 每轮结束时按“产物、未决问题、下一步”报告。
- 对 PendingAction 明确说明哪些只是候选，哪些已被用户接受。
- 对失败明确说明可从哪里恢复。

这可以提高长流程写作的可信度，尤其是 `/整理本章`、`/审稿`、`/参考作品拆解` 这类会产出多个候选 patch 的命令。

### 9. Reference Loading Map：资料按阶段读取

来源：`references/index/reference-loading-map.md`、CSV 检索规则。`[WebnovelWriter-reference]`

Webnovel Writer 将 reference 读取明确绑定到 skill 阶段，并规定大文件区段读、CSV 检索读。

OAN 可吸收方式：

- 为写作指引建立“资料读取地图”，例如：
  - `/规划下一章` 读取 workflow、constitution、outline、state、timeline、foreshadow。
  - `/写下一章` 读取本章契约、上一章结尾、相关角色、相关世界规则、active hooks。
  - `/审稿` 读取正文、契约、状态、时间线、角色卡、世界规则。
  - `/整理本章` 读取正文和本章契约，但不能用未发生的大纲内容补事实。
- 长 reference 只按 section 进入 context package。
- 写作知识和参考项目资料都应标记 source id 与来源，而不是混进事实源。

这与 StoryForge 的轻量 source discipline、InkOS 的 protected / compressible context 可以合并。

### 10. Strand / 追读力作为软约束，不作为硬模板

来源：`strand-weave-pattern.md`、`reading-power-taxonomy.md`。`[WebnovelWriter-reference]`

Webnovel Writer 用 Quest / Fire / Constellation 三线控制主线、感情线、世界观线的比例，并有 hook / cool point 分类。

OAN 可吸收为审稿和规划的软指标：

- 本章 dominant strand 是什么。
- 最近是否长期缺某条线。
- 章尾 hook 类型和强度是什么。
- 本章是否有微兑现、情绪钩、选择钩、渴望钩。

不建议吸收为硬性数字规则。不同题材、不同作者节奏差异很大，OAN 应把它作为提醒，而不是自动阻断。

### 11. 只读 Doctor 与 Dashboard 思路

来源：`/webnovel-doctor`、`/webnovel-dashboard`。`[WebnovelWriter-reference]`

Webnovel Writer 的 doctor 与 Dashboard 价值在于：复杂项目状态可见，但它们只读，不承担事实写入。

OAN 可吸收方式：

- 增加只读 project health panel：缺失角色卡、未整理章节、active hooks、最新状态过期、时间线断层、PendingAction 未处理。
- Dashboard / Inspector 读取 Object File Tree 和派生索引。
- 所有修复仍回到 PendingAction / Apply Engine，不在 Dashboard 里静默写。

这可以让 OAN 桌面应用更像 Novel IDE，而不是只有聊天窗口。

### 12. Hook 只做轻量守卫，不做隐藏业务流程

来源：`hooks/session_start.py`、`guard_runtime_write.py`。`[WebnovelWriter-reference]`

Webnovel Writer hook 的定位很好：SessionStart 给短状态，PreToolUse 防止绕过 runtime 写危险文件。它不把业务流程藏进 hook。

OAN 可吸收方式：

- 如果未来做本地 app 或 agent integration，可以加轻量 guard：
  - 禁止 agent 直接写真实目标文件，必须走 PendingAction。
  - 提醒存在未处理 PendingAction。
  - 会话开始时显示 workspace status。
- 不把 hook 变成自动整理、自动写摘要、自动提交事实的后台 agent。

### 13. v7 Story Repo 草案中的 filesystem-first 收敛

来源：`docs/architecture/story-repo-spec-2026-06-10.md`。`[WebnovelWriter-reference]`

Webnovel Writer v7 草案提出：

- 一本书就是一个 git 仓库。
- 文件即真相。
- `.cache` 是唯一派生缓存。
- 接受一章 = 一次原子 commit。
- 不在 VCS 里再造 VCS。
- 工作区保存草稿，验收后进入定稿。

这些方向与 OAN 已有架构高度一致。对 OAN 的启发不是“改变架构”，而是给现有判断增加外部印证：

- 坚持 Git 作为历史引擎。
- 坚持 Markdown / YAML 可手改事实源。
- 坚持派生物可重建。
- 坚持接受章节时做原子 settlement。

但 OAN 不需要采用它的中文目录命名或完整 Story Repo spec；OAN 应继续沿用自己的 Object File Tree 规范。

## 不建议吸收的部分

### 1. 固定多 Agent 写章主链

Webnovel Writer 当前要求 context-agent、reviewer、data-agent 等 subagent。OAN 可以保留 specialist skill / specialist prompt 的思想，但默认不应变成固定多 agent runtime。

建议：OAN 默认单 agent + 明确中间产物；复杂任务可选 specialist。

### 2. `.story-system` 提交链

Webnovel Writer 的 `CHAPTER_COMMIT` 在它的 v6 架构中很重要，但 OAN 已有 Git + PendingAction + SemanticPatch。

建议：只吸收“写后结算 artifact”结构，不吸收平行 commit chain。

### 3. `.webnovel` read-model 和 SQLite 作为核心状态层

Webnovel Writer 的 `state.json`、`index.db`、`vectors.db`、`memory_scratchpad.json` 是它的投影层。OAN 可以有可删缓存和索引，但不能让它们成为小说事实源。

建议：OAN 派生 projection 必须可删除重建，事实仍在 Object File Tree。

### 4. 直接写真实项目文件

Webnovel Writer skill 会运行 runtime 命令直接写文件、数据库和备份。OAN 必须改写为 PendingAction / diff / Human Approval。

建议：任何写入启发都要转成 SemanticPatch proposal。

### 5. 复制 GPL prompt、schema 文案或模板

Webnovel Writer 使用 GPL-3.0。OAN 不应复制其 prompt、模板、CSV、schema 文案或代码。

建议：只保留抽象设计，例如“审稿 issue 包含 evidence 和 blocking”，由 OAN 自己重新表述和实现。

### 6. 把题材技巧变成硬规则

Strand 占比、hook 类型、爽点结构对网文有价值，但如果硬编码，会伤害不同题材和作者风格。

建议：作为审稿提醒和 planning hint，不作为默认阻断条件。

## 与现有 OAN Reference Notes 的概念冲突

### 冲突 1：多 agent 强制调用 vs OAN 极简 runtime

Webnovel Writer 当前写章要求必须调用 subagent。OAN 的稳定边界是不引入重型多 agent runtime。

建议合并口径：

- 吸收“职责分段”和“产物边界”。
- 不吸收“每段必须由独立 agent 执行”。
- 在 OAN notes 中标注为 `[WebnovelWriter-reference][OAN-adaptation]`。

### 冲突 2：CHAPTER_COMMIT vs Git 是历史引擎

Webnovel Writer 用 `CHAPTER_COMMIT` 驱动投影。OAN 已规定 Git 是历史引擎。

建议合并口径：

- OAN 可以有 `settlement bundle`，但它不是历史 commit。
- 用户接受后由 Apply Engine 修改 Object File Tree，再由 Git 记录历史。

### 冲突 3：投影链 vs Object File Tree 事实源

Webnovel Writer 的 state/index/summary/memory/vector 投影链很重。OAN notes 已经倾向 human-readable projections，但事实源仍是 Markdown / YAML。

建议合并口径：

- OAN 可吸收 projection 的“可见状态页”和“可重建索引”。
- 不吸收投影失败阻断整个写作链的复杂机制，至少第一版不需要。

### 冲突 4：参考资料按 CSV / runtime 路由 vs OAN 轻量 source discipline

Webnovel Writer 的 reference routing 已较复杂。OAN 已从 StoryForge 确认 Context Source Registry 只吸收理念，不新增重型系统。

建议合并口径：

- OAN 采用轻量 source id + context package。
- 暂不引入大型 CSV 路由、RAG rerank、动态题材裁决引擎。

### 冲突 5：自动备份 / 直接 commit vs Human Approval

Webnovel Writer 的写章最后会备份。OAN 的写入接受后可按配置 auto commit，但必须以用户接受 PendingAction 为边界。

建议合并口径：

- OAN 可在 PendingAction accept 后触发 quick commit / auto commit。
- 不在 agent 起草或审稿阶段自动提交。

## 已写入 OAN Notes 的条目

以下方向已按 OAN 边界合并进 `OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`：

- Source Tags 增加 `[WebnovelWriter-reference]`。
- Current Gaps 增加：缺少 `/规划大纲`、`/规划下一卷` 这类卷级 / 大纲级规划入口；单章写作不宜默认套用完整 gate。
- Novel Writing Skill Learnings 增加：Webnovel Writer 的卷级 context package / 写作任务书、CBN/CPNs/CEN、data artifacts、run ledger、reference loading map。
- Reference Deconstruction Layer 增加：污染警告、差异化要求、质量门控。
- Proposed OAN Agent Writing Loop vNext 增加：
  - `/规划大纲` / `/规划下一卷` 使用增强 planning gate 和结构化节点。
  - 普通 `/规划下一章` 产出轻量本章契约。
  - `/写下一章` Draft 前输出短写前校准表。
  - Verify 输出 findings schema 与 fulfillment check。
  - Settle 输出 observation / ambiguity / patch bundle。
  - Accept 后运行轻量 postaccept check。
- Not Adopted 增加：
  - 固定多 agent 写章主链。
  - `.story-system` 平行提交链。
  - `.webnovel` / SQLite / vector read-model 作为核心事实源。
  - 直接写项目文件和自动备份流程。

## 证据来源

- `reference-only/webnovel-writer/README.md`
- `reference-only/webnovel-writer/CHANGELOG.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-init/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-plan/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-write/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-review/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-query/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-learn/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-dashboard/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/skills/webnovel-doctor/SKILL.md`
- `reference-only/webnovel-writer/webnovel-writer/agents/context-agent.md`
- `reference-only/webnovel-writer/webnovel-writer/agents/reviewer.md`
- `reference-only/webnovel-writer/webnovel-writer/agents/data-agent.md`
- `reference-only/webnovel-writer/webnovel-writer/agents/deconstruction-agent.md`
- `reference-only/webnovel-writer/webnovel-writer/scripts/data_modules/chapter_commit_service.py`
- `reference-only/webnovel-writer/webnovel-writer/scripts/data_modules/run_ledger.py`
- `reference-only/webnovel-writer/webnovel-writer/scripts/data_modules/prewrite_validator.py`
- `reference-only/webnovel-writer/webnovel-writer/references/index/reference-loading-map.md`
- `reference-only/webnovel-writer/docs/architecture/context-minimal-writing-flow-plan-2026-06-05.md`
- `reference-only/webnovel-writer/docs/architecture/story-repo-spec-2026-06-10.md`
