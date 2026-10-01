# Sandbox Change Engine

## Purpose

Sandbox Change Engine 是 OAN 唯一正式文件修改核心：模型在固定内存投影中用熟悉的 shell/text editing 能力迭代，OAN 把最终 VFS 与 baseline 的差异归一化为 `CandidateChangeSet`，作者审批后由 `ChangeMaterializer` 事务化写入 canonical workspace，再由 Git 记录历史。

```text
LLM
  -> AI SDK ToolSet
  -> bash-tool
  -> just-bash over fixed InMemoryFs
  -> CandidateChangeSet
  -> PendingAction
  -> human Accept
  -> ChangeMaterializer
  -> Git
```

允许的是 OAN 控制的同进程内存 shell；任意 host shell、host filesystem、network 或进程执行始终禁止。

## Authority Model

`CandidateChangeSet.changes` 是 proposal 与 Accept 的唯一权威：

- command transcript 不能重放；
- mutation log 不能直接落盘；
- unified diff 不能被解析成修改；
- UI 路径不能从 diff header 推断；
- draft artifact path 不能暴露给 renderer；
- deterministic producer 与 bash session 都必须输出同一种 ChangeSet。

ChangeSet 的每个 change 都同时绑定 operation、normalized path、baseline 与 candidate hash。Accept 只读取 immutable action metadata 和 draft bytes。

## Threat Model

### Protected Assets

- canonical novel files and bytes
- `.git/` repository/history/index
- `.oan/` configuration, constitution, workflow, skills and secrets
- host files outside the active workspace
- model/provider credentials
- unrelated staged or dirty user work
- PendingAction lifecycle integrity and recovery evidence

### Untrusted Inputs

- user prompt content
- model output and every tool argument
- shell source, filenames and generated file contents
- imported/reference/play content
- stale internal records
- renderer requests and public DTO fields

### Trusted Components

- host workflow/capability selection
- workspace projection builder
- pinned `bash-tool` / `just-bash` dependency and OAN wrapper
- `PolicyFs`, `TrackingFs`, final validators and ChangeSet normalizer
- PendingAction store and `ChangeMaterializer`
- Git integration invoked after Accept

`just-bash` 是同进程 interpreter，不是 VM/container。单用户本地 v1 接受其依赖实现缺陷的 residual risk；remote untrusted workspace、多租户或第三方 plugin shell 必须先增加 OS process/container isolation。

## Fixed Workspace Projection

### Snapshot Construction

每个 `SandboxEditSession` 开始时：

1. host 根据 capability 构造 readable/writable path rules；
2. 枚举允许文件并拒绝绝对逃逸、`..`、hidden/internal path、symlink、hardlink 与 non-regular file；
3. 对 path 做 NFC normalization，拒绝 collision；
4. 验证 UTF-8、NUL、单文件和总 snapshot 限制；
5. 一次性读取 bytes，记录 hash/size/mode 与 projection fingerprint；
6. 读取 repository identity、branch 和 HEAD；
7. 把 snapshot 装入 `/workspace` 下的 `InMemoryFs`。

session 中不从 host workspace lazy-read。同一 turn 的文件型 read tools 也读取这份 projection。proposal 前 host 重新检查 projection/repository freshness；任何 drift 使整个 proposal stale。

### Visibility

- 可读写：capability 明确授予的小说对象文件或 exact producer targets。
- 只读：当前任务必要的 Constitution、Workflow、Skill/config 摘要。
- 不可见：`.git/`、`.workspace/`、`.oan/sessions/`、provider secrets 与未投影路径。
- `/tmp`：session scratch only，不进入 ChangeSet。
- 虚拟 `/bin`、`/usr/bin`、`/dev`、`/proc`：仅供 interpreter bootstrap，激活后只读。

`find`、glob、stat、exists、readdir、realpath 与 readlink 也必须遵守 visibility，不能泄露隐藏文件名。

## Filesystem Enforcement

```text
InMemoryFs
  -> TrackingFs
  -> PolicyFs
  -> Bash
  -> minimal bash-tool Sandbox adapter
```

### TrackingFs

显式覆盖：

- `writeFile`, `appendFile`
- `rm`, `cp`, `mv`, `mkdir`
- `chmod`, `symlink`, `link`, `utimes`
- interpreter bootstrap 所需的 sync extension

Policy 当前拒绝的 mutation 也必须被 tracker 覆盖，防止未来能力扩展旁路。log 只帮助审计；finalize 始终比较 baseline 与最终 VFS。

### PolicyFs

- 统一规范 POSIX path，拒绝空值、绝对逃逸、`..` 与非 canonical 表示。
- 对 read、enumeration、metadata 和 mutation 全面执行 policy。
- 拒绝 hidden/internal/unprojected path 与 non-regular file。
- 拒绝 chmod、symlink、hardlink 与 timestamp-only mutation。
- mkdir 只能创建合法目标的父目录；recursive delete 只能作用于 writable projection。
- 强制 extension、path depth、file count、single-file 与 candidate quotas。
- rejection 使用稳定、可供模型修正但不泄露隐藏信息的错误。

字符串命令过滤只能作为 audit defense-in-depth，不能替代 filesystem policy。

## Turn-scoped Capability

```ts
type WorkspaceEditCapability =
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
```

capability 来自可信 user-facing workflow/action，不来自模型参数。未知或缺失映射为 `read-only`。multi-file 能力只在作者明确编辑请求下授予。Reference/Play controller 传入 exact targets，不复用宽泛 Agent policy。

Policy 至少包含 readable/writable rules、validator IDs、max changed files 与 max candidate bytes。mutation 前和 finalize 后各执行一次同一政策。

## Command And Resource Limits

第一版命令 allowlist 仅含文件与文本处理：

```text
echo printf cat ls mkdir touch rm cp mv pwd
head tail wc stat grep rg sed awk sort uniq cut tr nl tee
find basename dirname tree jq yq diff sha256sum file true false
```

禁止 network、`curl`/`wget`、Python、JavaScript、package manager、archive/database commands、trusted custom command、host process、`ln` 和 `chmod`。

`Bash` 使用 hardened profile，并显式禁用 Python/JavaScript。OAN 还独立累计限制：

- bash call count and total wall time
- source/command count and loop iterations
- stdout/stderr bytes
- baseline snapshot bytes
- `/tmp` scratch bytes
- changed file count, single file bytes and candidate bytes
- traversal entries and path depth
- full/rendered diff bytes

初始 candidate gate：最多 64 files；单文件最多 2 MiB；create/update 内容总计最多 8 MiB；diff 最多 10 MiB；aggregate virtual FS 最多 64 MiB。具体 policy 可以更窄，不能由 model args 放宽。

model-visible `readFile`、`writeFile`、preview 与 propose wrappers 都有独立 range/output limit。截断结果必须包含 `truncated: true` 和原始 byte/line counts。

stdout/stderr 与 command preview 去 ANSI/危险控制字符，以纯文本渲染。日志只保存 bounded preview、hash 和 count，不保存可重放的完整 command args。

## Final-document Validation

validator 消费最终完整文件，而不是中间操作：

| Family | Required validation |
| --- | --- |
| Chapter/Summary/Outline Markdown | UTF-8, size, frontmatter, allowed keys, identity/path and heading/scene/outline invariants |
| Character/World objects | object/path identity, schema/frontmatter, required sections, duplicate identifiers |
| State YAML | root shape, domain schema/value constraints, stable object IDs |
| Timeline YAML | event schema, unique IDs, ordering/date/reference invariants |
| Foreshadow YAML | entry schema, unique IDs, lifecycle/status invariants |
| Reference | exact reference/path inventory, manifest/material schema, source/run fingerprint |
| Play | exact targets, source/projection freshness, target family validator |

只有 parse 成功不构成完整校验。任意 file family 缺少 validator 时，对应 capability 必须保持只读。

## CandidateChangeSet Contract

```ts
interface CandidateChangeSet {
  schemaVersion: 1;
  repository: { repositoryId: string; branch: string; head: string };
  projectionFingerprint: string;
  changes: CandidateFileChange[];
}
```

`CandidateFileChange`：

- `create`: baseline `{ exists: false }`, candidate content/hash/size；
- `update`: existing hash/size/mode + candidate content/hash/size；
- `delete`: existing hash/size/mode + no candidate。

path 必须是 NFC-normalized workspace-relative POSIX path；changes 按 path 稳定排序且不重复。只支持无 NUL 的 UTF-8 text。update/delete 固定 baseline；create 固定 target absence 与 mode `0o644`；update 保持 baseline mode；mode-only change 不进入 v1。

changed then restored 是 no-op；move 是 delete + create；directory-only mutation 被忽略；空集合不创建 action。

## PendingAction Contract

Stored action 使用严格 `schemaVersion: 1` 和 `kind: 'pending-action'`，包含：

- immutable id/title/description/createdAt
- source (`bash-session` or `deterministic-builder`)
- repository baseline
- authoritative `changes`
- display-only diff + diff hash
- optional trusted origin

source 记录 capability 与 bounded command digest/count 或 deterministic producer identity。stored action 不保存 shell command、可执行 recipe 或候选全文；create/update bytes 位于内部 immutable draft artifact，delete 没有 draft。

Proposal 不原地修改。terminal record 表达 pending -> accepted/rejected；decision receipt 独立记录 materialization 和 Git outcome。Public view 从 record + receipt 派生，不暴露 artifact path。

Prepared preview 使用 `kind: 'prepared-change-preview'`、origin、candidate fingerprint、repository、allowed targets、changes 与独立 artifacts。promotion 重验全部 freshness/baseline/hash 后创建 action，再写 promotion marker。

无版本、未知版本、字段不完整或旧形状统一返回 `UNSUPPORTED_PENDING_ACTION_SCHEMA`。

## Durable Layout

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

opaque id 经过 strict validation 后才能参与路径。所有 JSON/draft 使用同目录 temp + fsync + atomic rename，并做 internal realpath/symlink guard。同 id 同时出现 accepted/rejected terminal 是 corruption，必须 fail closed。

## Session Lifecycle

模型可见 tools：固定 projection 上的 domain reads、`bash`、bounded `readFile`/`writeFile`、`workspace.previewChanges` 与 `workspace.proposeChanges`。

同一 user turn 共享一个 session；不同 turn 使用新 snapshot。命令失败不自动回滚该命令此前的 VFS 修改，模型可以检查和修复；finalize 看最终 VFS。

```text
explicit propose
  -> seal session
  -> persist action once

completed/max loops + dirty without explicit propose
  -> host fallback propose once

completed + clean
  -> no action

abort/fatal error
  -> stop execution, discard unpersisted candidate
```

`pending_action` event 必须先于 `message_finish`。finalizer 失败变成 runtime error，不把 dirty state 当成功。run/stream 都必须在 `finally` dispose；dispose 后工具调用失败。

## Deterministic Producers

Reference publication/adoption、Play adoption 与其它确定性 workflow 直接写 builder/virtual writer：

```text
deterministic producer
  -> fixed repository + baseline
  -> exact WorkspaceChangePolicy
  -> CandidateChangeSet
  -> PendingAction
```

它们保留 source checksum、manifest revision、preview fingerprint、selected branch/revision 与 origin freshness。统一的是最终 ChangeSet 和审批链路，不是 shell 表达。

## ChangeMaterializer

### Accept Preconditions

- strict schema/action state and locks
- repository identity, branch and HEAD unchanged
- trusted origin fresh
- paths still policy-allowed
- create target still absent
- update/delete target still same regular file with baseline hash/mode
- draft path ownership, bytes, size and hash valid
- Git index has no unrelated staged content

### Transaction

- create：stage candidate；rollback 删除已 materialize target。
- update：backup original + stage candidate；rollback 恢复 backup。
- delete：backup original；materialize 删除；rollback 恢复 backup。
- rename：同一 journal 中的 delete + create。

journal 包含 `prepared | materializing | accepted-finalize-only | accepted-git-only`。commit point 前 crash recovery rollback；commit point 后只 finalize。stage、backup 与 draft 清理完成后才 durable 写入 `accepted-git-only`，此后只进行 Git / receipt 对账，不再重验 canonical bytes；未完成 cleanup 或损坏事务仍 fail closed。

durable accepted terminal record 是文件事务 commit point。它写入前不得删除唯一 backup；写入后绝不因清理或 Git 失败 rollback。

### Git Side Effect

`git.autoCommitOnAccept: true` 时只 stage action paths，并使用 action id metadata/trailer 对账。若 proposal 前 baseline 已相对 HEAD dirty、存在 unrelated index state、Git unavailable、identity 缺失或 commit 失败，则记录 `staged-not-committed`/`failed` receipt 并提供 explicit quick commit。

commit 成功但 receipt 写入前 crash 时，恢复先按 action identity 对账再补 receipt，不重复 commit。关闭 auto commit 时不得自动 commit 或 sync。

receipt durable 后无论 Git 结果均移除 journal，避免 Git 失败把已完成的文件事务永久留作全局审批前置条件。作者后续修改、恢复或删除 accepted target 不阻断无关事务恢复；该 action 的精确 quick commit 仍要求 approved bytes、mode 与 repository baseline 不变。quick commit 执行前另建 `accepted-git-only` journal，覆盖其 commit / receipt 中断窗口。

Reject 只写 rejected terminal/receipt 并清理 draft，不修改 canonical target。

## One-time Internal-state Reset

旧开发状态不自动转换。一次性 reset 只允许删除：

```text
<workspace>/.workspace/
<workspace>/.oan/sessions/
```

执行顺序：

1. 关闭 Backend/Electron；
2. 记录 `git status --short`；
3. 计算排除两个 internal targets 后的 canonical SHA-256 manifest；
4. 证明 targets 下不存在 Git-tracked file；
5. realpath 校验 workspace 与两个精确目录名；
6. 只删除这两个目录；
7. 启动新版本按需重建内部 namespace；
8. 重算 status/manifest 并要求 canonical equality。

reset 有意丢弃未采纳候选、内部审计副本、chat/tool log、临时 Play session 与可重建 preview/report。需要保留的结果必须先显式采纳或导出 canonical/Git。

绝不删除或改写 `.git/`、`.oan/config.yaml`、Constitution、Workflow、Skills、Writing Profiles、章节、角色、世界、状态、时间线、伏笔、摘要、大纲、references 或其它 canonical files。reset 不是产品每次启动逻辑。

## Release Gates

- VFS policy/mutation surface and quota tests
- complete final-validator matrix
- proposal/store/schema/public DTO tests
- create/update/delete transaction and crash-boundary tests
- Runtime abort/finalizer/audit secrecy tests
- deterministic producer origin/freshness tests
- Backend/Client/Desktop strict contract tests
- production builds, packaged Electron smoke and third-party notices
- legacy architecture term checker and internal-state reset proof
