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

优先保持：filesystem first、Object File Tree、Aider-style Runtime、Vercel AI SDK ToolSet、人类审批和 Git history。不要提前引入 Multi-Agent、autonomous background writing、extension marketplace、vector database memory 或 rich-text database。

## Current Delivery Priority (2026-10-05)

按 [1230 修正任务](tasks/1230.md) 的最新记录推进，原评审只作带日期的基线。首次使用、审批恢复、中文 Git 路径、最终树引用校验、标准上下文治理、会话恢复和已记录的 Play 可靠性修正已交付。

现已交付标准Agent usage治理、受限多领域结构化结算、正文搜索、Markdown/TXT导出、Play派生窗口/快照优化，以及[1290](tasks/1290.md)章级来源新鲜度与长篇历史加载、[1300](tasks/1300.md)作者Markdown旧稿导入。[1310](tasks/1310.md)承接生产类型/发行质量门禁、Git预览绑定提交与打包写作旅程，其最终验证以任务记录为准。后续候选是 `0700` 卷/全局摘要、`0580` 远端同步收尾与更多环境验收、`1120`剩余Play可靠性。完整Play mutation/CAS成本仍线性，进一步优化以实测门槛为准。

**Extension 系统开发暂缓。** 不新增动态 Tool 注册、extension host code、更多 Director 控制或 Reference 分析层；保留已经交付的能力。恢复扩展前，先证明已有写作、审批、导出与 Play adoption 的真实创作旅程。

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

Current delivery: `1030` 章节证据结算与 `1290` 章级 freshness / 历史分层已完成。卷/全局摘要可作为明确未验证的手工参考读取，生成和多层来源覆盖传播仍待独立实现。

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
