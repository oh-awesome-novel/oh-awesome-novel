# Architecture

## Summary

`oh-awesome-novel` 是 filesystem-first 的 Novel IDE / AI Copilot。稳定架构是：

```text
                    oh-awesome-novel

              Constitution + Workflow
                         │
                Copilot Runtime
                  (Aider-style)
                         │
                 Vercel AI SDK
                   (ToolSet)
                         │
             fixed workspace projection
                         │
       bash-tool / just-bash over InMemoryFs
                         │
              CandidateChangeSet
               create/update/delete
                         │
                 PendingAction
                display-only diff
                         │
                   Human Accept
                         │
               ChangeMaterializer
                         │
              Object File Tree + Git
```

`CandidateChangeSet.changes` 是候选内容、路径、操作与 baseline 的唯一权威。diff、command preview 和 mutation log 都不能被 Accept 解析或执行。

## Stable Invariants

- Markdown / YAML / Object File Tree 是 canonical database。
- Git 是历史引擎。
- AI 是 Copilot，不是数据所有者。
- Accept 前 canonical bytes 不变。
- 模型可使用受限的同进程内存 shell，但不能访问任意 host shell、host filesystem、network 或进程。
- 每个 turn 的 capability 由可信 host 选择，未知 workflow 为 `read-only`。
- deterministic producer 与 Agent 共用 ChangeSet、PendingAction、materializer 和 Git 边界。
- 新协议严格拒绝无版本、未知版本或旧形状内部状态，不提供双引擎或迁移 reader。

## Package Boundaries

- `packages/core`：workspace/config/domain 的纯合同与 validator；不调用模型，不执行 loop。
- `packages/tools`：Markdown/YAML engine、read tools、workspace projection、sandbox session、ChangeSet、PendingAction store、deterministic producers 与 materializer。
- `packages/runtime`：provider-agnostic Aider-style loop、tool execution、bounded audit、pending action events 与通用 async finalizer；不依赖 agent/tools。
- `packages/agent`：context/prompt/model adapter、ToolSet 与 turn-scoped edit session 组合、RuntimeEvent 到 UI stream 适配。
- `packages/backend`：localhost HTTP/SSE transport、trusted workflow/capability routing、PendingAction API 与 domain controller composition。
- `packages/client`：strict HTTP DTO parser 与 frontend client。
- `apps/desktop-ui`：Vue review/workspace UI；不直接执行 filesystem、tools、Git 或 materializer。
- `apps/desktop`：Electron 生命周期与 packaged resources。

禁止反向混合：

- Runtime 不注册领域工具或 provider。
- Agent 不重写 tool loop。
- Tools 不定义第二套 Tool abstraction 取代 AI SDK `ToolSet`。
- Backend 不接收 frontend 自报的 workspace root、capability 或 arbitrary path policy。
- Frontend 不读取内部 draft artifact path。

## Runtime And Turn Composition

```text
user-facing workflow selects capability
    ↓
host snapshots repository + allowlisted files
    ↓
create one SandboxEditSession for the turn
    ↓
model/read tools/bash tools share fixed projection
    ↓
explicit propose OR completed/max-loop fallback finalize
    ↓
emit pending_action before message_finish
    ↓
dispose session in finally
```

正常完成且 dirty、或达到 max tool loops 且 dirty 时，host finalizer 可以创建一次 fallback action。显式 propose 后不重复创建。user abort 和 fatal error 只 discard 未持久化候选；已经持久化的 action 不受影响。

原始 bash args 不进入 Runtime messages、events、SSE 或 session artifacts。可观察层只保存去控制字符、escaped、bounded 的 `commandPreview`、hash、count 与截断标志。

## Sandbox Change Engine

### Fixed Projection

session 开始时 host：

1. 枚举 policy 允许的 canonical 文件；
2. 拒绝 symlink、hardlink、non-regular file、非法 UTF-8、NUL、NFC 冲突与超限内容；
3. 一次性读取 bytes 并生成 baseline manifest、projection fingerprint 与 Git repository baseline；
4. 把内容装入 `/workspace` 下的 `InMemoryFs`；
5. session 生命周期内不再从 host workspace lazy-read。

只读 Constitution、Workflow 或配置摘要可以显式投影；`.git/`、`.workspace/`、`.oan/sessions/`、provider secrets 与其它内部内容既不可读也不可枚举。`/tmp` 只保存 session scratch，不进入正式 ChangeSet。

### Virtual Filesystem Stack

```text
InMemoryFs
  -> TrackingFs
  -> PolicyFs
  -> Bash
  -> OAN sandbox adapter
  -> bash-tool ToolSet
```

`TrackingFs` 覆盖 write/append/rm/cp/mv/mkdir/chmod/symlink/link/utimes 等 mutation surface；bootstrap 写入虚拟系统路径不计为候选。mutation log 只用于诊断，finalize 仍比较完整 baseline 与最终 VFS。

`PolicyFs` 对 read、stat、exists、realpath、readdir、glob discovery 和所有 mutation 执行同一 visibility/capability policy。即使底层命令未来扩展，wrapper 也必须默认拒绝未知 mutation。

### Capability Policy

首版 capability：

| Capability | Writable scope |
| --- | --- |
| `read-only` | none |
| `chapter.edit` | trusted selected `chapters/**/*.md` |
| `character.edit` | selected `characters/<id>/**` |
| `world.edit` | selected `world/**` object files |
| `state.edit` | bounded `state/**/*.yaml` |
| `timeline.edit` | bounded `timeline/**/*.yaml` |
| `foreshadow.edit` | bounded `foreshadow/**/*.yaml` |
| `summary.edit` | bounded `summaries/**/*.md` |
| `outline.edit` | bounded `outline/**/*.md` |
| `novel.multi-file-edit` | explicit author editing request over known novel families |
| `reference.publish` | one exact reference publication inventory |
| `reference.adopt` | exact user-selected adoption targets |
| `play.adopt` | exact approved Play targets |

Read/write permission 独立。model tool args 不能声明 capability；General chat 不会因模型要求而自动获得 multi-file write。

### Commands And Limits

允许的 `just-bash` 命令只覆盖文件与文本处理，如 `cat`、`ls`、`mkdir`、`rm`、`cp`、`mv`、`grep`、`rg`、`sed`、`awk`、`find`、`jq`、`yq`、`diff` 与 `sha256sum`。network、Python、JavaScript、package manager、host process、trusted custom command、`ln` 与 `chmod` 被禁用。

执行同时限制每次和每 turn 的 wall time、call count、source bytes、command count、stdout/stderr、scratch bytes、candidate bytes、changed files、单文件大小、path depth 与 diff size。外部 FS 使底层 aggregate limit 不足以单独构成安全边界，因此 OAN 必须独立计数。

### Final Validators

每个 writable family 在开放前必须注册完整 final-content validator：

- Markdown：UTF-8、frontmatter、allowed keys、path identity、heading/scene/outline invariants。
- Character/World：object id 与 path、required sections、duplicate id。
- State/Timeline/Foreshadow YAML：完整 root/schema/domain invariants、stable unique ids、ordering/lifecycle/reference rules。
- Reference/Play：exact targets、manifest/source fingerprint、publication inventory 与目标文件族 validator。

仅 YAML parse 成功永远不够。缺少完整 validator 的能力必须保持只读。

## CandidateChangeSet

schema version 1 的 ChangeSet：

- 固定 repository id、branch、HEAD 与 projection fingerprint；
- changes 使用 NFC-normalized workspace-relative POSIX path，并按 path 稳定排序；
- create 声明 target 不存在；update/delete 固定 baseline hash、byte length 与 mode；
- create/update 携带 UTF-8 candidate hash、byte length 与内容；delete 没有 draft；
- changed-then-restored 被消除，move 表达为 delete + create；
- empty ChangeSet 不生成 PendingAction。

Candidate bytes 只在 finalize/proposal 内存阶段直接存在，之后转为 OAN 内部 immutable artifacts；HTTP/renderer 永远不接收 bytes 或 artifact relative path。

## PendingAction Storage

```text
.workspace/change-engine/v1/
  pending/<id>.json
  drafts/<id>/<index>.txt
  terminal/accepted/<id>.json
  terminal/rejected/<id>.json
  receipts/<id>.json
  transactions/<id>.json
  locks/actions/<id>.lock
  locks/apply.lock
  previews/<preview-id>/...
```

Proposal immutable；terminal record 表达 accepted/rejected；decision receipt 记录 materialization 与 Git result。所有 record/draft 都用同目录 temp、fsync、atomic rename。prepared preview 使用独立 kind、origin、exact targets 与 draft namespace；promotion 重验后创建新的 immutable action，不原地改变 preview。

Public DTO 只暴露 `id/title/description/status/timestamps/changes/diff/origin/git`。`changes` 中只有 operation、path、old/new hash。

## ChangeMaterializer

Accept：

1. strict parse action 并获取 per-action/global locks；
2. 恢复遗留新协议 transaction；
3. 重验 origin freshness、repository identity/branch/HEAD、path policy、baseline、mode 与 artifact hash；
4. 拒绝 unrelated staged state；
5. 为 create/update/delete 构造 operation-aware stage、backup 与 journal；
6. 稳定顺序 materialize，commit point 前失败逆序 rollback；
7. 原子写 accepted terminal record，切换 journal 为 finalize-only；
8. 清理 stage/backup/draft；
9. 按配置执行 Git side effect 并写 receipt。

accepted terminal 是文件事务 commit point。Git commit 不是 commit point；Git add/commit/receipt 失败只产生可恢复 receipt 与显式 quick commit，不回滚 canonical 文件。Reject 不改变 canonical target。

## Deterministic Producers

Reference publication、Reference material adoption、Play adoption 和其它确定性 workflow 可直接通过 builder/virtual writer 生成 ChangeSet。它们必须提交 source-specific origin、exact target policy、repository baseline、candidate fingerprint 与 whole-document validation，不能绕过统一 store/materializer。

## Human Approval And Git

默认 `git.autoCommitOnAccept: true`：只 stage accepted action paths，并用 action identity 生成确定性 commit metadata。若 target 在 proposal 前已经相对 HEAD dirty、存在 unrelated staged content、Git unavailable 或 commit 失败，则 fail closed 为可见 dirty state / quick commit。关闭配置时不得自动 commit 或 sync。

## Internal-State Reset Boundary

`.workspace/` 与 `.oan/sessions/` 是 disposable runtime/session state。一次性开发 reset 必须关闭 Backend/Electron，记录 Git status 与 canonical SHA-256 manifest，证明目录内没有 tracked file，realpath 精确校验后只删除这两个目录，再要求 canonical manifest 与 Git status 保持一致。

绝不能删除 `.git/`、`.oan/config.yaml`、Constitution、Workflow、Skills、Writing Profiles 或任意小说对象文件。产品正常启动不永久执行 reset。

## Context Priority

```text
Novel Constitution
  > Workflow / Writing Profile / Skill
  > Current User Request
  > Explicit Selection
  > Recent Chapter + Summaries
  > State + Timeline + Foreshadow
```

Constitution 是作者可见、可编辑、Git tracked 的创作约束，不是隐藏审查规则。

## Architecture Decisions

- filesystem first、Markdown/YAML、Object File Tree。
- Git history + human approval。
- Aider-style minimal runtime + Vercel AI SDK ToolSet。
- fixed in-memory `bash-tool` / `just-bash` editing。
- `CandidateChangeSet + PendingAction + ChangeMaterializer` 唯一写入链路。
- 不引入重型 Agent framework、宿主 shell 或兼容双引擎。
