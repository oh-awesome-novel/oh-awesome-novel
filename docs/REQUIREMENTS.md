# Requirements

## User Problems

1. 同人/综漫创作通常建立在原作或他人作品之上；从零重写世界和角色成本高，作者更想“穿越”进原作世界直接改写剧情走向。
2. 聊天或角色扮演产品的推演结果停留在聊天记录里，难以整理成长篇小说，也无法区分“推演过的”与“正式写下的”。
3. 长篇创作需要跨文件维护人物、世界、状态、时间线、伏笔、摘要与大纲；多作品交叉时更容易混乱。
4. 无节制上下文会导致成本、延迟与一致性问题。
5. AI 全文重写或直接写盘容易破坏格式、覆盖作者修改并产生不可审阅结果；但每一次写入都逐项审阅又会造成审批疲劳。

## Primary User

项目作者本人：个人创作同人与综漫，不以商业出版、网络连载或多人协作为目标。熟悉 Markdown、Git 与本地编辑工具，也会用 Codex、Aider、Claude Code、VS Code 或 Obsidian 直接编辑项目。

- 在 Play 中以穿越者或导演身份推演原作世界，并把有价值的结果带回写作。
- 有新脑洞时从零开写：规划、续写、审稿、整理状态与设定。
- 自由选择模型，并始终掌握真实文件和 Git 历史。

不为商业写作、连载平台、团队协作或无技术背景的大众作者设计专门功能。

## Functional Requirements

### F1. Novel Project Initialization

系统创建标准 `.oan/` 配置和 `characters/`、`world/`、`chapters/`、`outline/`、`state/`、`timeline/`、`foreshadow/`、`summaries/` 对象树，并初始化或识别 Git repository。

### F2. Object File Tree

Character、World、Constitution 等长期对象拆成小型 Markdown / YAML 文件。粒度应使作者能理解单次 diff，并让 validator 可以针对完整文件做严格校验。

### F3. Domain Support

必须支持 Character、World、Chapter、State、Timeline、Foreshadow、Summary 与 Outline，以及 Constitution、Workflow、Skill 和 Writing Profile 控制域。Extension manifest / 动态注册保留为暂缓范围，不列作当前交付门槛。

### F4. Novel Constitution And Workflow

Constitution 是作者可见、可编辑、Git tracked 的最高优先级创作约束；AI 只能提出修改建议。`.oan/workflow.yaml` 描述作者流程，不得演化成隐藏 planner。

### F5. AI SDK ToolSet

工具统一使用 Vercel AI SDK `ToolSet`、`tool()` 与 `jsonSchema()`。不得引入第二套 Tool registry 抽象。只读领域工具从 turn 的固定 projection 读取；UI metadata 应作为 ToolSet 外围薄映射存在。

### F6. Aider-style Runtime

Runtime 支持 streaming、多个 tool call、最大循环次数、tool error result 与通用 turn finalizer。它必须 provider-agnostic，不实现 Planner、多 Agent、后台自治执行或隐藏重试。

### F7. Fixed In-memory Editing

每个写 turn 只创建一个 `SandboxEditSession`：

- host 枚举 allowlisted canonical 文件并一次性构造 baseline manifest；
- 文件装入固定 `InMemoryFs`，session 中不再 lazy-read host workspace；
- `TrackingFs` 覆盖完整 mutation surface；
- `PolicyFs` 对读取、枚举与 mutation 都执行 capability/path policy；
- `bash-tool` 只连接 `just-bash`，允许受限文件/文本命令；
- network、宿主进程、Python、JavaScript、symlink、hardlink 与内部路径不可用。

任意 domain read tool 若参与同一 turn，也必须读取该固定投影。

### F8. Host-selected Capability

写权限只能由可信 host workflow 选择，模型参数不能声明或扩大。未知或缺失 workflow 必须降为 `read-only`。能力至少覆盖单一小说文件族、显式 multi-file edit、Reference publish/adopt 与 Play adopt；确定性 producer 使用 exact target policy。

### F9. CandidateChangeSet

finalize 比较 baseline 与最终 VFS，并生成 schema version 1 `CandidateChangeSet`：

- 只含 NFC-normalized workspace-relative POSIX path；
- 只支持 UTF-8 text 的 create / update / delete；
- change 按 path 稳定排序且不重复；
- create 声明 baseline 不存在，update/delete 携带 baseline hash、size 与 mode；
- no-op 必须消除，空集合不创建 PendingAction；
- repository identity、branch、HEAD 与 projection fingerprint 固定在 proposal；
- final whole-document validators 必须对所有 writable family 完整覆盖。

`changes` 是唯一 Accept authority。diff、command log 与 mutation log 不具备权威性。

### F10. PendingAction And Prepared Preview

PendingAction、terminal record、decision receipt 和 prepared preview 使用严格 schema version 1 与独立 kind。create/update 候选 bytes 只存在 OAN 内部 immutable draft artifact；公共 DTO 只能暴露 operation、path、hash、diff、origin 与 Git result，不能暴露 artifact path 或候选全文。

旧或无版本内部记录必须返回 `UNSUPPORTED_PENDING_ACTION_SCHEMA`，不得静默忽略或自动转换。

### F11. Human Approval

所有 AI 或 producer 发起的 canonical 修改都必须进入 PendingAction。Accept 前 canonical bytes 与 Git working tree 不得因候选而变化。Reject 只终结 action 并清理候选；Accept 也不得解析 diff 或重放 shell command。

### F12. Transactional Materialization

`ChangeMaterializer` 必须：

- 重验 action schema、origin freshness、repository、policy、baseline、mode 与 draft hash；
- 对 create/update/delete 建立 operation-aware stage、backup 与 journal；
- commit point 前失败逆序 rollback；
- durable accepted terminal record 是文件事务 commit point；
- commit point 后恢复只 finalize，永不 rollback；
- Git 是 Accept 后 side effect，失败不回滚已接受的 canonical 修改。

### F13. Git Integration

默认 `git.autoCommitOnAccept: true` 时只 stage/commit accepted action paths；禁止混入 unrelated staged/dirty content。关闭自动提交或 Git 失败时，UI 展示 dirty 状态并提供显式 quick commit。frontend 不能提交任意路径或任意 Git 命令。

### F14. Summary And Context

上下文来自 Constitution、Workflow、当前任务、显式选择、近期章节、摘要、State、Timeline 与 Foreshadow。默认不加载整本小说，向量数据库不得成为 memory 事实源。

当前全局状态与章级历史证据必须分层选择；默认模型消息不包含全部章节的结算历史。摘要/章级状态以正文 hash 和证据结构判定来源有效性，区分 current / stale / missing / unverified。历史和未验证参考不能冒充当前事实；来源警告不成为隐式写入 gate，必要输入仍遵循 protected overflow。

### F15. Review, Settlement And Adoption

- Review 默认 report-only；只有作者明确要求编辑时才创建候选。
- Chapter settlement 先记录 evidence-backed observation，再提议 summary/state/timeline/foreshadow/character changes。
- Reference publication/adoption 与 Play adoption 保留 source fingerprint、origin freshness 与 exact target policy。
- 确定性 workflow 直接生成同一 ChangeSet，不强制翻译成 shell 字符串。

### F16. Desktop Review

UI 必须展示 PendingAction title/status、create/update/delete path list、纯文本 diff、origin 与 Git outcome；路径标签只能来自结构化 `changes`，不能从 diff header 或内部 artifact 推断。

### F17. Internal State And Reset

新协议仅使用 `.workspace/change-engine/v1/`。`.workspace/` 与 `.oan/sessions/` 是 disposable runtime/session state；一次性开发 reset 只能在验证 exact realpath、Git tracked files、Git status 与 canonical SHA-256 manifest 后删除这两个目录。`.git`、`.oan` 其它配置与所有小说对象树必须保留。

### F18. Author Manuscript Import

作者自有 Markdown 可在当前工作区预览拆章和卷章映射。原文保留、冲突可见、输入/映射变化后重新预览；初版只创建新章节，不隐式覆盖或合并。导入使用独立 deterministic producer 和同一 immutable preview / PendingAction / Accept，不与已有 OAN workspace 打开或外部 Reference 导入混同。当前批次上限为 512 KiB / 64 章。

### F19. Play Priority

Play 与 Writing 是同级顶级模式，Play 保持高优先级：Guided Start、穿越（Immersive Journey）与导演（Scene Rehearsal）视角、世界事件、分支与 checkpoint、Outcome Report、Writing Reference 与 adoption 是核心体验，不是实验功能。Play 结果进入正式内容仍必须经过显式 adoption 与 PendingAction。

### F20. Core Writing Loop Closure

Writing 必须能从空作品开始独立完成“规划 → 写下一章 → 审稿 → 定稿 → 整理本章 → 写下一章”：

- `/写下一章` 由 host 推导下一个章节路径（空作品为 `chapters/0001/0001.md`；否则为最新卷的下一章），授予该精确路径的 create 能力，不依赖作者在文件树中选中文件。
- `/生成角色卡` 在未选中既有角色时，由作者给出角色 ID，host 授予 `characters/<id>/` 下标准对象文件的精确路径。
- `/规划大纲`、`/规划下一卷` 与 `/规划下一章` 需要保存时，host 授予 `outline/main.md` 或当前卷 `outline/volumes/<卷>.md`。
- 写章与规划的默认上下文包含大纲（`outline/main.md` 与当前卷大纲）和上一章正文。
- 章节正文 Accept 后提示整理本章；首页显示尚未整理（摘要缺失或过期）的章节数。

### F21. Proportionate Review

所有 canonical 写入仍需 Accept，但审阅按风险分级：

- 正文、角色人设与 Constitution：逐项审阅。
- 摘要、章级状态、时间线与伏笔等派生记录：可在审批列表中整批接受；批次中任一项过期或失败时停止并报告，不跳过、不重试。
- 整批接受只是对多个 PendingAction 依次执行普通 Accept，不引入新的写入路径。

## Non-Functional Requirements

### Security

- arbitrary host shell 永远禁止；只允许固定内存投影中的受限同进程 shell。
- 隐藏路径、secrets、未投影文件名、non-regular files 与 host process 不可见。
- command、output、source、scratch、candidate、file count、单文件与 diff 均有独立累计上限。
- stdout/stderr 和 command preview 去除控制字符并按纯文本渲染。
- 本地 HTTP 后端只信任本应用自己的 renderer：校验 `Host` 为 loopback（防 DNS rebinding），拒绝非 loopback 的浏览器 `Origin`，不使用 `Access-Control-Allow-Origin: *`；桌面端每次启动生成随机 token，经 preload 交给 renderer，后端对每个请求校验 `x-oan-token`。
- 已保存的 provider API Key 只发往保存时的 Base URL；请求或保存中更换 Base URL 时必须重新提供 Key。Key 文件以 0600 权限原子写入。
- 返回给 renderer 的错误信息不得包含宿主机绝对路径。

### Simplicity And Observability

一个开发者应能读懂核心 runtime。tool activity、bounded command preview/hash、CandidateChangeSet summary、PendingAction 与 diff 均可观察，但日志不得保存可重放的完整 bash args。

### Durability

proposal、draft、terminal、receipt 与 journal 采用 temp + fsync + atomic rename。恢复逻辑 fail closed，绝不猜测或局部应用 stale proposal。

### Git Friendliness And Local First

所有 canonical 项目数据保持 text-based、可 diff、可由外部编辑器修改，并可在不依赖云数据库的本地环境运行。

## Explicitly Avoid

- LangChain、AutoGen、CrewAI、Semantic Kernel 或重型多 Agent runtime
- feature flag 双写、dual-run、兼容 reader、旧记录 migrator 或 downgrade path
- arbitrary host shell、trusted custom shell command、network/package manager
- database migrations、event sourcing、CQRS 或向量数据库事实源
- silent writes、自动后台写作、diff-as-authority 或 command replay on Accept
- 商业写作、连载平台、付费、团队协作或多人实时编辑功能
