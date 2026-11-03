# InkOS 参考项目现状分析

> 范围：本文分析 `reference-only/inkos` 当前检出的最新主线，并与 OAN 的稳定架构事实进行对照。
>
> 当前基准：`53adac4e974b54dafda975edc4edd07cad364c18`（2026-10-24，`docs: remove clickable Kimi sponsor links`）。应用 / `core` / `cli` / `studio` 版本均为 `2.0.0`。
>
> 旧基准：本文上一版使用 `a6e05d4d4567df0efd5825e9b0037146a16e4f3e`（2026-08-03，版本 `1.7.2`）；再早为 `b0cc9a54`（2026-07-28）和推定基准 `3f9b4e80`，仅用于保留长期变化背景。
>
> 本轮增量：从 `a6e05d4d` 到当前共 131 个提交，730 个文件变化，约 36,063 行新增、94,915 行删除。绝大多数提交是 v1.8.0 与 2.0 的 “Creative Harness v2” 重构；2026-10 的 6 个提交只改赞助 / 推广文案。
>
> 验证范围：本文以实际源码、提交历史、`spec/creative-harness-v2.md`、`docs/harness-result-first-redesign.md` 和包清单为准。本轮只读源码，没有安装依赖、构建或运行测试；测试通过数字均为 InkOS 自己记录的结果，详见“工程验证状态”。
>
> 阅读提示：第 “2.0 Creative Harness v2” 节取代旧文中关于 Chat 工具表、`books/` 目录权威、确认卡、Skill 数量与材料检索的描述；其余旧章节中仍与 2.0 冲突之处已就地标注“2.0 更新”。

## 结论概览

InkOS 当前（2.0.0）已经从“小说章节生产流水线 + Studio / CLI”重构成一个围绕 **Work / Artifact / Revision + Capability 工具 + Episode 账本** 的 **filesystem-persisted Story Creation Agent**。1.x 的 “Chat Agent 调工具 + 各类作品管线” 被收敛为单一 pi-agent 生产 harness；Pipeline 降为可被 capability 直接调用的确定性能力：

- 长篇、短篇、同人、番外、续写和仿写。
- 剧本、分镜、互动影游和封面。
- Open World / Branching Play。
- EPUB / PDF / TXT / Markdown 长文翻译。
- 可追溯研究、材料归档和本地召回。
- 非正史剧情多线推演。
- Studio Chat、TUI、CLI、外部 Agent Skill 入口。
- 后台生产任务、daemon、通知和多模型路由。
- 章节版本工作区、安全改写预览和下游失效标记。
- 章节正文与主要状态投影的多文件 staged commit / rollback。
- 单任务、最多 20 章的顺序批量写作与 LM Studio 本地 provider。
- 统一 `works/<id>/` 作品库、按 Profile 装配的 capability 工具、可校验 checksum 的产物版本、结构化 Action 观察、SQLite Episode 账本和带 journal 的原子文件集（2.0）。
- 20 个内置标准 `SKILL.md` 专业能力包、SQLite FTS5 / BM25 统一本地检索、书籍参考资料绑定（1.8 / 2.0）。
- 旧项目通过 `inkos work migrate` 预览并导入统一作品库（2.0）。

它的核心形态可以概括为：

```text
InkOS
  =
Filesystem-persisted Story Production System
  +
pi-agent Tool Loop And Confirmable Action Surface
  +
Multi-stage Writing / Review / Settlement Pipeline
  +
Structured Runtime State And Derived Memory Index
  +
Play / Interactive Film / Translation Domain Runtimes
  +
Studio + CLI + TUI Product Shells
```

2.0 之后更准确的形态是：

```text
InkOS 2.0
  =
Work / Artifact / Revision Library (works/<id>/work.json)
  +
Profile-scoped Capability Tools on pi-agent (Skills = guidance only)
  +
Structured ActionResult / Observation + SQLite Episode Ledger
  +
Deterministic Domain Pipelines (long / short / script / film / play / translation)
  +
Atomic File Set (journal + recovery) + checksum-verified Revisions
  +
Studio + CLI + TUI Product Shells
```

“filesystem-persisted”不等于 OAN 意义上的 filesystem-first：InkOS 确实把正文、JSON、Markdown、JSONL 和运行产物放在项目目录，但正式变更由工具与流水线直接写入，没有 CandidateChangeSet、PendingAction、Git diff approval，也不以 Git 作为统一历史引擎。

上一版中仍然成立的判断是：InkOS 很适合参考产品化工作流、上下文治理、状态投影、provider 诊断和互动创作领域建模；不适合作为 OAN 的 Runtime 或写入架构模板。

2.0 新增的判断：InkOS 在“产物版本身份、结构化执行回执、局部修订范围保护、崩溃恢复”上明显向 OAN 的关注点靠拢，值得认真参考；但同时把 Profile 的默认确认策略改成“可恢复写入直接执行、仅破坏性写入确认”，**弱化**了 1.7.x 的确认卡，与 OAN 的 Human Approval 差距进一步拉大。

## 版本变化规模

**最新增量（`a6e05d4d` → `53adac4e`，v1.7.2 → v2.0.0）**：

- 131 个提交、730 个文件变化、约 36,063 行新增、94,915 行删除；净删除远多于新增，说明这是替换式重构而不是继续叠加功能。
- 关键提交：`8dee4cb2` 随包专业 Skill；`c56586ec` / `d1d6d8ec` / `e7c04465` 统一 pi harness；`127957a9` 建立 creative harness v2 契约；`b399a8d3`、`2c4dacaf` 删除 1.x 控制路径（单提交约 -17,973 / -1,961 行）；`fb8c8e3e` 替换旧质量状态机（约 -16,639 行）；`39a6af2e` 用 mini flow 替换防御性测试套件（约 -20,904 行）；`7e60e13f` 完成 2.0 创作工作流与恢复契约（251 个文件）。
- 发布线：v1.8.0（2026-08-17，统一 Pi harness、Skill 包、FTS5 检索、章节工作区）→ 2026-08-26 至 09-26 的 creative harness v2 → v2.0.0（`CHANGELOG.md` 尚未写入 2.0 条目，2.0 说明在 `README.md` 与 `spec/creative-harness-v2.md`）。
- 2026-10 的 6 个提交仅涉及 README / 推广文案（KK models、MCP 链接、Kimi sponsor），无源码行为变化。

**此前增量（`3f9b4e80` → `b0cc9a54`）**：


- 236 个提交。
- 343 个文件变化。
- 约 34,274 行新增、1,620 行删除。
- 提交主题中有 111 个 feature、62 个 fix、21 个 test、20 个 docs、3 个 refactor、8 个 chore，另有 11 个其他提交。
- 发布线从 v1.5 前后的状态推进到 v1.6.0、v1.7.0、v1.7.1 和 v1.7.2。

主要变化不是继续堆长篇 prompt，而是增加了多个独立产品域和运行边界：互动影游、标准 AgentSkills、材料库、Prompt Pack、翻译、剧情推演、后台任务、备份恢复和更严格的安全说明。

本轮从 `b0cc9a54` 到 `a6e05d4d` 又新增 10 个提交、53 个变化文件，约 2,649 行新增、145 行删除。增量集中在章节多文件原子落盘、Studio 章节改写工作区、顺序批量写章、LM Studio provider、后台任务重放修复和若干配置 / UI 缺口；应用版本号没有变化。

## 当前技术形态

InkOS 是 TypeScript monorepo：

- `packages/core`：领域模型、Agent、长篇流水线、交互层、Play、互动影游、翻译、材料与 provider。
- `packages/cli`：原子命令、自然语言入口、TUI、daemon、doctor、备份恢复和通知。
- `packages/studio`：React 19 + Hono + Vite 6 + Zustand 的本地 Web 工作台。
- Agent loop：`@mariozechner/pi-agent-core` 与 `@mariozechner/pi-ai` 原生工具调用。
- Provider：云端 / OpenAI-compatible（Chat Completions 与 Responses）/ Anthropic Messages / Ollama / LM Studio 本地 endpoint；协议格式集中在统一的 API format 模块（2.0 更新）。
- Schema：Zod 与 TypeBox。
- 持久化：JSON、Markdown、JSONL、YAML，以及 `node:sqlite`（Episode 账本、FTS5 检索投影、Play 图）。最低运行时 Node.js 22.16.0。
- 工程：Vitest、Playwright、TypeScript、ESLint 和发布清单检查。
- 许可证：实际 npm 包与源码为 `AGPL-3.0-only`；外部 Skill descriptor 的平台许可说明不能替代项目本体许可证。

根 package 与 `core` / `cli` / `studio` 版本均为 `2.0.0`（2.0 更新；上一版为 `1.7.2`）；`skills/SKILL.md` 是 Skill 描述包版本，不是 InkOS 应用版本。

## 2.0 Creative Harness v2

> 本节依据 `spec/creative-harness-v2.md`、`docs/harness-result-first-redesign.md`、`packages/core/src/harness/*` 与 README。它取代旧文中按 1.7.x “book session / Chat 工具表”描述的部分。

### 作品库：Work / Artifact / Revision

- 统一作品目录为 `works/<id>/`：`work.json` 记录 profile、状态（draft / active / archived）、lineage 与已登记 artifact，`source/` 保存工作文件。
- 每个 artifact 有 `revisions[]`，状态为 `candidate | current | superseded`，记录 `parentRevisionId`、路径、snapshot、`checksum`、字节数和产生它的 `episodeId`；schema 强制“至多一个 current 且 `currentRevisionId` 必须指向它”。
- `lineage` 用 `sourceWorkId / sourceArtifactId / sourceRevisionId` 保存跨作品派生（番外、同人、改编、翻译）的来源版本，而不是只存路径。
- 读取、审稿、导出都通过统一版本读取器解析已登记版本并校验 checksum；产物缺失返回带类型的可恢复错误；候选版本必须显式指定，不会因为“最新文件”被默认当作已采纳版本。
- 路径统一为 `/` 分隔的相对 artifact identity，拒绝绝对路径、盘符与 `..`，避免同一产物在 Windows 原生路径与登记路径之间产生竞争更新。
- 旧项目通过 `inkos work migrate`（默认预览，`--apply` 才导入）迁移；保留 legacy 源文件，冲突报告而不覆盖，缺少运行时状态的项目以 draft 进入作品库。

这与 OAN 的 Object File Tree + Git 思路最接近的一点是“产物有稳定身份和版本谱系”；差别是 InkOS 的版本链由 `work.json` + snapshot 维护，OAN 由 Git 提供。

### Profile + Capability：单一工具循环

- 内置 Profile：`workspace-default`、`longform-novel`、`short-fiction`、`script`、`storyboard`、`interactive-film`、`interactive-world`、`translation`、`visual-asset`；也可由项目 `.inkos/profiles/*.json` 覆盖（必须是普通文件、拒绝 symlink、Zod 校验）。
- Profile 声明 `capabilityIds`、`requiredSkillIds / recommendedSkillIds`、`artifactKinds`、`artifactSchemas`、上下文配方和确认策略。
- `createCapabilityPiTools` 把 Profile 允许的 capability action 编成 pi-agent 工具（`<capability>__<action>`）。每个 action 带 `risk`：`read | recoverable-write | destructive-write`。
- Studio、CLI、TUI 与 worker 共用同一工具循环；原先平行的“自然语言路由 / 并行 planner”被删除。Pipeline 作为 capability 的实现保留。
- 主模型与被委派 worker 都接收作者原始请求；创作方法写在 Skill 里，不替代作者指定的范围。委派草稿与审稿建议不能取代原请求。

### 确认策略：默认执行，仅破坏性写入确认

`ConfirmationPolicy` 有三项：`inferredMutation`、`explicitRecoverableMutation`、`destructiveMutation`。所有内置 Profile 当前都是：

```text
inferredMutation: execute
explicitRecoverableMutation: execute
destructiveMutation: confirm
```

系统提示明确要求：用户请求被允许的可恢复动作（含创建和生产）时直接调用，只有 Profile 或 action 要求确认时才使用 `workspace__propose_action`。`propose_action` 仍存在，但在默认 Profile 下基本不再出现。

对 OAN 的含义：InkOS 1.7.x 的 “重动作先出确认卡” 在 2.0 中被**放宽**为“可恢复写入直接执行”；正式写入既没有 CandidateChangeSet，也不再有开始前的确认卡。它给出的反面教材是：当版本、回执和恢复足够强时，产品倾向于撤掉人类门；OAN 的 Accept 必须继续是硬约束。

### 结构化 ActionResult / Observation

- `ActionResult` 包含 `status`、`summary`、`artifacts[]`（workId / artifactId / revisionId / path）、`observations[]` 与 `data`。
- 观察是结构化的：操作执行状态、交付检查、版本和选项分别保留；旧的文本拼接回执被替换。
- 有类型的错误在模型边界保留 `code` 与 `recovery`（建议的下一步 action 与参数），底层 Episode 保留原始错误。
- 质量发现与执行成功是两类结果：审稿未通过不等于导出失败，导出成功也不等于内容通过。
- 每次调用 harness 的 `read` 先压成“事实投影”，同一份投影也供压缩进度使用，避免两份选择逻辑漂移。
- 自述的代价：同一批 284 条历史回执，模型观察体积增加约 25.6%，没有拿到上下文成本下降的证据；文档明确说“JSON 化本身不是成功”。

### Episode 账本

`CreativeEpisodeStore` 使用 SQLite（WAL、`foreign_keys`、`busy_timeout`）保存 `creative_episodes` 与 `creative_episode_events`，事件含 `seq`、`type`、`workId`、`capabilityId`、`actionId` 与 payload，并记录 `owner_pid` 以识别僵尸 episode。设计强调：`Episode completed` 只表示本轮循环结束，**不**表示作品交付通过；验收不得从该字段推断成功。

### 局部修订与范围保护

- 局部修订只允许改作者授权的范围，范围外内容必须保留；请求的原始 baseline 在重试之间保持，可用于对比。
- 审稿自动读取“本轮开始时的作品快照”、当前原文与实际 diff；同轮多次修改不会把比较起点推进到中间稿；没有执行上下文时只比较登记的父版本，并标明范围。比较范围、版本、哈希和 diff 随审稿报告与回执保存。
- 修改成功的回执包含新版本和有长度上限的真实变化区域，供主模型核对“请求是否真的落实”。
- 导出副本被设为不可直接修订，在进入写作模型前返回正文来源。
- `artifact-edit-policy` 为领域维护的产物（如长篇 `story/`、`chapters/`，互动世界 `runs/`，影游 story graph）拒绝通用编辑，返回 `ARTIFACT_DOMAIN_ACTION_REQUIRED` 与恢复指引，要求走领域 action 以保持关联状态。
- 组合交付动作 `review_and_export_work_artifact` 固定同一版本，先持久化审稿再导出；审稿失败或版本冲突时停止，已保存正文与审稿不丢失。

### 原子文件集与崩溃恢复

1.7.x 的 staged commit 已升级为带 journal 的事务：

1. 在目标同级 `.inkos-file-txn-*` 里准备内容与 backup。
2. 写 `journal.json`（`journal.next` + fsync + rename，含 pid 与 phase：`prepared` → `committed`）。
3. 逐个 rename；任一失败则按 journal 回滚。
4. 回滚也失败时保留 journal（`AggregateError`），由 `recoverAtomicFileSets` 在后续启动时处理：owner 进程已不存在且 phase 仍为 `prepared` 则回滚；无 journal 说明尚未开始替换。

短篇、剧本 / 分镜与 Writer 的主要落盘都已使用它。短篇修订 checkpoint 带稳定 operation identity 和已完成章节进度；指令变化不能悄悄重置该 operation，恢复前先检测源文件变化。

### Interactive / Play / 图像

- Play 的 world mutation、场景呈现与选项作为同一 presentation 记录持久化；仅改文本的场景修订保留世界状态与选项；玩家动作保留原始输入；检查点与版本携带该记录。旧回执读取隔离到 `play-presentation-legacy.ts`。
- Play 一回合被收敛到单个 Pi worker（commit `da464e0c` 折叠了原多步回合），state ownership 在 worker 内。
- 互动影游 edit 接收完整图的 authoring context，写入范围仍有界；影游包由单 worker 生成。
- 图像修订可把旧图作为 provider 参考；生成等待发生在 Work mutation lock 之外，随后按捕获时刻提交；替换失败保留旧成功图；provider 凭据只向该 provider 同源下载请求重试。

### Skill 与检索

- 内置 Skill 包 20 个（README 写 19，`packages/core/skills/` 实际目录 20 个），包括 long / short / script / storyboard / interactive-film / translation / play-world / play-illustration / story-review / story-deslop / story-import / story-cover / 市场研究与拆稿 / 同人、番外、续写、仿写。Profile 的 `requiredSkillIds` 让 worker 在 harness 内强制激活对应 Skill。
- Skill 仍是指导而非授权；工具权限由 Profile + capability + `includeAction` 过滤决定。
- 检索统一为 `LocalSearchIndex`：SQLite FTS5 / BM25，故事记忆、材料库和 Skill 参考共用，文档带 `scope / kind / source / metadata`，源文件仍是权威，索引可重建。旧文关于“透明本地词项打分”的描述已被替换为 FTS5 BM25，但“带来源、可重建”的性质没变。
- 书籍参考资料绑定：材料可带用途绑定到具体书籍，规划 / 写作任务按需检索相关段落。

## 文件、Truth 与派生层

InkOS 的持久化比纯数据库产品更接近 OAN，但内部仍有多套 authority。

> 2.0 更新：新项目的权威目录是 `works/<id>/`（见上节）；下面的 `books/<book-id>/` 描述的是 1.x 布局与长篇领域内部仍沿用的 `source/story/*`、`source/chapters/*` 结构，旧项目需 `inkos work migrate`。
### 长篇书籍

主要文件层次包括：

```text
books/<book-id>/
  book.json
  chapters/*.md
  story/
    author_intent.md
    current_focus.md
    story_bible.md
    book_rules.md
    outline/*
    roles/*
    state/
      manifest.json
      current_state.json
      hooks.json
      chapter_summaries.json
    current_state.md
    pending_hooks.md
    chapter_summaries.md
    runtime/*
    snapshots/*
    memory.db
```

当前真实关系是：

- `story/state/*.json` 是章节运行状态的权威结构化层。
- `current_state.md`、`pending_hooks.md`、`chapter_summaries.md` 是由 JSON 渲染的人类可读投影。
- `story_bible.md`、大纲、角色卡、作者意图和当前焦点仍是可直接编辑的 Markdown 控制 / truth 文件。
- `story/memory.db` 是从结构化状态重建的时序事实、摘要和伏笔检索索引；Node 运行时不支持 SQLite 时会退回文件材料。
- 老项目首次加载时可以从 legacy Markdown bootstrap 出结构化 JSON。

因此不能简单说“Markdown 是唯一真相”，也不能说“SQLite 是事实源”。更准确的是：

```text
控制与基础设定：Markdown truth files
章节运行状态：schema-validated JSON
作者可读视图：Markdown projections
检索加速：rebuildable SQLite memory index
正文历史：chapter files + snapshots，但不是 Git history
```

### 其他产品域

不同产品域有各自的文件协议：

- 会话：追加式 transcript events，带 request started / committed / failed 与原始 Agent message。
- 后台任务：`.inkos/tasks/<session>.json` 快照。
- 材料库：`.inkos/materials/*.md + *.json`。
- 研究报告：`.inkos/research/*.md`。
- Prompt 覆盖：`prompt/<pack>/<prompt>.md`。
- 项目 Skill：`.agents/skills/<skill-id>/SKILL.md + static resources`。
- 剧情推演：`story/runtime/narrative-forecasts/<id>/*`。
- 翻译：`translations/<id>/manifest.json + source/ + translated/ + glossary.json + review-report.md`。
- 互动影游：`interactive-films/<id>/story-graph.json + authoring-state.json + snapshots/`。
- Play：world / run 文件、`events.jsonl`、projection、checkpoint、variant，以及 `play.db` 或 `play-graph.json` fallback。

这说明 InkOS 已经是“文件目录驱动的多领域应用”，但每个领域都有自己的 store、snapshot 和恢复规则，还没有一个类似 OAN Object File Tree + Git 的统一解释层。

## Agent Runtime 与确认式 Action Surface

### 原生工具循环

> 2.0 更新：下面按 session kind 描述的工具表已被 Profile + capability 工具取代（见“2.0 Creative Harness v2”）。`agent-tools.ts` 仍包含 `propose_action`、`research_web`、`ingest_material`、`retrieve_material`、`manage_book_reference`、`import_chapters`、`play_*`、`read` / `grep` / `ls`、`list_works` / `inspect_work`、`delete_latest_chapter`、`resync_chapter_state` 等工具；`write_truth_file`、`patch_chapter_text`、`replace_chapter_text`、`rename_entity` 现位于 `harness/tools/longform-edits.ts`，作为长篇 capability 的 action 暴露。

当前 Chat Agent 使用 pi-agent 原生 Tool Calling，不是上一版可以笼统概括的“自然语言路由器”。`AgentSession` 负责：

- 按 session kind 组装工具表。
- 恢复追加式 transcript。
- 注入 book context transform。
- 处理 provider / model、附件、上下文压缩和中断。
- 将工具调用和结果写入会话事件。
- 对部分 OpenAI-compatible 上游转换内部 tool-result 消息。

工具可见性按入口收窄：

- 通用 chat 主要看到 `propose_action`、研究、材料和导入工具。
- short / script / storyboard / interactive-film 在确认前只能准备和提案，确认后只暴露对应生产工具。
- Play 未创建时先提案，创建后暴露 step / edit / revise。
- book session 才能看到长篇 sub-agent、truth file、章节 patch、检索和剧情推演。
- edit session 进一步移除写新章、研究和推演生成等工具。
- 后台生产任务运行时，host 会临时剔除冲突的生产写工具。

代码中仍存在通用 `edit` / `write` 工具实现，但当前主 Agent 工具装配并未暴露它们；实际可见的正式修改入口主要是 `write_truth_file`、`patch_chapter_text`、`replace_chapter_text`、`rename_entity` 和 `sub_agent`。

### 确认卡的真实边界

InkOS 把 `ActionEnvelope`、`RequestedIntent` 和各动作 payload 做成严格 schema。通用 chat 对建书、短篇、Play、封面、剧本、分镜、互动影游和翻译等重动作先生成 `propose_action` 确认卡；只有 button / slash 等确认来源匹配 intent 时才暴露执行工具。

这个机制解决的是：

- 不让普通讨论误触发昂贵生产任务。
- 让执行 instruction 自包含，不依赖模型回忆前文参数。
- 让完成态以真实 tool result 和文件为准。
- 让不同 UI / CLI 入口共享同一动作语义。

但它不等于 OAN 的 Human Approval：

```text
InkOS
  用户确认“开始执行”
  → pipeline / tool 直接写真实文件

OAN
  用户请求生成
  → CandidateChangeSet / shadow / PendingAction / diff
  → 用户确认“应用这些具体变化”
  → 写真实目标文件
```

在 book session 中，明确的编辑或写章请求还可以直接触发 `write_truth_file`、章节 patch 或 sub-agent。InkOS 没有对最终落盘内容提供统一的 Git diff 级批准门。

## AgentSkills v1.7.2 重构

> 2.0 更新：Skill 已从“可选能力”变成 Profile 绑定的专业内核（20 个内置包）；下面的发现、导入防护和“不授予权限”原则仍成立。
v1.7.2 的核心变化是删除旧 InkOS 私有 Skill 协议，收敛到标准 AgentSkills / OpenClaw `SKILL.md`：

- 从项目 `skills/`、`.agents/skills/`，用户 `~/.agents/skills/`、`~/.openclaw/skills/` 和显式目录发现 Skill。
- Chat Agent 只先看到 name / description，再按意图调用 `use_skill`。
- 用户可以通过 `@skill-id` 或 Studio 选择器强制启用。
- Skill 提供指导和静态参考，不授予新工具、文件、网络或写入权限。
- 一次意图激活不会永久污染后续 turn；历史 Skill 结果会被替换成 expired guidance。
- Prompt Pack 已从 Skill 字段剥离，成为单独资产。

导入和读取有实际防护：

- 导入路径拒绝绝对路径、盘符、空段、`.`、`..` 和 NUL。
- 单次导入限制文件数量、单文件和总大小。
- 必须且只能有一个 `SKILL.md`。
- 资源读取限制在 Skill 目录内，拒绝 symlink、二进制 NUL 和超大文件。
- 导入的脚本文件可以被保存为静态资源，但系统不会自动执行它们。

值得注意的边界：Skill 仍然是模型可读指令。它不提升权限，但恶意 Skill 仍可能影响模型如何使用当前已有工具；因此“无新增权限”不能替代来源信任、内容审阅和运行时工具最小化。

## 长篇写作、上下文与自动修订

长篇默认流程已经明确为：

```text
Planner
  → Composer
  → Writer
  → Length Normalizer（必要时一次）
  → Auditor
  → Reviser（默认最多一次）
  → 再审计
  → Settler JSON delta
  → schema validate / immutable apply
  → chapter + state + projections + memory index
```

### 输入治理

Planner 和 Composer 会生成可检查的运行产物：

- `chapter-XXXX.intent.md`
- `chapter-XXXX.context.json`
- `chapter-XXXX.rule-stack.yaml`
- `chapter-XXXX.trace.json`

Composer 将上下文分为 protected 与 compressible：

- 作者意图、当前焦点、硬状态和活跃伏笔证据不能被静默压缩。
- 旧摘要、低优先级背景和历史材料可以语义编译。
- protected 本身超过预算时会明确失败。
- 没有压缩器、压缩结果为空或模型选择非法 source 时会产生可见错误。
- trace 记录 selected sources、层级、预算与压缩说明。

这一点仍是 InkOS 对 OAN 最有价值的实现参考之一。

### 自动审稿与修订

InkOS 的生产定位比 OAN 更自主：

- 默认 `write next` 会自动审稿并最多修订一次。
- `writing.reviewRetries` 可提高到更多轮。
- 自动循环使用前后 snapshot，保留质量更好的候选。
- 审稿解析失败时跳过自动修订，避免在不可靠报告上改稿。
- 手动修订还有 strict / lenient / always gate；strict 默认要求关键指标不恶化且至少一类改善。
- 未应用修订时返回前后 blocking / critical / AI-tell 指标和剩余问题。

2.0 更新：v1.8 把审稿 / 修订 / 结算归入 capability 内部步骤，`quality state machine` 被替换（`fb8c8e3e`），改为以“可观察的完成证据”判断（`a7ed7ac5`）。自动审稿与修订的权力模型没有变化。

这些 gate 改善了自动生产的可靠性，但不改变其本质：模型仍可在一次确认后自动生成、审稿、修订并写入正式章节。这与 OAN “AI 是 Copilot，最终文件变化由作者逐次确认”的边界不同。

### 章节版本工作区与多文件原子落盘

本轮新增的 `chapter-workspace` 为每章保存：

- 作者改写 brief。
- plan 文档。
- `.versions/<chapter>/<timestamp>_<source>_<uuid>.md` 历史版本。
- 当前版本、可恢复版本与改写结果元数据。

Studio 可以预览、恢复或按审稿 gate 改写章节。strict / lenient / always 控制是否采用新版本；重写旧章节不会倒带整本 live state，而是将后续章节标记为 `needs-revision`。这使“旧章变更会污染下游”成为显式状态，是值得参考的 revision lineage。

但安全边界不能夸大：改写通过 gate 后会直接覆盖正式章节和状态，不先生成 PendingAction / Git diff。它是比原来更安全的直接改写工作区，不是 OAN 式内容批准。

`atomic-file-set.ts` 又为 Writer 的主要章节落盘增加真正的 staged commit：

1. 在同一父目录的 `.inkos-file-txn-*` 中准备全部新内容。
2. 为所有将触及的现有目标建立 backup。
3. 逐个 rename staged 文件到目标位置。
4. 任一操作失败时回滚已提交目标并恢复 backup。
5. 拒绝 path traversal，并由故障注入测试覆盖回滚。

`WriterAgent.saveChapter()` 当前用它一次提交章节、`current_state.md`、`pending_hooks.md`、章节摘要 / 子线等投影和主要 runtime JSON，并可在同一集合删除被替代的旧章节文件。这是相对上一版的重要可靠性提升。

2.0 更新：原子文件集已加入 journal 与崩溃恢复，并扩展到短篇与剧本 / 分镜路径；见“2.0 Creative Harness v2”。

仍需准确限定（以下以长篇路径为例，2.0 是否已全部收敛未逐路径核对）：整条 pipeline 不是一个事务。后续 truth file 保存、legacy JSON 同步、memory index、chapter index 和 snapshot 仍顺序执行；`reviseDraft()` 也在归档版本后顺序覆盖修订稿和最新状态。因此“主要章节 settlement 已原子化”成立，“所有 InkOS 长篇写入均原子化”不成立。

### 顺序批量写章

`writeChapters` 允许一次请求 1–20 章，在一个 book lock 和一个 production task 内顺序执行；任一章结果不再是 `ready-for-review` 时立即停止。它解决的是任务占用、顺序和中途失败边界，不改变每章直接写入正式文件的权力模型。

OAN 若未来提供批量生成，应默认批量产生独立候选 / PendingAction，或逐章停在 Apply Approval；不能把一次 execution consent 扩大为 20 次真实文件批准。

## 状态结算与长期记忆

InkOS 已经形成较完整的章节后状态闭环：

- Observer / Settler 从正文提取角色、位置、资源、关系、情感、信息、伏笔、时间和物理状态变化。
- 模型输出结构化 delta，而不是整份状态 Markdown。
- `applyRuntimeStateDelta` immutable apply。
- Zod 与额外 validator 检查章节号、枚举、伏笔迁移和结构一致性。
- JSON snapshot 与 Markdown projection 一起落盘。
- SQLite memory 从 JSON 状态重建；失败时退回文件上下文。
- 章节删除、导入重放和状态修复有专门路径。

这比上一版只强调“truth files + projection + memory.db”更具体。它证明长篇状态适合使用“观察 → typed delta → reducer → projection”，但 InkOS 的结算是在生产管线内直接提交，不是作者逐项采纳的 SettlementBundle。

另外，`write_truth_file` 仍可以整文件替换若干 Markdown truth / control 文件。虽然路径有 allowlist、书籍有 mutation lock，但没有 old value、source hash 或 diff acceptance，因此与结构化 runtime state 的严谨度并不完全一致。

## 材料、研究与 Prompt Pack

### 可追溯材料库

材料系统将用户 URL、上传文本、Markdown、JSON、HTML 或 PDF 归档为：

- Markdown 提取内容。
- JSON manifest。
- 原始来源、MIME、用途、字符数、页数和 excerpt。
- 查询结果中的 source、charStart / charEnd 和匹配片段。

2.0 更新：召回已并入统一 `LocalSearchIndex`（SQLite FTS5 / BM25），仍不是向量数据库；索引可由源文件重建，结果保留来源与位置。1.7.x 的手写词项权重不再是实现事实。

风险边界仍在：本轮在 `materials/ingest.ts` 中没有找到私网地址 denylist 或重定向复核（只做了 grep 级检查，没有逐行审计）；本地 Studio 作为服务运行时仍需要更强 SSRF 防护。

### 联网研究

`research_web` 只在系统提示中要求“用户明确请求”时使用，并把 sources、query log、partial failures、unknowns 和 confidence 写入 `.inkos/research/*.md`。研究报告不会自动改变正文或 Canon。

当前 claim 主要从搜索摘要 / 页面首句生成，并不等于独立事实核验。对硬事实仍需要来源质量判断、交叉验证和作者确认。

### Prompt Pack

Prompt Pack 与 AgentSkills 已经拆分：

- builtin prompt 提供默认值。
- 用户或项目覆盖通过 `prompt/<pack>/<prompt>.md` 加载。
- 项目覆盖优先于用户覆盖，用户优先于 builtin。
- Prompt source 会进入拼接标题，便于判断来源。

这个分离比旧私有 Skill 中混合 prompt、tool hint 和 context need 更清楚：Skill 是专业指导，Prompt Pack 是可调系统行为，Tool table 由 session 权限决定。

## 剧情推演

v1.7.1 的 Narrative Forecast 是当前最值得 OAN 关注的新能力之一：

- 从当前章节、控制文档、结构化状态和上下文输入计算 fingerprint。
- 一次生成 2-5 条、有限 horizon 的未来候选。
- 保存 branch beats、人物决定、变化、风险、意图匹配与未知项。
- 读取时重新计算 fingerprint；Canon 变化会标记 stale。
- 选择分支只写 `selected-branch-plan.md`。
- 不修改正文、大纲、作者意图或结构化状态。

这是一个清晰的 non-Canon sandbox：候选生成、比较、选择和真正应用被分成不同动作。它比 InkOS 其他直接写入链路更接近 OAN 的候选 / artifact 哲学。

## 翻译工作流

v1.7.0 增加独立长文翻译域：

- 支持 EPUB、文本 PDF、TXT 和 Markdown。
- 源材料按章节和语义段切分。
- 每段保存 source / target / notes。
- glossary 在批次之间合并。
- 每批次持久化，空 target 可继续补跑。
- 可选章节 review，保存 review report。
- 导出 TXT、Markdown 或 EPUB。

翻译项目与小说书籍分目录，避免把译文混入长篇 state。这种领域隔离是优点。

但 persisted manifest / chapter / glossary 的读取多为 TypeScript cast 和手工过滤，没有长篇 runtime state 同级别的 Zod 全量验证；它仍是较新的工作流，数据完整性和恢复协议没有长篇成熟。

## 互动影游

互动影游已经从一次性脚本生成发展为独立图编辑与运行产品：

- `story-graph.json` 包含世界锚点、角色、变量、节点、选择和结局。
- 条件与 effect 有严格 schema 和确定性 evaluator。
- Agent 提出 `StoryGraphDelta`，reducer immutable apply。
- project mutex 防止同进程并发 lost update。
- 每次 apply 保存旧 revision snapshot，最多保留 20 个。
- 图验证检查断链、死路、不可达、变量读写、假分支、长直链、结局可达和缺图。
- 路径枚举有循环保护、最大深度和最大 200 条路径。
- 支持可视化编辑、节点图、Ink 导出和自包含 HTML player。

这套实现对“确定性结构验证 + 模型生成内容”的分工很有参考价值，但互动影游本身并非 OAN 当前 Novel IDE 的核心范围。

## Play 运行时

InkOS Play 一回合包含：

1. 解释玩家动作。
2. 生成世界 mutation。
3. 先渲染场景。
4. reconcile 场景与 mutation。
5. 应用图 reducer。
6. 写事件、状态、projection 和 transcript。

值得肯定：场景渲染成功前不持久化这一回合；图 reducer 在 SQLite 或文件 fallback 内有 transaction；回合前保存 checkpoint，retry 会保存旧 variant、恢复 before-turn snapshot 后再生成。

需要修正旧文档的说法：图数据库事务之后，`events.jsonl`、current state、Markdown projection 和 transcript 仍是多个顺序文件写入，不是一个跨文件原子提交。因此它降低了“渲染失败导致半状态”的风险，但没有完全消除任意 I/O 失败时的混合 revision。

Play 使用 SQLite 时也不是不可替代：缺少 `node:sqlite` 时会退回 `play-graph.json`。不过它仍然维护了数据库 / 文件图、event log、projection、checkpoint 和 variant 多种表示，恢复一致性成本高于 OAN 当前单一对象树目标。

与 OAN 当前 Play Mode 相比：

- InkOS 更成熟于开箱即用的开放世界产品入口、HUD、配图和自然语言回合。
- OAN 更强调单 world referee、branch-local knowledge、typed intervention、immutable variant、严格 settlement 和回写 Novel truth 前的 PendingAction。
- InkOS 的 retry / variant 思路可参考，但不能替代 OAN 已有的 worldline 和 adoption 设计。

## 后台任务、锁与恢复

v1.7.1 对长任务可靠性做了较完整的工程化：

- 写章等生产任务进入 Studio 后台 task system。
- task snapshot 按 execution id 写入 `.inkos/tasks/`。
- 用户可以在任务运行时继续聊天和刷新恢复进度。
- 同一 session 只有一个生产任务槽，原子预留；冲突请求返回 409。
- 生产期间 host 剔除书籍 / 产物 mutation tools，但保留只读讨论和非 Canon 推演。
- 删除会话会 abort 对应任务；服务重启会处理僵尸 snapshot。
- 书籍 mutation 还有带 owner、heartbeat 和 lease 的跨进程写锁。
- whole-book backup / restore 与 latest-chapter rollback 补充了恢复路径。

这套“长任务不阻塞聊天 + 冲突写入收窄 + 可恢复 task card”非常适合桌面创作工具参考。不过 InkOS 的恢复目标仍是直接生产任务，不是 OAN 的候选 artifact 和审批后 materialization。

## Provider、凭据与外部边界

InkOS 的 provider 体系仍是强项：

- global config、project / book override、agent model routing 和临时参数分层。
- provider preset、OpenAI-compatible、自定义 base URL、本地 Ollama 与多家服务商。
- 模型列表探测、服务测试、协议 / stream 组合和 doctor。
- API key 与公开配置分离，Skill 文档明确禁止 Agent / imported Skill 读取、输出或传输凭据。
- `.inkos/secrets.json`、环境变量和 `~/.inkos` 等位置被明确标为 secret。
- research、image、LLM、aggregator 和 custom provider 都被承认为数据可能离开本机的出口。

仍需注意：

- 这是安全说明与工具装配共同构成的边界，不是 OS sandbox。
- 自定义 base URL 会接收用户凭据，必须由用户信任。
- agent `read` 默认限定在 `books/`，但可通过环境配置开放绝对系统路径；OAN 不应采用这种默认外扩方式。
- Studio 监听 localhost，不等于可忽略浏览器、本机其他进程、URL fetch 和 secret 文件权限风险。

## 工程验证状态

2.0 更新：本轮在 `53adac4e` 上只读源码，**没有安装依赖、构建或运行测试**。排除 `node_modules` 与 `dist` 后，源码树里 `*.test.* / *.spec.*` 文件数为 core 124、cli 24、studio 58（上一版的 184 / 41 / 58 / 12 是另一种统计口径，不能直接比较；2.0 提交 `39a6af2e` 还用少量 mini flow 替换了大量防御性测试，净删除约 20,904 行测试）。

InkOS 自述的验证记录（`spec/creative-harness-v2.md`，冻结候选 `delivery-verification-2026-09-25`，源码摘要 `7fe54438…6232`）：Node 22 与 Node 24 各通过 1,093 项检查（Core 701、Studio 304、CLI 88），全新安装与 1,779 个打包文件一致，配置迁移保留 legacy 文件。同一文档明确承认：13 类创作类型的完整真实模型验收仍在进行，内容、封面与市场验收独立于工程检查，合并实现不代表稳定发布验收完成。这些数字是项目自述，本轮未复现。

上一版（`a6e05d4d`）的验证结果：

- 根 `pnpm test` 没有开始执行测试。本地 pnpm 11 发现 workspace `node_modules` 状态不一致，尝试重新安装；registry 请求失败，同时非 TTY 环境拒绝清理 modules 目录。
- 因安装流程已失败，本轮没有继续用不同步的 workspace build artifact 直接运行 Vitest，也没有运行 Playwright。
- 上一轮在 `b0cc9a54` 上得到的局部通过数字不能替代当前 `a6e05d4d` 的验证，故不沿用为当前结论。

因此对当前 2.0 只能确认：源码里存在 harness、atomic file set、artifact revision、Play presentation 等的回归测试，以及作者自述的通过记录；不能声称“本地复现通过”。

## 值得肯定的工程优点

1. **Context 治理已经落到运行产物**
   不是抽象口号，而是 intent、context package、rule stack、trace、protected budget 和显式失败。

2. **标准 Skill 与权限解耦**
   Skill 只提供指导，工具权限由 session mode 决定；一次性激活不会污染后续会话。

3. **非 Canon 推演边界清楚**
   Forecast 有 input fingerprint、stale 检测和独立 selected plan，不会选择后自动改正文。

4. **结构化状态使用 delta + reducer + schema**
   避免模型整份覆盖 runtime state，并保留人类可读 projection。

5. **重动作、后台任务和写锁分层**
   确认卡防误触、任务槽防冲突、书籍锁防跨进程写入、task snapshot 支持刷新恢复。

6. **材料和研究不会自动提升为 Canon**
   来源、查询、未知项和失败被保留，召回片段带位置证据。

7. **互动结构有确定性验证器**
   图、变量、条件和路径不是完全交给 LLM 自说自话。

8. **Provider 问题被当作真实产品问题**
   配置来源、模型归属、协议、stream、key 和错误分类都有明确处理。

9. **主要章节 settlement 有故障回滚**
   staged files、backup、rename、rollback 和路径校验覆盖了最关键的一组正文 / 状态文件，不再完全依赖顺序写入。

10. **历史章节改写会显式污染下游**
    版本归档、review gate 和 `needs-revision` 使旧章修改的影响范围可见，而不是假装 live state 自动保持一致。

11. **产物版本身份与校验和**
    artifact revision 带 parent、checksum、episode，读取 / 审稿 / 导出共用同一快照；候选必须显式指定，缺失返回可恢复错误。

12. **执行状态与内容质量分离**
    `Episode completed`、动作执行成功、交付检查和内容审稿分开记录，避免“循环结束 = 作品通过”。

13. **局部修订范围保护与本轮起点对比**
    范围外内容必须保留，审稿使用本轮开始的快照做 diff，同轮多次修改不会推进比较起点。

14. **失败与自评写进文档**
    `harness-result-first-redesign.md` 记录了观察体积增加 25.6%、真实模型首次完成率不足、导出误报等失败，不用测试数量证明设计正确。

## 当前限制与风险

1. **产品范围已经非常宽**
   长篇、短篇、Play、互动影游、翻译、剧本、分镜、封面、研究、材料、daemon 和 Studio 各自拥有状态与恢复逻辑，整体复杂度明显高于上一版。

2. **Human Approval 只覆盖“是否执行”，不覆盖“应用哪个 diff”**
   正式章节、truth file 和状态可在一次确认后直接写入。

3. **自动写作循环与 OAN 定位冲突**
   默认自动审稿 / 修订，甚至可提高修订轮数；daemon 还能持续写章。

4. **Authority 仍分散**
   Markdown 控制文件、JSON state、projection、SQLite、JSONL、snapshot 和各领域 store 共同解释项目。

5. **直接整文件写 truth 的入口仍存在**
   `write_truth_file` 有路径 allowlist 和 lock，但没有 CandidateChangeSet、old-value guard 或用户 diff。

6. **原子提交只覆盖主要章节 settlement**
   truth files、legacy sync、memory / chapter index、snapshot 和 revision 的部分后续路径仍顺序写入，不能概括为全 pipeline 事务。

7. **Studio 改写仍直接应用正式文件**
   版本归档和 strict gate 改善质量与恢复，但没有最终 CandidateChangeSet / diff approval。

8. **Play 跨文件提交并非真正原子**
   渲染前不写、图 reducer 有事务，但后续文件写仍可能部分成功。

9. **某些新领域的 schema 完整度不一致**
   长篇 state 和互动图较严格；翻译 manifest / chapter 的读取仍偏宽松。

10. **URL 材料摄取的网络边界不足**
   已有限制协议、超时和体积，但缺少可见的私网 / 重定向 SSRF 防护。

11. **Skill 只读不等于 Skill 无风险**
   恶意指令仍能诱导模型滥用当前可用工具，需要来源管理和最小工具面。

12. **测试基建依赖 workspace 预构建与一致 node_modules**
    当前本地快照无法一条命令独立验证，降低了参考项目现状的可复现性。

13. **AGPL 限制代码级吸收**
    OAN 可以独立学习设计思想，但不能把实现源码或 prompt 文本直接复制进项目。

14. **默认确认策略放宽**（2.0 新增）
    所有内置 Profile 对可恢复写入默认 `execute`，只有破坏性写入确认；1.7.x 的重动作确认卡基本退出默认路径。这与 OAN Human Approval 的差距比上一版更大。

15. **版本历史仍非 Git**（2.0 新增）
    artifact revision / snapshot 提供谱系，但回滚、diff 与审计不由 Git 统一解释；同一目录里还有 `work.json`、Episode SQLite、FTS5、Play 图等多个状态面。

16. **2.0 尚未完成稳定发布验收**（2.0 新增）
    自述 13 类创作类型的真实模型验收在进行；`CHANGELOG.md` 没有 2.0 条目；README 称“2.0 开发版本，使用本地构建验证”。参考其设计时应把它视为快速演进中的分支。

17. **Skill 数量表述不一致**（2.0 新增）
    README 写 19 个内置 Skill，changelog 写 15 个，`packages/core/skills/` 实际 20 个目录；以源码目录为准，并应对类似文案差异保持谨慎。

## 与 OAN 的关键差异

| 维度 | InkOS | OAN |
| --- | --- | --- |
| 定位 | Story production agent / 多产品创作系统 | Filesystem-first Novel IDE / Copilot |
| Runtime | 2.0 起单一 pi-agent 生产 harness + Profile / Capability 工具；Pipeline 为确定性能力 | 单一 Aider-style loop + AI SDK ToolSet |
| 正式写入 | 2.0 起可恢复动作默认直接执行，仅破坏性写入确认；工具 / pipeline 直接写文件 | CandidateChangeSet → PendingAction → diff → Accept |
| Truth | Markdown 控制文件 + JSON runtime state + 多领域 store | Markdown / YAML / Object File Tree |
| 历史 | artifact revision + checksum、snapshot、journal、Episode 账本 | Git 是统一历史引擎 |
| 产物身份 | `works/<id>/` + artifact / revision / lineage | Object File Tree 路径 + Git blob |
| 自动化 | 自动审稿修订、批量写章、daemon | AI 提议，作者批准 |
| Skill | 标准 AgentSkills 指导；不授予工具 | `novel-copilot` 文件 Skill + allowed-tools 收窄 |
| Memory | JSON state + projection + SQLite derived index | 文件事实 + 可重建 projection / index |
| Play | 产品入口、HUD、图状态、图片、checkpoint / variant | world referee、branch-local knowledge、typed settlement、adoption |
| 非 Canon 候选 | Forecast 边界清楚，其他生产链路较直接 | session artifacts / PendingAction 是统一候选边界 |

InkOS 的最新发展没有推翻 OAN 的架构选择。相反，它展示了当产品同时维护长篇、Play、互动影游、翻译和后台自动化时，运行时、store 和恢复协议会快速增长。OAN 应吸收成熟局部，而不是追求同等功能表面积。

## 对 OAN 的具体参考建议

### 建议优先吸收或复核

1. **AgentSkills 的“指导不授予权限”原则**
   OAN 已有 `novel-copilot` Skill 和 allowed-tool filter。可复核是否需要兼容标准 `SKILL.md` 的最小子集，但不能让 Skill 增加 ToolSet 权限、执行脚本或绕过写入审批。

2. **ActionEnvelope 的自包含 payload**
   OAN 可在高成本任务开始前展示输入、预算、预期产物和风险；开始执行的确认仍不能替代最终 PendingAction diff。

3. **protected / compressible 明确失败语义**
   对 OAN `ContextPackage.trace` 补充 protected budget、被压缩来源和“核心材料本身超限”的可见错误。

4. **Narrative Forecast 的 non-Canon fingerprint**
   候选方向绑定源 revision；Canon 变化后 stale；选择只保存 plan artifact，真正应用另走 CandidateChangeSet。

5. **后台任务与对话并行的产品状态**
   长分析 / reference / review 可以在后台运行，但同一 workspace mutation 要有单槽、provider lease、abort、恢复和可见 task card。

6. **Prompt Pack 与 Skill 分离**
   Skill 是工作纪律和 allowed tool policy；Prompt Pack 是项目可见、可版本化的行为覆盖。两者都进入 provenance。

7. **材料卡和词项召回的透明基线**
   在引入 embedding 之前，先用稳定来源、char range、purpose 和可见评分建立可审计召回。

8. **备份 / rollback / lock 的失败路径测试**
   可对照 OAN 的 PendingAction、ChangeMaterializer、reference run 和 Play settlement，补齐并发、崩溃、stale owner 和 partial materialization 测试。

9. **结构生成后的确定性 validator**
   对大纲图、Play worldline、伏笔依赖或参考分析结构使用闭集校验，不让 LLM 同时定义规则和判断自己是否合格。

10. **Provider 来源和凭据边界可视化**
    继续显示配置来自全局、workspace 还是本轮覆盖，并明确哪些外部服务会接收内容。

11. **多文件 materialization 的 staged commit / rollback**
    可借鉴目标预检、staging、backup、rename 和故障注入测试；OAN 还要叠加 PendingAction source hash、receipt 和 Git commit，不把临时 backup 当历史引擎。

12. **旧章改写的版本谱系与下游失效**
    对被接受的历史章节修订记录 previous revision，并将依赖的摘要、状态、时间线和后续章节标为待重建 / 待复核；不要自动重写下游 Canon。

13. **批量写作保持有界、顺序和逐章审批**
    可复用 1–20 的有界任务与遇错停止思路，但 execution consent 只启动候选生成，每章仍需独立 diff approval。

14. **产物版本身份 + checksum 校验的读取**
    OAN 的 Object File Tree 已由 Git 提供版本；可借鉴的是“读取 / 审稿 / 导出必须绑定同一已校验快照”和“缺失返回带 recovery 的类型化错误”，对应 Agent 读取证据与 PendingAction 的 source hash。

15. **执行状态与内容质量分离，`completed` 不等于通过**
    对 RuntimeEvent / PendingAction receipt 保持“循环结束、动作成功、内容审阅”三类状态分开。

16. **局部修订的范围保护与本轮起点 diff**
    对 OAN 的章节修订候选：范围外内容必须不变（可由 diff 校验），审稿对比使用本轮起点而不是中间稿。

17. **带 journal 的 staged commit 与启动期恢复**
    对 ChangeMaterializer：journal 写入顺序、`pid` + phase 判断僵尸事务、回滚失败时保留 journal；OAN 仍叠加 PendingAction receipt 与 Git commit。

18. **FTS5 / BM25 作为可重建检索投影**
    若 OAN 需要全文检索，可参考“源文件权威、索引可重建、命中带 source 与位置”；不引入把索引当事实源的做法。

19. **Skill 绑定 Profile 的强制激活与“不授权”共存**
    InkOS 通过 `requiredSkillIds` 强制激活，同时 Skill 不扩权；OAN 可复核 `novel-copilot` 的激活生命周期，但不要照搬 20 个专业包。

### 不建议吸收

- 默认把可恢复写入设为 `execute`、只确认破坏性写入的 Profile 确认策略。
- 以 `work.json` / revision snapshot 取代 Git 作为历史引擎。
- 把 Episode SQLite 账本当作小说事实或审批依据。

- 默认自动审稿 / 自动修订 / 多轮 repair loop。
- daemon 自动写章。
- Architect / Writer / Auditor / Reviser 多 Agent 编排进入 `packages/runtime`。
- 直接整文件 `write_truth_file` 或章节覆盖成为 Agent 默认能力。
- “确认开始执行”代替最终 diff approval。
- 将一次批量任务确认当作多章真实写入授权。
- SQLite、task snapshot、Agent transcript 或 projection 成为小说 truth。
- 为翻译、互动影游、封面等外围能力扩大当前 Novel IDE 核心范围。
- 让导入 Skill 自动执行脚本或扩展 ToolSet 权限。
- 未加固 SSRF 边界的任意 URL 摄取。
- 直接复制 AGPL 源码、prompt、Skill 正文或 UI 文案。

## 主要证据路径

- 2.0 Harness：
  - `reference-only/inkos/spec/creative-harness-v2.md`
  - `reference-only/inkos/docs/harness-result-first-redesign.md`
  - `reference-only/inkos/packages/core/src/harness/contracts.ts`
  - `reference-only/inkos/packages/core/src/harness/builtin-profiles.ts`
  - `reference-only/inkos/packages/core/src/harness/pi-tools.ts`
  - `reference-only/inkos/packages/core/src/harness/capability-registry.ts`
  - `reference-only/inkos/packages/core/src/harness/episode-store.ts`
  - `reference-only/inkos/packages/core/src/harness/artifact-edit-policy.ts`
  - `reference-only/inkos/packages/core/src/harness/system-prompt.ts`
  - `reference-only/inkos/packages/core/src/retrieval/local-search.ts`
  - `reference-only/inkos/packages/core/src/play/play-presentation.ts`
- 产品与发布：
  - `reference-only/inkos/README.md`
  - `reference-only/inkos/CHANGELOG.md`
  - `reference-only/inkos/package.json`
  - `reference-only/inkos/skills/SKILL.md`
- Agent 与动作边界：
  - `reference-only/inkos/packages/core/src/agent/agent-session.ts`
  - `reference-only/inkos/packages/core/src/agent/agent-system-prompt.ts`
  - `reference-only/inkos/packages/core/src/agent/agent-tools.ts`
  - `reference-only/inkos/packages/core/src/interaction/action-envelope.ts`
  - `reference-only/inkos/packages/core/src/interaction/edit-controller.ts`
- Skill 与 Prompt：
  - `reference-only/inkos/packages/core/src/skills/external-loader.ts`
  - `reference-only/inkos/packages/core/src/agent/skill-tool.ts`
  - `reference-only/inkos/packages/core/src/prompts/prompt-pack.ts`
- 长篇上下文与状态：
  - `reference-only/inkos/packages/core/src/agents/composer.ts`
  - `reference-only/inkos/packages/core/src/agents/writer.ts`
  - `reference-only/inkos/packages/core/src/pipeline/chapter-review-cycle.ts`
  - `reference-only/inkos/packages/core/src/pipeline/runner.ts`
  - `reference-only/inkos/packages/core/src/state/runtime-state-store.ts`
  - `reference-only/inkos/packages/core/src/state/memory-db.ts`
  - `reference-only/inkos/packages/core/src/state/chapter-workspace.ts`
  - `reference-only/inkos/packages/core/src/utils/atomic-file-set.ts`
  - `reference-only/inkos/packages/core/src/llm/providers/endpoints/lmstudio.ts`
- 新领域：
  - `reference-only/inkos/packages/core/src/forecast/runner.ts`
  - `reference-only/inkos/packages/core/src/materials/ingest.ts`
  - `reference-only/inkos/packages/core/src/materials/retrieve.ts`
  - `reference-only/inkos/packages/core/src/translation/runner.ts`
  - `reference-only/inkos/packages/core/src/interactive-film/authoring-store.ts`
  - `reference-only/inkos/packages/core/src/interactive-film/validation.ts`
  - `reference-only/inkos/packages/core/src/play/play-runner.ts`
  - `reference-only/inkos/packages/studio/src/api/task-store.ts`
  - `reference-only/inkos/packages/studio/src/api/server.ts`
  - `reference-only/inkos/packages/studio/src/components/ChapterWorkspacePanel.tsx`

本文只吸收设计与现状判断。OAN 的正式实现仍应以自身 task、plan、Object File Tree、AI SDK ToolSet、CandidateChangeSet、PendingAction 和 Git diff approval 为准。
