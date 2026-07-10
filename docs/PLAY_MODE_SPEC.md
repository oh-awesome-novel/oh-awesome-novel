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
  play-local-state.yaml
  activated-sources.yaml
  events.yaml
  observations.yaml
  adoption-candidates.yaml
```

当前 schema v2 在 `session.yaml` 中保存 revision、world clock、event policy、suggested actions 和 Play-local state visibility；`events.yaml` 保存结构化 Play-local world events。旧 session 缺少这些字段或文件时使用兼容默认值读取，高于当前实现的 schema version 必须拒绝，避免旧客户端破坏未来数据。

session snapshot 采用 sibling staging directory + ready marker + directory swap 写入。提交中断时，读取器可以恢复完整 stage 或已有 backup；不得并行直写七个目标文件形成混合 revision。同一 session 的 world turn、transcript、observation 和 adoption mutation 必须共享互斥锁，并支持 `baseRevision` 冲突检查。

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
