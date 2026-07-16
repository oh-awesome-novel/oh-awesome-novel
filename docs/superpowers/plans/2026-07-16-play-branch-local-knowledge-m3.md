# Branch-local Knowledge And Causal Reveal M3 Implementation Plan

> Date: 2026-07-16
> Task: [1160 Branch-local Knowledge And Causal Reveal](../../tasks/1160.md)

## Delivery Boundary

本切片只完成世界事件 M3。知识状态复用 `playLocalState`、artifact snapshot、selected turn graph、Restore 与 Retry；不新增 knowledge ledger 文件，不修改旧 hidden event，也不实现角色级 knowledge grant。

## Frozen Component Map

```text
packages/core/src/play-knowledge.ts
  -> strict state / transition / projection
  -> composed by play-session.ts and play-session-facts.ts

apps/desktop-ui/src/composables/playWorldPresentation.ts
  -> spoiler-safe reveal chain projection
  -> PlayWorldEventCard.vue
       -> PlayEventRevealChain.vue
```

- `play-knowledge.ts` 是唯一领域规则模块；`play-session.ts` 只装配 settlement 与 snapshot。
- `play-session-facts.ts` 对所有历史 artifact 重放 knowledge transition，读取时 fail closed。
- `playWorldPresentation.ts` 生成展示模型，组件不自行拼接 hidden fallback 文案。
- `PlayEventRevealChain.vue` 只展示已投影的安全链路，不持有 session 或异步状态。

## Frozen Data Contract

- reserved state key：`playKnowledge`，visibility 永远为 `playerUnknown`。
- state schema v1：有序 `records`，缺失 key 等价于空 v1；记录为 append-only。
- 首个 record kind：`eventReveal`，包含宿主生成 id、`subjectEventId`、previous / next Player projection、`knownByParticipantRefs`、`revealedAtTurnId`、`revealedByEventId` 与 `canonical: false`。
- settlement 新增 `knowledgeChanges`；首个 change type 为 `revealEvent`，只接受 `subjectEventId` 与目标 `rumor | playerVisible`。
- 每个 change 必须与当前 settlement 中唯一一个同目标 visibility 的 `informationSpread` event 配对，该 event 的 `cause.sourceEventIds` 必须包含 subject。

## Implementation Order

1. Core 新增 strict state / change normalization、transition、可揭示候选与 Player / Author projection helper。
2. 把 `knowledgeChanges` 接入 referee protocol、settlement materialization 与 artifact `stateDelta`；禁止 raw reserved state write。
3. 在 branch snapshot validation 中重放 append-only transition，并验证 ancestor / pairing / visibility / immutable source event。
4. Backend 的 v4 referee 与 v5 rehearsal prompt / contribution 合并接入同一 contract；继续复用现有 turn、Retry、Restore routes。
5. Client 增加公开类型与完整 session / artifact transition strict guard。
6. Desktop 用纯 presentation model 展示 reveal 状态；Player 使用安全通用链路，Author 才能展开 hidden source。
7. 补齐分层测试、生产 build 与任务/升级计划实施记录。

## Correctness Gates

- subject event 必须来自当前 artifact 的严格 selected ancestor；不能引用同回合、descendant、sibling 或未选事件。
- transition 只允许 unknown -> rumor、unknown -> visible、rumor -> visible；重复、降级、跳回 unknown 与一回合多次修改同 subject 均拒绝。
- revealing event 必须属于当前 artifact、kind 为 `informationSpread`、visibility 等于目标，并唯一绑定该 change。
- knowledge state 必须是 predecessor records 的严格前缀加本回合派生记录；不能删除、改写、重排或伪造历史记录。
- `playKnowledge` 不进入 generic state HUD；其 raw bytes、record 与 hidden subject details不进入 Player projection。
- v5 actor contribution 不能直接写 reserved key；host settlement 合并后仍执行与 v4 相同的 typed invariant。
- provider failure、cancel、invalid response 与 CAS conflict 均零写入；Restore / Retry 自然读取对应 predecessor snapshot。

## Verification

- Core：unknown -> rumor -> visible、hidden event 不变、unknown / same-turn / sibling / downgrade / duplicate / ambiguous 拒绝、Restore / Retry branch isolation、transcript append 不变。
- Backend：prompt 候选有界、v4 / v5 成功、raw reserved write / malformed change / provider fail / cancel / revision drift 零写入。
- Client：严格字段、enum、id、record prefix、artifact snapshot 与 selected projection 校验。
- Desktop：Player 不出现 hidden id / title / summary / reason，Author 展示完整 chain；切换 lens 同步清除隐藏展示。
- 运行 Core / Backend / Client / Desktop `test:run`、Desktop production build 与 `git diff --check`。
