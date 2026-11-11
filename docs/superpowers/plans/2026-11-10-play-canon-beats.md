# Play Canon Beats And Divergence Ledger Implementation

Related task: [1480](../../tasks/1480.md). Product scope: [Play 模式强化规划 · N1](../../plans/PLAY_MODE_ENHANCEMENT_PLAN_2026-11-10.md#n1-原作节点表与偏离账本). Contract: [PLAY_MODE_SPEC · Canon Beats](../../PLAY_MODE_SPEC.md#canon-beats-and-divergence-ledger).

## Verified Conclusions

对照现有 v4 严格读取规则核实后的结论，实施以此为准。

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| 是否需要 session schema 变更 | 不需要，仍为 v4 | 节点表是 `playLocalState.canonBeats` 一个保留键。`session.yaml` 只存 metadata 与 visibility；状态值随 `branchBaseSnapshot` 与每个 turn artifact 的 snapshot 保存，读取端对未知状态键不做限制，只校验保留键。 |
| 是否需要 branch snapshot watermark 变更 | 不需要 | 节点表只在创建会话时写入 base snapshot，之后每次变化都在完整 snapshot 的 artifact 里。没有“旧 artifact 缺字段”的降级窗口。 |
| 旧会话能否追加启用 | 不能，由校验强制 | 与 `worldMomentum` 相同：predecessor 与当前 snapshot 对 `canonBeats` 键的有无必须一致。旧会话没有这个键，任何试图加上它的 artifact 都读不回来。 |
| 结算协议新字段与冻结前缀 | 新字段 `canonBeatChanges` 可选；协议说明只进入启用会话的冻结前缀 | `buildPlayFrozenSystemPrompt` 的协议块在创建时冻结。启用节点表的会话在创建时追加一段带独立标记的节点协议；未启用的会话前缀逐字节不变，回合尾部也不出现节点段。 |
| 未启用会话的存储与请求 | 与现在一致 | `canonBeatChanges` 为空时不出现在归一化结果里；launch package 的 `canonBeats` 字段缺省时不写入；向导不选节点时请求体不含该字段。 |
| 手动更正与“转为计划事件”用什么 artifact | `transcriptAppend`，说话人 `director`（导演记录） | 两者都必须进分支快照才能跟随 Restore / Retry。放宽两条规则，且只对导演记录生效：`stateDelta` 只允许 `canonBeats` 一个键；计划表只允许新增 `scheduled` 条目，来源是这条导演消息。Core 与 Client 的重放校验同步放宽。不新增 artifact kind，artifact schema 版本不变。 |
| 阶段归档 | 宿主带入，不经模型复述 | `createCompactedPlaySession` 克隆整个会话，节点表随 `playLocalState` 带入。归档提示与 `resourceState` 审计排除 `canonBeats`，避免要求模型逐字复述 24 条引文。 |
| 场景试演（v5） | 不支持 | 开局包带 `canonBeats` 且 purpose 为 `sceneRehearsal` 时预览即报错；v5 结算里出现 `canonBeatChanges` 因没有节点表而失败。 |

## Contract

- 状态键 `canonBeats`：`{ schemaVersion: 1, protagonistKnowsCanon, beats[], changes[] }`。通用状态里可见性固定为 `playerUnknown`；专用面板按每条节点的 `visibility` 投影。
- 节点：`id`（宿主分配 `canon-beat-N`）、`label`、`source`（`sourceBacked`：sourceId / path / contentHash / 逐字 quote；`authorProvided`：providedAt）、可选 `expectedWhen`、`status`、`visibility`、`changedAtTurnId`、`causeEventIds`、可选 `note`、可选 `scheduledEventId`。上限 24 条。
- 变更记录：`{ id, beatId, from, to, reason, origin: 'referee' | 'manual', turnId, eventIds, revision }`，只增不改，上限 96 条。
- 迁移：`pending → 四种终态`；裁判只能做这一步，且每条必须引用本回合至少一个事件。导演更正还可以在终态之间改写；任何来源都不能回到 `pending`。
- 结算：`canonBeatChanges: [{ beatId, status, reason, eventRefs }]`，`eventRefs` 是本回合 `events` 数组的 1 起始位置（模型不知道宿主分配的事件 id）。不存在的节点、非法迁移、越界或非整数引用、同一节点重复变更，都使整回合失败且零写入。
- 开局包：可选 `canonBeats: { protagonistKnowsCanon, beats[] }`。来源节点的 quote 必须是所选 `timeline` 来源当前内容的逐字子串，否则给出 `canonBeatQuoteMissing` 诊断并阻止创建。
- 宿主不判断剧情是否“算发生”，不自动推进节点，不自动生成连锁后果。

## Delivery Steps

- [x] PLAY_MODE_SPEC 写明合同与兼容规则；本文件记录核实结论。
- [x] Core `play-canon-beats.ts`：类型、编解码、迁移纯函数、历史校验、Player/Director 投影、候选节点提取。
- [x] Core 接线：launch package 与会话创建、冻结前缀、回合提示、结算、`play-session-facts` 历史校验、计划表历史对导演记录的放宽、归档排除、结果报告“与原作的差异”。
- [x] Core 导演操作：手动更正、待发生节点转计划事件。
- [x] Backend：候选节点读取、导演操作两个 endpoint；Client：严格解析与重放校验同步。
- [x] Desktop：向导入场步骤的“原作节点”、世界面板“原作走向”、导演更正与转计划事件、结果报告分组。
- [x] 测试：Core 单元与反例；Backend HTTP；默认 SDK → HTTP/SSE → Desktop 旅程。
- [x] build、typecheck、相关回归与文档门禁；更新 task 与索引。

## Verification Boundaries

测试使用合成输入、临时工作区和受控模型。受控模型验证协议与接线，不代表真实模型会稳定给出正确的节点判断；真实模型的判断质量与文学质量由作者另行验收。
