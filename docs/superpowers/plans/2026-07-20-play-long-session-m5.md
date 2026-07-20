# Play Long-session M5 Implementation Plan

> Date: 2026-07-20
> Task: [1180 Play Long-session Context And Experience Closure](../../tasks/1180.md)
> Status: Completed (2026-07-20)

## Delivery Boundary

本切片完成所有 Play purpose 共用的长 session 读模型、回合 context evidence、source drift 决策与真实旅程收口。它不改变 canonical truth，不把通用 durability backlog 并入 M5，也不实现 rehearsal-specific F4 控制。

## Frozen Contracts

- `PlaySessionSummary` 是 schema-versioned read model，只含 rail / selection 所需 metadata、purpose/start mode、revision、world clock、selected counts 与 source status。
- transcript / event window 使用 opaque cursor，cursor 绑定 session id、revision、selected head、projection kind 与 offset；任一绑定变化均拒绝继续分页。
- `PlayContextTrace` 是 host-owned immutable evidence；每个 committed turn artifact 至多对应一份 trace。
- trace 记录 window bounds、selected / omitted source、budget layer、semantic boundary、trust、expected / actual hash、omission reason 与 drift status；不记录模型私有 reasoning。
- source decision 为 `continueFrozen | reassemble | fork`；所有请求携带 revision CAS，重复或竞态请求按 409 fail closed，不在本切片承诺 decision receipt replay。

## Implementation Order

1. Core 增加 summary、window cursor、context trace 与 source drift domain modules。
2. staged writer manifest 接入 `traces/`，保证成功 turn 同事务提交、失败零写入。
3. Backend / Client 增加 summary/detail/window、trace read 与 drift-decision strict routes。
4. world-referee 与 actor-step context assembler 输出同一 host-owned source/window selection evidence。
5. Desktop rail 改用 summary，transcript / event feed 改用窗口 composable，新增 context inspector / drift controls。
6. 增加真实 renderer/browser smoke 和长列表功能回归。
7. 更新 context 状态文案和所有 task / plan 状态；旧 endpoint 与 migration 留待发布前统一收口。

## Correctness Gates

- summary/list 不得携带完整 session ledger。
- window item 必须只来自当前 selected branch，顺序稳定、无重复、cursor 不可跨 revision / branch 重用。
- trace 的 selected source 必须与实际送入模型的内容选择一致；omitted source 必须有枚举 reason。
- hidden 内容不能从 Player trace label、omission message 或 drift preview 泄漏。
- drift 决策不修改 canonical 文件；旧 session / branch 历史永不被覆盖。
- trace、decision 与 session mutation 继续服从 active attempt / turn conflict、filesystem lock 和 revision CAS。

## Verification

- Core：summary 不含 ledger、cursor tamper/stale、selected window、trace round-trip、omission/drift normalization。
- Backend/Client：strict response/request、window paging、失败零写入、source drift 三决策与 stale revision。
- Desktop：summary rail、load older、Player scrub、drift confirmation。
- Browser/renderer：创建/选择长 session、分页、提交 turn、查看 trace、处理 drift、Restore 后旧 cursor 失效。
- 全量 Core / Agent / Backend / Client / Desktop tests、Desktop build 与 `git diff --check`。
