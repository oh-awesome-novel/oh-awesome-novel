# Human Approval And Git

## Principle

Human Approval 是所有 canonical 写入的硬边界：

```text
CandidateChangeSet
  -> immutable PendingAction
  -> structured create/update/delete review + diff
  -> Accept / Reject
  -> ChangeMaterializer
  -> Git side effect
```

模型、deterministic producer、Backend 与 UI 都不能绕过这条链路。Accept 前真实 target bytes 保持不变；diff 是 display-only，Accept 不解析它；shell command 也不在 Accept 时重放。

## PendingAction Model

Stored proposal 使用严格 schema version 1，并包含：

- immutable identity、title、description、createdAt
- source capability/producer evidence
- repository identity、branch、HEAD
- authoritative create/update/delete `changes`
- diff + diff hash（展示用）
- optional trusted origin

create/update 的 candidate bytes 只存于 `.workspace/change-engine/v1/drafts/` 内部 immutable artifact。delete 没有 draft。proposal 永不原地改 status；accepted/rejected terminal record 与 decision receipt 分别表达生命周期和 Git outcome。

Public view：

```ts
interface PendingActionView {
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
```

Renderer 不接收 artifact paths、candidate bytes、shell source 或 internal repository id。touched paths 若为 UI convenience 提供，只能现场从 `changes` 派生，不能成为第二份 persisted authority。

## Approval UI

UI 至少展示：

- title / description / status
- 每个 change 的 `create | update | delete` 与 path
- old/new hash（适用时）
- 纯文本 unified diff
- origin/source summary
- accepted/rejected timestamp
- Git result 和 recovery action

路径 label 只来自 structured `changes`，不从 diff header、title 或 artifact location 推断。包含空格、CJK 或 HTML-like 内容时仍作为纯文本显示。

MVP 优先整个 action Accept/Reject；需要 partial acceptance 时，producer 应拆成多个 action，而不是在 Accept 阶段修改 immutable proposal。

## Accept Preconditions

`ChangeMaterializer` 在写盘前必须：

1. strict parse schema/kind/complete fields；
2. 获取 per-action lock 与 global apply lock；
3. 恢复遗留新协议 transaction；
4. 验证 action 仍为 pending，且不存在 conflicting terminal；
5. 验证 trusted origin freshness；
6. 验证 repository identity、branch、HEAD 未变；
7. 再次执行 exact path/capability/final-document policy；
8. create target 仍不存在；
9. update/delete target 仍为同一普通文件且 hash/mode 未变；
10. create/update draft ownership、path、size 与 hash 正确；
11. Git index 没有会混入提交的 unrelated staged state。

任一项不满足均 fail closed，canonical target 零变化。不得用局部 apply、自动 rebase baseline 或解析最新 diff 来“修复” stale action。

## File Transaction

### Operation Semantics

- create：stage new bytes；materialize 后 rollback 会删除 target。
- update：backup original + stage candidate；rollback 恢复 backup。
- delete：backup original；materialize 删除；rollback 恢复 backup。
- rename：同一 transaction 的 delete + create。

### Durable Phases

```text
prepared
  -> materializing
  -> accepted terminal written
  -> accepted-finalize-only
  -> cleanup / Git / receipt
```

accepted terminal record 是文件事务 commit point：

- commit point 前 crash/failure：逆序 rollback。
- commit point 后 crash/failure：只 finalize，永不 rollback。
- 唯一 backup 在 terminal durable 前不能删除。
- terminal 缺失但 journal 已到 finalize-only 时，恢复先原子补 terminal。
- terminal 已 accepted 但 journal 未 finalize 时，以 terminal 为准继续 finalize。

Git commit 不是文件事务 commit point。

## Reject

Reject：

- 不修改 canonical target。
- 原子写 rejected terminal 与 receipt。
- 清理 action draft/temporary state。
- 保留可审计的 proposal/terminal metadata。
- 不创建 commit，不触发 sync。

## Git Integration Boundary

Git 只能由 backend/Electron Git integration 层通过参数化 process API 调用；禁止拼接 shell 字符串。workspace root 来自 active host context，frontend 不能传任意 root、subcommand、executable 或 path。

第一版允许封装：

| Operation | Safe shape |
| --- | --- |
| diagnose | `git --version` |
| repository | `git -C <root> rev-parse --show-toplevel/HEAD/--abbrev-ref HEAD` |
| status | `git -C <root> status --porcelain` |
| diff | `git -C <root> diff -- <validated paths...>` |
| log/show | bounded validated revision reads |
| stage | `git -C <root> add -- <accepted paths...>` |
| commit | fixed operation with explicit message/trailer |
| fetch/pull/push | explicit user sync workflow only; pull is fast-forward only |

禁止 arbitrary Git passthrough、shell、automatic merge/rebase、`reset --hard`、`clean` 或其它 destructive command。

## Auto Commit On Accept

workspace configuration：

```yaml
git:
  autoCommitOnAccept: true
```

默认 `true`。durable Accept 后：

1. 只计算 action `changes` paths；
2. 再读 repository/branch/index/status；
3. 拒绝 unrelated staged state；
4. stage only action paths；
5. 使用确定性 message 与 action id metadata/trailer commit；
6. 原子写 decision receipt；
7. 成功后才允许可配置的 sync。

建议 message：

```text
chore(novel): apply pending action <short-id>

<PendingAction title>
```

proposal 时 target 已相对 HEAD dirty，可能包含作者在 proposal 前的 work。Accept 仍可依据 baseline 审批 materialize，但 auto commit 必须 fail closed 或降级 explicit quick commit，不能把旧修改伪装成本 action commit。

## Git Failure And Recovery

Git add/commit 失败时：

- accepted canonical change 保持不变；
- 不回滚文件 transaction；
- receipt 记录 `staged-not-committed` 或 `failed` 与稳定 error code；
- UI 显示 dirty/staged state 和 quick commit/recovery 入口。

journal 持久化 `autoCommitRequested`。若 commit 已成功但 receipt 尚未 durable，恢复通过 repository/commit action identity 对账，再补 receipt，不能重复提交。

## Quick Commit

`git.autoCommitOnAccept: false` 或自动提交失败时，UI 提供显式 quick commit：

- Backend 重新读取 Git status/diff。
- 用户看见并确认 file scope 与 message。
- files 来自 accepted action paths 或 backend 当前 dirty file list，不能接受 frontend 任意 path。
- commit 前再次验证 repository/branch/index。
- 默认不自动 sync。
- success 后刷新 status/history；failure 保留 dirty state。

关闭 auto commit 时系统不得自动 commit 或 sync。

## Manual Git Operations

用户可以通过外部编辑器或 Git CLI 手动 commit/branch/restore。这属于显式用户行为，不属于 AI 自动操作。OAN 后续刷新 repository state；现有 PendingAction 因 branch/HEAD/baseline 漂移应变 stale，而不是自动适配。

手动 Git 能力不能让 AI 绕过 PendingAction。

## Validation And Policy Before Write

- path 在 exact workspace policy 内，拒绝 `.git`、internal/hidden path 与 symlink。
- final file 通过完整 domain validator，而不只是语法 parse。
- Constitution 等 proposal-only families 只有专门 trusted workflow 才可写。
- Reference/Play action 重验 source/origin freshness 与 exact targets。
- mode policy：update 保留 baseline mode，create 固定 `0o644`，v1 不支持 chmod。

## Internal Records

```text
.workspace/change-engine/v1/
  pending/
  drafts/
  terminal/accepted/
  terminal/rejected/
  receipts/
  transactions/
  locks/
  previews/
```

这些 records 是 approval/recovery infrastructure，不是 novel truth。无版本、unknown version 或 unsupported shape 返回 `UNSUPPORTED_PENDING_ACTION_SCHEMA`，UI 应提示开发内部状态需要 reset，不能谎报“没有待审批项”。

## Audit

推荐 audit 只记录不可执行摘要：action id、source kind、capability、change paths/operations、timestamps、decision、Git receipt id/result。不得记录 secrets、candidate full content、artifact relative path 或可重放 bash args。

事实源仍是 canonical files 与 Git；audit 不能覆盖它们。
