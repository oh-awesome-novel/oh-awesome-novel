# Play Mode / Roleplay Sandbox Spec

Status: Draft Implementation Spec

## Goal

Play Mode 是 OAN 中与 Writing Mode 并列的沉浸式小说世界体验。它可以用于角色扮演、场景 rehearsal、多角色对话试跑和世界观体验，但默认不修改 canonical truth。

## Mode Boundary

- Writing Mode 面向正文、状态、时间线、伏笔和摘要的 PendingAction。
- Play Mode 面向互动 transcript、play-local state、activated sources、observations 和 adoption candidates。
- Play transcript 和 play-local state 不是小说事实源。
- 用户确认 adoption 后，Play observation 才能变成章节草稿、state、timeline 或 foreshadow PendingAction。

## Session Layout

Play session 使用 workspace 内部目录：

```text
.workspace/play-sessions/<session-id>/
  transcript.md
  play-local-state.yaml
  activated-sources.yaml
  observations.yaml
  adoption-candidates.yaml
```

这些文件用于恢复、复核和继续 Play，不进入 `chapters/`、`state/`、`timeline/`、`foreshadow/` 等事实域。

## Runtime Shape

第一版采用：

```text
single world referee
  + character voice/state modules
  + activated canonical sources
  + imported interaction hints / lorebook
  + play-local state
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

## Tavern-Compatible Character Import

Play Mode 支持导入 Tavern-compatible Character Card 用作 Play-only 角色或 OAN 角色卡导入预览。

规则：

- 独立解析 JSON / PNG metadata，不复制 SillyTavern AGPL 代码。
- `system_prompt`、`post_history_instructions`、`character_book` 默认是 untrusted imported content。
- imported lorebook 可用于 Play context activation，但不自动写入 `world/` 或 `state/`。
- 不声称官方 SillyTavern 兼容。
- 不自动抓取分享站点角色卡。
