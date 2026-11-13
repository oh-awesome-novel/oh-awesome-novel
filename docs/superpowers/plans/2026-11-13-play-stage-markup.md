# 1610 显式说话人与立绘标注实施计划

对应 task：[1610](../../tasks/1610.md)。不改 settlement 协议与回合事务；不写正式文件；未启用的会话在前缀、请求、存储上与现在逐字节一致。

## 决定

- **开关**：创建会话的请求带 `stageMarkup: true`（快速开局与引导开局都可以），宿主在冻结前缀之前写入 `metadataExtensions.vnStageMarkup: { version: 1 }`。只对沉浸推演（schema 4）开放，场景试演请求会被拒绝。之后没有接口能增删这个键。它是关于这一局的选择，不属于开局包，复用旧开局时不预填。
- **冻结前缀**：启用时在前缀末尾追加一节“演出标注”：标注规则，以及会话已记录的名册（`characterRoster`）与立绘集（`characterPortraitSets`，来自 1600）里每个角色的 `id`、显示名、别名、默认立绘和各立绘的 `id / label / description / usage`。描述截到 160 字、用途截到 80 字。追加在末尾，之前的字节不变。
- **对白行**：`@<角色 id 或名册名/别名>[可选立绘 id] 台词`，一行一个说话人；旁白不加标记。只在行首识别；半角 / 全角 `@`、方括号、冒号都接受。
- **提交时解析**（`parsePlayStageMarkup`）：按行处理，得到剥离标记后的正文与每行的标注。正文进 transcript；标注只进 `StageSnapshot.beats[]` 的 `speakerId / portraitId / source`。打了标的行上所有句子都记 `source: 'markup'`；其余对白沿用启发式，说话人非空时记 `source: 'inferred'`（能对上名册时带 `speakerId`）。未启用的会话不走这条路，beat 不带新字段。
- **降级**（回合不失败）：
  - 角色不在名册里，或一个名字对应多个角色：去掉标记，该行交给启发式推断。
  - 立绘 id 不存在：用该角色的默认立绘；角色没有立绘集时不记立绘。
  - 标记写坏了（没有名字、方括号没闭合）：去掉残留标记，整行按旁白。
  - 每类降级在本回合的上下文追踪里记一条 `{ kind, count, sample }`（`stageMarkupNotices`），专业模式的“回合上下文”里显示成一句话。
- **模型历史**：`playContextHistory` 组装历史时，对启用会话的裁判消息调用 `restorePlayStageMarkup`：用已保存的快照把 `@<speakerId>[portraitId]` 加回 `source: 'markup'` 的行首；不另存带标记的正文。快照与正文对不上时原样返回。
  - **缓存布局核对**：冻结前缀只在创建时生成一次，历史在它之后；加回标记只依赖已提交回合的快照，同一回合每次得到相同字节，所以历史仍是只追加的，窗口起点的推进规则（`stablePlayHistoryWindow`）不变。有测试断言下一回合的历史以上一回合的历史为前缀。
  - 阶段归档自己读 `turnArtifacts` 的干净正文，不经过这个函数；旁支提问（`play-context-question`）与预算估算共用 `playContextHistory`，因此与回合请求看到相同的历史。
- **草稿**：`streamPlayRefereeText` 对启用会话的每段放出文本先过 `createPlayStageMarkupDraftReader`，`play.narrative.delta` 的 `delta` 已无标记，另带可选 `markup: [{ line, speakerId, speaker, portraitId? }]`（`line` 指到目前为止的草稿行号）。专业模式的草稿只用 `delta`；舞台用 `markup` 生成草稿快照。
- **舞台**：名字牌与高亮优先按 `speakerId`；某角色的立绘取“到当前句为止裁判最后一次给他选的那张”，没选过用默认。
- **专业模式**：裁判消息正文下列出本回合标注过的“说话人 · 立绘 id”小标签。
- **角色贴合度（1510）**：送检的仍是干净正文；被标注的说话人名字可能不在正文里，所以在场角色除了按名字查找，还包括快照里 `source: 'markup'` 的 `speakerId`。

## 步骤

1. Core：`play-stage-markup.ts`（读配置、读名册与立绘、前缀块、解析、草稿剥离、历史还原）；`text-speaker-parser.ts` 的 beat 新字段、行号定位与快照校验；`play-turn-prompt.ts`、`play-session.ts` 的结算、`play-context-trace.ts` 的提示字段、`play-character-check.ts` 的在场角色。
2. Backend：创建请求的 `stageMarkup`、草稿剥离、历史还原、追踪提示。
3. Client：创建请求、`delta.markup`、追踪提示的类型与校验。
4. Desktop：两个开局表单的勾选项、流式草稿的标注、舞台、专业模式标签、追踪提示文案。
5. 文档：PLAY_MODE_SPEC、用户手册、任务状态。
6. 测试：Core 解析 / 降级 / 历史 / Retry·Restore·归档；Backend 创建、草稿、历史、追踪、1510；1420 在启用会话上生成章节；Desktop 舞台与表单。

## 会失效的数据

无。旧会话没有 `vnStageMarkup`，行为不变；旧快照没有新字段，照常读取。
