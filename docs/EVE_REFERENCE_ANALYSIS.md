# Eve 参考项目现状分析与可吸收点候选清单

> 日期：2026-06-24
> 状态：Reference-only analysis
> 范围：阅读 `reference-only/eve` 本地快照和 Vercel 发布文章后形成的候选判断。本文不是实现计划，不改变现有架构事实。

## 阅读来源

- `reference-only/eve` 本地仓库
  - Git 快照：`9298c90 chore(eve): dependencies - upgrade workflow betas (#231)`
  - 阅读时本地 working tree：clean
- Vercel 发布文章：<https://vercel.com/blog/introducing-eve>
- 重点阅读的本地文件：
  - `reference-only/eve/README.md`
  - `reference-only/eve/package.json`
  - `reference-only/eve/packages/eve/package.json`
  - `reference-only/eve/docs/reference/project-layout.md`
  - `reference-only/eve/docs/concepts/execution-model-and-durability.md`
  - `reference-only/eve/docs/concepts/security-model.md`
  - `reference-only/eve/docs/concepts/sessions-runs-and-streaming.md`
  - `reference-only/eve/docs/tools/overview.mdx`
  - `reference-only/eve/docs/tools/human-in-the-loop.md`
  - `reference-only/eve/docs/skills.mdx`
  - `reference-only/eve/docs/concepts/context-control.md`
  - `reference-only/eve/docs/sandbox.mdx`
  - `reference-only/eve/docs/evals/overview.mdx`
  - `reference-only/eve/docs/guides/instrumentation.md`
  - `reference-only/eve/docs/guides/dev-tui.md`
  - `reference-only/eve/packages/eve/src/compiler/compile-agent.ts`
  - `reference-only/eve/packages/eve/src/compiler/normalize-manifest.ts`
  - `reference-only/eve/packages/eve/src/compiler/artifacts.ts`

## Eve 当前定位

Eve 是 Vercel 推出的 filesystem-first TypeScript agent framework。Vercel 文章把它定位为用于构建、运行、扩展生产级 agent 的开源框架，强调 durable execution、sandboxed compute、human-in-the-loop approvals、subagents、evals、channels、schedules、tracing 和 deployment。

本地 `reference-only/eve` 不是小型示例，而是完整 monorepo：

- `packages/eve`：公开发布的核心包，版本 `0.13.3`，Apache-2.0，包含 CLI、compiler、runtime、sandbox、client、evals、frontend adapters、channel adapters 和 public APIs。
- `packages/eve-catalog`：catalog 支持包。
- `docs`：随包发布的文档，README 明确说明 coding agents 可以从 `node_modules/eve/docs` 读取。
- `apps/docs`、`apps/templates`、`apps/frameworks`：文档站、web chat 模板、Next/Nuxt/SvelteKit 示例。
- `e2e/fixtures`：覆盖 runtime、skills、tools、schedules、channels、subagents、sandbox、HITL、evals 的 authored-agent fixtures。
- `.github/workflows` 和 `scripts`：CI、e2e、release、docs check、bundle analysis、Docker image size check。

工程栈是 pnpm workspaces + Turborepo + TypeScript + Vitest + oxlint/oxfmt，根 `package.json` 要求 Node `>=24`。Eve 当前仍是 beta/public preview 语境，适合参考产品形态和架构模式，不适合直接当稳定依赖引入 OAN。

## Eve 的核心形态

Eve 的中心判断是：agent 是一个目录。能力放在 `agent/` 下的约定槽位里，路径和文件名就是身份。

典型结构：

```text
agent/
  agent.ts
  instructions.md
  tools/
  skills/
  channels/
  schedules/
  connections/
  sandbox/
  subagents/
```

关键机制：

- 路径派生身份：`agent/tools/get_weather.ts` 暴露为 tool `get_weather`，`agent/skills/research/SKILL.md` 暴露为 skill `research`，`agent/subagents/researcher/agent.ts` 暴露为 subagent `researcher`。
- Discovery / compile artifacts：Eve 扫描 authored surface，校验形状，写入 `.eve/` 下的 diagnostics、discovery manifest、compiled manifest、module map，并通过 `eve info` 展示实际发现结果。
- Progressive context：`instructions.md` 常驻；skills 只暴露 description，按需通过 `load_skill` 加载；workspace 文件通过工具读取，不默认塞入 prompt。
- Durable sessions：session / turn / step 分层 checkpoint；approval、question、OAuth、subagent 等等待点可以长期 parked 并恢复。
- Streaming protocol：HTTP session 输出 NDJSON 事件，包括 session、turn、step、tool、input request、authorization、subagent、message、reasoning、usage、failure。
- HITL：approval 和 question 共享 pause/resume 协议；tool approval 支持 never / once / always / predicate。
- Trust boundary：自定义 tools 运行在可信 app runtime；shell/file 操作通过 built-in tools 代理到隔离 sandbox `/workspace`；secrets 留在 app runtime。
- Evals：`evals/*.eval.ts` 驱动真实 session，并断言 completed、calledTool、toolOrder、reply content 或 LLM-as-judge 结果。
- Dev loop：`eve dev` 同时提供本地 server、TUI chat、tool call 可视化、approval/question 回答、model/channel/deploy 命令和日志展示。

## 与 OAN 的适配判断

OAN 与 Eve 在 filesystem-first 层面高度同向，但产品边界不同。

已经同向的 OAN 事实：

- OAN 以 Markdown / YAML / Object File Tree 作为数据库。
- Git 是历史引擎。
- Runtime 是 Aider-style 极简 loop。
- Tool calling 使用 Vercel AI SDK `ToolSet`，不是自建重型工具框架。
- 写入链路是 SemanticPatch / PendingAction / diff preview / Human Approval。
- `0900` 和 `1080` 已经实现第一版 reference bundle、source/distilled 分离、reference context selector、no-copy warnings、enable/disable。

主要冲突：

- Eve 是通用 durable agent framework；OAN 是 filesystem-first Novel IDE，不能扩展成通用 agent 框架。
- Eve 支持 subagents 和 autonomous schedules；OAN 当前架构明确不做 multi-agent runtime、background autonomous agent。
- Eve 拥有完整 compiler/runtime/deployment surface；OAN 已有 `packages/core/tools/agent/runtime/backend/ui` 边界，不应替换。
- Eve sandbox 允许 agent shell/file work；OAN 真实小说文件写入必须走 SemanticPatch、diff 和 Human Approval。
- Eve channels 面向 Slack、Discord、Teams、Telegram、Twilio、GitHub、Linear 等生产渠道；OAN 当前第一入口是本地 desktop/backend/Vue。

结论：吸收模式，不吸收框架。优先吸收文件化发现、diagnostics artifacts、显式 context loading map、HITL 事件词汇、eval 形态、trust boundary 文档表达。

## 可吸收点候选清单

### A1. 路径派生身份用于 Reference Artifact

优先级：High

Eve 的路径即身份可以窄化应用到 OAN reference bundle：

```text
examples/references/<reference-id>/distilled/pacing.md
  -> reference:<id>/distilled/pacing

examples/references/<reference-id>/deconstruction/chapters/0001-summary.md
  -> reference:<id>/chapter/0001/summary

examples/references/<reference-id>/context/reference-summary.md
  -> reference:<id>/context/default
```

价值：

- selector、source pointer、UI 行、quality gate 可以引用稳定 artifact id。
- 避免后续仅靠自由文本 path 和 title 串联。
- 与 OAN Object File Tree 思路一致。

### A2. OAN Workspace Discovery / Diagnostics Artifact

优先级：High

Eve 的 `.eve/discovery` 和 `.eve/compile` 提供了可检查中间产物。OAN 可以做轻量版 `.oan/inspect/` 或 `.oan/diagnostics/`：

- workspace shape manifest
- 缺失或格式错误的 object files
- reference bundle 有效性
- disabled / stale references
- PendingAction 和 Git 状态摘要
- 最近一次 agent turn 的 selected / omitted context map

约束：

- 这是诊断层，不是隐藏事实源。
- 不改变小说 truth files。
- 不绕过现有 backend / frontend / Git 边界。

### A3. Reference Deconstruction Manifest

优先级：High

`0900` 已有 `progress.yaml` 和 deterministic stub。可以借鉴 Eve compiled manifest 的思路，为每个 reference 增加：

```text
examples/references/<id>/
  deconstruction-manifest.yaml
  diagnostics.yaml
```

候选字段：

- detected chapters、source pointer、hash
- stage dependency graph
- completed / stale / failed stages
- distilled files 与来源章节依赖
- quality gate 结果
- uncertainty / low-confidence records

价值：

- 完整 AI 拆解可断点恢复、局部重跑、复核质量。
- 不需要引入 Eve Workflow SDK。
- 与现有 `progress.yaml` 兼容。

### A4. Reference Context Selector 从 summary 扩展到 distilled entry

优先级：High

当前 selector 主要按 enabled、maxReferences、tokenBudget 选择 `context/reference-summary.md`。Eve 的 progressive context 提醒 OAN 应继续细化：

- 按 capability、scene type、style request、pacing request、hook request、explicit reference id、chapter goal 匹配。
- 优先选择单个 `distilled/*` 文件，而不是只读 summary。
- 对每个 included / omitted entry 输出 reason、budgetLayer、semanticBoundary、source-read 状态。
- 默认排除 `sources/original.*`，除非用户显式要求查看来源或重新拆解。

直接关联：`0900 Project References And Deconstruction`、`1080 Reference Context Selector And Loading Map`。

### A5. 统一 HITL 事件词汇

优先级：Medium

Eve 把 approval 和 question 放在同一 pause/resume 协议下。OAN 已有 PendingAction approval，可以吸收事件词汇而非 durable workflow：

```text
input.requested
question.requested
pending_action.created
pending_action.accepted
pending_action.rejected
session.waiting
turn.completed
turn.failed
```

价值：

- UI、backend、runtime、session artifact 的事件命名更统一。
- 后续 quick question、reference preview gate、PendingAction approval 可以复用展示模型。

### A6. Tool Output Projection

优先级：Medium

Eve 的 `toModelOutput` 区分完整 tool output 和模型可见 output。OAN 可吸收为工具输出纪律：

- UI / trace 保存完整结构化结果。
- 模型只看到压缩、脱敏、带 token budget 的结果。
- reference selector 输出必须保留 provenance、no-copy、originalSourceRead。
- 大型 read tool 不把全文塞给模型，只给路径、摘要、可继续读取的选择。

这与 OAN 的 context package source discipline 一致。

### A7. Agent Run Trace / Info Inspector

优先级：Medium

Eve 的 `eve info` 和 run trace 对调试很有价值。OAN 可做 OAN-native inspector：

- 本 turn 选择了哪些 context source。
- 哪些 source 被 omitted，原因是什么。
- 发生了哪些 tool call。
- 生成了哪些 PendingAction。
- 使用了哪个 provider/model。
- token / context budget 估算。
- reference distilled entries 是否被使用。

该能力应落到 session artifacts 或 UI inspector，不成为 runtime 新架构。

### A8. 文件化 Agent Evals 形态

优先级：Medium

Eve 的 `.eval.ts` 文件驱动真实 session 并断言 tool usage / reply。OAN 不应引入 Eve eval runner，但可以吸收测试形态：

- planning command smoke evals
- reference selector evals
- write-intent / PendingAction evals
- no-copy guardrail evals
- review / settlement workflow evals

测试仍遵守 OAN 规则：放在根目录 `__test__/*` workspace，不放进 `packages/*/src/__tests__/`。

### A9. Dev Transcript / Tool Log UX

优先级：Medium

Eve TUI 的价值不在终端本身，而在信息密度：

- tool call 一行摘要，可展开详情
- approvals / questions 就地展示
- token flow / context size 可见
- provider/model 状态可见
- errors 附带清晰来源
- subtask / tool trace 可折叠

OAN 桌面 UI 可以吸收这些显示模式，但继续使用 Vue/Electron/backend 边界。

### A10. Trust Boundary 文档表达

优先级：Medium

Eve 用 app runtime vs sandbox 表格解释 secrets、network、filesystem 边界。OAN 可以改写为自身边界：

| 区域 | 可读 | 可写 | 说明 |
| --- | --- | --- | --- |
| Novel truth files | read tools | Human Approval 后 | `characters/`、`chapters/`、`state/` 等 |
| `.workspace` shadow | backend/runtime | AI proposal 可写 | 用于 PendingAction、diff preview、recovery |
| Vue frontend | backend API | 无直接文件写 | transport-only |
| Git integration | backend/Electron main | 用户确认后 | 不允许 frontend 传任意 git 命令 |
| Reference source | 显式导入后可读 | import/deconstruction 写入 | 默认不进写作 prompt |

价值：让 Human Approval 和 filesystem boundary 更容易被未来 agent 遵守。

### A11. Packaged Skills 的 Progressive Disclosure

优先级：Low / Medium

OAN 已定义 Skill 是 prompt pack + allowed tool list。Eve 的 skill 文档可作为补充约束：

- description 是 routing hint，不是展示标签。
- 长程序放 skill，常驻规则放 constitution / instructions。
- sibling files 可以是 references / assets / scripts，但不能藏业务逻辑。
- skill 加载只增加指导，不新增隐式执行面。

适合后续细化 `.oan/skills/` 约定。

### A12. Channel Adapter Pattern

优先级：Low

Eve 的 channel file 适合多渠道生产 agent。OAN 目前不需要 Slack/Discord 等通道，但未来可以借鉴“每个 surface 一个 adapter”的概念，用于 local desktop、local web、CLI 或外部编辑器。

当前不应优先做。

## 明确不吸收或推迟

- 不用 Eve 替换 OAN runtime。
- 不引入 Eve、Workflow SDK、Nitro、Vercel deployment 作为 OAN 架构依赖。
- 不把 OAN 做成通用 agent framework。
- 不引入 subagent orchestration。
- 不引入 autonomous schedules 作为写作默认流程。
- 不开放通用 shell/write sandbox 来修改小说 truth files。
- 不把 reference 变成隐藏 RAG memory。
- 不把 Eve 的 `agent/` layout 当成 OAN 小说 workspace layout。
- 不复制 Eve 代码或文档，只吸收设计模式。

## 建议后续任务

1. 在 `0900` 后续计划中补充 `deconstruction-manifest.yaml` / `diagnostics.yaml` schema。
2. 在 `1080` 中把 selector 从 reference summary 扩展到单个 distilled entry。
3. 增加 OAN workspace/reference inspector artifact，优先落 session artifacts 或 `.oan/inspect/`。
4. 增加 reference selector、no-copy guardrail、missing diagnostics 的测试。
5. 新增一份 OAN trust boundary 设计说明，明确 truth files、shadow write、PendingAction、backend、frontend、Git 的权限分割。

