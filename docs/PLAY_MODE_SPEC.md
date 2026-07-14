# Play Mode / Roleplay Sandbox Spec

Status: Draft Implementation Spec

## Goal

Play Mode 是 OAN 中与 Writing Mode 并列的沉浸式小说世界体验。它可以用于角色扮演、场景 rehearsal、多角色对话试跑和世界观体验，但默认不修改 canonical truth。

## Product And Navigation Level

Play Mode 是 workspace 内的顶级产品模式，不是 Writing 工作台右侧面板中的辅助 tab。

目标信息架构：

```text
Workspace
├── Writing
│   └── Novel Agent / file tree / chapter / diff / approval
└── Play
    └── Play session / transcript / scene / world HUD / events / adoption
```

约束：

- Workspace 顶级导航必须提供 `Writing | Play` 模式切换。
- 进入 Play 后，中间主区域切换为完整 Play workspace；不得继续以 `WorkspaceRightPanel` 中的 `Play` tab 作为主容器。
- Play 可以拥有自己的右侧 HUD / Event / Context / Adoption inspector，但它们属于 Play workspace 内部布局，不是 Writing review panel 中的 Play 入口。
- 顶级模式、当前 Play session 和选中 branch 应可恢复，并支持刷新或重新打开 workspace 后回到原位置。
- Writing 与 Play 共享同一小说 workspace、provider、canonical source 和 PendingAction 基础设施，但拥有独立的主交互状态与布局状态。
- 当前 `PlayModeTab.vue` / `rightTab: 'play'` 形态属于过渡实现，后续应迁移而不是继续扩展。

## Mode Boundary

- Writing Mode 面向正文、状态、时间线、伏笔和摘要的 PendingAction。
- Play Mode 面向互动 transcript、play-local state、activated sources、observations 和 adoption candidates。
- Play transcript 和 play-local state 不是小说事实源。
- 用户确认 adoption 后，Play observation 才能变成章节草稿、state、timeline 或 foreshadow PendingAction。

## Session Layout

Play session 使用 workspace 内部目录：

```text
.workspace/play-sessions/<session-id>/
  session.yaml
  transcript.md
  turns/
    <turn-id>.yaml
  play-local-state.yaml
  activated-sources.yaml
  events.yaml
  observations.yaml
  adoption-candidates.yaml
  .migrations/                 # 仅在 legacy upgrade 后存在
    v1-to-v3/ | v2-to-v3/
      preview.yaml
      original/
```

当前 session schema 为 v3。`turns/<turn-id>.yaml` 是已提交回合的结构化事实源；每个 turn artifact 使用独立的 artifact schema，可记录输入、消息、parent turn、revision、world clock、event / observation 引用、state delta、suggested actions，并始终保持 `canonical: false`。

turn artifacts 必须形成唯一 root 到各 head 的无环图，父子 revision 严格递增；`selectedTurnIds` 必须是一条连续的 root-to-head 路径。artifact、message、event 和 observation id 必须唯一，artifact 对 `events.yaml` / `observations.yaml` 的引用及分支内来源引用在 staged write 前统一校验。无法识别或不完整的 v3 committed fact 必须拒绝，不能用默认值静默修补。

`session.yaml` 只保存 session metadata、revision、world clock、event policy、suggested actions、Play-local state visibility 和 `selectedTurnIds`。它不再保存完整 `transcript`；当 turn artifacts 存在时，`selectedTurnIds` 明确给出当前选中路径，读取器不得自行猜测或混合分支。

`transcript.md` 是从 `selectedTurnIds` 指向的 turn artifacts 单向生成的人类可读 projection，不是可独立修改的第二事实源。读取 session 时不会把手工修改的 `transcript.md` 反向合并进回合事实；后续保存会按选中路径重新生成 projection。Core 为现有调用方保留的内存 `transcript` 同样来自该 projection。

旧 v1 / v2 session 继续兼容读取，并在内存中把 `session.yaml.transcript` 转为确定性的 legacy turn artifacts。高于当前 session 或 turn artifact schema version 的数据必须拒绝，避免旧客户端破坏未来数据。

Core 提供 v1 / v2 -> v3 migration preview。旧 session 第一次写入 v3 snapshot 时，原始 session 会完整备份到 `.migrations/v1-to-v3/original/` 或 `.migrations/v2-to-v3/original/`，同目录保存 `preview.yaml`；旧 `session.yaml` 的未知顶层 metadata 会写回 v3 metadata。已有 `.migrations/` 历史必须复制进后续每次 staged snapshot，不能因普通保存而丢失。当前 Core 已具备 preview 与备份基础，但 backend / client / UI 的显式迁移确认流程仍属于待实现范围。

session snapshot 采用 sibling staging directory + ready marker + directory swap 写入，固定 YAML / Markdown 文件、`turns/` 回合事实和 migration history 处于同一 snapshot。提交中断时，读取器可以恢复完整 stage 或已有 backup；不得并行直写目标文件形成混合 revision。同一 session 的 world turn、transcript、observation 和 adoption mutation 必须共享互斥锁，并支持 `baseRevision` 冲突检查。

这些文件用于恢复、复核和继续 Play，不进入 `chapters/`、`state/`、`timeline/`、`foreshadow/` 等事实域。

## Runtime Shape

第一版采用：

```text
single world referee
  + character voice/state modules
  + activated canonical sources
  + imported interaction hints / lorebook
  + play-local state
  + world clock / typed external events
  + structured settlement before Play-local commit
```

不引入重型多 agent runtime。多角色效果优先通过明确的角色 voice/state module 和世界裁判 prompt 达成。

## Activated Sources

Play session 可激活：

- character card canonical facts
- `interaction.md`
- `lorebook.yaml`
- world rules
- current state
- timeline anchor
- active hooks
- location / faction / item context

每个 activated source 必须记录 source id、path、trigger reason、budget layer 和 trust level。

## Observations And Adoption

Play observation 只表示“在这次 Play 中发生或显露的内容”。它可以被用户选中并转为 adoption candidate：

- chapter draft candidate
- state update candidate
- timeline event candidate
- foreshadow candidate

Adoption candidate 仍不是事实。它必须进入 PendingAction / diff / Human Approval。

`playerUnknown` event 产生的 Play-local state、observation 和 candidate 必须携带同一 visibility / provenance。spoiler 默认关闭时，它们不能出现在 player-visible HUD 或 adoption 表单中；作者显式开启 author view 后才可查看。candidate 至少记录 source observation ids，并继承其 turn / event refs。

## Tavern-Compatible Character Import

Play Mode 支持导入 Tavern-compatible Character Card 用作 Play-only 角色或 OAN 角色卡导入预览。

规则：

- 独立解析 JSON / PNG metadata，不复制 SillyTavern AGPL 代码。
- `system_prompt`、`post_history_instructions`、`character_book` 默认是 untrusted imported content。
- imported lorebook 可用于 Play context activation，但不自动写入 `world/` 或 `state/`。
- 不声称官方 SillyTavern 兼容。
- 不自动抓取分享站点角色卡。
