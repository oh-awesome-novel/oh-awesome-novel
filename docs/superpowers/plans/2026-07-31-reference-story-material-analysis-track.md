# Reference Story Material Analysis Track Implementation Plan

**Task:** `docs/tasks/1210.md`

## Delivery Boundary

本计划只交付 Writing Profile W2b。它扩展现有 reference deconstruction 控制面，
不实现 W3 的材料采用，也不建立第二套 controller。

## Frozen Contracts

1. run 创建时从当前 Writing Profile 记录 `profileId + outputs`；后续 resume 使用该
   记录，不受 Profile 切换影响。
2. work plan 以 `tracks.technique?` / `tracks.storyMaterial?` 保存终端 identity；
   material-only、technique-only、both 都是合法且严格的 schema。
3. 两条 track 使用相同 source checksum、chapter split、source pointer 和 run
   lifecycle；chapter / aggregate / projection output type 彼此不可互换。
4. Technique stages 与 Material stages 只在对应 track 被选择时要求存在和完成；
   shared detect / preview / quality 状态仍可审计。
5. `context/` 仍是 Technique D5 索引。material-only 发布一个合法空索引，显式
   `techniqueTrackRan: false`，并保持 bundle `completed`、D5 `contextEligible: false`。
6. `materials/*.yaml` 是具体原作事实材料；`deconstruction/*.md` 是技法观察。两者
   formatter、UI 分组和后续读取边界必须明确区分。
7. 部分发布只 materialize 本次选择的 projection；manifest 合并未选 projection 的
   checksum、source run 与 source checksum。与当前 source 不一致的 retained
   projection 显式 stale，不能继续进入 D5。

## Implementation Order

1. Core：track/output selection、work-plan/stage/manifest/context-index 的 strict schema。
2. Core：Story Material Preview、Finding、Aggregate、Projection、formatter 与质量检查。
3. Agent：四类独立 material prompt / JSON schema / provider runner。
4. Store/Backend：run snapshot、双轨 bounded advance、per-track quality、candidate
   partial publish 与 empty context index。
5. Tools：`materials/*.yaml` ReferenceArtifactPatch allowlist 与 confinement。
6. Client/Desktop：strict transport、材料预览、按 Technique / Story Materials 分组审阅。
7. Tests/docs：三种 track 组合、生命周期、部分发布、回归与状态更新。

## Correctness Gates

- Story Material output 不能由 Technique finding / aggregate 构造。
- 每个非 uncertain material entry 必须闭合到本 track 的 verified finding/evidence。
- material-only publication inventory 可以为空，但 technique run 仍要求完整五类 entry。
- selected tracks 的 quality 都为 `passed | warned` 才能 publish；任一 blocking
  structural diagnostic 都 fail closed。
- candidate、manifest、context index 与 references summary 在 material-only 下互相
  一致，不把“没有 techniques”误报成 bundle 损坏。
- PendingAction Accept 前真实 reference bundle 字节不变。

## Verification

- 分层运行 Core / Agent / Tools / Backend / Client / Desktop reference tests。
- 运行所有受影响 package build、Desktop production build、renderer smoke。
- 运行完整 workspace 回归和 `git diff --check`。
