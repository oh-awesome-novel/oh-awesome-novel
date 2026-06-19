# InkOS Reference Lessons

本文档列出 InkOS 中值得 `oh-awesome-novel` 学习和吸纳的设计点。所有建议都以 OAN 当前稳定边界为前提：filesystem-first、AI 是 Copilot、写入需 PendingAction / diff / Human Approval、Runtime 保持 Aider-style 极简循环。

## 吸纳原则

### 可以学模式，不照搬架构

InkOS 的价值在于它对小说创作 workflow 的产品化、上下文治理、状态投影、provider 配置和互动世界建模。OAN 不应照搬它的自主多 Agent runtime、自动写入链路或 SQLite 事实源。

### 以文件树和 Git 为最终解释层

InkOS 的 `story/state/*.json + Markdown projections + memory.db` 可以启发 OAN 的“结构化事实 + 人类可读投影”设计。但 OAN 的事实源仍应是 Markdown / YAML / Object File Tree；任何索引或缓存都必须可由文件树重建。

### 先做可审阅，再做自动化

InkOS 有较强自动生产倾向。OAN 可以吸收其阶段拆分和 UI 反馈，但所有正式写入仍要进入 PendingAction 和 diff preview。

## 值得参考的设计

### 1. 统一 action surface

InkOS 将 Studio Chat、TUI、CLI 和外部 Agent 入口收敛到同一套 action surface。普通聊天直接回答，重动作生成确认卡，确认后进入专门 session。

OAN 可以学习：

- 将 `/写下一章`、`/整理本章`、`/更新状态`、`/补伏笔` 等快捷指令和自然语言请求统一成 `ActionIntent`。
- 让 Copilot 先生成“将要执行什么”的可确认 action，而不是直接进入长工具链。
- 将 action 的结果绑定到 PendingAction、Tool Log 和文件 diff，避免模型口头声明完成。

适合落点：

- `packages/agent`：请求分类和 session metadata。
- `packages/runtime`：保持极简 tool loop，不承载 planner。
- `apps/desktop-ui`：确认卡、操作入口和结果状态。

### 2. 重动作确认卡

InkOS 的 `propose_action` 工具要求 instruction 自包含，并把结构化参数写入 `createBook`、`shortRun`、`playStart`、`generateCover` 等字段。

OAN 可以学习：

- PendingAction 之外增加“执行前确认卡”，用于建书、写下一章、批量更新状态等高成本动作。
- confirmation payload 必须包含目标文件、动作类型、用户意图摘要、预期产物和风险提示。
- 不让后续 session 依赖上一轮聊天上下文猜测参数。

注意：执行前确认卡不能替代 PendingAction。确认“开始生成”之后，真实文件写入仍必须由 PendingAction 审批。

### 3. 上下文分层：protected / compressible

InkOS 把上下文分成 protected 和 compressible：作者意图、当前 focus、世界规则、事实状态等要保护；历史聊天、旧摘要和可压缩材料可在预算紧张时压缩。

OAN 可以吸纳为：

- protected：`.oan/constitution/*`、`.oan/workflow.yaml`、当前章节目标、明确用户约束、关键角色状态、未回收伏笔。
- compressible：旧章节摘要、历史聊天、远期背景材料、低相关世界设定。
- excluded：与当前任务无关且可能污染模型的旧草稿或未确认候选内容。

落地形态可以是一个 `ContextPackage`，但它应作为 agent 组装层产物，不进入 runtime 架构核心。

### 4. plan / compose / trace 中间产物

InkOS 长篇写作有 `planChapter` 和 `composeChapter`，会产生章节意图、上下文包、规则栈和 trace。

OAN 可以借鉴“写正文前先生成可审阅输入包”：

- `chapter-intent.md`：下一章目标、冲突、必须推进的状态、禁止事项。
- `context-package.yaml`：本轮读取了哪些文件、为何相关、哪些材料被压缩或排除。
- `rule-stack.yaml`：constitution、workflow、用户临时要求和 genre rules 的优先级。
- `trace.json` 或 Markdown trace：工具读取、上下文选择和生成原因。

这些产物可以先放在 `.workspace` shadow 区域或 `.oan/sessions/`，不要直接污染小说事实源。

### 5. 结构化状态的人类可读投影

InkOS 将 hooks、chapter summaries、current state 渲染成 Markdown projection。这个设计非常适合 OAN。

OAN 可以学习：

- 从 `state/*.yaml` 生成 `state/projections/current.md` 或 `.oan/indexes/state.md`。
- 从 `foreshadow/*.yaml` 生成“伏笔池”可读表。
- 从 `timeline/events.yaml` 生成按章节排序的时间线视图。
- projection 是派生物，不是事实源；应能重新生成。

价值：

- 作者能快速审阅状态。
- Copilot 读取上下文更稳定。
- Git diff 更容易看懂。

### 6. Genre Profile 作为可维护规则资产

InkOS 的 `packages/core/genres/*.md` 把题材规则、疲劳词、节奏规则、满足感类型和审稿维度写成 Markdown + frontmatter。

OAN 可以吸收为 `.oan/skills/` 或 `.oan/genre/` 下的文件型规则包：

```text
my-novel/
  .oan/
    genre/
      xuanhuan.yaml
      xuanhuan.md
```

规则应服务于 Copilot 审稿、章节规划和“去 AI 味”，而不是变成隐藏 prompt。作者应该能打开、修改和 Git diff。

### 7. Provider bank 与配置诊断

InkOS 的服务配置把 Studio 配置、secrets、CLI env、进程 env 和命令行覆盖分层处理，并提供模型归属校验、模型列表探测和 doctor。

OAN 已有 provider gate 和 provider config，可以进一步学习：

- provider preset：常用服务商的 baseUrl、模型列表、兼容策略。
- API Key 存储与配置分离：公开配置不含密钥。
- provider check 显示来源：来自 app config、env、workspace，还是临时覆盖。
- 模型归属校验：避免把 A 服务模型发到 B 服务 baseUrl。
- 错误分类：配置错误、provider 错误、系统执行错误分开展示。

### 8. Studio SSE 事件分类

InkOS Studio 有较细的事件类型：book、write、draft、audit、revise、style、import、fanfic、agent、log、llm progress 等。

OAN 可以学习：

- 将 `RuntimeEvent` 到 UI event 的映射做成清晰 taxonomy。
- Tool Log 不只展示工具名，还展示阶段、目标文件、进度、失败类型和是否产生 PendingAction。
- 长任务中输出 `llm:progress` 类事件，让用户知道是模型慢、工具慢还是等待审批。

### 9. Play 的事务式提交思路

InkOS Play 的一次回合先生成场景，再提交状态、图谱、事件、projection 和 transcript。失败时不留下半推进状态。

OAN 当前不以互动世界为核心，但这个模式对任何“多文件写入”都有启发：

- 多文件 PendingAction 应先完整生成 diff。
- 只有全部 preview 和 validation 成功，才进入用户可接受状态。
- Accept 后写入失败要可见，并能定位哪些文件已 materialize。
- 对章节 + state + timeline + foreshadow 的联动修改，可借鉴“先构建完整 mutation，再提交”的思想。

### 10. Import / continuation / style workflow

InkOS 支持导入已有章节、反推 truth files、生成 style guide，再续写。

OAN 可以学习：

- “导入现有小说项目”不仅是复制文件，还应生成初始 summary、state、timeline、foreshadow 和 style profile 的候选 PendingAction。
- 风格分析输出应成为可审阅文件，例如 `.oan/style/profile.md`。
- 续写前先生成“当前连续性报告”，让作者确认 AI 对已有文本的理解。

### 11. 测试分层和回归意识

InkOS 测试覆盖 core、CLI、Studio、TUI、Play、provider、state 等很多边界。

OAN 可以吸收：

- 对每个写入工具测试“不会越权写文件”。
- 对 provider config 测试“密钥不泄露、模型归属校验、错误消息可读”。
- 对 PendingAction 测试 accept/reject、partial failure、Git dirty 文件隔离。
- 对 context package 测试 protected materials 不被压缩掉。
- 对章节索引、状态投影、伏笔表生成做快照测试。

## 不建议直接照搬

### 1. 自主多 Agent 生产平台

InkOS 的多 agent pipeline 对它自身定位成立，但 OAN 文档明确禁止重型 multi-agent runtime。OAN 应保持 Aider-style loop，通过工具和文件产物表达阶段，而不是把 runtime 做成 planner / reviewer / reviser 编排平台。

### 2. 自动写入真实目标文件

InkOS 的很多流程直接落盘。OAN 不能照搬。OAN 的 AI 发起写入必须先变成 PendingAction / diff，作者接受后才写真实目标文件。

### 3. SQLite 作为事实源

InkOS 的 `memory.db` 适合作为时间事实索引，但 OAN 的事实源必须是 Markdown / YAML / Object File Tree。未来即使用索引，也应是派生缓存，可删除后重建。

### 4. 后台 daemon 自动写作

InkOS 有 daemon schedule。OAN 当前边界是不做后台自主 agent。后续即使做提醒或自动扫描，也不应自动生产和写入小说正文。

### 5. AGPL 代码级复制

InkOS 使用 AGPL-3.0-only。OAN 可以学习产品模式和抽象思路，但不应复制其实现代码或 prompt 文本到本项目。

## 建议吸纳优先级

### 近期

- 统一 Copilot action intent 和确认卡。
- 增强 provider preset、模型归属校验和 doctor 诊断。
- 为章节规划增加可审阅 `chapter-intent` / `context-package` shadow 产物。
- 生成状态、伏笔、时间线的 Markdown projection。

### 中期

- 建立 genre profile / skill pack 文件格式。
- 导入已有小说时生成 summary/state/style 候选 PendingAction。
- 将 Tool Log / RuntimeEvent taxonomy 做细，改善长任务可观测性。
- 为 PendingAction 多文件事务和失败恢复补测试。

### 远期

- 可选封面/视觉资产生成工作流。
- 可选互动世界或角色状态模拟，但应作为独立 domain，不影响长篇小说事实源。
- 可删除重建的 memory / search index，用于加速检索，而不是替代文件树。

## 参考文件

- InkOS 产品与功能说明：`reference-only/inkos/README.md`、`reference-only/inkos/README.en.md`
- Skill 与 action surface：`reference-only/inkos/skills/SKILL.md`
- CLI 命令面：`reference-only/inkos/packages/cli/src/program.ts`
- Core 导出面：`reference-only/inkos/packages/core/src/index.ts`
- 长篇流水线：`reference-only/inkos/packages/core/src/pipeline/runner.ts`
- Agent session / prompt / tools：`reference-only/inkos/packages/core/src/agent/agent-session.ts`、`reference-only/inkos/packages/core/src/agent/agent-system-prompt.ts`、`reference-only/inkos/packages/core/src/agent/agent-tools.ts`
- Interaction runtime：`reference-only/inkos/packages/core/src/interaction/runtime.ts`
- 状态投影与记忆：`reference-only/inkos/packages/core/src/state/state-projections.ts`、`reference-only/inkos/packages/core/src/state/memory-db.ts`
- Play：`reference-only/inkos/packages/core/src/play/play-runner.ts`
- Provider 配置：`reference-only/inkos/packages/core/src/utils/effective-llm-config.ts`、`reference-only/inkos/packages/core/src/llm/providers/index.ts`
- Studio API / SSE：`reference-only/inkos/packages/studio/src/api/server.ts`、`reference-only/inkos/packages/studio/src/hooks/use-sse.ts`
- Genre profile：`reference-only/inkos/packages/core/genres/litrpg.md`
