# Webnovel Writer 参考项目现状分析

> 范围：本文只分析 `reference-only/webnovel-writer` 本地当前版本的实际代码与仓库文档，用于理解它作为 OAN 新参考项目的价值。  
> 基准：本地 `reference-only/webnovel-writer` 当前 HEAD 为 `a7a102a`，提交信息为 `docs: announce v7 RFC in README`。插件版本为 `6.2.0`。本次为静态阅读，没有运行测试、安装插件或启动 Dashboard。  
> 许可证：仓库与插件声明为 `GPL-3.0`。OAN 只能吸收抽象 workflow、产品模式和工程纪律，不应复制实现代码、prompt 文本、模板或默认素材。

## 结论概览

Webnovel Writer 当前是一个 **Claude Code 长篇中文网文写作插件**，不是通用 Novel IDE，也不是 OAN 这种 filesystem-first 桌面应用。它把长篇连载拆成一组 slash skill、subagent、Python runtime、Story System 合同链、read-model 投影、RAG / BM25 检索、只读 Dashboard 和轻量 hook。

它真正想解决的问题很明确：让 AI 写到几十章、上百章以后，仍然能遵守设定、接住伏笔、维护时间线、登记新事实，并在失败后可续跑。

最值得 OAN 参考的不是它的多 agent 实现，而是：

- 写作前用合同和 gate 确认“这一章能不能写”。
- 章节规划中要求时间锚点、结构化节点、禁区、必须覆盖节点。
- 正文生成前先产出“写作任务书”，而不是直接起草。
- 写后通过结构化 artifacts 提交章节事实，并区分事实源与派生投影。
- 审稿结果使用可验证 issue schema，不靠口头评分。
- 参考书拆解严格防止参考事实污染新书 canon。
- 失败恢复、最终报告、doctor、hook 都围绕“作者能看懂当前卡在哪里”设计。

但它当前 v6 实现也明显比 OAN 目标更重：`.story-system` 提交链、`.webnovel` 投影层、SQLite、vectors、projection log、多个 subagent 和 Claude Code 插件 hook 共同组成了一套运行时系统。OAN 可以吸收它的阶段产物和 gate 思想，但不应照搬这套状态机。

## 项目形态

Webnovel Writer 外层是插件仓库，内层 `webnovel-writer/` 是 Claude Code 插件源目录。

主要组成：

- `.claude-plugin/plugin.json`：Claude Code 插件元数据，版本 `6.2.0`。
- `skills/*/SKILL.md`：slash command 指令。
- `agents/*.md`：subagent 定义。
- `scripts/webnovel.py` 与 `scripts/data_modules/*`：Python runtime 和业务逻辑。
- `references/`、`templates/`：写作知识、题材模板、审稿 schema、CSV 资料。
- `hooks/`：SessionStart 状态提示与 PreToolUse 写入守卫。
- `dashboard/`：FastAPI 只读面板。
- `docs/`：架构、运维、内存、v7 草案和发布说明。

当前入口文档存在轻微漂移：根 README 已列出 `/webnovel-doctor`，但插件内 README 的组件表仍写 “7 个 Skill”；实际目录包含 8 个 skill。架构概览中有时写 3 个 agent，但实际有 4 个 agent，其中 `deconstruction-agent` 主要由 init 调用。

## Skill 与 Agent

### 8 个 Skill

当前实际 skill 目录包含：

- `/webnovel-init`：深度初始化项目骨架、设定集、总纲、创意约束和初始 Story System。
- `/webnovel-plan`：生成卷节拍表、卷时间线、详细章纲，并刷新写作合同。
- `/webnovel-write`：完整写章流程，上下文、起草、审查、润色、事实提取、提交、投影、备份。
- `/webnovel-review`：独立章节审查和审查指标落库。
- `/webnovel-query`：只读查询角色、伏笔、世界规则、关系和状态。
- `/webnovel-learn`：把用户认可的写法追加到项目经验记忆。
- `/webnovel-dashboard`：启动只读 Dashboard。
- `/webnovel-doctor`：只读项目体检。

### 4 个 Agent

- `context-agent`：写前 research，输出五段写作任务书。
- `reviewer`：只做事实 / 逻辑 / 连续性审查，返回严格 JSON issue list。
- `data-agent`：从正文提取章节事实，生成 commit artifacts。
- `deconstruction-agent`：参考作品拆解，提炼可迁移模式和 init 候选，不写 canon。

这些 agent 在当前流程中是强约束：skill 文档要求必须通过 Agent 工具调用，不能由主流程口头替代。

## 数据与事实源

Webnovel Writer v6 的事实链分为主链和投影：

- 写前主链：`.story-system/MASTER_SETTING.json`、`volumes/`、`chapters/`、`reviews/`。
- 写后主链：accepted `CHAPTER_COMMIT`。
- 派生读模型：`.webnovel/state.json`、`index.db`、`vectors.db`、`summaries/`、`memory_scratchpad.json`。
- 投影日志：`.webnovel/projection_log.jsonl`。

它的核心声明是：`.webnovel/*` 是 projection / read-model，不是写后事实真源。章节事实从 `data-agent` 的 artifacts 进入 `chapter-commit`，再由 projection writers 更新 state、index、summary、memory、vector。

这和 OAN 的差异很关键：OAN 已把 Markdown / YAML / Object File Tree 和 Git 定为事实源，不需要再引入 `.story-system` 提交链或 SQLite read-model 作为核心架构。

## 实际写作 Workflow

### 初始化

`/webnovel-init` 不是直接生成文件，而是先做分阶段采集：

1. 确认插件脚本路径和目标工作区。
2. 询问是否有灵感来源或参考作品。
3. 若用户提供参考文本或摘录，调用 `deconstruction-agent`。
4. 收集故事核、题材、规模、主角、反派、金手指、世界观、力量规则。
5. 生成 2-3 套创意约束包，让用户确认。
6. 用户确认后运行 init 脚本，生成 `.webnovel/state.json`、设定集、总纲、`idea_bank.json`。
7. 生成 `.story-system/MASTER_SETTING.json`。
8. 验证关键文件存在。

其中参考书拆解只返回 `init_reference_research` JSON，并要求使用可迁移模式、差异化要求和污染警告，禁止把原作角色、设定、地名、能力、剧情事实写入新项目 canon。

### 规划

`/webnovel-plan` 强调“先锁定卷级节奏，再批量拆章”：

1. 解析书项目根，运行占位符扫描。
2. 读取总纲和必要设定，确认卷名、章节范围、核心冲突、卷末高潮。
3. 跨卷时读取最近摘要、角色状态、关系和活跃伏笔。
4. 补齐世界观、力量体系、主角卡、反派设计等设定基线。
5. 生成卷节拍表，要求中段反转或明确无反转理由。
6. 生成卷时间线表，要求时间体系、时间跨度和倒计时。
7. 生成详细章纲。
8. 每章必须有目标、阻力、代价、时间锚点、章内跨度、倒计时、爽点、Strand、反派层级、视角、关键实体、本章变化、章末未闭合问题、钩子。
9. 每章可带结构化节点：`CBN`、`CPNs`、`CEN`、`必须覆盖节点`、`本章禁区`。
10. 新设定只增量写回设定集。
11. 生成总纲写回 JSON，刷新 Story System runtime contracts。

这使章纲不是普通剧情摘要，而是可执行的章节合同。

### 写章

`/webnovel-write` 是最完整的主链。默认模式分为 6 个阶段：

1. **预检与合同刷新**  
   运行 `preflight`、解析项目根、扫描占位符、刷新 runtime contract，并执行 `write-gate --stage prewrite`。

2. **context-agent 写作任务书**  
   通过 `memory-contract load-context` 获取基础包，再按需查询角色、规则、时间线、追读信号。输出五段任务书：开篇委托、这章的故事、这章的人物、怎么写更顺、收在哪里。

3. **起草正文**  
   只根据写作任务书起草，不重新加载长篇写作教程。有结构化节点时围绕 `CBN -> CPNs -> CEN` 展开。

4. **审查**  
   调用 `reviewer` 返回严格 JSON，然后由主流程写入 `.webnovel/tmp/review_results.json`，再运行 `review-pipeline` 生成标准审查结果、报告和 metrics。默认只审一轮，blocking issue 必须定点修复或由用户裁决。

5. **润色**  
   处理非 blocking issue、风格适配、排版和 Anti-AI 终检。原则是只改表达，不改事实。

6. **提交事实与投影**  
   调用 `data-agent` 生成 `fulfillment_result.json`、`disambiguation_result.json`、`extraction_result.json`。随后运行 `write-gate --stage precommit`、只读 `git diff` 变更面检查、`chapter-commit`、`write-gate --stage postcommit`、必要时 `projections retry`，最后执行备份。

写章支持 `--fast` 和 `--minimal`，但 minimal 也必须生成新的 no-review artifact，不能复用旧结果。

### 写后记录

`data-agent` 是写后事实提取的唯一写入者，产出三份 artifacts：

- `fulfillment_result.json`：planned / covered / missed / extra nodes。
- `disambiguation_result.json`：待人工消歧项。
- `extraction_result.json`：accepted events、state deltas、entity deltas、appeared entities、scenes、summary text。

`chapter-commit` 根据 blocking、missed nodes、pending disambiguation 自动判定 accepted 或 rejected。accepted 后写入事件审计，并驱动 state、index、summary、memory、vector 等 projection writers。

这一套非常适合研究“写后结算应该有哪些字段”，但 OAN 落地时应转换成 observation log + PendingAction / SemanticPatch bundle，而不是直接写 projection。

## 审稿机制

`reviewer` 当前只审 5 个维度：

- setting
- timeline
- continuity
- character
- logic

它不评分、不评价文笔、不建议新增剧情，只返回可验证 issue。每个 issue 包含 severity、category、location、description、evidence、fix_hint、blocking。每个维度必须输出 pass 或问题结论。

`review-pipeline` 再把 reviewer JSON 转成报告和兼容 metrics。gate 决策仍以原始 issue 和 blocking 为准，而不是以总分为准。

这个方向与 OAN 已经记录的 `/审稿` findings schema 高度兼容。

## 查询、学习、Doctor 与 Dashboard

`/webnovel-query` 的设计重点是“最窄工具”：先判断查询类型，再只调用角色状态、关系、世界规则、伏笔、综合上下文或静态文件读取中最小的一种。它明确写出数据优先级：写前合同、accepted commit、memory-contract、投影层。

`/webnovel-learn` 只追加项目经验记忆，例如 hook、pacing、dialogue、payoff、emotion、format 等模式，不删除旧记录。

`/webnovel-doctor` 是只读体检，按当前项目阶段检查目录、文件、JSON、SQLite、RAG、Python 依赖和 Dashboard 构建产物，不自动修复。

Dashboard 是 FastAPI 只读应用，提供项目状态、实体图谱、章节内容、追读力数据和 story runtime health。它通过 path guard 限制项目根范围，原则上不提供写接口。

## Hooks 与运行时保护

插件提供两个轻量 hook：

- `SessionStart`：运行 `project-status --format summary`，给会话开头提供短状态。
- `PreToolUse`：拦截直接写 `.story-system/commits/`、`index.db`、`vectors.db`、`memory_scratchpad.json`、`projection_log.jsonl` 等危险路径的 Write / Edit / Bash 行为。

值得注意的是，hook 被设计成守卫，不是隐藏业务流程。真正写入仍应走 `webnovel.py` runtime 命令。

## 参考资料与上下文治理

Webnovel Writer 的 reference 系统很有工程纪律：

- 大型 reference 文件按区段读取，不全文塞进上下文。
- CSV 表通过 `reference_search.py` 检索，不直接 `cat` 整表。
- `reference-loading-map.md` 记录每个 skill 在哪个阶段读取哪个 reference。
- `story-system` 会根据题材与裁决规则生成写作合同中的 dynamic context 和 anti-patterns。

它还把题材、爽点、Strand、追读力、审查 schema、命名规则、场景写法、桥段套路拆成可维护资料。这对 OAN 的启发是：写作知识库需要“按阶段加载”和“可追踪来源”，而不是把一整套写作百科塞给 agent。

## v7 草案与当前实现的张力

仓库当前 README 提到 v7 RFC。`docs/architecture/story-repo-spec-2026-06-10.md` 的方向明显靠近 OAN：

- 一本书就是一个 git 仓库。
- 文件即真相，全部状态是人可读 Markdown / YAML。
- `.cache/` 是唯一可删派生缓存。
- 接受一章 = 一次原子 commit。
- 不在 VCS 里再造 VCS，审计、回溯、分支都用 git。
- 草稿在工作区，验收后进入定稿。

这说明 Webnovel Writer 作者也意识到 v6 的 `.story-system + .webnovel + projection` 体系偏重，下一代想收敛到更 filesystem-first 的 story repo。

对 OAN 来说，v7 草案比 v6 runtime 更接近长期方向；但它仍是草案，不是当前已落地实现。分析时应区分“当前 v6 事实”和“v7 设计愿景”。

## 工程优点

1. **端到端写作链路完整**  
   init、plan、write、review、query、learn、doctor、dashboard 都有明确入口。

2. **中间产物和 gate 足够清楚**  
   写作任务书、review results、data artifacts、chapter commit、projection status、run ledger 让失败点可定位。

3. **Agent 产物有唯一写入者**  
   reviewer 只返回 JSON，主流程落盘；data-agent 是三份 artifact 的唯一写入者；projection 只由 commit chain 执行。

4. **写作方法论贴近中文网文**  
   Strand、爽点、追读力、黄金三章、题材模板、金手指、反套路、桥段套路都围绕中文连载场景设计。

5. **失败恢复考虑充分**  
   `run-ledger` 会检查正文、审查结果、data artifacts、commit、projection、备份的可信断点，避免重跑时误覆盖作者手改。

6. **作者友好报告**  
   最终报告固定总状态、产物、问题、下一步建议，不把 traceback 和原始 JSON 直接甩给作者。

7. **参考书拆解边界好**  
   `deconstruction-agent` 明确不能污染新书 canon，且区分快速模式、深度模式、质量门控和差异化要求。

8. **只读可视化与 doctor 有现实价值**  
   Dashboard / doctor 能让复杂项目状态可见，但不承担事实写入。

## 限制与风险

1. **运行时偏重**  
   `.story-system`、`.webnovel`、SQLite、vectors、projection、projection log、run ledger、hooks、Dashboard 加起来是一套完整平台，不适合直接塞进 OAN 的极简 runtime。

2. **不符合 OAN 的 PendingAction 写入边界**  
   Webnovel Writer 的 skill 会实际写文件、数据库和投影。OAN 必须改成“生成 PendingAction / SemanticPatch，等待用户 diff 确认”。

3. **再造了类似提交链的结构**  
   `CHAPTER_COMMIT` 对它有意义，但 OAN 已明确 Git 是历史引擎，不应再造平行 VCS。

4. **事实源和派生层较复杂**  
   虽然文档说 `.webnovel/*` 是 read-model，但实际用户和 Dashboard 会强依赖这些产物。OAN 应坚持对象文件树为主，派生物可删除重建。

5. **Claude Code 绑定较强**  
   Skill、Agent、hook 都是 Claude Code 插件形态。多宿主适配仍在 spec 阶段。

6. **文档存在轻微漂移**  
   skill 数量、agent 数量、部分架构描述与当前目录之间存在不一致，分析时应以实际文件为准。

7. **GPL-3.0 许可证风险**  
   OAN 不应复制它的 prompt、schema 文案、模板或代码。只能吸收抽象设计和 workflow 经验。

## 与 OAN 的关键差异

| 维度 | Webnovel Writer | OAN |
|------|-----------------|-----|
| 产品形态 | Claude Code 插件 | Filesystem-first Novel IDE / Copilot |
| Runtime | Python CLI + Skill + Agent + projection | Aider-style 极简 tool loop |
| 写入 | 运行时直接写项目文件和 read-model | PendingAction / SemanticPatch / Git diff 审批 |
| 事实源 | `.story-system` 主链 + `.webnovel` 投影 | Markdown / YAML / Object File Tree |
| 历史 | CHAPTER_COMMIT + backup + Git 校验 | Git 是历史引擎 |
| 多 agent | 当前流程强制 subagent | 默认不引入重型多 agent runtime |
| Dashboard | FastAPI 只读面板 | 可参考，但不改变核心事实源 |
| 许可证 | GPL-3.0 | 只能学习抽象，不复制实现 |

## 证据来源

- `reference-only/webnovel-writer/README.md`
- `reference-only/webnovel-writer/CHANGELOG.md`
- `reference-only/webnovel-writer/.claude-plugin/marketplace.json`
- `reference-only/webnovel-writer/webnovel-writer/.claude-plugin/plugin.json`
- `reference-only/webnovel-writer/webnovel-writer/README.md`
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
- `reference-only/webnovel-writer/webnovel-writer/scripts/data_modules/webnovel.py`
- `reference-only/webnovel-writer/webnovel-writer/scripts/data_modules/chapter_commit_service.py`
- `reference-only/webnovel-writer/webnovel-writer/scripts/data_modules/run_ledger.py`
- `reference-only/webnovel-writer/webnovel-writer/scripts/data_modules/prewrite_validator.py`
- `reference-only/webnovel-writer/webnovel-writer/hooks/hooks.json`
- `reference-only/webnovel-writer/webnovel-writer/hooks/guard_runtime_write.py`
- `reference-only/webnovel-writer/webnovel-writer/dashboard/app.py`
- `reference-only/webnovel-writer/webnovel-writer/references/index/reference-loading-map.md`
- `reference-only/webnovel-writer/docs/architecture/overview.md`
- `reference-only/webnovel-writer/docs/architecture/context-minimal-writing-flow-plan-2026-06-05.md`
- `reference-only/webnovel-writer/docs/architecture/story-repo-spec-2026-06-10.md`
- `reference-only/webnovel-writer/docs/memory/long-term-memory-architecture-v2.md`
