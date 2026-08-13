# Migrate SemanticPatch To Sandbox Change Engine Implementation Plan

> Date: 2026-08-12
> Task: `docs/tasks/0800.md`
> Status: Completed (2026-08-13)
> Delivery mode: one-time breaking architecture replacement before the first public release
> Completion evidence: see `docs/tasks/0800.md` Implementation Notes.

## Goal

把当前正式写入链路从领域专用的 `SemanticPatch + Apply Engine` 完全迁移为：

```text
LLM
  -> AI SDK ToolSet from bash-tool
  -> just-bash over an in-memory workspace
  -> CandidateChangeSet
  -> PendingAction
  -> human Accept
  -> transactional materialization
  -> Git commit
```

模型使用已经被广泛训练和 agent 优化过的 shell、文件读取和文件编辑能力完成候选修改；OAN 不再维护一套要求模型先把写作意图翻译成 `ObjectPatch`、`CollectionPatch`、`NarrativePatch` 的领域 DSL。

迁移只替换“候选修改如何生成和表达”。以下产品边界保持不变：

- Markdown、YAML 和 Object File Tree 仍是 canonical truth。
- Git 仍是历史引擎。
- 用户 Accept 前，真实小说目标文件不得发生任何字节变化。
- PendingAction 仍是唯一的人类审批对象。
- Accept 仍是唯一的真实文件 materialization 边界。
- Accept 后仍按配置自动创建只包含本次变更的 Git commit。

## Delivery Decision

本任务采用一次性破坏性切换，不实现兼容期。

- 新 `PendingAction` 是全新协议，直接从 `schemaVersion: 1` 开始。
- 不读取、转换或执行旧的无版本 PendingAction。
- 不读取或转换旧的 prepared write-intent preview。
- 不实现 `semanticPatch | sandbox` feature flag。
- 不实现双引擎、dual-run、shadow comparison、canary 或 soak period。
- 不保留 legacy decoder、legacy executor、downgrade guard 或 v1-to-v2 migrator。
- 不要求新旧引擎产生字节级 parity；只要求新的安全和业务不变量成立。
- 开发阶段的回滚使用 Git commit / branch 回退，不在产品运行时保留旧引擎。
- 合并完成后，生产代码中只允许存在 Sandbox Change Engine。

这项授权只覆盖 OAN 内部运行状态和协议。它不授权删除或改写小说 canonical 文件、工作区配置或 Git 历史。

## Why This Architecture

### Why SemanticPatch Is Removed

SemanticPatch 的优势是目标明确、易验证和适合小模型；它的成本是：

- 每一种小说领域和操作都需要维护类型、normalizer、validator 和 executor。
- 模型需要把自然的编辑意图先翻译成 OAN 私有 DSL，再由 OAN 翻译成文件内容。
- 跨文件重构、移动、删除、迭代检查和使用 `rg`、`sed`、`awk`、`jq`、`yq` 的工作流表达笨重。
- 新一代模型已经针对 shell 和代码 agent 工作流训练，私有 patch DSL 的模型先验更弱。
- 当前 Apply Engine 已与 PendingAction、shadow write、backend producer 和 UI DTO 深度耦合，继续扩展会放大维护成本。

迁移后仍然保留 Apply Engine 中真正有长期价值的部分：路径限制、最终内容校验、baseline 检查、diff、人类审批、事务落盘、恢复和 Git。

### Why `git diff` Is Not The Change Capture Protocol

不能在 just-bash 内直接执行 `git diff` 来生成权威变更：

- just-bash 的默认命令集不包含宿主 Git。
- `InMemoryFs` / `OverlayFs` 中的候选修改对宿主 `.git` 不可见。
- 在虚拟文件系统里复制 `.git` 会扩大暴露面、内存和一致性成本。
- unified diff 是展示格式，不适合反向解析为可靠的 create/update/delete 事务。
- diff 不能独立表达 baseline hash、候选 artifact hash、路径策略和 Accept precondition。

正确分工是：

1. session 启动时固定 baseline manifest；
2. `TrackingFs` 记录可能被修改的路径；
3. finalize 时比较 baseline 与最终 VFS，生成权威 `CandidateChangeSet`；
4. host 端从旧内容和候选内容生成 Git 风格 unified diff，仅供审批展示；
5. Accept 后才使用宿主 Git 做 status/diff/add/commit。

### Why OAN Integrates Instead Of Forking just-bash

不 fork just-bash，也不修改它的 private `OverlayFs.memory` / `deleted`。

just-bash 已公开 `IFileSystem`，包含全部读写和 mutation API。OAN 在该公开接口之上实现装饰层：

```text
Bash
  -> PolicyFs
  -> TrackingFs
  -> InMemoryFs
```

这属于 OAN 侧的安全适配，不是维护 just-bash 分叉。只有在公开接口无法满足经过测试证明的需求时，才考虑向上游贡献 API；本计划不使用 `patch-package`。

### Threat Boundary

模型输出、workspace 文本和 reference 内容都视为不可信输入；bash-tool/just-bash 的 pinned package code 视为受信依赖。

- v1 的安全目标是：任意受支持 shell command、prompt injection、路径构造或 tool-call sequence 都不能越过 projection/PolicyFs，也不能在 Accept 前修改 canonical 文件。
- just-bash 是同进程解释器而不是 VM/container，且上游将其标记为 beta。PolicyFs、limits 和 defense-in-depth 不能宣称抵抗 just-bash/npm dependency 本身的任意代码执行漏洞。
- OAN 不向 sandbox 暴露 host FS、host process、network、secrets、trusted custom commands、Python 或 JavaScript runtime；这把可信依赖漏洞之外的攻击面降到最低。
- 依赖 pin、license/notices、package integrity、security regression/fuzz corpus 和 Electron packaged smoke 是发布门禁。
- 如果未来支持不可信插件、多租户或远程第三方 workspace，必须先增加 OS process/container isolation；这不属于本地单用户 v1 的完成条件。

### AI SDK Version Boundary

当前仓库使用 `ai@6.0.197`，2026-08-12 npm latest 为 `7.0.62`。`bash-tool@1.3.18` 同时支持 AI SDK 6 和 7，因此本任务不把 AI SDK major upgrade 与写入引擎迁移绑在一起。

- 本计划必须按当前安装的 AI SDK 6 文档实现 `ToolSet`。
- 不把现有 Aider-style runtime 改成 `ToolLoopAgent`。
- 推荐在 Task 4 的 agent wiring 前单独完成 AI SDK 7 升级；若明确延期，则本迁移继续按已安装的 v6 文档实现。两项不能放进同一变更同时排查 breaking changes。

## Non-Goals

- 不引入宿主 shell、`child_process` 或真实 workspace 的 `ReadWriteFs`。
- 不提供通用代码仓库 sandbox。
- 不在首版支持二进制文件、symlink、hardlink、mode-only 或 mtime-only 修改。
- 不在首版保留 rename 语义；rename 规范化为 delete + create。
- 不要求确定性 backend workflow 为了形式统一而拼接 shell 字符串。
- 不把 command transcript 当作审批或重放协议。
- Accept 永远不重新执行模型命令。
- 不自动合并 stale candidate。
- 不保留旧 SemanticPatch public API。

## Current-State Baseline

迁移开始前必须承认当前 SemanticPatch 已经实现，不能把 `0800` 当成尚未开始的绿地任务：

- `packages/tools/src/apply-engine.ts` 已包含 SemanticPatch union、preview、validator、target resolver、executor 和 diff。
- `packages/tools/src/write-intent-tools.ts` 已包含 PendingAction store、shadow writes、locks、baseline preflight、transaction journal、rollback/recovery 和 Git accept。
- `packages/agent/src/index.ts` 默认组合 read tools 与六个 write-intent tools。
- Runtime、Backend、Client、Play adoption、Reference adoption 和 session artifacts 都携带 `patches` 或 `shadowWrites` 语义。

因此本任务是“替换已经存在的旧架构”，不是继续实现旧文档中的 Apply Engine。

## Frozen Architecture

### Four Layers

```text
SandboxEditSession
  owns a fixed virtual workspace, AI SDK tools, limits and lifecycle
            |
            v
CandidateChangeSet
  authoritative normalized create/update/delete proposal in memory
            |
            v
PendingAction
  immutable, durable, reviewable proposal with draft artifacts
            |
            v
ChangeMaterializer
  baseline recheck, transactional Accept, recovery and Git commit
```

每一层只有一个职责：

- `SandboxEditSession` 允许模型探索和编辑，不写 canonical 文件。
- `CandidateChangeSet` 表达最终结果，不表达模型执行过程。
- `PendingAction` 让候选结果跨进程存活并进入审批 UI。
- `ChangeMaterializer` 只应用已经批准的不可变候选，不依赖 bash-tool/just-bash。

### Authority Order

发生冲突时，权威顺序为：

1. canonical workspace bytes and Git state；
2. PendingAction `changes`、baseline hashes 和 draft hashes；
3. CandidateChangeSet；
4. rendered unified diff；
5. command transcript and model explanation。

命令日志和 diff 都不能驱动 Accept。

## Data Contracts

最终类型名可以按仓库风格微调，但语义和约束必须保持。

### CandidateChangeSet

```ts
export interface CandidateChangeSet {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  finalizedAt: string;
  projectionFingerprint: string;
  repository: RepositoryBaseline;
  source: CandidateChangeSource;
  changes: CandidateFileChange[];
  stats: {
    created: number;
    updated: number;
    deleted: number;
    changedBytes: number;
  };
}

export type CandidateChangeSource =
  | {
      kind: 'bash-session';
      capability: WorkspaceEditCapability;
      commandLogHash: string;
      commandCount: number;
      finalization: 'explicit-tool' | 'runtime-fallback';
    }
  | {
      kind: 'deterministic-builder';
      producer: string;
      capability: WorkspaceEditCapability;
    };

export type CandidateFileChange =
  | {
      operation: 'create';
      path: string;
      baseline: { exists: false };
      draft: CandidateContent;
    }
  | {
      operation: 'update';
      path: string;
      baseline: ExistingContent;
      draft: CandidateContent;
    }
  | {
      operation: 'delete';
      path: string;
      baseline: ExistingContent;
      draft: null;
    };

export interface ExistingContent {
  exists: true;
  sha256: string;
  byteLength: number;
  mode: number;
}

export interface CandidateContent {
  sha256: string;
  byteLength: number;
  content: string;
}

export interface RepositoryBaseline {
  repositoryId: string;
  branch: string;
  head: string;
}
```

约束：

- `path` 是 NFC-normalized、workspace-relative POSIX path。
- `changes` 按 path 稳定排序，不允许重复路径。
- 只支持无 NUL 的合法 UTF-8 text。
- update/delete 必须携带 baseline hash；create 必须声明原目标不存在。
- 最终内容与 baseline 一致的路径必须消除，不得产生 no-op change。
- 空 ChangeSet 不创建 PendingAction。
- `CandidateContent.content` 只存在于内存阶段，不能通过 HTTP 暴露。
- `projectionFingerprint` 用于证明 session 的固定视图；Accept 的硬 precondition 仍以 touched path baseline 为准。
- `repository` 由 host 从真实 Git worktree 读取；repository identity、branch 或 HEAD 任一变化都会使 proposal/Accept stale。

### PendingAction

```ts
export interface PendingAction {
  schemaVersion: 1;
  kind: 'pending-action';
  id: string;
  title: string;
  description: string;
  createdAt: string;
  source: PendingActionSource;
  repository: RepositoryBaseline;
  changes: PendingFileChange[];
  preview: {
    diff: string;
    diffHash: string;
  };
  origin?: PendingActionOrigin;
}

export type PendingActionSource =
  | {
      kind: 'bash-session';
      sessionId: string;
      capability: WorkspaceEditCapability;
      commandLogHash: string;
      commandCount: number;
      finalization: 'explicit-tool' | 'runtime-fallback';
    }
  | {
      kind: 'deterministic-builder';
      producer: string;
      capability: WorkspaceEditCapability;
    };

export type PendingActionOrigin =
  | {
      kind: 'agentTurn';
      sessionId: string;
      turnId: string;
    }
  | {
      kind: 'referenceDeconstructionPublish';
      referenceId: string;
      runId: string;
      runRevision: number;
      candidateFingerprint: string;
    }
  | {
      kind: 'referenceMaterialAdoption';
      referenceId: string;
      manifestRevision: number;
      sourceChecksumSha256: string;
      contextFingerprint: string;
      previewFingerprint: string;
    }
  | {
      kind: 'playAdoption';
      sessionId: string;
      branchId: string;
      sourceRevision: number;
      previewFingerprint: string;
    };

export type PendingFileChange =
  | {
      operation: 'create';
      path: string;
      baseline: { exists: false };
      draft: DraftArtifact;
    }
  | {
      operation: 'update';
      path: string;
      baseline: ExistingContent;
      draft: DraftArtifact;
    }
  | {
      operation: 'delete';
      path: string;
      baseline: ExistingContent;
      draft: null;
    };

export interface DraftArtifact {
  relativePath: string;
  sha256: string;
  byteLength: number;
}
```

约束：

- 新协议必须同时严格校验 `schemaVersion`、`kind` 和完整字段集合。
- 无 `schemaVersion`、未知版本、`patches` 或旧 `shadowWrites` 结构统一报 `UNSUPPORTED_PENDING_ACTION_SCHEMA`。
- stored action 不保存 `SemanticPatch`、shell command 或可执行 recipe。
- create/update 的候选内容只保存在 OAN 内部 draft artifact 中。
- delete 不需要 draft artifact。
- `changes` 是唯一权威列表；`touchedFiles` 若 API 为 UI 便利而返回，只能现场从 `changes.map(change => change.path)` 派生，不能在存储协议中重复保存。
- persisted diff 只供展示，Accept 不读取或解析 diff。
- PendingAction 一旦创建，candidate artifact 和 change metadata 不可变。
- update/delete 在 proposal 和 Accept 都验证 normalized mode；update 保持 baseline mode，create 使用固定 `0o644`，chmod/mode-only change 不进入 v1。

PendingAction proposal 与 lifecycle record 分离，避免“immutable proposal”和终态字段相互矛盾：

```ts
export type PendingActionRecord =
  | {
      action: PendingAction;
      status: 'pending';
    }
  | {
      action: PendingAction;
      status: 'accepted';
      acceptedAt: string;
      decisionReceiptId: string;
    }
  | {
      action: PendingAction;
      status: 'rejected';
      rejectedAt: string;
      decisionReceiptId: string;
    };

export interface PendingActionDecisionReceipt {
  schemaVersion: 1;
  id: string;
  actionId: string;
  decision: 'accepted' | 'rejected';
  decidedAt: string;
  materialization: 'not-applicable' | 'committed';
  git:
    | { status: 'not-requested' }
    | { status: 'committed'; commit: string; branch: string }
    | { status: 'staged-not-committed'; branch: string; errorCode: string }
    | { status: 'failed'; errorCode: string };
}
```

- Proposal、terminal record 和 decision receipt 都使用原子写入。
- Proposal 永不修改；lifecycle 通过 terminal record 表达。
- Git 是 Accept 后 side effect，其结果只写 decision receipt，不回写 proposal。
- Public DTO 从 record + receipt 派生 `status`、timestamp 和 Git result。

Reference/Play 的跨请求 preview/promote 保留为一个明确的新协议，不留 “rename or remove” 选择：

```ts
export interface PreparedChangePreviewV1 {
  schemaVersion: 1;
  kind: 'prepared-change-preview';
  id: string;
  capability: WorkspaceEditCapability;
  candidateFingerprint: string;
  repository: RepositoryBaseline;
  origin: PendingActionOrigin;
  allowedTargets: string[];
  changes: PendingFileChange[];
  preview: {
    diff: string;
    diffHash: string;
  };
  createdAt: string;
}
```

- prepared candidate bytes 使用独立的内部 immutable draft artifacts。
- promote 重验 repository、origin freshness、allowed targets、baseline 和 artifact hashes，再创建相同 change fingerprint 的 PendingAction。
- 旧 `PreparedWriteIntentPreview` 虽然也使用数字版本 1，但缺少 `kind: 'prepared-change-preview'` 且字段不同，必须报 unsupported；不能仅按版本号接受。
- 未 promote 的旧 preview 由一次性 reset 丢弃，不转换。

### Public DTO

Renderer 和 HTTP client 不得看到内部 artifact 路径：

```ts
export interface PendingActionView {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  changes: Array<{
    operation: 'create' | 'update' | 'delete';
    path: string;
    oldHash?: string;
    newHash?: string;
  }>;
  diff: string;
  origin?: PublicPendingActionOrigin;
  git?: PublicPendingActionGitResult;
}

export type PublicPendingActionOrigin = PendingActionOrigin;
export type PublicPendingActionGitResult = PendingActionDecisionReceipt['git'];
```

### Durable Storage Layout

新协议使用独立命名空间，绝不扫描旧 `.workspace/pending-actions` 等目录：

```text
.workspace/change-engine/v1/
  pending/<action-id>.json
  drafts/<action-id>/<change-index>.txt
  terminal/accepted/<action-id>.json
  terminal/rejected/<action-id>.json
  receipts/<action-id>.json
  transactions/<action-id>.json
  locks/actions/<action-id>.lock
  locks/apply.lock
  previews/<preview-id>/preview.json
  previews/<preview-id>/drafts/<change-index>.txt
```

- id 只能使用严格校验后的 opaque id，不能参与任意路径拼接。
- 所有 JSON/draft 使用同目录 temp file + fsync + atomic rename；目录创建和 realpath/symlink guard 复用统一内部路径 helper。
- `pending` proposal immutable；Accept/Reject 用 terminal record 表达状态，不原地改 proposal。
- accepted terminal record 是文件事务 commit point。若 terminal=accepted 而 journal 未到 finalize-only，恢复以 terminal 为准并只 finalize；若 journal=accepted-finalize-only 但 terminal 缺失，恢复先原子补 terminal 再 finalize。
- commit point 前只有 pending + transaction 时 rollback；没有 journal 的孤立 temp/stage/draft 按严格 owner/id 清理，绝不触碰 canonical。
- receipt 缺失不改变 accepted/rejected 事实；按 journal/Git reconciliation 补写。
- list/read 若同一 id 同时出现 accepted 与 rejected terminal，报 corruption 并 fail closed。
- prepared preview 与 PendingAction 使用不同 `kind` 和目录，promote 不原地改 preview，而是创建 immutable action 后写 promotion receipt/terminal marker。

## Virtual Workspace Design

### Default Backend: Fixed InMemoryFs Snapshot

首版生产默认使用 just-bash `InMemoryFs`，不直接把 `OverlayFs` 挂到真实 workspace：

1. session 开始时枚举允许暴露的文件；
2. 校验每个路径、文件类型、大小、编码和 symlink 状态；
3. 一次性读取允许文件并构建 baseline manifest；
4. 把固定内容装载到 `/workspace`；
5. session 运行期间不再从真实 workspace lazy-read。

这样每次 session 都看到同一时刻的完整视图，不会因为 OverlayFs 的实时 fallback 混合两个磁盘时刻。

`OverlayFs` 只作为未来超大工作区优化。若后续启用，必须增加 `BaselineGuardFs`，在读取/第一次修改时验证宿主 hash，并在 finalize 前重验完整 projection；不满足时整个 session 标记 stale。本任务不启用该生产路径。

同一 turn 内所有文件型 domain read tools 也必须从这个固定 projection/VFS 读取，不能继续直接读取实时宿主文件。非文件外部数据若进入 prompt/tool result，必须记录 source fingerprint 并纳入 session freshness check。proposal 前仍重验宿主 projection，发现 drift 后整项 stale。

### Projection

虚拟 workspace 只投影完成当前任务所需的 canonical 文件：

- 可读写：策略明确授予的 `chapters/`、`characters/`、`world/`、`state/`、`timeline/`、`foreshadow/`、`summaries/`、`outline/`，以及受控 `examples/references.yaml` / `examples/references/<referenceId>/` 目标。
- 只读：必要的 `.oan/constitution/`、`.oan/workflow.yaml` 和当前 skill/config 摘要。
- 隐藏且不可见：`.git/`、`.workspace/`、`.oan/sessions/`、secret/provider config、其它内部 recovery artifacts。
- `/tmp`：允许 session 临时文件，不进入 CandidateChangeSet。
- `/bin`、`/usr/bin`、`/dev`、`/proc`：只允许 just-bash 自身所需的虚拟布局，不作为 workspace data。
- 其它绝对路径：拒绝。

Projection policy 必须由 host 构造，不能依赖 bash-tool 的 prompt file list 或 glob include 作为安全边界。

### Turn-Scoped Capability Policy

单一 `bash` 工具不等于单一全局写权限。每个 `SandboxEditSession` 必须接收由可信 host workflow 选择、模型不能在 tool args 中自行声明或扩大的一项 capability：

```ts
export type WorkspaceEditCapability =
  | 'read-only'
  | 'chapter.edit'
  | 'character.edit'
  | 'world.edit'
  | 'state.edit'
  | 'timeline.edit'
  | 'foreshadow.edit'
  | 'summary.edit'
  | 'outline.edit'
  | 'novel.multi-file-edit'
  | 'reference.publish'
  | 'reference.adopt'
  | 'play.adopt';

export interface WorkspaceChangePolicy {
  capability: WorkspaceEditCapability;
  readable: PathRule[];
  writable: PathRule[];
  validators: FinalDocumentValidatorId[];
  maxChangedFiles: number;
  maxCandidateBytes: number;
}
```

最小映射：

| Capability | Writable family | Selection authority |
| --- | --- | --- |
| `read-only` | none | unknown/missing workflow, ordinary read-only turn |
| `chapter.edit` | bounded `chapters/**/*.md` | trusted chapter authoring workflow + selected chapter |
| `character.edit` | bounded `characters/<selected-id>/**` | trusted character workflow |
| `world.edit` | bounded selected `world/**` objects | trusted world workflow |
| `state.edit` | bounded `state/**/*.yaml` | trusted state workflow |
| `timeline.edit` | bounded `timeline/**/*.yaml` | trusted timeline workflow |
| `foreshadow.edit` | bounded `foreshadow/**/*.yaml` | trusted foreshadow workflow |
| `summary.edit` | bounded `summaries/**/*.md` | trusted summary workflow |
| `outline.edit` | bounded `outline/**/*.md` | trusted outline workflow |
| `novel.multi-file-edit` | explicit union of non-internal novel object families | explicit author editing request routed by host |
| `reference.publish` | one bounded `examples/references/<referenceId>/` publication | reference publication controller |
| `reference.adopt` | exact adoption targets selected by the adoption plan | reference adoption controller |
| `play.adopt` | exact targets selected by the Play adoption plan | Play adoption controller |

- Unknown capability is `read-only`, never broad write.
- General chat does not receive `novel.multi-file-edit` merely because the model asks for it; the host must derive it from the user-facing action/workflow.
- Deterministic producers receive their own exact policy instance and never reuse a wildcard agent policy.
- PolicyFs enforces capability before mutation; final ChangeSet validator enforces the same policy again after reconciliation.
- Read permission and write permission are independent; constitution/workflow can be projected read-only without making `.oan` writable.

### Final Document Validator Matrix

SemanticPatch normalizers currently carry part of the domain validation. Removing them requires validators over final file content, not a promise to “reuse existing validation”. Before a file family becomes bash-writable, Task 2 must inventory, implement and test a complete validator:

| File family | Minimum final validation |
| --- | --- |
| chapter / summary / outline Markdown | UTF-8, size, frontmatter parse/allowed keys, required identity/path invariants, bounded headings/scene or outline identifiers where applicable |
| character / world object files | path-to-object identity, frontmatter/schema, required sections and duplicate identifier checks |
| state YAML | parse, allowed root shape, domain value/schema constraints and stable object identifiers |
| timeline YAML | parse, event schema, unique/stable IDs, ordering/date invariants and referenced object constraints |
| foreshadow YAML | parse, entry schema, unique/stable IDs and lifecycle/status constraints |
| Reference publication/adoption | exact reference id/path allowlist, manifest/material schema, source/run fingerprint and publication inventory consistency |
| Play adoption targets | exact approved targets, projection/source freshness and the validator of each target file family |

- Existing validators are reused only after an inventory proves they validate the final whole document.
- Constraints that currently live only in tool args, patch operations or normalizers must move into final validators or trusted producer checks.
- A capability remains read-only until every writable file family in its policy has a registered final validator.
- YAML parse success alone is never sufficient.

### PolicyFs

`PolicyFs implements IFileSystem`，在 mutation 到达 underlying FS 前执行授权：

- 规范化 POSIX 路径；拒绝空路径、absolute escape、`..` 和非 canonical 表示。
- 拒绝 `.git`、`.workspace`、未显式投影的 `.oan`、其它 hidden/internal path 和未投影路径；显式投影的 `.oan/constitution` / workflow 只读。
- 拒绝 symlink、hardlink、device、socket、FIFO 和非普通文件。
- 拒绝 `chmod`、`symlink`、`link`、`utimes`。
- `mkdir` 只能创建受控文件的父目录。
- `rm -r` 只能作用于可写 projection，并在 finalize 时展开为逐文件 delete。
- 强制单文件、文件数、总候选字节和路径深度限制。
- 所有 rejection fail closed，并返回可供模型修正的稳定错误。

隐藏规则必须覆盖读取和枚举，而不只是 mutation：`readFile`、`readFileBuffer`、`exists`、`stat`、`lstat`、`readdir`、`readdirWithFileTypes`、`getAllPaths`、`realpath` 和 `readlink` 都不能泄露未投影路径或文件名。`find`、glob 和 prompt file discovery 只能看到 projection。

`onBeforeBashCall` 的字符串过滤只能用于审计，不能代替 PolicyFs。

### TrackingFs

`TrackingFs implements IFileSystem`，覆盖所有 mutation API：

- `writeFile`
- `appendFile`
- `rm`
- `cp`
- `mv`
- `mkdir`
- `chmod`
- `symlink`
- `link`
- `utimes`

即使 PolicyFs 当前拒绝后三类操作，tracker 也必须显式覆盖，防止未来新增能力时出现旁路。

Wrapper 还必须代理 just-bash bootstrap 探测的同步扩展 `mkdirSync` / `writeFileSync`：

- 构造 Bash 前进入 `bootstrap` mode；
- 允许 just-bash 初始化 `/bin`、`/usr/bin`、`/dev`、`/proc` 和 command stubs；
- Bash 构造完成后调用 `activate()`；
- 激活后这些虚拟系统路径只读；
- bootstrap 写入不进入 mutation log 或 CandidateChangeSet。

mutation log 只帮助缩小最终比较范围，不是权威结果。`finalize()` 必须比较 baseline 与最终 VFS：

- missing -> file：create；
- file -> changed file：update；
- file -> missing：delete；
- changed then restored：no-op；
- move：delete + create；
- directory-only changes：不进入正式 ChangeSet。

### Command And Resource Policy

创建 `Bash` 时必须使用 hardened profile，并在测试中固定 OAN 自己的更窄限制。因为 OAN 传入外部 FS，`Bash.executionLimits.maxFileSystemBytes` 不会自动配置该 InMemoryFs；必须同时显式创建：

```ts
const memoryFs = new InMemoryFs(initialFiles, {
  maxTotalBytes: 64 * 1024 * 1024,
});
```

baseline snapshot、`/tmp` scratch 和 candidate 各自还要有独立计数器，不能只依赖 aggregate FS limit。Bash 每次 `exec()` 的 time/command/output limit 之外，SandboxEditSession 必须累计限制：bash call count、total wall time、source bytes、stdout/stderr bytes、scratch bytes 和 candidate bytes。

初始 Bash 建议值：

```ts
new Bash({
  fs: policyFs,
  cwd: '/workspace',
  commands: OAN_COMMAND_ALLOWLIST,
  executionLimitProfile: 'hardened',
  executionLimits: {
    maxExecutionTimeMs: 15_000,
    maxSourceBytes: 256 * 1024,
    maxCommandCount: 2_000,
    maxLoopIterations: 5_000,
    maxFileSystemBytes: 64 * 1024 * 1024,
    maxOutputSize: 2 * 1024 * 1024,
    maxTraversalEntries: 20_000,
  },
  defenseInDepth: { enabled: 'auto' },
  python: false,
  javascript: false,
});
```

命令 allowlist 第一版只包含文件和文本处理能力：

```text
echo printf cat ls mkdir touch rm cp mv pwd
head tail wc stat grep rg sed awk sort uniq cut tr nl tee
find basename dirname tree jq yq diff sha256sum file true false
```

明确禁止：

- network、`curl`、`wget`；
- Python、JavaScript、`js-exec`；
- `ln`、`chmod`；
- archive、database、package manager；
- trusted custom command；
- 宿主 process execution；
- 将任何 OAN callback 暴露成可任意调用的 shell command。

Candidate gate 初始限制：

- 最多 64 个 changed files；
- 单文件最多 2 MiB；
- create/update candidate 总内容最多 8 MiB；
- rendered diff 最多 10 MiB；
- 文件扩展名和目录必须满足 producer policy；
- YAML 必须 parse，且继续通过现有 schema/domain validator；
- Markdown/frontmatter、对象 ID、章节路径、reference publish 和 proposal-only 规则继续验证；
- 任一 touched baseline 漂移时整项 proposal/Accept 失败，不做局部应用。

stdout/stderr 在进入 UI 或日志前去除 ANSI 和危险控制字符，并始终作为纯文本渲染。

bash-tool 的 `maxOutputLength` 只限制 bash command output，不能保护其默认 `readFile` 或 OAN preview tool。因此：

- OAN 包装或替换 model-visible `readFile`，要求 line/byte range 并设置单次硬上限；
- `workspace.previewChanges` 只向模型返回 change summary 和有明确 `truncated: true` 标记的 bounded diff excerpt；
- 完整 diff 只持久化到 PendingAction 并发送审批 UI；
- 工具截断必须返回原始总字节/行数，不能让模型误认为已经看见完整内容。

## bash-tool Integration

不使用 `createBashTool({ uploadDirectory })`。该路径会在 bash-tool 内部创建并隐藏 OverlayFs，OAN 无法持有 tracker、baseline 和 lifecycle。

OAN 自己构造并持有：

```text
InMemoryFs
  -> TrackingFs
  -> PolicyFs
  -> Bash
  -> OanJustBashSandbox adapter
  -> createBashTool({ sandbox })
```

自定义 Sandbox 且不传 `files/uploadDirectory` 时，不能依赖 bash-tool 自动发现 just-bash commands。OAN 必须传入 host-owned `promptOptions.toolPrompt`，其命令说明只从 `OAN_COMMAND_ALLOWLIST` 和可信 projection metadata 生成；prompt discovery 不是 capability source。

建议接口：

```ts
export interface SandboxEditSession {
  id: string;
  tools: ToolSet;
  isDirty(): boolean;
  preview(): Promise<CandidateChangePreview>;
  finalizeCandidate(input: CandidateSourceMetadata): Promise<CandidateChangeSet | undefined>;
  discard(): Promise<void>;
}
```

`OanJustBashSandbox` 实现 bash-tool 的最小 `Sandbox` 接口，同时通过 closure 保留 session abort signal：

```ts
class OanJustBashSandbox implements BashToolSandbox {
  async executeCommand(command: string) {
    return bash.exec(command, { signal: sessionAbortSignal });
  }

  async readFile(path: string) {
    return policyFs.readFile(path);
  }

  async writeFiles(files: Array<{ path: string; content: string | Buffer }>) {
    // Normalize parents and write only through PolicyFs.
  }
}
```

模型可见工具：

- existing domain read tools；
- `bash`；
- `readFile`；
- `writeFile`；
- `workspace.previewChanges`；
- `workspace.proposeChanges`。

Task 4 的 session 只 finalize `CandidateChangeSet`，不依赖尚未实现的 PendingAction store。Task 5 在 store 存在后组合 `workspace.proposeChanges`：seal 当前 session、验证 ChangeSet、持久化 PendingAction，并返回现有 runtime 能识别的 `{ pendingActions: PendingActionView[] }` 结果。工具结果、Runtime state/event 和 SSE 从不携带 stored `PendingFileChange.draft.relativePath`。显式 propose 后 session 变为只读。

同一 user turn 的全部 tool loop 共享一个 session；不同 turn 使用独立 snapshot。命令失败不会回滚该命令之前已经发生的虚拟写入，模型可以检查并修正；finalize 始终以最终 VFS 为准。

Runtime 可保留 bash 可观测性，但不能把原始 tool args 无界透传：

- live event 只携带去控制字符、escaped、bounded 的 `commandPreview` 和 command hash；
- 单条 preview 和单 turn 累计 preview 都有硬上限，heredoc/长正文必须截断并标记；
- session tool log 保存同样的 bounded audit preview/hash，不保存可重放的完整 args object；
- Renderer 只能把 preview 当纯文本显示，永远不能执行或拼接回 host shell；
- PendingAction 只保存 command log digest/count，不保存 command preview。

## Runtime Lifecycle

Runtime 保持 provider-agnostic 的 Aider-style loop，但增加 host finalizer seam：

```ts
export interface RuntimeTurnFinalizer {
  finalizeTurn(input: {
    stoppedReason: 'completed' | 'max_tool_loops' | 'aborted' | 'error';
    pendingActions: PendingActionView[];
    abortSignal?: AbortSignal;
  }): Promise<PendingActionView[]>;
}
```

```text
create turn-scoped SandboxEditSession
  -> run model/tool loop
  -> explicit workspace.proposeChanges OR host fallback finalize
  -> emit pending_action
  -> emit message_finish
  -> dispose session
```

冻结行为：

- 正常完成且 session clean：不创建 PendingAction。
- 正常完成且 dirty、模型未显式 propose：runtime fallback finalize 创建一个 action，source 标记 `runtime-fallback`。
- 达到 max tool loops 且 dirty：与正常 fallback 相同。
- 模型已显式 propose：不重复创建 action。
- user abort：终止当前 bash execution，丢弃内存候选，不创建 PendingAction。
- provider/tool fatal error：丢弃未 propose 的内存候选；已经持久化的 PendingAction 不受影响。
- `pending_action` 事件必须出现在 `message_finish` 之前。
- session dispose 之后任何工具调用都失败。
- finalizer 只在 `completed` / `max_tool_loops` 时 fallback propose；`aborted` / `error` 只 discard/dispose。
- finalizer 返回的 actions 先合并进 runtime state，再逐个 emit `pending_action`，最后 emit `message_finish`。
- finalizer 自身失败映射为 runtime `error` finish，不得把 dirty candidate 当作成功或继续 emit `message_finish`。
- stream 和 non-stream 调用都必须在 agent 层 `finally` dispose session。

Runtime 只接受一个通用 async finalizer callback，不 import `packages/tools`，保持依赖方向稳定。

## Deterministic Producers

Reference publish/adoption、Play adoption 和其它确定性 workflow 不必伪造 bash 命令。它们直接使用同一个 `CandidateChangeSetBuilder` 或受控 virtual workspace writer：

```text
deterministic producer
  -> fixed baseline
  -> write candidate to virtual workspace/builder
  -> same WorkspaceChangePolicy
  -> same CandidateChangeSet
  -> same PendingAction
```

统一的是最终 ChangeSet 和审批/materialization，不是所有 producer 都必须调用 shell。

现有安全语义必须保留：

- Reference publication 的受限 target allowlist；
- Reference adoption 的 source checksum、fingerprint、create/update/skip decision；
- Play adoption 的 source drift、projection、origin freshness 和 bounded target；
- constitution/proposal-only 路径不能因泛化 bash 而变为可任意写入。

## ChangeMaterializer

从现有 `write-intent-tools.ts` 抽取并重写，而不是删除已验证的安全事务。

Accept 流程：

1. 严格读取 schemaVersion 1 PendingAction；
2. 获取 per-action lock 和 global apply lock；
3. 恢复任何遗留的新协议 transaction journal；
4. 重验 action identity、status、origin freshness 和路径 policy；
5. 重验 repository identity、branch 和 HEAD；任一变化均把 action 标记 stale；
6. 对每个 create 验证目标仍不存在；
7. 对每个 update/delete 验证目标仍是相同普通文件且 baseline hash/mode 未变；
8. 对每个 create/update 验证 draft artifact path、size 和 hash；
9. 确认 Git index 没有会被本次提交混入的 unrelated staged state；
10. 创建 operation-aware stage/backup/journal；
11. 按稳定 path 顺序 materialize create/update/delete；
12. 任一步失败，逆序 rollback；
13. 原子写 accepted terminal record，并把 journal 切到 `accepted/finalize-only`；这是文件事务 commit point；
14. 清理 stage/backup/draft；commit point 之后的恢复永远 finalize，不能 rollback；
15. 按 `git.autoCommitOnAccept` 执行 post-accept Git side effect，并原子写 decision receipt。

事务语义：

- create：stage new file；rollback 删除已经 materialize 的 target。
- update：backup original + stage draft；rollback 恢复 backup。
- delete：backup original；commit 删除 target；rollback 恢复 backup。
- rename：作为 delete + create 进入同一 journal。
- journal 至少有 `prepared | materializing | accepted-finalize-only` phase；crash recovery 在 commit point 前 rollback，在 commit point 后只 finalize，永远不猜测。
- archive 成功前不得删除唯一 backup。
- durable accepted terminal record 是文件事务 commit point；Git commit 不是文件事务的一部分。
- Git add/commit 失败时 canonical change 和 accepted record 保持不变，不得 rollback；decision receipt 记录 `staged-not-committed` 或 `failed`。
- `after git add / before commit` 的 crash recovery 保留明确 receipt/journal evidence，quick commit 只提交该 action 的 paths，并再次验证 repository/branch/index；不得静默重新执行 Accept。
- journal 持久化 `autoCommitRequested`；自动 commit 使用 action id trailer/metadata。若 commit 成功但 receipt 写入前崩溃，恢复先通过 repository/commit identity 对账，再补 receipt，不能重复 commit。
- backup/draft 清理不依赖 Git 成功。
- 若 touched baseline 在 proposal 时已相对 HEAD dirty，Accept 仍可按 diff 审批，但 auto-commit 必须 fail closed/降级为显式 quick commit，不能把 proposal 之前的用户修改混入“本次自动提交”。
- Reject 只 archive action 并清理 draft，不修改 canonical target。
- Accept 不要求 bash-tool/just-bash 存活或可加载。

## Breaking Internal-State Reset

### Unsupported State Behavior

新代码不静默忽略旧记录。发现旧结构时：

- pending/list/read/accept/reject API 返回稳定的 `UNSUPPORTED_PENDING_ACTION_SCHEMA`；
- UI 显示“开发版内部状态需要重置”，不能显示“没有待审批项”；
- canonical 文件保持零变化；
- 不提供自动转换按钮。

### One-Time Reset Scope

由于项目尚未发布，开发迁移采用一次性内部状态 reset。执行前必须关闭 Backend/Electron，并保存 reset 前的 Git status 和 canonical manifest。

允许删除：

```text
<workspace>/.workspace/
<workspace>/.oan/sessions/
```

这两个目录是 disposable runtime/session state。删除整个目录可以同时消除旧 PendingAction、terminal archive、shadow writes、prepared previews、transaction journal、locks、apply-engine temp、旧 tool log 和 `proposed-patches` artifact，避免留下部分兼容状态。

该 reset 会有意丢弃尚未 Accept 的候选、accepted/rejected 内部审计副本、agent chat/tool log、Play 临时 session、Reference/Play preview、可重建 projection/report 等内部状态。需要保留的结果必须在 reset 前显式采纳或导出到 canonical 文件/Git；本任务不为这些内部记录编写迁移器。

必须保留：

```text
<workspace>/.git/
<workspace>/.oan/config.yaml
<workspace>/.oan/constitution/
<workspace>/.oan/workflow.yaml
<workspace>/.oan/skills/
<workspace>/chapters/
<workspace>/characters/
<workspace>/world/
<workspace>/state/
<workspace>/timeline/
<workspace>/foreshadow/
<workspace>/summaries/
<workspace>/outline/
<workspace>/examples/references.yaml
<workspace>/examples/references/
其它 canonical novel files
```

reset 约束：

- 只能操作 realpath 校验后、名称精确匹配的上述两个目录。
- 禁止删除整个 `.oan`、workspace root 或 `.git`。
- 禁止使用未解析环境变量、glob 或宽泛递归路径。
- reset 前若存在未提交 canonical 修改，只记录并保留，不自动 commit、stash 或丢弃。
- reset 前必须用 Git index 断言两个目标目录下没有 tracked file；若存在则停止并先人工分类，不能把 tracked 内容当 disposable state。
- canonical manifest 明确排除 `.workspace/` 和 `.oan/sessions/`，但必须包含其余 `.oan` 配置以及全部小说对象树文件。
- reset 后重新计算 canonical manifest 和 `git status --short`，必须证明小说真实文件未改变。
- 新代码首次运行按需重新创建内部目录。
- reset 是开发迁移步骤，不作为每次产品启动时永久执行的逻辑。
- tests、sample workspace 和本地开发 workspace 都重新初始化，不维护旧 fixture reader。

## Proposed File Structure

首版留在 `packages/tools`，避免为了基础设施再引入一个 package/repository layer：

```text
packages/tools/src/
  candidate-change-set.ts
  workspace-projection.ts
  tracking-fs.ts
  policy-fs.ts
  sandbox-edit-session.ts
  sandbox-toolset.ts
  workspace-change-policy.ts
  final-document-validator.ts
  change-diff.ts
  pending-action-types.ts
  pending-action-store.ts
  change-materializer.ts
  deterministic-change-producers.ts
```

只有在实现后出现明确的复用或 bundle 边界问题，才另立 `packages/sandbox`；不得在本任务中预先增加抽象层。

## Implementation Order

### Buildability Rule

Tasks 2-8 add and test the new modules and migrate call sites behind explicit dependency injection, but do not change the production default/store/export one subsystem at a time. The old source may temporarily coexist on the implementation branch so every intermediate commit builds; this is not a runtime feature flag, dual-run or compatibility promise.

Task 9 is the single atomic production cut:

1. switch default agent toolset and Runtime finalizer;
2. switch PendingAction store/parser/materializer;
3. switch all deterministic producer/backend/client/UI contracts;
4. delete every old export/executor/normalizer in the same cut;
5. run the full repository gate before that commit is considered valid.

No released or supported build may expose both protocols.

### Task 0: Freeze The New Decision And Task Ledger

0800 uses `Needs Review`, not because the new engine already exists, but because the task's old SemanticPatch deliverable has substantial landed code and this new plan requires that implementation to be reviewed and replaced. This matches the repository definition “已有实现，但新增 plan 暴露出需要复核、补测或补实现的差异”.

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEVELOPMENT_PLAN.md`
- Add: `docs/adr/0004-sandbox-change-engine.md`
- Modify: `docs/adr/0003-semantic-patch-apply-engine.md`
- Modify: `docs/tasks/0800.md`
- Modify: `docs/tasks/README.md`
- Modify: `docs/superpowers/plans/2026-06-10-align-apply-engine-implementation-order.md`

- [x] Write ADR 0004 and mark it `Accepted`.
- [x] Immediately replace the old stable architecture formula in `AGENTS.md`, `docs/README.md`, `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_PLAN.md` with a concise Sandbox Change Engine decision and `0800 migration in progress`; detailed prose can be completed in Task 11.
- [x] Mark ADR 0003 `Superseded by ADR 0004` without rewriting its historical body.
- [x] Rename task 0800 to `Sandbox Change Engine Migration`, change `Planned -> Needs Review`, and move its entry from Planned to Needs Review in `docs/tasks/README.md` while implementation is incomplete.
- [x] Point 0800 only to this plan; do not add 0810-0860 compatibility rollout tasks.
- [x] Add a superseded banner to the old Apply Engine implementation-order plan.
- [x] Record the destructive-state-reset decision and canonical preservation boundary in ADR 0004.

**Gate:** a new agent reading ADR 0004 and task 0800 cannot reasonably continue implementing SemanticPatch.

### Task 1: Add And Verify Dependencies

**Files:**

- Modify: `packages/tools/package.json`
- Modify: root `package.json`
- Modify: `package-lock.json`
- Modify or add: third-party notices/license inventory used by packaging
- Test: `__test__/tools/src/sandbox-dependency-smoke.test.ts`

- [x] Add exact compatible baselines: `bash-tool@1.3.18`, `just-bash@3.2.0`, and `diff@8.0.2` as direct dependencies of `@oh-awesome-novel/tools`.
- [x] Do not rely on bash-tool's transitive just-bash/diff dependency for imports.
- [x] Confirm repository Node 24 baseline satisfies just-bash `>=20.18.1`.
- [x] Declare the Node 24 baseline in root package engines/CI or package smoke configuration, rather than relying only on the developer machine.
- [x] Verify tsdown and Electron main-process bundles can load the packages.
- [x] Preserve MIT and Apache-2.0 license/notice requirements in distributable artifacts.
- [x] Verify AI SDK 6 ToolSet compatibility against installed docs; do not implement from memory.

Run:

```bash
npm run build --workspace @oh-awesome-novel/tools
npm run test:run --workspace @oh-awesome-novel/test-tools -- src/sandbox-dependency-smoke.test.ts
```

**Gate:** the tools bundle and dependency smoke can instantiate a minimal disabled-network Bash without touching disk; the real Electron package gate runs after atomic cut.

### Task 2: Implement CandidateChangeSet And Final Policy

**Files:**

- Add: `packages/tools/src/candidate-change-set.ts`
- Add: `packages/tools/src/workspace-change-policy.ts`
- Add: `packages/tools/src/final-document-validator.ts`
- Add: `packages/tools/src/change-diff.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `__test__/tools/src/candidate-change-set.test.ts`
- Test: `__test__/tools/src/workspace-change-policy.test.ts`
- Test: `__test__/tools/src/final-document-validator.test.ts`
- Test: `__test__/tools/src/change-diff.test.ts`

- [x] Implement strict CandidateChangeSet types, sorting, hashing, stats and no-op elimination.
- [x] Implement create/update/delete normalization; normalize rename as delete + create.
- [x] Refactor useful hash/unified-diff behavior out of `apply-engine.ts`, or replace it with the direct `diff` dependency.
- [x] Make diff generation display-only and deterministic.
- [x] Implement final path/file-type/encoding/size/domain policy.
- [x] Inventory every writable file family against the Final Document Validator Matrix; port proven checks and implement constraints that currently live only in patch/tool normalizers.
- [x] Keep a capability read-only until its complete final-document validator test suite passes.
- [x] Ensure no final validator consumes SemanticPatch.

**Tests must cover:** duplicate paths, unstable ordering, Unicode paths, invalid UTF-8/NUL, create/update/delete, no-op, renamed files, hidden/internal paths, traversal, symlinks, oversized changes, invalid YAML and bounded reference targets.

**Gate:** a valid CandidateChangeSet can be created and reviewed without any PendingAction or shell dependency.

### Task 3: Implement The Guarded Virtual Filesystem

**Files:**

- Add: `packages/tools/src/workspace-projection.ts`
- Add: `packages/tools/src/tracking-fs.ts`
- Add: `packages/tools/src/policy-fs.ts`
- Test: `__test__/tools/src/workspace-projection.test.ts`
- Test: `__test__/tools/src/tracking-fs.test.ts`
- Test: `__test__/tools/src/policy-fs.test.ts`

- [x] Build a fixed InMemoryFs snapshot and baseline manifest from an allowlisted projection.
- [x] Reject symlink/non-regular/binary/oversized sources before loading them.
- [x] Implement PolicyFs across the complete IFileSystem surface.
- [x] Implement TrackingFs across the complete mutation surface.
- [x] Proxy `mkdirSync` / `writeFileSync`, implement bootstrap mode, call `activate()` after Bash construction and freeze virtual system paths read-only.
- [x] Separate `/workspace` candidates from `/tmp` scratch files.
- [x] Reconcile final VFS against baseline rather than trusting the mutation log.
- [x] Recheck the projected host manifest at proposal time; mark the session stale if its fixed view drifted during editing.
- [x] Enforce projection secrecy across every read/stat/enumeration API, including glob/find/getAllPaths.
- [x] Prove the real workspace remains byte-identical through arbitrary virtual mutations.

**Tests must cover:** `writeFile`, append, redirect, heredoc, `sed -i`, `yq -i`, cp, mv, rm, recursive directory operations, multiple writes, change-then-revert, move-then-move-back, spaces, CJK filenames, absolute paths, `../../`, hidden dirs, `.git`, `.workspace`, readonly `.oan`, symlink escape and two isolated sessions.

**Gate:** final reconciliation exactly matches expected create/update/delete for every supported just-bash mutation, while canonical bytes never change.

### Task 4: Implement SandboxEditSession And AI SDK Tools

**Files:**

- Add: `packages/tools/src/sandbox-edit-session.ts`
- Add: `packages/tools/src/sandbox-toolset.ts`
- Modify: `packages/tools/src/read-tools.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `__test__/tools/src/sandbox-edit-session.test.ts`
- Test: `__test__/tools/src/sandbox-toolset.test.ts`
- Test: affected `__test__/tools/src/read-tools.test.ts`

- [x] Construct Bash from OAN-owned PolicyFs/TrackingFs/InMemoryFs.
- [x] Refactor domain read tools to accept the projected VFS reader and prove they never mix live host bytes into an edit session.
- [x] Implement the bash-tool adapter with a turn-scoped AbortSignal closure.
- [x] Call `createBashTool({ sandbox, destination: '/workspace' })`; do not call `uploadDirectory`.
- [x] Pass a host-owned `promptOptions.toolPrompt` generated strictly from `OAN_COMMAND_ALLOWLIST`; do not rely on empty/automatic sandbox command discovery.
- [x] Register the explicit command allowlist and hardened resource limits.
- [x] Construct InMemoryFs with `maxTotalBytes` and enforce separate baseline, scratch, candidate and whole-session cumulative counters.
- [x] Keep network, Python, JavaScript and trusted custom commands disabled.
- [x] Expose `bash`, OAN-bounded `readFile`, `writeFile` and `workspace.previewChanges` as AI SDK ToolSet entries; `workspace.proposeChanges` is added in Task 5 after the store exists.
- [x] Replace/wrap model-visible readFile with ranged bounded reads; make preview return a bounded excerpt with explicit truncation metadata.
- [x] Implement seal, idempotent preview, one-time candidate finalization and dispose lifecycle.
- [x] Sanitize command output/log text.
- [x] Produce a bounded command audit digest/summary for later source provenance; Task 4 does not persist PendingAction.

**Tests must cover:** all Task 4 model-visible tools, projected domain reads, host drift without mixed reads, multi-call shared state, candidate finalization, double finalization, writes after seal, timeout, abort, command/output/file/byte limits, disabled commands and clean-session behavior.

**Gate:** a simulated AI SDK 6 tool loop can make several virtual edits and produce exactly one CandidateChangeSet without touching canonical files.

### Task 5: Build The New PendingAction And Materializer Without Cutting Production

**Files:**

- Add: `packages/tools/src/pending-action-types.ts`
- Add: `packages/tools/src/pending-action-store.ts`
- Add: `packages/tools/src/change-materializer.ts`
- Add: `packages/tools/src/pending-action-decision-receipt.ts`
- Modify: `packages/tools/src/sandbox-toolset.ts`
- Inspect/extract proven behavior from: `packages/tools/src/write-intent-tools.ts`
- Modify: `packages/tools/src/git-integration.ts`
- Modify: `packages/tools/src/index.ts`
- Add: `__test__/tools/src/change-preview.test.ts`
- Add: `__test__/tools/src/pending-action-store.test.ts`
- Add: `__test__/tools/src/change-materializer.test.ts`
- Add: `__test__/tools/src/pending-action-decision-receipt.test.ts`

- [x] Introduce the new strict schemaVersion 1 PendingAction and stored parser.
- [x] Persist create/update candidate bytes into immutable internal draft artifacts during proposal.
- [x] Do not persist a separate authoritative `patches`, `shadowWrites` or `touchedFiles` array.
- [x] Implement the frozen `PreparedChangePreviewV1` preview/promote protocol for cross-request Reference/Play flows.
- [x] Preserve stable IDs, store/list/read/archive, per-action/global locks and terminal-state conflict behavior.
- [x] Add create/update/delete transaction operations and operation-aware journal phases.
- [x] Freeze accepted terminal archive as the file transaction commit point and make all post-commit recovery finalize-only.
- [x] Preserve baseline, draft hash, path and symlink preflight.
- [x] Preserve rollback, crash recovery, reject and Git auto-commit behavior.
- [x] Ensure Git only stages accepted paths and refuses unrelated staged state.
- [x] Persist Git outcome in a separate decision receipt; test add/commit failure and the staged-not-committed quick-commit path without rolling back accepted files.
- [x] Return `UNSUPPORTED_PENDING_ACTION_SCHEMA` for every old/unversioned record; do not decode it.
- [x] Ensure Accept never imports or calls bash-tool/just-bash.
- [x] Add `workspace.proposeChanges` only now that the new PendingAction store exists; combine session finalization with proposal persistence and seal semantics.
- [x] Keep current production store/export unchanged until Task 9; test the new store/materializer directly in isolated workspaces.

**Fault-injection matrix:** fail before journal, after each stage, after each backup, after each target materialization, before archive, after archive, before Git add, after Git add and before commit. Every case must have a specified retry/recovery result.

**Gate:** the isolated new protocol passes create/update/delete atomicity/recovery tests, while the repository and existing production path still build.

### Task 6: Prepare Runtime And Agent Integration Behind Injection

**Files:**

- Modify: `packages/runtime/src/types.ts`
- Modify: `packages/runtime/src/runtime.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/session-store.ts`
- Modify: `packages/agent/src/checkpoint-runner.ts`
- Modify: `packages/core/src/novel-copilot-skill.ts`
- Modify: `packages/core/src/session-artifacts.ts`
- Modify: `packages/core/src/writing-planning.ts`
- Modify: `packages/core/src/writing-review.ts`
- Test: `__test__/runtime/src/runtime.test.ts`
- Test: `__test__/agent/src/tool-registry.test.ts`
- Test: `__test__/agent/src/session-store.test.ts`
- Test: `__test__/core/src/novel-copilot-skill.test.ts`
- Test: `__test__/core/src/session-artifacts.test.ts`
- Test: `__test__/core/src/play-adoption.test.ts`
- Test: `__test__/core/src/writing-planning.test.ts`
- Test: `__test__/core/src/writing-review.test.ts`

- [x] Add the new Runtime PendingAction view/event types alongside the current type; remove the old type only in Task 9.
- [x] Add a generic async turn finalizer hook that runs before `message_finish`.
- [x] Make agent edit-environment creation async and dispose it in `finally` for run and stream paths.
- [x] Share one SandboxEditSession across every tool call in a turn.
- [x] Pass abort through the session-owned bash adapter.
- [x] Replace raw bash `toolCall.args` transport/persistence with bounded sanitized `commandPreview` + hash audit records.
- [x] Add the new sandbox edit-environment assembly behind explicit injection while retaining the old production default until Task 9.
- [x] Add a sandbox-specific system prompt/skill contract around virtual editing, preview and proposal; switch the default prompt only in Task 9.
- [x] Add capability/sandbox-proposal contracts for planning and review helpers; remove `chapter.createDraft` from their production contract in Task 9.
- [x] Add `proposedChanges` / `proposed-changes.yaml` and new recovery helpers without reading old artifacts; switch writers in Task 9.
- [x] Add a sandbox-backed checkpoint validation path; delete fake patches and the canonical-write bypass in Task 9.

**Gate:** injected new-path tests cover normal finish, max-loop finish, explicit proposal, abort and fatal error; existing default builds and no tested new path writes a real target before Accept.

### Task 7: Migrate Deterministic Producers

**Files:**

- Add new ChangeSet producer beside: `packages/tools/src/reference-material-adoption.ts`
- Modify: `packages/backend/src/reference-deconstruction.ts`
- Modify: `packages/backend/src/reference-material-adoption.ts`
- Modify: `packages/backend/src/reference-material-adoption-preview.ts`
- Modify: `packages/backend/src/play-adoption-preview.ts`
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/core/src/play-types.ts`
- Modify: `packages/core/src/play-adoption.ts`
- Test: `__test__/tools/src/reference-material-adoption.test.ts`
- Test: `__test__/backend/src/backend.test.ts`
- Test: `__test__/backend/src/play-adoption-preview.test.ts`
- Test: `__test__/backend/src/reference-deconstruction-full.test.ts`
- Test: `__test__/client/src/play-adoption.test.ts`
- Test: `__test__/client/src/reference-deconstruction.test.ts`

- [x] Add a deterministic ChangeSet producer that will replace `createReferenceMaterialAdoptionPatches` at Task 9.
- [x] Add Reference publication candidate-file producers beside the current patch builders.
- [x] Replace patch equality/kind ownership checks with `origin + allowed paths + baseline/draft fingerprint` checks.
- [x] Preserve source checksum, run identity, partial publication and freshness contracts.
- [x] Add the new Play business target contract without legacy write tool names; remove the old contract at Task 9.
- [x] Compile Play adoption payloads into deterministic candidate changes.
- [x] Add new-schema stored prepared preview helpers; do not read old preview records with them.
- [x] Ensure every producer uses the same final WorkspaceChangePolicy and PendingAction store.
- [x] Add new producer entry points without switching production routes until Task 9.

Suggested producer migration order:

1. `packages/tools/src/reference-material-adoption.ts`；
2. Reference deconstruction publication；
3. Reference adoption preview/promote；
4. Play adoption preview/promote and multi-file workflows。

普通 chapter/character/world/state/timeline/foreshadow/summary/outline 编辑由 Bash session + capability policy + final validators 覆盖，只增加端到端测试，不为它们重新建立 deterministic builder 或新的领域写入 DSL。

**Gate:** every formal producer has a tested new ChangeSet entry point and the repository remains buildable before atomic cut.

### Task 8: Migrate Backend, Client And Desktop Review UI

**Files:**

- Modify: `packages/backend/src/index.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `apps/desktop-ui/src/composables/useAgentCheckpointChat.ts`
- Modify: `apps/desktop-ui/src/components/agent-checkpoint/PendingActionCard.vue`
- Modify: `apps/desktop-ui/src/components/agent-checkpoint/PendingActionDiffViewer.vue`
- Modify: `apps/desktop-ui/src/components/workspace/DiffReviewTab.vue`
- Modify: `apps/desktop-ui/src/components/play/PlayAdoptionDraftForm.vue`
- Add: `__test__/desktop-ui/src/pending-action-diff-viewer.test.ts`
- Test: `__test__/desktop-ui/src/play-adoption-draft-form.test.ts`
- Test: `__test__/desktop-ui/src/play-adoption-review-routing.test.ts`
- Test: `__test__/desktop-ui/src/reference-material-adoption.test.ts`
- Test: `__test__/desktop-ui/src/workspace-reference-publish-handoff.test.ts`
- Test: affected backend/client/desktop-ui tests and renderer smoke

- [x] Add strict new backend serializers for PendingActionView beside the current live serializer.
- [x] Add the new public DTO without `patches`, `shadowWrites`, artifact paths or legacy write `toolName`.
- [x] Render structured create/update/delete status from `changes`; do not infer status by parsing diff.
- [x] Preserve list/read/accept/reject routes and the human approval journey.
- [x] Show unsupported old internal state as an explicit reset-required error.
- [x] Keep diff text escaped and command output plain-text only.
- [x] Add a component test for create/update/delete labels, escaped diff text and absence of internal artifact paths.
- [x] Complete a real UI journey: LLM virtual edit -> preview -> PendingAction -> Accept -> Git result.
- [x] Prepare strict new DTO/parser/component paths without switching live backend/client routing until Task 9.

**Gate:** renderer cannot access internal draft artifacts and accurately labels created, updated and deleted files.

### Task 9: Atomically Cut Production And Delete SemanticPatch

**Files:**

- Delete: `packages/tools/src/apply-engine.ts`
- Delete or fully replace: old write-intent tool normalizers in `packages/tools/src/write-intent-tools.ts`
- Delete: `packages/tools/src/restricted-write-tool.ts`
- Modify: `packages/tools/src/index.ts`
- Modify: `packages/runtime/src/types.ts`
- Modify: `packages/runtime/src/runtime.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/src/session-store.ts`
- Modify: `packages/agent/src/checkpoint-runner.ts`
- Modify: `packages/core/src/novel-copilot-skill.ts`
- Modify: `packages/core/src/session-artifacts.ts`
- Modify: `packages/core/src/writing-planning.ts`
- Modify: `packages/core/src/writing-review.ts`
- Modify: `packages/core/src/play-types.ts`
- Modify: `packages/core/src/play-adoption.ts`
- Modify: `packages/backend/src/index.ts`
- Modify: `packages/backend/src/reference-deconstruction.ts`
- Modify: `packages/backend/src/reference-material-adoption.ts`
- Modify: `packages/backend/src/reference-material-adoption-preview.ts`
- Modify: `packages/backend/src/play-adoption-preview.ts`
- Modify: `packages/client/src/index.ts`
- Modify: affected Desktop review components
- Add: `__test__/desktop-ui/packaged-main-smoke/run.cjs`
- Replace: `__test__/tools/src/apply-engine.test.ts`
- Delete or rewrite around PolicyFs/ChangeMaterializer: `__test__/tools/src/restricted-write-tool.test.ts`
- Delete/update: all old patch-shaped fixtures across `__test__/`

- [x] Delete `SemanticPatch`, `ObjectPatch`, `CollectionPatch`, `NarrativePatch`, `ReferenceArtifactPatch`.
- [x] In one atomic cut, switch the default agent toolset, Runtime finalizer, PendingAction directories/parser/materializer, deterministic producer routes, Backend serializers, Client parser and Desktop DTO to the new protocol.
- [x] Delete `previewSemanticPatches`, patch validators, executors and target resolver.
- [x] Delete six typed write-intent tools and their args-to-patch normalizers.
- [x] Delete legacy preview/adoption exports: `prepareWriteIntentPreview`, `promoteWriteIntentPreview`, `validateWriteIntentPreview`, `WRITE_INTENT_PREVIEW_SCHEMA_VERSION`, `PreviewableWriteIntentToolName` and `createReferenceMaterialAdoptionPatches`.
- [x] Delete backend patch-kind/equality/ownership logic.
- [x] Delete Runtime/client public `patches` and old `shadowWrites` semantics.
- [x] Delete Play legacy write-tool-name contract.
- [x] Delete fake checkpoint patches and canonical restricted-write bypass.
- [x] Delete `createRestrictedWriteTools`, `createWorkspaceWriteFileTool`, `writeRestrictedWorkspaceFile` and their public exports; any reusable path checks move into PolicyFs/ChangeMaterializer, with no callable canonical write tool left behind.
- [x] Add the packaged Electron main-process smoke harness that loads just-bash, executes an in-memory edit, finalizes a ChangeSet and disposes.
- [x] Keep historical occurrences only in superseded ADR/plan with an explicit historical marker.

Run the production-code gate:

```bash
rg -n 'SemanticPatch|ObjectPatch|CollectionPatch|NarrativePatch|ReferenceArtifactPatch|PreparedWriteIntentPreview|WriteIntentPendingAction|ShadowWriteReference|previewSemanticPatches|resolvePatchTargetFile|prepareWriteIntentPreview|promoteWriteIntentPreview|validateWriteIntentPreview|WRITE_INTENT_PREVIEW_SCHEMA_VERSION|PreviewableWriteIntentToolName|createReferenceMaterialAdoptionPatches|proposedPatches|proposed-patches|createWriteIntentTools|createRestrictedWriteTools|workspace\.writeFile|workspace\.proposeWrite|chapter\.createDraft|character\.updatePersonality|state\.set|timeline\.add|foreshadow\.create|summary\.generateChapter|reference\.adoptMaterials' packages apps
rg -n 'SemanticPatch|ObjectPatch|CollectionPatch|NarrativePatch|ReferenceArtifactPatch|PreparedWriteIntentPreview|WriteIntentPendingAction|ShadowWriteReference|previewSemanticPatches|resolvePatchTargetFile|prepareWriteIntentPreview|promoteWriteIntentPreview|validateWriteIntentPreview|WRITE_INTENT_PREVIEW_SCHEMA_VERSION|PreviewableWriteIntentToolName|createReferenceMaterialAdoptionPatches|proposedPatches|proposed-patches|createWriteIntentTools|createRestrictedWriteTools|workspace\.writeFile|workspace\.proposeWrite|chapter\.createDraft|character\.updatePersonality|state\.set|timeline\.add|foreshadow\.create|summary\.generateChapter|reference\.adoptMaterials' __test__
```

Expected: no matches.

**Gate:** deleting every old executor/export does not break build or production behavior.

### Task 10: Perform The One-Time Internal Reset

This task is performed only after new parsers/materializer are ready and all relevant processes are stopped.

- [x] Inventory developer/sample/test workspaces that contain old internal state.
- [x] Record `git status --short` and a SHA-256 manifest of canonical files.
- [x] Prove `.workspace/` and `.oan/sessions/` contain no Git-tracked file; stop for manual classification if this assertion fails.
- [x] Resolve and validate the exact `.workspace` and `.oan/sessions` targets.
- [x] Delete only those internal directories.
- [x] Start the new version and allow it to recreate required directories.
- [x] Recompute Git status and canonical manifest; require exact equality except for intentionally implemented source/docs changes in the repository itself.
- [x] Verify old records presented without reset fail closed with `UNSUPPORTED_PENDING_ACTION_SCHEMA`.

**Gate:** there is no old runtime record left in supported development workspaces, and canonical novel files/Git history are unchanged by reset.

### Task 11: Rewrite Stable Documentation And Close Task 0800

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PROJECT_VISION.md`
- Modify: `docs/REQUIREMENTS.md`
- Rename/rewrite with `git mv`: `docs/APPLY_ENGINE.md` -> `docs/SANDBOX_CHANGE_ENGINE.md`
- Modify: `docs/AGENT_RUNTIME_AND_TOOLS.md`
- Modify: `docs/AGENT_OPERATING_MANUAL.md`
- Modify: `docs/HUMAN_APPROVAL_AND_GIT.md`
- Modify: `docs/DEVELOPMENT_PLAN.md`
- Modify: `docs/FILESYSTEM_SPEC.md`
- Modify: `docs/PRODUCT_OVERVIEW.md`
- Modify: affected completed task Implementation Notes, including `docs/tasks/1220.md`
- Modify current Goal/Constraints or label historical notes in: `docs/tasks/0001.md`, `docs/tasks/0400.md`, `docs/tasks/0520.md`, `docs/tasks/0700.md`, `docs/tasks/0900.md`, `docs/tasks/1030.md`, `docs/tasks/1170.md`, `docs/tasks/1210.md`, `docs/tasks/1220.md`
- Modify: `docs/tasks/0800.md`
- Modify: `docs/tasks/README.md`
- Add: `scripts/check-legacy-write-architecture-terms.mjs`

- [x] Make the stable architecture formula `bash-tool + just-bash + CandidateChangeSet + PendingAction + Git approval`.
- [x] State that in-memory shell is allowed while arbitrary host shell remains forbidden.
- [x] Document ChangeSet authority, threat model, limits, lifecycle, materializer and reset boundary.
- [x] Update all current links after the Apply Engine document rename; do not leave a compatibility tombstone.
- [x] Preserve dated historical Implementation Notes; append migration notes rather than rewriting past facts.
- [x] Update every active task's current Goal/Constraints to the new engine. Historical occurrences must live under an explicitly titled dated `Historical Implementation Notes` section or in a file whose status is `Superseded`.
- [x] Add a checker with an exact file/section allowlist; it must allow ADR 0003, ADR 0004, this migration plan and 0800's migration description, but reject a legacy term in any active current-contract section.
- [x] Change task 0800 `Needs Review -> Completed` and move its `docs/tasks/README.md` entry to Completed only after every code/test/reset/doc gate passes.

Documentation gate:

```bash
node scripts/check-legacy-write-architecture-terms.mjs
```

Expected: no match outside the checker's exact historical/migration allowlist. Do not add current architecture or production files to make the gate pass.

Allowed historical content only:

- ADR 0003 marked Superseded;
- old implementation plan marked Superseded;
- dated historical notes explicitly labeled historical;
- reference-only material not presented as current OAN architecture.

## Verification Matrix

### Tools

```bash
npm run test:run --workspace @oh-awesome-novel/test-tools
```

Required scenarios:

- redirect/heredoc/append/sed/yq/writeFile capture;
- create/update/delete/move/no-op normalization;
- containment, hidden paths, symlink and file-type rejection;
- baseline drift at proposal and Accept;
- draft artifact tamper;
- command/resource limits and disabled capabilities;
- concurrent sessions and Accept locks;
- fault-injected transaction rollback and crash recovery;
- Git auto-commit on/off and unrelated staged-file rejection.

### Runtime And Agent

```bash
npm run test:run --workspace @oh-awesome-novel/test-runtime
npm run test:run --workspace @oh-awesome-novel/test-agent
npm run test:run --workspace @oh-awesome-novel/test-core
```

Required scenarios:

- one session per turn and shared VFS across tool loops;
- explicit proposal and fallback proposal produce one action;
- clean turn produces none;
- pending event precedes message finish;
- abort/error disposal and zero canonical writes;
- session artifacts use proposed changes, not patches.

### Backend, Client And Desktop

```bash
npm run test:run --workspace @oh-awesome-novel/test-backend
npm run test:run --workspace @oh-awesome-novel/test-client
npm run test:run --workspace @oh-awesome-novel/test-desktop-ui
npm run typecheck:renderer-smoke --workspace @oh-awesome-novel/test-desktop-ui
npm run test:renderer-smoke --workspace @oh-awesome-novel/test-desktop-ui
```

Required journeys:

- chapter edit approval;
- state/timeline/foreshadow multi-file approval;
- character/summary/outline approval;
- Reference publish and adoption;
- Play adoption;
- create/update/delete labels and diff review;
- Accept/reject/reload recovery;
- unsupported old state error.

### Build And Package

```bash
npm run build --workspace @oh-awesome-novel/core
npm run build --workspace @oh-awesome-novel/runtime
npm run build --workspace @oh-awesome-novel/tools
npm run build --workspace @oh-awesome-novel/agent
npm run build --workspace @oh-awesome-novel/backend
npm run build --workspace @oh-awesome-novel/http-backend
npm run build --workspace @oh-awesome-novel/client
npm run package --workspace @oh-awesome-novel/desktop
node __test__/desktop-ui/packaged-main-smoke/run.cjs apps/desktop/out
git diff --check
```

The desktop smoke harness must launch the packaged Electron executable/runtime, import the packaged main dependency graph, create an in-memory Bash, execute a command, finalize a ChangeSet and dispose. A plain Node import or successful Forge package alone is insufficient. The exact output directory is resolved by the harness rather than assumed if Forge differs by platform.

## Release-Blocking Invariants

The migration is not complete unless all are true:

1. No model/tool/backend producer writes a canonical target before Accept.
2. No host shell or real-workspace ReadWriteFs is reachable from the model.
3. CandidateChangeSet, not diff or commands, is the proposal authority.
4. PendingAction Accept never replays commands.
5. create/update/delete are atomic across multiple files and recover after crash.
6. stale baseline, symlink, hidden/internal path and policy violations fail closed.
7. Network, Python, JavaScript and trusted custom commands remain off by default.
8. Renderer never receives internal artifact paths or an executable command channel; optional bash audit previews are bounded, sanitized, escaped plain text and are never executed.
9. All formal producers use the new ChangeSet/PendingAction protocol.
10. Production code contains no SemanticPatch or legacy write-intent tool path.
11. Old internal records are rejected explicitly or removed by the one-time reset; none are interpreted.
12. The reset changes no canonical novel file and no Git history.
13. Stable docs and AGENTS instructions describe only the new architecture.
14. Every write session has a host-selected capability; unknown workflows are read-only and the model cannot widen policy through tool args.
15. Every writable file family has a tested final-document validator; YAML parse alone is insufficient.
16. Repository identity, branch and HEAD are fixed at proposal and revalidated at Accept.
17. Durable accepted archive is the file transaction commit point; Git failure is a recoverable post-accept receipt state and never rolls back accepted canonical files.

## Rollback

Because this is a pre-release breaking migration, rollback is a development operation:

- Before merge: revert or abandon the migration branch/commits.
- After merge but before new PendingActions matter: revert the merge commit and reinitialize disposable internal state.
- After accepting new-schema actions: canonical file history is already in Git; revert normal Git commits as needed, but do not attempt to feed new actions into old code.
- Never restore old `.workspace` or `.oan/sessions` records into the new version.
- Never add a runtime SemanticPatch fallback to make rollback easier.

## Definition Of Done

- The full LLM edit flow is `bash-tool/just-bash -> CandidateChangeSet -> PendingAction -> Accept -> Git`.
- In-memory shell commands can safely perform iterative, multi-file create/update/delete work.
- All final changes are bounded, validated, reviewable and transactionally materialized.
- SemanticPatch types, executors, normalizers, exports, current docs and production fixtures are removed.
- New PendingAction schema starts at version 1 and old records are intentionally unsupported.
- One-time internal reset is completed and verified without touching canonical novel data.
- All tests, builds, desktop package smoke, documentation gate and `git diff --check` pass.
- `docs/tasks/0800.md` contains Implementation Notes and is marked `Completed`.
