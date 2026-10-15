# Development Plan

## Planning Principle

当前唯一正式写入方向是：

```text
bash-tool + just-bash fixed sandbox
  -> CandidateChangeSet
  -> PendingAction
  -> Human Accept
  -> ChangeMaterializer
  -> Git
```

确定性 Reference/Play producer 可直接生成同一种 ChangeSet。项目不实现 feature flag 双写、dual-run、旧记录 migrator 或 runtime fallback engine。

优先保持：filesystem first、Object File Tree、Aider-style Runtime、Vercel AI SDK ToolSet、人类审批和 Git history。不要提前引入 Multi-Agent、autonomous background writing、extension marketplace、vector database memory 或 rich-text database，也不做商业化、连载或协作功能。

## Current Delivery Priority (2026-10-15)

产品重新定位为个人同人/综漫创作工作台（[PROJECT_VISION](PROJECT_VISION.md)、[评估记录](reviews/PRODUCT_DESIGN_REVIEW_2026-10-15.md)）。优先级：

1. **写作核心闭环**：[1330](tasks/1330.md) 自动目标路径（写下一章、生成角色卡、规划）、续写上下文与章节进度引导。
2. **审批与记忆体验**：[1340](tasks/1340.md) 派生记录整批接受、未整理章节提示、默认同人二创 Profile。
3. **Play 保持高优先级**：[1120](tasks/1120.md) 剩余可靠性，以及作者使用中提出的穿越/导演/世界线体验改进，直接立项推进。
4. 其余：[0580](tasks/0580.md) 远端同步与更多环境验收、[1230](tasks/1230.md) 独立剩余范围。

不做商业写作、连载平台或团队协作相关功能。**Extension 系统开发继续暂缓**：不新增动态 Tool 注册或 extension host code。

此前交付记录：首次使用、审批恢复、中文 Git 路径、最终树引用校验、标准上下文治理、会话恢复、Play 可靠性修正、usage 治理、受限多领域结构化结算、正文搜索、Markdown/TXT 导出、Play 派生窗口/快照优化、[1290](tasks/1290.md) 章级来源新鲜度、[1300](tasks/1300.md) 旧稿导入、[0700](tasks/0700.md) 卷/全书摘要与 [1310](tasks/1310.md) 发行质量门禁。完整 Play mutation/CAS 成本仍线性，进一步优化以实测门槛为准。

## Milestone Overview

```text
M0   Documentation Foundation
M1   Project Scaffolding
M2   Filesystem Spec And Example Novel
M3   Markdown / YAML Engine
M4   Historical Write-engine Design (superseded)
M5   AI SDK ToolSet And Read Tools
M6   Human Approval Vertical Slice
M7   Aider-style Copilot Runtime
M8   Minimal Copilot Interface
M9   Summary And Memory Layer
M10  Workflow And Skills
M11  Extension System
M12  Polish, Tests, Import / Export
M13  Sandbox Change Engine And Unified Producers
M14  Core Writing Loop And Proportionate Review
```

## M0. Documentation Foundation

Goal: 建立稳定蓝图，让后续开发不漂移到数据库优先、Repository Layer 或重型 Agent 平台。

Delivered:

- `docs/PROJECT_VISION.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/FILESYSTEM_SPEC.md`
- `docs/SANDBOX_CHANGE_ENGINE.md`
- `docs/AGENT_RUNTIME_AND_TOOLS.md`
- `docs/HUMAN_APPROVAL_AND_GIT.md`
- `docs/AGENT_OPERATING_MANUAL.md`
- ADRs and task index

Done: stable docs agree on fixed in-memory editing, ChangeSet authority, PendingAction approval and Git boundary.

## M1. Project Scaffolding

Canonical source layout：

```text
packages/{core,tools,runtime,agent,backend,client}
apps/{desktop,desktop-ui,http-backend}
__test__/<module>/
```

Done: monorepo packages/apps and root test workspaces exist; new implementation must not return to a root `src/` tree.

## M2. Filesystem Spec And Example Novel

Goal: 把 Object File Tree 变成可验证 workspace。

Done criteria:

- Character、World、Chapter、Outline、State、Timeline、Foreshadow、Summary 与 Constitution 样例。
- stable numbered chapter paths。
- YAML/frontmatter/path identity validation。
- canonical vs derived vs disposable state 明确分离。

## M3. Markdown / YAML Engine

Goal: 提供 deterministic 读取、parse、serialize 与 final-document validation primitives。

原则：engine 可以在内存中产生 draft，但 canonical 写入只能由 accepted materializer 完成。

## M4. Historical Write-engine Design (Superseded)

本里程碑只保留早期专用 patch DSL 的历史事实。当前实现和后续 task 均不得据此恢复专用 executor、typed canonical-write tools 或双协议。

有长期价值的路径限制、baseline、diff、人类审批、事务、恢复与 Git 语义已经迁移到 M13。

## M5. AI SDK ToolSet And Read Tools

Goal: 使用 Vercel AI SDK `ToolSet` 暴露领域读取能力，不定义第二套 Tool abstraction。

Current read families：character、world、chapter、state、timeline、foreshadow、summary、constitution、workflow，以及 bounded workspace/sandbox reads。

写 turn 中所有文件读取必须来自同一个 fixed projection。

## M6. Human Approval Vertical Slice

Goal: 先证明“候选 -> PendingAction -> Accept/Reject -> Git diff”闭环。

历史 vertical slice 已完成；其临时专用 write API 和内部 candidate layout 不再是 current architecture。M13 保留审批不变量并统一到 strict ChangeSet/store/materializer。

## M7. Aider-style Copilot Runtime

Goal: provider-agnostic tool loop、streaming、max-loop guard、tool error result、bounded audit 与 turn finalizer。

Done criteria:

- natural-language request can call read/edit tools。
- one sandbox session per turn。
- explicit/fallback proposal exactly once。
- abort/error discard unpersisted candidate。
- events/tool logs never persist raw bash args。
- runtime does not import provider/domain infrastructure。

## M8. Minimal Copilot Interface

```text
Electron
  -> localhost HTTP backend
  -> SSE / AI SDK UI stream
  -> Vue + @ai-sdk/vue
```

Deliverables: chat streaming、tool activity、PendingAction list/detail、create/update/delete diff、Accept/Reject、Git result。Frontend 不接触 filesystem、internal artifact、Git process 或 materializer。

## M9. Summary And Memory Layer

Goal: 使用 chapter/volume/global summaries、state、timeline 与 foreshadow 构造 bounded context，不加载整本小说，不把向量数据库当事实源。

Current delivery: `1030` 章节证据结算、`1290` 章级 freshness / 历史分层，以及 `0700` 显式卷/全书摘要生成已接通。卷摘要使用已验证当前章级证据，全书摘要使用已验证当前卷摘要；共享冻结 evaluator 核对覆盖清单、直接来源 byte/payload hash 与底层正文依赖。修改旧章或增删章会传递为上层 stale；生成及更新仍需 PendingAction / Accept，手工无来源摘要继续作为 unverified 参考。

## M10. Workflow And Skills

Goal: 作者可控的 Workflow、Writing Profile、Skill Prompt Pack 和 allowed tool filter。

tool filter 不能扩大 host-selected capability；Workflow 不能变成隐藏 planner。

Related completed split: tasks `1000`–`1100` cover context discipline、review/settlement、session artifacts、projections、Play 与 reference selection。

## M11. Extension System

Status: Deferred（2026-10-01 用户明确暂缓）；以下只保留未来边界，不是当前开发队列。

Goal: 轻量 extension manifest、Tool/Prompt/Workflow/Constitution template registration。

Extensions 不得获得 host shell、绕过 sandbox policy、直接写 canonical 文件或引入复杂 runtime。

## M12. Polish, Tests, Import / Export

Goal: old manuscript import、readable export、Git UI、validation、跨平台 package 与真实 workspace polish。

Import/export 是显式用户 workflow；AI 导入产生 canonical change 时仍走 PendingAction。

Current delivery: `1270` Markdown/TXT导出、`1300` create-only Markdown旧稿导入、`1280` Electron发行流程已交付。`1310` 将严格类型/回归门禁、Git预览绑定和打包重启旅程接入现有链路。导入无需模型，但所有正式章节创建仍由作者审阅PendingAction后Accept。

## M13. Sandbox Change Engine And Unified Producers

Task `0800` 冻结并验证：

1. pinned `bash-tool` / `just-bash` / diff dependencies and packaged resources；
2. fixed `InMemoryFs` projection、`TrackingFs`、`PolicyFs`；
3. host-selected capability 与 complete final validators；
4. normalized create/update/delete `CandidateChangeSet`；
5. strict schema v1 PendingAction/prepared preview/store/public DTO；
6. durable `ChangeMaterializer` transaction、crash recovery、Git receipts；
7. Runtime/Agent shared session、fallback finalizer、abort/dispose 与 audit secrecy；
8. Reference publication/adoption、Play adoption deterministic producers；
9. Backend/Client/Desktop atomic production cut；
10. one-time disposable state reset；
11. stable docs and legacy architecture checker；
12. full tests/build/package/real Electron smoke。

M13 done criteria:

- Accept 前任意 model command 不改变 canonical bytes。
- Accept 不依赖 shell runtime 或 diff parsing。
- multi-file create/update/delete rollback and recovery are deterministic。
- every writable family has complete final validator。
- public DTO never exposes candidate bytes/internal artifact paths。
- no compatibility engine or old state reader remains。
- packaged desktop uses pinned notices/resources and passes smoke。

## M14. Core Writing Loop And Proportionate Review

Tasks: [1330](tasks/1330.md)、[1340](tasks/1340.md)。

Done criteria:

- 空作品通过 `/写下一章` 直接生成并 Accept 第一章；后续写章目标为最新章的下一章。
- 角色卡与大纲的目标路径由 host 推导，作者无需预先选中文件。
- 续写默认上下文包含大纲与上一章。
- 派生记录可整批接受，失败即停；首页显示未整理章节数。

## MVP Vertical Slice

```text
1. 初始化或打开 novel workspace。
2. 作者明确请求编辑章节/角色/状态/时间线等。
3. Host 选择 exact capability 并创建 fixed projection。
4. Runtime 读取并在内存 VFS 中迭代修改。
5. finalize 生成 CandidateChangeSet 和 PendingAction。
6. UI 展示 structured changes + diff。
7. 作者 Accept。
8. ChangeMaterializer 事务化写入。
9. Git auto-commit 或显式 quick commit。
```

## Risks And Mitigations

### Coarse Files

Risk: 候选退化为巨大全文 rewrite。Mitigation: Object File Tree、bounded file size、diff review 与针对性 prompt/policy。

### Sandbox Boundary Drift

Risk: 逐渐变成通用 host shell。Mitigation: fixed in-memory projection、exact command/capability allowlists、full IFS policy、packaged dependency gates。

### Incomplete Validation

Risk: 只 parse YAML，却破坏 domain invariant。Mitigation: validator inventory；缺失 validator 的 family 保持 read-only。

### Transaction Ambiguity

Risk: crash 后猜测 rollback/finalize。Mitigation: durable terminal commit point、operation-aware journal、pre/post-commit deterministic recovery。

### Runtime Framework Drift

Risk: 加入 Planner、多 Agent 或 hidden retry。Mitigation: runtime dependency boundary and focused tests。

### UI Authority Drift

Risk: UI 从 diff/artifact 推断 path 或决定 materialization。Mitigation: strict public DTO，changes-derived labels，Backend owns decisions。

## Development Rules

```text
Do not introduce heavy agent frameworks.
Prefer explicit TypeScript and strict schemas.
Never expose host shell or filesystem to the model.
Never materialize candidate files before human Accept.
Never parse diff or replay commands during Accept.
Never maintain a compatibility write engine.
```
