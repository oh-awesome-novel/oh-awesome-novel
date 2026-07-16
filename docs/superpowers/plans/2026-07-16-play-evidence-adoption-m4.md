# Evidence-backed Play Adoption M4 Implementation Plan

> Date: 2026-07-16
> Task: [1170 Evidence-backed Play Adoption Path](../../tasks/1170.md)

## Delivery Boundary

本切片只完成世界事件 M4。它复用 F3 outcome evidence、既有 observation / adoption ledger、write-intent tools 与 PendingAction approval；不增加 canonical target，也不改变 accept 才写入真实文件的边界。

## Frozen Component Map

```text
PlayWorldEventCard.vue ─┐
Play observation list ──┼─> PlayAdoptionDraftForm.vue
PlayOutcomeItem.vue ─────┘      -> usePlayAdoptionPreview.ts
                                  -> candidate
                                  -> PendingAction preview
                                  -> existing approval surface
```

- 三种来源只发出统一 `PlayAdoptionSeed`，不各自实现 payload 与分支校验。
- `usePlayAdoptionPreview.ts` 负责目标建议、preview 生命周期、revision / lens 切换隔离。
- `PlayAdoptionDraftForm.vue` 展示来源证据、合法 target、可编辑 payload 与 canonical diff，不直接 accept。
- 既有 PendingAction 审批面继续拥有 accept / reject。

## Implementation Order

1. Core 冻结 `PlayAdoptionSeed`、selected-branch evidence closure 与稳定目标建议规则。
2. Backend 增加 preview seam：服务端从当前 session 重建 candidate / payload，调用既有 write-intent prepare 得到未写入 diff。
3. PendingAction 创建时再次校验 revision、selected branch、visibility 与 activated source drift，拒绝旧 draft。
4. Client 增加 strict seed / preview / candidate / diff contract。
5. Desktop 将 event、observation 与 outcome 入口接到统一表单；Player / Director 切换立即清空或重新投影敏感草稿。
6. 复用现有 approval surface 打开生成的 PendingAction diff，并保持 canonical 未写提示。
7. 补齐分层测试、生产 build 与任务/升级计划实施记录。

## Correctness Gates

- seed 不信任调用方摘要或 refs；服务端按 seed identity 从当前 selected branch 重建安全 summary 与 evidence closure。
- discarded / sibling / attempt-local facts、detached / stale writing reference 与失效 outcome report 不得成为 candidate。
- Player 默认值、目标建议、preview 与 diff 不能包含 hidden title / summary / cause / source identity。
- target 只允许 `chapterDraft | state | timeline | foreshadow`，payload 必须通过对应 write-intent 的现有 schema。
- preview 是零 canonical write；create PendingAction 只写 approval shadow；accept 才修改真实目标并遵循现有 Git 配置。
- preview token / fingerprint 绑定 session revision、selected path、seed closure 与目标内容；任一漂移都需重新 preview。

## Verification

- Core：event / observation / outcome closure、目标建议、sibling / hidden / unknown / duplicate refs 拒绝。
- Backend：preview 零 canonical write、四类目标、PendingAction 前后二次校验、Restore / Retry / source drift 失效、accept / reject 边界。
- Client：严格 URL、请求体、enum、fingerprint、diff 与 unknown-field guard。
- Desktop：三入口同一流程、少量操作、可编辑预览、Player 防泄漏、lens / session / revision 切换清理、键盘与 aria-live。
- 运行 Core / Backend / Client / Desktop `test:run`、Desktop production build 与 `git diff --check`。
