# OAN 参考作品深度拆解升级计划

> 计划状态：Proposed，已具备进入 D0 / D1 实施的边界。
>
> 关联任务：`docs/tasks/0900.md`（保持 `Needs Review`，不另建重复领域任务）。
>
> 分析日期：2026-07-21。
>
> 产品阶段说明：OAN 当前仍处于未发布的早期开发阶段。本计划不处理旧 endpoint 下线、旧 reference bundle migration 或系统化无障碍支持；开发期旧 bundle 可以重新导入或重建，但新 reader 必须对未知版本和不完整产物 fail closed。

## 1. 结论摘要

当前最适合补入 OAN 的 reference 能力，是把已有的“导入参考作品”升级为真正可使用的 **AI 参考作品深度拆解流水线**：

```text
用户显式导入合法持有的文本
  -> 宿主校验 source / rights / checksum / 章节边界
  -> 前 1–3 章 Quick Preview
  -> 用户确认是否继续
  -> bounded chapter / chunk 分析
  -> 聚合 plotline / pacing / hook / character / world / style
  -> 质量门与 no-copy 检查
  -> 用户审阅候选产物
  -> 发布到 reference bundle
  -> 现有 selector 只选择 current distilled entries
```

这不是新的多 Agent 平台、隐藏 RAG 或小说导入器。它是一个由用户启动、可暂停、可恢复、可复核的单模型长任务，产物仍是 Markdown / YAML 文件，并严格与当前小说 truth files 隔离。

本计划最先交付 D0 + D1：

1. 修正当前“导入即标记拆解完成”的状态语义。
2. 未正式发布的 stub / preview 不得进入写作 context。
3. 完成前三章或用户选段的真实 AI Quick Preview。
4. 增加 manifest、diagnostics、source pointer、用户继续确认和失败恢复。

完整全书拆解、聚合与 distilled entry 选择在后续纵向切片继续完成，但从第一步就冻结最终需要的身份、来源和恢复边界。

## 2. 当前基线与真实缺口

### 2.1 已经落地的能力

当前 `packages/core/src/reference-work.ts` 已提供：

- 从粘贴文本或本地 UTF-8 文件导入 reference。
- 每个 reference 独立 bundle。
- `metadata.yaml`、source checksum、rights、allowed usage 和 source manifest。
- 基础章节边界检测。
- 项目级 `examples/references.yaml` 索引。
- reference 启用 / 禁用。
- bounded reference count / token budget selector。
- `referenceDistilled` context source 映射与 no-copy warnings。

Backend、Client 与 Desktop 已有：

- `GET /api/workspace/references`。
- `POST /api/workspace/references/import`。
- `PATCH /api/workspace/references/:id`。
- `POST /api/workspace/references/context`。
- References tab、导入表单、启停列表与 context selection 展示。

`1040`、`1070`、`1080` 已分别提供可复用的 session artifact、context trace 自动接线和 distilled-only selector 基础。

### 2.2 当前实现不能被误报为深度拆解

当前 import 会同时生成：

- `deconstruction/quick-preview.md`。
- `deconstruction/chapters/*-summary.md`。
- aggregate Markdown 文件。
- `distilled/*`。
- `context/reference-summary.md`。

但这些文件目前是 deterministic stub。现有 `ReferenceProgressStage` 只有 `importSource | detectStructure | quickPreview | distillForOan`，import 结束时却把四个阶段全部标记为 completed；selector 又会读取生成的 summary。这造成两个产品语义错误：

1. UI 可能把“已导入骨架”显示成“已完成拆解”。
2. 写作 context 可能选择尚未经过 AI 拆解、来源验证和质量门的 placeholder。

因此，D0 不是单纯新增按钮，而是先建立 readiness gate：

```text
enabled = 用户愿意使用该 reference

contextEligible =
  enabled
  && published deep deconstruction exists
  && source checksum is current
  && pipeline fingerprint is current
  && quality gate passed
```

`enabled` 与 `contextEligible` 必须分离。`notAnalyzed | previewOnly | running | failed | stale | qualityFailed` 都必须进入 selector omitted 列表并给出原因。

## 3. 产品目标

### 3.1 用户目标

作者应能完成以下闭环：

- 导入自己有权分析的参考小说、样章或风格样本。
- 先用有限成本判断这份材料是否值得继续拆解。
- 看见 OAN 认为它“适合学什么、不适合学什么”，并能追溯到来源章节。
- 明确确认后才运行全量拆解。
- 长任务可以暂停、取消、重开应用后恢复、局部重试。
- 查看章节覆盖率、低置信结论、缺失边界和 no-copy 风险。
- 发布后在规划、写作或审稿中只使用少量 distilled technique entries。
- 随时禁用 reference；禁用后它不再进入 agent context。

### 3.2 产品成功标准

这一功能成功，不以“生成了很多分析文件”为标准，而以以下结果为标准：

- References 从导入骨架变成作者可查询、可复核的技法资料库。
- 普通写作 prompt 不读取 reference 原文。
- 每个有实质含义的分析结论都有有效 source pointer，或被明确标记为 general inference / uncertain。
- 任何 reference 内容都不会自动成为当前小说 canon。
- 中断、失败和重试不会产生一半新、一半旧的 published bundle。
- 作者能理解当前阶段、成本、失败原因和下一步操作。

## 4. 明确范围

### 4.1 本计划包含

- 已导入 UTF-8 plain text / Markdown reference 的深度分析。
- source checksum 与章节结构 fingerprint 校验。
- 前 1–3 章或用户明确选段的 Quick Preview。
- Preview 后的显式 full-run confirmation。
- deterministic chapter / chunk 切分和 bounded rolling context。
- 分章摘要与可选 deep dive。
- plotline、pacing、hooks、characters、relationships、worldbuilding、timeline、tropes、style profile 和 scene techniques 聚合。
- evidence/source pointer、confidence、uncertainty 与 coverage。
- `deconstruction-manifest.yaml`、`diagnostics.yaml` 和人类可读 progress projection。
- pause、cancel、resume、retry-stage / retry-chapter、restart reconciliation。
- candidate review、Human Approval 和原子 publish。
- selector readiness gate 与 distilled-entry 级选择。
- Core、Agent、Backend、Client、Desktop 和真实产品组件旅程测试。

### 4.2 本计划不包含

- PDF、EPUB、DOCX、图片 OCR、压缩包或联网下载。
- 把作者自己的旧稿导入成当前小说 workspace。
- 自动把 reference 角色、世界规则、剧情、时间线或伏笔写入当前小说。
- reference-derived truth adoption；如未来需要，建立独立 PendingAction task。
- 模仿具体作者、复写作品表达、保留可识别对白或长原文摘录。
- embedding、向量数据库、隐藏 RAG memory 或远程索引服务。
- 多 Agent 分工平台、后台 daemon、无人确认自动续跑或隐藏 retry。
- 通用 batch-job / workflow framework。
- 为每个拆解阶段增加独立 provider / model 设置面板。
- 旧 endpoint deprecation、旧 bundle migration、兼容转换 UI。
- screen-reader、完整焦点旅程和系统化无障碍矩阵；当前只保留基础原生控件与状态语义。

## 5. 核心架构边界

### 5.1 事实与派生产物层级

```text
用户导入的 source + metadata + checksum
  = reference source evidence
  != 当前小说 canon

已发布 deconstruction / distilled files
  = 用户接受的、可重建的 reference analysis artifacts
  != 当前小说 truth files

.workspace/sessions/<run-id>/...
  = provisional run / recovery / candidate output
  != 已发布 reference artifact

request-local reference selection
  = 本轮 context decision
  != 持久化事实
```

原始 source 是拆解的证据基线；AI 输出是可重建的派生产物。当前小说的 `characters/`、`world/`、`state/`、`timeline/`、`foreshadow/`、`chapters/` 与 `summaries/` 永远不因拆解 run 自动改变。

### 5.2 包职责

```text
packages/core
  -> schema、状态机、chunker、fingerprint、路径约束、质量门、
     manifest / diagnostics / projection 与纯文件操作

packages/agent
  -> 复用现有 provider resolver，执行单模型 typed preview / chapter /
     aggregate / style / distill 调用，不直接写目标文件

packages/runtime
  -> 不新增 reference planner、scheduler 或多 Agent 编排

packages/backend
  -> workspace-scoped transport、有界 unit controller、锁、恢复、SSE 和 publish composition

packages/client
  -> strict request / response / event guards

apps/desktop-ui
  -> 运行控制、preview gate、进度、诊断、候选审阅和 selector 状态
```

Core 不调用模型；Vue 不直接读取 filesystem；reference source 中的文本不能触发工具或改变系统指令。

### 5.3 与现有能力的复用关系

- 复用 `reference-work.ts` 的 bundle、metadata、rights、checksum、chapter detection 和 index。
- 复用 `.workspace/sessions/<session-id>/` 的长任务 artifact 与 resume boundary。
- 复用 `ContextPackage` 的 selected / omitted / reason / trace，不保存隐藏 reasoning。
- 复用现有 provider resolution 和 AI SDK bridge，不建立第二套模型配置。
- 复用已经登记为 planned 的 `novel.deconstruct_reference` capability；preview / chapter / aggregate / style / distill 是同一 capability 的 stage，不新增五套 skill 或模型人格。
- 复用 PendingAction / shadow write / diff / Human Approval；AI 产物发布前真实 bundle 不变。
- 复用 Git accept 后的现有配置语义；本计划不另建 reference 专属 Git 历史系统。
- `1110` usage stats 后续可接入 token 成本展示，但不是 D0 / D1 的开工 Gate。

### 5.4 建议文件拆分

不要继续把状态机、模型拆解和存储逻辑堆入现有 `reference-work.ts`：

```text
packages/core/src/reference-work.ts
  -> 现有 import / list / enable facade

packages/core/src/reference-deconstruction.ts
  -> schema、状态机、unit planner、fingerprint、downstream invalidation、formatter

packages/core/src/reference-deconstruction-store.ts
  -> bundle containment、runtime schema parse、reference lock、revision CAS、atomic publish

packages/core/src/reference-deconstruction-quality.ts
  -> evidence closure、coverage、copy-risk、selector readiness quality gates

packages/agent/src/reference-deconstruction.ts
  -> injectable typed model runner；preview / chapter / aggregate / style / distill

packages/backend/src/reference-deconstruction.ts
  -> request-bounded unit controller 与 transport handlers

apps/desktop-ui/src/components/workspace/reference/
  -> detail、Quick Preview、progress、diagnostics、candidate review
```

`reference-work.ts` 继续作为包入口 facade；内部模块可以拆分，但本计划不下线现有 endpoint，也不建立重复 public type。

## 6. 领域模型

### 6.1 Pipeline stage

冻结以下 stage id：

```ts
type ReferenceDeconstructionStageId =
  | 'detectStructure'
  | 'quickPreview'
  | 'chapterAnalysis'
  | 'aggregateAnalysis'
  | 'styleProfile'
  | 'distillForOan'
  | 'qualityGate';
```

`importSource` 是显式用户导入操作，不属于 AI run stage。每个 stage 使用统一状态：

```ts
type ReferenceDeconstructionStageStatus =
  | 'notStarted'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';
```

整体 run 状态：

```ts
type ReferenceDeconstructionRunStatus =
  | 'created'
  | 'previewRunning'
  | 'awaitingFullApproval'
  | 'fullRunning'
  | 'paused'
  | 'reviewReady'
  | 'publishing'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'stale'
  | 'interrupted';
```

状态迁移由宿主校验：

```text
created
  -> previewRunning
  -> awaitingFullApproval
      -> cancelled
      -> fullRunning
          -> paused -> fullRunning
          -> interrupted -> fullRunning
          -> failed -> fullRunning (explicit retry)
          -> reviewReady
              -> cancelled
              -> publishing
                  -> completed
```

任何 source checksum、structure fingerprint 或 predecessor output hash 漂移，都会把依赖 stage 与 run 标记为 `stale`；不得继续 publish。

### 6.2 稳定身份与幂等

至少冻结：

- `referenceId`：现有 bundle identity。
- `runId`：一次 preview/full 分析链。
- `runRevision`：每次合法命令单调增长。
- `stageId`：固定 stage identity。
- `stageAttemptId`：一次 stage 尝试，retry 不覆盖旧 attempt。
- `chapterId` / `chunkId`：由 source manifest 确定性派生。
- `findingId`：由 run/stage/chapter/type/ordinal 或稳定内容 fingerprint 派生。
- `distilledEntryId`：稳定类别 + finding closure 派生。
- `idempotencyKey`：所有会启动或改变 run 的命令必需。

Stage input fingerprint 至少包含：

```text
sourceChecksum
+ structureFingerprint
+ pipelineVersion
+ capability/promptVersion
+ stageId
+ options
+ predecessorOutputHashes
```

同 idempotency key + 同 payload 返回同一 receipt；同 key + 不同 payload fail closed。

### 6.3 Source pointer

所有 evidence 使用宿主生成的 pointer，模型不能自由伪造路径：

```ts
interface ReferenceSourcePointer {
  referenceId: string;
  sourceChecksumSha256: string;
  chapterId: string;
  chunkId: string;
  lineStart: number;
  lineEnd: number;
}
```

模型输出只允许引用本次请求中由宿主提供的 opaque pointer id；Core 在落入 candidate 前解析并重新验证 checksum、章节归属和行范围。

### 6.4 Typed finding

模型输出不能以自由 Markdown 直接成为 published artifact。先解析为严格 finding：

```ts
interface ReferenceDeconstructionFinding {
  id: string;
  kind:
    | 'chapterSummary'
    | 'plotline'
    | 'pacing'
    | 'hook'
    | 'characterTechnique'
    | 'relationshipTechnique'
    | 'worldbuildingTechnique'
    | 'timelineObservation'
    | 'trope'
    | 'styleTechnique'
    | 'sceneTechnique';
  observation: string;
  technique: string;
  whenUseful?: string;
  avoid?: string;
  confidence: 'low' | 'medium' | 'high';
  evidenceRefs: string[];
  generalInference: boolean;
  uncertainty?: string;
}
```

规则：

- `generalInference: false` 时至少一个 evidence ref。
- `generalInference: true` 时必须说明 inference boundary，且不能表述为原作确定事实。
- schema 不提供 quotation / excerpt / rewrite 字段。
- 不允许 chain-of-thought、hidden reasoning 或模型内部评分过程。

### 6.5 Distilled entry

Distilled entry 只保存抽象、可迁移的写作技法：

```ts
interface ReferenceDistilledEntry {
  id: string;
  category: 'writingStyle' | 'pacing' | 'hooks' | 'scene' | 'character';
  title: string;
  technique: string;
  whenUseful: string[];
  constraints: string[];
  differentiationPrompts: string[];
  sourceFindingRefs: string[];
  confidence: 'low' | 'medium' | 'high';
  tags: string[];
  capabilityIds: string[];
  estimatedTokens: number;
}
```

它不能包含可复制正文、原作专有角色设定、地名、组织或桥段排列。原作名仅可在 bundle metadata 和 UI attribution 中出现，不进入 technique 正文。

## 7. 文件布局与所有权

### 7.1 Published reference bundle

保持现有 `examples/` 目录，不在当前未发布阶段进行重命名或 migration：

```text
examples/
├── README.md
├── references.yaml
└── references/
    └── <reference-id>/
        ├── metadata.yaml
        ├── sources/
        │   ├── original.<ext>
        │   └── source-manifest.yaml
        ├── deconstruction-manifest.yaml
        ├── diagnostics.yaml
        ├── progress.yaml                 # manifest 的人类可读 projection
        ├── deconstruction/
        │   ├── quick-preview.md
        │   ├── chapters/
        │   │   ├── 0001-summary.md
        │   │   └── 0001-deep-dive.md
        │   ├── plotlines.md
        │   ├── characters.md
        │   ├── relationships.md
        │   ├── worldbuilding.md
        │   ├── timeline.md
        │   ├── tropes.md
        │   └── style-profile.md
        ├── distilled/
        │   ├── writing-style.md
        │   ├── pacing.md
        │   ├── hooks.md
        │   ├── scene-techniques.md
        │   ├── character-techniques.md
        │   └── do-not-copy.md
        └── context/
            ├── index.yaml
            └── reference-summary.md
```

所有 AI 生成文件必须由 typed records 经 deterministic formatter 产生。`progress.yaml` 是可删除重建的 projection；`deconstruction-manifest.yaml` 是已发布拆解产物的版本、fingerprint、依赖和 output hash 清单。

### 7.2 Provisional run storage

运行中和待审阅产物只进入现有 shadow/session 区：

```text
.workspace/sessions/<run-id>/
├── run.yaml
├── context-package.yaml
├── outputs.yaml
├── unresolved.md
└── reference-deconstruction/
    ├── request.yaml
    ├── run-state.yaml
    ├── diagnostics.yaml
    ├── stages/
    │   └── <stage-id>/
    │       └── attempts/<attempt-id>/
    │           ├── input-manifest.yaml
    │           ├── findings.yaml
    │           └── receipt.yaml
    └── candidate/
        └── examples/references/<reference-id>/...
```

Active run 不把临时文件写入 published bundle。失败、暂停、取消或进程退出时，Git working tree 不因 AI 候选产物变 dirty。

### 7.3 Manifest 最小字段

```yaml
version: 1
referenceId: reference-example
sourceChecksumSha256: "..."
structureFingerprint: "..."
pipelineVersion: 1
capabilityVersion: novel.deconstruct_reference@1
publishedRunId: run-example
publishedAt: "2026-07-21T00:00:00.000Z"
qualityStatus: passed
stages:
  quickPreview:
    selectedAttemptId: attempt-preview-1
    inputFingerprint: "..."
    outputHashes: []
  chapterAnalysis:
    selectedAttemptId: attempt-chapters-1
    completedChapterIds: []
    outputHashes: []
outputs: []
```

Manifest 不保存 prompt 原文、reference 原文、provider secret、chain-of-thought 或长错误堆栈。

## 8. 拆解流水线

### 8.1 Stage 0：Import / deterministic structure baseline

导入继续由现有显式用户操作完成，但需要修正语义：

- import 成功只表示 `imported`。
- 不再生成看似完成的 AI aggregate / distilled stub；允许创建空 index、deterministic `do-not-copy.md` 和 `notAnalyzed` manifest。
- `quickPreview`、`chapterAnalysis`、`aggregateAnalysis`、`styleProfile`、`distillForOan` 全部从 `notStarted` 开始。
- existing `enabled` preference 不代表 selector eligible。
- 章节识别 confidence 低时仍可导入，但 preview 前必须提示或要求用户确认范围。

### 8.2 Stage 1：Quick Preview

默认范围：

- 优先使用检测到的前 3 章。
- 少于 3 章时使用全部已识别章节。
- 单章过长时按 paragraph semantic boundary 切成 bounded chunks。
- 除章节数上限外，还必须有字符/token 上限；不得把前三个超长章节一次塞入模型。
- 用户选段能力可作为同一 contract 的可选输入，但第一实现不要求复杂选区编辑器。

Preview 输出：

- source / structure 摘要。
- 每章一句到数段的摘要。
- 开篇钩子、节奏、场景功能、角色登场和信息释放观察。
- “适合学习”的抽象技法。
- “不适合直接迁移”的内容。
- `borrowablePatterns`、`doNotCopy`、`differentiationRequirements` 与 `canonContaminationWarnings`。
- differentiation prompts。
- coverage、confidence、uncertainties、diagnostics 和 source pointers。

Preview 完成后进入 `awaitingFullApproval`。用户的“继续全量拆解”只授权下一阶段计算，不等于发布或修改真实 bundle。

### 8.3 Stage 2：Chapter analysis

- 每章独立工作单元；超长章再按 chunk 拆分。
- 一个 reference 默认只有一个 active run，不并发执行多个模型写作人格。
- 可以使用很小、明确有上限的 chunk 并发，但第一版建议串行，优先保证恢复和顺序可解释。
- 当前 chunk context 包含 protected analysis contract、no-copy rule、当前 source window、宿主 pointer map 和 bounded rolling summary。
- 前文 rolling summary 只是 compressible context，不能替代当前 chunk evidence。
- 每章完成即写 provisional attempt artifact；不发布目标文件。
- retry 生成新 attempt，不覆盖旧 finding；selected attempt 由宿主显式记录。

### 8.4 Stage 3：Aggregate analysis

聚合阶段默认读取已验证 chapter findings，不重新吞全文。只有在某项聚合需要核对来源时，宿主才按 evidence pointer 提供最小 source window。

聚合产物：

- plotlines / reader promises。
- pacing phases / tension pattern。
- hook setup、mention、advance、payoff pattern。
- character introduction / relationship movement techniques。
- worldbuilding information release pattern。
- timeline / chronology observations。
- trope / genre fulfillment observations。
- scene function / transition / dialogue-action balance techniques。

角色名、地名和事件事实可在 deconstruction evidence 层用于来源说明，但必须在 distilled 层抽象化。

### 8.5 Stage 4：Style profile

Style profile 分析：

- 句长与段落节奏。
- 叙事距离和 POV 习惯。
- 对话 / 动作 / 描写比例观察。
- 场景开头与结尾的功能。
- 信息密度、留白、转折和读者承诺。
- 可迁移原则与不能照搬的表达特征。

它不输出“仿写这位作者”的 prompt，不保存可识别长句作为 style anchor，也不承诺法律意义上的风格安全证明。

### 8.6 Stage 5：Distill for OAN

Distill 只能消费通过 schema 校验的 findings，不能直接读取原文并自由生成最终写作提示。

输出分为：

- `writing-style.md`：抽象叙事与表达原则。
- `pacing.md`：节奏模式及适用条件。
- `hooks.md`：悬念 / 兑现机制。
- `scene-techniques.md`：场景功能和调度技巧。
- `character-techniques.md`：角色呈现与关系推进技巧。
- `do-not-copy.md`：专有元素、桥段排列、表达和直接引用禁区。
- `context/index.yaml`：entry identity、category、tags、capability、token estimate 和 finding closure。
- `context/reference-summary.md`：面向 selector 的 bounded 总览。

### 8.7 Stage 6：Quality gate and candidate review

所有质量门通过后才进入 `reviewReady`。候选 UI 至少显示：

- 将发布的文件列表。
- 新增 / 修改摘要和 diff。
- source checksum、pipeline version 和 coverage。
- warnings / uncertainties / quality failures。
- no-copy 检查结果。
- selector 将能够读取哪些 entries。

用户 Accept 后才进入 publish commit barrier；Reject / Cancel 不改变真实 reference bundle。

## 9. Provider、Prompt 与 Context 边界

### 9.1 单模型、受限调用

- 使用 OAN 现有 provider resolver 和 workspace provider 配置。
- reference source 被视为不可信数据，不是 system / developer / user instruction。
- 拆解模型不获得 write tools、shell、网络或任意 filesystem tools。
- 所有 source window 由宿主读取并放在显式 delimiter / pointer map 内。
- Provider 输出必须经过 strict schema parse；raw prose、无效 JSON 或额外不可识别字段不进入 candidate。
- Provider error、parse error、timeout 或 cancel 不写 published output。

### 9.2 Context package

每个 stage 记录轻量 context package：

- selected source/chunk refs。
- omitted chapters/chunks 及 budget reason。
- protected analysis rules。
- rolling summary 是否被使用。
- pipeline / capability version。
- provider usage available / unavailable；在 `1110` 未完成前可只记录 estimate。

Trace 只记录选择、遗漏、工具/阶段结果和错误分类，不记录隐藏推理。

### 9.3 Prompt injection 防线

Reference 文本中出现“忽略规则”“调用工具”“写入文件”“输出秘密”等内容时，只能被视为作品文本。测试必须包含中英文 prompt-injection fixtures，并证明：

- 不改变输出 schema。
- 不触发工具。
- 不改变 allowed output category。
- 不读取 workspace 其它文件。
- 不泄露 provider config、路径外内容或其他 reference。

## 10. Quality Gate 与 no-copy 约束

### 10.1 Deterministic gates

- source checksum 与 run base 一致。
- source pointer 必须解析到当前 manifest 已知章节/chunk/line range。
- completed chapter count、chapter summary count 与 manifest coverage 一致。
- aggregate finding 的 evidence closure 必须存在。
- distilled entry 的 `sourceFindingRefs` 必须全部有效。
- context index 的所有 path 必须留在当前 reference bundle。
- category、confidence、capability、token estimate 和版本字段合法。
- required output 缺失时不能 publish。
- disabled reference 即使 publish 成功也不能进入 selector。

### 10.2 Copy-risk gates

- Typed schema 不提供直接引语字段。
- 对 candidate 与 source 做 deterministic long exact-overlap 检测；超过阈值时进入 blocking diagnostic。
- 对高相似长片段、连续对白和专有名词密集输出进行风险提示。
- `do-not-copy` 与 differentiation warnings 是 protected context，selector 使用 reference 时必须携带。
- 技术只能降低复制风险，不能宣称数学或法律意义上证明“无版权相似性”；最终仍需用户审阅。

### 10.3 Uncertainty

- 章节边界低置信、缺章、乱码、来源截断、聚合冲突都进入 diagnostics。
- 无法从 evidence 验证的内容不能被改写成高置信事实。
- `uncertain` 不阻塞所有分析，但 blocking quality diagnostic 必须阻止 publish。

## 11. Human Approval、事务与恢复

### 11.1 写入边界

- 用户显式 import 的 source 与 deterministic metadata 继续走现有导入操作。
- AI 生成 preview、findings、aggregate、style 和 distilled candidate 只写 `.workspace` shadow。
- Preview 的“继续”只是计算授权，不是目标文件 Accept。
- Final Publish 必须生成可见 PendingAction / diff；Accept 前真实 bundle 不变。
- Publish 是一次多文件原子 materialization：manifest、diagnostics、deconstruction、distilled 和 context index 必须同版本出现。
- 若当前 PendingAction seam 不能安全发布该多文件候选，D4 以最小 create/update multi-file approval slice 为局部 Gate；不在本任务扩建通用 Apply Engine。

### 11.2 并发与 CAS

- 一个 reference 同时只允许一个 active deconstruction run。
- start / approve / pause / resume / cancel / retry / publish 都要求 `baseRunRevision` 和 idempotency key。
- 关键生命周期在 reference-scoped cooperative filesystem lock 内重新读取权威 run state。
- source checksum 在 preview、full approval、stage retry 和 publish 前重新校验。
- 多 Backend 实例只能有一个命令成功推进同一 revision。

### 11.3 Cancel / pause / restart

- Pause 在当前 provider call 安全结束或被明确取消后生效，不启动下一工作单元。
- Cancel 在 publish commit barrier 前保证 published bundle 零改变。
- `publishing` 开始后不能伪报已取消；客户端必须 reconcile terminal truth。
- 应用重开后，遗留 `running` 规范化为 `interrupted/resumable`，不会自动调用 provider。
- Resume 从 selected completed attempts 继续，不重复发布已完成章节。
- Retry 保留旧 attempt 和诊断，避免覆盖失败证据。

### 11.4 Source drift

Source bundle 内的原始文件或 manifest checksum 被手工修改后：

- active run 立即 stale。
- publish fail closed。
- 已发布 distilled 输出对 selector 变为 stale / omitted。
- UI 提供“重新导入 / 从当前 source 新建 run”，不静默 rebase。

当前产品未发布，不实现旧 bundle migration；未知 schema / missing manifest 显示“需要重新拆解”，不能按新格式猜测读取。

## 12. Backend、Client 与 Desktop 形态

### 12.1 建议 API

保持现有 import/list/enable/context API，新功能只增加 typed routes。全书拆解采用 **request-bounded advance**：一次 `advance` 最多处理一个确定的 chapter/chunk 或 aggregate unit；Backend 不在请求结束后继续运行，也不为此建立后台 job framework。Desktop 可以在用户保持“继续运行”状态时顺序发起下一次 `advance`，暂停后停止发新请求。

```text
POST /api/workspace/references/:referenceId/deconstruction-runs
GET  /api/workspace/references/:referenceId/deconstruction-runs/:runId

POST /api/workspace/references/:referenceId/deconstruction-runs/:runId/approve-full
POST /api/workspace/references/:referenceId/deconstruction-runs/:runId/advance
POST /api/workspace/references/:referenceId/deconstruction-runs/:runId/pause
POST /api/workspace/references/:referenceId/deconstruction-runs/:runId/resume
POST /api/workspace/references/:referenceId/deconstruction-runs/:runId/cancel
POST /api/workspace/references/:referenceId/deconstruction-runs/:runId/retry
POST /api/workspace/references/:referenceId/deconstruction-runs/:runId/publish
```

建议 run create 第一版只接受 `mode: quickPreview`；full run 必须从同一 run 的 `awaitingFullApproval` 进入，不能绕过 preview gate。

`advance` 在持锁状态下 reservation 下一 unit、释放锁执行 provider、再次持锁校验 revision / source / input fingerprint 后提交 provisional attempt。两个并发 `advance` 只能有一个获得同一 unit；失败请求不能覆盖已完成 attempt。

所有 identifier 都从 path segment / typed body 校验；workspace root 只来自 Backend active workspace。

### 12.2 SSE events

```text
reference.deconstruction.started
reference.deconstruction.stage.started
reference.deconstruction.unit.completed
reference.deconstruction.stage.completed
reference.deconstruction.awaiting-approval
reference.deconstruction.paused
reference.deconstruction.review-ready
reference.deconstruction.publishing
reference.deconstruction.completed
reference.deconstruction.cancelled
reference.deconstruction.failed
reference.deconstruction.interrupted
```

`create` / `advance` 可以为当前有界 provider unit 返回 SSE；请求结束后不再产生新事件。SSE 是进度通知，不是权威事实。重连、未知 terminal 或事件缺失后，Client 必须 GET run detail reconcile，再决定是否发起下一次 `advance`。

### 12.3 Client strict guard

Client 应验证：

- reference / run / stage / attempt identity。
- revision 单调和 terminal status。
- source checksum / pipeline version。
- bounded progress 数量与合法百分比。
- diagnostics shape。
- preview / final artifact presentation 不包含 source 原文。
- publish response 包含 PendingAction 或 accepted materialization receipt，不能用普通成功文本代替。

### 12.4 Desktop 用户旅程

在现有 References tab 上增加 reference detail，而不是建立第二套 workspace：

1. Imported / Not analyzed 状态与 `Analyze preview`。
2. Preview running 的当前 stage、已处理范围和 Stop。
3. Preview ready 的摘要、适合学习 / 禁区、coverage、confidence、diagnostics。
4. `Continue full deconstruction` 明确显示预计章节数和成本范围。
5. Full run 的阶段列表、chapter progress、Pause / Resume / Cancel / Retry failed unit。
6. Review ready 的文件摘要、diff、quality gate 和 Publish。
7. Completed 后显示 distilled entry categories、current fingerprint 与 selector eligibility。
8. Stale / failed / interrupted 提供单一明确恢复动作，不用模糊 spinner。

基础原生按钮、disabled 状态、文本状态与错误提示继续保留；当前不扩展系统化 accessibility matrix。

## 13. Selector 升级

当前 selector 主要读取一个 `context/reference-summary.md`。完整拆解后升级为 entry-level selection：

- 输入 capability id、显式 reference ids、chapter goal、scene type、style / pacing / hook intent、token budget。
- 从 `context/index.yaml` 选择少量 distilled entries。
- `do-not-copy` 与 differentiation warnings 始终以 protected rule 加入。
- 输出 included / omitted / reason / budget / semantic boundary。
- `originalSourceRead` 默认且普通写作路径必须为 `false`。
- 只有 `enabled + completed + current + qualityPassed` 的 reference 可被选择。
- preview-only、incomplete、failed、stale、qualityFailed 和 missing outputs 均 fail closed，并以安全原因显示。
- explicit reference id 不能绕过 readiness gate。

Selector 不自动对每章启用 reference；仍只在用户显式选择 reference 或当前 capability 明确请求 reference context 时运行。

## 14. 实施切片

### D0：状态与存储契约修正

目标：停止把 stub 冒充已完成拆解，并建立最终 pipeline 的 identity / readiness 基础。

交付：

- 扩展 Core schema、run/stage state machine、manifest、diagnostics、fingerprint 和 source pointer。
- Import 只标记 `imported / notAnalyzed`。
- 取消或明确隔离 AI-looking stubs。
- selector 增加 readiness / stale / quality omission。
- 对 `references.yaml`、metadata、manifest 和 selector path 增加 runtime schema 与 bundle containment 校验，不能继续信任 YAML cast 或自由 summary path。
- Selector token budget 成为硬上限；即使一个 entry 都尚未 included，也不能无条件塞入超预算的第一项。
- Reference summary / Client / UI 显示真实 deconstruction status。
- Client 为现有和新增 Reference envelope 增加运行时 strict guard，并把 capability、goal、explicit reference ids 接到 context API。
- 未知版本、缺失 manifest、手改 source fail closed。

完成标准：新导入 reference 不会进入写作 context，直到存在 current、accepted、quality-passed 的 published artifact。

### D1：Quick Preview 纵向切片

目标：用户可以用有限成本判断 reference 是否值得继续分析。

交付：

- deterministic first-1–3-chapter / bounded chunk selection。
- 单模型 typed preview runner。
- source pointer closure、confidence、uncertainty、no-copy diagnostics。
- `.workspace` run artifact、revision/idempotency、cancel/reconcile。
- Backend / Client / Desktop preview journey。
- `Continue full deconstruction` confirmation gate。

完成标准：Preview 不读取全书、不写 published bundle；用户能审阅可追溯结果并决定继续或取消。

### D2：可恢复的分章拆解

目标：长文本可暂停、重启和局部重试。

交付：

- chapter/chunk work units 与 rolling context。
- 每次 request-bounded `advance` 只处理一个 unit，用户未继续请求时没有后台工作。
- stage attempt artifact、selected attempt、partial progress。
- Pause / Resume / Cancel / Retry unit。
- application restart reconciliation。
- per-reference lock、revision CAS 和 source drift 检查。

完成标准：完成章节不会因失败或重开丢失；失败章节可新建 attempt 重试，不覆盖历史结果。

### D3：聚合、Style 与质量门

目标：从可追溯 chapter findings 得到结构化全局观察。

交付：

- aggregate / style typed runner。
- evidence closure、coverage 与 uncertainty 汇总。
- exact-overlap / copy-risk、路径、hash、完整性质量门。
- diagnostics inspector。

完成标准：任何 blocking diagnostic 都阻止进入 reviewReady；聚合不依赖一次性全文 prompt。

### D4：Distill、审阅与发布

目标：形成真正可被 OAN 写作流程安全消费的参考技法。

交付：

- typed distilled entries 和 deterministic Markdown formatter。
- context index / bounded summary。
- `.workspace` candidate preview 与多文件 PendingAction。
- Accept 后原子 publish、Git 行为沿用现有配置。
- Reject / Cancel 对真实 bundle 零改变。

完成标准：只有 accepted、current、quality-passed 的 published run 能让 reference 变为 context eligible。

### D5：Entry-level Selector 与完整产品旅程

目标：规划、写作和审稿按任务只读取必要 technique entries。

交付：

- capability / scene / pacing / hook / explicit reference matching。
- included / omitted / reason / budget trace。
- References UI 的 entry 与 selector explanation。
- 从导入、Preview、Full、Publish 到一次 Writing context selection 的真实组件旅程。

完成标准：普通写作 context 能解释用了哪个 distilled entry、为什么使用、遗漏了什么，并证明原文未被读取。

## 15. 测试计划

测试继续放在根目录 `__test__/<module>/`，通过包入口导入。

### 15.1 Core

- 新导入状态为 notAnalyzed，不能被 selector 选择。
- 合法 / 非法 run 与 stage transition。
- idempotency key 同/异 payload。
- deterministic chapter/chunk identity 与 semantic boundary。
- 超过 12 章时仍为全部章节生成 work units，不沿用当前 stub 数量上限。
- source pointer 范围、checksum、cross-reference rejection。
- stage fingerprint 和 predecessor drift。
- manifest / diagnostics / progress round-trip。
- finding / distilled entry strict schema。
- coverage、missing output、invalid path 和 copy-risk quality gates。
- current / stale / qualityFailed selector omission。
- candidate formatter 不输出原文、internal reasoning 或 source path 外内容。

### 15.2 Agent

- Preview 只收到 bounded selected chunks。
- Full chapter call 只收到当前 chunk、protected rules 和 bounded rolling context。
- Reference 中的 prompt injection 不改变 schema 或触发 tools。
- 无证据 finding 被拒绝或明确降级为 general inference。
- Aggregate 只使用 verified chapter findings 和宿主提供的 evidence windows。
- Distill 不含专有名词密集段落、直接引语或可识别长表达。
- provider / parse / validation failure 不产生 accepted output。

### 15.3 Backend

- workspace/path containment。
- one-active-run-per-reference。
- base revision CAS 与双 start / 双 approve / 双 publish。
- Preview -> awaitingFullApproval -> repeated bounded advance -> reviewReady 的纵向 lifecycle。
- 每个 `advance` 只 reservation / 处理一个 unit；没有请求时不会后台推进。
- SSE lifecycle 与 GET reconcile。
- cancel before publish 零目标写入。
- restart 后 running -> interrupted/resumable。
- partial chapter failure、retry 和 completed unit reuse。
- source drift 后 resume / publish fail closed。
- publish commit barrier 与多文件 materialization。
- 两个 Backend 实例的 reference lock / CAS。

### 15.4 Client

- 所有 run/stage/event/diagnostic/publish response strict guard。
- future version、未知 status、非法 revision、越界数量 fail closed。
- stale / failed / cancelled / interrupted terminal state 正确区分。
- selector 不接受 incomplete reference，即使 server payload 声称 enabled。

### 15.5 Desktop

- Imported -> Preview -> Awaiting approval -> Full -> Review -> Publish 完整旅程。
- Preview cancel、Full pause/resume、failed unit retry。
- stale source、quality failure、unknown terminal 和 reconnect。
- disabled reference 与 context eligibility 区分。
- UI 不显示原文或内部推理。
- 基础 native control / text status 回归；系统化无障碍矩阵暂缓。
- 使用真实 References product component 的 renderer smoke，不以静态 HTML fixture 代替。

### 15.6 回归

- 既有 import/list/enable/context API 主路径无回归。
- Writing agent 在没有 eligible reference 时正常工作并记录 omission。
- Reference workflow 不改变当前小说 truth files。
- Play、PendingAction、session artifact 和 provider config 不受影响。
- Core / Agent / Backend / Client / Desktop build 与分层测试通过。

## 16. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 长文本 token / 时间成本失控 | Quick Preview gate、bounded chunks、显式 full approval、无隐藏 retry |
| Provider 中断造成重复或丢失 | stage attempts、fingerprint、idempotency、resume artifacts |
| AI 幻觉和错误归因 | opaque source pointers、Core revalidation、confidence / uncertainty、quality gate |
| Reference prompt injection | source 视为不可信数据、无 tools、严格 delimiter 和 schema |
| Canon 污染 | reference / shadow / novel truth 三层隔离，不做自动 adoption |
| 原文泄漏或过度模仿 | 无 quotation 字段、overlap 检测、do-not-copy、人工审阅、原文不进普通 prompt |
| Source 手改后继续使用旧分析 | checksum / structure / pipeline fingerprint，stale fail closed |
| 多实例覆盖 run | reference lock、revision CAS、一次 publish commit barrier |
| UI 把 preview 当成完成 | 独立 previewOnly / completed / eligible 状态与 selector gate |
| 过度平台化 | 单模型、请求驱动、无 daemon、无通用 workflow engine |

## 17. 完成定义

只有同时满足以下条件，`0900` 才能从 `Needs Review` 更新为 `Completed`：

- [ ] Import 不再把 deterministic stub 标记为已完成 AI 拆解。
- [ ] 未完成、未接受、stale 或 qualityFailed reference 不进入写作 context。
- [ ] Quick Preview 使用 bounded first-1–3-chapter / selected excerpt 输入。
- [ ] Full deconstruction 必须经过 Preview 后的显式用户确认。
- [ ] 分章拆解支持 pause、cancel、restart resume 和局部 retry。
- [ ] 每个 finding 都有合法 source pointer 或明确 general inference boundary。
- [ ] Aggregate / style / distilled 不依赖一次性全文 prompt。
- [ ] Published bundle 具有 current manifest、diagnostics、output hashes 和 quality pass。
- [ ] Candidate 发布前只写 `.workspace`；Accept 前真实 bundle 与 Git working tree 不改变。
- [ ] Reject / Cancel / provider failure / validation failure 不产生部分 published artifact。
- [ ] Selector 只读取 accepted distilled entries，普通写作路径 `originalSourceRead` 始终为 false。
- [ ] Reference 不自动修改当前小说 truth files。
- [ ] no-copy、prompt-injection、source drift、并发、恢复和 strict transport 测试通过。
- [ ] Core、Agent、Backend、Client、Desktop 全量相关回归和真实组件旅程通过。
- [ ] Task、Implementation Notes、schema fixtures 与本计划同步更新。

## 18. 后续候选，不属于本计划

深度拆解完成后，才评估：

1. 自有旧稿导入当前 workspace，并生成 summary / state / timeline / foreshadow 候选。
2. Reference-derived technique -> constitution / workflow 的独立 PendingAction adoption。
3. PDF / EPUB / DOCX / OCR import adapters。
4. 更精细的跨 reference 技法比较与作者自定义标签。
5. 与 `1110` usage stats 联动的 per-stage token / cost inspector。

这些候选都不能反向扩大 D0 / D1 范围。

## 19. 参考来源与吸收边界

本计划主要综合：

- `STORYFORGE_REFERENCE_OVERVIEW.md` / `STORYFORGE_REFERENCE_LESSONS.md`：chunk、rolling context、结构化聚合和 resumable long run。
- `WEBNOVEL_WRITER_REFERENCE_LESSONS.md`：borrowable patterns、do-not-copy、differentiation 和 canon contamination warnings。
- `NOVEL_WRITING_SKILLS_REFERENCE_OVERVIEW.md`：参考作品拆解库与只召回抽象技法。
- `INKOS_REFERENCE_LESSONS.md`：import / style / continuity report 与可审阅文件产物。
- `EVE_REFERENCE_ANALYSIS.md`：compiled manifest、diagnostics、stage dependency、stale / failed 和局部重跑。
- `OAN_AGENT_WRITING_GUIDE_REFERENCE_NOTES.md`：OAN 化 workflow、context package、session artifact 与 Human Approval 边界。

只吸收产品模式和抽象，不复制参考项目代码、prompt、schema 文案或受许可证约束的实现。

## 20. 推荐执行顺序

```text
D0 状态 / manifest / selector ready gate
  -> D1 Quick Preview 真实纵向切片
  -> 真实用户试用 Preview 与诊断
  -> D2 分章 resume / retry
  -> D3 aggregate / style / quality
  -> D4 distill / review / publish
  -> D5 entry-level selector / 完整旅程
```

下一次开始实现时，应先为 D0 + D1 创建执行级 plan，逐文件列出 Core schema、Agent runner、Backend routes、Client guards、Desktop components 和根目录测试；不要直接从 D2 全书拆解开工。
