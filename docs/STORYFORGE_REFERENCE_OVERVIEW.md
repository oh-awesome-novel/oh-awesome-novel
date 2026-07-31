# StoryForge 参考项目现状分析

> 范围：本文分析 `reference-only/storyforge` 当前检出的最新主线，说明 StoryForge 作为 OAN 早期灵感来源在当前阶段的真实形态，并与 OAN 的稳定架构事实进行对照。
>
> 旧基准：本文上一版使用 `f0389bb`（2026-06-19，`Merge remote-tracking branch 'origin/main'`）。
>
> 新基准：`main@f3316b119175ce1f630f8fc5469cd5cab5a009ca`（2026-07-31），与 `origin/main` 一致。该提交只是流量数据归档；最新功能提交为 `efe8f04`（2026-07-27，`feat: add shared simulation runtime core`）。
>
> 检出状态：参考目录当前已检出最新 `main`，本文所列证据路径均可直接在工作树中阅读。
>
> 验证范围：本次对最新主线快照运行了 required tables、AI manual、architecture、source reachability、roadmap、agent context、Canon coverage 和 project metrics 检查；没有成功运行完整 Vitest，原因见“工程治理与验证状态”。

## 结论概览

StoryForge 当前仍是一个 **纯前端、local-first、IndexedDB 驱动的小说创作平台**。它依然不是 filesystem-first，也不是 Aider-style runtime；React UI、Zustand store、Dexie schema、Prompt 模板、Context Source 注册表和 Adoption Schema 仍然是主体。

但上一版中“StoryForge 主要是面板式 Copilot，Chat Agent 与 Background Agent 只存在于设计文档”的判断已经失效。最新主线已经落地：

- 单一前台主 Agent 对话入口。
- 14 个受作用域和预算约束的只读工具。
- 严格 JSON 动作协议的只读 `AgentRunner`。
- 世界来源、角色、灵感、大纲、正文五个固定领域的幕后调度。
- 可持久恢复、可编辑、需作者明确确认的 Agent 候选。
- 统一“整理本章”六领域结构提取。
- 保存后零 token 确定性一致性守卫，以及作者主动触发的 Fast / Deep Audit。
- 可见资料与检索库、独立自由节点模式、共享模拟运行时地基。

更准确的当前定位是：

```text
StoryForge
  =
Local-first Authoring Platform
  +
Panel / Workflow / Node 创作界面
  +
Bounded Main Agent Orchestration
  +
Long-form Consistency And Canon Layer
  +
Visible Retrieval Layer
  +
Early Simulation Runtime
```

它已经不是只有 prompt panel 的工作台，但也不是开放式、并行自治或常驻后台的通用多 Agent 平台。

## 版本变化规模

从上一版基准 `f0389bb` 到最新主线 `f3316b1`：

- 348 个提交。
- 872 个文件变化。
- 约 99,446 行新增、30,074 行删除。
- 提交主题中约有 89 个 feature、48 个 fix、28 个 refactor、93 个 docs、12 个 test 和 56 个 chore。
- package 版本从旧基准推进到 `3.9.0`。
- `v3.9.0` tag 位于 `0aa9030`；其后主线还有 9 个非合并功能提交，集中补齐 RAG、Agent 领域、预算、章节整理、一致性和模拟运行时。

这不是一次小幅修补，而是从“小说 AI 工作台”向“本地创作平台”扩张的一轮密集开发。

## 当前技术形态

StoryForge 仍是浏览器端单体应用：

- 前端：React 19、Vite 6、TypeScript 5、Tailwind、TipTap。
- 状态管理：Zustand。
- 本地数据库：Dexie + IndexedDB。
- AI 接入：浏览器侧调用 OpenAI-compatible chat / embedding 接口，用户配置 provider、baseURL 和 API key。
- AI 输出：流式文本、结构化 JSON 适配器、GenerationNode、候选确认。
- 路由：React Router 8。
- 测试与工程检查：Vitest、Playwright、TypeScript、ESLint、架构守卫、注册表校验、AI manual、项目指标、依赖审计和 bundle budget。
- 许可证：MIT。

StoryForge 仍没有独立业务后端，也没有文件系统对象树作为小说数据源。小说 Canon、Agent 过程数据、节点图和模拟存档都以 IndexedDB 表为中心；JSON、Markdown 和快照主要承担导出、备份或人类可读交换，而不是源数据。

## 数据模型与三注册表

最新 `PROJECT_TABLES` 精确登记了 **58 张表**，不再是上一版文档中的“约 45 张”。这些表包括 Canon、创作过程、派生缓存、临时导入状态和本地系统状态。

主要增量如下：

- 长篇一致性：`temporalFacts`、`knowledgeLedger`、`storylineProgress`、`storylineCrossings`。
- 世界与成长：`cultivationSystems`、`cultivationProgress`。
- 创作方案：`characterDrivenPlans`、`inspirationWorkspaces`。
- Agent 过程：`agentConversations`、`agentEvents`。
- 节点模式：`nodeFlows`、`nodeRuns`。
- 参考分析版本：`referenceAnalysisRuns`、`referenceAnalysisSources`。
- 模拟运行时：`simulationSessions`、`simulationEvents`、`simulationCheckpoints`。
- 可重建检索：`retrievalChunks`、`narrativeSummaryNodes`。

数据库 schema 已推进到 v48。项目删除、世界删除、导出导入、引用重映射和部分级联行为继续由 `PROJECT_TABLES` 派生。

StoryForge 的三注册表纪律现在更明确：

- `CONTEXT_SOURCES + assembleContext()`：统一 AI 读取。
- `FIELD_REGISTRY + ADOPTION_SCHEMAS + adopt()`：统一结构化写回。
- `PROJECT_TABLES`：统一表生命周期与便携引用。

这套纪律仍是 StoryForge 最值得 OAN 参考的工程思想之一，但实现载体是 Dexie 表，而不是文件对象树。

## AI 上下文与可见 RAG

最新 `CONTEXT_SOURCES` 有 **45 个命名来源**。除旧有的章节、大纲、世界观、角色、规则、状态和参考资料外，新增或强化了：

- `projectStatus`：紧凑项目状态。
- `worldGroups`：世界目录与连接。
- `outlineTree`：有界大纲树。
- `searchResults`：当前项目 / 世界内本地短摘搜索。
- `ragSelection`：稳定资料 ID 与字段级精确选择。
- `writtenChapterProgress`：已写章节进度。
- `currentFacts`：当前有效已确认事实。
- `canonAssertions`：来源仍有效的世界宪法。
- `characterKnowledge`：角色认知投影。
- `storylineProgress`：故事线动态进度。
- `cultivationProgress`：修炼进度。
- `characterDrivenPlan`：当前激活的角色驱动方案。
- `inspirationWorkspace`：作者明确保存和选择的灵感碎片。
- `characterFacts` / `characterPassages`：角色反向哺喂证据。

`assembleContext()` 仍负责 requirements 检查、单源预算、总窗口预算、L0-L3 优先级裁剪，以及 included / omitted / trimmed / token 元数据。

RAG-1 又增加了“资料与检索库”产品层：

- Canon 仍保存在原业务表，不复制一份 RAG 正文表。
- 源记录获得稳定 `ragDocumentId` 和字段级 `ragPolicy`。
- 作者可启用 / 停用记录或字段，调整权重与 token 上限。
- 节点运行冻结实际 included / omitted / trimmed 证据。
- 删除派生索引不删除原始作品数据。
- 章节继续使用关键词块、层级摘要和可选 embedding。
- 非章节资料当前主要是精确字段选择与本地内容搜索，没有被宣称为已经全面向量化。

因此最新 StoryForge 的检索结构更准确地分为：

```text
Canon 业务表
  ↓ 实时投影
可见资料目录与检索策略
  ↓
CONTEXT_SOURCES / ragSelection
  ↓
运行时真实召回证据

章节正文
  ↓
retrievalChunks / narrativeSummaryNodes
  ↓
关键词 + 可选 embedding
```

## 主 Agent、只读 Runner 与领域执行

StoryForge 当前同时存在两个不同层次的 Agent 执行机制。

### 只读 AgentRunner

`AgentRunner` 使用 provider-neutral 的严格 JSON 动作协议，而不是原生 function calling：

```json
{"type":"tool","calls":[{"name":"read_project_status","arguments":{}}]}
```

或：

```json
{"type":"final","answer":"基于工具证据的最终答复"}
```

当前工具注册表有 14 个只读工具，覆盖项目状态、世界观、故事核心、角色、大纲、章节、历史、规则、伏笔、物品、时间线、世界目录、本地搜索和灵感工作区。

重要边界：

- 工具参数不能覆盖当前 `projectId` / `worldGroupId`。
- 跨项目 ID、未选世界和不可见角色会失败关闭。
- 每个工具有独立输入预算与裁剪元数据。
- 不开放 shell、任意 URL、网络搜索或任意工具执行。
- 默认最多 8 次模型调用、8 次工具调用、48K 模型 token、24K 工具结果 token。
- 相同工具与相同参数重复会按循环处理。
- 协议、预算、取消和工具失败都有明确停止原因。

它是一个受控只读循环，但不是 OAN 采用的 AI SDK ToolSet / Aider-style runtime。

### 主 Agent 与五领域调度

工作区右栏已经有真实的 `ChatCopilotPanel`。用户只面对一个主 Agent，主 Agent 把请求规划为固定五领域任务：

- `world-origin`
- `character`
- `inspiration`
- `outline`
- `prose`

当前实现特点：

- 每个领域一轮最多一个任务，最多五个任务。
- 模型计划会经过确定性清洗，越权领域被移除，同领域重复任务被合并。
- 任务通过 `dependsOn` 形成依赖图，当前按拓扑顺序串行执行。
- 上游未确认候选可以作为显式 non-Canon 输入交给下游生成，但下游采纳前必须先采纳依赖候选。
- 编排器和五个领域可分别绑定 provider / model。
- 五领域可分别选择精简、均衡或完整上下文档位。
- 整轮共享节省、均衡或充分预算。
- 确定性 Canon gate 最多触发一次受预算修正；网络错误、解析错误和软审错误不自动重试。
- 候选、计划、任务状态、错误、确认和拒绝保存在 `agentConversations / agentEvents`。
- 刷新后候选可恢复，恢复路径仍重新执行并发快照校验。

正文领域只支持：

- 对空白章节生成正文。
- 对非空章节显式续写。

它不会默认覆盖已有手稿。

所以当前主 Agent 更像：

```text
单一对话入口
  ↓
模型规划 + 确定性清洗
  ↓
固定领域 GenerationNode 串行执行
  ↓
持久化可编辑候选
  ↓
作者逐项确认
  ↓
adopt() 写入 IndexedDB Canon
```

它已经是实际 Agent 产品，但仍不是并行自治团队、Agent 间自由对话、长期后台执行或通用 planner 平台。

## Prompt、Workflow 与自由节点模式

原有 Prompt 系统仍然存在：

- system / user prompt 分离。
- `{{var}}` 与条件片段。
- 参数、examples、临时覆盖和用户版本。
- PromptModuleKey 与 AI usage category。
- 线性 `PromptWorkflow` 与暂停确认。

最新主线又增加了独立的 Node Mode。它不是 `PromptWorkflow` 的画布皮肤，而是单独的项目过程数据：

- 文本、项目来源、处理、创作、校验、输出六类节点。
- 动态输入端口和自由连线。
- DAG 校验、局部运行和祖先闭包执行。
- 逐节点冻结配置、上游输入、来源证据、输出、错误与 gate。
- `nodeFlows / nodeRuns` 可恢复、可导出导入。
- 输出只有经过明确确认后才能写入 Canon。

当前尚未完成：

- 条件和循环。
- 并行模型调用。
- 脚本 / 插件节点。
- 脏下游自动失效。
- 图模板库。
- 主 Agent 自动生成节点图。

StoryForge 因此已经同时维护 Panel、PromptWorkflow、NodeFlow、只读 AgentRunner 和主 Agent Orchestrator 多种执行原语。这扩大了产品能力，也显著增加了整体复杂度。

## 长篇一致性与 Canon

上一版把 StoryForge 的长期记忆概括为工作上下文、章节后状态和长期语义资产。最新实现已经具体化为多条代码闭环。

### 章节连续性

- 规范章节顺序不依赖记录创建顺序。
- 一次 `chapter.memory` 调用同时生成摘要、continuity handoff 和计划对账。
- 正文标准化 SHA-256 与 CAS 防止旧异步结果覆盖新正文。
- 计划对账区分已完成、未完成、偏移和新增约束。
- 未来章节和异世界资料在进入正文生成前被硬过滤。

### 双层事实与世界宪法

- `temporalFacts` 将抽取 observation 与 confirmed Canon 分层。
- 模型只能使用受控谓词。
- 引文必须能回查正文。
- 单值状态确认时按规则 supersede 旧事实。
- stale / source-missing / invalid-range 不进入生成上下文。
- 世界宪法复用事实账本，以登记来源、主题、主体和引文形成候选。

### 角色知识与故事线

- `knowledgeLedger` 区分世界真相与角色获知、误认、遗忘、纠正。
- `characterKnowledge` 按章节、世界和角色投影目标章开始前的认知。
- 角色存亡由已确认事实投影，不依赖 LLM 自由判断。
- `storylineProgress / storylineCrossings` 记录作者确认的故事线阶段与交汇。
- 未来故事线进度不会泄漏给前章。

### 检索、摘要与影响分析

- `retrievalChunks` 是可重建章节缓存。
- 关键词召回默认可用；embedding 默认可选，失败退回关键词。
- `narrativeSummaryNodes` 提供章→卷→全书的确定性派生摘要树。
- 历史正文修改会使来源事实或派生摘要 stale，并列出后续复核范围。
- 派生摘要和向量都不被当作 Canon。

### 一致性 Agent

正文保存后会运行零 token 的后台确定性守卫。目前它主要检查物品重复获得；没有发现时不生成归档记录。

作者主动运行一致性审校时：

- Fast Guard 使用约 16K 登记上下文。
- Deep Audit 使用约 32K 登记上下文。
- 每次最多调用模型一次。
- 模型只负责提出带正文引文和登记证据的 finding。
- 物品、认知和存亡的硬判继续由确定性代码完成。
- 报告绑定正文 hash，正文变化后显示过期。
- 报告没有 adoption 路径，不会自动修改正文或 Canon。

这比上一版的“有 ReviewPanel 与部分状态 diff”成熟很多。

## 实际章节写作与章后整理

生成 / 续写的主流程仍保留明确的人类采纳：

1. 读取章节、大纲、世界、角色、规则、事实、知识、状态、伏笔、故事线、检索片段等登记上下文。
2. 组装 continuity block 与 token budget。
3. 通过 GenerationNode 或流式入口生成候选。
4. 用户预览并采纳正文。
5. 重建当前章检索块和派生摘要。
6. 自动提取角色状态 diff，等待确认。
7. 自动生成章节摘要和 continuity handoff，并原子写回派生记忆字段。

需要注意：自动后处理仍不是完整 settlement。它主要执行“状态提取 + 章节记忆”。

完整 settlement 已由显式“整理本章”入口实现。一次调用生成六类候选：

- 角色状态。
- 时序事实。
- 物品流水。
- 故事年表。
- 角色关系。
- 伏笔推进。

该流程具有以下约束：

- 每条候选必须包含正文逐字证据。
- 状态、实体、枚举、关系和伏笔状态迁移都经过既有解析器或闭集检查。
- 整批候选绑定正文 SHA-256。
- 候选保存到独立归档 Agent 事件中，刷新可恢复。
- 作者可按领域、逐项选择。
- 事实采纳后仍只成为 candidate，不直接升 Canon。
- 物品与时间线按 chapterId 原子替换；新批次失败时保留旧数据。
- 各领域分别记录 adopted / failed / skipped，不把部分失败伪装成整批成功。

因此上一版“角色状态 diff 是最明确闭环，完整 settlement 仍未落地”的结论已经不再成立。更准确的结论是：

> StoryForge 已有显式、可恢复、逐项确认的统一章节整理闭环；但它不是每次生成后的全自动后台 settlement。

## 参考资料分析的最新形态

参考分析已经从单次覆盖式 pipeline 升级为版本链：

```text
references
  └─ referenceAnalysisRuns
       ├─ referenceChunkAnalysis
       └─ referenceAnalysisSources
```

每次分析 run 绑定：

- 文件名与文件 hash。
- 分析深度。
- 来源类别与权利说明。
- 使用范围。
- 独立 chunk 集合、进度、总结和错误。

状态机为：

```text
upload → analyzing → ready ──activate──→ active
            │                    ▲          │
            ├─ failed            │          └─ activate another → superseded
            └─ cancelled         └──── rollback
```

关键安全边界：

- 首版可自动成为 active；后续版本完成后保持 ready，必须由作者激活。
- 新版失败或取消不会覆盖最后一个可用 active 版本。
- `buildRefAnalysisContext()` 只读取唯一 active run。
- 原文保存在本地 `referenceAnalysisSources`，只用于刷新续跑，不进入项目 JSON。
- `rawExcerpt` 必须回查对应原文块，否则不落库。
- 研究资料或来源待确认材料会被强制限制为 analysis-only。
- 每份参考最多保留 6 个 run，active / ready / analyzing 不会被静默删除。
- 版本、分块和引用可以随 JSON 导出导入重映射，断点原文不导出。

当前仍未完成：

- 角色终态、事件因果、结局状态等结构化剧情连续性胶囊。
- 原稿续写或整本回灌。
- 默认模仿参考作者的可识别声音。
- 对来源权利的法律核验。

这一版参考系统对 OAN 的价值不在 prompt 文本，而在“新分析不覆盖 active、来源 hash、显式激活、失败隔离、引文回查、版本回滚”的产品纪律。

## 模拟运行时现状

StoryForge 最新功能提交建立了共享模拟运行时 `SIM-1A`，用于未来的跑团、NPC 演进和角色聊天冒险。

当前数据包括：

- `simulationSessions`
- `simulationEvents`
- `simulationCheckpoints`

运行时特征：

- 严格 append-only 事件序列。
- 纯 reducer 回放时间、实体、记忆、随机与叙事事件。
- 会话种子 + 事件序号 + 骰式 + nonce 决定确定性骰子结果，调用方不能提交自选点数。
- 检查点保存 state hash，可重新回放验证。
- 会话可从指定序号分支。
- 父子会话、事件与检查点进入项目 / 世界删除及导出导入生命周期。
- 工作区已有沙盒、NPC 演进、跑团和角色聊天四类会话壳。

但这只是共同运行时地基：

- 新会话尚未真正冻结作者选择的世界、角色、地点、物品和规则。
- 没有完整运行时实体投影。
- 没有正式 AI 行动候选闭环。
- 检查点目前用于验证和分支，不等于完整恢复产品。
- 四类入口不代表 TTRPG 或角色聊天已经完成。

与 OAN 当前 Play Mode 相比，StoryForge 在事件回放与分支存档上提供了可参考的底层模型，但在 branch-local knowledge、world referee、typed intervention、variant、settlement 和 Human Approval 方面仍明显更早期。

## 工程治理与验证状态

GOV-1 显著加强了工程约束：

- 架构守卫使用 TypeScript AST 扫描 `src/lib` 写回旁路。
- 旧 context builder 只能由 `CONTEXT_SOURCES` 内部调用。
- AI 写回必须走 `adopt()` 或有到期复审日期的领域扩展。
- AI Manual 使用 AST 生成并由独立测试验证。
- required tables、源码可达性、路线图、项目指标、依赖安全、覆盖率和 bundle budget 进入 CI。
- `check:agent-context` 控制固定项目上下文膨胀。
- `check:canon-coverage` 要求 Canon 声明和可执行反例双向对应。

本次对 `origin/main` 导出的临时快照独立运行并通过：

- 58 张 required tables 与 schema 一致。
- AI manual 与代码一致。
- architecture guard。
- 509 个源码文件从声明入口可达。
- roadmap 检查。
- agent context 检查；固定项目入口相对旧强制链缩小 97.6%。
- 6 个 Canon 场景全部有可执行测试声明。
- Blueprint 项目指标检查。

完整 `npm test` 没有形成有效验证：参考目录当前 `node_modules` 使用 Vitest 4.1.8，而 package 声明 Vitest 2.1.9，并缺少 `fake-indexeddb`。169 个 suite 在 setup import 阶段统一失败，实际测试均未执行。这是本地依赖安装状态问题，不能据此判定代码失败，也不能把上游文档声称的测试数量当成本次独立验证结果。

文档漂移也没有完全消失：最新 `docs/ARCHITECTURE.md` 仍保留 2026-05-14 的旧目录和“39 张表”描述。当前现状应优先以 `docs/roadmap/CAPABILITY-BASELINE.md`、生成指标、注册表与实际代码为准。

## 值得肯定的工程优点

1. **AI 读、生成、写边界更清楚**
   Tool Registry 只读；生成落到 GenerationNode；正式写回落到 adoption。主 Agent 没有获得任意数据库或外部工具权限。

2. **候选过程可恢复、可审计**
   Agent 计划、任务、上下文证据、候选、确认、拒绝和错误进入追加事件。刷新不会丢失未确认候选。

3. **上下文预算开始成为产品信息**
   不只内部裁剪，还向作者展示实际 included / omitted / trimmed、输入档位和团队预算。

4. **LLM 抽取与确定性判决分离**
   模型负责找到正文引用；物品、认知、存亡、时序和部分 Canon 冲突由代码闭集判断，降低软审结果被误当硬事实的风险。

5. **统一章节整理终于形成产品闭环**
   六领域候选、逐字证据、正文 hash、逐项采纳、部分失败记录，比散落的多个抽取按钮更接近稳定 settlement。

6. **RAG 可见而且不复制第二份 Canon**
   稳定资料 ID、字段策略和运行证据值得参考；派生索引可以删除重建，不能反向覆盖正式数据。

7. **参考分析具备版本隔离**
   新分析失败不破坏 active、引文回查、来源声明和显式激活都适合长期项目。

8. **复杂度增长伴随了自动治理**
   AST 架构守卫、源码可达性、Canon coverage 和生成指标，至少让快速扩张有可执行约束。

## 当前限制与风险

1. **仍然不是 filesystem-first**
   IndexedDB 是所有 Canon、过程数据和模拟存档的中心。它不符合 OAN “Markdown / YAML / Object File Tree 是数据库”的稳定事实。

2. **没有 Git diff 级人类确认**  
   StoryForge 有候选卡、adopt gate 和 diff UI，但不存在对真实文件的 Git diff 审批。一些派生记忆和缓存会在正文采纳后自动写入 IndexedDB。

3. **执行原语明显增多**
   Panel、PromptWorkflow、NodeFlow、AgentRunner、Master Orchestrator、Chapter Organization 和 Simulation Runtime 同时存在。边界虽然有文档和守卫，但理解成本已经远高于上一版。

4. **主 Agent 不是通用 tool-calling runtime**
   只读 Runner 使用自定义 JSON 协议；主 Agent 又走固定领域 orchestrator。二者没有收敛为一个极简循环。

5. **所谓“领域 Agent 团队”仍是固定串行执行器**
   没有并行自治、模型投票、Agent 间自由协商或长期后台循环。产品文案中的“后台领域 Agent”不应被误读为通用多 Agent 平台。

6. **受控 Canon 自动打回仍属于自动重试**
   虽然最多一次、受预算约束且只由确定性问题触发，但这与 OAN 明确避免 hidden retry engine 的原则不同，不能直接照搬。

7. **章节后自动流程与完整整理仍是两条路径**
   自动状态 / 记忆与显式六领域整理并存。若继续扩展，可能出现重复抽取、候选重叠和用户对“何时已结算”的理解成本。

8. **RAG 能力分层不均匀**
   章节有混合检索与层级摘要；非章节资料主要靠精确选择和本地搜索。当前边界是诚实的，但不能概括为“所有小说资产都已有语义检索”。

9. **模拟运行时仍是空 Canon 快照地基**
   还不能承担正式跑团或角色聊天体验，更不能作为成熟产品与 OAN Play Mode 等量比较。

10. **文档事实源仍有分裂**
    `docs/ARCHITECTURE.md` 已明显落后，Capability Baseline、Blueprint、专题设计和代码注册表共同承担现状说明。使用时仍需判断文档权威层级。

## 与 OAN 的定位差异

StoryForge 和 OAN 现在都关心：

- 长篇上下文选择与预算。
- 世界、角色、大纲、正文、状态、时间线和伏笔。
- 章节后整理与一致性检查。
- 可见候选、人类确认和过程恢复。
- 参考作品拆解、来源证据和差异化约束。
- 场景模拟、分支和角色知识。

但底层哲学仍然不同：

- StoryForge：浏览器 local-first；IndexedDB 是数据库；UI、Dexie schema 和多个创作执行器是中心。
- OAN：filesystem-first；Object File Tree 是数据库；Git 是历史引擎；SemanticPatch、PendingAction 和 Git diff 是正式写入边界。

StoryForge 的最新变化没有推翻 OAN 的架构选择，反而强化了 OAN 保持简单核心的必要性。StoryForge 已增长到 58 张注册表、45 个上下文源和多套 runtime；OAN 不应为了追随功能表面而引入同等复杂度。

## 对 OAN 的具体参考建议

### 建议吸收

1. **候选卡展示实际上下文证据与预算**
   OAN 已有 `ContextPackage.trace`、selected / omitted 和 session artifacts，可以在 UI 中进一步展示 included / omitted / compressed、预算和候选依赖。

2. **把 `/整理本章` 做成具体的多域确认界面**
   OAN 已有 `ObservationLog`、`SettlementBundle` 和 PendingAction 设计。可以对照 StoryForge 的六领域候选、逐字证据、正文 hash、逐项采纳和部分失败状态，复核端到端 UI / Apply Engine 是否完整。

3. **参考分析版本的 active / ready 隔离**
   OAN 已有 run store、resume、source drift、publication 和 accepted bundle。可借鉴“新 run 失败不覆盖 active、版本差异、显式激活 / 回滚”，但继续使用 filesystem-first run 与 publication 文件，而不是 Dexie 表。

4. **确定性 Canon guard 与 LLM finding 分离**
   OAN 可以继续强化 closed-set validator、引用回查和时序投影；确定性失败应形成可见 warning / repair candidate，而不是隐藏自动重试。

5. **可见资料目录与最近实际召回**
   OAN 不需要向量数据库，也可以基于对象文件树、reference index 和 ContextPackage trace 提供可见来源清单、启用状态和最近使用证据。

6. **模拟存档的事件连续性与检查点校验**
   StoryForge 的确定性骰子、严格序号、状态 hash 和分支元数据可以作为 OAN Play 存档底层的反例参考；不应替换 OAN 已完成的 world referee、branch-local knowledge、variant 与 settlement 设计。

### 不建议吸收

- IndexedDB 作为小说真相源。
- 58 表式领域生命周期。
- 自定义严格 JSON Agent 协议替代 AI SDK ToolSet。
- 固定五领域多 Agent 调度进入 `packages/runtime`。
- 多套 workflow / node / agent runtime 同时成为核心抽象。
- 自动 Canon retry 或隐藏修订循环。
- embedding、摘要或 Agent event 成为 truth files。
- 未经 PendingAction / diff 的真实目标写入。

## OAN 当前相对位置

OAN 已经具备或超过 StoryForge 对应能力的部分包括：

- `ContextPackage.trace` 与 session artifact autowiring。
- reference distilled selector、included / omitted reason、no-copy guardrail。
- Observation-first review / settlement schema。
- PendingAction、shadow recovery、SemanticPatch Apply Engine 和 Git diff approval。
- Play Mode 的 branch-local knowledge、world referee、typed intervention、variant、checkpoint、settlement 和明确 adoption path。

StoryForge 目前更适合作为 OAN 的：

- Agent 候选 UI 与预算可见性参考。
- 统一章节整理交互参考。
- 长篇 Canon 确定性校验反例库参考。
- 参考分析版本管理参考。
- 可见资料目录与检索审计参考。

不适合作为 OAN 的 runtime、持久化或写入架构模板。

## 主要证据路径

参考目录当前已检出最新 `main`，以下证据路径可以直接在工作树中阅读：

- `package.json`
- `CHANGELOG.md`
- `docs/roadmap/CAPABILITY-BASELINE.md`
- `docs/AUTHORING-PLATFORM-DESIGN.md`
- `docs/AGENT-RUNNER-DESIGN.md`
- `docs/AGENT-TOOL-REGISTRY-DESIGN.md`
- `docs/RAG-VISIBLE-LIBRARY.md`
- `docs/REFERENCE-ANALYSIS-EVOLUTION-DESIGN.md`
- `docs/SIM-RUNTIME-DESIGN.md`
- `docs/INTERACTIVE-RUNTIME-ROADMAP.md`
- `src/lib/agent/runner.ts`
- `src/lib/agent/tool-registry.ts`
- `src/lib/agent/orchestrator.ts`
- `src/lib/agent/team-budget.ts`
- `src/lib/agent/team-execution.ts`
- `src/lib/agent/canon-validator.ts`
- `src/lib/agent/chapter-organization.ts`
- `src/lib/agent/consistency-agent.ts`
- `src/components/agent/ChatCopilotPanel.tsx`
- `src/components/agent/useMasterCopilot.ts`
- `src/components/editor/ChapterEditor.tsx`
- `src/components/editor/ReviewPanel.tsx`
- `src/lib/registry/context-sources.ts`
- `src/lib/registry/assemble-context.ts`
- `src/lib/registry/project-tables.ts`
- `src/lib/reference-analysis/pipeline.ts`
- `src/lib/reference-analysis/lifecycle.ts`
- `src/lib/retrieval/rag-library.ts`
- `src/lib/retrieval/retrieval.ts`
- `src/lib/simulation/runtime.ts`
- `src/lib/types/simulation-runtime.ts`

本文只吸收设计与现状判断，不建议直接复制 StoryForge 的源码或 prompt。即使其许可证已明确为 MIT，OAN 仍应遵循自身的独立架构、reference no-copy 约束和人类确认工作流。
